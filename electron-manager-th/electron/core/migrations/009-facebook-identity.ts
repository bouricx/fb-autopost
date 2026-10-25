import type Database from "better-sqlite3";

/** Preserve existing accounts and profiles; identity is populated only by a verified session. */
export function migrateFacebookIdentity(db: Database.Database) {
  if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=9").get()) return;
  db.transaction(() => {
    db.exec(`ALTER TABLE accounts ADD COLUMN facebook_user_id TEXT;
      ALTER TABLE accounts ADD COLUMN facebook_name TEXT;
      ALTER TABLE accounts ADD COLUMN facebook_photo_url TEXT;
      ALTER TABLE accounts ADD COLUMN facebook_actor_type TEXT NOT NULL DEFAULT 'unknown';
      ALTER TABLE accounts ADD COLUMN facebook_identity_checked_at TEXT;`);
    db.prepare("INSERT INTO schema_migrations(version) VALUES(9)").run();
  })();
}
