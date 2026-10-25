import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright-core";
import type { Account } from "../../src/shared/types";
import type { FacebookGroupInfo } from "../../src/shared/types";
import type { PlatformAdapter, PublishContext, PublishResult } from "./types";
import { AuthenticationError, isProfileBusy, ProfileBusyError } from "../core/errors";
import { RetryableBeforeSubmitError, UncertainResultError } from "../automation/contracts";
import { postIdentity } from "../automation/post-target";
import { canonicalPostUrl, verifyPublishedPost } from "../automation/published-post";
import { isPendingApprovalDetected } from "../automation/pending-approval";
import { FEATURES } from "../../src/shared/features";
import { mergeDiscoveredGroups } from "../automation/group-image";
import { dnsFailureCode, NetworkUnavailableError } from "../core/network-safety";

const COMPOSER_TEXT = /เขียนอะไร|คุณกำลังคิดอะไร|สร้างโพสต์|Write something|What's on your mind|Create post/i;
const PHOTO_TEXT = /รูปภาพ|วิดีโอ|Photo|video/i;
const POST_TEXT = /^(โพสต์|Post)$/i;
const POST_DIALOG_TEXT = /สร้างโพสต์|Create post/i;
const COMMENT_TEXT = /แสดงความคิดเห็น|Write a comment|Comment as/i;

async function firstVisible(candidates: Locator[]): Promise<Locator | null> {
  for (const candidate of candidates) {
    const count = await candidate.count();
    for (let index = 0; index < Math.min(count, 6); index++) {
      const item = candidate.nth(index);
      if (await item.isVisible().catch(() => false)) return item;
    }
  }
  return null;
}

export class FacebookBrowserAdapter implements PlatformAdapter {
  readonly type = "facebook-browser" as const;
  private contexts = new Map<string, BrowserContext>();
  private launching = new Set<string>();

  async closeAccount(id: string) {
    const context = this.contexts.get(id);
    if (context) await context.close();
    this.contexts.delete(id);
  }

  private async context(account: Account, visible = false): Promise<BrowserContext> {
    const existing = this.contexts.get(account.id);
    if (existing) return existing;
    if (this.launching.has(account.id)) throw new ProfileBusyError();
    if (!account.browserProfilePath) throw new Error("ไม่พบโฟลเดอร์ Chrome profile");
    const proxy = account.proxyUrl ? { server: account.proxyUrl } : undefined;
    this.launching.add(account.id);
    let context: BrowserContext;
    try { context = await chromium.launchPersistentContext(account.browserProfilePath, {
      channel: "chrome",
      headless: visible ? false : !!account.headless,
      proxy,
      viewport: { width: 1365, height: 900 },
      locale: "th-TH",
      timezoneId: "Asia/Bangkok",
      args: ["--disable-notifications"],
    }); } catch (error) {
      if (isProfileBusy(error)) throw new ProfileBusyError();
      throw error;
    } finally { this.launching.delete(account.id); }
    context.setDefaultTimeout(20_000);
    this.contexts.set(account.id, context);
    context.on("close", () => this.contexts.delete(account.id));
    return context;
  }

  async openLogin(account: Account): Promise<void> {
    const context = await this.context(account, true);
    const page = context.pages()[0] || await context.newPage();
    await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded" });
    await page.bringToFront();
  }

  async withActionPage<T>(account: Account, action: (page: Page) => Promise<T>): Promise<T> {
    if (this.contexts.has(account.id) || this.launching.has(account.id)) throw new ProfileBusyError();
    const browser = await this.context(account);
    try {
      const page = await browser.newPage();
      try { return await action(page); } finally { await page.close().catch(() => undefined); }
    } finally { await browser.close().catch(() => undefined); }
  }

