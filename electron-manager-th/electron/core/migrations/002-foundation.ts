import type Database from "better-sqlite3";

/** Additive, transactional migration: never rebuild or drop legacy tables. */
export function migrateFoundation(db: Database.Database): void {
  if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=2").get()) return;
  db.transaction(() => {
    const columns = new Set((db.prepare("PRAGMA table_info(accounts)").all() as { name: string }[]).map(row => row.name));
    const additions: Record<string, string> = {
      encrypted_cookies: "TEXT", cookie_format: "TEXT", session_status: "TEXT NOT NULL DEFAULT 'unknown'",
      status_message: "TEXT", last_checked_at: "TEXT", headless: "INTEGER NOT NULL DEFAULT 1",
      encrypted_proxy: "TEXT", delay_min: "INTEGER NOT NULL DEFAULT 30", delay_max: "INTEGER NOT NULL DEFAULT 90",
    };
    for (const [name, definition] of Object.entries(additions)) {
      if (!columns.has(name)) db.exec(`ALTER TABLE accounts ADD COLUMN ${name} ${definition}`);
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS facebook_groups (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        facebook_group_id TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL, image_url TEXT,
        privacy_type TEXT, membership_status TEXT, can_post INTEGER NOT NULL DEFAULT 0,
        can_share INTEGER NOT NULL DEFAULT 0, discovered_from TEXT, last_seen_at TEXT,
        UNIQUE(account_id,facebook_group_id)
      );
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, color TEXT,
        last_opened_tab TEXT NOT NULL DEFAULT 'post', is_last_used INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS project_accounts (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        caption TEXT, media_json TEXT NOT NULL DEFAULT '[]', group_ids_json TEXT NOT NULL DEFAULT '[]',
        delay_min INTEGER, delay_max INTEGER, headless_override INTEGER,
        comment_enabled INTEGER NOT NULL DEFAULT 0, share_enabled INTEGER NOT NULL DEFAULT 0,
        like_enabled INTEGER NOT NULL DEFAULT 0, comment_settings_json TEXT, share_settings_json TEXT,
        like_settings_json TEXT, UNIQUE(project_id,account_id)
      );
      CREATE TABLE IF NOT EXISTS group_content_mappings (
        id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        group_id TEXT NOT NULL REFERENCES facebook_groups(id) ON DELETE CASCADE,
        post_caption TEXT, post_media_json TEXT NOT NULL DEFAULT '[]', comment_text TEXT,
        comment_media_json TEXT NOT NULL DEFAULT '[]', share_text TEXT,
        share_media_json TEXT NOT NULL DEFAULT '[]', delay_seconds INTEGER,
        enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS comment_templates (
        id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL, text TEXT, media_json TEXT NOT NULL DEFAULT '[]',
        weight INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notification_channels (
        id TEXT PRIMARY KEY, account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL,
        type TEXT NOT NULL, encrypted_url TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
      );
    `);
    db.prepare("INSERT INTO schema_migrations(version) VALUES(2)").run();
  })();
}
