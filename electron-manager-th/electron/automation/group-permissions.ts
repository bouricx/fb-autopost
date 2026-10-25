import type Database from "better-sqlite3";
export type GroupPermission = "unknown" | "allowed" | "denied";
export function groupIdFromUrl(value: string | null | undefined): string | null {
  try { return new URL(value || "").pathname.match(/^\/groups\/([^/]+)/)?.[1] || null; } catch { return null; }
}
export function updateGroupPermission(db: Database.Database, accountId: string, groupUrl: string, kind: "post" | "share", permission: GroupPermission, message: string) {
  const id = groupIdFromUrl(groupUrl);
  if (!id) return;
  const column = kind === "post" ? "post_permission" : "share_permission";
  db.prepare(`UPDATE facebook_groups SET ${column}=?,permissions_checked_at=?,permission_message=? WHERE account_id=? AND facebook_group_id=?`)
    .run(permission, new Date().toISOString(), message, accountId, id);
}
