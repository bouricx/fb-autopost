import { describe, expect, it } from "vitest";
import { FEATURES, assertActionEnabled } from "../src/shared/features";
import { TaskManager } from "../electron/automation/task-manager";
import type Database from "better-sqlite3";

describe("production feature flags", () => {
  it("keeps every unfinished feature disabled by default", () => {
    expect(FEATURES).toEqual({
      comment: false,
      share: false,
      like: false,
      workflowFollowUp: false,
      pendingApprovalDetector: false,
      groupPermissionCheck: false,
    });
  });

  it.each(["comment", "share", "like"] as const)("blocks %s at backend entry points", action => {
    expect(() => assertActionEnabled(action)).toThrow(/ยังปิดใช้งานอยู่/);
  });
  it("rejects hidden legacy follow-up settings before inserting a post task", () => {
    const manager = new TaskManager({ prepare: () => { throw new Error("Should not access DB"); } } as unknown as Database.Database);
    expect(() => manager.create("account", "post", { targetUrl: "https://www.facebook.com/groups/123/", caption: "ทดสอบ", commentEnabled: true }))
      .toThrow(/ยังปิดใช้งานอยู่/);
  });
});
