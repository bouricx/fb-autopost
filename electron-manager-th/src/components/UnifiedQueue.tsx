import { useEffect, useRef, useState } from "react";
import type { Account } from "../shared/types";

export interface QueueRow {
  id: string; kind: "post" | "workflow"; action: string; account: string; target: string;
  status: string; scheduledAt: string; error: string | null; parentId: string | null;
  attempts: number; maxAttempts: number;
}
export const queueStatusLabels: Record<string, string> = { review_required: "เลยเวลา — รอเลือกวิธีจัดการ", skipped: "ข้ามแล้ว ไม่ส่ง", pending: "รอถึงเวลา / รอขั้นตอนก่อนหน้า", running: "กำลังทำงาน", succeeded: "สำเร็จ", failed: "ไม่สำเร็จ", uncertain: "ต้องตรวจผลบน Facebook", cancelled: "ยกเลิกแล้ว" };
export function sortQueueRows(rows: QueueRow[]) {
  const order: Record<string, number> = { running: 0, review_required: 1, pending: 2, uncertain: 3, failed: 4, succeeded: 5, skipped: 6, cancelled: 7 };
  return [...rows].sort((a, b) => (order[a.status] ?? 6) - (order[b.status] ?? 6) || a.scheduledAt.localeCompare(b.scheduledAt));
}
export function UnifiedQueue({ accounts }: { accounts: Account[] }) {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const sequence = useRef(0);
  const reloadRef = useRef<() => Promise<void>>(async () => undefined);
  useEffect(() => {
    let active = true;
    const reload = async () => {
      const version = ++sequence.current;
      try {
        const [posts, tasks] = await Promise.all([window.autopost.listJobs(500), window.autopost.listActions()]);
        if (!active || version !== sequence.current) return;
        const labels: Record<string, string> = { post: "โพสต์", comment: "ความคิดเห็น", share: "แชร์", like: "ถูกใจ" };
        const phase = (state?: string) => state === "sent" ? "ยืนยันผลส่งแล้ว" : state === "unknown" ? "อาจส่งแล้ว ต้องตรวจผล" : "ยังไม่ส่ง";
        setRows(sortQueueRows([
          ...posts.map(post => ({ id: post.id, kind: "post" as const, action: `โพสต์ · ${phase(post.submissionState)} · ลองส่ง ${post.attempts}/${post.maxAttempts}${post.status === "pending" && post.lastError ? " · รอลองใหม่" : ""}`, account: post.accountName, target: post.destinationName, status: post.status, scheduledAt: post.nextAttemptAt, error: post.lastError, parentId: null, attempts: post.attempts, maxAttempts: post.maxAttempts })),
          ...tasks.map(task => ({ id: task.id, kind: "workflow" as const, action: `${labels[task.action]} · ${phase(task.submissionState)} · ลองส่ง ${task.attempts}/${task.maxAttempts || 5}${task.status === "pending" && task.lastError ? " · รอลองใหม่" : ""}`, account: accounts.find(account => account.id === task.accountId)?.name || "บัญชีที่ไม่พบ", target: task.payload.groupName || task.payload.targetUrl, status: task.status, scheduledAt: task.scheduledAt, error: task.lastError, parentId: task.parentId, attempts: task.attempts, maxAttempts: task.maxAttempts || 5 })),
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
    try { const result = await operation(); if (result !== false) setNotice(message); await reloadRef.current(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "ดำเนินการไม่สำเร็จ"); }
    finally { lock.current = false; setBusy(false); }
  };
  const visible = rows.filter(row => filter === "all" || row.status === filter);
  return <div className="panel queue-center"><div className="panel-title"><div><h2>คิวงานทั้งหมด</h2><p>รวมโพสต์ ความคิดเห็น แชร์ และถูกใจ · แสดงสูงสุดประเภทละ 500 รายการ</p></div><button className="secondary" disabled={busy} onClick={() => void reloadRef.current()}>รีเฟรชคิว</button></div>
    <div className="queue-summary">{[ ["running", "กำลังทำ"], ["pending", "รอทำ"], ["succeeded", "สำเร็จ"], ["failed", "ไม่สำเร็จ"] ].map(([status, label]) => <button key={status} className={filter === status ? "selected" : ""} onClick={() => setFilter(status)}><span>{label}</span><b>{rows.filter(row => row.status === status).length}</b></button>)}</div>
    <div className="queue-controls"><label>แสดงสถานะ<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">ทั้งหมด ({rows.length})</option>{Object.entries(queueStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><p>ยกเลิก = ไม่ให้เริ่มงาน · ลบ = เอารายการและประวัติออกจากโปรแกรม</p></div>
    {error && <p className="queue-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {loading ? <p role="status">กำลังโหลดคิว…</p> : !visible.length ? <div className="empty">ยังไม่มีงานในสถานะนี้ ไปที่ “สร้างงานและตั้งเวลา” เพื่อเพิ่มงาน</div> : <div className="table-wrap"><table><thead><tr><th>งาน / บัญชี</th><th>ปลายทาง</th><th>เวลาไทย (24 ชม.)</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>{visible.map(row => <tr key={`${row.kind}-${row.id}`}><td><b>{row.action}</b><small>{row.account}</small>{row.parentId && <small>ทำต่อจากขั้นตอนก่อนหน้า</small>}</td><td className="queue-target">{row.target}</td><td>{new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok", hourCycle: "h23" }).format(new Date(row.scheduledAt))}</td><td><span className={`status ${row.status}`}>{queueStatusLabels[row.status] || row.status}</span>{row.error && <small className="job-error">{row.error}</small>}</td><td><div className="queue-actions">{row.status === "pending" && <button disabled={busy} className="secondary small" onClick={() => void work(() => row.kind === "post" ? window.autopost.cancelJob(row.id) : window.autopost.cancelAction(row.id), "ยกเลิกงานแล้ว")}>ยกเลิกงาน</button>}{row.kind === "post" && row.status === "failed" && <button disabled={busy} className="secondary small" onClick={() => { if (confirm("ตรวจบน Facebook แล้วว่าไม่มีโพสต์ซ้ำ และต้องการลองใหม่?")) void work(() => window.autopost.retryJob(row.id), "เพิ่มงานกลับเข้าคิวแล้ว"); }}>ลองใหม่</button>}<button disabled={busy || row.status === "running"} className="danger small" title={row.status === "running" ? "รอให้งานจบก่อนลบ" : "ลบรายการและขั้นตอนลูก ไม่ลบโพสต์บน Facebook"} onClick={() => void work(() => window.autopost.deleteQueueItem(row.kind, row.id), "ลบรายการจากคิวแล้ว")}>ลบรายการ</button></div></td></tr>)}</tbody></table></div>}
  </div>;
}
