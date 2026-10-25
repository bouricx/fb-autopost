import { useEffect, useState } from "react";
import type { Account } from "../shared/types";
export function NotificationChannels({ accounts }: { accounts: Account[] }) {
  const [channels, setChannels] = useState<Awaited<ReturnType<typeof window.autopost.listNotificationChannels>>>([]);
  const [projects, setProjects] = useState<Awaited<ReturnType<typeof window.autopost.listProjects>>>([]);
  const [name, setName] = useState(""); const [type, setType] = useState("discord");
  const [secret, setSecret] = useState(""); const [chatId, setChatId] = useState("");
  const [accountId, setAccountId] = useState(""); const [projectId, setProjectId] = useState("");
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { void Promise.all([window.autopost.listNotificationChannels(), window.autopost.listProjects()]).then(([rows, presets]) => { setChannels(rows); setProjects(presets); }).catch(() => setMessage("โหลดช่องแจ้งเตือนไม่สำเร็จ")); }, []);
  const save = async () => {
    setBusy(true); setMessage("");
    try {
      if (!accountId && !projectId) throw new Error("กรุณาเลือกบัญชีหรือโปรเจกต์");
      await window.autopost.createNotificationChannel({ name, type, secret, chatId, accountId: accountId || null, projectId: projectId || null });
      setSecret(""); setChannels(await window.autopost.listNotificationChannels()); setMessage("บันทึกช่องแจ้งเตือนแบบเข้ารหัสแล้ว");
    } catch { setMessage("บันทึกไม่สำเร็จ กรุณาตรวจชื่อ URL/Token และบัญชีหรือโปรเจกต์"); }
    finally { setBusy(false); }
  };
  return <div className="panel fields"><h2>ช่องแจ้งเตือน Discord / Telegram</h2><label>ชื่อช่อง<input value={name} onChange={e => setName(e.target.value)}/></label>
    <label>ประเภท<select value={type} onChange={e => { setType(e.target.value); setSecret(""); }}><option value="discord">Discord Webhook</option><option value="telegram">Telegram Bot</option></select></label>
    <label>{type === "discord" ? "Webhook URL" : "Bot Token"}<input type="password" value={secret} autoComplete="off" onChange={e => setSecret(e.target.value)}/></label>
    {type === "telegram" && <label>Chat ID<input value={chatId} onChange={e => setChatId(e.target.value)}/></label>}
    <label>บัญชี<select value={accountId} onChange={e => setAccountId(e.target.value)}><option value="">ไม่ระบุ</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
    <label>โปรเจกต์ (ใช้ก่อนค่าบัญชี)<select value={projectId} onChange={e => setProjectId(e.target.value)}><option value="">ไม่ระบุ</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
    <button className="primary" disabled={busy || !secret || !name.trim()} onClick={() => void save()}>บันทึกช่อง</button>{message && <p role="status">{message}</p>}
     {!channels.length && <p>ยังไม่มีช่องแจ้งเตือน</p>}{channels.map(channel => <div key={channel.id}>{channel.name} · {channel.type} {channel.type === "discord" && <><button className="secondary small" disabled={busy} onClick={() => { setBusy(true); void window.autopost.probeNotificationChannel(channel.id).then(setMessage).catch(() => setMessage("ตรวจ Webhook ไม่สำเร็จ")).finally(() => setBusy(false)); }}>ตรวจ Webhook (ไม่ส่งข้อความ)</button><button className="secondary small" disabled={busy} onClick={() => { if (!confirm("ส่งข้อความทดสอบ 1 ข้อความไปยังช่อง Discord นี้? (ไม่โพสต์ Facebook)")) return; setBusy(true); void window.autopost.testNotificationDelivery(channel.id).then(setMessage).catch(() => setMessage("ส่งข้อความทดสอบไม่สำเร็จ")).finally(() => setBusy(false)); }}>ส่งข้อความทดสอบ Discord</button></>}<button className="secondary small" onClick={() => { if (confirm("ลบช่องแจ้งเตือนนี้?")) void window.autopost.deleteNotificationChannel(channel.id).then(() => window.autopost.listNotificationChannels()).then(setChannels).catch(() => setMessage("ลบไม่สำเร็จ")); }}>ลบ</button></div>)}
  </div>;
}
