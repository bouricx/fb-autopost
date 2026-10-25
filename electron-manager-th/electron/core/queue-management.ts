import type Database from "better-sqlite3";

export function deleteQueueItem(db: Database.Database, kind: "post" | "workflow", id: string): void {
  db.transaction(() => {
    if (kind === "workflow") {
      const running = db.prepare(`WITH RECURSIVE children(id,status) AS (
        SELECT id,status FROM automation_tasks WHERE id=? UNION ALL SELECT child.id,child.status FROM automation_tasks child JOIN children ON child.parent_id=children.id
      ) SELECT 1 FROM children WHERE status='running' LIMIT 1`).get(id);
      if (running) throw new Error("งานหรือขั้นตอนลูกกำลังทำงาน กรุณารอให้จบก่อนลบ");
      db.prepare("DELETE FROM automation_tasks WHERE id=?").run(id);
    } else {
      const row = db.prepare("SELECT status FROM jobs WHERE id=?").get(id) as { status: string } | undefined;
      if (row?.status === "running") throw new Error("งานกำลังทำงาน กรุณารอให้จบก่อนลบ");
      db.prepare("DELETE FROM jobs WHERE id=?").run(id);
    }
  })();
}

/** Cancel only work that has not started; keep sent and uncertain history for review. */
export function cancelPendingQueueItems(db: Database.Database, items: { kind: "post" | "workflow"; id: string }[]): number {
  if (items.length > 2000) throw new Error("เลือกคิวมากเกินไป กรุณาแบ่งลบเป็นชุด");
  return db.transaction(() => {
    let changed = 0;
    const now = new Date().toISOString();
    for (const item of items) {
      if (item.kind === "post") {
        changed += db.prepare(`UPDATE jobs SET status='cancelled',updated_at=? WHERE id=? AND status IN ('pending','review_required')
          AND submission_state='not_sent'`).run(now, item.id).changes;
      } else if (item.kind === "workflow") {
        changed += db.prepare(`UPDATE automation_tasks SET status='cancelled',last_error='ผู้ใช้ยกเลิกคิวที่ยังไม่ส่ง',updated_at=?
          WHERE id=? AND status IN ('pending','review_required') AND submission_state='not_sent'`).run(now, item.id).changes;
      } else throw new Error("ประเภทคิวไม่ถูกต้อง");
    }
    db.prepare(`WITH RECURSIVE blocked(id) AS (
      SELECT id FROM automation_tasks WHERE status IN ('cancelled','failed','uncertain','skipped','pending_approval')
      UNION SELECT child.id FROM automation_tasks child JOIN blocked ON child.parent_id=blocked.id
    ) UPDATE automation_tasks SET status='cancelled',last_error='หยุดเพราะขั้นตอนก่อนหน้าถูกยกเลิก',updated_at=?
      WHERE status IN ('pending','review_required') AND parent_id IN (SELECT id FROM blocked)`).run(now);
    return changed;
  })();
}

/** Remove only not-sent queued rows. Never erase published/uncertain history or running work. */
export function deletePendingQueueItems(db: Database.Database, items: { kind: "post" | "workflow"; id: string }[]): number {
  if (!items.length || items.length > 2000) throw new Error("เลือกคิว 1–2000 รายการต่อครั้ง");
  return db.transaction(() => {
    const ids = [...new Map(items.map(item => [`${item.kind}:${item.id}`, item])).values()];
    for (const item of ids) {
      if (item.kind === "post") {
        const row = db.prepare("SELECT status,submission_state AS state FROM jobs WHERE id=?").get(item.id) as { status: string; state: string } | undefined;
        if (!row || !["pending", "review_required", "cancelled"].includes(row.status) || row.state !== "not_sent") throw new Error("มีคิวที่เริ่มทำหรืออาจส่งแล้ว กรุณารีเฟรชและเลือกเฉพาะคิวที่ยังไม่ส่ง");
      } else if (item.kind === "workflow") {
        const row = db.prepare("SELECT status,submission_state AS state FROM automation_tasks WHERE id=?").get(item.id) as { status: string; state: string } | undefined;
        if (!row || !["pending", "review_required", "cancelled"].includes(row.status) || row.state !== "not_sent") throw new Error("มีคิวที่เริ่มทำหรืออาจส่งแล้ว กรุณารีเฟรชและเลือกเฉพาะคิวที่ยังไม่ส่ง");
        const descendants = db.prepare(`WITH RECURSIVE children(id,status,state) AS (
          SELECT id,status,submission_state FROM automation_tasks WHERE id=?
          UNION ALL SELECT child.id,child.status,child.submission_state FROM automation_tasks child JOIN children ON child.parent_id=children.id
        ) SELECT 1 FROM children WHERE status NOT IN ('pending','review_required','cancelled') OR state!='not_sent' LIMIT 1`).get(item.id);
        if (descendants) throw new Error("คิวนี้มีขั้นตอนลูกที่เริ่มทำหรืออาจส่งแล้ว ไม่ลบประวัติ");
      } else throw new Error("ประเภทคิวไม่ถูกต้อง");
    }
    const selectedKeys = new Set(ids.filter(item => item.kind === "workflow").map(item => item.id));
    for (const item of ids) {
      if (item.kind !== "workflow") continue;
      const parent = db.prepare("SELECT parent_id AS parentId FROM automation_tasks WHERE id=?").get(item.id) as { parentId: string | null } | undefined;
      if (parent?.parentId && !selectedKeys.has(parent.parentId)) {
        const ancestor = db.prepare(`WITH RECURSIVE ancestors(id,status,state,parent_id) AS (
          SELECT id,status,submission_state,parent_id FROM automation_tasks WHERE id=?
          UNION ALL SELECT parent.id,parent.status,parent.submission_state,parent.parent_id FROM automation_tasks parent JOIN ancestors ON parent.id=ancestors.parent_id
        ) SELECT 1 FROM ancestors WHERE status NOT IN ('pending','review_required','cancelled') OR state!='not_sent' LIMIT 1`).get(parent.parentId);
        if (ancestor) throw new Error("ขั้นตอนก่อนหน้าอาจส่งแล้ว ไม่ลบเฉพาะขั้นตอนลูก");
      }
    }
    for (const item of ids) {
      if (item.kind === "post") db.prepare("DELETE FROM jobs WHERE id=?").run(item.id);
      else db.prepare("DELETE FROM automation_tasks WHERE id=?").run(item.id);
    }
    return ids.length;
  })();
}
