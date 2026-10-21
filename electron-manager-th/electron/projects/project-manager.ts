import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";

export const accountWorkspaceSchema = z.object({
  scheduleTimes: z.array(z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)).max(24).default([]), repeatDaily: z.boolean().default(false),
  accountId: z.string().max(80).default(""), caption: z.string().max(10000).default(""),
  media: z.array(z.string().max(4096)).max(10).default([]),
  destinationIds: z.array(z.string().max(80)).max(2000).default([]),
  recurrence: z.enum(["", "daily", "weekly"]).default(""),
  delayMin: z.number().int().min(0).max(86400).default(30),
  delayMax: z.number().int().min(0).max(86400).default(90),
  headless: z.boolean().nullable().default(null),
  commentEnabled: z.boolean().default(false), shareEnabled: z.boolean().default(false),
  likeEnabled: z.boolean().default(false),
  commentTemplates: z.array(z.object({ text: z.string().max(10000), image: z.string().max(4096).default("") })).max(50).default([]),
  shareDestinationIds: z.array(z.string().max(80)).max(2000).default([]),
  repeatShareMinutes: z.number().int().min(0).max(525600).default(0),
  mappings: z.array(z.object({ destinationId: z.string().max(80), caption: z.string().max(10000),
    media: z.array(z.string().max(4096)).max(10), comment: z.string().max(10000).default(""), commentImage: z.string().max(4096).default(""), shareText: z.string().max(10000).default("") })).max(2000).default([]),
});
export const workspaceSchema = accountWorkspaceSchema.extend({ accounts: z.array(accountWorkspaceSchema).max(100).default([]) });
export type AccountWorkspace = z.infer<typeof accountWorkspaceSchema>;
const projectSchema = z.object({
  name: z.string().trim().min(1).max(100),
  lastOpenedTab: z.enum(["post", "comment", "share", "like"]).default("post"),
  settings: workspaceSchema,
});
export type WorkspaceSettings = z.infer<typeof workspaceSchema>;
export interface ProjectRecord { id: string; name: string; lastOpenedTab: string; settings: WorkspaceSettings; updatedAt: string }

