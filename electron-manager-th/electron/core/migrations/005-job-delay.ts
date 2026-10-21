import type Database from "better-sqlite3";
export function migrateJobDelay(db: Database.Database) {
  if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=5").get()) return;
  db.transaction(() => {
    db.exec("ALTER TABLE jobs ADD COLUMN delay_min INTEGER NOT NULL DEFAULT 30; ALTER TABLE jobs ADD COLUMN delay_max INTEGER NOT NULL DEFAULT 90;");
    db.prepare("INSERT INTO schema_migrations(version) VALUES(5)").run();
  })();
}
