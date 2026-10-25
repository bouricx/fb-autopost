import { MessageProfiles } from "./components/MessageProfiles";
import { ActionWorkspace } from "./components/ActionWorkspace";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ProjectToolbar } from "./components/ProjectToolbar";
import { MediaPreview } from "./components/MediaPreview";
import { Time24Picker } from "./components/Time24Picker";
import { mainPostContent } from "./shared/post-content";
import { validateDelay } from "./shared/delay";
import { NotificationChannels } from "./components/NotificationChannels";
import { UnifiedQueue } from "./components/UnifiedQueue";
import { ScheduleStatus } from "./components/ScheduleStatus";
import { OverdueReview } from "./components/OverdueReview";
import type { WorkspaceSettings, AccountWorkspace } from "../electron/projects/project-manager";
import {
  Copy as CopyIcon, Activity, CalendarClock, CircleGauge, FileClock, LogOut, Plus, RefreshCw,
  Send, Settings, Trash2, Users, Wifi, WifiOff, X,
} from "lucide-react";
import type { Account, AdapterType, Dashboard, Destination, DestinationKind, FacebookGroupInfo, Job, LogEntry } from "./shared/types";
import { FEATURES } from "./shared/features";
import "./styles/accounts.css";
import "./styles/group-picker.css";

type Page = "dashboard" | "accounts" | "compose" | "queue" | "logs" | "settings" | "profiles" | "actions";
const pageTitle: Record<Page, [string, string]> = {
  profiles: ["โปรไฟล์ข้อความ", "จัดเนื้อหาเป็นชุด ใช้ร่วมกันหลายบัญชีและวนตามเวลา"],
  actions: ["แชร์ · คอมเมนต์ · ถูกใจ", "เลือกขั้นตอนและเป้าหมาย พร้อมติดตามผลแต่ละรายการ"],
  dashboard: ["ภาพรวม", "สถานะงานและสถิติการโพสต์ล่าสุด"],
  accounts: ["บัญชีและปลายทาง", "จัดการ Facebook, Discord และตำแหน่งที่จะโพสต์"],
  compose: ["สร้างและตั้งเวลา", "สร้างโพสต์และจัดคิวอย่างปลอดภัย พร้อมตรวจสอบ permalink"],
  queue: ["คิวและประวัติ", "ติดตามงานที่รอ กำลังทำ สำเร็จ และล้มเหลว"],
  logs: ["บันทึกการทำงาน", "เหตุการณ์จากระบบคิวและตัวเชื่อมต่อแพลตฟอร์ม"],
  settings: ["ตั้งค่า", "การทำงานเบื้องหลังและข้อควรทราบ"],
};

const BANGKOK_OFFSET = 7 * 60 * 60 * 1000;
const formatThaiTime = (value: string) => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", hourCycle: "h23", timeZone: "Asia/Bangkok" }).format(new Date(value)) : "กรุณาเลือกวันและเวลา";
const thaiInputTime = (minutes = 5) => new Date(Date.now() + minutes * 60_000 + BANGKOK_OFFSET).toISOString().slice(0, 16);
const tomorrowMorningThai = () => `${new Date(Date.now() + 24 * 60 * 60_000 + BANGKOK_OFFSET).toISOString().slice(0, 10)}T09:00`;
const thaiInputToUtc = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return "";
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - 7, minute)).toISOString();
};

export function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [worker, setWorker] = useState(true);
  const [error, setError] = useState("");
  const [liveEvents, setLiveEvents] = useState<import("../electron/core/progress-bus").ProgressEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [lastFailure, setLastFailure] = useState<string | null>(null);
  const mutationLock = useRef(false);
  const refreshSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    try {
      const [d, a, dest, j, l, w] = await Promise.all([
        window.autopost.dashboard(), window.autopost.listAccounts(), window.autopost.listDestinations(),
        window.autopost.listJobs(), window.autopost.listLogs(), window.autopost.workerStatus(),
      ]);
      if (sequence !== refreshSequence.current) return;
      setDashboard(d); setAccounts(a); setDestinations(dest); setJobs(j); setLogs(l); setWorker(w.running);
    } catch (e) { if (sequence === refreshSequence.current) setError(e instanceof Error ? e.message : String(e)); }
  }, []);

  useEffect(() => {
    void refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = window.autopost.onProgress(event => {
      setLiveEvents(current => [event, ...current].slice(0, 50));
      if (event.type === "target.failed") setLastFailure(event.message);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void refresh(); }, 120);
    });
    const focus = () => { void refresh(); };
    window.addEventListener("focus", focus);
    return () => { unsubscribe(); if (timer) clearTimeout(timer); window.removeEventListener("focus", focus); };
  }, [refresh]);
  const mutate = async (action: () => Promise<unknown>) => {
    if (mutationLock.current) return false;
    mutationLock.current = true; setBusy(true); setNotice("");
    try { setError(""); await action(); await refresh(); setNotice("ดำเนินการสำเร็จ ข้อมูลอัปเดตแล้ว"); return true; }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; }
    finally { mutationLock.current = false; setBusy(false); }
  };

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Send size={20}/></div><div><b>AutoPost</b><span>Manager TH</span></div></div>
      <nav>
        <Nav active={page === "dashboard"} icon={<CircleGauge/>} label="ภาพรวมและสถานะ" onClick={() => setPage("dashboard")}/>
        <Nav active={page === "accounts"} icon={<Users/>} label="1. บัญชีและปลายทาง" onClick={() => setPage("accounts")}/>
        <Nav active={page === "compose"} icon={<CalendarClock/>} label="2. สร้างงานและตั้งเวลา" onClick={() => setPage("compose")}/>
        <Nav active={page === "profiles"} icon={<CopyIcon/>} label="โปรไฟล์ข้อความ" onClick={() => setPage("profiles")}/>
        <Nav active={page === "actions"} icon={<Send/>} label="แชร์ / คอมเมนต์ / ถูกใจ" onClick={() => setPage("actions")}/>
        <Nav active={page === "queue"} icon={<FileClock/>} label="3. คิวและผลการทำงาน" badge={dashboard?.pending} onClick={() => setPage("queue")}/>
        <Nav active={page === "logs"} icon={<Activity/>} label="Log การทำงาน" onClick={() => setPage("logs")}/>
        <Nav active={page === "settings"} icon={<Settings/>} label="ตั้งค่า" onClick={() => setPage("settings")}/>
      </nav>
      <div className="sidebar-bottom"><div className={`worker-pill ${worker ? "on" : "off"}`}>{worker ? <Wifi/> : <WifiOff/>}<span>{worker ? "ระบบคิวทำงาน" : "ระบบคิวหยุด"}</span></div><div className="velt-credit"><span>POWERED BY</span><b>VELTSHOP</b><small>AutoPost Manager</small></div></div>
    </aside>
    <main className={page === "compose" ? "compose-page" : ""}>
      <header><div><h1>{pageTitle[page][0]}</h1><p>{pageTitle[page][1]}</p></div><button className="icon-button" onClick={() => void refresh()} title="รีเฟรช"><RefreshCw/></button></header>
      {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError("")}><X/></button></div>}
      {lastFailure && <div className="error-banner" role="alert"><span>โพสต์/งานไม่สำเร็จ: {lastFailure} — ตรวจคิวและ Log ก่อนส่งซ้ำ</span><button onClick={() => setLastFailure(null)} aria-label="ปิดแจ้งเตือน"><X/></button></div>}
      {(busy || notice) && <div className="sync-notice" role="status">{busy ? "กำลังดำเนินการ กรุณารอสักครู่…" : notice}</div>}
      <section className="content">
        <fieldset className="workspace-fieldset" disabled={busy}>
        {(page === "dashboard" || page === "queue") && <OverdueReview/>}
        {(page === "queue" || page === "dashboard") && <ScheduleStatus/>}
        <div className="workflow-overview"><div className="usage-steps">{([
          ["accounts", "1", "เตรียมบัญชี", `${accounts.length} บัญชี · ${destinations.length} ปลายทาง`],
          ["compose", "2", "สร้างและตั้งเวลา", "ข้อความ · สื่อ · โพสต์หลัก"],
          ["queue", "3", "ตรวจคิวและผลลัพธ์", `รอ ${dashboard?.pending || 0} · กำลังทำ ${dashboard?.running || 0}`],
        ] as const).map(([target, number, title, detail]) => <button key={target} className={page === target ? "active" : ""} onClick={() => setPage(target)}><i>{number}</i><span><b>{title}</b><small>{detail}</small></span></button>)}</div>
        <div className="worker-control"><span className={worker ? "worker-running" : "worker-stopped"}>{worker ? "● ระบบคิวเปิดอยู่" : "● ระบบคิวหยุดอยู่"}</span><small>{worker ? "งานจะเริ่มเมื่อถึงเวลาที่ตั้ง" : "เพิ่มงานได้ แต่จะยังไม่เริ่มทำงาน"}</small><button className={worker ? "secondary small" : "primary small"} onClick={() => void mutate(() => worker ? window.autopost.stopWorker() : window.autopost.startWorker())}>{worker ? "หยุดรับงาน / รองานปัจจุบันจบ" : "เปิดระบบคิว"}</button></div></div>
        {page === "settings" && <NotificationChannels accounts={accounts}/>}
        {!!liveEvents.length && <div className="panel live-progress" role="status">{liveEvents.slice(0, 3).map((event, index) => {
          const account = accounts.find(row => row.id === event.accountId);
          const hue = [...(event.accountId || "system")].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
          return <div key={`${event.at}-${index}`} style={{ borderLeft: `3px solid hsl(${hue} 75% 65%)`, paddingLeft: 10 }}><small>{account?.name || "ระบบ"}</small><span> {event.message}</span>{event.percent !== undefined && <progress max={100} value={event.percent}/>}</div>;
        })}</div>}
        {page === "dashboard" && <DashboardView data={dashboard} jobs={jobs} logs={logs} worker={worker}/>}
        {page === "profiles" && <MessageProfiles accounts={accounts} destinations={destinations}/>}
        {page === "actions" && <ActionWorkspace action="share" accounts={accounts} destinations={destinations}/>}
        {page === "accounts" && <AccountsView accounts={accounts} destinations={destinations} mutate={mutate}/>}
         <div className="composer-host" hidden={page !== "compose"}><Composer accounts={accounts} destinations={destinations} mutate={mutate}/></div>
         {page === "queue" && <UnifiedQueue accounts={accounts}/>}
        {page === "logs" && <LogsView logs={logs}/>}
         {page === "settings" && <SettingsView worker={worker} mutate={mutate}/>}
        </fieldset>
      </section>
    </main>
  </div>;
}

