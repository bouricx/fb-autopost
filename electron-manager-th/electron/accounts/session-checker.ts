import type { BrowserContext, Page } from "playwright-core";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { inspectFacebookIdentity, type VerifiedFacebookIdentity } from "./facebook-identity";

export type SessionStatus = "online" | "expired" | "restricted" | "checkpoint" | "disabled" | "unknown";
export interface SessionResult { status: SessionStatus; message: string; checkedAt: string; screenshot?: string; identity?: VerifiedFacebookIdentity | null }

export class SessionChecker {
  constructor(private readonly screenshotsDir: string) {}

  async check(context: BrowserContext, expectedUserId?: string): Promise<SessionResult> {
    const page = await context.newPage();
    let result: SessionResult;
    try {
      await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded", timeout: 60_000 });
      result = await this.inspect(page, context, expectedUserId);
    } catch {
      result = { status: "unknown", message: "ตรวจสอบไม่สำเร็จ กรุณาตรวจเครือข่ายหรือ Proxy", checkedAt: new Date().toISOString() };
    }
    if (result.status !== "online") {
      try {
        await mkdir(this.screenshotsDir, { recursive: true });
        const screenshot = join(this.screenshotsDir, `session-${crypto.randomUUID()}.png`);
        if (await page.screenshot({ path: screenshot }).then(() => true, () => false)) result.screenshot = screenshot;
      } catch { /* Screenshot failure must not prevent saving the actual session state. */ }
    }
    await page.close().catch(() => undefined);
    return result;
  }

  private async inspect(page: Page, context: BrowserContext, userId?: string): Promise<SessionResult> {
    const checkedAt = new Date().toISOString();
    const url = new URL(page.url());
    if (!/(^|\.)facebook\.com$/.test(url.hostname)) return { status: "unknown", message: "หน้าเว็บไม่ได้อยู่บน Facebook", checkedAt };
    if (/checkpoint|challenge/.test(url.pathname)) return { status: "checkpoint", message: "ต้องยืนยันตัวตนด้วยตนเอง กรุณาเปิด Chrome แบบเห็นหน้าต่าง", checkedAt };
    const heading = await page.locator('h1,h2,[role="alert"]').allTextContents();
    const text = heading.join(" ");
    if (/account.{0,30}disabled|บัญชี.{0,30}ถูกปิดใช้งาน/i.test(text)) return { status: "disabled", message: "Facebook แจ้งว่าบัญชีถูกปิดใช้งาน", checkedAt };
    if (/account.{0,30}restricted|บัญชี.{0,30}ถูกจำกัด/i.test(text)) return { status: "restricted", message: "Facebook แจ้งว่าบัญชีถูกจำกัด", checkedAt };
    if (/login/.test(url.pathname) || await page.locator('input[name="email"]').isVisible().catch(() => false)) return { status: "expired", message: "Session หมดอายุ กรุณานำเข้า Cookie ใหม่", checkedAt };
    const cookies = await context.cookies("https://www.facebook.com/");
    const identity = cookies.find(cookie => cookie.name === "c_user");
    const accountControl = page.getByRole("button", { name: /Your profile|Account|โปรไฟล์ของคุณ|บัญชีของคุณ/i }).first();
    if (identity && userId && identity.value !== userId) return { status: "unknown", message: "Session เป็นคนละบัญชี ไม่เริ่มงานอัตโนมัติ", checkedAt };
    if (identity && await accountControl.isVisible().catch(() => false)) {
      const verified = await inspectFacebookIdentity(page, context, identity.value).catch(() => null);
      return { status: "online", message: "ตรวจพบ Session และเมนูบัญชีที่ล็อกอินแล้ว", checkedAt, identity: verified };
    }
    return { status: "unknown", message: "ยังยืนยันสถานะล็อกอินไม่ได้ ไม่เริ่มงานอัตโนมัติ", checkedAt };
  }
}
