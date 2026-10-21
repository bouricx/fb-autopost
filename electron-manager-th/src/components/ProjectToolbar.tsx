import { useEffect, useRef, useState } from "react";
import type { ProjectRecord, WorkspaceSettings } from "../../electron/projects/project-manager";

export function ProjectToolbar({ settings, load }: { settings: WorkspaceSettings; load(settings: WorkspaceSettings): void }) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const loadRef = useRef(load); loadRef.current = load;
  const baseline = useRef("");
  const generation = useRef(0);
  const current = projects.find(project => project.id === selected);
  const serialized = JSON.stringify(settings);

  useEffect(() => {
    let active = true;
    void Promise.all([window.autopost.listProjects(), window.autopost.lastProject()]).then(([rows, id]) => {
      if (!active) return;
      setProjects(rows);
      const project = rows.find(row => row.id === id);
      if (project) { baseline.current = JSON.stringify(project.settings); setSelected(project.id); setName(project.name); loadRef.current(project.settings); }
    }).catch(() => { if (active) setStatus("โหลดโปรเจกต์ไม่สำเร็จ"); });
    return () => { active = false; generation.current++; };
  }, []);

  useEffect(() => {
    if (!selected || !current || serialized === baseline.current) return;
    const revision = ++generation.current;
    setStatus("รอบันทึก…");
    const timer = setTimeout(() => {
      setStatus("กำลังบันทึก…");
      void window.autopost.saveProject(selected, { name: current.name, lastOpenedTab: "post", settings: JSON.parse(serialized) }).then(saved => {
        if (generation.current !== revision) return;
        baseline.current = serialized;
        setProjects(rows => rows.map(row => row.id === saved.id ? saved : row)); setStatus("บันทึกแล้ว");
      }).catch(() => { if (generation.current === revision) setStatus("บันทึกไม่สำเร็จ กรุณาลองใหม่"); });
    }, 800);
    return () => clearTimeout(timer);
  }, [serialized, selected, current?.name]);

  const activate = (project: ProjectRecord) => {
    generation.current++;
    baseline.current = JSON.stringify(project.settings);
    setSelected(project.id); setName(project.name); loadRef.current(project.settings); setStatus("โหลดแล้ว");
  };
  const action = async (work: () => Promise<void>) => {
    setBusy(true);
    try { await work(); } catch { setStatus("ดำเนินการไม่สำเร็จ กรุณาตรวจข้อมูลและลองใหม่"); }
    finally { setBusy(false); }
  };
  const flush = async () => {
    generation.current++;
    if (!current || serialized === baseline.current) return;
    const saved = await window.autopost.saveProject(current.id, { name: current.name, lastOpenedTab: "post", settings });
    baseline.current = serialized;
    setProjects(rows => rows.map(row => row.id === saved.id ? saved : row));
  };
  return <div className="panel project-toolbar"><div><b>โปรเจกต์ / พรีเซ็ต</b><small>{status || "บันทึกข้อความ สื่อ และปลายทางไว้ใช้ครั้งถัดไป"}</small></div>
    <select aria-label="โปรเจกต์ที่กำลังแก้ไข" value={selected} disabled={busy} onChange={e => { const id = e.target.value; void action(async () => { await flush(); const project = projects.find(row => row.id === id); if (project) activate(project); else { setSelected(""); setName(""); } }); }}><option value="">ยังไม่เลือกโปรเจกต์</option>{projects.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
    <input value={name} disabled={busy} onChange={e => setName(e.target.value)} placeholder="ชื่อโปรเจกต์" maxLength={100}/>
    <button type="button" className="secondary small" disabled={busy || !name.trim()} onClick={() => void action(async () => { const project = await window.autopost.createProject(name, settings); setProjects(rows => [project, ...rows]); activate(project); })}>สร้างใหม่</button>
    <button type="button" className="secondary small" disabled={busy || !current || !name.trim()} onClick={() => void action(async () => { if (!current) return; const project = await window.autopost.saveProject(current.id, { name, settings, lastOpenedTab: "post" }); setProjects(rows => rows.map(row => row.id === project.id ? project : row)); activate(project); })}>บันทึก / เปลี่ยนชื่อ</button>
    <button type="button" className="secondary small" disabled={busy || !current} onClick={() => void action(async () => { await flush(); const project = await window.autopost.duplicateProject(selected); setProjects(rows => [project, ...rows]); activate(project); })}>ทำสำเนาโปรเจกต์</button>
    <button type="button" className="secondary small" disabled={busy || !current} onClick={() => void action(async () => { await flush(); const exported = await window.autopost.exportProject(selected); setStatus(exported ? "ส่งออกแล้ว ไม่รวมไฟล์สื่อและ Cookie" : "ยกเลิกการส่งออก"); })}>ส่งออกโปรเจกต์</button>
    <button type="button" className="secondary small" disabled={busy} onClick={() => void action(async () => { const project = await window.autopost.importProject(); if (project) { setProjects(rows => [project, ...rows]); activate(project); setStatus("นำเข้าแล้ว กรุณาตรวจบัญชี ปลายทาง และตำแหน่งไฟล์สื่อ"); } })}>นำเข้า</button>
    <button type="button" className="danger small" disabled={busy || !current} onClick={() => { if (confirm("ลบโปรเจกต์นี้? งานที่สร้างไว้แล้วจะไม่ถูกลบ")) void action(async () => { await window.autopost.deleteProject(selected); generation.current++; setProjects(rows => rows.filter(row => row.id !== selected)); setSelected(""); setStatus("ลบโปรเจกต์แล้ว"); }); }}>ลบ</button>
  </div>;
}
