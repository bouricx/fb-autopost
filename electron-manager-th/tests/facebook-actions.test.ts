import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright-core";
import type { Account } from "../src/shared/types";
import type { FacebookBrowserAdapter } from "../electron/adapters/facebook-browser";
import { assertFacebookReady, FacebookActions } from "../electron/automation/facebook-actions";
import { actionPayloadSchema } from "../electron/automation/contracts";
vi.mock("../electron/automation/post-target", () => ({ resolvePostTarget: async (page: Page) => page.locator('[role="article"]:visible').first() }));

describe("Facebook action safeguards", () => {
  it("stops on checkpoint without interacting", async () => {
    const page = { url: () => "https://www.facebook.com/checkpoint/", locator: vi.fn() };
    await expect(assertFacebookReady(page as unknown as Page)).rejects.toThrow();
    expect(page.locator).not.toHaveBeenCalled();
  });
  it("stops when restriction or CAPTCHA is visible", async () => {
    const blocked = { url: () => "https://www.facebook.com/", locator: () => ({ first: () => ({ isVisible: async () => true }) }) };
    await expect(assertFacebookReady(blocked as unknown as Page)).rejects.toThrow();
    const restricted = { url: () => "https://www.facebook.com/", locator: (selector: string) => selector.startsWith("input")
      ? { first: () => ({ isVisible: async () => false }) } : { allTextContents: async () => ["Your account is restricted"] } };
    await expect(assertFacebookReady(restricted as unknown as Page)).rejects.toThrow();
  });
  it("does not click Like when target is already liked", async () => {
    const click = vi.fn();
    const liked = { count: async () => 1, nth: () => ({ isVisible: async () => true, evaluate: async () => false, click }) };
    const post = { getByRole: () => liked };
    const page = { goto: vi.fn(), url: () => "https://www.facebook.com/posts/123", locator: (selector: string) => {
      if (selector.startsWith("input")) return { first: () => ({ isVisible: async () => false }) };
      if (selector.startsWith("h1")) return { allTextContents: async () => [] };
      return { count: async () => 1, first: () => post };
    } };
    const adapter = { withActionPage: async (_account: Account, callback: (page: Page) => Promise<unknown>) => callback(page as unknown as Page) };
    const actions = new FacebookActions(adapter as unknown as FacebookBrowserAdapter, "unused");
    const result = await actions.execute("like", {} as Account, actionPayloadSchema.parse({ targetUrl: page.url() }), vi.fn());
    expect(result.message).toContain("อยู่แล้ว"); expect(click).not.toHaveBeenCalled();
  });
});
