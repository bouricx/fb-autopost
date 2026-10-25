import { DatabaseSync } from "node:sqlite";
import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { TaskManager } from "../electron/automation/task-manager";
import { actionPayloadSchema } from "../electron/automation/contracts";
const enabledFeatures = { comment: true, share: true, like: true, workflowFollowUp: true, pendingApprovalDetector: true, groupPermissionCheck: true };
function setup() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`CREATE TABLE accounts(id TEXT PRIMARY KEY,adapter_type TEXT,status TEXT,cooldown_until TEXT);
    INSERT INTO accounts VALUES('account','facebook-browser','active',NULL);
    CREATE TABLE automation_tasks(id TEXT PRIMARY KEY,account_id TEXT,project_id TEXT,parent_id TEXT,action TEXT,status TEXT DEFAULT 'pending',payload_json TEXT,result_url TEXT,last_error TEXT,attempts INTEGER DEFAULT 0,max_attempts INTEGER DEFAULT 5,scheduled_at TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE automation_events(task_id TEXT,account_id TEXT,level TEXT,message TEXT,created_at TEXT);`);
  const db = { prepare: (query: string) => sql.prepare(query), transaction: (work: () => unknown) => () => { sql.exec("SAVEPOINT work"); try { const result = work(); sql.exec("RELEASE work"); return result; } catch (error) { sql.exec("ROLLBACK TO work; RELEASE work"); throw error; } } } as unknown as Database.Database;
  sql.exec("ALTER TABLE automation_tasks ADD COLUMN idempotency_key TEXT; CREATE UNIQUE INDEX task_key ON automation_tasks(idempotency_key); ALTER TABLE automation_tasks ADD COLUMN submission_state TEXT DEFAULT 'not_sent'");
  return { sql, manager: new TaskManager(db, enabledFeatures) };
}
describe("automation tasks", () => {
  it("does not duplicate the same logical task or follow-up on repeated calls", () => {
    const { sql, manager } = setup();
    try {
      const payload = { targetUrl: "https://www.facebook.com/groups/123", caption: "โพสต์", commentEnabled: true, commentTemplates: [{ text: "++" }] };
      const at = "2099-01-01T00:00:00.000Z";
      const id = manager.create("account", "post", payload, at);
      expect(manager.create("account", "post", payload, at)).toBe(id);
      const post = manager.list()[0];
      manager.followUps(post, "https://www.facebook.com/posts/789"); manager.followUps(post, "https://www.facebook.com/posts/789");
      expect(manager.list().filter(row => row.action === "comment")).toHaveLength(1);
    } finally { sql.close(); }
  });
  it("limits safe pre-submit retries to five total attempts", () => {
    const { sql, manager } = setup();
    try {
      const id = manager.create("account", "like", { targetUrl: "https://www.facebook.com/posts/123" });
      const task = manager.list().find(row => row.id === id)!;
      expect(task.maxAttempts).toBe(5);
      manager.claim(id);
      expect(manager.retryBeforeSubmit(task, "ก่อนส่งผิดพลาด")).toBe(true);
      expect(manager.list()[0].status).toBe("pending");
      expect(manager.list()[0].attempts).toBe(1);
      expect(Date.parse(manager.list()[0].scheduledAt)).toBeGreaterThan(Date.now());
      expect(manager.retryBeforeSubmit({ ...task, attempts: 4 }, "ครบแล้ว")).toBe(false);
    } finally { sql.close(); }
  });
  it("chains post, comment, share and like as one workflow", () => {
    const { sql, manager } = setup();
    try {
      const id = manager.create("account", "post", { targetUrl: "https://www.facebook.com/groups/123", caption: "โพสต์",
        commentEnabled: true, commentTemplates: [{ text: "ความคิดเห็น" }], shareEnabled: true,
        shareTargets: [{ url: "https://www.facebook.com/groups/456", name: "กลุ่ม" }], likeEnabled: true });
      const post = manager.list()[0];
      manager.followUps(post, "https://www.facebook.com/posts/789");
      const comment = manager.list().find(row => row.action === "comment")!;
      const share = manager.list().find(row => row.action === "share")!;
      const like = manager.list().find(row => row.action === "like")!;
      expect(comment.parentId).toBe(id); expect(share.parentId).toBe(comment.id); expect(like.parentId).toBe(share.id);
    } finally { sql.close(); }
  });
  it("waits for the previous enabled step and cancels descendants on failure", () => {
    const { sql, manager } = setup();
    try {
      const payload = { targetUrl: "https://www.facebook.com/posts/123", caption: "ทดสอบ", delayMin: 0, delayMax: 0 };
      const first = manager.create("account", "comment", payload);
      const second = manager.create("account", "like", payload, undefined, null, first);
      expect(manager.due(new Set())?.id).toBe(first);
      manager.claim(first);
      expect(manager.due(new Set())).toBeUndefined();
      manager.finish(manager.list().find(row => row.id === first)!, "failed", "ไม่สำเร็จ");
      expect(manager.due(new Set())).toBeUndefined();
      expect(manager.list().find(row => row.id === second)?.status).toBe("cancelled");
    } finally { sql.close(); }
  });
  it("runs the next step only after its parent succeeds", () => {
    const { sql, manager } = setup();
    try {
      const payload = { targetUrl: "https://www.facebook.com/posts/123", delayMin: 0, delayMax: 0 };
      const first = manager.create("account", "like", payload);
      const second = manager.create("account", "like", payload, undefined, null, first);
      manager.claim(first);
      manager.finish(manager.list().find(row => row.id === first)!, "succeeded", "สำเร็จ");
      expect(manager.due(new Set())?.id).toBe(second);
    } finally { sql.close(); }
  });
  it("claims once, honors account reservation, and records outcomes", () => {
    const { sql, manager } = setup();
    try {
      const id = manager.create("account", "like", { targetUrl: "https://www.facebook.com/posts/123" });
      expect(manager.due(new Set(["account"]))).toBeUndefined();
      const task = manager.due(new Set())!;
      expect(task.id).toBe(id); expect(manager.claim(id)).toBe(true); expect(manager.claim(id)).toBe(false);
      manager.finish(task, "succeeded", "สำเร็จ", task.payload.targetUrl);
      expect(manager.list()[0].status).toBe("succeeded");
      expect(sql.prepare("SELECT * FROM automation_events").all()).toHaveLength(1);
    } finally { sql.close(); }
  });
  it("rejects unsafe targets and empty comments", () => {
    const { sql, manager } = setup();
    try {
      expect(() => manager.create("account", "like", { targetUrl: "https://evil.example/" })).toThrow();
      expect(() => manager.create("account", "comment", { targetUrl: "https://www.facebook.com/posts/123" })).toThrow();
      expect(() => actionPayloadSchema.parse({ targetUrl: "https://www.facebook.com/posts/123", delayMin: 50, delayMax: 10 })).toThrow();
      expect(manager.list()).toHaveLength(0);
    } finally { sql.close(); }
  });
  it("does not silently retry interrupted work and schedules repeat sharing", () => {
    const { sql, manager } = setup();
    try {
      const id = manager.create("account", "share", { sourceUrl: "https://www.facebook.com/posts/123", targetUrl: "https://www.facebook.com/groups/456", groupName: "กลุ่ม", repeatMinutes: 60 });
      const task = manager.list()[0]; manager.claim(id); manager.recover();
      expect(manager.list()[0].status).toBe("uncertain");
      manager.followUps(task, task.payload.targetUrl);
      const repeat = manager.list().find(row => row.id !== id)!;
      expect(Date.parse(repeat.scheduledAt)).toBeGreaterThan(Date.now() + 59 * 60000);
      manager.cancel(repeat.id); expect(manager.list().find(row => row.id === repeat.id)?.status).toBe("cancelled");
    } finally { sql.close(); }
  });
});