export class ProjectManager {
  constructor(private db: Database.Database) {}
  list(): ProjectRecord[] {
    return (this.db.prepare("SELECT id,name,last_opened_tab AS lastOpenedTab,settings_json AS settings,updated_at AS updatedAt FROM projects ORDER BY updated_at DESC").all() as Array<Omit<ProjectRecord, "settings"> & { settings: string }>).
      map(row => ({ ...row, settings: workspaceSchema.parse(JSON.parse(row.settings)) }));
  }
  get(id: string): ProjectRecord {
    const row = this.list().find(project => project.id === id);
    if (!row) throw new Error("ไม่พบโปรเจกต์");
    return row;
  }
  create(name: string, settings: unknown = {}): ProjectRecord {
    const data = projectSchema.parse({ name, settings });
    const id = randomUUID(), timestamp = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO projects(id,name,last_opened_tab,settings_json,created_at,updated_at) VALUES(?,?,?,?,?,?)")
        .run(id, data.name, data.lastOpenedTab, JSON.stringify(data.settings), timestamp, timestamp);
      this.markLastUsed(id);
      this.syncAccounts(id, data.settings);
    })();
    return this.get(id);
  }
  save(id: string, input: unknown): ProjectRecord {
    this.get(id);
    const data = projectSchema.parse(input);
    this.db.transaction(() => {
      this.db.prepare("UPDATE projects SET name=?,last_opened_tab=?,settings_json=?,updated_at=? WHERE id=?")
        .run(data.name, data.lastOpenedTab, JSON.stringify(data.settings), new Date().toISOString(), id);
      this.markLastUsed(id);
      this.syncAccounts(id, data.settings);
    })();
    return this.get(id);
  }
  duplicate(id: string) {
    const project = this.get(id);
    return this.db.transaction(() => {
      const copy = this.create(`${project.name.slice(0, 90)} (สำเนา)`, project.settings);
      return this.save(copy.id, { ...copy, lastOpenedTab: project.lastOpenedTab });
    })();
  }
  remove(id: string) { this.db.transaction(() => { this.db.prepare("DELETE FROM projects WHERE id=?").run(id); })(); }
  markLastUsed(id: string) {
    this.db.transaction(() => {
      this.db.prepare("UPDATE projects SET is_last_used=0 WHERE is_last_used=1").run();
      this.db.prepare("UPDATE projects SET is_last_used=1 WHERE id=?").run(id);
    })();
  }
  lastUsed(): string | null { return (this.db.prepare("SELECT id FROM projects WHERE is_last_used=1 LIMIT 1").get() as { id: string } | undefined)?.id || null; }
  private syncAccounts(projectId: string, settings: WorkspaceSettings) {
    // Snapshot is portable; relational rows only reference accounts present on this machine.
    if (!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='project_accounts'").get()) return;
    this.db.prepare("DELETE FROM project_accounts WHERE project_id=?").run(projectId);
    this.db.prepare("DELETE FROM group_content_mappings WHERE project_id=?").run(projectId);
    const timestamp = new Date().toISOString();
    for (const account of settings.accounts) {
      if (!this.db.prepare("SELECT id FROM accounts WHERE id=?").get(account.accountId)) continue;
      this.db.prepare(`INSERT INTO project_accounts(id,project_id,account_id,caption,media_json,group_ids_json,delay_min,delay_max,headless_override,
        comment_enabled,share_enabled,like_enabled,comment_settings_json,share_settings_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(randomUUID(), projectId, account.accountId, account.caption, JSON.stringify(account.media), JSON.stringify(account.destinationIds), account.delayMin,
          account.delayMax, account.headless === null ? null : Number(account.headless), Number(account.commentEnabled), Number(account.shareEnabled), Number(account.likeEnabled),
          JSON.stringify(account.commentTemplates), JSON.stringify({ destinationIds: account.shareDestinationIds, repeatMinutes: account.repeatShareMinutes }));
      for (const mapping of account.mappings) {
        const destination = this.db.prepare("SELECT remote_id,url,name FROM destinations WHERE id=? AND account_id=? AND kind='facebook_group'").get(mapping.destinationId, account.accountId) as { remote_id: string | null; url: string; name: string } | undefined;
        if (!destination) continue;
        const remoteId = destination.remote_id || new URL(destination.url).pathname.match(/^\/groups\/([^/]+)/)?.[1];
        if (!remoteId) continue;
        this.db.prepare(`INSERT INTO facebook_groups(id,account_id,facebook_group_id,name,url,discovered_from) VALUES(?,?,?,?,?,'project')
          ON CONFLICT(account_id,facebook_group_id) DO NOTHING`).run(randomUUID(), account.accountId, remoteId, destination.name, destination.url);
        const group = this.db.prepare("SELECT id FROM facebook_groups WHERE account_id=? AND facebook_group_id=?").get(account.accountId, remoteId) as { id: string };
        this.db.prepare(`INSERT INTO group_content_mappings(id,project_id,account_id,group_id,post_caption,post_media_json,comment_text,comment_media_json,share_text,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), projectId, account.accountId, group.id, mapping.caption, JSON.stringify(mapping.media), mapping.comment,
            JSON.stringify(mapping.commentImage ? [mapping.commentImage] : []), mapping.shareText, timestamp);
      }
    }
  }
  serialize(id: string) {
    const project = this.get(id);
    return JSON.stringify({ version: 1, app: "veltshop-autopost", project: { name: project.name, lastOpenedTab: project.lastOpenedTab, settings: project.settings },
      mediaManifest: [...new Set([project.settings, ...project.settings.accounts].flatMap(settings => [
        ...settings.media, ...settings.commentTemplates.map(template => template.image).filter(Boolean),
        ...settings.mappings.flatMap(mapping => [...mapping.media, ...(mapping.commentImage ? [mapping.commentImage] : [])]),
      ]))].map(path => ({ path, embedded: false })) }, null, 2);
  }
  import(serialized: string) {
    if (serialized.length > 5_000_000) throw new Error("ไฟล์โปรเจกต์ใหญ่เกินกำหนด");
    const data = z.object({ version: z.literal(1), app: z.literal("veltshop-autopost"), project: projectSchema }).parse(JSON.parse(serialized));
    return this.db.transaction(() => {
      const project = this.create(data.project.name, data.project.settings);
      return this.save(project.id, data.project);
    })();
  }
}
