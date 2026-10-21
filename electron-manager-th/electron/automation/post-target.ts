import type { Locator, Page } from "playwright-core";
import { ActionBlockedError } from "./contracts";

export function postIdentity(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !/(^|\.)facebook\.com$/.test(url.hostname)) return null;
    const story = url.searchParams.get("story_fbid");
    if (story && /^[\w.-]+$/.test(story)) return story;
    const match = url.pathname.match(/\/(?:posts|permalink)\/([\w.-]+)(?:\/|$)/);
    return match?.[1] || null;
  } catch { return null; }
}

export interface PostCandidate { index: number; nested: boolean; links: string[]; actionable: boolean; kind: string }
export function choosePostCandidate(candidates: PostCandidate[], target: string, currentUrl: string): number | null {
  const identity = postIdentity(target);
  if (!identity) return null;
  const articles = candidates.filter(candidate => candidate.kind === "article" && !candidate.nested && candidate.actionable);
  const matching = articles.filter(candidate => candidate.links.some(link => postIdentity(link) === identity));
  if (matching.length === 1) return matching[0].index;
  if (matching.length > 1) return null;
  // A permalink page may omit its timestamp link. Never use this fallback on a feed or redirect.
  if (postIdentity(currentUrl) === identity && articles.length === 1 && !articles[0].links.some(link => {
    const linked = postIdentity(link); return linked !== null && linked !== identity;
  })) return articles[0].index;
  const dialogs = candidates.filter(candidate => candidate.kind === "dialog" && candidate.actionable &&
    candidate.links.some(link => postIdentity(link) === identity));
  return dialogs.length === 1 ? dialogs[0].index : null;
}

export async function resolvePostTarget(page: Page, targetUrl: string, timeout = 15_000): Promise<Locator> {
  if (!postIdentity(targetUrl)) throw new ActionBlockedError("ต้องใช้ลิงก์ถาวรของโพสต์ เช่น /posts/… หรือ permalink ไม่ใช้ลิงก์หน้ากลุ่ม/Feed");
  const candidates = page.locator('[role="article"]:visible,[role="dialog"]:visible');
  const deadline = Date.now() + timeout;
  do {
    const metadata = await candidates.evaluateAll(nodes => nodes.map((node, index) => {
      const kind = node.getAttribute("role") || "";
      const articleParent = node.parentElement?.closest('[role="article"]');
      const links = [...node.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(anchor =>
        kind === "dialog" || anchor.closest('[role="article"]') === node).map(anchor => anchor.href);
      const buttons = [...node.querySelectorAll('[role="button"],button,[contenteditable="true"]')].filter(button =>
        kind === "dialog" || button.closest('[role="article"]') === node);
      return { index, kind, nested: !!articleParent, links, actionable: buttons.some(button => {
        const text = `${button.getAttribute("aria-label") || ""} ${button.getAttribute("aria-placeholder") || ""} ${button.textContent || ""}`;
        return /like|unlike|comment|share|ถูกใจ|แสดงความคิดเห็น|เขียนความคิดเห็น|แชร์/i.test(text);
      }) };
    }));
    const index = choosePostCandidate(metadata, targetUrl, page.url());
    if (index !== null) return candidates.nth(index);
    await page.waitForTimeout(300);
  } while (Date.now() < deadline);
  throw new ActionBlockedError("ยังระบุโพสต์ตามลิงก์ถาวรไม่ได้หลังรอโหลด หยุดเพื่อไม่ทำงานผิดโพสต์ กรุณาตรวจว่าโพสต์เข้าถึงได้หรือรออนุมัติอยู่");
}
