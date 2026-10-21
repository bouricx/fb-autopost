import { expect, it } from "vitest";
import { verifiedComment } from "../electron/automation/comment-composer";
it("does not confuse old comments or draft editor text with a new published comment", () => {
  const evidence = { newNode: true, authorMatches: true, text: "++", mediaCount: 1, permalink: null };
  expect(verifiedComment(evidence, "++", true)).toBe(true);
  expect(verifiedComment({ ...evidence, newNode: false }, "++", true)).toBe(false);
  expect(verifiedComment({ ...evidence, authorMatches: false }, "++", true)).toBe(false);
  expect(verifiedComment({ ...evidence, mediaCount: 0 }, "++", true)).toBe(false);
  expect(verifiedComment(evidence, "", true)).toBe(true);
});
