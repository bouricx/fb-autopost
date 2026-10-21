import type Database from "better-sqlite3";
export function migrateQueueSafety(db: Database.Database) {
  if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=7").get()) return;
  db.transaction(() => {
    for (const table of ["jobs", "automation_tasks"]) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN idempotency_key TEXT;
        ALTER TABLE ${table} ADD COLUMN submission_state TEXT NOT NULL DEFAULT 'not_sent';
        ALTER TABLE ${table} ADD COLUMN overdue_approved INTEGER NOT NULL DEFAULT 0;
        CREATE UNIQUE INDEX idx_${table}_idempotency ON ${table}(idempotency_key) WHERE idempotency_key IS NOT NULL;`);
      db.exec(`UPDATE ${table} SET submission_state=CASE WHEN status='succeeded' THEN 'sent' WHEN status IN ('running','uncertain') THEN 'unknown' WHEN attempts>0 AND status IN ('failed','pending') THEN 'unknown' ELSE 'not_sent' END;`);
    }
    db.prepare("INSERT INTO schema_migrations(version) VALUES(7)").run();
  })();
}
