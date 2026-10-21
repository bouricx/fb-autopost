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
