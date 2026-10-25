import { DatabaseSync } from "node:sqlite";
import type Database from "better-sqlite3";
import { expect, it } from "vitest";
import { migrateFoundation } from "../electron/core/migrations/002-foundation";
import { migrateProjectWorkspaces } from "../electron/core/migrations/003-project-workspaces";
import { migrateAutomationTasks } from "../electron/core/migrations/004-automation-tasks";
import { migrateJobDelay } from "../electron/core/migrations/005-job-delay";
import { migrateDailySchedules } from "../electron/core/migrations/006-daily-schedules";
import { migrateQueueSafety } from "../electron/core/migrations/007-queue-safety";
import { migrateGroupPermissions } from "../electron/core/migrations/008-group-permissions";
import { migrateFacebookIdentity } from "../electron/core/migrations/009-facebook-identity";

it("migrates legacy rows without loss and is safe to repeat", () => {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY);
    CREATE TABLE accounts(id TEXT PRIMARY KEY,name TEXT,proxy_url TEXT);
    INSERT INTO accounts VALUES('legacy','บัญชีเดิม','http://localhost:8080');
    CREATE TABLE jobs(id TEXT PRIMARY KEY,account_id TEXT REFERENCES accounts(id),status TEXT DEFAULT 'pending',attempts INTEGER DEFAULT 0);
    INSERT INTO jobs(id,account_id) VALUES('job-old','legacy');`);
  const db = {
    prepare: (query: string) => sql.prepare(query), exec: (query: string) => sql.exec(query),
    transaction: (work: () => unknown) => () => {
      sql.exec("BEGIN");
      try { const result = work(); sql.exec("COMMIT"); return result; }
      catch (error) { sql.exec("ROLLBACK"); throw error; }
    },
  } as unknown as Database.Database;
  try {
    migrateFoundation(db); migrateProjectWorkspaces(db);
    migrateFoundation(db); migrateProjectWorkspaces(db);
    migrateAutomationTasks(db); migrateAutomationTasks(db);
    migrateJobDelay(db); migrateJobDelay(db);
    migrateDailySchedules(db); migrateDailySchedules(db);
    migrateQueueSafety(db); migrateQueueSafety(db);
    migrateGroupPermissions(db); migrateGroupPermissions(db);
    migrateFacebookIdentity(db); migrateFacebookIdentity(db);
    expect(sql.prepare("SELECT name,proxy_url,session_status,headless FROM accounts WHERE id='legacy'").get()).toMatchObject({ name: "บัญชีเดิม", proxy_url: "http://localhost:8080", session_status: "unknown", headless: 1 });
    expect(sql.prepare("SELECT id FROM jobs").all()).toHaveLength(1);
    expect(sql.prepare("SELECT * FROM schema_migrations").all()).toHaveLength(8);
    expect(sql.prepare("SELECT facebook_user_id,facebook_name,facebook_actor_type FROM accounts WHERE id='legacy'").get())
      .toMatchObject({ facebook_user_id: null, facebook_name: null, facebook_actor_type: "unknown" });
    expect(sql.prepare("SELECT post_permission,share_permission FROM facebook_groups").all()).toEqual([]);
    expect(sql.prepare("SELECT delay_min,delay_max FROM jobs WHERE id='job-old'").get()).toMatchObject({ delay_min: 30, delay_max: 90 });
    expect(sql.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally { sql.close(); }
});
