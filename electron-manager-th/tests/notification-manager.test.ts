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
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "123456789" }) }); vi.stubGlobal("fetch", fetcher);
    const db = { prepare: () => ({ all: () => [
      { id: "one", type: "discord", accountId: "account", projectId: null, encrypted: "one" },
      { id: "two", type: "discord", accountId: null, projectId: "project", encrypted: "two" },
    ], run: vi.fn() }) } as unknown as Database.Database;
    const vault = { decrypt: (value: string) => JSON.stringify({ secret: `https://discord.com/api/webhooks/123/${value}` }) } as SecretVault;
    expect(await new NotificationManager(db, vault).send("account", "project", "one", "hello")).toEqual({ delivered: 1, failed: 0, missing: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toContain("/one?wait=true");
    expect(JSON.parse(fetcher.mock.calls[0][1].body).allowed_mentions).toEqual({ parse: [] });
    expect(fetcher.mock.calls[0][1].headers["User-Agent"]).toBe("AutoPost-Manager-TH/0.6.8");
  });
  it("records missing channels and does not claim delivery", async () => {
    const log = vi.fn(); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const db = { prepare: () => ({ all: () => [], run: log }) } as unknown as Database.Database;
    expect(await new NotificationManager(db, {} as SecretVault).send("account", null, null, "post failed")).toEqual({ delivered: 0, failed: 0, missing: true });
    expect(log).toHaveBeenCalledOnce(); expect(fetcher).not.toHaveBeenCalled();
  });
  it("records a rejected Discord message and does not claim delivery", async () => {
    const log = vi.fn(); const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 403 }); vi.stubGlobal("fetch", fetcher);
    const db = { prepare: () => ({ all: () => [{ id: "one", type: "discord", accountId: "account", projectId: null, encrypted: "one" }], run: log }) } as unknown as Database.Database;
    const vault = { decrypt: () => JSON.stringify({ secret: "https://discord.com/api/webhooks/123/token" }) } as unknown as SecretVault;
    expect(await new NotificationManager(db, vault).send("account", null, null, "post failed")).toEqual({ delivered: 0, failed: 1, missing: false });
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls)).not.toContain("/api/webhooks/");
  });
  it("probes a saved Discord webhook with GET and never posts a test message", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200 }); vi.stubGlobal("fetch", fetcher);
    const db = { prepare: () => ({ get: () => ({ type: "discord", encrypted: "encrypted" }) }) } as unknown as Database.Database;
    const vault = { decrypt: () => JSON.stringify({ secret: "https://discord.com/api/webhooks/123/token" }) } as unknown as SecretVault;
    expect(await new NotificationManager(db, vault).probe("channel")).toContain("ไม่ได้ส่งข้อความ");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].method).toBe("GET");
  });
  it("sends exactly one credential-safe Discord test message without mentions", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "123456789" }) }); vi.stubGlobal("fetch", fetcher);
    const db = { prepare: () => ({ get: () => ({ type: "discord", encrypted: "encrypted" }) }) } as unknown as Database.Database;
    const vault = { decrypt: () => JSON.stringify({ secret: "https://discord.com/api/webhooks/123/token" }) } as unknown as SecretVault;
    expect(await new NotificationManager(db, vault).testDelivery("channel")).toContain("รับข้อความทดสอบแล้ว");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].method).toBe("POST");
    expect(String(fetcher.mock.calls[0][0])).toContain("wait=true");
    expect(JSON.parse(fetcher.mock.calls[0][1].body).allowed_mentions).toEqual({ parse: [] });
  });
});
