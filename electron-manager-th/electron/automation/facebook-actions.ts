import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Page, Locator } from "playwright-core";
import type { Account } from "../../src/shared/types";
import { FacebookBrowserAdapter } from "../adapters/facebook-browser";
import { AuthenticationError } from "../core/errors";
import { ActionBlockedError, UncertainResultError, type ActionPayload, type ActionKind } from "./contracts";
import { resolvePostTarget } from "./post-target";
import { findCommentComposer, verifiedComment } from "./comment-composer";

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
  constructor(private adapter: FacebookBrowserAdapter, private screenshots: string) {}
  async execute(kind: Exclude<ActionKind, "post">, account: Account, payload: ActionPayload, report: (message: string, percent: number) => void, onSubmitting?: () => void) {
    return this.adapter.withActionPage({ ...account, headless: payload.headless === null ? account.headless : Number(payload.headless) }, async page => {
      let submitted = false;
      try {
        await page.goto(kind === "share" ? payload.sourceUrl || payload.targetUrl : payload.targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
        await assertFacebookReady(page);
        report("กำลังรอและค้นหาโพสต์ตามลิงก์ถาวร", 10);
        const post = await resolvePostTarget(page, kind === "share" ? payload.sourceUrl || payload.targetUrl : payload.targetUrl);
        await assertFacebookReady(page);
        report("เปิดโพสต์แล้ว กำลังตรวจสอบสิทธิ์", 20);
        if (kind === "like") {
          const unlike = await visible(post.getByRole("button", { name: /^(Unlike|เลิกถูกใจ)$/i }));
          if (unlike) return { url: page.url(), message: "ถูกใจอยู่แล้ว ไม่กดซ้ำ" };
          const button = await visible(post.getByRole("button", { name: /^(Like|ถูกใจ)$/i }));
          if (!button) throw new ActionBlockedError("ไม่พบปุ่มถูกใจที่ใช้งานได้");
          await assertFacebookReady(page); submitted = true; onSubmitting?.(); await button.click();
          await post.getByRole("button", { name: /^(Unlike|เลิกถูกใจ)$/i }).first().waitFor({ state: "visible", timeout: 15000 });
          return { url: page.url(), message: "ถูกใจสำเร็จ" };
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
            if (confirmed.length === 1) return { url: confirmed[0].permalink || page.url(), message: "ตรวจพบความคิดเห็นใหม่ตรงข้อความ/รูปและบัญชีในโพสต์เป้าหมายแล้ว" };
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
        return { url: payload.targetUrl, message: "Facebook รับคำสั่งแชร์แล้ว (อาจรออนุมัติจากกลุ่ม)" };
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
