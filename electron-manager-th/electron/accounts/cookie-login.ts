import { chromium, type BrowserContext, type Page } from "playwright-core";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CookieCandidate, SessionCookie } from "./cookie-parser";
import { SessionChecker, type SessionResult } from "./session-checker";
import type { SecretVault } from "../core/secrets";

export type CookieMap = Record<string, string>;
export type CookieLoginFailure = "missing_c_user_or_xs" | "invalid_cookie" | "checkpoint_or_login_required" | "session_rejected" | "navigation_failed" | "browser_unavailable";
export type CookieLoginResult =
  | { ok: false; reason: CookieLoginFailure }
  | { ok: true; userId: string; page: Page; context: BrowserContext; profileDir: string; session: SessionResult };

/** No cookie values are included in validation errors. Values containing '=' remain intact. */
export function parseCookieString(raw: string): CookieMap {
  if (typeof raw !== "string" || raw.length > 2_000_000) throw new Error("invalid_cookie");
  const out: CookieMap = Object.create(null);
  for (const part of raw.trim().replace(/^Cookie:\s*/i, "").replace(/\r?\n/g, " ").split(";")) {
    if (!part.trim()) continue;
    const at = part.indexOf("=");
    if (at <= 0) throw new Error("invalid_cookie");
    const name = part.slice(0, at).trim(), value = part.slice(at + 1).trim();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\x00-\x1f\x7f]/.test(value)) throw new Error("invalid_cookie");
    if (Object.hasOwn(out, name) && out[name] !== value) throw new Error("invalid_cookie");
    out[name] = value;
  }
  return out;
}
export function hasCoreSession(cookies: CookieMap): boolean {
  return Object.hasOwn(cookies, "c_user") && /^\d+$/.test(cookies.c_user) && Object.hasOwn(cookies, "xs") && !!cookies.xs.trim();
}
export function toPlaywrightCookies(cookies: CookieMap): SessionCookie[] {
  return Object.entries(cookies).map(([name, value]) => ({ name, value, domain: ".facebook.com", path: "/", secure: true,
    httpOnly: ["xs", "c_user", "datr", "sb"].includes(name), sameSite: "None", expires: -1 }));
}
export function cookieProfileRoot(): string {
  return join(process.env.LOCALAPPDATA || join(homedir(), ".local", "share"), "FB-AutoPost", "cookie-profiles");
}
export function cookieProfileDir(userId: string): string {
  if (!/^\d+$/.test(userId)) throw new Error("invalid_cookie");
  return join(cookieProfileRoot(), userId);
}
export interface CookieLoginOptions {
  cookieRaw: string;
  chromePath?: string;
  userDataDir?: string;
  headless?: boolean;
  timeoutMs?: number;
  proxy?: { server: string };
}
export function blockedLoginUrl(value: string): boolean {
  try { return /\/(?:checkpoint|login|challenge|two_step_verification)(?:\/|$|\.php)/i.test(new URL(value).pathname); }
  catch { return true; }
}

