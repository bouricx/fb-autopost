import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Tray, shell, protocol, net } from "electron";
import { pathToFileURL } from "node:url";
import { readFile, writeFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { ProjectManager, workspaceSchema } from "./projects/project-manager";
import { TaskManager } from "./automation/task-manager";
import { QueueSafety } from "./core/queue-safety";
import { ScheduleManager } from "./automation/schedule-manager";
import { mainPostContent } from "../src/shared/post-content";
import { FEATURES, assertActionEnabled } from "../src/shared/features";
import { cancelPendingQueueItems, deletePendingQueueItems, deleteQueueItem } from "./core/queue-management";
import { actionPayloadSchema } from "./automation/contracts";
import { NotificationManager } from "./notifications/notification-manager";
import { ProgressBus } from "./core/progress-bus";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { z } from "zod";
import { AppDatabase } from "./core/database";
import { SecretVault } from "./core/secrets";
import { AdapterRegistry } from "./adapters/registry";
import { QueueEngine } from "./core/queue";
import { AccountManager } from "./accounts/account-manager";
import { SessionChecker } from "./accounts/session-checker";
import { parseCookies } from "./accounts/cookie-parser";
import { FacebookBrowserAdapter } from "./adapters/facebook-browser";
import type { CreateAccountInput, CreateDestinationInput, CreateJobInput } from "../src/shared/types";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let database: AppDatabase;
let vault: SecretVault;
let adapters: AdapterRegistry;
let queue: QueueEngine;
let quitting = false;
const progressBus = new ProgressBus();
const previewFiles = new Map<string, string>();
protocol.registerSchemesAsPrivileged([{ scheme: "velt-media", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
progressBus.subscribe(event => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("automation:progress", event);
});
const sessionTestMode = process.env.AUTOPOST_SESSION_TEST === "1";
if (sessionTestMode) app.setPath("userData", join(app.getPath("appData"), "autopost-manager-th-session-test"));
const ownsAppInstance = app.requestSingleInstanceLock();
if (!ownsAppInstance) app.quit();
app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus();
});

const accountSchema = z.object({
  name: z.string().trim().min(1).max(80),
  adapterType: z.enum(["facebook-browser", "discord-webhook", "discord-bot"]),
  secret: z.string().optional(),
  proxyUrl: z.string().optional(),
});
const destinationSchema = z.object({
  accountId: z.string().uuid(),
  kind: z.enum(["facebook_group", "facebook_page", "facebook_profile", "discord_channel", "discord_webhook"]),
  name: z.string().trim().min(1).max(100),
  remoteId: z.string().optional(),
  url: z.string().optional(),
});
const jobSchema = z.object({
  accountId: z.string().uuid(),
  destinationIds: z.array(z.string().uuid()).min(1),
  caption: z.string().max(10000),
  media: z.array(z.string()).max(10),
  runAt: z.string().datetime(),
  recurrence: z.enum(["daily", "weekly"]).nullable().optional(),
  priority: z.number().int().min(-10).max(10).optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
  delayMin: z.number().int().min(0).max(86400).optional(),
  delayMax: z.number().int().min(0).max(86400).optional(),
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 700,
    backgroundColor: "#080b12",
    title: `AutoPost Manager TH ${app.getVersion()}${sessionTestMode ? " — ทดสอบ Cookie (คิวปิด)" : ""}`,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.removeMenu();
  mainWindow.on("page-title-updated", event => event.preventDefault());
  if (process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  mainWindow.on("close", (event) => {
    if (!quitting) { event.preventDefault(); mainWindow?.hide(); }
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(join(app.getAppPath(), "resources", "icon.png")).resize({ width: 20, height: 20 });
  tray = new Tray(icon);
  tray.setToolTip("AutoPost Manager TH");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "เปิดโปรแกรม", click: () => mainWindow?.show() },
    { type: "separator" },
    { label: "ออก", click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on("double-click", () => mainWindow?.show());
}

function registerIpc(profilesDir: string) {
  const safety = new QueueSafety(database.db);
  ipcMain.handle("queue:overdue", () => safety.list());
  ipcMain.handle("queue:resolve-overdue", async (_event, raw: unknown) => {
    const data = z.object({ items: z.array(z.object({ kind: z.enum(["post", "workflow"]), id: z.string().uuid() })).min(1).max(500), decision: z.enum(["skip", "reschedule", "send"]), at: z.string().datetime().optional() }).parse(raw);
    if (data.decision === "send") {
      const result = await dialog.showMessageBox({ type: "warning", buttons: ["ยกเลิก", "ยืนยันส่งย้อนหลัง"], defaultId: 0, cancelId: 0,
        message: `ส่งงานเลยเวลา ${data.items.length} รายการตามเนื้อหาที่บันทึกไว้?`, detail: "คำสั่งนี้อนุญาตให้เริ่มส่งเมื่อเปิดระบบคิว โปรดตรวจเนื้อหาและกลุ่มก่อนยืนยัน" });
      if (result.response !== 1) return false;
    }
    safety.resolve(data.items, data.decision, data.at);
    progressBus.publish({ type: "worker.changed", message: "อัปเดตคิวเลยเวลาตามการตัดสินใจแล้ว" }); return true;
  });
  const schedules = new ScheduleManager(database.db);
  ipcMain.handle("schedules:list", () => schedules.list());
  ipcMain.handle("schedules:create", (_event, input: unknown) => {
    if (sessionTestMode) throw new Error("โหมดทดสอบ Cookie ไม่อนุญาตสร้างตารางโพสต์");
    const id = schedules.create(input);
    progressBus.publish({ type: "worker.changed", message: "สร้างตารางโพสต์หลายรอบแล้ว" }); return id;
  });
  ipcMain.handle("schedules:stop", (_event, id: unknown) => {
    const scheduleId = z.string().uuid().parse(id);
    const accountId = (database.db.prepare("SELECT account_id AS accountId FROM daily_schedules WHERE id=?").get(scheduleId) as { accountId: string } | undefined)?.accountId;
    schedules.stop(scheduleId);
    progressBus.publish({ type: "worker.changed", accountId, message: "หยุดตารางและยกเลิกรอบที่รอแล้ว" });
  });
  ipcMain.handle("accounts:delete-group", async (_event, accountInput: unknown, groupInput: unknown) => {
    const accountId = z.string().uuid().parse(accountInput);
    const groupId = z.string().regex(/^[\w.-]+$/).max(200).parse(groupInput);
    if (!database.accountRecord(accountId)) throw new Error("ไม่พบบัญชี");
    const choice = await dialog.showMessageBox({ type: "warning", buttons: ["เก็บไว้", "ลบกลุ่มจากโปรแกรม"], defaultId: 0, cancelId: 0,
      message: "ลบกลุ่มนี้จากรายการและปลายทางที่บันทึกไว้?", detail: "ไม่ออกจากกลุ่ม Facebook คิวโพสต์เดิมที่ผูกกับปลายทางนี้จะถูกลบด้วย หากดึงกลุ่มใหม่อาจพบกลุ่มนี้อีก" });
    if (choice.response !== 1) return false;
    database.db.transaction(() => {
      if (database.hasRunningJobs(accountId)) throw new Error("บัญชีกำลังทำงาน กรุณารอให้งานจบก่อนลบกลุ่ม");
      database.db.prepare("DELETE FROM facebook_groups WHERE account_id=? AND facebook_group_id=?").run(accountId, groupId);
      database.db.prepare("DELETE FROM destinations WHERE account_id=? AND (remote_id=? OR url=? OR url=?)")
        .run(accountId, groupId, `https://www.facebook.com/groups/${groupId}/`, `https://www.facebook.com/groups/${groupId}`);
      database.db.prepare(`UPDATE automation_tasks SET status='cancelled',last_error='ลบกลุ่มปลายทางจากโปรแกรมแล้ว'
        WHERE account_id=? AND status='pending' AND rtrim(json_extract(payload_json,'$.targetUrl'),'/')=?`)
        .run(accountId, `https://www.facebook.com/groups/${groupId}`);
      database.db.prepare(`WITH RECURSIVE blocked(id) AS (
        SELECT id FROM automation_tasks WHERE account_id=? AND status='cancelled'
        UNION SELECT child.id FROM automation_tasks child JOIN blocked ON child.parent_id=blocked.id
      ) UPDATE automation_tasks SET status='cancelled',last_error='หยุดตามขั้นตอนก่อนหน้าที่ถูกยกเลิก' WHERE status='pending' AND parent_id IN (SELECT id FROM blocked)`)
        .run(accountId);
    })();
    progressBus.publish({ type: "worker.changed", accountId, message: "ลบกลุ่มจากรายการในโปรแกรมแล้ว" });
    return true;
  });
  ipcMain.handle("queue:delete", async (_event, kind: unknown, input: unknown) => {
    const type = z.enum(["post", "workflow"]).parse(kind);
    const id = z.string().uuid().parse(input);
    const choice = await dialog.showMessageBox({ type: "warning", buttons: ["เก็บไว้", "ลบออกจากคิว"], defaultId: 0, cancelId: 0,
      message: "ลบรายการนี้พร้อมประวัติและขั้นตอนลูก?", detail: "ลบเฉพาะข้อมูลในโปรแกรม ไม่ลบโพสต์หรือความคิดเห็นบน Facebook และไม่สามารถย้อนกลับได้" });
    if (choice.response !== 1) return false;
    deleteQueueItem(database.db, type, id);
    progressBus.publish({ type: "worker.changed", message: "ลบรายการและอัปเดตคิวแล้ว" });
    return true;
  });
  ipcMain.handle("queue:cancel-pending", async (_event, raw: unknown) => {
    const items = z.array(z.object({ kind: z.enum(["post", "workflow"]), id: z.string().uuid() })).min(1).max(2000).parse(raw);
    const choice = await dialog.showMessageBox({ type: "warning", buttons: ["เก็บไว้", "ยืนยันยกเลิก"], defaultId: 0, cancelId: 0,
      message: `ยกเลิกคิวที่ยังไม่ส่ง ${items.length} รายการ?`, detail: "เก็บประวัติไว้ ไม่ลบโพสต์บน Facebook และไม่หยุดงานที่กำลังทำหรืออาจส่งไปแล้ว ถ้าเป็นตารางรายวัน ต้องหยุดตารางด้วย" });
    if (choice.response !== 1) return false;
    const changed = cancelPendingQueueItems(database.db, items);
    progressBus.publish({ type: "worker.changed", message: `ยกเลิกคิวที่ยังไม่ส่ง ${changed} รายการแล้ว` });
    return changed;
  });
  ipcMain.handle("queue:delete-pending", async (_event, raw: unknown) => {
    const data = z.object({ items: z.array(z.object({ kind: z.enum(["post", "workflow"]), id: z.string().uuid() })).min(1).max(2000), scheduleId: z.string().uuid().optional() }).parse(raw);
    const choice = await dialog.showMessageBox({ type: "warning", buttons: ["เก็บไว้", "ลบคิวที่ยังไม่ส่ง"], defaultId: 0, cancelId: 0,
      message: `ลบคิวที่ยังไม่ส่ง ${data.items.length} รายการ${data.scheduleId ? " พร้อมหยุดตาราง" : ""}?`,
      detail: "ลบเฉพาะคิวที่ยังไม่ส่งออกจากโปรแกรม ไม่ลบโพสต์บน Facebook งานที่กำลังทำหรืออาจส่งแล้วและประวัติอื่นจะไม่ถูกลบ" });
    if (choice.response !== 1) return false;
    const result = database.db.transaction(() => {
      if (data.scheduleId) {
        const plan = database.db.prepare("SELECT enabled FROM daily_schedules WHERE id=?").get(data.scheduleId) as { enabled: number } | undefined;
        if (!plan?.enabled) throw new Error("ตารางถูกหยุดไปแล้ว กรุณารีเฟรชคิว");
        for (const item of data.items) {
          if (item.kind !== "workflow") throw new Error("มีคิวที่ไม่อยู่ในตารางนี้");
          const row = database.db.prepare("SELECT json_extract(payload_json,'$.scheduleId') AS scheduleId FROM automation_tasks WHERE id=?").get(item.id) as { scheduleId: string | null } | undefined;
          if (row?.scheduleId !== data.scheduleId) throw new Error("มีคิวที่ไม่อยู่ในตารางนี้ กรุณารีเฟรชคิว");
        }
        schedules.stop(data.scheduleId);
      }
      return deletePendingQueueItems(database.db, data.items);
    })();
    progressBus.publish({ type: "worker.changed", message: `ลบคิวที่ยังไม่ส่ง ${result} รายการ${data.scheduleId ? " และหยุดตารางแล้ว" : ""}` });
    return result;
  });
  const notifications = new NotificationManager(database.db, vault);
  ipcMain.handle("notifications:list", () => notifications.list());
  ipcMain.handle("notifications:probe", (_event, id: unknown) => notifications.probe(z.string().uuid().parse(id)));
  ipcMain.handle("notifications:test-delivery", (_event, id: unknown) => notifications.testDelivery(z.string().uuid().parse(id)));
  ipcMain.handle("notifications:create", (_event, input: unknown) => notifications.create(input));
  ipcMain.handle("notifications:delete", (_event, id: unknown) => notifications.remove(z.string().uuid().parse(id)));
  const tasks = new TaskManager(database.db);
  ipcMain.handle("actions:start-workflow", (_event, raw: unknown) => {
    if (!FEATURES.workflowFollowUp) throw new Error("ฟีเจอร์ขั้นตอนต่อเนื่องยังปิดใช้งานอยู่ สามารถเปิดได้ภายหลัง");
    if (sessionTestMode) throw new Error("โหมดทดสอบ Cookie ไม่อนุญาต action บน Facebook");
    const data = z.object({ accountId: z.string().uuid(), workflows: z.array(z.array(z.object({
      action: z.enum(["comment", "share", "like"]), payload: actionPayloadSchema,
    })).min(1).max(2002)).min(1).max(100) }).parse(raw);
    if (data.workflows.reduce((total, steps) => total + steps.length, 0) > 2000) throw new Error("สร้างได้ไม่เกิน 2000 ขั้นตอนต่อครั้ง");
    const ids = database.db.transaction(() => data.workflows.flatMap(steps => {
      let parent: string | null = null;
      return steps.map(step => {
        const id = tasks.create(data.accountId, step.action, step.payload, undefined, null, parent);
        parent = id; return id;
      });
    }))();
    progressBus.publish({ type: "worker.changed", message: `เพิ่มชุดงาน ${ids.length} ขั้นตอน` });
    return ids;
  });
  ipcMain.handle("projects:start-posts", (_event, raw: unknown) => {
    if (sessionTestMode) throw new Error("โหมดทดสอบ Cookie ไม่อนุญาตโพสต์");
    const data = z.object({ settings: workspaceSchema, scheduledAt: z.string().datetime() }).parse(raw);
    const drafts = data.settings.accounts.filter(account => account.destinationIds.length);
    if (drafts.some(account => account.scheduleTimes.length)) throw new Error("บัญชีที่มีตารางหลายรอบ ให้กดเพิ่มคิวบัญชีนั้น เพื่อยืนยันวันและรายการเวลาของแต่ละบัญชี");
    if (!drafts.length) throw new Error("ไม่มีบัญชีที่เลือกปลายทาง");
    const prepared = drafts.flatMap(account => {
      if (account.recurrence) throw new Error("เริ่มทั้งโปรเจกต์รองรับครั้งเดียว กรุณาใช้คิวเดิมสำหรับรายวัน");
      return account.destinationIds.map(id => {
        const destination = database.destination(id);
        if (!destination || destination.accountId !== account.accountId) throw new Error("ปลายทางไม่ตรงกับบัญชี กรุณาเลือกใหม่");
        const mapping = account.mappings.find(row => row.destinationId === id);
        const payload = actionPayloadSchema.parse({ targetUrl: destination.url, ...mainPostContent(account),
          delayMin: account.delayMin, delayMax: account.delayMax, headless: account.headless ?? data.settings.headless,
          commentEnabled: FEATURES.workflowFollowUp && FEATURES.comment && account.commentEnabled,
          shareEnabled: FEATURES.workflowFollowUp && FEATURES.share && account.shareEnabled,
          likeEnabled: FEATURES.workflowFollowUp && FEATURES.like && account.likeEnabled,
          commentTemplates: mapping?.comment || mapping?.commentImage ? [{ text: mapping.comment, image: mapping.commentImage }] : account.commentTemplates,
          repeatMinutes: account.repeatShareMinutes, shareTargets: account.shareDestinationIds.map(groupId => {
            const group = database.destination(groupId);
            if (!group || group.accountId !== account.accountId || group.kind !== "facebook_group") throw new Error("ปลายทางแชร์ไม่ถูกต้อง");
            return { url: group.url, name: group.name, caption: account.mappings.find(row => row.destinationId === groupId)?.shareText || "", media: [] };
          }) });
        return { accountId: account.accountId, payload };
      });
    });
    const ids = database.db.transaction(() => prepared.map(row => tasks.create(row.accountId, "post", row.payload, data.scheduledAt)))();
    progressBus.publish({ type: "worker.changed", message: `เพิ่มงานโปรเจกต์ ${ids.length} รายการ` });
    return ids;
  });
  ipcMain.handle("actions:list", () => tasks.list());
  ipcMain.handle("actions:cancel", (_event, id: unknown) => {
    tasks.cancel(z.string().uuid().parse(id));
    // Reconcile dependent steps immediately, even when the worker is stopped.
    tasks.due(new Set(database.listAccounts().map(account => account.id)));
    progressBus.publish({ type: "worker.changed", message: "ยกเลิกขั้นตอนและซิงค์คิวแล้ว" });
  });
  ipcMain.handle("actions:start", (_event, raw: unknown) => {
    const data = z.object({ accountId: z.string().uuid(), action: z.enum(["post", "comment", "share", "like"]),
      payloads: z.array(actionPayloadSchema).min(1).max(2000), scheduledAt: z.string().datetime().optional(), projectId: z.string().uuid().nullable().default(null) }).parse(raw);
    if (data.action !== "post") assertActionEnabled(data.action);
    if (sessionTestMode) throw new Error("โหมดทดสอบ Cookie ไม่อนุญาต action บน Facebook");
    const ids = database.db.transaction(() => data.payloads.map(payload => tasks.create(data.accountId, data.action, payload, data.scheduledAt, data.projectId)))();
    progressBus.publish({ type: "worker.changed", message: `เพิ่มงาน ${ids.length} รายการ` });
    return ids;
  });
  const projects = new ProjectManager(database.db);
  ipcMain.handle("projects:list", () => projects.list());
  ipcMain.handle("projects:last", () => projects.lastUsed());
  ipcMain.handle("projects:create", (_event, name: unknown, settings: unknown) => projects.create(z.string().parse(name), settings));
  ipcMain.handle("projects:save", (_event, id: unknown, project: unknown) => projects.save(z.string().uuid().parse(id), project));
  ipcMain.handle("projects:duplicate", (_event, id: unknown) => projects.duplicate(z.string().uuid().parse(id)));
  ipcMain.handle("projects:delete", (_event, id: unknown) => projects.remove(z.string().uuid().parse(id)));
  ipcMain.handle("projects:export", async (_event, id: unknown) => {
    const serialized = projects.serialize(z.string().uuid().parse(id));
    const choice = await dialog.showSaveDialog({ title: "ส่งออกโปรเจกต์ (ไม่รวมไฟล์สื่อและ Cookie)", defaultPath: "project.veltproject" });
    if (choice.canceled || !choice.filePath) return false;
    await writeFile(choice.filePath, serialized, "utf8"); return true;
  });
  ipcMain.handle("projects:import", async () => {
    const choice = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "Veltshop Project", extensions: ["veltproject"] }] });
    if (choice.canceled || !choice.filePaths[0]) return null;
    if ((await stat(choice.filePaths[0])).size > 5_000_000) throw new Error("ไฟล์ใหญ่เกินกำหนด");
    return projects.import(await readFile(choice.filePaths[0], "utf8"));
  });
  ipcMain.handle("media:preview", async (_event, input: unknown) => {
    const paths = z.array(z.string().max(4096)).max(10).parse(input);
    return Promise.all(paths.map(async path => {
      const extension = extname(path).toLowerCase();
      const kind = [".mp4", ".mov"].includes(extension) ? "video" as const : "image" as const;
      if (![".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".mov"].includes(extension)) return { path, kind, missing: true, url: null };
      try {
        const info = await stat(path);
        if (!info.isFile()) throw new Error();
        if (kind === "video" || info.size > 12_000_000) {
          const token = crypto.randomUUID();
          if (previewFiles.size >= 2000) previewFiles.delete(previewFiles.keys().next().value!);
          previewFiles.set(token, resolve(path));
          return { path, kind, missing: false, url: `velt-media://preview/${token}` };
        }
        const mime = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : `image/${extension.slice(1)}`;
        return { path, kind, missing: false, url: `data:${mime};base64,${(await readFile(path)).toString("base64")}` };
      } catch { return { path, kind, missing: true, url: null }; }
    }));
  });
  ipcMain.handle("media:open-folder", (_event, path: unknown) => {
    const file = resolve(z.string().max(4096).parse(path));
    if (![".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".mov"].includes(extname(file).toLowerCase())) throw new Error("ชนิดไฟล์ไม่รองรับ");
    shell.showItemInFolder(file);
  });
  const manager = new AccountManager(database, vault, profilesDir, new SessionChecker(join(app.getPath("userData"), "screenshots")), async id => {
    if (queue.status().running) throw new Error("กรุณาหยุดระบบคิวก่อนจัดการ Session");
    const adapter = adapters.get("facebook-browser");
    if (adapter instanceof FacebookBrowserAdapter) await adapter.closeAccount(id);
  });
  const accountId = (id: unknown) => z.string().uuid().parse(id);
  ipcMain.handle("accounts:preview-cookies", (_event, input: unknown) => parseCookies(z.string().max(2_000_000).parse(input)).map(item => ({ userId: item.userId, format: item.format })));
  ipcMain.handle("accounts:import-cookies", (event, input: unknown, name: unknown) => manager.importMultipleCookies(z.string().max(2_000_000).parse(input), progress => {
    if (!event.sender.isDestroyed()) event.sender.send("accounts:session-progress", progress);
  }, name === undefined ? undefined : z.string().trim().min(1).max(80).parse(name)));
  ipcMain.handle("accounts:check-session", (_event, id: unknown) => manager.checkSession(accountId(id)));
  ipcMain.handle("accounts:login-and-check", (_event, id: unknown) => manager.loginWithBrowser(accountId(id)));
  ipcMain.handle("accounts:create-and-login", (_event, name: unknown) => manager.createAndLoginWithBrowser(z.string().trim().min(1).max(80).parse(name)));
  ipcMain.handle("accounts:rename", (_event, id: unknown, name: unknown) => database.renameAccount(accountId(id), z.string().trim().min(1).max(80).parse(name)));
  ipcMain.handle("accounts:import-cookie-existing", (_event, id: unknown, input: unknown) => manager.importCookieForAccount(accountId(id), z.string().max(2_000_000).parse(input)));
  ipcMain.handle("accounts:delete-session", (_event, id: unknown) => manager.deleteSession(accountId(id)));
  ipcMain.handle("accounts:copy-cookie", (_event, id: unknown) => manager.copyCookieToClipboard(accountId(id)));
  ipcMain.handle("accounts:export-session", (_event, id: unknown, password: unknown) => manager.exportSession(accountId(id), z.string().min(12).max(1024).parse(password)));
  ipcMain.handle("accounts:import-backup", (event, password: unknown) => manager.importBackup(z.string().min(12).max(1024).parse(password), progress => {
    if (!event.sender.isDestroyed()) event.sender.send("accounts:session-progress", progress);
  }));
  ipcMain.handle("accounts:list-with-status", () => database.listAccounts());
  ipcMain.handle("accounts:set-headless", (_event, id: unknown, enabled: unknown) => database.setHeadless(accountId(id), z.boolean().parse(enabled)));
  ipcMain.handle("dashboard", () => database.dashboard());
  ipcMain.handle("accounts:list", () => database.listAccounts());
  ipcMain.handle("accounts:create", (_event, raw: CreateAccountInput) => {
    const input = accountSchema.parse(raw);
    if (input.adapterType !== "facebook-browser" && !input.secret?.trim()) throw new Error("กรุณาใส่ Webhook URL หรือ Bot Token");
    const idPath = join(profilesDir, crypto.randomUUID());
    if (input.adapterType === "facebook-browser") mkdirSync(idPath, { recursive: true });
    return database.createAccount(input, vault.encrypt(input.secret), input.adapterType === "facebook-browser" ? idPath : null);
  });
  ipcMain.handle("accounts:delete", (_event, id: string) => database.deleteAccount(z.string().uuid().parse(id)));
  ipcMain.handle("accounts:login-facebook", async (_event, id: string) => {
    const account = database.accountRecord(z.string().uuid().parse(id));
    if (!account || account.adapterType !== "facebook-browser") throw new Error("ไม่พบบัญชี Facebook");
    await adapters.get("facebook-browser").openLogin?.(account);
    // Opening a browser is not proof of authentication. Status changes only after SessionChecker verifies it.
  });
  ipcMain.handle("accounts:discover-groups", async (_event, id: string) => {
    const account = database.accountRecord(z.string().uuid().parse(id));
    if (!account || account.adapterType !== "facebook-browser") throw new Error("ไม่พบบัญชี Facebook");
    const adapter = adapters.get("facebook-browser");
    if (!adapter.discoverGroups) throw new Error("Adapter ไม่รองรับการดึงกลุ่ม");
    progressBus.publish({ type: "target.progress", accountId: account.id, percent: 0, message: "กำลังรีเฟรชรายชื่อกลุ่ม Facebook" });
    try {
      const groups = await adapter.discoverGroups(account);
      const timestamp = new Date().toISOString();
      const previous = (database.db.prepare("SELECT COUNT(*) AS count FROM facebook_groups WHERE account_id=?").get(account.id) as { count: number }).count;
      database.db.transaction(() => {
        const save = database.db.prepare(`INSERT INTO facebook_groups(id,account_id,facebook_group_id,name,url,image_url,discovered_from,last_seen_at,post_permission,share_permission)
          VALUES(?,?,?,?,?,?,?,?,'unknown','unknown') ON CONFLICT(account_id,facebook_group_id) DO UPDATE SET name=excluded.name,url=excluded.url,
          image_url=COALESCE(excluded.image_url,facebook_groups.image_url),last_seen_at=excluded.last_seen_at`);
        for (const group of groups) save.run(crypto.randomUUID(), account.id, group.id, group.name, group.url, group.imageUrl, "joined-groups", timestamp);
      })();
      const total = (database.db.prepare("SELECT COUNT(*) AS count FROM facebook_groups WHERE account_id=?").get(account.id) as { count: number }).count;
      database.db.prepare("UPDATE accounts SET groups_refreshed_at=?,groups_count_difference=? WHERE id=?").run(timestamp, total - previous, account.id);
      progressBus.publish({ type: "target.succeeded", accountId: account.id, percent: 100, message: `ดึงได้ ${groups.length} กลุ่ม เพิ่มใหม่ ${total - previous} กลุ่ม รวมสะสม ${total} กลุ่ม` });
      const permissions = database.db.prepare("SELECT facebook_group_id AS id,post_permission AS postPermission,share_permission AS sharePermission FROM facebook_groups WHERE account_id=?").all(account.id) as { id: string; postPermission: "unknown" | "allowed" | "denied"; sharePermission: "unknown" | "allowed" | "denied" }[];
      const permissionMap = new Map(permissions.map(row => [row.id, row]));
      return groups.map(group => ({ ...group, ...permissionMap.get(group.id) }));
    } catch (error) {
      progressBus.publish({ type: "target.failed", accountId: account.id, message: "รีเฟรชกลุ่มไม่สำเร็จ กรุณาตรวจ Session" });
      throw error;
    }
  });
  ipcMain.handle("destinations:list", (_event, id?: string) => database.listDestinations(id));
  ipcMain.handle("destinations:create", (_event, raw: CreateDestinationInput) => database.createDestination(destinationSchema.parse(raw)));
  ipcMain.handle("destinations:delete", (_event, id: string) => database.deleteDestination(z.string().uuid().parse(id)));
  ipcMain.handle("jobs:list", (_event, limit?: number) => database.listJobs(Math.min(500, Math.max(1, limit || 200))));
  ipcMain.handle("jobs:create", (_event, raw: CreateJobInput) => database.createJobs(jobSchema.parse(raw)));
  ipcMain.handle("jobs:create-mapped", (_event, raw: unknown) => {
    const input = z.object({ accountId: z.string().uuid(), runAt: z.string().datetime(), recurrence: z.enum(["daily", "weekly"]).nullable(),
      delayMin: z.number().int().min(0).max(86400).default(30), delayMax: z.number().int().min(0).max(86400).default(90),
      contents: z.array(z.object({ destinationId: z.string().uuid(), caption: z.string().max(10000), media: z.array(z.string()).max(10) })).min(1).max(2000) }).parse(raw);
    return database.db.transaction(() => input.contents.flatMap(content => database.createJobs({ accountId: input.accountId, destinationIds: [content.destinationId],
      caption: content.caption, media: content.media, runAt: input.runAt, recurrence: input.recurrence, delayMin: input.delayMin, delayMax: input.delayMax })))();
  });
  ipcMain.handle("jobs:retry", (_event, id: string) => {
    database.retryJob(z.string().uuid().parse(id));
    progressBus.publish({ type: "worker.changed", message: "เพิ่มงานโพสต์กลับเข้าคิวแล้ว" });
  });
  ipcMain.handle("jobs:cancel", (_event, id: string) => {
    database.cancelJob(z.string().uuid().parse(id));
    progressBus.publish({ type: "worker.changed", message: "ยกเลิกงานโพสต์แล้ว" });
  });
  ipcMain.handle("logs:list", (_event, limit?: number) => database.listLogs(Math.min(2000, Math.max(1, limit || 500))));
  ipcMain.handle("media:choose", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "รูปและวิดีโอ", extensions: ["jpg", "jpeg", "png", "webp", "gif", "mp4", "mov"] }],
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle("worker:start", () => {
    if (sessionTestMode) throw new Error("โหมดทดสอบ Cookie ไม่อนุญาตให้เริ่มคิวโพสต์");
    return queue.start();
  });
  ipcMain.handle("worker:stop", () => queue.stop());
  ipcMain.handle("worker:status", () => queue.status());
  ipcMain.handle("settings:get-auto-start", () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle("settings:set-auto-start", (_event, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: z.boolean().parse(enabled), openAsHidden: true });
    return app.getLoginItemSettings().openAtLogin;
  });
}

app.whenReady().then(() => {
  if (!ownsAppInstance) return;
  protocol.handle("velt-media", request => {
    const url = new URL(request.url);
    const path = url.hostname === "preview" ? previewFiles.get(url.pathname.slice(1)) : undefined;
    if (!path || !["GET", "HEAD"].includes(request.method)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(path).href, { method: request.method, headers: request.headers });
  });
  const dataDir = app.getPath("userData");
  const profilesDir = join(dataDir, "profiles");
  const screenshotsDir = join(dataDir, "screenshots");
  mkdirSync(profilesDir, { recursive: true });
  database = new AppDatabase(join(dataDir, "autopost.sqlite3"));
  vault = new SecretVault();
  adapters = new AdapterRegistry();
  queue = new QueueEngine(database, adapters, vault, screenshotsDir, 2, progressBus);
  registerIpc(profilesDir);
  createWindow();
  createTray();
  if (!sessionTestMode) queue.start();
});

app.on("activate", () => mainWindow?.show());
app.on("before-quit", () => { quitting = true; });
app.on("will-quit", async () => {
  await queue?.stop();
  await adapters?.close();
  database?.close();
});
