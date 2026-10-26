import { clipboard, dialog } from "electron";
import { rm, writeFile, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { AppDatabase } from "../core/database";
import { SecretVault } from "../core/secrets";
import { CookieLogin, cookieProfileRoot } from "./cookie-login";
import { parseCookies } from "./cookie-parser";
import { SessionChecker } from "./session-checker";
import { encryptBackup, decryptBackup } from "./portable-backup";

export class AccountManager {
  private busy = new Set<string>();
  private importing = false;
  private cookieUsers = new Set<string>();
  constructor(private db: AppDatabase, private vault: SecretVault, private profiles: string, private checker: SessionChecker,
    private closeAccount: (id: string) => Promise<void>, private cookieProfiles = cookieProfileRoot()) {}

  private profileFor(userId: string) {
    if (!/^\d+$/.test(userId)) throw new Error("invalid_cookie");
    return join(this.cookieProfiles, userId);
  }

  private async verifyAndSave(id: string, candidate: ReturnType<typeof parseCookies>[number], preservePause = false) {
    const account = this.db.accountRecord(id);
    if (!account || account.platform !== "facebook") throw new Error("ไม่พบบัญชี Facebook");
    if (this.cookieUsers.has(candidate.userId)) throw new Error("บัญชี Cookie นี้กำลังตรวจสอบอยู่ กรุณารอ");
    this.cookieUsers.add(candidate.userId);
    try {
    const duplicate = this.db.db.prepare("SELECT id FROM accounts WHERE platform='facebook' AND (facebook_user_id=? OR browser_profile_path=?) AND id<>? LIMIT 1").get(candidate.userId, this.profileFor(candidate.userId), id);
    if (duplicate) throw new Error("Facebook นี้อยู่ในบัญชีอื่นแล้ว");
    const profile = this.profileFor(candidate.userId);
    const result = await new CookieLogin(this.vault, this.checker).verify(candidate, profile, !!account.headless, account.proxyUrl || undefined);
    // Explicit cookie replacement is the only migration; legacy profiles remain on disk untouched.
    this.db.db.prepare("UPDATE accounts SET browser_profile_path=? WHERE id=?").run(profile, id);
    this.db.saveSession(id, result.encryptedCookies, result.format, result.session.status, result.session.message, result.session.checkedAt);
    this.db.updateFacebookIdentity(id, result.session.status === "online" ? result.session.identity || null : null, result.session.checkedAt);
    this.db.db.prepare("UPDATE accounts SET facebook_user_id=? WHERE id=?").run(candidate.userId, id);
    if (preservePause && account.status === "paused" && result.session.status === "online") this.db.setAccountStatus(id, "paused");
    return { accountId: id, status: result.session.status, message: result.session.message, reason: result.session.reason };
    } finally { this.cookieUsers.delete(candidate.userId); }
  }

  async importMultipleCookies(input: string, progress?: (event: { current: number; total: number; status: string }) => void, name?: string) {
    if (this.importing) throw new Error("กำลังนำเข้า Cookie กรุณารอสักครู่");
    const candidates = parseCookies(input);
    this.importing = true;
    const results: { accountId: string; status: string; message: string; reason?: string }[] = [];
    try {
      for (const candidate of candidates) {
        progress?.({ current: results.length + 1, total: candidates.length, status: "checking" });
        const profile = this.profileFor(candidate.userId);
        let existing = this.db.db.prepare("SELECT id FROM accounts WHERE platform='facebook' AND (facebook_user_id=? OR browser_profile_path=?) ORDER BY created_at LIMIT 1")
          .get(candidate.userId, profile) as { id: string } | undefined;
        if (!existing) {
          const legacy = this.db.db.prepare("SELECT id,encrypted_cookies AS encryptedCookies FROM accounts WHERE platform='facebook' AND facebook_user_id IS NULL AND encrypted_cookies IS NOT NULL").all() as { id: string; encryptedCookies: string }[];
          const matches = legacy.filter(row => {
            try { return parseCookies(this.vault.decrypt(row.encryptedCookies) || "")[0]?.userId === candidate.userId; }
            catch { return false; }
          });
          if (matches.length > 1) throw new Error("พบ Session เดิมซ้ำ กรุณาเลือกบัญชีที่ต้องการเปลี่ยน Cookie");
          existing = matches[0];
        }
        const account = existing || this.db.createAccount({ name: name && candidates.length === 1 ? name : `Facebook ${candidate.userId}`, adapterType: "facebook-browser" }, null, profile);
        const result = await this.exclusive(account.id, () => this.verifyAndSave(account.id, candidate));
        results.push(result);
        progress?.({ current: results.length, total: candidates.length, status: result.status });
        // A rejected login never initiates another attempt or the next account in this batch.
        if (result.status !== "online") break;
      }
      return results;
    } finally { this.importing = false; }
  }

  async importCookieForAccount(id: string, input: string) {
    const [candidate, ...extra] = parseCookies(input);
    if (!candidate || extra.length) throw new Error("กรุณาใช้ Cookie ของบัญชีเดียวสำหรับบัญชีที่เลือก");
    return this.exclusive(id, async () => {
      const account = this.db.accountRecord(id);
      if (!account || account.platform !== "facebook") throw new Error("ไม่พบบัญชี Facebook");
      if (account.facebookUserId && account.facebookUserId !== candidate.userId) throw new Error("Cookie เป็นคนละบัญชี ไม่เปลี่ยน Session");
      const saved = this.db.sessionRecord(id)?.encryptedCookies;
      if (saved && parseCookies(this.vault.decrypt(saved) || "")[0]?.userId !== candidate.userId) throw new Error("Cookie เป็นคนละบัญชี ไม่เปลี่ยน Session");
      const duplicate = this.db.db.prepare("SELECT id FROM accounts WHERE platform='facebook' AND (facebook_user_id=? OR browser_profile_path=?) AND id<>? LIMIT 1")
        .get(candidate.userId, this.profileFor(candidate.userId), id);
      if (duplicate) throw new Error("Facebook นี้อยู่ในบัญชีอื่นแล้ว");
      return this.verifyAndSave(id, candidate);
    });
  }

  private async exclusive<T>(id: string, action: () => Promise<T>): Promise<T> {
    if (this.busy.has(id) || this.db.hasRunningJobs(id)) throw new Error("บัญชีนี้กำลังทำงาน กรุณาหยุดคิวและรอให้งานจบก่อน");
    this.busy.add(id);
    try { await this.closeAccount(id); return await action(); } finally { this.busy.delete(id); }
  }

  async checkSession(id: string) {
    return this.exclusive(id, async () => {
      const stored = this.db.sessionRecord(id)?.encryptedCookies;
      if (!stored) {
        const result = { status: "expired" as const, reason: "missing_c_user_or_xs", message: "ยังไม่มี Cookie กรุณากดเข้าด้วย cookie", checkedAt: new Date().toISOString() };
        this.db.updateSessionStatus(id, result.status, result.message, result.checkedAt);
        return result;
      }
      const [candidate, ...others] = parseCookies(this.vault.decrypt(stored) || "");
      if (!candidate || others.length) throw new Error("invalid_cookie");
      const account = this.db.accountRecord(id);
      if (account?.facebookUserId && account.facebookUserId !== candidate.userId) throw new Error("Cookie เป็นคนละบัญชี ไม่เริ่ม Session");
      const result = await this.verifyAndSave(id, candidate, true);
      return { status: result.status as import("./session-checker").SessionStatus, reason: result.reason, message: result.message, checkedAt: new Date().toISOString() };
    });
  }

  async loginWithBrowser(_id: string): Promise<import("./session-checker").SessionResult> {
    throw new Error("manual_login_disabled · ใช้ปุ่มเข้าด้วย cookie และนำเข้า Session ใหม่");
  }
  async createAndLoginWithBrowser(_name: string): Promise<{ accountId: string; session: import("./session-checker").SessionResult }> {
    throw new Error("manual_login_disabled · สร้างบัญชีผ่านการนำเข้า Cookie");
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
        if (![resolve(this.profiles), resolve(this.cookieProfiles)].includes(dirname(profile))) throw new Error("Profile อยู่นอกโฟลเดอร์ที่อนุญาต ไม่ดำเนินการลบ");
        await rm(profile, { recursive: true, force: true });
      }
      this.db.deleteAccount(id);
    });
  }
}
