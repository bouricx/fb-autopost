import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { PlatformAdapter, PublishContext, PublishResult } from "./types";
import { AuthenticationError, RateLimitError } from "../core/errors";
import { UncertainResultError } from "../automation/contracts";

async function submit(context: PublishContext, url: string, headers?: HeadersInit): Promise<{ id: string; channel_id: string; guild_id?: string }> {
  if (context.job.caption.length > 2000) throw new Error("ข้อความ Discord ต้องไม่เกิน 2000 ตัวอักษร");
  const body = await multipart(context.job.caption, context.job.media);
  context.onSubmitting?.();
  try {
    const response = await fetch(url, { method: "POST", headers, body, redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      // 5xx can arrive after accepting a message; retain unknown in that case.
      if (response.status >= 400 && response.status < 500) {
        context.onRejected?.();
        return responseError(response);
      }
      throw new UncertainResultError("Discord ตอบกลับผิดพลาดหลังเริ่มส่ง กรุณาตรวจห้องก่อนส่งซ้ำ");
    }
    const data = await response.json() as { id?: unknown; channel_id?: unknown; guild_id?: string };
    if (typeof data?.id !== "string" || typeof data?.channel_id !== "string" || !/^\d+$/.test(data.id) || !/^\d+$/.test(data.channel_id)) {
      throw new UncertainResultError("Discord รับคำสั่งแล้วแต่ไม่พบหมายเลขข้อความ กรุณาตรวจห้องก่อนส่งซ้ำ");
    }
    return { ...data, id: data.id, channel_id: data.channel_id };
  } catch (error) {
    if (error instanceof RateLimitError || error instanceof AuthenticationError || error instanceof UncertainResultError) throw error;
    throw new UncertainResultError("ยืนยันผลส่ง Discord ไม่ได้ กรุณาตรวจห้องก่อนส่งซ้ำ");
  }
}

interface DiscordError { message?: string; retry_after?: number; }

async function responseError(response: Response): Promise<never> {
  let body: DiscordError = {};
  try {
    const value: unknown = await response.json();
    if (value && typeof value === "object") body = value as DiscordError;
  } catch { /* non-JSON error */ }
  const message = typeof body.message === "string" ? body.message.slice(0, 300) : "";
  if (response.status === 429) {
    const delay = typeof body.retry_after === "number" && Number.isFinite(body.retry_after) && body.retry_after >= 0 ? Math.min(body.retry_after, 86400) : 5;
    throw new RateLimitError(message || "Discord จำกัดอัตราการส่ง", Math.max(1000, Math.ceil(delay * 1000)));
  }
  if (response.status === 401 || response.status === 403) throw new AuthenticationError("Discord ปฏิเสธ Token หรือสิทธิ์ของห้อง");
  throw new Error(`Discord HTTP ${response.status}: ${message || response.statusText}`);
}

async function multipart(caption: string, media: string[]): Promise<FormData> {
  const form = new FormData();
  form.set("payload_json", JSON.stringify({ content: caption }));
  for (let index = 0; index < media.slice(0, 10).length; index++) {
    const path = media[index];
    const bytes = await readFile(path);
    form.set(`files[${index}]`, new Blob([bytes]), basename(path));
  }
  return form;
}

export class DiscordWebhookAdapter implements PlatformAdapter {
  readonly type = "discord-webhook" as const;

  async publish(context: PublishContext): Promise<PublishResult> {
    const { destination, secret } = context;
    const url = destination.url || secret;
    let parsed: URL;
    try { parsed = new URL(url || ""); } catch { throw new AuthenticationError("Webhook URL ไม่ถูกต้อง"); }
    if (parsed.protocol !== "https:" || parsed.hostname !== "discord.com" || parsed.username || parsed.password || parsed.port || !/^\/api\/webhooks\/\d+\/[\w-]+$/.test(parsed.pathname)) throw new AuthenticationError("Webhook URL ไม่ถูกต้อง");
    parsed.searchParams.set("wait", "true");
    const data = await submit(context, parsed.href);
    return { remoteId: data.id, publishedUrl: `https://discord.com/channels/${data.guild_id || "@me"}/${data.channel_id}/${data.id}` };
  }
}

export class DiscordBotAdapter implements PlatformAdapter {
  readonly type = "discord-bot" as const;

  async publish(context: PublishContext): Promise<PublishResult> {
    const { destination, secret } = context;
    if (!secret) throw new AuthenticationError("ยังไม่ได้ตั้ง Bot Token");
    const channelId = destination.remoteId;
    if (!channelId || !/^\d{15,22}$/.test(channelId)) throw new Error("Channel ID ไม่ถูกต้อง");
    const data = await submit(context, `https://discord.com/api/v10/channels/${channelId}/messages`, { Authorization: `Bot ${secret}` });
    return {
      remoteId: data.id,
      publishedUrl: data.guild_id ? `https://discord.com/channels/${data.guild_id}/${data.channel_id}/${data.id}` : undefined,
    };
  }
}
