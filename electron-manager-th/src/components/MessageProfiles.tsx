import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, FolderOpen, Plus, Save, Trash2 } from "lucide-react";
import type { Account, Destination } from "../shared/types";
import { messageProfileSchema, type MessageProfile, type MessageProfileInput, type ProfileRun } from "../shared/message-profiles";
import { MediaPreview } from "./MediaPreview";

const fresh = (action: "post" | "comment" = "post"): MessageProfileInput => ({ name: "โปรไฟล์ใหม่", action, sets: ["A", "B"].map(name => ({ name: `ชุด ${name}`, caption: "", links: [], media: [] })) });
const thaiDate = (date: string) => new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(date));
export function MessageProfiles({ accounts, destinations, accountOnly }: { accounts: Account[]; destinations: Destination[]; accountOnly?: string }) {
  const [profiles, setProfiles] = useState<MessageProfile[]>([]);
  const [runs, setRuns] = useState<ProfileRun[]>([]);
  const [id, setId] = useState<string | null>(null);
  const [draft, setDraft] = useState(fresh);
  const [tab, setTab] = useState<"post" | "comment">("post");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [accountId, setAccountId] = useState(accountOnly || accounts.find(a => a.platform === "facebook")?.id || "");
  const [profileId, setProfileId] = useState("");
  const [at, setAt] = useState(() => new Date(Date.now() + 300000 + 7 * 3600000).toISOString().slice(0, 16));
  const [rounds, setRounds] = useState(1);
  const [repeatMinutes, setRepeatMinutes] = useState(60);
  const [delayMin, setDelayMin] = useState(30);
  const [delayMax, setDelayMax] = useState(90);
  const [shareEnabled, setShareEnabled] = useState(false);
  const [shareIds, setShareIds] = useState<string[]>([]);
  const [shareRepeat, setShareRepeat] = useState(0);
  const lock = useRef(false);
  const refresh = useCallback(async () => {
    const [p, r] = await Promise.all([window.autopost.listMessageProfiles(), window.autopost.listProfileRuns()]);
    setProfiles(p); setRuns(r);
  }, []);
  useEffect(() => {
    void refresh().catch(() => setMessage("โหลดโปรไฟล์ไม่สำเร็จ"));
    const off = window.autopost.onProgress(() => { void refresh().catch(() => setMessage("รีเฟรชโปรไฟล์ไม่สำเร็จ")); });
    const timer = setInterval(() => { void refresh().catch(() => setMessage("รีเฟรชโปรไฟล์ไม่สำเร็จ")); }, 15000);
    return () => { off(); clearInterval(timer); };
  }, [refresh]);
  useEffect(() => { if (accountOnly) { setAccountId(accountOnly); setShareIds([]); } }, [accountOnly]);
  useEffect(() => { if (!accounts.some(a => a.id === accountId)) setAccountId(accounts.find(a => a.platform === "facebook")?.id || ""); }, [accounts, accountId]);
  const perform = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage("");
    try { await action(); await refresh(); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { lock.current = false; setBusy(false); }
  };
  const save = () => perform(async () => {
    const result = messageProfileSchema.safeParse({ ...draft, sets: draft.sets.map(set => ({ ...set, links: set.links.map(link => link.trim()).filter(Boolean) })) });
    if (!result.success) throw new Error(result.error.issues.map(issue => issue.message).join(" · "));
    const saved = await window.autopost.saveMessageProfile(id, result.data);
    setId(saved); setProfileId(saved); setDirty(false); setMessage("บันทึกแล้ว ทุกบัญชีที่ใช้โปรไฟล์นี้จะใช้ค่าใหม่ในรอบถัดไป คิวที่สร้างแล้วใช้ข้อมูลเดิม");
  });
  useEffect(() => {
    if (accountOnly) return;
    const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); } };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  });
  function switchDraft(next: MessageProfileInput, nextId: string | null) {
    if (dirty && !window.confirm("มีข้อมูลที่ยังไม่บันทึก ต้องการทิ้งการแก้ไขหรือไม่?")) return;
    setDraft(structuredClone(next)); setId(nextId); setDirty(false);
  }
  const updateSet = (index: number, patch: Partial<MessageProfileInput["sets"][number]>) => {
    setDraft(current => ({ ...current, sets: current.sets.map((set, i) => i === index ? { ...set, ...patch } : set) })); setDirty(true);
  };
  const selectedProfile = profiles.find(p => p.id === profileId);
  const start = () => perform(async () => {
    if (!at || !profileId || !accountId) throw new Error("กรุณาเลือกบัญชี โปรไฟล์ และเวลา");
    await window.autopost.createProfileRun({ accountId, profileId, scheduledAt: new Date(`${at}:00+07:00`).toISOString(), rounds, repeatMinutes, delayMin, delayMax,
      shareEnabled: selectedProfile?.action === "post" && shareEnabled, shareDestinationIds: shareIds, shareRepeatMinutes: shareRepeat });
    setMessage("บันทึกตารางแล้ว เปิดระบบคิวเพื่อเริ่มเมื่อถึงเวลา คอมพิวเตอร์ต้องเปิดและเชื่อมต่ออินเทอร์เน็ต");
  });
  return <fieldset disabled={busy} className="profile-workspace">
    {!accountOnly && <div className="profile-editor panel fields">
      <div className="panel-title"><div><h2>โปรไฟล์ข้อความ</h2><p>ตั้งเนื้อหาแยกแต่ละชุด ใช้ร่วมกันได้หลายบัญชี</p></div><span className="profile-save-state">{dirty ? "ยังไม่บันทึก" : "บันทึกแล้ว / พร้อมแก้ไข"}</span></div>
      <div className="segmented" role="tablist" aria-label="ชนิดโปรไฟล์">{(["post", "comment"] as const).map(action => <button key={action} role="tab" aria-selected={tab === action} onClick={() => setTab(action)}>{action === "post" ? "โพสต์ลงกลุ่ม" : "ดันความคิดเห็น"}</button>)}</div>
      <div className="profile-commandbar"><select aria-label="เลือกโปรไฟล์เพื่อแก้ไข" value={profiles.some(p => p.id === id && p.action === tab) ? id! : ""} onChange={e => { const p = profiles.find(p => p.id === e.target.value); if (p) switchDraft(p, p.id); }}><option value="">เลือกโปรไฟล์…</option>{profiles.filter(p => p.action === tab).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <button className="secondary" onClick={() => switchDraft(fresh(tab), null)}><Plus size={16}/>โปรไฟล์ใหม่</button>
        <button className="secondary" onClick={() => switchDraft({ ...draft, name: `${draft.name} (สำเนา)` }, null)}><Copy size={16}/>ทำสำเนา</button>
        <button className="primary" disabled={busy} onClick={() => void save()}><Save size={16}/>บันทึก</button>
        {id && <button className="secondary" disabled={busy} onClick={() => { if (window.confirm("ลบโปรไฟล์นี้? โปรไฟล์ที่มีประวัติตารางจะลบไม่ได้")) void perform(async () => { await window.autopost.deleteMessageProfile(id); setDraft(fresh(tab)); setId(null); setDirty(false); }); }}><Trash2 size={16}/>ลบ</button>}
      </div>
      <label>ชื่อโปรไฟล์ · {draft.action === "post" ? "โพสต์" : "ดันความคิดเห็น"}<input value={draft.name} maxLength={100} onChange={e => { setDraft({ ...draft, name: e.target.value }); setDirty(true); }}/></label>
      <p className="form-hint">ลิงก์ทุกชุดจะสลับลำดับใหม่ทุกรอบ โดยข้อความและรูปยังอยู่กับลิงก์ชุดเดิม ห้ามใส่ลิงก์ซ้ำข้ามชุด</p>
      <div className="profile-sets">{draft.sets.map((set, index) => <article className="profile-set" key={index}>
        <div className="profile-commandbar"><input aria-label={`ชื่อชุด ${index + 1}`} value={set.name} onChange={e => updateSet(index, { name: e.target.value })}/><button className="secondary" disabled={draft.sets.length === 1} onClick={() => { setDraft({ ...draft, sets: draft.sets.filter((_, i) => i !== index) }); setDirty(true); }}>ลบชุด</button></div>
        <label>{draft.action === "post" ? "ลิงก์กลุ่ม" : "ลิงก์โพสต์"} · {set.links.filter(Boolean).length} รายการ<textarea rows={5} placeholder="https://www.facebook.com/groups/123/" value={set.links.join("\n")} onChange={e => updateSet(index, { links: e.target.value.split(/\r?\n/) })}/></label>
        <label>ข้อความของชุดนี้<textarea rows={4} value={set.caption} onChange={e => updateSet(index, { caption: e.target.value })}/></label>
        <div className="profile-commandbar"><button className="secondary" disabled={busy} onClick={() => void perform(async () => {
          if (draft.action === "post") {
            const result = await window.autopost.chooseImageFolder();
            if (result) updateSet(index, { media: result.paths, mediaFolder: result.folder });
          } else {
            const paths = await window.autopost.chooseMedia();
            if (paths.length > 1) throw new Error("ความคิดเห็นเลือกรูปได้หนึ่งรูป");
            if (paths.length) updateSet(index, { media: paths, mediaFolder: undefined });
          }
        })}><FolderOpen size={16}/>{draft.action === "post" ? "โฟลเดอร์รูป (แนบทุกรูป)" : "เลือกรูป 1 รูป"}</button><button className="secondary" onClick={() => updateSet(index, { media: [], mediaFolder: undefined })}>ล้างรูป</button></div>
        {set.mediaFolder && <small>โฟลเดอร์: {set.mediaFolder} · อ่านรูปใหม่ทุกรอบ</small>}
        <MediaPreview paths={set.media}/>
      </article>)}</div>
      <button className="secondary" disabled={draft.sets.length >= 52} onClick={() => { setDraft({ ...draft, sets: [...draft.sets, { name: `ชุด ${draft.sets.length + 1}`, links: [], caption: "", media: [] }] }); setDirty(true); }}><Plus size={16}/>เพิ่มชุด</button>
    </div>}
    <div className="panel fields profile-launcher"><div><h2>ตารางโปรไฟล์รายบัญชี</h2><p>เลือกโปรไฟล์ที่บันทึกแล้ว ตั้งเวลาและจำนวนรอบ</p></div>
      <div className="profile-form-grid">
        {!accountOnly && <label>บัญชี Facebook<select value={accountId} onChange={e => { setAccountId(e.target.value); setShareIds([]); }}>{accounts.filter(a => a.platform === "facebook").map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
        <label>ใช้โปรไฟล์<select value={profileId} onChange={e => setProfileId(e.target.value)}><option value="">เลือกโปรไฟล์…</option>{profiles.map(p => <option key={p.id} value={p.id}>{p.action === "post" ? "โพสต์" : "ดันเมนต์"} · {p.name}</option>)}</select></label>
        <label>เริ่มเมื่อ (เวลาไทย UTC+7)<input type="datetime-local" value={at} onChange={e => setAt(e.target.value)}/></label>
        <label>จำนวนรอบ (0 = วนต่อเนื่อง)<input type="number" min={0} max={10000} value={rounds} onChange={e => { setRounds(Number(e.target.value)); setShareRepeat(0); }}/></label>
        <label>ระยะห่างรอบ (นาที)<input type="number" min={1} value={repeatMinutes} onChange={e => setRepeatMinutes(Number(e.target.value))}/></label>
        <label>พักระหว่างเป้าหมายต่ำสุด (วินาที)<input type="number" min={0} value={delayMin} onChange={e => setDelayMin(Number(e.target.value))}/></label>
        <label>พักสูงสุด (วินาที)<input type="number" min={delayMin} value={delayMax} onChange={e => setDelayMax(Number(e.target.value))}/></label>
      </div>
      {selectedProfile?.action === "post" && <div className="profile-share"><label><input type="checkbox" checked={shareEnabled} onChange={e => setShareEnabled(e.target.checked)}/> แชร์โพสต์ที่เผยแพร่สำเร็จต่อไปยังกลุ่ม</label>{shareEnabled && <><div className="checks">{destinations.filter(d => d.accountId === accountId && d.kind === "facebook_group" && d.enabled).map(d => <label className={shareIds.includes(d.id) ? "checked" : ""} key={d.id}><input type="checkbox" checked={shareIds.includes(d.id)} onChange={e => setShareIds(current => e.target.checked ? [...current, d.id] : current.filter(id => id !== d.id))}/><i className="custom-check">✓</i><span>{d.name}</span></label>)}</div><label>แชร์ซ้ำทุก (นาที, 0 = ไม่ซ้ำ · ใช้กับโปรไฟล์ 1 รอบ)<input type="number" min={0} disabled={rounds !== 1} value={shareRepeat} onChange={e => setShareRepeat(Number(e.target.value))}/></label></>}</div>}
      <p className="form-hint">กลุ่มรออนุมัติจะถูกบันทึกแยก แล้วทำเป้าหมายถัดไป ไม่ส่งซ้ำกลุ่มนั้น · รอบใหม่รอคิวเดิมจบ · เลยเวลาเกิน 5 นาทีจะพักตาราง · แก้โปรไฟล์มีผลรอบถัดไป</p>
      <button className="primary" disabled={busy || !profileId || !accountId} onClick={() => void start()}>บันทึกตารางอัตโนมัติ</button>
      <div className="profile-runs">{runs.filter(run => !accountOnly || run.accountId === accountOnly).map(run => <div className="profile-run" key={run.id}><div><b>{run.profileName}</b><small>{accounts.find(a => a.id === run.accountId)?.name} · สร้างแล้ว {run.completedRounds}/{run.rounds || "∞"} รอบ · {run.enabled ? `รอบถัดไป ${thaiDate(run.nextRunAt)}` : "จบ / หยุดแล้ว"}</small>{run.lastError && <p role="alert">{run.lastError}</p>}</div>{run.enabled && <button className="secondary" disabled={busy} onClick={() => void perform(async () => { await window.autopost.stopProfileRun(run.id); setMessage("หยุดตารางแล้ว งานที่กำลังส่งจะรอให้จบ"); })}>หยุดตาราง</button>}</div>)}{!runs.length && <p>ยังไม่มีตารางโปรไฟล์</p>}</div>
    </div>
    {message && <div className="sync-notice" role="status">{message}</div>}
  </fieldset>;
}