function Nav({ active, icon, label, badge, onClick }: { active: boolean; icon: React.ReactNode; label: string; badge?: number; onClick(): void }) {
  return <button className={active ? "nav active" : "nav"} onClick={onClick}>{icon}<span>{label}</span>{badge ? <i>{badge}</i> : null}</button>;
}

function DashboardView({ data, jobs, logs, worker }: { data: Dashboard | null; jobs: Job[]; logs: LogEntry[]; worker: boolean }) {
  const cards = [
    ["รอโพสต์", data?.pending || 0, "blue"], ["สำเร็จ", data?.succeeded || 0, "green"],
    ["ล้มเหลว", data?.failed || 0, "red"], ["อัตราสำเร็จ", `${data?.successRate || 0}%`, "violet"],
  ];
  const latestError = logs.find(log => log.level === "error");
  const next = data?.nextScheduledAt ? { nextAttemptAt: data.nextScheduledAt } : [...jobs].filter(job => job.status === "pending").sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt))[0];
  return <><div className="status-center"><div className={`system-state ${worker ? "healthy" : "stopped"}`}><span className="pulse-dot"/><div><b>{worker ? "ระบบพร้อมโพสต์อัตโนมัติ" : "ระบบคิวหยุดทำงาน"}</b><small>{worker ? `กำลังดูแล ${data?.accounts || 0} บัญชี` : "เปิดระบบคิวเพื่อทำงานตามเวลา"}</small></div></div><div className="next-state"><span>งานถัดไป</span><b>{next ? formatThaiTime(next.nextAttemptAt) : "ยังไม่มีงานรอ"}</b><small>เวลาไทย (UTC+7)</small></div><div className={`alert-state ${latestError ? "has-error" : "clear"}`}><span>สถานะแจ้งเตือน</span><b>{latestError ? latestError.scope : "ระบบทำงานปกติ"}</b><small>{latestError ? latestError.message.slice(0, 90) : "ไม่พบข้อผิดพลาดล่าสุด"}</small></div></div>
    <div className="stats-grid">{cards.map(([label, value, color]) => <div className={`stat-card ${color}`} key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <div className="dashboard-grid"><div className="panel"><div className="panel-title"><div><h2>ตารางโพสต์ถัดไป</h2><p>เวลาทั้งหมดแสดงเป็นเวลาไทย</p></div><CalendarClock/></div><JobTable jobs={jobs.filter(j => j.status === "pending").slice(0, 8)} compact /></div>
    <div className="panel activity-panel"><div className="panel-title"><div><h2>สถานะและการแจ้งเตือน</h2><p>Log ล่าสุดจากระบบโพสต์</p></div><Activity/></div><div className="activity-feed">{logs.slice(0, 10).map(log => <div className={`activity-item ${log.level}`} key={log.id}><span className="activity-dot"/><div><b>{log.scope}</b><p>{log.message}</p><time>{formatThaiTime(log.createdAt)}</time></div></div>)}{!logs.length && <div className="empty">ยังไม่มีการแจ้งเตือน</div>}</div></div></div></>;
}

function AccountsView({ accounts, destinations, mutate }: { accounts: Account[]; destinations: Destination[]; mutate(action: () => Promise<unknown>): Promise<boolean> }) {
  const [showAccount, setShowAccount] = useState(false);
  const [showDestination, setShowDestination] = useState(false);
  const [showGroups, setShowGroups] = useState(false);
  const [showFacebookLogin, setShowFacebookLogin] = useState(false);
  const [backup, setBackup] = useState<"export" | "import" | null>(null);
  const [selected, setSelected] = useState(accounts[0]?.id || "");
  const [editingName, setEditingName] = useState(false);
  const [accountName, setAccountName] = useState("");
  useEffect(() => { if (!accounts.some(a => a.id === selected)) setSelected(accounts[0]?.id || ""); }, [accounts, selected]);
  return <div className="two-column accounts-layout">
    <div className="panel account-session-panel"><div className="panel-title"><div><h2>Session และข้อมูลบัญชี</h2><p>เลือกบัญชีทางขวาเพื่อตรวจสอบ</p></div></div>
      {accounts.filter(a => a.id === selected && a.platform === "facebook").map(account => <div className="account-session-details" key={account.id}>
         <div className="session-summary"><b>{account.name}</b><span>ชื่อ Facebook: {account.facebookName || "ยังยืนยันไม่ได้"}</span><span>ประเภท: {account.facebookActorType === "profile" ? "บัญชีส่วนตัว" : account.facebookActorType === "page" ? "เพจ" : "ยังไม่ยืนยัน"}</span><span>สถานะ: {({ online: "ออนไลน์", expired: "หมดอายุ", restricted: "ถูกจำกัด", checkpoint: "ต้องยืนยันตัวตน", disabled: "ถูกปิดใช้งาน", unknown: "ยังไม่ทราบ" } as Record<string, string>)[account.sessionStatus || "unknown"]} · ตรวจล่าสุด {account.lastCheckedAt ? formatThaiTime(account.lastCheckedAt) : "ยังไม่เคยตรวจ"} · {account.status === "paused" ? "บัญชีถูกพักการโพสต์" : account.statusMessage}</span>{account.status === "paused" && <span className="session-paused-warning">บัญชีถูกพักการโพสต์ กรุณาตรวจเครือข่ายและ Session ก่อนตัดสินใจเริ่มงานใหม่</span>}</div>
        {!editingName ? <button className="secondary small session-rename" onClick={() => { setAccountName(account.name); setEditingName(true); }}>เปลี่ยนชื่อที่แสดงในโปรแกรม</button> : <form className="session-rename-form" onSubmit={e => { e.preventDefault(); void mutate(() => window.autopost.renameAccount(account.id, accountName)).then(ok => { if (ok) setEditingName(false); }); }}><label>ชื่อบัญชี<input value={accountName} maxLength={80} required onChange={e => setAccountName(e.target.value)}/></label><button className="primary small" disabled={!accountName.trim()}>บันทึก</button><button type="button" className="secondary small" onClick={() => setEditingName(false)}>ยกเลิก</button></form>}
        <details className="account-profile-settings"><summary>โปรไฟล์ข้อความและแชร์คู่กับงานโพสต์</summary><MessageProfiles accounts={accounts} destinations={destinations} accountOnly={account.id}/></details>
        <div className="session-action-grid"><button className="primary" onClick={() => void mutate(() => window.autopost.checkSession(account.id))}>ตรวจสอบสถานะ</button><button className="secondary" onClick={() => void mutate(() => window.autopost.loginAndCheckFacebook(account.id))}>เข้าสู่ระบบด้วย Chrome</button></div>
        <details className="session-more"><summary>จัดการ Session และข้อมูลสำรอง</summary><div className="session-action-grid"><button className="secondary" onClick={() => void mutate(() => window.autopost.copyCookie(account.id))}>คัดลอก Cookie (ล้างใน 45 วินาที)</button><button className="secondary" onClick={() => setBackup("export")}>สำรอง Session</button><button className="secondary" onClick={() => setBackup("import")}>กู้คืน Session</button><label><input type="checkbox" checked={!!account.headless} onChange={e => void mutate(() => window.autopost.setHeadless(account.id, e.target.checked))}/> ตรวจแบบไม่แสดงหน้าต่าง</label></div><small>หยุดคิวก่อนตรวจสอบหรือลบ Session</small><button className="danger" onClick={() => void mutate(() => window.autopost.deleteSession(account.id))}>ลบ Session และข้อมูลบัญชี</button></details>
      </div>)}
      {!accounts.some(a => a.id === selected && a.platform === "facebook") && <p className="form-hint">เลือกบัญชี Facebook เพื่อดูสถานะ Session</p>}
    </div>
    {showFacebookLogin && <FacebookLoginModal accounts={accounts} select={setSelected} close={() => { setShowFacebookLogin(false); void mutate(async () => undefined); }}/ >}
    {backup && <SessionBackupModal mode={backup} accountId={selected} close={() => { setBackup(null); void mutate(async () => undefined); }}/ >}
    <div className="panel"><div className="panel-title"><div><h2>บัญชี</h2><p>{accounts.length} บัญชี</p></div><button className="primary small" onClick={() => setShowAccount(true)}><Plus/>เพิ่มบัญชี</button></div>
      <div className="account-list">{accounts.map(account => <button key={account.id} className={`account-row ${selected === account.id ? "selected" : ""}`} onClick={() => { setSelected(account.id); setEditingName(false); }}>
        <div className={`platform ${account.platform}`}>{account.platform === "facebook" && account.facebookPhotoUrl ? <img src={account.facebookPhotoUrl} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }}/> : account.platform === "facebook" ? "f" : "#"}</div><div><b>{account.name}</b><span>{account.platform === "facebook" ? `${account.facebookName ? `Facebook: ${account.facebookName} · ` : ""}${account.facebookActorType === "profile" ? "บัญชีส่วนตัว" : account.facebookActorType === "page" ? "เพจ" : "ประเภทไม่ทราบ"} · ${account.sessionStatus === "online" ? "ออนไลน์" : "ยังไม่ออนไลน์"}` : account.adapterType}</span></div><em className={account.status}>{account.status}</em>
      </button>)}</div>
    </div>
    <div className="panel"><div className="panel-title"><div><h2>ปลายทาง</h2><p>กลุ่ม เพจ โปรไฟล์ หรือห้อง Discord</p></div><button className="secondary small" disabled={!selected} onClick={() => setShowDestination(true)}><Plus/>เพิ่มปลายทาง</button></div>
      <div className="destination-list">{destinations.filter(d => d.accountId === selected).map(dest => <div className="destination-row" key={dest.id}><div><b>{dest.name}</b><span>{dest.kind} · {dest.url || dest.remoteId}</span></div><button className="danger-icon" onClick={() => void mutate(() => window.autopost.deleteDestination(dest.id))}><Trash2/></button></div>)}</div>
      {accounts.find(a => a.id === selected)?.platform === "facebook" && <div className="facebook-tools"><button className="primary" onClick={() => setShowGroups(true)}>ดึงกลุ่มของฉัน</button></div>}
    </div>
    {showAccount && <AccountModal close={() => setShowAccount(false)} openFacebook={() => { setShowAccount(false); setShowFacebookLogin(true); }} save={(input) => mutate(() => window.autopost.createAccount(input)).then(ok => { if (ok) setShowAccount(false); })}/>}
    {showDestination && accounts.some(a => a.id === selected) && <DestinationModal account={accounts.find(a => a.id === selected)!} close={() => setShowDestination(false)} save={(input) => mutate(() => window.autopost.createDestination(input)).then(ok => { if (ok) setShowDestination(false); })}/>}
    {showGroups && accounts.some(a => a.id === selected) && <GroupsModal account={accounts.find(a => a.id === selected)!} close={() => setShowGroups(false)} save={(groups) => mutate(async () => { for (const group of groups) await window.autopost.createDestination({ accountId: selected, kind: "facebook_group", name: group.name, url: group.url }); }).then(ok => { if (ok) setShowGroups(false); })}/>}
  </div>;
}

