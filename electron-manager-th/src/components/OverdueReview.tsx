import { useEffect, useState } from "react";
import type { OverdueItem } from "../../electron/core/queue-safety";
import { scheduleInstant, bangkokDay } from "../shared/schedule";
import { Time24Picker } from "./Time24Picker";
export function OverdueReview() {
  const [rows, setRows] = useState<OverdueItem[]>([]), [selected, setSelected] = useState<string[]>([]);
  const [date, setDate] = useState(bangkokDay()), [time, setTime] = useState("18:00");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = () => void window.autopost.listOverdue().then(items => { if (active) { setRows(items); setSelected(current => current.filter(id => items.some(row => row.id === id))); } }).catch(() => { if (active) setError("โหลดคิวรอตรวจสอบไม่สำเร็จ"); });
    refresh(); const off = window.autopost.onProgress(refresh);
    return () => { active = false; off(); };
  }, []);
  if (!rows.length && !error) return null;
  const act = async (decision: "skip" | "reschedule" | "send") => {
    setBusy(true); setError("");
    try {
      await window.autopost.resolveOverdue({ items: rows.filter(row => selected.includes(row.id)).map(({ id, kind }) => ({ id, kind })), decision, ...(decision === "reschedule" ? { at: scheduleInstant(date, time) } : {}) });
      setRows(await window.autopost.listOverdue()); setSelected([]);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "ดำเนินการไม่สำเร็จ"); }
    finally { setBusy(false); }
  };
  return <div className="panel fields overdue-review"><h2>คิวเลยเวลา {rows.length} รายการ — พักไว้รอการตัดสินใจ</h2><p>ระบบพักไว้ ไม่ส่งย้อนหลังเอง เลือกรายการแล้วข้าม จัดเวลาใหม่ หรือยืนยันส่งย้อนหลัง งานที่อาจส่งแล้วจะไม่อนุญาตให้ส่งซ้ำจากหน้านี้</p>
    <button className="secondary small" disabled={busy} onClick={() => setSelected(rows.slice(0,500).map(row => row.id))}>เลือก 500 รายการแรก / ทั้งหมดที่มี</button><div className="overdue-items">{rows.map(row => <label key={`${row.kind}-${row.id}`}><input type="checkbox" checked={selected.includes(row.id)} disabled={busy} onChange={event => setSelected(current => event.target.checked ? [...current, row.id] : current.filter(id => id !== row.id))}/><span>{row.account} · {row.action} · {new Date(row.scheduledAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", hourCycle: "h23" })}<small>{row.submissionState === "not_sent" ? "ยังไม่ส่ง" : "อาจส่งแล้ว / ต้องตรวจ Facebook"} · {row.error}</small></span></label>)}</div>
    <div className="overdue-controls"><button className="secondary" disabled={busy || !selected.length} onClick={() => void act("skip")}>ข้ามที่เลือก</button><input aria-label="วันจัดเวลาใหม่" type="date" value={date} onChange={event => setDate(event.target.value)}/><Time24Picker value={time} onChange={setTime}/><button className="secondary" disabled={busy || !selected.length} onClick={() => void act("reschedule")}>จัดเวลาใหม่ (เวลาไทย)</button><button className="danger" disabled={busy || !selected.length} onClick={() => void act("send")}>ยืนยันส่งย้อนหลัง</button></div>{error && <p role="alert">{error}</p>}
  </div>;
}
