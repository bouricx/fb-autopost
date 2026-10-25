import { Notification } from "electron";
import type { Job } from "../../src/shared/types";
import { AdapterRegistry } from "../adapters/registry";
import { AppDatabase } from "./database";
import { AuthenticationError, errorMessage, ProfileBusyError, RateLimitError } from "./errors";
import { SecretVault } from "./secrets";
import { renderTemplate } from "./template";
import { ProgressBus } from "./progress-bus";
import { TaskManager } from "../automation/task-manager";
import { FacebookActions } from "../automation/facebook-actions";
import { FacebookBrowserAdapter } from "../adapters/facebook-browser";
import { ActionBlockedError, RetryableBeforeSubmitError, UncertainResultError, type AutomationTask } from "../automation/contracts";
import { ScheduleManager } from "../automation/schedule-manager";
import { NotificationManager } from "../notifications/notification-manager";
import { delayMilliseconds } from "../../src/shared/delay";
import { QueueSafety } from "./queue-safety";
import { canCreatePostFollowUps } from "../automation/workflow-gate";
import { updateGroupPermission } from "../automation/group-permissions";
import { FEATURES, assertActionEnabled } from "../../src/shared/features";
import { NetworkUnavailableError } from "./network-safety";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const notificationFailed = (result: { delivered: number; failed: number; missing: boolean } | undefined) => !result || (result.delivered === 0 && (result.failed > 0 || result.missing));

export class QueueEngine {
  private running = false;
  private loopPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private command = 0;
  private readonly activeAccounts = new Set<string>();
  private readonly activeWork = new Set<Promise<void>>();
  private track(work: Promise<void>) {
    const safe = work.catch(() => {
      try { this.database.log("error", "queue", "เกิดข้อผิดพลาดใน Worker กรุณาตรวจประวัติก่อนเริ่มใหม่"); }
      catch { /* Keep the worker promise handled even if logging fails. */ }
    });
    this.activeWork.add(safe);
    void safe.finally(() => this.activeWork.delete(safe));
  }

  constructor(
    private readonly database: AppDatabase,
    private readonly adapters: AdapterRegistry,
    private readonly vault: SecretVault,
    private readonly screenshotsDir: string,
    private readonly concurrency = 2,
    private readonly progress?: ProgressBus,
  ) {}

  start(): void | Promise<void> {
    const command = ++this.command;
    if (this.stopPromise) return this.stopPromise.then(() => { if (command === this.command) return this.start(); });
    if (this.running) return;
    this.running = true;
    this.database.recoverInterruptedJobs();
    new TaskManager(this.database.db).recover();
    const held = new QueueSafety(this.database.db).holdOverdue();
    if (held) this.database.log("warn", "queue", `พักคิวเลยเวลา ${held} รายการ รอผู้ใช้เลือกข้าม จัดเวลาใหม่ หรือส่งย้อนหลัง`);
    this.database.log("info", "queue", "เริ่มระบบคิว");
    this.loopPromise = this.loop().catch(() => {
      this.running = false;
      this.database.log("error", "queue", "ระบบคิวหยุดเพราะข้อผิดพลาด กรุณาตรวจฐานข้อมูลก่อนเริ่มใหม่");
      this.progress?.publish({ type: "worker.changed", message: "ระบบคิวหยุดเพราะข้อผิดพลาด" });
    });
    this.progress?.publish({ type: "worker.changed", message: "เริ่มระบบคิว" });
  }

  stop(): Promise<void> {
    this.command++;
    if (this.stopPromise) return this.stopPromise;
    this.running = false;
    this.stopPromise = (async () => {
      await this.loopPromise;
      await Promise.allSettled([...this.activeWork]);
      this.loopPromise = null;
      this.database.log("info", "queue", "หยุดระบบคิว");
      this.progress?.publish({ type: "worker.changed", message: "หยุดระบบคิว" });
    })().finally(() => { this.stopPromise = null; });
    return this.stopPromise;
  }

  status() { return { running: this.running }; }

