import Database from "better-sqlite3";
import { migrateProjectWorkspaces } from "./migrations/003-project-workspaces";
import { migrateAutomationTasks } from "./migrations/004-automation-tasks";
import { migrateJobDelay } from "./migrations/005-job-delay";
import { migrateDailySchedules } from "./migrations/006-daily-schedules";
import { migrateQueueSafety } from "./migrations/007-queue-safety";
import { idempotencyKey } from "./queue-safety";
import { validateDelay } from "../../src/shared/delay";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  Account,
  CreateAccountInput,
  CreateDestinationInput,
  CreateJobInput,
  Dashboard,
  Destination,
  Job,
  LogEntry,
} from "../../src/shared/types";

const now = () => new Date().toISOString();
const bool = (value: unknown) => Boolean(value);

export class AppDatabase {
  readonly db: Database.Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    if (this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='schema_migrations'").get() && !this.db.prepare("SELECT 1 FROM schema_migrations WHERE version=7").get()) {
      this.db.prepare("VACUUM INTO ?").run(`${path}.before-queue-safety-${Date.now()}.bak`);
    }
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS workspaces(
        id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS users(
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        display_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','admin','editor','viewer')),
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS accounts(
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        name TEXT NOT NULL, platform TEXT NOT NULL, adapter_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active', encrypted_secret TEXT,
        browser_profile_path TEXT, proxy_url TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS destinations(
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        kind TEXT NOT NULL, name TEXT NOT NULL, remote_id TEXT, url TEXT,
        enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS content_items(
        id TEXT PRIMARY KEY, caption TEXT NOT NULL, media_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS jobs(
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        destination_id TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
        content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
        run_at TEXT NOT NULL, recurrence TEXT, priority INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5, next_attempt_at TEXT NOT NULL,
        last_error TEXT, published_url TEXT, locked_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs(status,next_attempt_at,priority);
      CREATE TABLE IF NOT EXISTS post_attempts(
        id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        attempt INTEGER NOT NULL, status TEXT NOT NULL, error TEXT, screenshot_path TEXT,
        started_at TEXT NOT NULL, finished_at TEXT
      );
      CREATE TABLE IF NOT EXISTS event_logs(
        id INTEGER PRIMARY KEY AUTOINCREMENT, level TEXT NOT NULL, scope TEXT NOT NULL,
        message TEXT NOT NULL, metadata_json TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
    `);
    migrateFoundation(this.db);
    migrateProjectWorkspaces(this.db);
    migrateAutomationTasks(this.db);
    migrateJobDelay(this.db);
    migrateDailySchedules(this.db);
    migrateQueueSafety(this.db);
    const workspace = this.db.prepare("SELECT id FROM workspaces LIMIT 1").get() as { id: string } | undefined;
    if (!workspace) {
      const workspaceId = randomUUID();
      this.db.prepare("INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)").run(workspaceId, "พื้นที่ส่วนตัว", now());
      this.db.prepare("INSERT INTO users(id,workspace_id,display_name,role,created_at) VALUES(?,?,?,?,?)")
        .run(randomUUID(), workspaceId, "เจ้าของ", "owner", now());
    }
  }

  workspaceId(): string {
    return (this.db.prepare("SELECT id FROM workspaces ORDER BY created_at LIMIT 1").get() as { id: string }).id;
  }

  listAccounts(): Account[] {
    return (this.db.prepare(`SELECT id,name,platform,adapter_type AS adapterType,status,
      browser_profile_path AS browserProfilePath,proxy_url AS proxyUrl,
      session_status AS sessionStatus,status_message AS statusMessage,last_checked_at AS lastCheckedAt,headless,
      created_at AS createdAt,updated_at AS updatedAt FROM accounts ORDER BY created_at`).all()) as Account[];
  }

  accountRecord(id: string): (Account & { encryptedSecret: string | null }) | undefined {
    return this.db.prepare(`SELECT id,name,platform,adapter_type AS adapterType,status,
      encrypted_secret AS encryptedSecret,browser_profile_path AS browserProfilePath,
      session_status AS sessionStatus,status_message AS statusMessage,last_checked_at AS lastCheckedAt,
      CASE WHEN encrypted_cookies IS NULL THEN 0 ELSE headless END AS headless,
      CASE WHEN cookie_format IS NULL THEN 0 ELSE 1 END AS cookieManaged,
      proxy_url AS proxyUrl,created_at AS createdAt,updated_at AS updatedAt FROM accounts WHERE id=?`).get(id) as
      | (Account & { encryptedSecret: string | null })
      | undefined;
  }

  createAccount(input: CreateAccountInput, encryptedSecret: string | null, profilePath: string | null): Account {
    const id = randomUUID();
    const timestamp = now();
    const platform = input.adapterType.startsWith("facebook") ? "facebook" : "discord";
    const status = platform === "facebook" ? "needs_login" : "active";
    this.db.prepare(`INSERT INTO accounts(id,workspace_id,name,platform,adapter_type,status,encrypted_secret,
      browser_profile_path,proxy_url,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, this.workspaceId(), input.name.trim(), platform, input.adapterType, status, encryptedSecret,
        profilePath, input.proxyUrl?.trim() || null, timestamp, timestamp);
    return this.accountRecord(id)!;
  }

  setAccountStatus(id: string, status: Account["status"]) {
    this.db.prepare("UPDATE accounts SET status=?,updated_at=? WHERE id=?").run(status, now(), id);
  }

  deleteAccount(id: string) { this.db.prepare("DELETE FROM accounts WHERE id=?").run(id); }

  sessionRecord(id: string) {
    return this.db.prepare(`SELECT encrypted_cookies AS encryptedCookies,headless,session_status AS sessionStatus FROM accounts WHERE id=?`)
      .get(id) as { encryptedCookies: string | null; headless: number; sessionStatus: string } | undefined;
  }

  saveSession(id: string, encrypted: string, format: string, status: string, message: string, checkedAt: string) {
    this.db.transaction(() => {
      this.db.prepare(`UPDATE accounts SET encrypted_cookies=?,cookie_format=?,session_status=?,status_message=?,last_checked_at=?,
        status=?,updated_at=? WHERE id=?`).run(encrypted, format, status, message, checkedAt, status === "online" ? "active" : "needs_login", now(), id);
    })();
  }

  updateSessionStatus(id: string, status: string, message: string, checkedAt: string) {
    this.db.prepare(`UPDATE accounts SET session_status=?,status_message=?,last_checked_at=?,status=?,updated_at=? WHERE id=?`)
      .run(status, message, checkedAt, status === "online" ? "active" : "needs_login", now(), id);
  }

  setHeadless(id: string, enabled: boolean) {
    this.db.prepare("UPDATE accounts SET headless=?,updated_at=? WHERE id=?").run(enabled ? 1 : 0, now(), id);
  }

  hasRunningJobs(id: string): boolean {
    if (this.db.prepare("SELECT 1 FROM automation_tasks WHERE account_id=? AND status='running' LIMIT 1").get(id)) return true;
    return !!this.db.prepare("SELECT 1 FROM jobs WHERE account_id=? AND status='running' LIMIT 1").get(id);
  }

  listDestinations(accountId?: string): Destination[] {
    const sql = `SELECT id,account_id AS accountId,kind,name,remote_id AS remoteId,url,enabled FROM destinations`;
    const rows = accountId
      ? this.db.prepare(sql + " WHERE account_id=? ORDER BY created_at").all(accountId)
      : this.db.prepare(sql + " ORDER BY created_at").all();
    return (rows as Array<Omit<Destination, "enabled"> & { enabled: number }>).map((row) => ({ ...row, enabled: bool(row.enabled) }));
  }

  destination(id: string): Destination | undefined {
    const row = this.db.prepare(`SELECT id,account_id AS accountId,kind,name,remote_id AS remoteId,url,enabled
      FROM destinations WHERE id=?`).get(id) as (Omit<Destination, "enabled"> & { enabled: number }) | undefined;
    return row ? { ...row, enabled: bool(row.enabled) } : undefined;
  }

  createDestination(input: CreateDestinationInput): Destination {
    const existing = this.db.prepare(`SELECT id FROM destinations WHERE account_id=? AND
      ((url IS NOT NULL AND url=?) OR (remote_id IS NOT NULL AND remote_id=?)) LIMIT 1`)
      .get(input.accountId, input.url?.trim() || null, input.remoteId?.trim() || null) as { id: string } | undefined;
    if (existing) return this.destination(existing.id)!;
    const id = randomUUID();
    this.db.prepare(`INSERT INTO destinations(id,account_id,kind,name,remote_id,url,created_at)
      VALUES(?,?,?,?,?,?,?)`).run(id, input.accountId, input.kind, input.name.trim(), input.remoteId?.trim() || null,
      input.url?.trim() || null, now());
    return this.destination(id)!;
  }

  deleteDestination(id: string) { this.db.prepare("DELETE FROM destinations WHERE id=?").run(id); }

  private jobSelect = `SELECT j.id,j.account_id AS accountId,j.destination_id AS destinationId,
    a.name AS accountName,d.name AS destinationName,c.caption,c.media_json AS mediaJson,
    j.run_at AS runAt,j.recurrence,j.priority,j.status,j.submission_state AS submissionState,j.attempts,j.max_attempts AS maxAttempts,j.delay_min AS delayMin,j.delay_max AS delayMax,
    j.next_attempt_at AS nextAttemptAt,j.last_error AS lastError,j.published_url AS publishedUrl
    FROM jobs j JOIN accounts a ON a.id=j.account_id JOIN destinations d ON d.id=j.destination_id
    JOIN content_items c ON c.id=j.content_id`;

  private mapJob(row: Record<string, unknown>): Job {
    const { mediaJson, ...rest } = row;
    return { ...rest, media: JSON.parse(String(mediaJson)) } as unknown as Job;
  }

  listJobs(limit = 200): Job[] {
    return (this.db.prepare(this.jobSelect + " ORDER BY j.created_at DESC LIMIT ?").all(limit) as Record<string, unknown>[]).map((r) => this.mapJob(r));
  }

  job(id: string): Job | undefined {
    const row = this.db.prepare(this.jobSelect + " WHERE j.id=?").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapJob(row) : undefined;
  }

  createJobs(input: CreateJobInput): Job[] {
    const delayError = validateDelay(input.delayMin ?? 30, input.delayMax ?? 90);
    if (delayError) throw new Error(delayError);
    const create = this.db.transaction(() => {
      const contentId = randomUUID();
      this.db.prepare("INSERT INTO content_items(id,caption,media_json,created_at) VALUES(?,?,?,?)")
        .run(contentId, input.caption, JSON.stringify(input.media), now());
      const ids: string[] = [];
      for (const destinationId of input.destinationIds) {
        const destination = this.destination(destinationId);
        if (!destination || destination.accountId !== input.accountId) throw new Error("ปลายทางไม่ตรงกับบัญชี");
        const key = idempotencyKey(["post", input.accountId, destinationId, input.runAt, input.caption, input.media, input.recurrence || null]);
        const existing = this.db.prepare("SELECT id FROM jobs WHERE idempotency_key=?").get(key) as { id: string } | undefined;
        if (existing) { ids.push(existing.id); continue; }
        const id = randomUUID();
        const timestamp = now();
        this.db.prepare(`INSERT INTO jobs(id,account_id,destination_id,content_id,run_at,recurrence,priority,status,
          max_attempts,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(id, input.accountId, destinationId, contentId, input.runAt, input.recurrence || null,
            input.priority ?? 0, "pending", input.maxAttempts ?? 5, input.runAt, timestamp, timestamp);
        ids.push(id);
        this.db.prepare("UPDATE jobs SET delay_min=?,delay_max=? WHERE id=?").run(input.delayMin ?? 30, input.delayMax ?? 90, id);
        this.db.prepare("UPDATE jobs SET idempotency_key=? WHERE id=?").run(key, id);
      }
      return ids;
    });
    return create().map((id) => this.job(id)!);
  }

  claimDue(limit: number): Job[] {
    const claim = this.db.transaction(() => {
      const rows = this.db.prepare(`SELECT j.id FROM jobs j JOIN accounts a ON a.id=j.account_id WHERE j.status='pending' AND j.next_attempt_at<=?
        AND (a.cooldown_until IS NULL OR a.cooldown_until<=?) ORDER BY j.priority DESC,j.next_attempt_at ASC LIMIT ?`).all(now(), now(), limit) as { id: string }[];
      for (const row of rows) this.db.prepare("UPDATE jobs SET status='running',locked_at=?,updated_at=? WHERE id=? AND status='pending'")
        .run(now(), now(), row.id);
      return rows.map((r) => r.id);
    });
    return claim().map((id) => this.job(id)!).filter(Boolean);
  }

  beginAttempt(jobId: string, attempt: number): number {
    return Number(this.db.prepare("INSERT INTO post_attempts(job_id,attempt,status,started_at) VALUES(?,?,?,?)")
      .run(jobId, attempt, "running", now()).lastInsertRowid);
  }

  completeJob(job: Job, attemptId: number, publishedUrl?: string) {
    const tx = this.db.transaction(() => {
      this.db.prepare("UPDATE post_attempts SET status='succeeded',finished_at=? WHERE id=?").run(now(), attemptId);
      this.db.prepare("UPDATE jobs SET status='succeeded',attempts=attempts+1,published_url=?,last_error=NULL,updated_at=? WHERE id=?")
        .run(publishedUrl || null, now(), job.id);
      if (job.recurrence) {
        const next = new Date(job.runAt);
        next.setUTCDate(next.getUTCDate() + (job.recurrence === "weekly" ? 7 : 1));
        this.db.prepare(`UPDATE jobs SET status='pending',run_at=?,next_attempt_at=?,attempts=0,published_url=NULL,submission_state='not_sent',overdue_approved=0,updated_at=? WHERE id=?`)
          .run(next.toISOString(), next.toISOString(), now(), job.id);
      }
    });
    tx();
  }

  failJob(job: Job, attemptId: number, error: string, retryAt: string | null, screenshot?: string) {
    const nextAttempts = job.attempts + 1;
    const status = retryAt && nextAttempts < job.maxAttempts ? "pending" : "failed";
    const tx = this.db.transaction(() => {
      this.db.prepare("UPDATE post_attempts SET status='failed',error=?,screenshot_path=?,finished_at=? WHERE id=?")
        .run(error, screenshot || null, now(), attemptId);
      this.db.prepare("UPDATE jobs SET status=?,attempts=?,next_attempt_at=COALESCE(?,next_attempt_at),last_error=?,updated_at=? WHERE id=?")
        .run(status, nextAttempts, retryAt, error, now(), job.id);
    });
    tx();
  }

  retryJob(id: string) {
    const row = this.db.prepare("SELECT status,submission_state AS state FROM jobs WHERE id=?").get(id) as { status: string; state: string } | undefined;
    if (!row || row.status !== "failed" || row.state !== "not_sent") throw new Error("งานนี้ไม่อยู่ในสถานะที่ปลอดภัยสำหรับลองใหม่ ต้องตรวจผลบน Facebook ก่อน");
    this.db.prepare("UPDATE jobs SET status='pending',next_attempt_at=?,last_error=NULL,updated_at=?,overdue_approved=1 WHERE id=? AND status='failed'").run(now(), now(), id);
  }

  releaseUnstartedJob(id: string) { this.db.prepare("UPDATE jobs SET status='pending',locked_at=NULL WHERE id=? AND status='running' AND submission_state='not_sent'").run(id); }

  cancelJob(id: string) {
    this.db.prepare("UPDATE jobs SET status='cancelled',updated_at=? WHERE id=? AND status IN ('pending','failed')").run(now(), id);
  }

  log(level: LogEntry["level"], scope: string, message: string, metadata?: unknown) {
    this.db.prepare("INSERT INTO event_logs(level,scope,message,metadata_json,created_at) VALUES(?,?,?,?,?)")
      .run(level, scope, message, metadata ? JSON.stringify(metadata) : null, now());
  }

  listLogs(limit = 500): LogEntry[] {
    return this.db.prepare(`SELECT id,level,scope,message,created_at AS createdAt FROM event_logs
      ORDER BY id DESC LIMIT ?`).all(limit) as LogEntry[];
  }

  dashboard(): Dashboard {
    const counts = this.db.prepare(`SELECT status,COUNT(*) count FROM (
      SELECT status FROM jobs UNION ALL SELECT CASE WHEN status='uncertain' THEN 'failed' ELSE status END AS status FROM automation_tasks
    ) GROUP BY status`).all() as { status: string; count: number }[];
    const map = Object.fromEntries(counts.map((x) => [x.status, x.count]));
    const succeeded = map.succeeded || 0;
    const failed = map.failed || 0;
    return {
      nextScheduledAt: (this.db.prepare(`SELECT MIN(scheduled) AS scheduled FROM (
        SELECT next_attempt_at AS scheduled FROM jobs WHERE status='pending'
        UNION ALL SELECT scheduled_at AS scheduled FROM automation_tasks WHERE status='pending'
      )`).get() as { scheduled: string | null }).scheduled,
      pending: map.pending || 0,
      running: map.running || 0,
      succeeded,
      failed,
      successRate: succeeded + failed ? Math.round((succeeded / (succeeded + failed)) * 1000) / 10 : 0,
      accounts: Number((this.db.prepare("SELECT COUNT(*) count FROM accounts").get() as { count: number }).count),
      nextJobs: (this.db.prepare(this.jobSelect + " WHERE j.status='pending' ORDER BY j.next_attempt_at LIMIT 8").all() as Record<string, unknown>[]).map((r) => this.mapJob(r)),
    };
  }

  recoverInterruptedJobs() {
    this.db.prepare("UPDATE jobs SET status='uncertain',submission_state='unknown',last_error='โปรแกรมปิดระหว่างทำงาน ต้องตรวจผลบน Facebook ก่อนเริ่มใหม่',updated_at=? WHERE status='running'")
      .run(now());
  }

  close() { this.db.close(); }
}
import { migrateFoundation } from "./migrations/002-foundation";