/** Returns an owned, already-verified context on success. Caller must close it. Failures close it here. */
export async function openCookieSession(cookies: SessionCookie[], userId: string, opts: Omit<CookieLoginOptions, "cookieRaw"> = {}, checker = new SessionChecker("")): Promise<CookieLoginResult> {
  if (!/^\d+$/.test(userId) || !cookies.some(c => c.name === "c_user" && c.value === userId) || !cookies.some(c => c.name === "xs" && c.value)) return { ok: false, reason: "missing_c_user_or_xs" };
  const profileDir = opts.userDataDir || cookieProfileDir(userId);
  let context: BrowserContext;
  try {
    await mkdir(profileDir, { recursive: true });
    context = await chromium.launchPersistentContext(profileDir, {
      ...(opts.chromePath ? { executablePath: opts.chromePath } : { channel: "chrome" }), headless: opts.headless ?? true,
      proxy: opts.proxy, locale: "th-TH", timezoneId: "Asia/Bangkok", viewport: { width: 1365, height: 900 }, args: ["--disable-notifications"],
    });
  } catch { return { ok: false, reason: "browser_unavailable" }; }
  let blocked = false;
  let closing: Promise<void> | undefined;
  const closeContext = () => closing ??= context.close().catch(() => undefined);
  try {
    await context.clearCookies();
    await context.addCookies(cookies);
    const page = await context.newPage();
    page.on("framenavigated", frame => {
      if (frame === page.mainFrame() && blockedLoginUrl(frame.url())) {
        blocked = true;
        void closeContext();
      }
    });
    const timeout = opts.timeoutMs ?? 45000;
    page.setDefaultTimeout(timeout);
    await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded", timeout });
    if (blockedLoginUrl(page.url())) { await closeContext(); return { ok: false, reason: "checkpoint_or_login_required" }; }
    // Cookie presence and generic navigation alone never prove authentication.
    await page.getByRole("button", { name: /Your profile|Account|โปรไฟล์ของคุณ|บัญชีของคุณ/i }).first()
      .waitFor({ state: "visible", timeout: Math.min(timeout, 5000) }).catch(() => undefined);
    if (blockedLoginUrl(page.url())) { await closeContext(); return { ok: false, reason: "checkpoint_or_login_required" }; }
    const session = await checker.inspect(page, context, userId);
    if (blocked || session.status !== "online") {
      await closeContext();
      return { ok: false, reason: blocked || ["checkpoint", "expired"].includes(session.status) ? "checkpoint_or_login_required" : "session_rejected" };
    }
    return { ok: true, userId, page, context, profileDir, session };
  } catch {
    await closeContext();
    return { ok: false, reason: blocked ? "checkpoint_or_login_required" : "navigation_failed" };
  }
}
export async function loginWithCookies(opts: CookieLoginOptions): Promise<CookieLoginResult> {
  let cookies: CookieMap;
  try { cookies = parseCookieString(opts.cookieRaw); } catch { return { ok: false, reason: "invalid_cookie" }; }
  if (!hasCoreSession(cookies)) return { ok: false, reason: "missing_c_user_or_xs" };
  return openCookieSession(toPlaywrightCookies(cookies), cookies.c_user, opts);
}
export async function injectAndClose(opts: CookieLoginOptions) {
  const result = await loginWithCookies(opts);
  if (!result.ok) return result;
  try { return { ok: true as const, userId: result.userId, profileDir: result.profileDir }; }
  finally { await result.context.close(); }
}

/** Compatibility wrapper for encrypted Electron account persistence. */
export class CookieLogin {
  constructor(private readonly vault: SecretVault, private readonly checker: SessionChecker) {}
  async verify(candidate: CookieCandidate, profilePath: string, headless = true, proxyUrl?: string) {
    const result = await openCookieSession(candidate.cookies, candidate.userId, { userDataDir: profilePath, headless, proxy: proxyUrl ? { server: proxyUrl } : undefined }, this.checker);
    if (!result.ok) {
      const session: SessionResult = { status: result.reason === "checkpoint_or_login_required" ? "checkpoint" : "unknown", reason: result.reason,
        message: `${result.reason} · ${result.reason === "checkpoint_or_login_required" ? "หยุดแล้ว ให้เจ้าของบัญชียืนยันที่ Facebook และนำเข้า Cookie ใหม่" : result.reason === "browser_unavailable" ? "ตรวจ Chrome และปิดโปรแกรมที่ใช้โปรไฟล์บัญชีนี้อยู่" : "ยืนยัน Session ไม่สำเร็จ ตรวจ Cookie หรือเครือข่าย ไม่เริ่มโพสต์"}`, checkedAt: new Date().toISOString() };
      return { session, encryptedCookies: this.vault.encryptCookies(JSON.stringify(candidate.cookies)), format: candidate.format };
    }
    try {
      return { session: { ...result.session, reason: undefined }, encryptedCookies: this.vault.encryptCookies(JSON.stringify(await result.context.cookies("https://www.facebook.com/"))), format: candidate.format };
    } finally { await result.context.close(); }
  }
}
