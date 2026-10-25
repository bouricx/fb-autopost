import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type BrowserContext } from "playwright-core";
import { findCommentComposer } from "../electron/automation/comment-composer";
let context: BrowserContext;
beforeAll(async () => {
  const browser = await chromium.launch({ ...(process.env.AUTOPOST_TEST_CHROME ? { executablePath: process.env.AUTOPOST_TEST_CHROME } : { channel: "chrome" }), headless: true,
    args: process.env.AUTOPOST_TEST_NO_SANDBOX === "1" ? ["--no-sandbox"] : [] });
  context = await browser.newContext();
}, 30000);
afterAll(async () => { await context?.browser()?.close(); });
it("opens the comment editor of the target post, never a background editor or reply", async () => {
  const page = await context.newPage();
  try {
    await page.setContent(`<div contenteditable="true" aria-label="Write a comment">background</div><div id="target" role="article"><button id="open">Comment</button><div role="article"><div contenteditable="true" aria-label="Reply to someone"></div></div><div id="editor" contenteditable="true" aria-label="Write a comment" style="display:none"></div></div>`);
    await page.locator('#open').evaluate(node => { node.addEventListener('click', () => { (document.querySelector('#editor') as HTMLElement).style.display = 'block'; }); });
    const editor = await findCommentComposer(page.locator('#target'), page, 2000);
    expect(await editor.getAttribute('id')).toBe('editor');
    await editor.fill('local fixture only');
    expect(await page.locator('body>div[contenteditable]').innerText()).toBe('background');
  } finally { await page.close(); }
});
it("reports explicit disabled comments separately from missing selectors", async () => {
  const page = await context.newPage();
  try {
    await page.setContent('<div role="article">Comments are turned off</div>');
    await expect(findCommentComposer(page.getByRole('article'), page, 100)).rejects.toThrow('ปิดความคิดเห็น');
    await page.setContent('<div role="article">Loading post</div>');
    await expect(findCommentComposer(page.getByRole('article'), page, 100)).rejects.toThrow('ยังไม่ยืนยันว่าโพสต์ปิดความคิดเห็น');
  } finally { await page.close(); }
});
