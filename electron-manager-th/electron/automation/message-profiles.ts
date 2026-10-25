import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { stat, readdir } from "node:fs/promises";
import type Database from "better-sqlite3";
import { messageProfileSchema, profileRunSchema, shuffledTargets, type MessageProfile, type ProfileRun } from "../../src/shared/message-profiles";
import { TaskManager } from "./task-manager";

export class MessageProfiles {
  constructor(private db: Database.Database) {}
  initialize() {
    this.db.exec(`CREATE TABLE IF NOT EXISTS message_profiles(id TEXT PRIMARY KEY,data_json TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS profile_runs(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        profile_id TEXT NOT NULL REFERENCES message_profiles(id),data_json TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,
        completed_rounds INTEGER NOT NULL DEFAULT 0,next_run_at TEXT NOT NULL,last_error TEXT,created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_tasks_profile_run_status ON automation_tasks(json_extract(payload_json,'$.profileRunId'),status);
      CREATE INDEX IF NOT EXISTS idx_tasks_approval_target ON automation_tasks(account_id,status,rtrim(json_extract(payload_json,'$.targetUrl'),'/'));
      CREATE INDEX IF NOT EXISTS idx_profile_runs_enabled ON profile_runs(enabled,next_run_at);`);
  }
  list(): MessageProfile[] {
    return (this.db.prepare("SELECT id,data_json,updated_at FROM message_profiles ORDER BY updated_at DESC").all() as { id: string; data_json: string; updated_at: string }[])
      .map(row => ({ ...messageProfileSchema.parse(JSON.parse(row.data_json)), id: row.id, updatedAt: row.updated_at }));
  }
  save(id: string | null, raw: unknown) {
    const profile = messageProfileSchema.parse(raw), key = id || randomUUID();
    if (id && !this.list().some(row => row.id === id)) throw new Error("ไม่พบโปรไฟล์ กรุณารีเฟรช");
    this.db.prepare("INSERT INTO message_profiles VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json,updated_at=excluded.updated_at")
      .run(key, JSON.stringify(profile), new Date().toISOString());
    return key;
  }
  remove(id: string) {
    if (this.db.prepare("SELECT id FROM profile_runs WHERE profile_id=? LIMIT 1").get(id)) throw new Error("โปรไฟล์มีประวัติงาน กรุณาเก็บไว้หรือสร้างสำเนาใหม่");
    this.db.prepare("DELETE FROM message_profiles WHERE id=?").run(id);
  }
  runs(activeOnly = false): ProfileRun[] {
    return (this.db.prepare(`SELECT r.*,json_extract(p.data_json,'$.name') AS profile_name,json_extract(p.data_json,'$.action') AS profile_action
      FROM profile_runs r JOIN message_profiles p ON p.id=r.profile_id ${activeOnly ? "WHERE r.enabled=1" : ""}
      ORDER BY r.enabled DESC,r.created_at DESC LIMIT 500`).all() as { id: string; data_json: string; profile_id: string; enabled: number; completed_rounds: number; next_run_at: string; last_error: string | null; profile_name: string; profile_action: "post" | "comment" }[])
      .map(row => ({ ...profileRunSchema.parse(JSON.parse(row.data_json)), id: row.id, enabled: !!row.enabled, completedRounds: row.completed_rounds,
        nextRunAt: row.next_run_at, lastError: row.last_error, profileName: row.profile_name, action: row.profile_action }));
  }
  createRun(raw: unknown) {
    const input = profileRunSchema.parse(raw);
    input.scheduledAt = new Date(input.scheduledAt).toISOString();
    const account = this.db.prepare("SELECT adapter_type FROM accounts WHERE id=?").get(input.accountId) as { adapter_type: string } | undefined;
    if (account?.adapter_type !== "facebook-browser") throw new Error("กรุณาเลือกบัญชี Facebook");
    const profile = this.list().find(row => row.id === input.profileId);
    if (!profile) throw new Error("ไม่พบโปรไฟล์");
    if (input.shareEnabled && (profile.action !== "post" || !input.shareDestinationIds.length)) throw new Error("แชร์คู่กับงานโพสต์ต้องเลือกกลุ่มแชร์");
    if (Date.parse(input.scheduledAt) < Date.now() - 60000) throw new Error("เวลาผ่านไปแล้ว กรุณาตั้งเวลาใหม่");
    // One active configuration per account/action avoids overlapping recurring campaigns.
    if (this.runs(true).some(run => run.enabled && run.accountId === input.accountId && run.action === profile.action)) throw new Error("บัญชีนี้มีโปรไฟล์ชนิดเดียวกันทำงานอยู่ กรุณาหยุดตารางเดิมก่อน");
    const id = randomUUID();
    this.db.prepare("INSERT INTO profile_runs(id,account_id,profile_id,data_json,next_run_at,created_at) VALUES(?,?,?,?,?,?)")
      .run(id, input.accountId, input.profileId, JSON.stringify(input), input.scheduledAt, new Date().toISOString());
    return id;
  }
  stop(id: string) {
    this.db.transaction(() => {
      this.db.prepare("UPDATE profile_runs SET enabled=0 WHERE id=?").run(id);
      this.db.prepare(`UPDATE automation_tasks SET status='cancelled',last_error='หยุดตารางโปรไฟล์แล้ว'
        WHERE json_extract(payload_json,'$.profileRunId')=? AND status IN ('pending','review_required') AND submission_state='not_sent'`).run(id);
    })();
  }
  async materialize() {
    for (const run of this.runs(true)) {
      if (this.db.prepare("SELECT id FROM automation_tasks WHERE json_extract(payload_json,'$.profileRunId')=? AND status IN ('pending','running','review_required') LIMIT 1").get(run.id)) continue;
      const uncertain = this.db.prepare("SELECT id FROM automation_tasks WHERE json_extract(payload_json,'$.profileRunId')=? AND status='uncertain' LIMIT 1").get(run.id);
      if (uncertain) { this.db.prepare("UPDATE profile_runs SET enabled=0,last_error=? WHERE id=?").run("พบงานที่ยืนยันผลไม่ได้ กรุณาตรวจ Facebook ก่อนสร้างตารางใหม่", run.id); continue; }
      if (run.rounds && run.completedRounds >= run.rounds) { this.db.prepare("UPDATE profile_runs SET enabled=0 WHERE id=?").run(run.id); continue; }
      if (run.nextRunAt > new Date().toISOString()) continue;
      // Do not silently replay missed rounds after sleep/restart.
      if (Date.now() - Date.parse(run.nextRunAt) > 5 * 60000) { this.db.prepare("UPDATE profile_runs SET enabled=0,last_error=? WHERE id=?").run("เลยเวลาเกิน 5 นาที กรุณาตรวจและสร้างตารางใหม่", run.id); continue; }
      try {
        const profile = this.list().find(row => row.id === run.profileId);
        if (!profile) throw new Error("ไม่พบโปรไฟล์");
        for (const set of profile.sets) {
          if (set.mediaFolder && profile.action === "post") {
            const entries = await readdir(set.mediaFolder, { withFileTypes: true });
            set.media = entries.filter(item => item.isFile() && /\.(jpe?g|png|webp|gif)$/i.test(item.name)).sort((a,b)=>a.name.localeCompare(b.name)).map(item=>join(set.mediaFolder!,item.name));
            if (!set.media.length || set.media.length > 10) throw new Error("โฟลเดอร์ต้องมีรูป 1–10 รูป");
          }
          for (const path of set.media) if (!(await stat(path)).isFile()) throw new Error("ไฟล์สื่อไม่พร้อม");
        }
        this.db.transaction(() => {
          // Recheck after async file validation: Stop may have been clicked meanwhile.
          if (!(this.db.prepare("SELECT enabled FROM profile_runs WHERE id=?").get(run.id) as { enabled: number } | undefined)?.enabled) return;
          const shares = run.shareEnabled ? run.shareDestinationIds.map(id => {
            const dest = this.db.prepare("SELECT name,url FROM destinations WHERE id=? AND account_id=? AND kind='facebook_group' AND enabled=1").get(id, run.accountId) as { name: string; url: string } | undefined;
            if (!dest) throw new Error("กลุ่มแชร์ไม่พร้อม กรุณาตรวจปลายทางของบัญชี");
            return { ...dest, caption: "", media: [] };
          }) : [];
          const tasks = new TaskManager(this.db);
          for (const target of shuffledTargets(profile)) {
            if (profile.action === "post") target.targetUrl = `https://www.facebook.com/groups/${new URL(target.targetUrl).pathname.split("/")[2]}/`;
            const waiting = this.db.prepare("SELECT id FROM automation_tasks WHERE account_id=? AND status='pending_approval' AND rtrim(json_extract(payload_json,'$.targetUrl'),'/')=? LIMIT 1")
              .get(run.accountId, target.targetUrl.replace(/\/$/, ""));
            if (waiting) continue; // Already submitted to this group. Never accumulate pending duplicates.
            if (profile.action === "post") {
              const canonical = new URL(target.targetUrl); const group = canonical.pathname.split("/")[2];
              const url = `https://www.facebook.com/groups/${group}/`;
              let destination = this.db.prepare("SELECT id,enabled FROM destinations WHERE account_id=? AND url=?").get(run.accountId, url) as { id: string; enabled: number } | undefined;
              if (destination && !destination.enabled) throw new Error("กลุ่มถูกปิดใช้งาน กรุณาตรวจปลายทาง");
              if (!destination) {
                const cached = this.db.prepare("SELECT name FROM facebook_groups WHERE account_id=? AND facebook_group_id=?").get(run.accountId, group) as { name: string } | undefined;
                this.db.prepare("INSERT INTO destinations(id,account_id,kind,name,url,enabled,created_at) VALUES(?,?,'facebook_group',?,?,1,?)")
                  .run(randomUUID(), run.accountId, cached?.name || `${target.setName} · ${group}`, url, new Date().toISOString());
              }
              target.targetUrl = url;
            }
            tasks.create(run.accountId, profile.action, { ...target, profileRunId: run.id, delayMin: run.delayMin, delayMax: run.delayMax,
              shareEnabled: run.shareEnabled, shareTargets: shares, repeatMinutes: run.shareRepeatMinutes }, run.nextRunAt,
              null, null, `profile:${run.id}:${run.completedRounds}:${target.targetUrl}`);
          }
          // Anchor to the planned time, skip missed intervals rather than catch-up bursts.
          const interval = run.repeatMinutes * 60000, planned = Date.parse(run.nextRunAt);
          const next = planned + Math.max(1, Math.floor((Date.now() - planned) / interval) + 1) * interval;
          this.db.prepare("UPDATE profile_runs SET completed_rounds=completed_rounds+1,next_run_at=?,last_error=NULL WHERE id=?").run(new Date(next).toISOString(), run.id);
        })();
      } catch { this.db.prepare("UPDATE profile_runs SET enabled=0,last_error=? WHERE id=?").run("สร้างรอบไม่สำเร็จ ตรวจไฟล์สื่อและปลายทางก่อนเริ่มใหม่", run.id); }
    }
  }
}
