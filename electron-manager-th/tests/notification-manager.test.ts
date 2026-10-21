import { describe, expect, it, vi, afterEach } from "vitest";
import type Database from "better-sqlite3";
vi.mock("electron", () => ({ safeStorage: {} }));
import { NotificationManager } from "../electron/notifications/notification-manager";
import type { SecretVault } from "../electron/core/secrets";
afterEach(() => vi.unstubAllGlobals());
describe("notification safety and routing", () => {
  it("rejects non-Discord hosts and invalid Telegram credentials", () => {
    const run = vi.fn();
    const db = { prepare: () => ({ run }) } as unknown as Database.Database;
    const vault = { encrypt: (value: string) => value } as SecretVault;
    const manager = new NotificationManager(db, vault);
    expect(() => manager.create({ name: "test", type: "discord", secret: "https://example.com/api/webhooks/123/token" })).toThrow();
    expect(() => manager.create({ name: "test", type: "telegram", secret: "bad", chatId: "123" })).toThrow();
    expect(run).not.toHaveBeenCalled();
  });
  it("uses job override and disables Discord mentions", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true }); vi.stubGlobal("fetch", fetcher);
    const db = { prepare: () => ({ all: () => [
      { id: "one", type: "discord", accountId: "account", projectId: null, encrypted: "one" },
      { id: "two", type: "discord", accountId: null, projectId: "project", encrypted: "two" },
    ], run: vi.fn() }) } as unknown as Database.Database;
    const vault = { decrypt: (value: string) => JSON.stringify({ secret: `https://discord.com/api/webhooks/123/${value}` }) } as SecretVault;
    await new NotificationManager(db, vault).send("account", "project", "one", "hello");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain("/one");
    expect(JSON.parse(fetcher.mock.calls[0][1].body).allowed_mentions).toEqual({ parse: [] });
  });
});
