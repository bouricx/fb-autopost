import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Page, Locator } from "playwright-core";
import type { Account } from "../../src/shared/types";
import { FacebookBrowserAdapter } from "../adapters/facebook-browser";
import { AuthenticationError } from "../core/errors";
import { ActionBlockedError, UncertainResultError, type ActionPayload, type ActionKind } from "./contracts";
import { verifyPublishedPost, canonicalPostUrl } from "./published-post";
import { postIdentity } from "./post-target";
import { resolvePostTarget } from "./post-target";
import { findCommentComposer, verifiedComment } from "./comment-composer";
import { isPendingApprovalDetected } from "./pending-approval";
import { FEATURES, assertActionEnabled, type FeatureFlags } from "../../src/shared/features";

async function visible(locator: Locator): Promise<Locator | null> {
  for (let index = 0; index < Math.min(await locator.count(), 30); index++) {
    const item = locator.nth(index);
    if (await item.isVisible() && !await item.evaluate(node => {
      const article = node.closest('[role="article"]');
      return !!article?.parentElement?.closest('[role="article"]');
    })) return item;
  }
  return null;
}

export async function assertFacebookReady(page: Page) {
  const url = new URL(page.url());
  if (!/(^|\.)facebook\.com$/.test(url.hostname)) throw new ActionBlockedError("หน้าเว็บไม่ใช่ Facebook");
  if (/checkpoint|challenge|login|two_step_verification/.test(url.pathname)) throw new AuthenticationError("Facebook ต้องยืนยันตัวตน กรุณาเปิด Chrome เพื่อดำเนินการเอง");
  if (await page.locator('input[name="email"],iframe[src*="captcha"],input[name*="captcha"]').first().isVisible().catch(() => false)) throw new AuthenticationError("พบหน้าล็อกอินหรือ CAPTCHA หยุดงานบัญชีนี้");
  const text = (await page.locator('h1,h2,[role="alert"]').allTextContents()).join(" ");
  if (/บัญชี.{0,40}(ถูกจำกัด|ถูกระงับ|ถูกปิด)|account.{0,40}(restricted|suspended|disabled)|confirm your identity|ยืนยันตัวตน/i.test(text)) throw new AuthenticationError("Facebook แจ้งจำกัดหรือยืนยันบัญชี หยุดงานทั้งหมดของบัญชีนี้");
}

