import type Database from "better-sqlite3";
export function migrateAutomationTasks(db: Database.Database) {
  if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=4").get()) return;
  db.transaction(() => {
    db.exec(`CREATE TABLE automation_tasks (
      id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,parent_id TEXT REFERENCES automation_tasks(id) ON DELETE CASCADE,
      action TEXT NOT NULL CHECK(action IN ('post','comment','share','like')),
      status TEXT NOT NULL DEFAULT 'pending',payload_json TEXT NOT NULL,result_url TEXT,last_error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,max_attempts INTEGER NOT NULL DEFAULT 3,
      scheduled_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE INDEX idx_automation_due ON automation_tasks(status,scheduled_at);
      CREATE TABLE automation_events(id INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT REFERENCES automation_tasks(id) ON DELETE CASCADE,
        account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,level TEXT NOT NULL,message TEXT NOT NULL,created_at TEXT NOT NULL);
      ALTER TABLE facebook_groups ADD COLUMN permissions_checked_at TEXT;
      ALTER TABLE facebook_groups ADD COLUMN permission_message TEXT;
      ALTER TABLE accounts ADD COLUMN groups_refreshed_at TEXT;
      ALTER TABLE accounts ADD COLUMN groups_count_difference INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE accounts ADD COLUMN cooldown_until TEXT;
    `);
    db.prepare("INSERT INTO schema_migrations(version) VALUES(4)").run();
  })();
}
