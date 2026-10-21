import { describe, expect, it } from "vitest";
import { choosePostCandidate, postIdentity, type PostCandidate } from "../electron/automation/post-target";
const target = "https://www.facebook.com/groups/123/posts/456/";
const article = (index: number, links: string[], nested = false): PostCandidate => ({ index, links, nested, actionable: true, kind: "article" });
describe("permalink target resolution", () => {
  it("normalizes tracking parameters and mobile permalink variants", () => {
    expect(postIdentity(`${target}?comment_id=99`)).toBe("456");
    expect(postIdentity("https://m.facebook.com/story.php?story_fbid=456&id=123")).toBe("456");
    expect(postIdentity("https://www.facebook.com/permalink/456/")).toBe("456");
    expect(postIdentity("https://evil.example/posts/456")).toBeNull();
    expect(postIdentity("https://www.facebook.com/groups/123/")).toBeNull();
  });
  it("matches exact post despite nested comment articles and recommended posts", () => {
    expect(choosePostCandidate([article(0, [target]), article(1, [target], true), article(2, ["https://www.facebook.com/posts/999/"])], target, target)).toBe(0);
  });
  it("accepts a single top-level article without its timestamp link only on the same permalink", () => {
    expect(choosePostCandidate([article(0, []), article(1, [], true)], target, target)).toBe(0);
    expect(choosePostCandidate([article(0, [])], target, "https://www.facebook.com/groups/123/")).toBeNull();
  });
  it("does not guess among ambiguous roots or a different recommended post", () => {
    expect(choosePostCandidate([article(0, [target]), article(1, [target])], target, target)).toBeNull();
    expect(choosePostCandidate([article(0, ["https://www.facebook.com/posts/999/"])], target, target)).toBeNull();
    expect(choosePostCandidate([], target, target)).toBeNull();
  });
  it("supports an explicitly matching post dialog", () => {
    expect(choosePostCandidate([{ ...article(3, [target]), kind: "dialog" }], target, target)).toBe(3);
  });
});
