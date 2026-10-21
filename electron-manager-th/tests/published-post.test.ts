import { expect, it } from "vitest";
import { verifyPublishedPost, canonicalPostUrl } from "../electron/automation/published-post";
it("requires new identity, correct group, caption, author and media evidence", () => {
  const evidence = { url: "https://www.facebook.com/groups/1/posts/2/?tracking=abc", text: "ข้อความหลัก", authors: [{ name: "บัญชี", url: "https://www.facebook.com/profile.php?id=123" }], mediaCount: 1 };
  const expected = { destination: "https://www.facebook.com/groups/1/", caption: "ข้อความหลัก", accountName: "บัญชี", userId: "123", mediaCount: 1 };
  expect(verifyPublishedPost(evidence, expected, new Set())).toBe(true);
  expect(verifyPublishedPost(evidence, expected, new Set(["2"]))).toBe(false);
  expect(verifyPublishedPost({ ...evidence, text: "โพสต์อื่น" }, expected, new Set())).toBe(false);
  expect(verifyPublishedPost({ ...evidence, url: "https://www.facebook.com/groups/9/posts/2/" }, expected, new Set())).toBe(false);
  expect(verifyPublishedPost({ ...evidence, authors: [] }, expected, new Set())).toBe(false);
  expect(verifyPublishedPost({ ...evidence, mediaCount: 0 }, expected, new Set())).toBe(false);
  expect(canonicalPostUrl(evidence.url)).toBe("https://www.facebook.com/groups/1/posts/2/");
});