  private async loop() {
    let heartbeat = Date.now();
    while (this.running) {
      if (Date.now() - heartbeat > 60_000) {
        new QueueSafety(this.database.db).holdOverdue();
        this.progress?.publish({ type: "worker.changed", message: "กลับจากพักเครื่อง พักคิวเลยเวลารอตรวจสอบ" });
      }
      heartbeat = Date.now();
      new ScheduleManager(this.database.db).materialize();
      const available = Math.max(0, this.concurrency - this.activeAccounts.size);
      if (available) {
        const candidates = this.database.claimDue(available * 3);
        const selected: Job[] = [];
        const reservedAccounts = new Set(this.activeAccounts);
        for (const job of candidates) {
          if (selected.length < available && !reservedAccounts.has(job.accountId)) {
            selected.push(job);
            reservedAccounts.add(job.accountId);
          } else {
            this.database.releaseUnstartedJob(job.id);
          }
        }
        for (const job of selected) this.track(this.execute(job));
      }
      const tasks = new TaskManager(this.database.db);
      while (this.activeAccounts.size < this.concurrency) {
        const task = tasks.due(this.activeAccounts);
        if (!task || !tasks.claim(task.id)) break;
        this.track(this.executeTask(task, tasks));
      }
      await sleep(1_000);
    }
  }

