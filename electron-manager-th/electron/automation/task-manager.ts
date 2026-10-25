import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { actionPayloadSchema, type ActionKind, type ActionPayload, type AutomationTask } from "./contracts";
import { delayMilliseconds } from "../../src/shared/delay";
import { idempotencyKey } from "../core/queue-safety";

export class TaskManager {
  constructor(readonly db: Database.Database) {}
  create(accountId: string, action: ActionKind, payload: unknown, scheduledAt = new Date().toISOString(), projectId: string | null = null, parentId: string | null = null, stableKey?: string) {
    const parsed = actionPayloadSchema.parse(payload);
    if (action === "post" && !parsed.caption.trim() && !parsed.media.length) throw new Error("กรุณาระบุข้อความหรือสื่อ");
    if (action === "post" && parsed.commentEnabled && !parsed.commentTemplates.some(template => template.text.trim() || template.image)) throw new Error("เปิดความคิดเห็นแล้ว กรุณาเพิ่มข้อความหรือรูป Template");
    if (action === "post" && parsed.shareEnabled && !parsed.shareTargets.length) throw new Error("เปิดแชร์แล้ว กรุณาเลือกกลุ่มแชร์");
    if (action === "comment" && !parsed.caption.trim() && !parsed.media.length) throw new Error("กรุณาระบุความคิดเห็นหรือรูป");
    if (action === "share" && (!parsed.sourceUrl || !parsed.groupName)) throw new Error("กรุณาระบุโพสต์ต้นฉบับและชื่อกลุ่ม");
    if (!Number.isFinite(Date.parse(scheduledAt))) throw new Error("เวลาไม่ถูกต้อง");
    const account = this.db.prepare("SELECT adapter_type FROM accounts WHERE id=?").get(accountId) as { adapter_type: string } | undefined;
    if (account?.adapter_type !== "facebook-browser") throw new Error("กรุณาเลือกบัญชี Facebook");
    const key = stableKey || idempotencyKey([accountId, action, scheduledAt, parentId, parsed]);
    const existing = this.db.prepare("SELECT id FROM automation_tasks WHERE idempotency_key=?").get(key) as { id: string } | undefined;
    if (existing) return existing.id;
    const id = randomUUID(), now = new Date().toISOString();
    this.db.prepare(`INSERT INTO automation_tasks(id,account_id,project_id,parent_id,action,payload_json,scheduled_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(id, accountId, projectId, parentId, action, JSON.stringify(parsed), scheduledAt, now, now);
    this.db.prepare("UPDATE automation_tasks SET max_attempts=5 WHERE id=?").run(id);
    this.db.prepare("UPDATE automation_tasks SET idempotency_key=? WHERE id=?").run(key, id);
    return id;
  }
  list(): AutomationTask[] {
    return (this.db.prepare(`SELECT id,account_id AS accountId,project_id AS projectId,parent_id AS parentId,action,status,submission_state AS submissionState,payload_json AS payload,
      result_url AS resultUrl,last_error AS lastError,attempts,max_attempts AS maxAttempts,scheduled_at AS scheduledAt FROM automation_tasks ORDER BY created_at DESC LIMIT 500`).all() as Array<Omit<AutomationTask, "payload"> & { payload: string }>).
      map(row => ({ ...row, payload: actionPayloadSchema.parse(JSON.parse(row.payload)) }));
  }
  due(excluded: Set<string>): AutomationTask | undefined {
    this.db.prepare(`WITH RECURSIVE blocked(id) AS (
      SELECT id FROM automation_tasks WHERE status IN ('failed','uncertain','cancelled','skipped')
      UNION SELECT child.id FROM automation_tasks child JOIN blocked ON child.parent_id=blocked.id
    ) UPDATE automation_tasks SET status='cancelled',last_error='หยุดเพราะขั้นตอนก่อนหน้าไม่สำเร็จ' WHERE status IN ('pending','review_required') AND parent_id IN (SELECT id FROM blocked)`).run();
    const timestamp = new Date().toISOString();
    const rows = this.db.prepare(`SELECT t.id,t.account_id AS accountId,t.project_id AS projectId,t.parent_id AS parentId,t.action,t.status,t.payload_json AS payload,
      t.result_url AS resultUrl,t.last_error AS lastError,t.attempts,t.max_attempts AS maxAttempts,t.scheduled_at AS scheduledAt FROM automation_tasks t JOIN accounts a ON a.id=t.account_id
      WHERE t.status='pending' AND t.scheduled_at<=? AND a.status='active' AND (a.cooldown_until IS NULL OR a.cooldown_until<=?)
      AND (t.parent_id IS NULL OR EXISTS(SELECT 1 FROM automation_tasks parent WHERE parent.id=t.parent_id AND parent.status='succeeded')) ORDER BY t.scheduled_at`)
      .all(timestamp, timestamp) as Array<Omit<AutomationTask, "payload"> & { payload: string }>;
    const row = rows.find(task => !excluded.has(task.accountId));
    return row ? { ...row, payload: actionPayloadSchema.parse(JSON.parse(row.payload)) } : undefined;
  }
  claim(id: string) { return this.db.prepare("UPDATE automation_tasks SET status='running',attempts=attempts+1,updated_at=? WHERE id=? AND status='pending'").run(new Date().toISOString(), id).changes === 1; }
  finish(task: AutomationTask, status: string, message: string, url: string | null = null) {
    this.db.transaction(() => {
      this.db.prepare("UPDATE automation_tasks SET status=?,last_error=?,result_url=?,updated_at=? WHERE id=?")
        .run(status, status === "succeeded" ? null : message, url, new Date().toISOString(), task.id);
      this.db.prepare("INSERT INTO automation_events(task_id,account_id,level,message,created_at) VALUES(?,?,?,?,?)")
        .run(task.id, task.accountId, status === "succeeded" ? "info" : "error", message, new Date().toISOString());
      this.db.prepare("UPDATE accounts SET cooldown_until=? WHERE id=?").run(new Date(Date.now() + delayMilliseconds(task.payload.delayMin, task.payload.delayMax)).toISOString(), task.accountId);
    })();
  }
  cancel(id: string) { this.db.prepare("UPDATE automation_tasks SET status='cancelled' WHERE id=? AND status='pending'").run(id); }
  retryBeforeSubmit(task: AutomationTask, message: string): boolean {
    const state = this.db.prepare("SELECT submission_state AS state FROM automation_tasks WHERE id=?").get(task.id) as { state: string } | undefined;
    if (!state || state.state !== "not_sent") return false;
    const attempt = task.attempts + 1;
    if (attempt >= (task.maxAttempts || 5)) return false;
    const next = new Date(Date.now() + Math.min(3600000, 30000 * 2 ** task.attempts)).toISOString();
    this.db.prepare("UPDATE automation_tasks SET status='pending',last_error=?,scheduled_at=?,updated_at=? WHERE id=?").run(message, next, new Date().toISOString(), task.id);
    return true;
  }
  recover() { this.db.prepare("UPDATE automation_tasks SET status='uncertain',submission_state='unknown',last_error='โปรแกรมปิดระหว่างทำงาน กรุณาตรวจ Facebook ก่อนเริ่มใหม่' WHERE status='running'").run(); }
  followUps(task: AutomationTask, url: string) {
    this.db.transaction(() => {
      if (task.payload.scheduleId) {
        const schedule = this.db.prepare("SELECT enabled FROM daily_schedules WHERE id=?").get(task.payload.scheduleId) as { enabled: number } | undefined;
        if (!schedule?.enabled) return;
      }
      const base: ActionPayload = { ...task.payload, targetUrl: url, commentEnabled: false, shareEnabled: false, likeEnabled: false, repeatMinutes: 0 };
      if (task.action === "post") {
        let parentId = task.id;
        if (task.payload.commentEnabled) for (const [index, template] of task.payload.commentTemplates.entries()) {
          parentId = this.create(task.accountId, "comment", { ...base, caption: template.text, media: template.image ? [template.image] : [] }, undefined, task.projectId, parentId, idempotencyKey([task.id, "comment", index]));
        }
        if (task.payload.shareEnabled) for (const [index, target] of task.payload.shareTargets.entries()) parentId = this.create(task.accountId, "share", { ...base, sourceUrl: url, targetUrl: target.url, groupName: target.name, caption: target.caption, media: target.media, repeatMinutes: task.payload.repeatMinutes }, undefined, task.projectId, parentId, idempotencyKey([task.id, "share", index]));
        if (task.payload.likeEnabled) this.create(task.accountId, "like", { ...base, caption: "", media: [] }, undefined, task.projectId, parentId, idempotencyKey([task.id, "like"]));
      }
      if (task.action === "share" && task.payload.repeatMinutes > 0) this.create(task.accountId, "share", task.payload,
        new Date(Date.now() + task.payload.repeatMinutes * 60000).toISOString(), task.projectId, task.id, idempotencyKey([task.id, "repeat-share"]));
    })();
  }
}
