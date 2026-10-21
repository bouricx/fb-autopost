import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { PlatformAdapter, PublishContext, PublishResult } from "./types";
import { AuthenticationError, RateLimitError } from "../core/errors";

interface DiscordError { message?: string; retry_after?: number; }

async function responseError(response: Response): Promise<never> {
  let body: DiscordError = {};
  try { body = await response.json() as DiscordError; } catch { /* non-JSON error */ }
  if (response.status === 429) {
    throw new RateLimitError(body.message || "Discord จำกัดอัตราการส่ง", Math.ceil((body.retry_after || 5) * 1000));
  }
  if (response.status === 401 || response.status === 403) throw new AuthenticationError("Discord ปฏิเสธ Token หรือสิทธิ์ของห้อง");
  throw new Error(`Discord HTTP ${response.status}: ${body.message || response.statusText}`);
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

  async publish({ destination, job, secret }: PublishContext): Promise<PublishResult> {
    const url = destination.url || secret;
    if (!url?.startsWith("https://discord.com/api/webhooks/")) throw new AuthenticationError("Webhook URL ไม่ถูกต้อง");
    const response = await fetch(url + (url.includes("?") ? "&wait=true" : "?wait=true"), {
      method: "POST",
      body: await multipart(job.caption, job.media),
    });
    if (!response.ok) return responseError(response);
    const data = await response.json() as { id?: string; channel_id?: string };
    return { remoteId: data.id, publishedUrl: data.id && data.channel_id ? `https://discord.com/channels/@me/${data.channel_id}/${data.id}` : undefined };
  }
}

export class DiscordBotAdapter implements PlatformAdapter {
  readonly type = "discord-bot" as const;

  async publish({ destination, job, secret }: PublishContext): Promise<PublishResult> {
    if (!secret) throw new AuthenticationError("ยังไม่ได้ตั้ง Bot Token");
    const channelId = destination.remoteId;
    if (!channelId || !/^\d{15,22}$/.test(channelId)) throw new Error("Channel ID ไม่ถูกต้อง");
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${secret}` },
      body: await multipart(job.caption, job.media),
    });
    if (!response.ok) return responseError(response);
    const data = await response.json() as { id: string; guild_id?: string; channel_id: string };
    return {
      remoteId: data.id,
      publishedUrl: data.guild_id ? `https://discord.com/channels/${data.guild_id}/${data.channel_id}/${data.id}` : undefined,
    };
  }
}