export class FacebookActions {
  constructor(private adapter: FacebookBrowserAdapter, private screenshots: string, private readonly features: FeatureFlags = FEATURES) {}
  async execute(kind: Exclude<ActionKind, "post">, account: Account, payload: ActionPayload, report: (message: string, percent: number) => void, onSubmitting?: () => void) {
    if (!this.features[kind]) assertActionEnabled(kind);
    return this.adapter.withActionPage({ ...account, headless: payload.headless === null ? account.headless : Number(payload.headless) }, async page => {
      let submitted = false;
      const beforeShares = new Set<string>();
      try {
        if (account.cookieManaged && account.sessionStatus !== "online" || ["expired", "restricted", "checkpoint", "disabled"].includes(account.sessionStatus || "")) throw new AuthenticationError("Session ไม่พร้อม กรุณาตรวจบัญชีก่อนเริ่มงาน");
        const actor = (await page.context().cookies("https://www.facebook.com/")).find(cookie => cookie.name === "c_user")?.value;
        if (!actor || !/^\d{5,}$/.test(actor) || account.facebookUserId && account.facebookUserId !== actor) throw new AuthenticationError("Session Facebook ไม่ตรงกับบัญชีที่เลือก กรุณาตรวจสอบ Session");
        if (kind === "share") {
          await page.goto(payload.targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
          await assertFacebookReady(page);
          const links = await page.locator('a[href*="/posts/"],a[href*="/permalink/"],a[href*="story_fbid="]').evaluateAll(nodes => nodes.map(node => (node as HTMLAnchorElement).href));
          links.forEach(link => { const id = postIdentity(link); if (id) beforeShares.add(id); });
        }
        await page.goto(kind === "share" ? payload.sourceUrl || payload.targetUrl : payload.targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
        await assertFacebookReady(page);
        report("กำลังรอและค้นหาโพสต์ตามลิงก์ถาวร", 10);
        const post = await resolvePostTarget(page, kind === "share" ? payload.sourceUrl || payload.targetUrl : payload.targetUrl);
        await assertFacebookReady(page);
        report("เปิดโพสต์แล้ว กำลังตรวจสอบสิทธิ์", 20);
        if (kind === "like") {
          const unlike = await visible(post.getByRole("button", { name: /^(Unlike|เลิกถูกใจ)$/i }));
          if (unlike) return { status: "published" as const, url: page.url(), message: "ถูกใจอยู่แล้ว ไม่กดซ้ำ" };
          const button = await visible(post.getByRole("button", { name: /^(Like|ถูกใจ)$/i }));
          if (!button) throw new ActionBlockedError("ไม่พบปุ่มถูกใจที่ใช้งานได้");
          await assertFacebookReady(page); submitted = true; onSubmitting?.(); await button.click();
          await post.getByRole("button", { name: /^(Unlike|เลิกถูกใจ)$/i }).first().waitFor({ state: "visible", timeout: 15000 });
          return { status: "published" as const, url: page.url(), message: "ถูกใจสำเร็จ" };
        }
        if (kind === "comment") {
          if (!payload.caption.trim() && !payload.media.length) throw new ActionBlockedError("กรุณาระบุข้อความหรือรูปสำหรับความคิดเห็น");
          if (payload.media.length > 1) throw new ActionBlockedError("แต่ละความคิดเห็นรองรับรูปหนึ่งไฟล์");
          report("กำลังเปิดช่องความคิดเห็นของโพสต์นี้", 35);
          const commentEditor = await findCommentComposer(post, page);
          const container = commentEditor.locator('xpath=ancestor::*[.//input[@type="file"]][1]');
          if (payload.media.length) {
            if (!await container.count()) throw new ActionBlockedError("ไม่พบช่องแนบรูปความคิดเห็นในโพสต์นี้");
            await container.locator('input[type="file"]').first().setInputFiles(payload.media);
            await page.waitForTimeout(1500);
          }
          if (payload.caption) await commentEditor.fill(payload.caption);
          const marker = crypto.randomUUID();
          await post.locator('[role="article"]').evaluateAll((nodes, token) => { for (const node of nodes) node.setAttribute("data-autopost-existing", token); }, marker);
          const userId = (await page.context().cookies("https://www.facebook.com/")).find(cookie => cookie.name === "c_user")?.value || "";
          report("เตรียมความคิดเห็นแล้ว กำลังส่ง", 60);
          await assertFacebookReady(page);
          submitted = true; onSubmitting?.(); await commentEditor.press("Enter");
          for (let attempt = 0; attempt < 40; attempt++) {
            await assertFacebookReady(page);
            const evidence = await post.locator('[role="article"]:visible').evaluateAll((nodes, options) => nodes.map(node => {
              const anchors = [...node.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(anchor => anchor.closest('[role="article"]') === node);
              const authorMatches = anchors.some(anchor => {
                const text = (anchor.textContent || "").replace(/\s+/g, " ").trim();
                try { const url = new URL(anchor.href); if (options.userId && (url.searchParams.get("id") === options.userId || url.pathname.split("/").includes(options.userId))) return true; } catch { /* Ignore invalid profile link. */ }
                return !!options.name && text === options.name;
              });
              const clone = node.cloneNode(true) as HTMLElement;
              clone.querySelectorAll('[contenteditable],textarea,[role="article"]').forEach(item => item.remove());
              const link = anchors.find(anchor => new URL(anchor.href).searchParams.has("comment_id"));
              return { newNode: node.getAttribute("data-autopost-existing") !== options.marker, authorMatches, text: clone.textContent || "",
                mediaCount: [...node.querySelectorAll('img')].filter(image => image.closest('[role="article"]') === node && image.getBoundingClientRect().width >= 80 && image.getBoundingClientRect().height >= 80).length,
                permalink: link?.href || null };
            }), { marker, userId, name: account.name.replace(/\s+/g, " ").trim() });
            const confirmed = evidence.filter(item => verifiedComment(item, payload.caption, payload.media.length > 0));
            if (confirmed.length === 1) return { status: "published" as const, url: confirmed[0].permalink || page.url(), message: "ตรวจพบความคิดเห็นใหม่ตรงข้อความ/รูปและบัญชีในโพสต์เป้าหมายแล้ว" };
            await page.waitForTimeout(500);
          }
          throw new UncertainResultError("ส่งความคิดเห็นแล้วแต่ยังยืนยันความคิดเห็นใหม่พร้อมผู้เขียนและสื่อไม่ได้ หยุดเพื่อป้องกันส่งซ้ำ กรุณาตรวจโพสต์");
        }
        // Native sharing keeps the original post/media. Replacement images require a new post, not a native share.
        if (payload.media.length) throw new ActionBlockedError("Facebook Share ไม่รองรับเปลี่ยนรูปต้นฉบับ กรุณาใช้หน้าโพสต์พร้อมลิงก์ต้นฉบับสำหรับเนื้อหาและรูปใหม่");
        const share = await visible(post.getByRole("button", { name: /^(Share|แชร์)$/i }));
        if (!share) throw new ActionBlockedError("โพสต์นี้ไม่มีปุ่มแชร์ หรือไม่มีสิทธิ์แชร์");
        await share.click();
        const toGroup = await visible(page.getByText(/^(Share to a group|แชร์ไปยังกลุ่ม|แชร์ไปที่กลุ่ม)$/i));
        if (!toGroup) throw new ActionBlockedError("Facebook ไม่แสดงตัวเลือกแชร์ไปกลุ่มสำหรับโพสต์นี้");
        await toGroup.click();
        const dialog = page.getByRole("dialog").last();
        const search = await visible(dialog.getByRole("textbox"));
        if (!search || !payload.groupName) throw new ActionBlockedError("ไม่พบช่องค้นหากลุ่ม กรุณาตรวจชื่อกลุ่ม");
        await search.fill(payload.groupName);
        const group = dialog.getByText(payload.groupName, { exact: true });
        await group.first().waitFor({ state: "visible" });
        if (await group.count() !== 1) throw new ActionBlockedError("พบชื่อกลุ่มซ้ำ ไม่เลือกกลุ่มโดยเดา กรุณาแชร์ด้วยตนเอง");
        const expectedGroup = new URL(payload.targetUrl).pathname.match(/^\/groups\/([^/]+)/)?.[1];
        const groupLinks = await group.evaluate(node => {
          const option = node.closest('a,[role="option"],[role="button"],button') || node.parentElement || node;
          const anchors = [...option.querySelectorAll<HTMLAnchorElement>('a[href]')];
          if (option instanceof HTMLAnchorElement) anchors.push(option);
          return anchors.map(anchor => anchor.href);
        });
        if (!expectedGroup || !groupLinks.some(link => {
          try { const url = new URL(link); return /(^|\.)facebook\.com$/.test(url.hostname) && url.pathname.match(/^\/groups\/([^/]+)/)?.[1] === expectedGroup; } catch { return false; }
        })) throw new ActionBlockedError("Facebook ไม่แสดงลิงก์ยืนยันรหัสกลุ่มในตัวเลือกแชร์ หยุดก่อนส่งเพื่อไม่แชร์ผิดกลุ่ม ใช้สร้างโพสต์พร้อมลิงก์ต้นฉบับแทนได้");
        await group.click();
        const composer = page.getByRole("dialog").last();
        if (payload.caption) {
          const input = await visible(composer.locator('[contenteditable="true"]'));
          if (!input) throw new ActionBlockedError("ไม่พบช่องข้อความสำหรับแชร์");
          await input.fill(payload.caption);
        }
        await assertFacebookReady(page);
        const submit = await visible(composer.getByRole("button", { name: /^(Post|Share now|โพสต์|แชร์เลย)$/i }));
        if (!submit || !await submit.isEnabled()) throw new ActionBlockedError("กลุ่มนี้ยังไม่อนุญาตให้แชร์หรือปุ่มส่งยังไม่พร้อม");
        report("ตรวจพบปุ่มแชร์ที่ใช้งานได้ กำลังส่ง", 70);
        submitted = true; onSubmitting?.(); await submit.click();
        await composer.waitFor({ state: "hidden", timeout: 30000 });
        await assertFacebookReady(page);
        if (this.features.pendingApprovalDetector && await isPendingApprovalDetected(page)) return { status: "pending_approval" as const, url: payload.targetUrl, message: "ส่งแชร์แล้ว แต่รอการอนุมัติจากกลุ่ม" };
        // A dismissed dialog is not proof of a published share. Verify a new post in the target group,
        // from this account, referencing the original post. Never retry an ambiguous submission.
        await page.goto(payload.targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
        const userId = (await page.context().cookies("https://www.facebook.com/")).find(cookie => cookie.name === "c_user")?.value;
        const sourceIdentity = postIdentity(payload.sourceUrl || "");
        for (let attempt = 0; attempt < 15; attempt++) {
          await assertFacebookReady(page);
          if (await isPendingApprovalDetected(page)) return { status: "pending_approval" as const, url: payload.targetUrl, message: "ส่งแชร์แล้ว รออนุมัติจากกลุ่ม — ไปกลุ่มถัดไป" };
          const evidence = await page.locator('[role="article"]:visible').evaluateAll(nodes => nodes.filter(node => !node.parentElement?.closest('[role="article"]')).flatMap(node => {
            const links = [...node.querySelectorAll<HTMLAnchorElement>('a[href]')];
            const own = links.filter(anchor => anchor.closest('[role="article"]') === node);
            const authors = own.map(anchor => ({ name: anchor.textContent?.trim() || "", url: anchor.href }));
            return own.filter(anchor => /\/posts\/|\/permalink\/|story_fbid=/.test(anchor.href)).map(anchor => ({ url: anchor.href, text: (node as HTMLElement).innerText, authors, mediaCount: 0, references: links.map(link => link.href) }));
          }));
          const matches = evidence.filter(item => sourceIdentity && item.references.some(link => postIdentity(link) === sourceIdentity) && verifyPublishedPost(item,
            { destination: payload.targetUrl, caption: payload.caption, accountName: account.facebookName || "", userId, mediaCount: 0 }, beforeShares));
          const urls = [...new Set(matches.map(item => canonicalPostUrl(item.url)))];
          if (urls.length === 1) return { status: "published" as const, url: urls[0], message: "ยืนยันโพสต์แชร์ใหม่ในกลุ่ม พร้อมบัญชีและลิงก์ต้นฉบับแล้ว" };
          await page.waitForTimeout(1000);
        }
        throw new UncertainResultError("ส่งแชร์แล้วแต่ยังยืนยันโพสต์ใหม่ในกลุ่มไม่ได้ กรุณาตรวจ Facebook จะไม่แชร์ซ้ำอัตโนมัติ");
      } catch (error) {
        await mkdir(this.screenshots, { recursive: true });
        const screenshot = join(this.screenshots, `action-${crypto.randomUUID()}.png`);
        await page.screenshot({ path: screenshot }).catch(() => undefined);
        if (error instanceof AuthenticationError || error instanceof ActionBlockedError || error instanceof UncertainResultError) throw Object.assign(error, { screenshot });
        if (submitted) throw Object.assign(new UncertainResultError("ส่งคำสั่งแล้วแต่ยืนยันผลไม่ได้ หยุดเพื่อป้องกันทำซ้ำ กรุณาตรวจ Facebook"), { screenshot });
        throw Object.assign(new Error("ดำเนินการไม่สำเร็จก่อนส่งคำสั่ง กรุณาตรวจเครือข่ายและโครงสร้างหน้า Facebook"), { screenshot });
      }
    });
  }
}
