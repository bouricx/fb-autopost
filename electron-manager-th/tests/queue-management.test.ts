import { DatabaseSync } from "node:sqlite";
import type Database from "better-sqlite3";
import { expect, it } from "vitest";
import { deleteQueueItem } from "../electron/core/queue-management";
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
