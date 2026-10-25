import { DatabaseSync } from "node:sqlite";
import type Database from "better-sqlite3";
import { expect, it } from "vitest";
import { groupIdFromUrl, updateGroupPermission } from "../electron/automation/group-permissions";
it("defaults are not inferred and denial updates only the matching account/group/action", () => {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`CREATE TABLE facebook_groups(account_id TEXT,facebook_group_id TEXT,post_permission TEXT DEFAULT 'unknown',share_permission TEXT DEFAULT 'unknown',permissions_checked_at TEXT,permission_message TEXT);
    INSERT INTO facebook_groups(account_id,facebook_group_id) VALUES('a','123'),('b','123')`);
  const db = { prepare: (query: string) => sql.prepare(query) } as unknown as Database.Database;
  try {
    expect(groupIdFromUrl("https://www.facebook.com/groups/123/posts/9/")).toBe("123");
    updateGroupPermission(db, "a", "https://www.facebook.com/groups/123/", "share", "denied", "ไม่อนุญาต");
    expect(sql.prepare("SELECT post_permission,share_permission FROM facebook_groups WHERE account_id='a'").get()).toMatchObject({ post_permission: "unknown", share_permission: "denied" });
    expect(sql.prepare("SELECT share_permission FROM facebook_groups WHERE account_id='b'").get()).toMatchObject({ share_permission: "unknown" });
  } finally { sql.close(); }
});
