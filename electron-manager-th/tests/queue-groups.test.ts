import { expect, it } from "vitest";
import { cancellableQueueRows, groupQueueRows, removableQueueRows, type QueueRow } from "../src/components/UnifiedQueue";
import type { ScheduleSummary } from "../electron/automation/schedule-manager";
import type { ProjectRecord } from "../electron/projects/project-manager";

const row = (id: string, changes: Partial<QueueRow> = {}): QueueRow => ({ id, kind: "workflow", action: "post", account: "บัญชี", target: "กลุ่ม", status: "pending", scheduledAt: "2026-10-23T02:00:00Z", error: null, parentId: null, attempts: 0, maxAttempts: 5, submissionState: "not_sent", ...changes });

it("groups scheduled rows under their named plan and separates project and unassigned jobs", () => {
  const plans = [{ id: "plan-1", name: "โพสต์ทุกวัน" }] as ScheduleSummary[];
  const projects = [{ id: "project-1", name: "โปรเจกต์หลัก" }] as ProjectRecord[];
  const groups = groupQueueRows([row("a", { scheduleId: "plan-1", projectId: "project-1" }), row("b", { scheduleId: "plan-1", status: "succeeded" }), row("c", { projectId: "project-1" }), row("d", { kind: "post" })], plans, projects);
  expect(groups.map(group => [group.label, group.rows.length])).toEqual([["โพสต์ทุกวัน", 2], ["โปรเจกต์หลัก", 1], ["คิวที่ไม่ได้ผูกโปรเจกต์", 1]]);
  expect(cancellableQueueRows(groups[0].rows).map(item => item.id)).toEqual(["a"]);
  expect(cancellableQueueRows([row("sent", { submissionState: "unknown" }), row("held", { status: "review_required" }), row("working", { status: "running" })]).map(item => item.id)).toEqual(["held"]);
  expect(removableQueueRows([row("queued"), row("cancelled", { status: "cancelled" }), row("sent", { status: "succeeded", submissionState: "sent" }), row("unknown", { status: "pending", submissionState: "unknown" })]).map(item => item.id)).toEqual(["queued", "cancelled"]);
});
