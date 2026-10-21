import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../src/shared/types";
const mocks = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock("playwright-core", () => ({ chromium: { launchPersistentContext: mocks.launch } }));
import { FacebookBrowserAdapter } from "../electron/adapters/facebook-browser";

describe("group discovery browser lifecycle", () => {
  const account = { id: "account", browserProfilePath: "profile", headless: 0 } as Account;
  beforeEach(() => vi.clearAllMocks());
  function setup() {
    const page = { goto: vi.fn().mockResolvedValue(undefined), url: () => "https://www.facebook.com/groups/joins/",
      mouse: { wheel: vi.fn().mockResolvedValue(undefined) }, waitForTimeout: vi.fn().mockResolvedValue(undefined),
      locator: () => ({ evaluateAll: vi.fn().mockResolvedValue([{ id: "123", name: "กลุ่ม", url: "https://www.facebook.com/groups/123/", imageUrl: null }]) }),
      close: vi.fn().mockResolvedValue(undefined) };
    const browser = { newPage: vi.fn().mockResolvedValue(page), close: vi.fn().mockResolvedValue(undefined), setDefaultTimeout: vi.fn(), on: vi.fn() };
    mocks.launch.mockResolvedValue(browser);
    return { page, browser, adapter: new FacebookBrowserAdapter() };
  }
  it("uses headless mode and closes its own browser on success", async () => {
    const { page, browser, adapter } = setup();
    expect(await adapter.discoverGroups(account)).toHaveLength(1);
    expect(mocks.launch).toHaveBeenCalledWith("profile", expect.objectContaining({ headless: true }));
    expect(page.close).toHaveBeenCalledTimes(1);
    expect(browser.close).toHaveBeenCalledTimes(1);
    await adapter.discoverGroups(account);
    expect(mocks.launch).toHaveBeenCalledTimes(2);
  });
  it("closes browser when navigation fails", async () => {
    const { page, browser, adapter } = setup();
    page.goto.mockRejectedValueOnce(new Error("network"));
    await expect(adapter.discoverGroups(account)).rejects.toThrow("network");
    expect(page.close).toHaveBeenCalled(); expect(browser.close).toHaveBeenCalled();
  });
  it("reports an actionable error when another Chrome owns the profile", async () => {
    const { adapter } = setup();
    mocks.launch.mockRejectedValueOnce(new Error("Opening in existing browser session. --user-data-dir=private"));
    await expect(adapter.discoverGroups(account)).rejects.toThrow("Chrome ของบัญชีนี้ถูกใช้อยู่");
  });
  it("closes browser even when creating a tab fails", async () => {
    const { browser, adapter } = setup();
    browser.newPage.mockRejectedValueOnce(new Error("closed"));
    await expect(adapter.discoverGroups(account)).rejects.toThrow();
    expect(browser.close).toHaveBeenCalled();
  });
});
