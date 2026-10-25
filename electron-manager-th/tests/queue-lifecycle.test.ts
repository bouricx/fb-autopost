import { afterEach, expect, it, vi } from "vitest";
const desktop = vi.hoisted(() => ({ fail: false }));
vi.mock("electron", () => ({ Notification: class { static isSupported() { return desktop.fail; } show() { throw new Error("notification unavailable"); } }, safeStorage: {} }));
import { QueueEngine } from "../electron/core/queue";
import { AppDatabase } from "../electron/core/database";
import type { AdapterRegistry } from "../electron/adapters/registry";
import type { SecretVault } from "../electron/core/secrets";
import { DiscordWebhookAdapter } from "../electron/adapters/discord";
const databases: AppDatabase[] = [];
afterEach(() => { databases.forEach(db => db.close()); databases.length = 0; desktop.fail = false; vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function setup() {
  const db = new AppDatabase(":memory:"); databases.push(db);
  const account = db.createAccount({ name: "fixture", adapterType: "discord-webhook" }, null, null);
  const destination = db.createDestination({ accountId: account.id, kind: "discord_webhook", name: "fixture", url: "https://discord.com/api/webhooks/123/mock" });
  const queue = new QueueEngine(db, { get: () => new DiscordWebhookAdapter() } as unknown as AdapterRegistry, { decrypt: () => null } as unknown as SecretVault, "/tmp", 1);
  return { db, account, destination, queue };
}
it("serializes duplicate stops and restart until the old loop and work are drained", async () => {
  const { db, queue } = setup();
  let endLoop!: () => void, endWork!: () => void;
  const loop = vi.spyOn(queue as any, "loop").mockImplementation(() => new Promise<void>(resolve => { endLoop = resolve; }));
  const recovery = vi.spyOn(db, "recoverInterruptedJobs");
  queue.start();
  (queue as any).track(new Promise<void>(resolve => { endWork = resolve; }));
  const stopped = queue.stop(); expect(queue.stop()).toBe(stopped);
  const restarted = queue.start(); expect(loop).toHaveBeenCalledTimes(1); expect(recovery).toHaveBeenCalledTimes(1);
  endLoop(); await Promise.resolve(); expect(loop).toHaveBeenCalledTimes(1);
  endWork(); await stopped; await restarted;
  expect(loop).toHaveBeenCalledTimes(2); expect(recovery).toHaveBeenCalledTimes(2);
  const finalStop = queue.stop(); endLoop(); await finalStop;
});
it("persists an ambiguous Discord delivery as uncertain and forbids manual retry", async () => {
  const { db, account, destination, queue } = setup();
  const [job] = db.createJobs({ accountId: account.id, destinationIds: [destination.id], caption: "fixture", media: [], runAt: new Date().toISOString(), delayMin: 0, delayMax: 0 });
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("lost response")));
  await (queue as any).execute(job);
  expect(db.job(job.id)).toMatchObject({ status: "uncertain", submissionState: "unknown" });
  expect(() => db.retryJob(job.id)).toThrow();
});
it("429 retains retry eligibility and account cooldown without permanently disabling the account", async () => {
  const { db, account, destination, queue } = setup();
  const [job] = db.createJobs({ accountId: account.id, destinationIds: [destination.id], caption: "fixture", media: [], runAt: new Date().toISOString(), delayMin: 0, delayMax: 0 });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"retry_after":120}', {status:429})));
  await (queue as any).execute(job);
  expect(db.job(job.id)).toMatchObject({ status: "pending", submissionState: "not_sent" });
  expect(db.accountRecord(account.id)?.status).toBe("active");
  const row = db.db.prepare("SELECT cooldown_until AS until FROM accounts WHERE id=?").get(account.id) as { until: string };
  expect(Date.parse(row.until)).toBeGreaterThan(Date.now()+119000);
  expect(db.claimDue(5)).toHaveLength(0);
});
it("does not claim paused accounts or disabled destinations", () => {
  const { db, account, destination } = setup();
  db.createJobs({ accountId: account.id, destinationIds: [destination.id], caption: "fixture", media: [], runAt: new Date().toISOString() });
  db.setAccountStatus(account.id,"paused"); expect(db.claimDue(5)).toHaveLength(0);
  db.setAccountStatus(account.id,"active"); db.db.prepare("UPDATE destinations SET enabled=0 WHERE id=?").run(destination.id); expect(db.claimDue(5)).toHaveLength(0);
});
it("a later stop cancels a restart requested while draining", async () => {
 const {queue}=setup();let end!:()=>void;
 const loop=vi.spyOn(queue as any,'loop').mockImplementation(()=>new Promise<void>(resolve=>{end=resolve;}));
 queue.start();const stopping=queue.stop();const restarting=queue.start();const lastStop=queue.stop();end();
 await Promise.all([stopping,restarting,lastStop]);expect(loop).toHaveBeenCalledTimes(1);expect(queue.status().running).toBe(false);
});
it("protects account and destination records while a job is running",()=>{
 const {db,account,destination}=setup();
 const [job]=db.createJobs({accountId:account.id,destinationIds:[destination.id],caption:'fixture',media:[],runAt:new Date().toISOString()});
 db.db.prepare("UPDATE jobs SET status='running' WHERE id=?").run(job.id);
 expect(()=>db.deleteAccount(account.id)).toThrow();expect(()=>db.deleteDestination(destination.id)).toThrow();
 expect(db.accountRecord(account.id)).toBeDefined();expect(db.destination(destination.id)).toBeDefined();
});
it("a desktop notification failure never downgrades a confirmed delivery",async()=>{
 const {db,account,destination,queue}=setup();desktop.fail=true;
 const [job]=db.createJobs({accountId:account.id,destinationIds:[destination.id],caption:'fixture',media:[],runAt:new Date().toISOString(),delayMin:0,delayMax:0});
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{"id":"123","channel_id":"456"}')));
 await (queue as any).execute(job);
 expect(db.job(job.id)).toMatchObject({status:'succeeded',submissionState:'sent'});
 expect(fetch).toHaveBeenCalledOnce();
});
