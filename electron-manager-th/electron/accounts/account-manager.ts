import { clipboard, dialog } from "electron";
import { chromium } from "playwright-core";
import { randomUUID } from "node:crypto";
import { rm, writeFile, readFile, stat, mkdir, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { AppDatabase } from "../core/database";
import { SecretVault } from "../core/secrets";
import { CookieLogin } from "./cookie-login";
import { parseCookies } from "./cookie-parser";
import { SessionChecker } from "./session-checker";
import { encryptBackup, decryptBackup } from "./portable-backup";
import { isProfileBusy, ProfileBusyError } from "../core/errors";

export class AccountManager {
  private busy = new Set<string>();
  private importing = false;
  constructor(private db: AppDatabase, private vault: SecretVault, private profiles: string, private checker: SessionChecker,
    private closeAccount: (id: string) => Promise<void>) {}

  async importMultipleCookies(input: string, progress?: (event: { current: number; total: number; status: string }) => void, name?: string) {
    if (this.importing) throw new Error("กำลังนำเข้า Cookie กรุณารอสักครู่");
    const candidates = parseCookies(input);
    this.importing = true;
    const results: { accountId: string; status: string; message: string }[] = [];
    try {
      for (const candidate of candidates) {
        progress?.({ current: results.length + 1, total: candidates.length, status: "checking" });
        const existing = this.db.db.prepare("SELECT id FROM accounts WHERE platform='facebook' AND facebook_user_id=? ORDER BY created_at LIMIT 1")
          .get(candidate.userId) as { id: string } | undefined;
        if (existing) throw new Error("บัญชี Facebook นี้มีอยู่แล้ว กรุณาตรวจสอบ Session ในบัญชีเดิม ไม่สร้างซ้ำหรือทับ Cookie");
        const unverified = this.db.db.prepare("SELECT id FROM accounts WHERE platform='facebook' AND name=? AND facebook_user_id IS NULL ORDER BY created_at LIMIT 1")
          .get(`Facebook ${candidate.userId}`) as { id: string } | undefined;
        if (unverified) throw new Error("พบบัญชี Facebook เดิมที่ยังไม่ยืนยันชื่อ กรุณาตรวจบัญชีเดิมก่อนนำเข้าใหม่");
        const profile = join(this.profiles, randomUUID());
        const account = this.db.createAccount({ name: name && candidates.length === 1 ? name : `Facebook ${candidate.userId}`, adapterType: "facebook-browser" }, null, profile);
        this.db.saveSession(account.id, this.vault.encryptCookies(JSON.stringify(candidate.cookies)), candidate.format, "unknown", "รอตรวจสอบ Session", new Date().toISOString());
        try {
          const result = await new CookieLogin(this.vault, this.checker).verify(candidate, profile);
          this.db.saveSession(account.id, result.encryptedCookies, result.format, result.session.status, result.session.message, result.session.checkedAt);
          this.db.updateFacebookIdentity(account.id, result.session.status === "online" ? result.session.identity || null : null, result.session.checkedAt);
          results.push({ accountId: account.id, status: result.session.status, message: result.session.message });
          progress?.({ current: results.length, total: candidates.length, status: result.session.status });
          if (["checkpoint", "restricted", "disabled"].includes(result.session.status)) break;
        } catch {
          const message = "เปิด Session ไม่สำเร็จ กรุณาตรวจ Chrome และเครือข่าย";
          this.db.updateSessionStatus(account.id, "unknown", message, new Date().toISOString());
          results.push({ accountId: account.id, status: "unknown", message });
          progress?.({ current: results.length, total: candidates.length, status: "unknown" });
        }
      }
      return results;
    } finally { this.importing = false; }
  }

  async importCookieForAccount(id: string, input: string) {
    const [candidate, ...extra] = parseCookies(input);
    if (!candidate || extra.length) throw new Error("กรุณาใช้ Cookie ของบัญชีเดียวสำหรับบัญชีที่เลือก");
    return this.exclusive(id, async () => {
      const account = this.db.accountRecord(id);
      if (!account?.browserProfilePath || account.platform !== "facebook") throw new Error("ไม่พบบัญชี Facebook");
      if (account.facebookUserId && account.facebookUserId !== candidate.userId) throw new Error("Cookie เป็นคนละบัญชีกับ Facebook ที่ยืนยันไว้ ไม่เปลี่ยน Session");
      const duplicate = this.db.db.prepare("SELECT id FROM accounts WHERE platform='facebook' AND facebook_user_id=? AND id<>? LIMIT 1")
        .get(candidate.userId, id);
      if (duplicate) throw new Error("Facebook นี้อยู่ในบัญชีอื่นแล้ว ไม่สร้าง Session ซ้ำ");
      const existing = this.db.sessionRecord(id);
      if (existing?.encryptedCookies) throw new Error("บัญชีนี้มี Cookie อยู่แล้ว ไม่ทับ Session เดิม กรุณาใช้การตรวจ Session");
      // Verify in an isolated temporary profile before attaching any credential to the selected account.
      const scratch = join(this.profiles, randomUUID());
      let result;
      try { result = await new CookieLogin(this.vault, this.checker).verify(candidate, scratch); }
      finally { await rm(scratch, { recursive: true, force: true }).catch(() => undefined); }
      if (result.session.status !== "online") throw new Error(`ยืนยัน Cookie ไม่สำเร็จ: ${result.session.message} ไม่เปลี่ยนบัญชีเดิม`);
      // Existing Chrome profiles must never be silently overwritten with cookie credentials.
      if ((await readdir(account.browserProfilePath).catch(error => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw new Error("ตรวจโฟลเดอร์โปรไฟล์ไม่ได้ ไม่เปลี่ยน Cookie");
      })).length) {
        throw new Error("บัญชีนี้มีโปรไฟล์ Chrome อยู่แล้ว ไม่ทับด้วย Cookie กรุณาเข้าสู่ระบบ Chrome หรือสร้างบัญชีใหม่");
      }
      await mkdir(account.browserProfilePath, { recursive: true });
      const stored = await new CookieLogin(this.vault, this.checker).verify(candidate, account.browserProfilePath);
      this.db.saveSession(id, stored.encryptedCookies, stored.format, stored.session.status, stored.session.message, stored.session.checkedAt);
      this.db.updateFacebookIdentity(id, stored.session.status === "online" ? stored.session.identity || null : null, stored.session.checkedAt);
      return { accountId: id, status: stored.session.status, message: stored.session.message };
    });
  }

  private async exclusive<T>(id: string, action: () => Promise<T>): Promise<T> {
    if (this.busy.has(id) || this.db.hasRunningJobs(id)) throw new Error("บัญชีนี้กำลังทำงาน กรุณาหยุดคิวและรอให้งานจบก่อน");
    this.busy.add(id);
    try { await this.closeAccount(id); return await action(); } finally { this.busy.delete(id); }
  }

  async checkSession(id: string) {
    return this.exclusive(id, async () => {
      const account = this.db.accountRecord(id);
      const session = this.db.sessionRecord(id);
      if (!account?.browserProfilePath || !session) throw new Error("ไม่พบ Session Facebook");
      const context = await chromium.launchPersistentContext(account.browserProfilePath, { channel: "chrome", headless: !!session.headless, locale: "th-TH", timezoneId: "Asia/Bangkok" }).catch(error => {
        if (isProfileBusy(error)) throw new ProfileBusyError();
        throw new Error("เปิด Chrome เพื่อตรวจ Session ไม่สำเร็จ กรุณาตรวจ Chrome และ Proxy");
      });
      try {
        const result = await this.checker.check(context, account.facebookUserId || undefined);
        this.db.updateSessionStatus(id, result.status, result.message, result.checkedAt);
        this.db.updateFacebookIdentity(id, result.status === "online" ? result.identity || null : null, result.checkedAt);
        return result;
      } finally { await context.close(); }
    });
  }

  async loginWithBrowser(id: string) {
    const account = this.db.accountRecord(id);
    if (!account?.browserProfilePath || account.platform !== "facebook") throw new Error("ไม่พบบัญชี Facebook");
    if (this.db.hasRunningJobs(id) || this.busy.has(id)) throw new Error("บัญชีกำลังทำงาน กรุณาหยุดคิวก่อนล็อกอิน");
    this.busy.add(id);
    try {
      await this.closeAccount(id);
      await mkdir(account.browserProfilePath, { recursive: true });
      const context = await chromium.launchPersistentContext(account.browserProfilePath, { channel: "chrome", headless: false,
        locale: "th-TH", timezoneId: "Asia/Bangkok" }).catch(error => {
        if (isProfileBusy(error)) throw new ProfileBusyError();
        throw new Error("เปิด Chrome ไม่สำเร็จ กรุณาตรวจการติดตั้ง Chrome");
      });
      try {
        const page = context.pages()[0] || await context.newPage();
        await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.bringToFront();
        await context.waitForEvent("close");
      } finally { await context.close().catch(() => undefined); }
    } finally { this.busy.delete(id); }
    return this.checkSession(id);
  }

  async createAndLoginWithBrowser(name: string) {
    const profile = join(this.profiles, randomUUID());
    const account = this.db.createAccount({ name, adapterType: "facebook-browser" }, null, profile);
    const session = await this.loginWithBrowser(account.id);
    return { accountId: account.id, session };
  }

  private cookie(id: string): string {
    const value = this.vault.decrypt(this.db.sessionRecord(id)?.encryptedCookies || null);
    if (!value) throw new Error("บัญชีนี้ยังไม่มี Cookie ที่นำเข้า");
    return value;
  }

  async copyCookieToClipboard(id: string) {
    const answer = await dialog.showMessageBox({ type: "warning", buttons: ["ยกเลิก", "คัดลอก"], defaultId: 0, cancelId: 0,
      message: "Cookie ใช้เข้าถึงบัญชีได้ ห้ามส่งให้บุคคลอื่น คลิปบอร์ดจะถูกล้างใน 45 วินาที" });
    if (answer.response !== 1) return;
    const value = this.cookie(id);
    clipboard.writeText(value);
    const timer = setTimeout(() => { if (clipboard.readText() === value) clipboard.clear(); }, 45_000);
    timer.unref();
  }

  async exportSession(id: string, password: string): Promise<boolean> {
    const portable = await encryptBackup(this.cookie(id), password);
    const choice = await dialog.showSaveDialog({ title: "สำรอง Session แบบเข้ารหัสสำหรับย้ายเครื่อง", defaultPath: "facebook-session.veltbackup" });
    if (choice.canceled || !choice.filePath) return false;
    await writeFile(choice.filePath, portable, { encoding: "utf8", mode: 0o600 });
    return true;
  }

  async importBackup(password: string, progress?: (event: { current: number; total: number; status: string }) => void) {
    const choice = await dialog.showOpenDialog({ title: "กู้คืน Session จากไฟล์สำรอง", properties: ["openFile"], filters: [{ name: "Veltshop Backup", extensions: ["veltbackup"] }] });
    if (choice.canceled || !choice.filePaths[0]) return [];
    if ((await stat(choice.filePaths[0])).size > 3_000_000) throw new Error("ไฟล์สำรองใหญ่เกินกำหนด");
    const plaintext = await decryptBackup(await readFile(choice.filePaths[0], "utf8"), password);
    return this.importMultipleCookies(plaintext, progress);
  }

  async deleteSession(id: string) {
    return this.exclusive(id, async () => {
      const account = this.db.accountRecord(id);
      if (!account || account.platform !== "facebook") throw new Error("ไม่พบบัญชี Facebook");
      const answer = await dialog.showMessageBox({ type: "warning", buttons: ["ยกเลิก", "ลบ Session"], defaultId: 0, cancelId: 0,
        message: "ลบ Cookie, Profile, ปลายทาง และงานของบัญชีนี้? ไม่สามารถย้อนกลับได้ และไม่ใช่การเพิกถอน Session จากอุปกรณ์อื่น" });
      if (answer.response !== 1) return;
      if (account.browserProfilePath) {
        const profile = resolve(account.browserProfilePath);
        if (dirname(profile) !== resolve(this.profiles)) throw new Error("Profile อยู่นอกโฟลเดอร์ที่อนุญาต ไม่ดำเนินการลบ");
        await rm(profile, { recursive: true, force: true });
      }
      this.db.deleteAccount(id);
    });
  }
}
