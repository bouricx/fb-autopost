import type { Locator, Page } from "playwright-core";
import { ActionBlockedError } from "./contracts";

export async function findCommentComposer(post: Locator, page: Page, timeout = 15_000): Promise<Locator> {
  let opened = false;
  const deadline = Date.now() + timeout;
  do {
    const candidates = post.locator('[contenteditable="true"],textarea');
    for (let index = 0; index < await candidates.count(); index++) {
      const item = candidates.nth(index);
      const label = [await item.getAttribute("aria-label"), await item.getAttribute("aria-placeholder"), await item.getAttribute("placeholder")].filter(Boolean).join(" ");
      if (/reply|ตอบกลับ/i.test(label)) continue;
      if (/comment|แสดงความคิดเห็น|เขียนความคิดเห็น/i.test(label) && await item.isVisible() && await item.isEditable()) return item;
    }
    const text = await post.innerText().catch(() => "");
    if (/comments? (?:are|is) turned off|turned off commenting|ปิด(?:การแสดง)?ความคิดเห็น|ไม่สามารถแสดงความคิดเห็นในโพสต์นี้/i.test(text)) throw new ActionBlockedError("โพสต์นี้แจ้งว่าปิดความคิดเห็นหรือไม่อนุญาตให้แสดงความคิดเห็น");
    if (!opened) {
      const controls = post.getByRole("button", { name: /^(Comment|Comments?|แสดงความคิดเห็น|ความคิดเห็น)(?:\s*\d.*)?$/i });
      for (let index = 0; index < await controls.count(); index++) {
        const control = controls.nth(index);
        if (await control.isVisible() && await control.isEnabled()) { await control.click(); opened = true; break; }
      }
    }
    await page.waitForTimeout(300);
  } while (Date.now() < deadline);
  throw new ActionBlockedError(opened ? "เปิดส่วนความคิดเห็นแล้ว แต่ยังไม่พบช่องพิมพ์ที่ใช้งานได้ อาจโหลดไม่เสร็จหรือรูปแบบ Facebook เปลี่ยน" : "ไม่พบช่องหรือปุ่มเปิดความคิดเห็นในโพสต์เป้าหมาย ยังไม่ยืนยันว่าโพสต์ปิดความคิดเห็น กรุณาตรวจสิทธิ์หรือรูปแบบหน้าเว็บ");
}

export interface CommentEvidence { newNode: boolean; authorMatches: boolean; text: string; mediaCount: number; permalink: string | null }
export function verifiedComment(evidence: CommentEvidence, caption: string, hasImage: boolean): boolean {
  const clean = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim();
  return evidence.newNode && evidence.authorMatches && (!caption.trim() || clean(evidence.text).includes(clean(caption))) && (!hasImage || evidence.mediaCount > 0);
}
