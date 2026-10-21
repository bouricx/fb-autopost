import { DatabaseSync } from "node:sqlite";
import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { ProjectManager } from "../electron/projects/project-manager";

function setup() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,last_opened_tab TEXT DEFAULT 'post',
    is_last_used INTEGER DEFAULT 0,settings_json TEXT DEFAULT '{}',created_at TEXT,updated_at TEXT)`);
  // Native Node SQLite test adapter, avoiding the Electron-only better-sqlite3 ABI.
  const db = {
    prepare: (statement: string) => sql.prepare(statement),
    transaction: (action: () => unknown) => () => {
      const savepoint = `s${Math.random().toString(36).slice(2)}`;
      sql.exec(`SAVEPOINT ${savepoint}`);
      try { const value = action(); sql.exec(`RELEASE ${savepoint}`); return value; }
      catch (error) { sql.exec(`ROLLBACK TO ${savepoint}`); sql.exec(`RELEASE ${savepoint}`); throw error; }
    },
  };
  return { manager: new ProjectManager(db as unknown as Database.Database), close: () => sql.close() };
}

describe("ProjectManager", () => {
  it("preserves independent account settings and exports all media references", () => {
    const { manager, close } = setup();
    try {
      const project = manager.create("หลายบัญชี", { accounts: [
        { accountId: "one", caption: "ข้อความแรก", media: ["C:/one.jpg"], headless: true, delayMin: 20, delayMax: 30 },
        { accountId: "two", caption: "ข้อความสอง", media: ["C:/two.mp4"], commentTemplates: [{ text: "รายละเอียด", image: "C:/reply.jpg" }] },
      ] });
      const copy = manager.import(manager.serialize(project.id));
      expect(copy.settings.accounts).toHaveLength(2);
      expect(copy.settings.accounts[0].headless).toBe(true);
      expect(copy.settings.accounts[1].caption).toBe("ข้อความสอง");
      expect(JSON.parse(manager.serialize(project.id)).mediaManifest).toHaveLength(3);
    } finally { close(); }
  });
  it("creates, saves, duplicates, renames, remembers and removes projects", () => {
    const { manager, close } = setup();
    try {
      const first = manager.create("ขายของ", { caption: "ข้อความ", media: ["C:/photo.jpg"] });
      expect(manager.lastUsed()).toBe(first.id);
      const saved = manager.save(first.id, { name: "ขายของใหม่", lastOpenedTab: "share", settings: first.settings });
      expect(saved.lastOpenedTab).toBe("share");
      const copy = manager.duplicate(first.id);
      expect(copy.settings.caption).toBe("ข้อความ");
      expect(copy.id).not.toBe(first.id);
      expect(manager.lastUsed()).toBe(copy.id);
      manager.remove(first.id);
      expect(manager.list()).toHaveLength(1);
    } finally { close(); }
  });
  it("round trips versioned exports and rejects invalid imports", () => {
    const { manager, close } = setup();
    try {
      const project = manager.create("ทดสอบ", { caption: "สวัสดี", media: ["C:/photo.jpg"] });
      const serialized = manager.serialize(project.id);
      expect(JSON.parse(serialized).mediaManifest).toEqual([{ path: "C:/photo.jpg", embedded: false }]);
      const imported = manager.import(serialized);
      expect(imported.settings).toEqual(project.settings);
      expect(() => manager.import('{"version":2}')).toThrow();
      expect(manager.list()).toHaveLength(2);
    } finally { close(); }
  });
});
