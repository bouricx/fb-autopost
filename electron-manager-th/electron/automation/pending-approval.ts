import type { Page } from "playwright-core";
export const pendingApprovalText = /pending (?:admin )?approval|awaiting approval|submitted for approval|รอ(?:การ)?อนุมัติ|ส่งให้ผู้ดูแลอนุมัติ|โพสต์ของคุณอยู่ระหว่างการตรวจสอบ/i;
export async function isPendingApprovalDetected(page: Page): Promise<boolean> {
  // Never scan ancestor div text: an unrelated feed post can mention approval.
  const messages = await page.locator('[role="alert"]:visible,[role="status"]:visible,[role="dialog"]:visible').allTextContents().catch(() => []);
  const personal = await page.getByText(/your post is pending|your post.{0,40}submitted for approval|โพสต์ของคุณ.{0,50}(รอ|ตรวจสอบ)|ส่งโพสต์ของคุณ.{0,30}อนุมัติ/i).evaluateAll(nodes => nodes.filter(node => !node.closest('[role="article"]')).map(node => node.textContent || "")).catch(() => []);
  return [...messages, ...personal].some(text => text.length < 1500 && pendingApprovalText.test(text));
}
