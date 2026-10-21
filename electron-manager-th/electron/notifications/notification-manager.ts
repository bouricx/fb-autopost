import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SecretVault } from "../core/secrets";

export const channelSchema = z.object({ name: z.string().trim().min(1).max(100), type: z.enum(["discord", "telegram"]),
  accountId: z.string().uuid().nullable().default(null), projectId: z.string().uuid().nullable().default(null),
  secret: z.string().min(1).max(2048), chatId: z.string().max(100).optional() });
export class NotificationManager {
  constructor(private db: Database.Database, private vault: SecretVault) {}
  list() { return this.db.prepare("SELECT id,name,type,account_id AS accountId,project_id AS projectId,enabled FROM notification_channels ORDER BY created_at").all(); }
  create(input: unknown) {
    const channel = channelSchema.parse(input);
    if (channel.type === "discord") {
      const url = new URL(channel.secret);
      if (url.protocol !== "https:" || !["discord.com", "discordapp.com"].includes(url.hostname) || !/^\/api\/webhooks\/\d+\/[\w-]+$/.test(url.pathname) || url.username || url.password) throw new Error("URL Discord Webhook ไม่ถูกต้อง");
    } else if (!/^\d+:[\w-]+$/.test(channel.secret) || !channel.chatId || !/^-?\d+$|^@[\w]+$/.test(channel.chatId)) throw new Error("Telegram Bot Token หรือ Chat ID ไม่ถูกต้อง");
    const id = randomUUID();
    this.db.prepare("INSERT INTO notification_channels(id,account_id,project_id,name,type,encrypted_url,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(id, channel.accountId, channel.projectId, channel.name, channel.type, this.vault.encrypt(JSON.stringify({ secret: channel.secret, chatId: channel.chatId })), new Date().toISOString());
    return id;
  }
  remove(id: string) { this.db.prepare("DELETE FROM notification_channels WHERE id=?").run(id); }
  async send(accountId: string, projectId: string | null, override: string | null, message: string) {
    const rows = this.db.prepare("SELECT id,type,encrypted_url AS encrypted,account_id AS accountId,project_id AS projectId FROM notification_channels WHERE enabled=1").all() as { id: string; type: string; encrypted: string; accountId: string | null; projectId: string | null }[];
    const selected = override ? rows.filter(row => row.id === override) : projectId && rows.some(row => row.projectId === projectId)
      ? rows.filter(row => row.projectId === projectId) : rows.filter(row => row.accountId === accountId && !row.projectId);
    for (const row of selected) {
      try {
        const config = JSON.parse(this.vault.decrypt(row.encrypted) || "{}");
        const url = row.type === "discord" ? config.secret : `https://api.telegram.org/bot${config.secret}/sendMessage`;
        const body = row.type === "discord" ? { content: message.slice(0, 1900), allowed_mentions: { parse: [] } } : { chat_id: config.chatId, text: message.slice(0, 4000) };
        const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000), redirect: "error" });
        if (!response.ok) throw new Error();
      } catch { this.db.prepare("INSERT INTO event_logs(level,scope,message,created_at) VALUES('warn','notification',?,?)").run("ส่งแจ้งเตือนไม่สำเร็จ กรุณาตรวจช่องแจ้งเตือน", new Date().toISOString()); }
    }
  }
}
