import { DatabaseSync } from "node:sqlite";
import type Database from "better-sqlite3";
import { expect, it } from "vitest";
import { cancelPendingQueueItems, deletePendingQueueItems, deleteQueueItem } from "../electron/core/queue-management";
it("protects running jobs and descendants, deletes only the confirmed subtree", () => {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`PRAGMA foreign_keys=ON; CREATE TABLE jobs(id TEXT PRIMARY KEY,status TEXT);
    CREATE TABLE automation_tasks(id TEXT PRIMARY KEY,status TEXT,parent_id TEXT REFERENCES automation_tasks(id) ON DELETE CASCADE);
    INSERT INTO jobs VALUES('running','running'),('pending','pending');
    INSERT INTO automation_tasks VALUES('parent','succeeded',NULL),('child','running','parent'),('other','pending',NULL);`);
  const db = { prepare: (query: string) => sql.prepare(query), transaction: (work: () => void) => () => {
    sql.exec("BEGIN"); try { work(); sql.exec("COMMIT"); } catch (error) { sql.exec("ROLLBACK"); throw error; }
  } } as unknown as Database.Database;
  try {
    expect(() => deleteQueueItem(db, "post", "running")).toThrow();
    expect(() => deleteQueueItem(db, "workflow", "parent")).toThrow();
    expect(sql.prepare("SELECT id FROM automation_tasks").all()).toHaveLength(3);
    sql.prepare("UPDATE automation_tasks SET status='failed' WHERE id='child'").run();
    deleteQueueItem(db, "workflow", "parent");
    expect(sql.prepare("SELECT id FROM automation_tasks").all()).toEqual([expect.objectContaining({ id: "other" })]);
    deleteQueueItem(db, "post", "pending");
    expect(sql.prepare("SELECT id FROM jobs").all()).toHaveLength(1);
  } finally { sql.close(); }
});
it("deletes selected unsent queue in one transaction and refuses sent or running descendants", () => {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`PRAGMA foreign_keys=ON; CREATE TABLE jobs(id TEXT PRIMARY KEY,status TEXT,submission_state TEXT);
    CREATE TABLE automation_tasks(id TEXT PRIMARY KEY,parent_id TEXT REFERENCES automation_tasks(id) ON DELETE CASCADE,status TEXT,submission_state TEXT);
    INSERT INTO jobs VALUES('new','pending','not_sent'),('sent','succeeded','sent'),('unknown','uncertain','unknown');
    INSERT INTO automation_tasks VALUES('root',NULL,'pending','not_sent'),('child','root','pending','not_sent'),('other',NULL,'running','unknown');`);
  let serial = 0;
  const db = { prepare: (query: string) => sql.prepare(query), transaction: (work: () => unknown) => () => {
    const name = `s${serial++}`; sql.exec(`SAVEPOINT ${name}`);
    try { const result = work(); sql.exec(`RELEASE ${name}`); return result; } catch (error) { sql.exec(`ROLLBACK TO ${name}; RELEASE ${name}`); throw error; }
  } } as unknown as Database.Database;
  try {
    expect(() => deletePendingQueueItems(db, [{ kind: "post", id: "new" }, { kind: "post", id: "sent" }])).toThrow();
    expect(sql.prepare("SELECT count(*) AS n FROM jobs WHERE id='new'").get()).toEqual({ n: 1 });
    sql.prepare("UPDATE automation_tasks SET status='running', submission_state='unknown' WHERE id='child'").run();
    expect(() => deletePendingQueueItems(db, [{ kind: "workflow", id: "root" }])).toThrow();
    sql.prepare("UPDATE automation_tasks SET status='pending', submission_state='not_sent' WHERE id='child'").run();
    expect(deletePendingQueueItems(db, [{ kind: "post", id: "new" }, { kind: "workflow", id: "root" }])).toBe(2);
    expect(sql.prepare("SELECT id FROM automation_tasks").all()).toEqual([{ id: "other" }]);
    expect(sql.prepare("SELECT id FROM jobs ORDER BY id").all()).toEqual([{ id: "sent" }, { id: "unknown" }]);
  } finally { sql.close(); }
});
it("cancels only not-sent pending work and keeps sent, uncertain and running history", () => {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`CREATE TABLE jobs(id TEXT PRIMARY KEY,status TEXT,submission_state TEXT,updated_at TEXT);
    CREATE TABLE automation_tasks(id TEXT PRIMARY KEY,parent_id TEXT,status TEXT,submission_state TEXT,last_error TEXT,updated_at TEXT);
    INSERT INTO jobs(id,status,submission_state) VALUES('new','pending','not_sent'),('held','review_required','not_sent'),('sent','pending','unknown'),('running','running','not_sent');
    INSERT INTO automation_tasks(id,status,submission_state) VALUES('parent','pending','not_sent'),('uncertain','uncertain','unknown');
    INSERT INTO automation_tasks(id,parent_id,status,submission_state) VALUES('child','parent','pending','not_sent');`);
  const db = { prepare: (query: string) => sql.prepare(query), transaction: (work: () => void) => () => {
    sql.exec("BEGIN"); try { const result = work(); sql.exec("COMMIT"); return result; } catch (error) { sql.exec("ROLLBACK"); throw error; }
  } } as unknown as Database.Database;
  try {
    const changed = cancelPendingQueueItems(db, [...["new", "held", "sent", "running"].map(id => ({ kind: "post" as const, id })), { kind: "workflow", id: "parent" }]);
    expect(changed).toBe(3);
    expect(sql.prepare("SELECT status FROM jobs WHERE id='new'").get()).toEqual({ status: "cancelled" });
    expect(sql.prepare("SELECT status FROM jobs WHERE id='held'").get()).toEqual({ status: "cancelled" });
    expect(sql.prepare("SELECT status FROM jobs WHERE id='sent'").get()).toEqual({ status: "pending" });
    expect(sql.prepare("SELECT status FROM jobs WHERE id='running'").get()).toEqual({ status: "running" });
    expect(sql.prepare("SELECT status FROM automation_tasks WHERE id='child'").get()).toEqual({ status: "cancelled" });
    expect(sql.prepare("SELECT status FROM automation_tasks WHERE id='uncertain'").get()).toEqual({ status: "uncertain" });
  } finally { sql.close(); }
});
