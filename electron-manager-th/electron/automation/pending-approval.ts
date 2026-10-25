import type { Page } from "playwright-core";
export const pendingApprovalText = /pending (?:admin )?approval|awaiting approval|submitted for approval|รอ(?:การ)?อนุมัติ|ส่งให้ผู้ดูแลอนุมัติ|โพสต์ของคุณอยู่ระหว่างการตรวจสอบ/i;
export async function isPendingApprovalDetected(page: Page): Promise<boolean> {
  const text = (await page.locator('[role="alert"],[role="status"],h1,h2,span,div').filter({ hasText: pendingApprovalText }).allTextContents().catch(() => [])).join(" ");
  return pendingApprovalText.test(text);
}
