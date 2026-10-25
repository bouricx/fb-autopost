import { useEffect, useState } from "react";
import type { ScheduleSummary } from "../../electron/automation/schedule-manager";
export function ScheduleStatus() {
  const [plans, setPlans] = useState<ScheduleSummary[]>([]);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () => void window.autopost.listSchedules().then(rows => { if (active) setPlans(rows); }).catch(() => { if (active) setError("โหลดตารางไม่สำเร็จ"); });
    refresh(); const unsubscribe = window.autopost.onProgress(refresh);
    return () => { active = false; unsubscribe(); };
  }, []);
  if (!plans.length && !error) return null;
  const labels: Record<string, string> = { succeeded: "โพสต์ครบแล้ว", running: "กำลังโพสต์", pending: "รอเวลา / รอลองใหม่", failed: "ไม่สำเร็จ / ยกเลิก / ต้องตรวจผล" };
   return <div className="panel fields schedule-status"><h2>ตารางโพสต์และจำนวนรอบ</h2><small>หนึ่งรอบ = ทุกกลุ่มของเวลานั้น ต้องสำเร็จครบทุกกลุ่มจึงนับว่ารอบสำเร็จ</small>{error && <p role="alert">{error}</p>}{plans.map(plan => <div className="panel fields" key={plan.id}><b>{plan.name} · {plan.enabled ? "เปิดตาราง" : "หยุดตารางแล้ว"}</b><span>{plan.daily ? "ทุกวัน" : "วันเดียว"} · {plan.times.length} รอบ/วัน · {plan.times.join(" / ")}</span><p>วันนี้สำเร็จ {plan.succeeded}/{plan.todayTotal} รอบ · กำลังทำ {plan.running} · รอ {plan.pending} · ไม่สำเร็จ {plan.failed} · สำเร็จสะสม {plan.totalSucceeded} รอบ</p><details><summary>แสดงรายละเอียดแต่ละรอบ</summary>{plan.rounds.map(round => <small key={round.id}>{round.time} — {labels[round.status]} · สำเร็จ {round.succeededTargets}/{round.totalTargets} กลุ่ม</small>)}</details>{plan.enabled && <button className="secondary small" disabled={busy} onClick={() => { if (confirm("หยุดตารางนี้และยกเลิกรอบที่ยังรอ? งานที่กำลังทำจะไม่ถูกหยุดกลางทาง")) { setBusy(true); void window.autopost.stopSchedule(plan.id).then(() => window.autopost.listSchedules()).then(setPlans).catch(() => setError("หยุดตารางไม่สำเร็จ")).finally(() => setBusy(false)); } }}>หยุดตาราง / ยกเลิกรอบที่รอ</button>}</div>)}</div>;
}
