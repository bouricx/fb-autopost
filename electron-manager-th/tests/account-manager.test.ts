import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolve, join } from "node:path";
const mocks = vi.hoisted(() => ({ rm: vi.fn(), message: vi.fn() }));
vi.mock("electron", () => ({ clipboard: {}, dialog: { showMessageBox: mocks.message }, safeStorage: {} }));
vi.mock("node:fs/promises", () => ({ rm: mocks.rm, writeFile: vi.fn(), readFile: vi.fn(), stat: vi.fn(), mkdir: vi.fn() }));
import { AccountManager } from "../electron/accounts/account-manager";
import type { AppDatabase } from "../electron/core/database";
import type { SecretVault } from "../electron/core/secrets";
import type { SessionChecker } from "../electron/accounts/session-checker";

describe("session deletion safety", () => {
  const profiles = resolve("test-profiles");
  beforeEach(() => { vi.clearAllMocks(); mocks.message.mockResolvedValue({ response: 1 }); mocks.rm.mockResolvedValue(undefined); });
  function setup(path = join(profiles, "account-profile"), running = false) {
    const db = { hasRunningJobs: () => running, accountRecord: () => ({ platform: "facebook", browserProfilePath: path }), deleteAccount: vi.fn() };
    const close = vi.fn().mockResolvedValue(undefined);
    return { db, close, manager: new AccountManager(db as unknown as AppDatabase, {} as SecretVault, profiles, {} as SessionChecker, close) };
  }
  it("closes browser and removes only owned profile before deleting records", async () => {
    const { manager, db, close } = setup();
    await manager.deleteSession("account");
    expect(close).toHaveBeenCalledWith("account");
    expect(mocks.rm).toHaveBeenCalledWith(join(profiles, "account-profile"), { recursive: true, force: true });
    expect(db.deleteAccount).toHaveBeenCalledWith("account");
  });
  it("does not delete outside the managed root", async () => {
    const { manager, db } = setup(resolve("unrelated-directory"));
    await expect(manager.deleteSession("account")).rejects.toThrow();
    expect(mocks.rm).not.toHaveBeenCalled(); expect(db.deleteAccount).not.toHaveBeenCalled();
  });
  it("preserves records when removal fails or user cancels", async () => {
    const { manager, db } = setup();
    mocks.rm.mockRejectedValueOnce(new Error("locked"));
    await expect(manager.deleteSession("account")).rejects.toThrow();
    expect(db.deleteAccount).not.toHaveBeenCalled();
    mocks.message.mockResolvedValueOnce({ response: 0 });
    await manager.deleteSession("account");
    expect(db.deleteAccount).not.toHaveBeenCalled();
  });
  it("refuses deletion while a job is running", async () => {
    const { manager, close } = setup(undefined, true);
    await expect(manager.deleteSession("account")).rejects.toThrow();
    expect(close).not.toHaveBeenCalled();
  });
});
