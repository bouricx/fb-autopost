import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SecretVault } from "../core/secrets";
import { webhookFailureReason } from "./webhook-diagnostics";

export const channelSchema = z.object({ name: z.string().trim().min(1).max(100), type: z.enum(["discord", "telegram"]),
  accountId: z.string().uuid().nullable().default(null), projectId: z.string().uuid().nullable().default(null),
  secret: z.string().min(1).max(2048), chatId: z.string().max(100).optional() });
export interface DeliveryResult { delivered: number; failed: number; missing: boolean }
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
  async probe(id: string): Promise<string> {
    const row = this.db.prepare("SELECT type,encrypted_url AS encrypted FROM notification_channels WHERE id=? AND enabled=1").get(id) as { type: string; encrypted: string } | undefined;
    if (!row || row.type !== "discord") throw new Error("ไม่พบช่อง Discord ที่เปิดใช้งาน");
    try {
      const config = JSON.parse(this.vault.decrypt(row.encrypted) || "{}");
      const url = new URL(config.secret);
      if (url.protocol !== "https:" || !["discord.com", "discordapp.com"].includes(url.hostname) || !/^\/api\/webhooks\/\d+\/[\w-]+$/.test(url.pathname)) throw new Error("invalid webhook");
      // GET checks webhook availability without sending a message to the channel.
      const response = await fetch(url, { method: "GET", headers: { "User-Agent": "AutoPost-Manager-TH/0.6.8" }, signal: AbortSignal.timeout(15_000), redirect: "error" });
      if (!response.ok) return webhookFailureReason(response);
      return "Webhook ตอบรับการตรวจสอบ (ไม่ได้ส่งข้อความทดสอบ)";
    } catch (error) { return webhookFailureReason(null, error); }
  }
  async testDelivery(id: string): Promise<string> {
    const row = this.db.prepare("SELECT type,encrypted_url AS encrypted FROM notification_channels WHERE id=? AND enabled=1").get(id) as { type: string; encrypted: string } | undefined;
    if (!row || row.type !== "discord") throw new Error("ไม่พบช่อง Discord ที่เปิดใช้งาน");
    try {
      const config = JSON.parse(this.vault.decrypt(row.encrypted) || "{}");
      const url = new URL(config.secret);
      if (url.protocol !== "https:" || !["discord.com", "discordapp.com"].includes(url.hostname) || !/^\/api\/webhooks\/\d+\/[\w-]+$/.test(url.pathname) || url.username || url.password || url.search || url.hash) throw new Error("invalid webhook");
      url.searchParams.set("wait", "true");
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "AutoPost-Manager-TH/0.6.8" },
        body: JSON.stringify({ content: "AutoPost Manager TH: ทดสอบการแจ้งเตือน Discord (ไม่ใช่โพสต์ Facebook)", allowed_mentions: { parse: [] } }),
        signal: AbortSignal.timeout(15_000), redirect: "error" });
      if (!response.ok) return webhookFailureReason(response);
      const result = await response.json() as { id?: unknown };
      return typeof result.id === "string" && /^\d+$/.test(result.id) ? "Discord รับข้อความทดสอบแล้ว (ยืนยัน message ID; ไม่ได้โพสต์ Facebook)" : "Discord ตอบรับ แต่ไม่ได้ยืนยัน message ID";
    } catch (error) { return webhookFailureReason(null, error); }
  }
  async send(accountId: string, projectId: string | null, override: string | null, message: string): Promise<DeliveryResult> {
    const rows = this.db.prepare("SELECT id,type,encrypted_url AS encrypted,account_id AS accountId,project_id AS projectId FROM notification_channels WHERE enabled=1").all() as { id: string; type: string; encrypted: string; accountId: string | null; projectId: string | null }[];
    const selected = override ? rows.filter(row => row.id === override) : projectId && rows.some(row => row.projectId === projectId)
      ? rows.filter(row => row.projectId === projectId) : rows.filter(row => row.accountId === accountId && !row.projectId);
    const outcome: DeliveryResult = { delivered: 0, failed: 0, missing: selected.length === 0 };
    if (outcome.missing) {
      this.db.prepare("INSERT INTO event_logs(level,scope,message,created_at) VALUES('warn','notification',?,?)")
        .run("ไม่มีช่องแจ้งเตือนที่เปิดใช้งานและตรงกับงาน กรุณาตรวจการผูกช่อง Discord", new Date().toISOString());
    }
    for (const row of selected) {
      try {
        const config = JSON.parse(this.vault.decrypt(row.encrypted) || "{}");
        const url = row.type === "discord" ? new URL(config.secret) : new URL(`https://api.telegram.org/bot${config.secret}/sendMessage`);
        if (row.type === "discord") {
          if (url.protocol !== "https:" || !["discord.com", "discordapp.com"].includes(url.hostname) || !/^\/api\/webhooks\/\d+\/[\w-]+$/.test(url.pathname) || url.username || url.password || url.search || url.hash) throw new Error("invalid webhook");
          url.searchParams.set("wait", "true");
        }
        const body = row.type === "discord" ? { content: message.slice(0, 1900), allowed_mentions: { parse: [] } } : { chat_id: config.chatId, text: message.slice(0, 4000) };
        const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "AutoPost-Manager-TH/0.6.8" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000), redirect: "error" });
        if (!response.ok) throw new Error(webhookFailureReason(response));
        if (row.type === "discord") {
          const result = await response.json() as { id?: unknown };
          if (typeof result.id !== "string" || !/^\d+$/.test(result.id)) throw new Error("Discord ไม่ยืนยัน message ID");
        }
        outcome.delivered++;
      } catch (error) {
        outcome.failed++;
        const reason = error instanceof Error && /^HTTP \d{3}:/.test(error.message) ? error.message
          : error instanceof Error && error.message === "Discord ไม่ยืนยัน message ID" ? error.message : webhookFailureReason(null, error);
        this.db.prepare("INSERT INTO event_logs(level,scope,message,created_at) VALUES('warn','notification',?,?)")
          .run(`ช่อง ${row.type} แจ้งเตือนไม่สำเร็จ: ${reason}`, new Date().toISOString());
      }
    }
    return outcome;
  }
}
