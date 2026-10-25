import type Database from "better-sqlite3";
export function migrateGroupPermissions(db: Database.Database) {
  if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=8").get()) return;
  db.transaction(() => {
    db.exec(`ALTER TABLE facebook_groups ADD COLUMN post_permission TEXT NOT NULL DEFAULT 'unknown';
      ALTER TABLE facebook_groups ADD COLUMN share_permission TEXT NOT NULL DEFAULT 'unknown';
      UPDATE facebook_groups SET post_permission='unknown',share_permission='unknown';`);
    db.prepare("INSERT INTO schema_migrations(version) VALUES(8)").run();
  })();
}
