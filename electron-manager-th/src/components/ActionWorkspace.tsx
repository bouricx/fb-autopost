import { useEffect, useState } from "react";
import type { Account, Destination } from "../shared/types";
import type { AutomationTask } from "../../electron/automation/contracts";
import { MediaPreview } from "./MediaPreview";
import { FEATURES } from "../shared/features";

export function ActionWorkspace({ action, accounts, destinations }: { action: "comment" | "share" | "like"; accounts: Account[]; destinations: Destination[] }) {
  if (!FEATURES[action]) return <div className="panel fields"><h2>ฟีเจอร์ยังปิดใช้งาน</h2><p>ฟีเจอร์คอมเมนต์ / แชร์ / ไลค์ ยังปิดใช้งานอยู่ สามารถเปิดได้ภายหลัง</p></div>;
  const [enabled, setEnabled] = useState({ comment: action === "comment", share: action === "share", like: action === "like" });
  const [shareCaption, setShareCaption] = useState("");
  const [accountId, setAccountId] = useState(accounts.find(account => account.platform === "facebook")?.id || "");
  const [urls, setUrls] = useState("");
  const [caption, setCaption] = useState("");
  const [media, setMedia] = useState<string[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [headless, setHeadless] = useState("account");
  const [repeat, setRepeat] = useState(0);
  const [busy, setBusy] = useState(false);
  const [channels, setChannels] = useState<Awaited<ReturnType<typeof window.autopost.listNotificationChannels>>>([]);
  const [channelId, setChannelId] = useState("");
  useEffect(() => { void window.autopost.listNotificationChannels().then(setChannels).catch(() => undefined); }, []);
  const [message, setMessage] = useState("");
  const [tasks, setTasks] = useState<AutomationTask[]>([]);
  const labels = { comment: "ความคิดเห็น", share: "แชร์เข้ากลุ่ม", like: "ถูกใจ" };
  useEffect(() => {
    let active = true;
    const refresh = () => void window.autopost.listActions().then(rows => { if (active) setTasks(rows); }).catch(() => { if (active) setMessage("โหลดประวัติไม่สำเร็จ"); });
    refresh(); const unsubscribe = window.autopost.onProgress(refresh);
    return () => { active = false; unsubscribe(); };
  }, []);
  const start = async () => {
    setBusy(true); setMessage("");
    try {
      const targets = [...new Set(urls.split(/\r?\n/).map(url => url.trim()).filter(Boolean))];
      if (!targets.length) throw new Error("กรุณาระบุ URL โพสต์อย่างน้อยหนึ่งรายการ");
      if (!Object.values(enabled).some(Boolean)) throw new Error("กรุณาเปิดอย่างน้อยหนึ่งการทำงาน");
      if (enabled.comment && !caption.trim() && !media.length) throw new Error("กรุณาใส่ข้อความหรือรูปความคิดเห็น");
      if (enabled.share && !groups.length) throw new Error("กรุณาเลือกกลุ่มสำหรับแชร์");
      const missing = await window.autopost.previewMedia(enabled.comment ? media : []);
      if (missing.some(item => item.missing)) throw new Error("ไม่พบไฟล์สื่อ");
      const base = { headless: headless === "account" ? null : headless === "headless", channelId: channelId || null };
      const workflows = targets.map(targetUrl => {
        const steps: { action: "comment" | "share" | "like"; payload: unknown }[] = [];
        if (enabled.comment) steps.push({ action: "comment", payload: { ...base, targetUrl, caption, media } });
        if (enabled.share) for (const group of destinations.filter(group => groups.includes(group.id) && group.accountId === accountId)) {
          steps.push({ action: "share", payload: { ...base, targetUrl: group.url, sourceUrl: targetUrl, groupName: group.name, caption: shareCaption, media: [], repeatMinutes: repeat } });
        }
        if (enabled.like) steps.push({ action: "like", payload: { ...base, targetUrl, caption: "", media: [] } });
        return steps;
      });
      const ids = await window.autopost.startActionWorkflow({ accountId, workflows });
      setMessage(`เพิ่มคิว ${ids.length} รายการแล้ว เปิดระบบคิวในหน้าตั้งค่าเพื่อเริ่มทำงาน`);
      setTasks(await window.autopost.listActions());
    } catch (error) { setMessage(error instanceof Error ? error.message : "เริ่มงานไม่สำเร็จ"); }
    finally { setBusy(false); }
  };
  return <div className="panel fields"><h2>ความคิดเห็น · แชร์ · ถูกใจ</h2><p>เปิดเฉพาะขั้นตอนที่ต้องการ แล้วกดเริ่มครั้งเดียว ระบบทำตามลำดับ ความคิดเห็น → แชร์เข้ากลุ่ม → ถูกใจ ต่อโพสต์ หากขั้นตอนก่อนหน้าไม่สำเร็จจะหยุดขั้นตอนถัดไป</p>
    <div className="action-toggles">{(["comment", "share", "like"] as const).map(kind => <label className={enabled[kind] ? "enabled" : ""} key={kind}><input type="checkbox" checked={enabled[kind]} disabled={busy} onChange={e => setEnabled(current => ({ ...current, [kind]: e.target.checked }))}/><b>{labels[kind]}</b><small>{enabled[kind] ? "เปิดใช้งาน" : "ปิดใช้งาน"}</small></label>)}</div>
    <label>บัญชี<select value={accountId} onChange={e => { setAccountId(e.target.value); setGroups([]); }}>{accounts.filter(account => account.platform === "facebook").map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
    <label>URL โพสต์ (หนึ่งรายการต่อบรรทัด)<textarea rows={5} value={urls} onChange={e => setUrls(e.target.value)}/></label>
    {enabled.comment && <div className="panel fields"><h3>ตั้งค่าความคิดเห็น</h3><label>ข้อความความคิดเห็น<textarea rows={3} value={caption} onChange={e => setCaption(e.target.value)}/></label><button className="secondary" onClick={() => void window.autopost.chooseMedia().then(paths => setMedia(paths.slice(0, 1))).catch(() => setMessage("เลือกไฟล์ไม่สำเร็จ"))}>เลือกรูปความคิดเห็น (1 ไฟล์)</button><MediaPreview paths={media}/></div>}
    {enabled.share && <div className="panel fields"><h3>ตั้งค่าการแชร์</h3><label>ข้อความแชร์<textarea rows={3} value={shareCaption} onChange={e => setShareCaption(e.target.value)}/></label><p>แชร์แบบ Facebook ใช้รูปต้นฉบับ เปลี่ยนรูปให้ใช้หน้าสร้างโพสต์แทน</p><div className="checks">{destinations.filter(group => group.accountId === accountId && group.kind === "facebook_group").map(group => <label key={group.id}><input type="checkbox" checked={groups.includes(group.id)} onChange={e => setGroups(current => e.target.checked ? [...current, group.id] : current.filter(id => id !== group.id))}/><span>{group.name}</span></label>)}</div><label>แชร์ซ้ำทุก (นาที, 0 = ไม่ซ้ำ)<input type="number" min={0} max={525600} value={repeat} onChange={e => setRepeat(Number(e.target.value))}/></label></div>}
    <label>Chrome<select value={headless} onChange={e => setHeadless(e.target.value)}><option value="account">ใช้ค่าบัญชี</option><option value="headless">ไม่แสดงหน้าต่าง</option><option value="headed">แสดงหน้าต่าง</option></select></label>
    <label>ช่องแจ้งเตือนเฉพาะงาน<select value={channelId} onChange={e => setChannelId(e.target.value)}><option value="">ใช้ค่าบัญชี / โปรเจกต์</option>{channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
    <button className="primary" disabled={busy || !accountId || !Object.values(enabled).some(Boolean)} onClick={() => void start()}>{busy ? "กำลังเพิ่มคิว…" : "เริ่มการทำงานที่เปิดไว้"}</button>{message && <p role="status">{message}</p>}
    <h3>ประวัติและคิวรวม</h3>{!tasks.length && <p>ยังไม่มีงาน</p>}{tasks.map(task => <div key={task.id}><b>{task.action === "post" ? "โพสต์" : labels[task.action]} · {({ pending: "รอทำงาน", running: "กำลังทำงาน", succeeded: "สำเร็จ", failed: "ล้มเหลว", uncertain: "ต้องตรวจผลเอง", cancelled: "ยกเลิกแล้ว" } as Record<string, string>)[task.status] || task.status}</b> {task.payload.targetUrl}<small>{task.lastError}</small>{task.status === "pending" && <button className="secondary small" onClick={() => void window.autopost.cancelAction(task.id).then(() => window.autopost.listActions()).then(setTasks).catch(() => setMessage("ยกเลิกไม่สำเร็จ"))}>ยกเลิก</button>}</div>)}
  </div>;
}
