import { expect, it } from "vitest";
import { inspectFacebookIdentity, profileIdFromUrl } from "../electron/accounts/facebook-identity";
import type { BrowserContext, Page } from "playwright-core";

it("recognizes only Facebook numeric profile links, not groups or external hosts", () => {
  expect(profileIdFromUrl("https://www.facebook.com/profile.php?id=61594298519117")).toBe("61594298519117");
  expect(profileIdFromUrl("https://www.facebook.com/61594298519117/")).toBe("61594298519117");
  expect(profileIdFromUrl("https://www.facebook.com/groups/61594298519117/")).toBeNull();
  expect(profileIdFromUrl("https://www.facebook.com.evil.example/profile.php?id=61594298519117")).toBeNull();
});

it("never invents an identity when the authenticated id and profile link disagree", async () => {
  const page = {
    getByRole: () => ({ first: () => ({ isVisible: async () => true }) }),
    locator: () => ({ evaluateAll: async () => [{ url: "https://www.facebook.com/profile.php?id=123456", name: "Wrong", photoUrl: "https://example.com/a.jpg" }] }),
  } as unknown as Page;
  const context = { cookies: async () => [{ name: "c_user", value: "987654" }] } as unknown as BrowserContext;
  expect(await inspectFacebookIdentity(page, context)).toBeNull();
  expect(await inspectFacebookIdentity(page, context, "123456")).toBeNull();
});