function FacebookLoginModal({ close, accounts, select }: { close(): void; accounts: Account[]; select(id: string): void }) {
  const [method, setMethod] = useState<"browser" | "cookie">("browser");
  const [existingId, setExistingId] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const facebookAccounts = accounts.filter(account => account.platform === "facebook");
  const login = async () => {
    if (!existingId && !name.trim()) { setMessage("กรุณาตั้งชื่อบัญชีในโปรแกรมก่อนดำเนินการ"); return; }
    setBusy(true); setMessage("");
    try {
      setMessage("เปิด Chrome แล้ว กรุณาล็อกอินด้วยตนเอง จากนั้นปิดหน้าต่าง Chrome เพื่อให้ตรวจสอบสถานะบัญชี");
      const output = existingId ? { accountId: existingId, session: await window.autopost.loginAndCheckFacebook(existingId) } : await window.autopost.createAndLoginFacebook(name.trim());
      select(output.accountId);
      const result = output.session;
      setMessage(`ตรวจสอบสถานะบัญชี: ${result.status === "online" ? "ออนไลน์" : result.message} · Facebook: ${result.identity?.name || "ยังไม่ยืนยันชื่อ"} · ${result.identity?.actorType === "profile" ? "บัญชีส่วนตัว" : "ยังไม่ยืนยันประเภท"} · ${result.message}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "ล็อกอินไม่สำเร็จ"); }
    finally { setBusy(false); }
  };
  return <Modal title="เพิ่ม / เข้าสู่ระบบ Facebook" close={() => { if (!busy) close(); }}><div className="fields">
    <p>เลือกวิธีเข้าสู่ระบบ ทั้งสองวิธีใช้บัญชีและหน้าตรวจสถานะเดียวกัน ไม่ต้องส่งรหัสผ่านหรือ Cookie ในแชต</p>
    <label>วิธีเข้าสู่ระบบ<select value={method} disabled={busy} onChange={e => setMethod(e.target.value as "browser" | "cookie")}><option value="browser">ปกติ — Chrome (บัญชีหรือเพจ)</option><option value="cookie">Cookie — บัญชีหรือเพจ</option></select></label>
    <label>บัญชี<select value={existingId} disabled={busy} onChange={e => setExistingId(e.target.value)}><option value="">สร้างบัญชี Facebook ใหม่</option>{facebookAccounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
    {!existingId && <label>ชื่อบัญชีในโปรแกรม<input value={name} maxLength={80} disabled={busy} onChange={e => setName(e.target.value)} placeholder="เช่น Facebook ร้านหลัก"/></label>}
    {method === "browser" ? <>
      <p>เมื่อเข้าสู่ระบบเสร็จ ปิดหน้าต่าง Chrome แล้วโปรแกรมจะตรวจสถานะ ชื่อ รูป และประเภทที่ยืนยันได้</p>
      <button className="primary" type="button" disabled={busy || (!existingId && !name.trim())} onClick={() => void login()}>{busy ? "รอปิด Chrome และตรวจสถานะ…" : "เปิด Chrome เพื่อล็อกอิน"}</button>
    </> : <CookieImportForm existingId={existingId} name={name.trim()} onImported={rows => { if (rows.length) select(rows[0].accountId); }}/ >}
    {message && <p role="status">{message}</p>}
  </div></Modal>;
}

function CookieImportForm({ onImported, existingId, name }: { onImported(rows: { accountId: string; status: string; message: string }[]): void; existingId: string; name: string }) {
  const [progress, setProgress] = useState<{ current: number; total: number; status: string } | null>(null);
  useEffect(() => window.autopost.onSessionProgress(setProgress), []);
  const [input, setInput] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<{ accountId: string; status: string; message: string }[]>([]);
  const preview = async () => {
    try { setError(""); setCount((await window.autopost.previewCookies(input)).length); }
    catch { setCount(null); setError("ตรวจรูปแบบไม่ได้ กรุณาตรวจ c_user, xs และใช้ ---ACCOUNT--- คั่นบัญชี"); }
  };
  const login = async () => {
    setBusy(true); setError(""); setResults([]);
    try { const rows = existingId ? [await window.autopost.importCookieForAccount(existingId, input)] : await window.autopost.importCookies(input, name); setResults(rows); onImported(rows); setInput(""); setCount(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "นำเข้าไม่สำเร็จ กรุณาตรวจรูปแบบ Cookie"); }
    finally { setBusy(false); }
  };
  return <div className="fields">
    <p>ใช้เฉพาะ Cookie บัญชีของคุณ รองรับ JSON / Netscape / Raw {existingId ? "เลือกบัญชีเดิมจะตรวจหนึ่งชุดและไม่ทับ Session เดิม" : "หลายบัญชีคั่นด้วย ---ACCOUNT---"}</p>
    <textarea rows={12} value={input} autoComplete="off" spellCheck={false} disabled={busy} onChange={e => { setInput(e.target.value); setCount(null); }} placeholder="วาง Cookie ที่นี่ (ไม่บันทึกลง Log)"/>
    <button className="secondary" disabled={busy || !input.trim()} onClick={() => void preview()}>ตรวจจำนวนบัญชี</button>
    {count !== null && <p>ตรวจพบ {count} บัญชี</p>}
    {error && <p role="alert">{error}</p>}
    {busy && <p role="status">กำลังตรวจสอบบัญชี {progress?.current || 0}/{progress?.total || count || 0} กรุณารอสักครู่…<progress value={progress?.current || 0} max={progress?.total || count || 1}/></p>}
    {results.map(row => <p key={row.accountId}>{row.status}: {row.message}</p>)}
    <button className="primary" disabled={busy || !count || (!existingId && !name)} onClick={() => void login()}>Login / สร้างบัญชี</button>
  </div>;
}

function SessionBackupModal({ mode, accountId, close }: { mode: "export" | "import"; accountId: string; close(): void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const run = async () => {
    setBusy(true); setMessage("");
    try {
      if (mode === "export") {
        const saved = await window.autopost.exportSession(accountId, password);
        setMessage(saved ? "บันทึกไฟล์เข้ารหัสแล้ว ใช้รหัสผ่านนี้กู้คืนบนเครื่องอื่นได้" : "ยกเลิกการบันทึก");
      } else {
        const rows = await window.autopost.importSessionBackup(password);
        setMessage(rows.length ? rows.map(row => row.message).join(" / ") : "ยกเลิกการกู้คืน");
      }
    } catch { setMessage("ดำเนินการไม่สำเร็จ กรุณาตรวจรหัสผ่าน ไฟล์ และ Chrome"); }
    finally { setPassword(""); setConfirm(""); setBusy(false); }
  };
  return <Modal title={mode === "export" ? "สำรอง Session แบบย้ายเครื่อง" : "กู้คืน Session"} close={() => { if (!busy) close(); }}><div className="fields">
    <p>ไฟล์เข้ารหัส AES-256-GCM ต้องใช้รหัสผ่านอย่างน้อย 12 ตัวอักษร หากลืมจะกู้คืนไม่ได้ ห้ามส่งไฟล์พร้อมรหัสผ่านให้ผู้อื่น</p>
    <label>รหัสผ่าน<input type="password" autoComplete="new-password" disabled={busy} value={password} onChange={e => setPassword(e.target.value)}/></label>
    {mode === "export" && <label>ยืนยันรหัสผ่าน<input type="password" autoComplete="new-password" disabled={busy} value={confirm} onChange={e => setConfirm(e.target.value)}/></label>}
    <button className="primary" disabled={busy || password.length < 12 || (mode === "export" && password !== confirm)} onClick={() => void run()}>{busy ? "กำลังดำเนินการ…" : mode === "export" ? "เลือกที่บันทึก" : "เลือกไฟล์กู้คืน"}</button>
    {message && <p role="status">{message}</p>}
  </div></Modal>;
}

function AccountModal({ close, openFacebook, save }: { close(): void; openFacebook(): void; save(input: { name: string; adapterType: AdapterType; secret?: string }): Promise<void> }) {
  const [name, setName] = useState(""); const [type, setType] = useState<AdapterType>("facebook-browser"); const [secret, setSecret] = useState("");
  return <Modal title="เพิ่มบัญชี" close={close}><div className="fields">
    <label>แพลตฟอร์ม<select value={type} onChange={e => setType(e.target.value as AdapterType)}><option value="facebook-browser">Facebook — Chrome หรือ Cookie</option><option value="discord-webhook">Discord Webhook</option><option value="discord-bot">Discord Bot</option></select></label>
    {type === "facebook-browser" ? <p>เลือกวิธีล็อกอินในขั้นถัดไป แล้วตรวจสถานะและชื่อ Facebook จาก Session</p> : <form onSubmit={e => { e.preventDefault(); void save({ name, adapterType: type, secret }); }}>
      <label>ชื่อบัญชี<input value={name} onChange={e => setName(e.target.value)} required placeholder="เช่น Discord ร้านหลัก"/></label>
      <label>{type === "discord-bot" ? "Bot Token" : "Webhook URL"}<input type="password" value={secret} onChange={e => setSecret(e.target.value)} required/></label>
      <div className="modal-actions"><button type="button" className="secondary" onClick={close}>ยกเลิก</button><button className="primary">บันทึกบัญชี Discord</button></div>
    </form>}
    {type === "facebook-browser" && <div className="modal-actions"><button type="button" className="secondary" onClick={close}>ยกเลิก</button><button type="button" className="primary" onClick={openFacebook}>เลือกวิธีล็อกอิน Facebook</button></div>}
  </div></Modal>;
}

function DestinationModal({ account, close, save }: { account: Account; close(): void; save(input: { accountId: string; kind: DestinationKind; name: string; remoteId?: string; url?: string }): Promise<void> }) {
  const isFb = account.platform === "facebook";
  const [kind, setKind] = useState<DestinationKind>(isFb ? "facebook_group" : account.adapterType === "discord-webhook" ? "discord_webhook" : "discord_channel");
  const [name, setName] = useState(""); const [value, setValue] = useState("");
  return <Modal title="เพิ่มปลายทาง" close={close}><form onSubmit={(e) => { e.preventDefault(); void save({ accountId: account.id, kind, name, ...(isFb || kind === "discord_webhook" ? { url: value } : { remoteId: value }) }); }}>
    <label>ชื่อปลายทาง<input value={name} onChange={e => setName(e.target.value)} required placeholder="เช่น กลุ่มลูกค้า"/></label>
    {isFb && <label>ประเภท<select value={kind} onChange={e => setKind(e.target.value as DestinationKind)}><option value="facebook_group">Facebook Group</option><option value="facebook_page">Facebook Page</option><option value="facebook_profile">Facebook Profile</option></select></label>}
    <label>{isFb || kind === "discord_webhook" ? "URL" : "Channel ID"}<input value={value} onChange={e => setValue(e.target.value)} required/></label>
    <div className="modal-actions"><button type="button" className="secondary" onClick={close}>ยกเลิก</button><button className="primary">เพิ่ม</button></div>
  </form></Modal>;
}

function GroupsModal({ account, close, save }: { account: Account; close(): void; save(groups: FacebookGroupInfo[]): Promise<void> }) {
  const [deleting, setDeleting] = useState<string | null>(null);
  const [groups, setGroups] = useState<FacebookGroupInfo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState("");
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    setLoading(true); setFailure("");
    void window.autopost.discoverFacebookGroups(account.id)
      .then((result) => { setGroups(result); setBrokenImages(new Set()); setSelected(new Set(result.map(g => g.id))); })
      .catch((error) => setFailure(error instanceof Error ? error.message : String(error)))
      .finally(() => setLoading(false));
  }, [account.id, refreshKey]);
  const visible = useMemo(() => groups.filter(group => `${group.name} ${group.id}`.toLowerCase().includes(query.toLowerCase())), [groups, query]);
  const toggle = (id: string) => setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return <Modal title="เลือกกลุ่ม Facebook" close={close}><div className="group-picker">
    <div className="group-search"><span>🖼️ พบ {groups.length} กลุ่ม · มีรูป {groups.filter(group => group.imageUrl && !brokenImages.has(group.id)).length} กลุ่ม</span><button className="secondary small" disabled={loading} onClick={() => setRefreshKey(key => key + 1)}>🔄 รีเฟรชกลุ่ม</button></div>
    <div className="group-search"><input value={query} onChange={e => setQuery(e.target.value)} placeholder="🔎 ค้นหาชื่อกลุ่ม..."/><button className="secondary small" onClick={() => setSelected(new Set(visible.map(g => g.id)))}>☑️ เลือกทั้งหมด</button><button className="secondary small" onClick={() => setSelected(new Set())}>◻️ ไม่เลือก</button></div>
    {loading && <div className="group-loading"><RefreshCw/>กำลังดึงชื่อและรูปกลุ่มจาก Facebook...</div>}
    {failure && <div className="group-failure">{failure}</div>}
    {!loading && !failure && <div className="group-grid">{visible.map(group => <div className={selected.has(group.id) ? "group-card selected" : "group-card"} key={group.id}>
      <label className="group-card-selection" title={group.name}><input type="checkbox" checked={selected.has(group.id)} onChange={() => toggle(group.id)} aria-label={`เลือกกลุ่ม ${group.name}`}/>{group.imageUrl && !brokenImages.has(group.id) ? <img src={group.imageUrl} alt="" referrerPolicy="no-referrer" onError={() => setBrokenImages(current => new Set(current).add(group.id))}/> : <span className="group-placeholder" title="Facebook ไม่ส่งรูปกลุ่ม">f</span>}<span className="group-card-info"><b title={group.name}>{group.name}</b><small title={group.id}>{group.id}</small>{FEATURES.groupPermissionCheck && <small>สิทธิ์โพสต์: {group.postPermission === "allowed" ? "อนุญาต" : group.postPermission === "denied" ? "ไม่อนุญาต" : "ยังไม่ตรวจ"} · แชร์: {group.sharePermission === "allowed" ? "อนุญาต" : group.sharePermission === "denied" ? "ไม่อนุญาต" : "ยังไม่ตรวจ"}</small>}</span></label><button type="button" className="delete-discovered-group" disabled={deleting !== null} onClick={e => {
        e.preventDefault(); e.stopPropagation();
        setDeleting(group.id);
        void window.autopost.deleteFacebookGroup(account.id, group.id).then(deleted => {
          if (!deleted) return;
          setGroups(current => current.filter(row => row.id !== group.id));
          setSelected(current => { const next = new Set(current); next.delete(group.id); return next; });
        }).catch(error => setFailure(error instanceof Error ? error.message : "ลบกลุ่มไม่สำเร็จ")).finally(() => setDeleting(null));
      }}>{deleting === group.id ? "⏳ กำลังลบ…" : "🗑️ ลบจากรายการ"}</button>
    </div>)}</div>}
    {!loading && !failure && !groups.length && <div className="empty">ไม่พบกลุ่ม ลองเปิด Chrome และตรวจว่าบัญชีล็อกอินอยู่</div>}
    <div className="modal-actions"><span className="selection-count">✅ เลือก {selected.size} กลุ่ม</span><button className="secondary" onClick={close}>ยกเลิก</button><button className="primary" disabled={!selected.size} onClick={() => void save(groups.filter(g => selected.has(g.id)))}>➕ เพิ่มกลุ่มที่เลือก</button></div>
  </div></Modal>;
}

function Composer({ accounts, destinations, mutate }: { accounts: Account[]; destinations: Destination[]; mutate(action: () => Promise<unknown>): Promise<boolean> }) {
  const [settingsPanel, setSettingsPanel] = useState<"project" | "mapping" | "actions" | "delay" | "schedule" | null>(null);
  const [roundTimes, setRoundTimes] = useState<string[]>([]);
  const [repeatDaily, setRepeatDaily] = useState(false);
  const [submitStatus, setSubmitStatus] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id || ""); const [selected, setSelected] = useState<string[]>([]);
  const [caption, setCaption] = useState(""); const [media, setMedia] = useState<string[]>([]); const [runAt, setRunAt] = useState(thaiInputTime()); const [recurrence, setRecurrence] = useState<"" | "daily" | "weekly">("");
  const [preset, setPreset] = useState("custom");
  const [projectExtras, setProjectExtras] = useState<Partial<WorkspaceSettings>>({});
  const projectSettings: WorkspaceSettings = { scheduleTimes: roundTimes, repeatDaily, delayMin: 30, delayMax: 90, headless: null, commentEnabled: false, shareEnabled: false,
    likeEnabled: false, commentTemplates: [], shareDestinationIds: [], repeatShareMinutes: 0, accounts: [], mappings: [], ...projectExtras, accountId, caption, media, destinationIds: selected, recurrence };
  projectSettings.accounts = [...projectSettings.accounts.filter(row => row.accountId !== accountId), ...(accountId ? [{ ...projectSettings, accounts: undefined } as AccountWorkspace] : [])];
  projectSettings.scheduleTimes = roundTimes; projectSettings.repeatDaily = repeatDaily;
  projectSettings.accounts = projectSettings.accounts.map(row => row.accountId === accountId ? { ...row, scheduleTimes: roundTimes, repeatDaily } : row);
  const switchProjectAccount = (nextId: string) => {
    const previous = { ...projectSettings, accounts: undefined } as AccountWorkspace;
    const next = projectSettings.accounts.find(row => row.accountId === nextId);
    setProjectExtras({ ...(next || { delayMin: 30, delayMax: 90, headless: null, commentEnabled: false, shareEnabled: false, likeEnabled: false,
      commentTemplates: [], shareDestinationIds: [], repeatShareMinutes: 0, mappings: [] }), accounts: [...projectSettings.accounts.filter(row => row.accountId !== accountId), previous] });
    setAccountId(nextId); setCaption(next?.caption || ""); setMedia(next?.media || []); setSelected(next?.destinationIds || []); setRecurrence(next?.recurrence || ""); setRoundTimes(next?.scheduleTimes || []); setRepeatDaily(next?.repeatDaily || false);
  };
  const loadProject = (settings: WorkspaceSettings) => {
    setProjectExtras(settings); setAccountId(settings.accountId); setCaption(settings.caption); setMedia(settings.media); setSelected(settings.destinationIds); setRecurrence(settings.recurrence); setRoundTimes(settings.scheduleTimes || []); setRepeatDaily(settings.repeatDaily || false);
  };
  useEffect(() => {
    if (!accountId && accounts[0]) setAccountId(accounts[0].id);
    else if (accountId && !accounts.some(a => a.id === accountId)) { setAccountId(accounts[0]?.id || ""); setSelected([]); }
  }, [accounts, accountId]);
  const choices = useMemo(() => destinations.filter(d => d.accountId === accountId && d.enabled), [destinations, accountId]);
  useEffect(() => {
    const available = new Set(choices.map(choice => choice.id));
    setSelected(current => current.filter(id => available.has(id)));
  }, [choices]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (settingsPanel !== null) return;
    setSubmitStatus("กำลังเพิ่มงานเข้าคิว…");
    void mutate(async () => {
      const delayError = validateDelay(projectSettings.delayMin, projectSettings.delayMax);
      if (delayError) throw new Error(delayError);
      const contents = selected.map(destinationId => {
        return { destinationId, ...mainPostContent({ caption, media }) };
      });
      if (contents.some(content => !content.caption.trim() && !content.media.length)) throw new Error("มีปลายทางที่ยังไม่มีข้อความหรือสื่อ");
      for (const content of contents) {
        const previews = await window.autopost.previewMedia(content.media);
        if (previews.some(item => item.missing)) throw new Error("ไม่พบไฟล์สื่อ กรุณาตรวจไฟล์ก่อนเพิ่มคิว");
      }
       if (roundTimes.length || accounts.find(account => account.id === accountId)?.platform === "facebook" && !recurrence || projectSettings.commentEnabled || projectSettings.shareEnabled || projectSettings.likeEnabled || projectSettings.headless !== null) {
         if (recurrence && !roundTimes.length) throw new Error("ใช้ปุ่มตารางหลายรอบเพื่อโพสต์ทุกวันพร้อมขั้นตอนต่อเนื่อง");
         const payloads = contents.map(content => {
          const mapping = projectSettings.mappings.find(row => row.destinationId === content.destinationId);
          const destination = choices.find(row => row.id === content.destinationId)!;
          return { targetUrl: destination.url, caption: content.caption, media: content.media, headless: projectSettings.headless,
            delayMin: projectSettings.delayMin, delayMax: projectSettings.delayMax,
            commentEnabled: FEATURES.workflowFollowUp && FEATURES.comment && projectSettings.commentEnabled,
            likeEnabled: FEATURES.workflowFollowUp && FEATURES.like && projectSettings.likeEnabled,
            shareEnabled: FEATURES.workflowFollowUp && FEATURES.share && projectSettings.shareEnabled,
            commentTemplates: mapping?.comment || mapping?.commentImage ? [{ text: mapping.comment, image: mapping.commentImage }] : projectSettings.commentTemplates,
            repeatMinutes: projectSettings.repeatShareMinutes, shareTargets: destinations.filter(row => row.accountId === accountId && projectSettings.shareDestinationIds.includes(row.id)).map(row => {
              const override = projectSettings.mappings.find(item => item.destinationId === row.id);
              return { url: row.url, name: row.name, caption: override?.shareText || "", media: [] };
            }) };
         });
         if (roundTimes.length) await window.autopost.createSchedule({ accountId, name: `ตาราง ${accounts.find(account => account.id === accountId)?.name || "โพสต์"}`.slice(0, 100), startDate: runAt.slice(0, 10), daily: repeatDaily, times: roundTimes, payloads });
         else await window.autopost.startActions({ accountId, action: "post", scheduledAt: thaiInputToUtc(runAt), payloads });
        return;
      }
      await window.autopost.createMappedJobs({ accountId, contents, runAt: thaiInputToUtc(runAt), recurrence: recurrence || null, delayMin: projectSettings.delayMin, delayMax: projectSettings.delayMax });
     }).then(ok => setSubmitStatus(ok ? (roundTimes.length ? `บันทึก ${roundTimes.length} รอบ/วัน · ${repeatDaily ? "ทุกวัน" : "วันที่เลือก"} · ดูสถานะในหน้าคิว` : `เพิ่มคิวแล้ว ${selected.length} ปลายทาง · เริ่ม ${formatThaiTime(thaiInputToUtc(runAt))} · ดูผลในหน้าคิว`) : "เพิ่มคิวไม่สำเร็จ กรุณาตรวจข้อความแจ้งเตือนด้านบน"));
  };
  const addFiles = async () => setMedia([...new Set([...media, ...await window.autopost.chooseMedia()])]);
  const choosePreset = (value: string, next: string) => { setPreset(value); setRunAt(next); };
  const changeSchedulePart = (part: "date" | "time", value: string) => {
    const [date, time] = runAt.split("T");
    setPreset("custom");
    setRunAt(part === "date" ? `${value}T${time}` : `${date}T${value}`);
  };
  return <form className="composer compact-composer" onSubmit={submit} onInvalidCapture={() => setSubmitStatus("ยังส่งไม่ได้ กรุณาตรวจบัญชี วันที่ และเวลาที่เลือก")}>
    {settingsPanel === "schedule" && <Modal title="ตารางเวลาโพสต์หลายรอบต่อวัน" close={() => setSettingsPanel(null)}><div className="fields"><p>แต่ละเวลาเป็นหนึ่งรอบ ส่งไปทุกกลุ่มที่เลือก เวลาไทย 24 ชั่วโมง หากผ่านเวลาไปแล้วจะข้าม ไม่ยิงย้อนหลัง เปิดโปรแกรมและคิวไว้เพื่อทำงานตามเวลา</p>
      <label>เริ่มวันที่<input type="date" value={runAt.slice(0, 10)} onChange={e => changeSchedulePart("date", e.target.value)} min={thaiInputTime(0).slice(0, 10)}/></label>
      <label><input type="checkbox" checked={repeatDaily} onChange={e => setRepeatDaily(e.target.checked)}/> โพสต์ทุกวันตามเวลารายการนี้</label>
      <b>{roundTimes.length} รอบต่อวัน · {repeatDaily ? "ทำซ้ำทุกวัน" : "เฉพาะวันที่เลือก"}</b>
      {roundTimes.map((time, index) => <div className="schedule-time-row" key={index}><span>รอบ {index + 1}</span><Time24Picker value={time} onChange={value => setRoundTimes(rows => rows.map((row, i) => i === index ? value : row))}/><button type="button" className="secondary small" onClick={() => setRoundTimes(rows => rows.filter((_, i) => i !== index))}>ลบรอบ</button></div>)}
      <button type="button" className="secondary" disabled={roundTimes.length >= 24} onClick={() => setRoundTimes(rows => [...rows, runAt.slice(11, 16)])}>เพิ่มเวลาอีกหนึ่งรอบ</button>
      {new Set(roundTimes).size !== roundTimes.length && <p role="alert">มีเวลาซ้ำ กรุณาปรับให้แต่ละรอบไม่ซ้ำกัน</p>}
      <button type="button" className="primary" disabled={new Set(roundTimes).size !== roundTimes.length} onClick={() => { setRoundTimes(rows => [...rows].sort()); setRecurrence(""); setSettingsPanel(null); }}>ใช้ตารางนี้</button>
      <button type="button" className="secondary" onClick={() => { setRoundTimes([]); setRepeatDaily(false); setSettingsPanel(null); }}>กลับไปโพสต์รอบเดียว</button>
    </div></Modal>}
    {settingsPanel === "delay" && <Modal title="ตั้งดีเลย์ / เวลาพักระหว่างงาน" close={() => setSettingsPanel(null)}><div className="fields"><p>พักระหว่างโพสต์แต่ละกลุ่มและขั้นตอนถัดไปของบัญชีเดียวกัน ไม่ใช่เวลาเริ่มงาน และไม่ทำให้บัญชีอื่นหยุดรอ</p><small>บัญชี: {accounts.find(account => account.id === accountId)?.name || "ยังไม่เลือกบัญชี"} · ใช้กับงานที่สร้างใหม่</small>
      <div className="quick-times">{([[30,30,"30 วินาที"],[60,60,"1 นาที"],[180,180,"3 นาที"],[300,300,"5 นาที"],[30,90,"สุ่ม 30–90 วินาที"]] as const).map(([min,max,label]) => <button type="button" key={label} onClick={() => setProjectExtras(current => ({ ...current, delayMin: min, delayMax: max }))}>{label}</button>)}</div>
      <div className="date-time-fields"><label>พักต่ำสุด (วินาที)<input type="number" min={0} max={86400} step={1} value={projectSettings.delayMin} onChange={e => setProjectExtras(current => ({ ...current, delayMin: Number(e.target.value) }))}/></label><label>พักสูงสุด (วินาที)<input type="number" min={0} max={86400} step={1} value={projectSettings.delayMax} onChange={e => setProjectExtras(current => ({ ...current, delayMax: Number(e.target.value) }))}/></label></div>
      <p role="status">{validateDelay(projectSettings.delayMin, projectSettings.delayMax) || (projectSettings.delayMin === projectSettings.delayMax ? `พักคงที่ ${projectSettings.delayMin} วินาที` : `สุ่มพัก ${projectSettings.delayMin}–${projectSettings.delayMax} วินาที`)}</p><button type="button" className="primary" disabled={!!validateDelay(projectSettings.delayMin, projectSettings.delayMax)} onClick={() => setSettingsPanel(null)}>ใช้ดีเลย์นี้</button>
    </div></Modal>}
    <div className="compose-commandbar"><span><b>ตั้งค่างานโพสต์</b><small>โพสต์ใช้ข้อความและสื่อจากช่องหลักเท่านั้น</small></span><button type="button" className="secondary small" onClick={() => setSettingsPanel("project")}>โปรเจกต์ / บันทึกชุดงาน</button></div>
    <p className="form-hint compose-feature-note" role="note">ตั้งเวลาจากหน้าสร้างงาน หรือใช้โปรไฟล์ข้อความเพื่อกำหนดเนื้อหาแต่ละกลุ่ม · ขั้นตอนต่อเนื่องเริ่มเมื่อยืนยันโพสต์ถาวรแล้ว</p>
    <div hidden={settingsPanel !== "project"} className="project-modal-host"><Modal title="โปรเจกต์ / บันทึกและโหลดชุดงาน" close={() => setSettingsPanel(null)}><ProjectToolbar settings={projectSettings} load={loadProject}/></Modal></div>
    <div className="panel compose-main"><div className="panel-title"><div><h2>1. ข้อความโพสต์หลักและสื่อ</h2><p title={accounts.find(account => account.id === accountId)?.name}>ใช้โพสต์ทุกกลุ่มที่เลือก · ไม่ถูกแทนที่ด้วยความคิดเห็น/แชร์</p></div><span className="counter">{caption.length} ตัวอักษร</span></div>
    <textarea aria-label="ข้อความโพสต์หลัก" rows={10} value={caption} onChange={e => setCaption(e.target.value)} placeholder="เขียนข้อความโพสต์หลักที่นี่ ใช้ข้อความนี้กับทุกกลุ่มที่เลือก"/>
    <MediaPreview paths={media}/>
    {FEATURES.workflowFollowUp && settingsPanel === "mapping" && <Modal title={`ความคิดเห็น / แชร์รายกลุ่ม (${selected.length} ปลายทาง)`} close={() => setSettingsPanel(null)}><div className="mapping-editor"><p>ตั้งค่าสำหรับขั้นตอนหลังโพสต์เท่านั้น ไม่เปลี่ยนข้อความหรือรูปโพสต์หลัก ความคิดเห็นที่ว่างใช้ Template ส่วนข้อความแชร์ที่ว่างจะแชร์โดยไม่เพิ่มข้อความ</p>
      {choices.filter(choice => selected.includes(choice.id)).map(choice => {
        const mapping = projectSettings.mappings.find(row => row.destinationId === choice.id);
        const update = (changes: Partial<WorkspaceSettings["mappings"][number]>) => setProjectExtras(current => {
          const rows = current.mappings || [];
          const existing = rows.find(row => row.destinationId === choice.id) || { destinationId: choice.id, caption: "", media: [], comment: "", commentImage: "", shareText: "" };
          return { ...current, mappings: [...rows.filter(row => row.destinationId !== choice.id), { ...existing, ...changes }] };
        });
        return <div className="panel fields" key={choice.id}><b>{choice.name}</b><small>ข้อความและรูปโพสต์จะใช้จากช่องหลักเท่านั้น</small>
          <label>ความคิดเห็นเฉพาะกลุ่ม<textarea rows={2} value={mapping?.comment || ""} onChange={e => update({ comment: e.target.value })}/></label>
          <button type="button" className="secondary small" onClick={() => void window.autopost.chooseMedia().then(files => update({ commentImage: files[0] || "" }))}>รูปความคิดเห็นเฉพาะกลุ่ม</button>
          <label>ข้อความแชร์เฉพาะกลุ่ม<textarea rows={2} value={mapping?.shareText || ""} onChange={e => update({ shareText: e.target.value })}/></label>
        </div>;
      })}
    </div></Modal>}
    <div className="drop-zone" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const files = [...e.dataTransfer.files].map(window.autopost.filePath); setMedia([...new Set([...media, ...files])]); }} onClick={() => void addFiles()}>
      <Plus/><b>ลากรูปหรือวิดีโอมาวาง</b><span>หรือคลิกเพื่อเลือกไฟล์ สูงสุด 10 ไฟล์</span></div>
    <div className="media-list">{media.map(path => <div key={path}><span>{path.split(/[\\/]/).pop()}</span><button type="button" onClick={() => setMedia(media.filter(x => x !== path))}><X/></button></div>)}</div>
  </div><div className="panel fields compose-targets"><h2 className="form-step">2. บัญชีและกลุ่ม</h2><label>บัญชีที่ใช้โพสต์<select value={accountId} onChange={e => switchProjectAccount(e.target.value)} required><option value="">เลือกบัญชี</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><small>ตั้งค่าแยก {projectSettings.accounts.length} บัญชี · เลือกปลายทางด้านล่าง</small>
    {FEATURES.workflowFollowUp && settingsPanel === "actions" && <Modal title="ขั้นตอนหลังโพสต์และการทำงาน Chrome" close={() => setSettingsPanel(null)}><div className="fields">
    <div className="date-time-fields"><label>พักต่ำสุด (วินาที)<input type="number" min={0} max={86400} value={projectSettings.delayMin} onChange={e => setProjectExtras(current => ({ ...current, delayMin: Number(e.target.value) }))}/></label><label>พักสูงสุด (วินาที)<input type="number" min={projectSettings.delayMin} max={86400} value={projectSettings.delayMax} onChange={e => setProjectExtras(current => ({ ...current, delayMax: Number(e.target.value) }))}/></label></div>
    <label>โหมด Chrome<select value={projectSettings.headless === null ? "account" : projectSettings.headless ? "headless" : "headed"} onChange={e => setProjectExtras(current => ({ ...current, headless: e.target.value === "account" ? null : e.target.value === "headless" }))}><option value="account">ใช้ค่าบัญชี</option><option value="headless">ไม่แสดงหน้าต่าง</option><option value="headed">แสดงหน้าต่าง</option></select></label>
    <div className="workflow-heading"><b>3. ขั้นตอนหลังโพสต์ (เปิด–ปิดแยกได้)</b><small>โพสต์ตามเวลาที่ตั้ง แล้วทำเฉพาะขั้นตอนที่เปิดไว้ หากขั้นตอนใดไม่สำเร็จจะหยุดขั้นตอนถัดไป</small></div>
    <div className="action-toggles">{([ ["commentEnabled", "ความคิดเห็น"], ["shareEnabled", "แชร์เข้ากลุ่ม"], ["likeEnabled", "ถูกใจ"] ] as const).map(([key, label]) => <label key={key} className={projectSettings[key] ? "enabled" : ""}><input type="checkbox" checked={projectSettings[key]} onChange={e => setProjectExtras(current => ({ ...current, [key]: e.target.checked }))}/><b>{label}</b><small>{projectSettings[key] ? "เปิดใช้งาน" : "ปิดใช้งาน"}</small></label>)}</div>
    {projectSettings.commentEnabled && <div className="fields">{projectSettings.commentTemplates.map((template, index) => <div key={index}><textarea rows={2} value={template.text} onChange={e => setProjectExtras(current => ({ ...current, commentTemplates: projectSettings.commentTemplates.map((row, i) => i === index ? { ...row, text: e.target.value } : row) }))}/><button type="button" className="secondary small" onClick={() => void window.autopost.chooseMedia().then(files => setProjectExtras(current => ({ ...current, commentTemplates: projectSettings.commentTemplates.map((row, i) => i === index ? { ...row, image: files[0] || "" } : row) })))}>เลือกรูป</button><small>{template.image.split(/[\\/]/).pop()}</small><button type="button" className="secondary small" onClick={() => setProjectExtras(current => ({ ...current, commentTemplates: projectSettings.commentTemplates.filter((_, i) => i !== index) }))}>ลบ</button></div>)}<button type="button" className="secondary small" onClick={() => setProjectExtras(current => ({ ...current, commentTemplates: [...projectSettings.commentTemplates, { text: "", image: "" }] }))}>เพิ่ม Template</button></div>}
    {projectSettings.shareEnabled && <div className="fields"><small>ต้องตรวจพบลิงก์โพสต์ถาวรก่อน ระบบจึงทำงานต่อ</small>{choices.filter(row => row.kind === "facebook_group").map(row => <label key={row.id}><input type="checkbox" checked={projectSettings.shareDestinationIds.includes(row.id)} onChange={e => setProjectExtras(current => ({ ...current, shareDestinationIds: e.target.checked ? [...projectSettings.shareDestinationIds, row.id] : projectSettings.shareDestinationIds.filter(id => id !== row.id) }))}/>{row.name}</label>)}</div>}
    </div></Modal>}
    <div className="destination-heading"><label>เลือกปลายทาง</label><div><button type="button" onClick={() => setSelected(choices.map(item => item.id))}>เลือกทั้งหมด</button><button type="button" onClick={() => setSelected([])}>ยกเลิกเลือก</button></div><span>{selected.length}/{choices.length} ที่ · ปุ่มถังขยะใช้ลบกลุ่มจากโปรแกรม</span></div><div className="checks">{choices.map(dest => <div className={`composer-destination-row ${selected.includes(dest.id) ? "checked" : ""}`} key={dest.id}><label className={selected.includes(dest.id) ? "checked" : ""}><input type="checkbox" checked={selected.includes(dest.id)} onChange={e => setSelected(current => e.target.checked ? [...new Set([...current, dest.id])] : current.filter(x => x !== dest.id))}/><i className="custom-check">✓</i><span title={dest.name}>{dest.name}<small>{dest.kind === "facebook_group" ? "กลุ่ม Facebook" : dest.kind}</small></span></label>{dest.kind === "facebook_group" && <button type="button" className="composer-delete-group" aria-label={`ลบกลุ่ม ${dest.name}`} title={`ลบกลุ่ม ${dest.name} จากโปรแกรม (ไม่ออกจากกลุ่ม Facebook)`} onClick={() => void mutate(async () => {
      const groupId = dest.remoteId || (dest.url ? new URL(dest.url).pathname.match(/^\/groups\/([^/]+)/)?.[1] : null);
      if (!groupId) throw new Error("ไม่พบรหัสกลุ่ม กรุณาจัดการปลายทางในหน้าบัญชี");
      await window.autopost.deleteFacebookGroup(dest.accountId, groupId);
    })}><Trash2 size={15}/><span>ลบ</span></button>}</div>)}</div>
    </div><div className="panel fields compose-schedule"><h2 className="form-step">3. เวลาและเริ่มงาน</h2><div className="compose-enabled-summary"><span>โหมด: โพสต์หลักเท่านั้น</span><button type="button" className="secondary small" onClick={() => setSettingsPanel("delay")}>ตั้งดีเลย์ · {projectSettings.delayMin === projectSettings.delayMax ? projectSettings.delayMin : `${projectSettings.delayMin}–${projectSettings.delayMax}`} วินาที</button></div>
    <div className="schedule-box"><div className="schedule-title"><div><b>เวลาเริ่มโพสต์</b><small>สำเร็จเมื่อยืนยัน permalink ได้เท่านั้น</small></div><span className="timezone-badge">UTC+7</span></div>
      <div className="quick-times"><button type="button" className={preset === "now" ? "active" : ""} onClick={() => choosePreset("now", thaiInputTime(1))}>เร็วที่สุด</button><button type="button" className={preset === "10m" ? "active" : ""} onClick={() => choosePreset("10m", thaiInputTime(10))}>+10 นาที</button><button type="button" className={preset === "30m" ? "active" : ""} onClick={() => choosePreset("30m", thaiInputTime(30))}>+30 นาที</button><button type="button" className={preset === "1h" ? "active" : ""} onClick={() => choosePreset("1h", thaiInputTime(60))}>+1 ชั่วโมง</button><button type="button" className={preset === "tomorrow" ? "active" : ""} onClick={() => choosePreset("tomorrow", tomorrowMorningThai())}>พรุ่งนี้ 09:00</button></div>
      <div className="date-time-fields"><label>วันที่<input type="date" min={thaiInputTime(0).slice(0, 10)} value={runAt.slice(0, 10)} onChange={e => changeSchedulePart("date", e.target.value)} required/></label><div><span className="time24-label">เวลา (24 ชั่วโมง)</span><Time24Picker value={runAt.slice(11, 16)} onChange={value => changeSchedulePart("time", value)}/></div></div>
      <div className="schedule-confirm"><CalendarClock/><span>ระบบจะเริ่มโพสต์ <b>{formatThaiTime(thaiInputToUtc(runAt))} น.</b></span></div>
    </div><div><button type="button" className="secondary wide" onClick={() => setSettingsPanel("schedule")}>ตารางหลายรอบ · {roundTimes.length ? `${roundTimes.length} รอบ/วัน ${repeatDaily ? "ทุกวัน" : "วันที่เลือก"}` : "ตั้งเวลาเพิ่ม"}</button>{!!roundTimes.length && <small>{roundTimes.join(" · ")}</small>}{!roundTimes.length && <label>ทำซ้ำ<select value={recurrence} onChange={e => setRecurrence(e.target.value as typeof recurrence)}><option value="">ครั้งเดียว</option><option value="daily">ทุกวัน เวลาเดิม</option><option value="weekly">ทุกสัปดาห์ เวลาเดิม</option></select></label>}</div>
    <div className="compose-start-actions"><p role="status">{submitStatus || (!accountId ? "เลือกบัญชีก่อนเริ่มงาน" : !selected.length ? "เลือกกลุ่มปลายทางก่อนส่ง" : !caption.trim() && !media.length ? "ใส่ข้อความหลักหรือเลือกสื่อก่อนส่ง" : `พร้อมเพิ่มคิว ${selected.length} ปลายทาง · ${media.length} ไฟล์`)}</p><button className="primary wide" disabled={!accountId || !selected.length || (!caption.trim() && !media.length)}><CalendarClock/>ตั้งเวลา / เพิ่มคิวบัญชีนี้</button>
    <button type="button" className="secondary wide" disabled={!projectSettings.accounts.some(row => row.destinationIds.length)} onClick={() => void mutate(async () => {
      const paths = [...new Set(projectSettings.accounts.flatMap(row => [...row.media,
        ...(row.commentEnabled ? [...row.mappings.map(mapping => mapping.commentImage), ...row.commentTemplates.map(template => template.image)].filter(Boolean) : []),
      ]))];
      for (let i = 0; i < paths.length; i += 10) if ((await window.autopost.previewMedia(paths.slice(i, i + 10))).some(row => row.missing)) throw new Error("มีไฟล์สื่อหาย กรุณาตรวจทุกบัญชี");
      await window.autopost.startProjectPosts({ settings: projectSettings, scheduledAt: thaiInputToUtc(runAt) });
    })}>เพิ่มคิวทุกบัญชีในโปรเจกต์</button></div></div></form>;
}

function QueueView({ jobs, mutate }: { jobs: Job[]; mutate(action: () => Promise<unknown>): Promise<boolean> }) {
  const [filter, setFilter] = useState("all"); const visible = filter === "all" ? jobs : jobs.filter(j => j.status === filter);
  return <div className="panel"><div className="panel-title"><div><h2>รายการงาน</h2><p>{visible.length} รายการ</p></div><select className="filter" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">ทั้งหมด</option><option value="pending">รอทำ</option><option value="running">กำลังทำ</option><option value="succeeded">สำเร็จ</option><option value="failed">ล้มเหลว</option><option value="cancelled">ยกเลิก</option></select></div>
    <JobTable jobs={visible} actions={(job) => <>{job.status === "failed" && <button title="ลองใหม่" onClick={() => void mutate(() => window.autopost.retryJob(job.id))}><RefreshCw/></button>}{["pending", "failed"].includes(job.status) && <button title="ยกเลิก" onClick={() => void mutate(() => window.autopost.cancelJob(job.id))}><X/></button>}</>}/>
  </div>;
}

function JobTable({ jobs, compact, actions }: { jobs: Job[]; compact?: boolean; actions?: (job: Job) => React.ReactNode }) {
  if (!jobs.length) return <div className="empty">ยังไม่มีรายการ</div>;
  return <div className="table-wrap"><table><thead><tr><th>ปลายทาง</th><th>บัญชี</th><th>เวลาไทย</th><th>สถานะ</th>{!compact && <th>ครั้ง</th>}{actions && <th/>}</tr></thead><tbody>{jobs.map(job => <tr key={job.id}><td><b>{job.destinationName}</b><small>{job.caption.slice(0, 60) || `${job.media.length} ไฟล์`}</small></td><td>{job.accountName}</td><td>{formatThaiTime(job.nextAttemptAt)}</td><td><span className={`status ${job.status}`}>{job.status}</span>{job.lastError && <small className="job-error">{job.lastError}</small>}</td>{!compact && <td>{job.attempts}/{job.maxAttempts}</td>}{actions && <td className="row-actions">{actions(job)}</td>}</tr>)}</tbody></table></div>;
}

function LogsView({ logs }: { logs: LogEntry[] }) {
  return <div className="panel console">{logs.length ? logs.map(log => <div className={`log ${log.level}`} key={log.id}><time>{formatThaiTime(log.createdAt)}</time><b>{log.scope}</b><span>{log.message}</span></div>) : <div className="empty">ยังไม่มี Log</div>}</div>;
}

function SettingsView({ worker, mutate }: { worker: boolean; mutate(action: () => Promise<unknown>): Promise<boolean> }) {
  const [autoStart, setAutoStart] = useState(false);
  useEffect(() => { void window.autopost.getAutoStart().then(setAutoStart); }, []);
  return <div className="settings-grid"><div className="panel setting"><div><h2>ระบบคิวเบื้องหลัง</h2><p>ตรวจงานที่ถึงเวลาทุก 1 วินาที และทำงานพร้อมกันสูงสุด 2 บัญชี</p></div><button className={worker ? "danger" : "primary"} onClick={() => void mutate(() => worker ? window.autopost.stopWorker() : window.autopost.startWorker())}>{worker ? <><LogOut/>หยุดคิว</> : <><Wifi/>เริ่มคิว</>}</button></div>
    <div className="panel setting"><div><h2>เปิดพร้อม Windows</h2><p>เริ่มโปรแกรมไว้ใน System Tray เพื่อให้งานตามเวลาทำงานได้</p></div><label className="toggle"><input type="checkbox" checked={autoStart} onChange={e => { const value=e.target.checked; void window.autopost.setAutoStart(value).then(setAutoStart); }}/><span/></label></div>
    <div className="panel notice"><h2>ความปลอดภัย</h2><ul><li>Facebook ล็อกอินด้วย Chrome profile แยกของแต่ละบัญชี</li><li>Bot Token และ Webhook เข้ารหัสด้วย Windows DPAPI</li><li>ไม่เก็บรหัสผ่าน Facebook และไม่ bypass CAPTCHA</li><li>ไม่ทำ fingerprint spoof หรือหลบระบบตรวจจับ</li></ul></div>
    <div className="panel notice"><h2>ข้อจำกัด Facebook</h2><p>Facebook เปลี่ยนโครงสร้างหน้าเว็บได้ตลอด หากตัวเลือกหน้าเว็บเปลี่ยน งานจะหยุดพร้อมบันทึกภาพหน้าจอไว้ตรวจสอบ การโพสต์ผ่านเพจควรใช้ Meta Graph API เมื่อพร้อมตั้งค่าแอป Meta</p></div>
  </div>;
}

function Modal({ title, close, children }: { title: string; close(): void; children: React.ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && close()}><div className="modal" role="dialog" aria-label={title}><div className="modal-head"><h2>{title}</h2><button type="button" onClick={close} aria-label="ปิดหน้าต่าง"><X/></button></div>{children}</div></div>;
}
