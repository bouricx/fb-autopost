import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import { actionPayloadSchema } from "./contracts";
import { TaskManager } from "./task-manager";
import { bangkokDay, scheduleInstant } from "../../src/shared/schedule";
import { FEATURES } from "../../src/shared/features";

export const dailyScheduleSchema = z.object({ accountId: z.string().uuid(), name: z.string().trim().min(1).max(100), startDate: z.string(), daily: z.boolean(),
  times: z.array(z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)).min(1).max(24), payloads: z.array(actionPayloadSchema).min(1).max(100) });
export interface ScheduleSummary { id: string; name: string; accountId: string; daily: boolean; enabled: boolean; times: string[]; todayTotal: number; succeeded: number; pending: number; running: number; failed: number; totalSucceeded: number; rounds: { id: string; time: string; status: string; succeededTargets: number; totalTargets: number }[] }
export class ScheduleManager {
  constructor(private db: Database.Database) {}
  create(raw: unknown) {
    const input = dailyScheduleSchema.parse(raw), id = randomUUID();
    if (!FEATURES.workflowFollowUp && input.payloads.some(payload => payload.commentEnabled || payload.shareEnabled || payload.likeEnabled)) {
      throw new Error("ฟีเจอร์คอมเมนต์ / แชร์ / ไลค์ ยังปิดใช้งานอยู่ กรุณาปิดขั้นตอนต่อเนื่องก่อนสร้างตาราง");
    }
    for (const time of input.times) scheduleInstant(input.startDate, time);
    const account = this.db.prepare("SELECT adapter_type FROM accounts WHERE id=?").get(input.accountId) as { adapter_type: string } | undefined;
    if (account?.adapter_type !== "facebook-browser") throw new Error("ตารางหลายรอบรองรับบัญชี Facebook");
    if (input.startDate < bangkokDay()) throw new Error("เลือกวันนี้หรือวันถัดไป");
    if (input.startDate === bangkokDay() && input.times.every(time => scheduleInstant(input.startDate, time) <= new Date().toISOString())) throw new Error("เวลาทุกรอบวันนี้ผ่านไปแล้ว กรุณาเลือกวันหรือเวลาที่ยังไม่ถึง");
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO daily_schedules(id,account_id,name,start_date,daily,times_json,payloads_json,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .run(id, input.accountId, input.name, input.startDate, Number(input.daily), JSON.stringify([...new Set(input.times)].sort()), JSON.stringify(input.payloads), new Date().toISOString());
      this.materialize();
    })();
    return id;
  }
  materialize() {
    const now = new Date().toISOString(), today = bangkokDay();
    const rows = this.db.prepare("SELECT * FROM daily_schedules WHERE enabled=1").all() as { id: string; account_id: string; start_date: string; daily: number; times_json: string; payloads_json: string }[];
    const tasks = new TaskManager(this.db);
    for (const row of rows) {
      if (!row.daily && row.start_date < today) continue;
      const day = row.start_date > today ? row.start_date : today;
      this.db.transaction(() => {
        for (const time of JSON.parse(row.times_json) as string[]) {
          const scheduled = scheduleInstant(day, time);
          if (scheduled < now) continue;
          const roundId = randomUUID();
          const inserted = this.db.prepare("INSERT OR IGNORE INTO schedule_rounds(id,schedule_id,day,time,scheduled_at) VALUES(?,?,?,?,?)").run(roundId, row.id, day, time, scheduled);
          if (!inserted.changes) continue;
           for (const payload of JSON.parse(row.payloads_json) as z.infer<typeof actionPayloadSchema>[]) {
             // Keep a uniquely configured Discord channel attached when recurring rounds are created tomorrow.
             const channels = this.db.prepare("SELECT id,project_id AS projectId FROM notification_channels WHERE account_id=? AND type='discord' AND enabled=1 ORDER BY created_at").all(row.account_id) as { id: string; projectId: string | null }[];
             const channel = payload.channelId ? channels.find(item => item.id === payload.channelId) : channels.length === 1 ? channels[0] : undefined;
             tasks.create(row.account_id, "post", { ...payload, channelId: channel?.id ?? payload.channelId, scheduleId: row.id, roundId }, scheduled, channel?.projectId ?? null);
           }
        }
      })();
    }
  }
  stop(id: string) {
    this.db.transaction(() => {
      const stopped = this.db.prepare("UPDATE daily_schedules SET enabled=0 WHERE id=? AND enabled=1").run(id);
      if (!stopped.changes) throw new Error("ตารางนี้หยุดแล้วหรือไม่พบตาราง");
      this.db.prepare(`UPDATE automation_tasks SET status='cancelled',last_error='หยุดตารางเวลาแล้ว',updated_at=?
        WHERE status IN ('pending','review_required') AND json_extract(payload_json,'$.scheduleId')=?`).run(new Date().toISOString(), id);
      this.db.prepare(`WITH RECURSIVE blocked(id) AS (
        SELECT id FROM automation_tasks WHERE status='cancelled' AND json_extract(payload_json,'$.scheduleId')=?
        UNION SELECT child.id FROM automation_tasks child JOIN blocked ON child.parent_id=blocked.id
      ) UPDATE automation_tasks SET status='cancelled',last_error='หยุดตามตารางเวลาที่ถูกยกเลิก'
        WHERE status IN ('pending','review_required') AND parent_id IN (SELECT id FROM blocked)`).run(id);
    })();
  }
  list(): ScheduleSummary[] {
    const today = bangkokDay();
    const rows = this.db.prepare("SELECT * FROM daily_schedules ORDER BY created_at DESC LIMIT 200").all() as { id: string; name: string; account_id: string; daily: number; enabled: number; times_json: string }[];
    return rows.map(row => {
      const rounds = this.db.prepare(`SELECT r.id,r.day,r.time,t.status FROM schedule_rounds r LEFT JOIN automation_tasks t
        ON json_extract(t.payload_json,'$.roundId')=r.id AND t.action='post' WHERE r.schedule_id=? ORDER BY r.day,r.time`).all(row.id) as { id: string; day: string; time: string; status: string | null }[];
      const grouped = new Map<string, typeof rounds>();
      for (const round of rounds) grouped.set(round.id, [...(grouped.get(round.id) || []), round]);
      const summaries = [...grouped.values()].map(items => ({ id: items[0].id, day: items[0].day, time: items[0].time,
        status: items.some(item => item.status === "running") ? "running" : items.some(item => item.status === "pending") ? "pending" : items.every(item => item.status === "succeeded") ? "succeeded" : "failed",
        succeededTargets: items.filter(item => item.status === "succeeded").length, totalTargets: items.filter(item => item.status !== null).length }));
      const current = summaries.filter(round => round.day === today);
      return { id: row.id, name: row.name, accountId: row.account_id, daily: !!row.daily, enabled: !!row.enabled, times: JSON.parse(row.times_json), todayTotal: current.length,
        succeeded: current.filter(round => round.status === "succeeded").length, pending: current.filter(round => round.status === "pending").length, running: current.filter(round => round.status === "running").length,
        failed: current.filter(round => round.status === "failed").length, totalSucceeded: summaries.filter(round => round.status === "succeeded").length, rounds: current };
    });
  }
}
