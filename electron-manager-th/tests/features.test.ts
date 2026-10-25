import { describe, expect, it } from "vitest";
import { FEATURES, assertActionEnabled } from "../src/shared/features";
import { TaskManager } from "../electron/automation/task-manager";
import type Database from "better-sqlite3";
describe("production actions", () => {
  it.each(["comment", "share", "like"] as const)("exposes implemented %s actions", action => {
    expect(() => assertActionEnabled(action)).not.toThrow();
  });
  it("keeps experimental permission inference off and requires approval evidence", () => {
    expect(FEATURES.groupPermissionCheck).toBe(false);
    expect(FEATURES.pendingApprovalDetector).toBe(true);
  });
  it("rejects incomplete follow-up content before accessing the database", () => {
    const manager = new TaskManager({ prepare: () => { throw new Error("Unexpected DB call"); } } as unknown as Database.Database);
    expect(() => manager.create("account", "post", { targetUrl: "https://www.facebook.com/groups/123/", caption: "ทดสอบ", commentEnabled: true }))
      .toThrow(/Template/);
    expect(() => manager.create("account", "post", { targetUrl: "https://www.facebook.com/groups/123/", caption: "ทดสอบ", shareEnabled: true }))
      .toThrow(/เลือกกลุ่มแชร์/);
  });
});
