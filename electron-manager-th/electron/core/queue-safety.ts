import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
export function idempotencyKey(parts: unknown[]): string { return createHash("sha256").update(JSON.stringify(parts)).digest("hex"); }
export interface OverdueItem { id: string; kind: "post" | "workflow"; action: string; account: string; scheduledAt: string; submissionState: string; error: string | null }
export class QueueSafety {
  constructor(private db: Database.Database) {}
  holdOverdue(timestamp = new Date().toISOString()): number {
    return this.db.transaction(() => {
      let count = 0;
      for (const [table, column] of [["jobs", "next_attempt_at"], ["automation_tasks", "scheduled_at"]]) {
        count += this.db.prepare(`UPDATE ${table} SET status='review_required',updated_at=? WHERE status='pending' AND overdue_approved=0 AND ${column}<?`).run(timestamp, timestamp).changes;
      }
      return count;
    })();
  }
  list(): OverdueItem[] {
    return this.db.prepare(`SELECT j.id,'post' AS kind,'post' AS action,a.name AS account,j.next_attempt_at AS scheduledAt,j.submission_state AS submissionState,j.last_error AS error
      FROM jobs j JOIN accounts a ON a.id=j.account_id WHERE j.status='review_required'
      UNION ALL SELECT t.id,'workflow',t.action,a.name,t.scheduled_at,t.submission_state,t.last_error FROM automation_tasks t JOIN accounts a ON a.id=t.account_id WHERE t.status='review_required'
      ORDER BY scheduledAt`).all() as OverdueItem[];
  }
  resolve(items: { kind: "post" | "workflow"; id: string }[], decision: "skip" | "reschedule" | "send", at?: string): number {
    const timestamp = new Date().toISOString();
    if (decision === "reschedule" && (!at || !Number.isFinite(Date.parse(at)) || at <= timestamp)) throw new Error("กำหนดเวลาใหม่ต้องเป็นเวลาในอนาคต");
    return this.db.transaction(() => {
      let changed = 0;
      for (const item of items) {
        const table = item.kind === "post" ? "jobs" : "automation_tasks";
        const column = item.kind === "post" ? "next_attempt_at" : "scheduled_at";
        const row = this.db.prepare(`SELECT status,submission_state AS submissionState FROM ${table} WHERE id=?`).get(item.id) as { status: string; submissionState: string } | undefined;
        if (!row || row.status !== "review_required") continue;
        if (decision !== "skip" && row.submissionState !== "not_sent") throw new Error("มีงานที่อาจส่งแล้ว ต้องตรวจ Facebook ก่อน ไม่อนุญาตส่งซ้ำจากหน้านี้");
        changed += decision === "skip" ? this.db.prepare(`UPDATE ${table} SET status='skipped',updated_at=? WHERE id=?`).run(timestamp, item.id).changes
          : this.db.prepare(`UPDATE ${table} SET status='pending',${column}=?,updated_at=?,overdue_approved=? WHERE id=?`).run(decision === "send" ? timestamp : at!, timestamp, Number(decision === "send"), item.id).changes;
      }
      this.db.prepare(`WITH RECURSIVE blocked(id) AS (SELECT id FROM automation_tasks WHERE status IN ('skipped','cancelled','uncertain','failed') UNION SELECT child.id FROM automation_tasks child JOIN blocked ON child.parent_id=blocked.id)
        UPDATE automation_tasks SET status='cancelled',last_error='ขั้นตอนก่อนหน้าถูกข้ามหรือไม่สำเร็จ' WHERE status IN ('pending','review_required') AND parent_id IN (SELECT id FROM blocked)`).run();
      return changed;
    })();
  }
}
