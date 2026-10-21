import { clipboard, dialog } from "electron";
import { chromium } from "playwright-core";
import { randomUUID } from "node:crypto";
import { rm, writeFile, readFile, stat } from "node:fs/promises";
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

  async importMultipleCookies(input: string, progress?: (event: { current: number; total: number; status: string }) => void) {
    if (this.importing) throw new Error("กำลังนำเข้า Cookie กรุณารอสักครู่");
    const candidates = parseCookies(input);
    this.importing = true;
    const results: { accountId: string; status: string; message: string }[] = [];
    try {
      for (const candidate of candidates) {
        progress?.({ current: results.length + 1, total: candidates.length, status: "checking" });
        const profile = join(this.profiles, randomUUID());
        const account = this.db.createAccount({ name: `Facebook ${candidate.userId}`, adapterType: "facebook-browser" }, null, profile);
        this.db.saveSession(account.id, this.vault.encryptCookies(JSON.stringify(candidate.cookies)), candidate.format, "unknown", "รอตรวจสอบ Session", new Date().toISOString());
        try {
          const result = await new CookieLogin(this.vault, this.checker).verify(candidate, profile);
          this.db.saveSession(account.id, result.encryptedCookies, result.format, result.session.status, result.session.message, result.session.checkedAt);
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
        const result = await this.checker.check(context);
        this.db.updateSessionStatus(id, result.status, result.message, result.checkedAt);
        return result;
      } finally { await context.close(); }
    });
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
