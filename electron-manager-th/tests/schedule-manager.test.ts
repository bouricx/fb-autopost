import { DatabaseSync } from "node:sqlite";
import type Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import { ScheduleManager } from "../electron/automation/schedule-manager";
afterEach(() => vi.useRealTimers());
it("materializes each daily round once, preserves history, and stops future jobs", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-18T01:00:00Z"));
  const sql = new DatabaseSync(":memory:");
  sql.exec(`CREATE TABLE accounts(id TEXT PRIMARY KEY,adapter_type TEXT); INSERT INTO accounts VALUES('11111111-1111-4111-8111-111111111111','facebook-browser');
    CREATE TABLE daily_schedules(id TEXT PRIMARY KEY,account_id TEXT,name TEXT,start_date TEXT,daily INTEGER,enabled INTEGER DEFAULT 1,times_json TEXT,payloads_json TEXT,created_at TEXT);
    CREATE TABLE schedule_rounds(id TEXT PRIMARY KEY,schedule_id TEXT,day TEXT,time TEXT,scheduled_at TEXT,UNIQUE(schedule_id,day,time));
     CREATE TABLE automation_tasks(id TEXT PRIMARY KEY,account_id TEXT,project_id TEXT,parent_id TEXT,action TEXT,status TEXT DEFAULT 'pending',payload_json TEXT,result_url TEXT,last_error TEXT,attempts INTEGER DEFAULT 0,max_attempts INTEGER DEFAULT 5,scheduled_at TEXT,created_at TEXT,updated_at TEXT);
     CREATE TABLE notification_channels(id TEXT PRIMARY KEY,account_id TEXT,project_id TEXT,type TEXT,enabled INTEGER,created_at TEXT);
     INSERT INTO notification_channels VALUES('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','discord',1,'2026-10-01T00:00:00Z');`);
  let serial = 0;
  sql.exec("ALTER TABLE automation_tasks ADD COLUMN idempotency_key TEXT; CREATE UNIQUE INDEX task_key ON automation_tasks(idempotency_key); ALTER TABLE automation_tasks ADD COLUMN submission_state TEXT DEFAULT 'not_sent'");
  const db = { prepare: (query: string) => sql.prepare(query), transaction: (work: () => unknown) => () => {
    const name = `s${serial++}`; sql.exec(`SAVEPOINT ${name}`);
    try { const result = work(); sql.exec(`RELEASE ${name}`); return result; } catch (error) { sql.exec(`ROLLBACK TO ${name};RELEASE ${name}`); throw error; }
  } } as unknown as Database.Database;
  try {
    const manager = new ScheduleManager(db);
    const id = manager.create({ accountId: "11111111-1111-4111-8111-111111111111", name: "ทุกวัน", startDate: "2026-10-18", daily: true, times: ["09:00", "16:00", "16:00"], payloads: [{ targetUrl: "https://www.facebook.com/groups/123", caption: "หลัก" }] });
    manager.materialize();
    expect(sql.prepare("SELECT id FROM schedule_rounds").all()).toHaveLength(2);
    expect(sql.prepare("SELECT DISTINCT project_id FROM automation_tasks").all()).toEqual([{ project_id: "33333333-3333-4333-8333-333333333333" }]);
    expect(sql.prepare("SELECT json_extract(payload_json,'$.channelId') AS id FROM automation_tasks LIMIT 1").get()).toEqual({ id: "22222222-2222-4222-8222-222222222222" });
    expect(manager.list()[0].todayTotal).toBe(2);
    sql.exec("UPDATE automation_tasks SET status='succeeded'");
    expect(manager.list()[0].succeeded).toBe(2);
    vi.setSystemTime(new Date("2026-10-19T01:00:00Z")); manager.materialize();
    expect(sql.prepare("SELECT COUNT(*) AS count FROM automation_tasks WHERE project_id=? AND json_extract(payload_json,'$.channelId')=?").get("33333333-3333-4333-8333-333333333333", "22222222-2222-4222-8222-222222222222")).toEqual({ count: 4 });
    expect(manager.list()[0].todayTotal).toBe(2); expect(manager.list()[0].totalSucceeded).toBe(2);
    manager.stop(id); expect(manager.list()[0].enabled).toBe(false);
    expect(sql.prepare("SELECT id FROM automation_tasks WHERE status='pending'").all()).toHaveLength(0);
    expect(() => manager.stop(id)).toThrow(/หยุดแล้ว/);
  } finally { sql.close(); }
});
it("does not accept today's fully elapsed daily schedule as an active plan", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-18T12:00:00Z"));
  const manager = new ScheduleManager({ prepare: () => ({ get: () => ({ adapter_type: "facebook-browser" }) }) } as unknown as Database.Database);
  expect(() => manager.create({ accountId: "11111111-1111-4111-8111-111111111111", name: "เลยเวลา", startDate: "2026-10-18", daily: true,
    times: ["08:00"], payloads: [{ targetUrl: "https://www.facebook.com/groups/123", caption: "หลัก" }] })).toThrow(/ผ่านไปแล้ว/);
});
it("stops overdue review-required rounds without deleting completed history", () => {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`CREATE TABLE daily_schedules(id TEXT PRIMARY KEY,enabled INTEGER); INSERT INTO daily_schedules VALUES('plan',1);
    CREATE TABLE automation_tasks(id TEXT PRIMARY KEY,parent_id TEXT,status TEXT,last_error TEXT,updated_at TEXT,payload_json TEXT);
    INSERT INTO automation_tasks VALUES('queued',NULL,'review_required',NULL,NULL,'{"scheduleId":"plan"}'),
      ('done',NULL,'succeeded',NULL,NULL,'{"scheduleId":"plan"}'),('child','queued','pending',NULL,NULL,'{}');`);
  let serial = 0;
  const db = { prepare: (query: string) => sql.prepare(query), transaction: (work: () => unknown) => () => {
    const name = `s${serial++}`; sql.exec(`SAVEPOINT ${name}`);
    try { const result = work(); sql.exec(`RELEASE ${name}`); return result; } catch (error) { sql.exec(`ROLLBACK TO ${name};RELEASE ${name}`); throw error; }
  } } as unknown as Database.Database;
  try {
    new ScheduleManager(db).stop("plan");
    expect(sql.prepare("SELECT id,status FROM automation_tasks ORDER BY id").all()).toEqual([
      { id: "child", status: "cancelled" }, { id: "done", status: "succeeded" }, { id: "queued", status: "cancelled" },
    ]);
  } finally { sql.close(); }
});
