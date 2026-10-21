import { useEffect, useState } from "react";
import type { AutomationTask } from "../../electron/automation/contracts";

export function WorkflowHistory() {
  const [tasks, setTasks] = useState<AutomationTask[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = () => void window.autopost.listActions().then(rows => { if (active) { setTasks(rows); setError(""); } }).catch(() => { if (active) setError("โหลดชุดงานไม่สำเร็จ"); });
    refresh(); const unsubscribe = window.autopost.onProgress(refresh);
    return () => { active = false; unsubscribe(); };
  }, []);
  const labels = { post: "โพสต์", comment: "ความคิดเห็น", share: "แชร์", like: "ถูกใจ" };
  const statuses: Record<string, string> = { pending: "รอทำงาน", running: "กำลังทำงาน", succeeded: "สำเร็จ", failed: "ล้มเหลว", uncertain: "ต้องตรวจผลเอง", cancelled: "ยกเลิก" };
  return <div className="panel fields"><h2>ชุดงานโพสต์และขั้นตอนต่อเนื่อง</h2>{error && <p role="alert">{error}</p>}{!tasks.length && <p>ยังไม่มีชุดงานต่อเนื่อง</p>}{tasks.map(task => <div className="destination-row" key={task.id}><div><b>{labels[task.action]} · {statuses[task.status] || task.status}</b><span>{task.payload.targetUrl}</span>{task.lastError && <small>{task.lastError}</small>}</div>{task.status === "pending" && <button className="secondary small" onClick={() => void window.autopost.cancelAction(task.id).then(() => window.autopost.listActions()).then(setTasks).catch(() => setError("ยกเลิกไม่สำเร็จ"))}>ยกเลิก</button>}</div>)}</div>;
}
