import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppDatabase } from "../electron/core/database";
import { MessageProfiles } from "../electron/automation/message-profiles";
import { TaskManager } from "../electron/automation/task-manager";
import { messageProfileSchema, shuffledTargets } from "../src/shared/message-profiles";
const opened: AppDatabase[] = [];
const folders: string[] = [];
afterEach(() => { opened.forEach(db => db.close()); opened.length = 0; folders.forEach(path => rmSync(path,{recursive:true,force:true})); folders.length = 0; vi.useRealTimers(); });
const profile = (caption = "A") => ({ name: "Shared", action: "post" as const, sets: [
  { name: "A", links: ["https://www.facebook.com/groups/123/", "https://www.facebook.com/groups/456/"], caption, media: [] as string[] },
  { name: "B", links: ["https://www.facebook.com/groups/789/"], caption: "B", media: [] as string[] },
] });
function setup() {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-26T01:00:00Z"));
  const db = new AppDatabase(":memory:"); opened.push(db);
  const account = db.createAccount({ name: "Alice", adapterType: "facebook-browser" },null,null);
  db.setAccountStatus(account.id,"active");
  const manager = new MessageProfiles(db.db);
  const profileId = manager.save(null,profile());
  const input = { accountId: account.id, profileId, scheduledAt: new Date().toISOString(), repeatMinutes: 60, rounds: 2, delayMin: 0, delayMax: 0, shareEnabled: false, shareDestinationIds: [], shareRepeatMinutes: 0 };
  return { db, account, manager, profileId, input };
}
it("shuffles whole link records, retaining the correct caption/media across every set", () => {
  const draft = profile(); draft.sets[0].media = ["a.png"]; draft.sets[1].media = ["b.png"];
  const targets = shuffledTargets(draft,() => 0);
  expect(targets.map(row => row.targetUrl)).not.toEqual(draft.sets.flatMap(set => set.links));
  for (const target of targets) {
    const set = draft.sets.find(set => set.links.includes(target.targetUrl))!;
    expect(target.caption).toBe(set.caption); expect(target.media).toEqual(set.media);
  }
});
it("rejects duplicate destinations, empty sets, comment feeds and multiple comment images", () => {
  const draft = profile(); draft.sets[1].links = ["https://m.facebook.com/groups/123?ref=abc"];
  expect(messageProfileSchema.safeParse(draft).success).toBe(false);
  expect(messageProfileSchema.safeParse({ ...profile(), sets: [{name:"Empty", links:[], caption:"",media:[]}] }).success).toBe(false);
  expect(messageProfileSchema.safeParse({name:"Comments",action:"comment", sets:[{name:"A",links:["https://www.facebook.com/posts/1"],caption:"x",media:["a.png","b.png"]}]}).success).toBe(false);
});
it("creates each round once, waits for previous work, and resolves shared edits at the next round", async () => {
  const {db,manager,profileId,input} = setup(); manager.createRun(input);
  await manager.materialize(); await manager.materialize();
  expect(new TaskManager(db.db).list()).toHaveLength(3);
  manager.save(profileId,profile("Changed"));
  vi.setSystemTime(new Date("2026-10-26T02:00:00Z"));
  await manager.materialize(); expect(new TaskManager(db.db).list()).toHaveLength(3);
  db.db.exec("UPDATE automation_tasks SET status='succeeded'");
  await manager.materialize();
  const tasks = new TaskManager(db.db).list(); expect(tasks).toHaveLength(6);
  expect(tasks.filter(t => t.status==='pending' && t.payload.caption==='Changed')).toHaveLength(2);
  db.db.exec("UPDATE automation_tasks SET status='succeeded'");
  await manager.materialize(); expect(manager.runs()[0].enabled).toBe(false);
});
it("pending group approval does not block other targets or recurring rounds", async () => {
  const {db,manager,input} = setup(); manager.createRun(input); await manager.materialize();
  const tasks = new TaskManager(db.db); const [first] = tasks.list();
  db.db.prepare("UPDATE automation_tasks SET status='pending_approval' WHERE id=?").run(first.id);
  expect(tasks.due(new Set())).toBeDefined();
  db.db.exec("UPDATE automation_tasks SET status='succeeded' WHERE status='pending'");
  vi.setSystemTime(new Date("2026-10-26T02:00:00Z")); await manager.materialize();
  expect(tasks.list().filter(t=>t.status==='pending')).toHaveLength(2);
});
it("stopping a run cancels unsent work and prevents new follow-ups while preserving sent history", async () => {
  const {db,manager,input,account} = setup();
  const dest = db.createDestination({accountId:account.id,kind:'facebook_group',name:'Share target',url:'https://www.facebook.com/groups/999/'});
  const id = manager.createRun({...input,shareEnabled:true,shareDestinationIds:[dest.id]}); await manager.materialize();
  const tasks = new TaskManager(db.db), first = tasks.list()[0];
  db.db.prepare("UPDATE automation_tasks SET status='running',submission_state='unknown' WHERE id=?").run(first.id);
  manager.stop(id); tasks.followUps(first,'https://www.facebook.com/groups/123/posts/999/');
  expect(tasks.list().filter(t=>t.action==='share')).toHaveLength(0);
  expect(tasks.list().filter(t=>t.status==='cancelled')).toHaveLength(2);
  expect(tasks.list().find(t=>t.id===first.id)?.status).toBe('running');
  await manager.materialize(); expect(tasks.list()).toHaveLength(3);
});
it("protects against concurrent campaigns, ambiguous prior results and missed-time bursts", async () => {
  const {db,manager,input} = setup(); manager.createRun(input);
  expect(()=>manager.createRun(input)).toThrow(/หยุดตารางเดิม/);
  await manager.materialize(); db.db.exec("UPDATE automation_tasks SET status='uncertain'");
  await manager.materialize(); expect(manager.runs()[0]).toMatchObject({enabled:false,lastError:expect.stringMatching(/ยืนยันผลไม่ได้/)});
  manager.createRun({...input,scheduledAt:'2026-10-26T02:00:00.000Z'});
  vi.setSystemTime(new Date('2026-10-26T04:00:00Z')); await manager.materialize();
  expect(manager.runs().every(r=>!r.enabled)).toBe(true);
  expect(new TaskManager(db.db).list()).toHaveLength(3);
});
it("stops with a clear error when media disappeared and rolls back an invalid share destination", async () => {
  const {db,manager,profileId,input} = setup();
  const draft = profile(); draft.sets[0].media=['/missing/autopost-image.png']; manager.save(profileId,draft);
  manager.createRun(input); await manager.materialize(); expect(manager.runs()[0].enabled).toBe(false);
  expect(new TaskManager(db.db).list()).toHaveLength(0);
  manager.save(profileId,profile());
  manager.createRun({...input,shareEnabled:true,shareDestinationIds:['11111111-1111-4111-8111-111111111111']});
  await manager.materialize(); expect(new TaskManager(db.db).list()).toHaveLength(0);
});
it("Stop during async media validation cannot enqueue a round afterwards", async () => {
  const {manager,profileId,input,db} = setup();
  const dir=mkdtempSync(join(tmpdir(),'profile-fixture-')); folders.push(dir); const path=join(dir,'image.png');writeFileSync(path,'fixture');
  const draft=profile();draft.sets[0].media=[path];manager.save(profileId,draft);
  const id=manager.createRun(input), work=manager.materialize();manager.stop(id);await work;
  expect(new TaskManager(db.db).list()).toHaveLength(0);
});
it("rereads a selected image folder each round and shares one edited profile across accounts", async () => {
  const {db,manager,profileId,input}=setup();
  const dir=mkdtempSync(join(tmpdir(),'profile-images-'));folders.push(dir);writeFileSync(join(dir,'a.png'),'fixture');
  const draft={...profile(),sets:profile().sets.map((set,index)=>index===0?{...set,media:[join(dir,'a.png')],mediaFolder:dir}:set)};
  manager.save(profileId,draft);
  const second=db.createAccount({name:'Bob',adapterType:'facebook-browser'},null,null);db.setAccountStatus(second.id,'active');
  manager.createRun(input);manager.createRun({...input,accountId:second.id});await manager.materialize();
  expect(new TaskManager(db.db).list()).toHaveLength(6);
  db.db.exec("UPDATE automation_tasks SET status='succeeded'");writeFileSync(join(dir,'b.png'),'fixture');
  manager.save(profileId,{...draft,sets:draft.sets.map(set=>({...set,caption:'Updated shared'}))});
  vi.setSystemTime(new Date('2026-10-26T02:00:00Z'));await manager.materialize();
  const pending=new TaskManager(db.db).list().filter(t=>t.status==='pending');
  expect(pending).toHaveLength(6);expect(pending.every(t=>t.payload.caption==='Updated shared')).toBe(true);
  expect(pending.filter(t=>t.payload.media.length===2)).toHaveLength(4);
});
