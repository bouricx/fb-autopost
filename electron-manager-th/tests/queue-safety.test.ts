import { DatabaseSync } from "node:sqlite";
import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { QueueSafety, idempotencyKey } from "../electron/core/queue-safety";
function setup() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`CREATE TABLE accounts(id TEXT,name TEXT);INSERT INTO accounts VALUES('account','บัญชี');
    CREATE TABLE jobs(id TEXT PRIMARY KEY,account_id TEXT,status TEXT,next_attempt_at TEXT,submission_state TEXT,last_error TEXT,updated_at TEXT,overdue_approved INTEGER DEFAULT 0);
    CREATE TABLE automation_tasks(id TEXT PRIMARY KEY,account_id TEXT,action TEXT,status TEXT,scheduled_at TEXT,submission_state TEXT,last_error TEXT,updated_at TEXT,parent_id TEXT,overdue_approved INTEGER DEFAULT 0);
    INSERT INTO jobs(id,account_id,status,next_attempt_at,submission_state) VALUES('old','account','pending','2020-01-01T00:00:00.000Z','not_sent'),('future','account','pending','2099-01-01T00:00:00.000Z','not_sent');
    INSERT INTO automation_tasks(id,account_id,action,status,scheduled_at,submission_state) VALUES('unknown','account','post','pending','2020-01-01T00:00:00.000Z','unknown');`);
  const db = { prepare: (query: string) => sql.prepare(query), transaction: (work: () => unknown) => () => { sql.exec("BEGIN"); try { const value = work(); sql.exec("COMMIT"); return value; } catch (error) { sql.exec("ROLLBACK"); throw error; } } } as unknown as Database.Database;
  return { sql, safety: new QueueSafety(db) };
}
describe("overdue safety gate", () => {
  it("holds old tasks, never future work, and preserves explicit send approval across restart", () => {
    const { sql, safety } = setup();
    try {
      expect(safety.holdOverdue()).toBe(2); expect(safety.list()).toHaveLength(2);
      safety.resolve([{ kind: "post", id: "old" }], "send");
      expect(safety.holdOverdue(new Date(Date.now()+1000).toISOString())).toBe(0);
      expect(sql.prepare("SELECT status FROM jobs WHERE id='old'").get()).toMatchObject({ status: "pending" });
      expect(sql.prepare("SELECT status FROM jobs WHERE id='future'").get()).toMatchObject({ status: "pending" });
    } finally { sql.close(); }
  });
  it("refuses ambiguous submissions atomically and allows skip", () => {
    const { sql, safety } = setup();
    try {
      safety.holdOverdue();
      expect(() => safety.resolve([{ kind: "post", id: "old" }, { kind: "workflow", id: "unknown" }], "send")).toThrow();
      expect(safety.list()).toHaveLength(2);
      safety.resolve([{ kind: "workflow", id: "unknown" }], "skip");
      expect(sql.prepare("SELECT status FROM automation_tasks WHERE id='unknown'").get()).toMatchObject({ status: "skipped" });
      expect(() => safety.resolve([{ kind: "post", id: "old" }], "reschedule", "2020-01-01T00:00:00Z")).toThrow();
    } finally { sql.close(); }
  });
  it("generates deterministic non-plaintext operation keys", () => {
    expect(idempotencyKey(["account", "post", "round"])).toBe(idempotencyKey(["account", "post", "round"]));
    expect(idempotencyKey(["account", "post", "round"])).not.toContain("account");
    expect(idempotencyKey(["account", "post", "round2"])).not.toBe(idempotencyKey(["account", "post", "round"]));
  });
});
