import type Database from "better-sqlite3";

export function migrateProjectWorkspaces(db: Database.Database) {
  if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=3").get()) return;
  db.transaction(() => {
    db.exec("ALTER TABLE projects ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}'");
    db.prepare("INSERT INTO schema_migrations(version) VALUES(3)").run();
  })();
}
