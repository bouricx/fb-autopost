import type Database from "better-sqlite3";
export function migrateDailySchedules(db: Database.Database) {
  if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=6").get()) return;
  db.transaction(() => {
    db.exec(`CREATE TABLE daily_schedules(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      name TEXT NOT NULL,start_date TEXT NOT NULL,daily INTEGER NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,
      times_json TEXT NOT NULL,payloads_json TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE schedule_rounds(id TEXT PRIMARY KEY,schedule_id TEXT NOT NULL REFERENCES daily_schedules(id) ON DELETE CASCADE,
      day TEXT NOT NULL,time TEXT NOT NULL,scheduled_at TEXT NOT NULL,UNIQUE(schedule_id,day,time));
      CREATE INDEX idx_schedule_rounds_day ON schedule_rounds(day);
    `);
    db.prepare("INSERT INTO schema_migrations(version) VALUES(6)").run();
  })();
}
