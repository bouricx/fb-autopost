import { expect, it } from "vitest";
import { canCreatePostFollowUps } from "../electron/automation/workflow-gate";
it("never creates follow-ups without explicit published status and a Facebook post permalink", () => {
  expect(canCreatePostFollowUps({ status: "published", permalink: "https://www.facebook.com/groups/1/posts/2/" })).toBe(true);
  expect(canCreatePostFollowUps({ status: "uncertain", permalink: "https://www.facebook.com/posts/2/" })).toBe(false);
  expect(canCreatePostFollowUps({ status: "pending_approval", permalink: "https://www.facebook.com/posts/2/" })).toBe(false);
  expect(canCreatePostFollowUps({ status: "published" })).toBe(false);
  expect(canCreatePostFollowUps({ status: "published", permalink: "https://www.facebook.com/groups/1/" })).toBe(false);
  expect(canCreatePostFollowUps({ status: "published", permalink: "https://evil.example/posts/2/" })).toBe(false);
});