  private async execute(job: Job) {
    this.activeAccounts.add(job.accountId);
    let submitted = false;
    const attempt = job.attempts + 1;
    const attemptId = this.database.beginAttempt(job.id, attempt);
    this.progress?.publish({ type: "job.started", accountId: job.accountId, jobId: job.id, destinationId: job.destinationId, percent: 0, message: `กำลังโพสต์ ${job.destinationName}` });
    this.database.log("info", "publisher", `เริ่มโพสต์ ${job.destinationName} (ครั้งที่ ${attempt})`);
    try {
      const account = this.database.accountRecord(job.accountId);
      const destination = this.database.destination(job.destinationId);
      if (!account || !destination || destination.accountId !== job.accountId || !destination.enabled) throw new Error("ไม่พบบัญชีหรือปลายทางที่เปิดใช้งาน");
      if (account.status !== "active") throw new AuthenticationError("บัญชีถูกพักหรือต้องตรวจสอบ Session ก่อนเริ่มงาน");
      const adapter = this.adapters.get(account.adapterType);
      const result = await adapter.publish({
        account,
        destination,
        job: { ...job, caption: renderTemplate(job.caption) },
        secret: this.vault.decrypt(account.encryptedSecret),
        screenshotsDir: this.screenshotsDir,
        onSubmitting: () => { submitted = true; this.database.db.prepare("UPDATE jobs SET submission_state='unknown' WHERE id=?").run(job.id); },
        onRejected: () => { this.database.db.prepare("UPDATE jobs SET submission_state='not_sent' WHERE id=?").run(job.id); submitted = false; },
      });
      if (account.adapterType === "facebook-browser" && result.status === "pending_approval") {
        this.database.failJob(job, attemptId, "ส่งแล้ว แต่รอการอนุมัติจากกลุ่ม ไม่ถือว่าเผยแพร่สำเร็จ", null, result.screenshot);
        this.database.db.prepare("UPDATE jobs SET status='pending_approval',submission_state='sent' WHERE id=?").run(job.id);
        await new NotificationManager(this.database.db, this.vault).send(job.accountId, null, null,
          `${account.name}: ส่งโพสต์ไปยัง ${destination.name} แล้ว แต่รออนุมัติจากกลุ่ม ยังไม่ถือว่าเผยแพร่สำเร็จ`)
          .catch(() => this.database.log("warn", "notification", "แจ้งเตือนโพสต์รออนุมัติส่งไม่สำเร็จ"));
        return;
      }
      if (account.adapterType === "facebook-browser" && !canCreatePostFollowUps(result)) {
        throw new UncertainResultError("โพสต์ยังไม่ได้รับการยืนยัน published พร้อม permalink กรุณาตรวจ Facebook ก่อนส่งซ้ำ");
      }
      this.database.completeJob(job, attemptId, result.publishedUrl);
      this.database.db.prepare("UPDATE jobs SET submission_state='sent' WHERE id=? AND status='succeeded'").run(job.id);
      this.database.setAccountStatus(account.id, "active");
      this.database.log("info", account.name, `โพสต์สำเร็จ: ${destination.name}`, result);
      await new NotificationManager(this.database.db, this.vault).send(account.id, null, null, `${account.name}: โพสต์สำเร็จ ${destination.name}\n${result.publishedUrl || ""}`).catch(() => this.database.log("warn", "notification", "แจ้งเตือนล้มเหลว งานโพสต์ยังคงสำเร็จ"));
      this.progress?.publish({ type: "target.succeeded", accountId: job.accountId, jobId: job.id, destinationId: job.destinationId, percent: 100, message: `โพสต์สำเร็จ ${destination.name}` });
      this.notify("AutoPost สำเร็จ", `${account.name} → ${destination.name}`);
    } catch (error) {
      const message = errorMessage(error);
      const screenshot = error && typeof error === "object" && "screenshot" in error ? String(error.screenshot) : undefined;
      const retryMs = error instanceof RateLimitError
        ? error.retryAfterMs
        : Math.min(60 * 60_000, 60_000 * 2 ** job.attempts) + Math.floor(Math.random() * 15_000);
      const retryAt = new Date(Date.now() + retryMs).toISOString();
      this.database.failJob(job, attemptId, message, !submitted && (error instanceof RetryableBeforeSubmitError || error instanceof RateLimitError) ? retryAt : null, screenshot);
      if (submitted || error instanceof UncertainResultError) this.database.db.prepare("UPDATE jobs SET status='uncertain',submission_state='unknown' WHERE id=?").run(job.id);
      if (error instanceof AuthenticationError) this.database.setAccountStatus(job.accountId, "needs_login");
      if (error instanceof RateLimitError) this.database.db.prepare("UPDATE accounts SET cooldown_until=? WHERE id=?").run(retryAt, job.accountId);
      if (error instanceof NetworkUnavailableError) {
        this.database.setAccountStatus(job.accountId, "paused");
        new QueueSafety(this.database.db).holdOverdue();
        this.database.db.prepare("UPDATE accounts SET status_message=? WHERE id=?").run(error.message, job.accountId);
      }
       this.database.log("error", job.accountName, `โพสต์ไม่สำเร็จ: ${message}`, { retryAt, screenshot });
       const delivery = await new NotificationManager(this.database.db, this.vault).send(job.accountId, null, null,
         `${job.accountName}: โพสต์ไม่สำเร็จ ${job.destinationName}\nเหตุผล: ${message}${error instanceof UncertainResultError ? "\nผลไม่แน่ชัด กรุณาตรวจบน Facebook ก่อนส่งซ้ำ" : ""}`)
         .catch(() => { this.database.log("warn", "notification", "แจ้งเตือนงานโพสต์ล้มเหลวส่งไม่สำเร็จ"); return undefined; });
       const notice = notificationFailed(delivery) ? `${message} · Discord ไม่ได้รับแจ้ง` : message;
       this.progress?.publish({ type: "target.failed", accountId: job.accountId, jobId: job.id, destinationId: job.destinationId, message: notice });
       this.notify("AutoPost ไม่สำเร็จ", `${job.destinationName}: ${notice}`);
    } finally {
      const delay = delayMilliseconds(job.delayMin ?? 30, job.delayMax ?? 90);
      const until = new Date(Date.now() + delay).toISOString();
      this.database.db.prepare("UPDATE accounts SET cooldown_until=CASE WHEN cooldown_until>? THEN cooldown_until ELSE ? END WHERE id=?").run(until, until, job.accountId);
      this.activeAccounts.delete(job.accountId);
      this.progress?.publish({ type: "job.completed", accountId: job.accountId, jobId: job.id, destinationId: job.destinationId, message: "จบการทำงานรอบนี้" });
    }
  }

  private notify(title: string, body: string) {
    try { if (Notification.isSupported()) new Notification({ title, body }).show(); }
    catch { this.database.log("warn", "notification", "แจ้งเตือน Desktop ไม่สำเร็จ ผลงานยังคงเดิม"); }
  }