  async publish(context: PublishContext): Promise<PublishResult> {
    if (this.contexts.has(context.account.id) || this.launching.has(context.account.id)) throw new ProfileBusyError();
    if (context.account.cookieManaged && context.account.sessionStatus !== "online") {
      throw new AuthenticationError("กรุณาตรวจสอบ Session Cookie ให้เป็นออนไลน์ก่อนเริ่มโพสต์");
    }
    if (["expired", "restricted", "checkpoint", "disabled"].includes(context.account.sessionStatus || "")) {
      throw new AuthenticationError("Session ไม่พร้อมใช้งาน กรุณาตรวจสอบและยืนยันตัวตนด้วยตนเอง");
    }
      const browser = await this.context(context.account);
      let page: Page | undefined;
      let submitted = false;
      try {
       page = await browser.newPage();
      if (!context.destination.url) throw new Error("Facebook URL ไม่ถูกต้อง");
      const target = new URL(context.destination.url);
      if (target.protocol !== "https:" || !["www.facebook.com", "facebook.com", "m.facebook.com"].includes(target.hostname) || target.username || target.password) {
        throw new Error("Facebook URL ไม่ถูกต้อง");
      }
      await page.goto(context.destination.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      if (/login|checkpoint/i.test(page.url())) throw new AuthenticationError("บัญชี Facebook ต้องล็อกอินหรือยืนยันตัวตน");
      await page.waitForTimeout(2_000);
      const dialog = await this.openComposer(page);
      const editor = await this.findComposerEditor(dialog);
      if (!editor) throw new Error("ไม่พบช่องเขียนโพสต์ Facebook");
      await editor.fill(context.job.caption);
      if (context.job.media.length) await this.attachMedia(page, dialog, context.job.media);
      const submit = await firstVisible([
        dialog.getByRole("button", { name: POST_TEXT }),
      ]);
      if (!submit) throw new Error("ไม่พบปุ่มโพสต์ Facebook");
      const before = new Set((await page.locator('a[href*="/posts/"],a[href*="/permalink/"],a[href*="story_fbid="]').evaluateAll(nodes => nodes.map(node => (node as HTMLAnchorElement).href))).map(postIdentity).filter((id): id is string => !!id));
       const userId = (await browser.cookies("https://www.facebook.com/")).find(cookie => cookie.name === "c_user")?.value;
       if (!userId || !/^\d{5,}$/.test(userId) || (context.account.facebookUserId && context.account.facebookUserId !== userId)) {
         throw new AuthenticationError("Session Facebook ไม่ตรงกับบัญชีนี้ กรุณาตรวจสอบ Session ก่อนโพสต์");
       }
      submitted = true;
      context.onSubmitting?.();
      await submit.click();
      try { await dialog.waitFor({ state: "hidden", timeout: 60_000 }); }
      catch { throw new UncertainResultError("กดโพสต์แล้วแต่ยืนยันผลไม่ได้ กรุณาตรวจ Facebook ก่อนลองใหม่เพื่อป้องกันโพสต์ซ้ำ"); }
      if (FEATURES.pendingApprovalDetector && await isPendingApprovalDetected(page)) {
        await mkdir(context.screenshotsDir, { recursive: true });
        const screenshot = join(context.screenshotsDir, `${context.job.id}-pending-approval-${Date.now()}.png`);
        await page.screenshot({ path: screenshot, fullPage: true });
        return { status: "pending_approval", message: "ส่งแล้ว แต่รอการอนุมัติจากกลุ่ม", screenshot };
      }
      {
        for (let attempt = 0; attempt < 10; attempt++) {
          const evidence = await page.locator('[role="article"]:visible').evaluateAll(nodes => nodes.filter(node => !node.parentElement?.closest('[role="article"]')).flatMap(node => {
            const anchors = [...node.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(anchor => anchor.closest('[role="article"]') === node);
            const authors = anchors.filter(anchor => !!anchor.textContent?.trim()).map(anchor => ({ name: anchor.textContent?.trim() || "", url: anchor.href }));
            const mediaCount = [...node.querySelectorAll('img')].filter(image => image.closest('[role="article"]') === node && image.getBoundingClientRect().width >= 100 && image.getBoundingClientRect().height >= 100).length;
            return anchors.filter(anchor => /\/posts\/|\/permalink\/|story_fbid=/.test(anchor.href)).map(anchor => ({ url: anchor.href, text: (node as HTMLElement).innerText, authors, mediaCount }));
          }));
           const verified = evidence.filter(item => verifyPublishedPost(item, { destination: context.destination.url!, caption: context.job.caption, accountName: context.account.facebookName || "", userId, mediaCount: context.job.media.length }, before));
          const urls = [...new Set(verified.map(item => canonicalPostUrl(item.url)))];
          if (urls.length === 1) {
            await mkdir(context.screenshotsDir, { recursive: true });
            const screenshot = join(context.screenshotsDir, `${context.job.id}-published-${Date.now()}.png`);
            await page.screenshot({ path: screenshot, fullPage: true });
            return { status: "published", permalink: urls[0], publishedUrl: urls[0], screenshot };
          }
          await page.waitForTimeout(1000);
        }
        throw new UncertainResultError("Facebook ปิดหน้าสร้างโพสต์แล้ว แต่ยังยืนยันลิงก์โพสต์ใหม่ไม่ได้ งานต่อเนื่องจะไม่เริ่ม กรุณาตรวจด้วยตนเอง");
      }
    } catch (error) {
      await mkdir(context.screenshotsDir, { recursive: true });
      const screenshot = join(context.screenshotsDir, `${context.job.id}-${Date.now()}.png`);
      await page?.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined);
      if (error instanceof Error) Object.assign(error, { screenshot });
      if (submitted && !(error instanceof UncertainResultError)) throw Object.assign(new UncertainResultError("ส่งคำสั่งโพสต์แล้วแต่ยืนยันผลไม่ได้ กรุณาตรวจ Facebook ก่อนลองใหม่"), { screenshot });
       const dnsCode = dnsFailureCode(error);
       if (!submitted && dnsCode) throw Object.assign(new NetworkUnavailableError("Facebook", dnsCode), { screenshot });
       if (!submitted && error instanceof Error && /net::ERR_|navigation.*timeout|page\.goto.*timeout/i.test(error.message)) throw Object.assign(new RetryableBeforeSubmitError("เครือข่ายผิดพลาดก่อนส่งโพสต์ ระบบจะลองใหม่"), { screenshot });
      throw error;
    } finally {
      await page?.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
      this.contexts.delete(context.account.id);
    }
  }

  private async openComposer(page: Page): Promise<Locator> {
    const opener = await firstVisible([
      page.getByRole("button", { name: COMPOSER_TEXT }),
      page.getByText(COMPOSER_TEXT, { exact: false }),
      page.locator('[role="button"]').filter({ hasText: COMPOSER_TEXT }),
    ]);
    if (!opener) throw new Error("ไม่พบกล่องสร้างโพสต์ Facebook หน้าเว็บอาจเปลี่ยนหรือบัญชีไม่มีสิทธิ์โพสต์");
    await opener.click();
    const dialogs = page.locator('[role="dialog"]:visible');
    await dialogs.first().waitFor({ state: "visible" });
    const count = await dialogs.count();
    for (let index = count - 1; index >= 0; index--) {
      const dialog = dialogs.nth(index);
      const text = await dialog.innerText().catch(() => "");
      if (POST_DIALOG_TEXT.test(text)) return dialog;
    }
    throw new Error("เปิดหน้าสร้างโพสต์แล้ว แต่ไม่พบ modal สร้างโพสต์");
  }

  private async findComposerEditor(dialog: Locator): Promise<Locator | null> {
    const editors = dialog.locator('[contenteditable="true"]');
    await editors.first().waitFor({ state: "visible", timeout: 20_000 }).catch(() => undefined);
    const count = await editors.count();
    for (let index = 0; index < count; index++) {
      const editor = editors.nth(index);
      const label = `${await editor.getAttribute("aria-label") || ""} ${await editor.getAttribute("aria-placeholder") || ""}`;
      if (!COMMENT_TEXT.test(label) && await editor.isVisible().catch(() => false)) return editor;
    }
    return null;
  }

  private async attachMedia(page: Page, dialog: Locator, media: string[]) {
    const input = dialog.locator('input[type="file"]').first();
    if (await input.count()) {
      await input.setInputFiles(media);
    } else {
      const button = await firstVisible([dialog.getByText(PHOTO_TEXT), dialog.getByRole("button", { name: PHOTO_TEXT })]);
      if (!button) throw new Error("ไม่พบปุ่มแนบรูป/วิดีโอ Facebook");
      const chooserPromise = page.waitForEvent("filechooser");
      await button.click();
      const chooser = await chooserPromise;
      await chooser.setFiles(media);
    }
    await page.waitForTimeout(Math.min(15_000, 1_500 + media.length * 1_000));
  }

  async close() {
    await Promise.allSettled([...this.contexts.values()].map((context) => context.close()));
    this.contexts.clear();
  }

  async discoverGroups(account: Account): Promise<FacebookGroupInfo[]> {
    if (this.contexts.has(account.id) || this.launching.has(account.id)) throw new ProfileBusyError();
    const browser = await this.context({ ...account, headless: 1 });
    let page: Page | undefined;
    try {
      page = await browser.newPage();
      await page.goto("https://www.facebook.com/groups/joins/?nav_source=tab&ordering=viewer_added", { waitUntil: "domcontentloaded", timeout: 60_000 });
      if (/login|checkpoint/i.test(page.url())) throw new AuthenticationError("บัญชี Facebook ต้องล็อกอินหรือยืนยันตัวตน");
      const identity = (await browser.cookies("https://www.facebook.com/")).find(cookie => cookie.name === "c_user")?.value;
      if (account.facebookUserId && identity !== account.facebookUserId) throw new AuthenticationError("Session Facebook ไม่ตรงบัญชีที่เลือก ไม่ดึงกลุ่มจากบัญชีอื่น");
      const found = new Map<string, FacebookGroupInfo>();
      let unchanged = 0;
      for (let round = 0; round < 25; round++) {
        await page.waitForTimeout(round === 0 ? 900 : 1100);
        const groups = await page.locator('a[href*="/groups/"]').evaluateAll((anchors) => {
        const ignored = new Set(["feed", "discover", "joins", "create", "notifications"]);
        const found = new Map<string, FacebookGroupInfo>();
        for (const node of anchors) {
          const anchor = node as HTMLAnchorElement;
          let parsed: URL;
          try { parsed = new URL(anchor.href); } catch { continue; }
          const match = parsed.pathname.match(/^\/groups\/([^/?#]+)/);
          const id = match?.[1];
          if (!id || ignored.has(id.toLowerCase())) continue;
          const name = (anchor.getAttribute("aria-label") || anchor.getAttribute("title") || anchor.textContent || "")
            .replace(/ใช้งานล่าสุด.*$/s, "").replace(/\s+/g, " ").trim();
          if (!name || name.length > 160) continue;
           const image = anchor.querySelector("img") as HTMLImageElement | null;
           const svgImage = anchor.querySelector("image");
           const rawImage = image?.currentSrc || image?.src || image?.getAttribute("data-src") || svgImage?.getAttribute("href") || svgImage?.getAttribute("xlink:href") || null;
           const imageUrl = rawImage && /^https:\/\//i.test(rawImage) ? rawImage : null;
          const url = `https://www.facebook.com/groups/${id}/`;
          const previous = found.get(id);
          if (!previous || (previous.imageUrl === null && imageUrl)) {
            found.set(id, { id, name, url, imageUrl, postPermission: "unknown", sharePermission: "unknown" });
          }
        }
        return [...found.values()];
        });
        unchanged = mergeDiscoveredGroups(found, groups) ? 0 : unchanged + 1;
        if (unchanged >= 5 && round >= 6) break;
        await page.evaluate(() => window.scrollTo(0, document.scrollingElement?.scrollHeight || document.body.scrollHeight));
      }
      return [...found.values()];
    } finally {
      await page?.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
      if (this.contexts.get(account.id) === browser) this.contexts.delete(account.id);
    }
  }
}
