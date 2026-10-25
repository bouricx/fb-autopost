import { useEffect, useRef, useState } from "react";
import type { Account } from "../shared/types";
import type { ScheduleSummary } from "../../electron/automation/schedule-manager";
import type { ProjectRecord } from "../../electron/projects/project-manager";

export interface QueueRow {
  id: string; kind: "post" | "workflow"; action: string; account: string; target: string;
  status: string; scheduledAt: string; error: string | null; parentId: string | null;
  attempts: number; maxAttempts: number; submissionState?: string; scheduleId?: string | null; projectId?: string | null;
}
export const queueStatusLabels: Record<string, string> = { pending_approval: "ส่งแล้ว — รอการอนุมัติจากกลุ่ม", review_required: "เลยเวลา — รอเลือกวิธีจัดการ", skipped: "ข้ามแล้ว ไม่ส่ง", pending: "รอถึงเวลา / รอขั้นตอนก่อนหน้า", running: "กำลังทำงาน", succeeded: "สำเร็จ", failed: "ไม่สำเร็จ", uncertain: "ต้องตรวจผลบน Facebook", cancelled: "ยกเลิกแล้ว" };
export function sortQueueRows(rows: QueueRow[]) {
  const order: Record<string, number> = { running: 0, review_required: 1, pending: 2, pending_approval: 3, uncertain: 4, failed: 5, succeeded: 6, skipped: 7, cancelled: 8 };
  return [...rows].sort((a, b) => (order[a.status] ?? 6) - (order[b.status] ?? 6) || a.scheduledAt.localeCompare(b.scheduledAt));
}
export function groupQueueRows(rows: QueueRow[], schedules: ScheduleSummary[], projects: ProjectRecord[]) {
  const names = new Map(projects.map(project => [project.id, project.name]));
  const plans = new Map(schedules.map(plan => [plan.id, plan.name]));
  const groups = new Map<string, { key: string; label: string; scheduleId?: string; rows: QueueRow[] }>();
  for (const row of rows) {
    const key = row.scheduleId ? `schedule:${row.scheduleId}` : row.projectId ? `project:${row.projectId}` : "other";
    if (!groups.has(key)) groups.set(key, { key, label: row.scheduleId ? plans.get(row.scheduleId) || "ตารางที่หยุด/ลบแล้ว" : row.projectId ? names.get(row.projectId) || "โปรเจกต์ที่ลบแล้ว" : "คิวที่ไม่ได้ผูกโปรเจกต์", scheduleId: row.scheduleId || undefined, rows: [] });
    groups.get(key)!.rows.push(row);
  }
  return [...groups.values()];
}
export function cancellableQueueRows(rows: QueueRow[]) {
  return rows.filter(row => ["pending", "review_required"].includes(row.status) && (!row.submissionState || row.submissionState === "not_sent"));
}
export function removableQueueRows(rows: QueueRow[]) {
  return rows.filter(row => ["pending", "review_required", "cancelled"].includes(row.status) && row.submissionState === "not_sent");
}
export function UnifiedQueue({ accounts }: { accounts: Account[] }) {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [schedules, setSchedules] = useState<ScheduleSummary[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [confirmDelete, setConfirmDelete] = useState<{ items: QueueRow[]; scheduleId?: string; label: string } | null>(null);
  const lock = useRef(false);
  const sequence = useRef(0);
  const reloadRef = useRef<() => Promise<void>>(async () => undefined);
  useEffect(() => {
    let active = true;
    const reload = async () => {
      const version = ++sequence.current;
      try {
        const [posts, tasks, plans, presets] = await Promise.all([window.autopost.listJobs(500), window.autopost.listActions(), window.autopost.listSchedules(), window.autopost.listProjects()]);
        if (!active || version !== sequence.current) return;
        const labels: Record<string, string> = { post: "โพสต์", comment: "ความคิดเห็น", share: "แชร์", like: "ถูกใจ" };
        const phase = (state?: string) => state === "sent" ? "ยืนยันผลส่งแล้ว" : state === "unknown" ? "อาจส่งแล้ว ต้องตรวจผล" : "ยังไม่ส่ง";
        setSchedules(plans); setProjects(presets);
        setRows(sortQueueRows([
          ...posts.map(post => ({ id: post.id, kind: "post" as const, action: `โพสต์ · ${phase(post.submissionState)} · ลองส่ง ${post.attempts}/${post.maxAttempts}${post.status === "pending" && post.lastError ? " · รอลองใหม่" : ""}`, account: post.accountName, target: post.destinationName, status: post.status, scheduledAt: post.nextAttemptAt, error: post.lastError, parentId: null, attempts: post.attempts, maxAttempts: post.maxAttempts, submissionState: post.submissionState })),
          ...tasks.map(task => ({ id: task.id, kind: "workflow" as const, action: `${labels[task.action]} · ${phase(task.submissionState)} · ลองส่ง ${task.attempts}/${task.maxAttempts || 5}${task.status === "pending" && task.lastError ? " · รอลองใหม่" : ""}`, account: accounts.find(account => account.id === task.accountId)?.name || "บัญชีที่ไม่พบ", target: task.payload.groupName || task.payload.targetUrl, status: task.status, scheduledAt: task.scheduledAt, error: task.lastError, parentId: task.parentId, attempts: task.attempts, maxAttempts: task.maxAttempts || 5, submissionState: task.submissionState, scheduleId: task.payload.scheduleId, projectId: task.projectId })),
        ]));
      } catch { if (active) setError("โหลดคิวไม่สำเร็จ กรุณากดรีเฟรช"); }
      finally { if (active) setLoading(false); }
    };
    reloadRef.current = reload;
    void reload(); const unsubscribe = window.autopost.onProgress(() => { void reload(); });
    return () => { active = false; unsubscribe(); };
  }, [accounts]);
  const work = async (operation: () => Promise<unknown>, message: string) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const result = await operation();
      if (result !== false) setNotice(typeof result === "number" ? `${message} ${result} รายการ` : message);
      await reloadRef.current();
    }
    catch (failure) { setError(failure instanceof Error ? failure.message : "ดำเนินการไม่สำเร็จ"); }
    finally { lock.current = false; setBusy(false); }
  };
  const visible = rows.filter(row => filter === "all" || row.status === filter);
  const groups = groupQueueRows(visible, schedules, projects);
  const cancelRows = async (items: QueueRow[]) => work(() => window.autopost.cancelPendingQueueItems(items.map(row => ({ kind: row.kind, id: row.id }))), "ยกเลิกคิวที่ยังไม่ส่งแล้ว (ประวัติยังอยู่)");
  const requestDelete = (items: QueueRow[], label: string, scheduleId?: string) => setConfirmDelete({ items, label, scheduleId });
  const queueTable = (items: QueueRow[]) => <div className="table-wrap"><table><thead><tr><th>งาน / บัญชี</th><th>ปลายทาง</th><th>เวลาไทย (24 ชม.)</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>{items.map(row => <tr key={`${row.kind}-${row.id}`}><td><b>{row.action}</b><small>{row.account}</small>{row.parentId && <small>ทำต่อจากขั้นตอนก่อนหน้า</small>}</td><td className="queue-target">{row.target}</td><td>{new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok", hourCycle: "h23" }).format(new Date(row.scheduledAt))}</td><td><span className={`status ${row.status}`}>{queueStatusLabels[row.status] || row.status}</span>{row.error && <small className="job-error">{row.error}</small>}</td><td><div className="queue-actions">{["pending", "review_required"].includes(row.status) && <button disabled={busy || !cancellableQueueRows([row]).length} className="secondary small" onClick={() => void cancelRows([row])}>ยกเลิกคิว</button>}{row.kind === "post" && row.status === "failed" && <button disabled={busy} className="secondary small" onClick={() => { if (confirm("ตรวจบน Facebook แล้วว่าไม่มีโพสต์ซ้ำ และต้องการลองใหม่?")) void work(() => window.autopost.retryJob(row.id), "เพิ่มงานกลับเข้าคิวแล้ว"); }}>ลองใหม่</button>}{removableQueueRows([row]).length > 0 && <button disabled={busy} className="danger small" title="ลบเฉพาะคิวที่ยังไม่ส่งจากโปรแกรม" onClick={() => requestDelete([row], row.target)}>ลบคิว</button>}</div></td></tr>)}</tbody></table></div>;
  return <div className="panel queue-center"><div className="panel-title"><div><h2>คิวงานทั้งหมด</h2><p>รวมโพสต์ ความคิดเห็น แชร์ และถูกใจ · แสดงสูงสุดประเภทละ 500 รายการ</p></div><button className="secondary" disabled={busy} onClick={() => void reloadRef.current()}>รีเฟรชคิว</button></div>
    <div className="queue-summary">{[ ["running", "กำลังทำ"], ["pending", "รอทำ"], ["succeeded", "สำเร็จ"], ["failed", "ไม่สำเร็จ"] ].map(([status, label]) => <button key={status} className={filter === status ? "selected" : ""} onClick={() => setFilter(status)}><span>{label}</span><b>{rows.filter(row => row.status === status).length}</b></button>)}</div>
      <div className="queue-controls"><label>แสดงสถานะ<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">ทั้งหมด ({rows.length})</option>{Object.entries(queueStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><p>ลบคิวได้เฉพาะรายการที่ยังไม่ส่ง · ประวัติที่ส่งแล้วและงานไม่แน่ชัดยังอยู่</p></div>
      {confirmDelete && <div className="queue-delete-confirm" role="alertdialog" aria-label="ยืนยันลบคิวที่ยังไม่ส่ง"><strong>ลบคิว {confirmDelete.items.length} รายการ · {confirmDelete.label}?</strong><p>{confirmDelete.scheduleId ? "จะหยุดตารางรายวันด้วย เพื่อไม่ให้สร้างคิวใหม่ในวันถัดไป · " : ""}ลบเฉพาะรายการที่ยังไม่ส่งออกจากโปรแกรม ไม่ลบโพสต์บน Facebook และไม่ลบงานที่อาจส่งแล้ว</p><div><button type="button" className="secondary small" disabled={busy} onClick={() => setConfirmDelete(null)}>เก็บไว้</button><button type="button" className="danger small" disabled={busy} onClick={() => { const choice = confirmDelete; setConfirmDelete(null); void work(() => window.autopost.deletePendingQueueItems({ items: choice.items.map(row => ({ kind: row.kind, id: row.id })), scheduleId: choice.scheduleId }), "ลบคิวที่ยังไม่ส่งแล้ว"); }}>ยืนยันลบคิว</button></div></div>}
     {error && <p className="queue-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
     {loading ? <p role="status">กำลังโหลดคิว…</p> : !visible.length ? <div className="empty">ยังไม่มีงานในสถานะนี้ ไปที่ “สร้างงานและตั้งเวลา” เพื่อเพิ่มงาน</div> : <div className="queue-groups">{groups.map(group => {
        const pending = cancellableQueueRows(group.rows);
        const removable = removableQueueRows(group.rows);
       const plan = group.scheduleId ? schedules.find(row => row.id === group.scheduleId) : undefined;
       const isOpen = expanded[group.key] || false;
         return <section className="queue-group" key={group.key}><div className="queue-group-heading"><button className="queue-group-toggle" type="button" aria-expanded={isOpen} onClick={() => setExpanded(state => ({ ...state, [group.key]: !isOpen }))}><span aria-hidden="true">{isOpen ? "▾" : "▸"}</span><strong>{group.label}</strong><small>{group.rows.length} รายการ · รอส่ง {pending.length} · กำลังทำ {group.rows.filter(row => row.status === "running").length}</small></button><div className="queue-group-actions">{removable.length > 0 && <button className="danger small" disabled={busy} onClick={() => requestDelete(removable, group.label, plan?.enabled ? plan.id : undefined)}>ลบคิวที่ยังไม่ส่ง ({removable.length}){plan?.enabled ? " + หยุดตาราง" : ""}</button>}{plan?.enabled && !removable.length && <button className="secondary small" disabled={busy} onClick={() => { if (confirm(`หยุดตาราง “${plan.name}”? งานที่กำลังทำจะจบตามปกติ`)) void work(() => window.autopost.stopSchedule(plan.id), "หยุดตารางแล้ว"); }}>หยุดตาราง</button>}{pending.length > 0 && !plan?.enabled && <button className="secondary small" disabled={busy} onClick={() => void cancelRows(pending)}>ยกเลิกแต่เก็บประวัติ ({pending.length})</button>}</div></div>{isOpen && queueTable(group.rows)}</section>;
     })}</div>}
  </div>;
}