  private async executeTask(task: AutomationTask, tasks: TaskManager) {
    this.activeAccounts.add(task.accountId);
    let submitted = false;
    const emit = (type: "job.started" | "target.progress" | "target.succeeded" | "target.failed" | "job.completed", message: string, percent?: number) =>
      this.progress?.publish({ type, accountId: task.accountId, jobId: task.id, message, percent });
    emit("job.started", `เริ่มงาน ${task.action}`, 0);
    try {
      const account = this.database.accountRecord(task.accountId);
      if (!account || account.status !== "active") throw new AuthenticationError("บัญชียังไม่พร้อมทำงาน");
      const adapter = this.adapters.get("facebook-browser");
      if (!(adapter instanceof FacebookBrowserAdapter)) throw new Error("ไม่พบ Facebook adapter");
      let result: { status: "published" | "pending_approval"; url: string; message: string };
      if (task.action !== "post") assertActionEnabled(task.action);
      if (task.action === "post") {
        const destination = this.database.listDestinations(account.id).find(row => row.url === task.payload.targetUrl);
        if (!destination) throw new ActionBlockedError("ไม่พบปลายทางโพสต์ในบัญชีนี้");
        const job: Job = { id: task.id, accountId: account.id, destinationId: destination.id, accountName: account.name, destinationName: destination.name,
          caption: renderTemplate(task.payload.caption), media: task.payload.media, runAt: task.scheduledAt, recurrence: null, priority: 0,
          status: "running", attempts: task.attempts, maxAttempts: 1, nextAttemptAt: task.scheduledAt, lastError: null, publishedUrl: null };
        const published = await adapter.publish({ account: { ...account, headless: task.payload.headless === null ? account.headless : Number(task.payload.headless) },
          destination, job, secret: null, screenshotsDir: this.screenshotsDir,
          requirePermalink: true,
          onSubmitting: () => { submitted = true; this.database.db.prepare("UPDATE automation_tasks SET submission_state='unknown' WHERE id=?").run(task.id); } });
        if (published.status === "pending_approval") {
          tasks.finish(task, "pending_approval", published.message || "ส่งแล้ว แต่รอการอนุมัติจากกลุ่ม", task.payload.targetUrl);
          this.database.db.prepare("UPDATE automation_tasks SET submission_state='sent' WHERE id=?").run(task.id);
          if (FEATURES.groupPermissionCheck) updateGroupPermission(this.database.db, task.accountId, task.payload.targetUrl, "post", "allowed", "Facebook รับโพสต์แล้วและแจ้งรออนุมัติ");
          emit("target.succeeded", "ส่งโพสต์แล้ว แต่รอการอนุมัติ — ไม่สร้าง Comment/Share/Like", 100);
          await new NotificationManager(this.database.db, this.vault).send(task.accountId, task.projectId, task.payload.channelId,
            `${account.name}: ส่งโพสต์แล้ว แต่รออนุมัติจากกลุ่ม ${destination.name} ยังไม่ถือว่าเผยแพร่สำเร็จ`)
            .catch(() => this.database.log("warn", "notification", "แจ้งเตือนโพสต์รออนุมัติส่งไม่สำเร็จ"));
          return;
        }
        if (!canCreatePostFollowUps(published)) {
          throw new UncertainResultError("โพสต์ยังไม่ได้รับการยืนยัน published พร้อม permalink — หยุดขั้นตอนถัดไป");
        }
        result = { status: "published", url: published.permalink!, message: "published — ยืนยันโพสต์และ permalink แล้ว" };
        if (FEATURES.groupPermissionCheck) updateGroupPermission(this.database.db, task.accountId, task.payload.targetUrl, "post", "allowed", "ยืนยัน published พร้อม permalink แล้ว");
      } else result = await new FacebookActions(adapter, this.screenshotsDir).execute(task.action, account, task.payload,
        (message, percent) => emit("target.progress", message, percent), () => { submitted = true; this.database.db.prepare("UPDATE automation_tasks SET submission_state='unknown' WHERE id=?").run(task.id); });
      if (result.status === "pending_approval") {
        tasks.finish(task, "pending_approval", result.message, result.url);
        this.database.db.prepare("UPDATE automation_tasks SET submission_state='sent' WHERE id=?").run(task.id);
        if (FEATURES.groupPermissionCheck && task.action === "share") updateGroupPermission(this.database.db, task.accountId, task.payload.targetUrl, "share", "allowed", result.message);
        emit("target.succeeded", `${result.message} — หยุดขั้นตอนถัดไป`, 100);
        return;
      }
      this.database.db.transaction(() => {
        tasks.finish(task, "succeeded", result.message, result.url);
        tasks.followUps(task, result.url);
        this.database.db.prepare("UPDATE automation_tasks SET submission_state='sent' WHERE id=?").run(task.id);
      })();
      emit("target.succeeded", result.message, 100);
      await new NotificationManager(this.database.db, this.vault).send(task.accountId, task.projectId, task.payload.channelId, `${account.name}: ${result.message}\n${result.url}`).catch(() => this.database.log("warn", "notification", "แจ้งเตือนล้มเหลว ผลงานยังคงเดิม"));
    } catch (error) {
      const message = error instanceof AuthenticationError || error instanceof ActionBlockedError || error instanceof UncertainResultError || error instanceof ProfileBusyError || error instanceof RetryableBeforeSubmitError || error instanceof NetworkUnavailableError
        ? error.message : "งานไม่สำเร็จ กรุณาตรวจ Session และเครือข่าย";
      const retrying = !submitted && error instanceof RetryableBeforeSubmitError && tasks.retryBeforeSubmit(task, message);
      if (!retrying) tasks.finish(task, submitted || error instanceof UncertainResultError ? "uncertain" : "failed", submitted && !(error instanceof UncertainResultError) ? `${message} · ส่งคำสั่งแล้ว ห้ามส่งซ้ำก่อนตรวจ Facebook` : message);
      if (error instanceof AuthenticationError) this.database.setAccountStatus(task.accountId, "needs_login");
      if (error instanceof NetworkUnavailableError) {
        this.database.setAccountStatus(task.accountId, "paused");
        new QueueSafety(this.database.db).holdOverdue();
        this.database.db.prepare("UPDATE accounts SET status_message=? WHERE id=?").run(error.message, task.accountId);
      }
      if (FEATURES.groupPermissionCheck && error instanceof ActionBlockedError && /ไม่มีสิทธิ์|ไม่อนุญาต|ปิดความคิดเห็น|ไม่มีปุ่มแชร์/.test(message)) {
        if (task.action === "post") updateGroupPermission(this.database.db, task.accountId, task.payload.targetUrl, "post", "denied", message);
        if (task.action === "share") updateGroupPermission(this.database.db, task.accountId, task.payload.targetUrl, "share", "denied", message);
      }
       emit("target.failed", retrying ? `${message} · จะลองใหม่ ${task.attempts + 1}/${task.maxAttempts || 5}` : message);
       this.database.log("error", "publisher", `${task.action} ไม่สำเร็จ: ${message}`, { taskId: task.id, submitted });
       const delivery = await new NotificationManager(this.database.db, this.vault).send(task.accountId, task.projectId, task.payload.channelId,
         `${task.action}: ${message}\nกลุ่ม: ${task.payload.targetUrl}${submitted || error instanceof UncertainResultError ? "\nผลไม่แน่ชัด กรุณาตรวจบน Facebook ก่อนส่งซ้ำ" : ""}`)
         .catch(() => { this.database.log("warn", "notification", "แจ้งเตือนงานล้มเหลวส่งไม่สำเร็จ"); return undefined; });
       if (notificationFailed(delivery)) emit("target.failed", `ส่ง Discord ไม่สำเร็จ — ${message}`);
       this.notify("AutoPost ไม่สำเร็จ", `${task.action}: ${message}${notificationFailed(delivery) ? " (Discord ไม่ได้รับแจ้ง)" : ""}`);
    } finally {
      this.activeAccounts.delete(task.accountId);
      emit("job.completed", "จบการทำงาน");
    }
  }
}
