import { z } from "zod";
export const facebookUrl = z.string().url().max(2048).refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && ["www.facebook.com", "facebook.com", "m.facebook.com"].includes(url.hostname) && !url.username && !url.password;
}, "ต้องใช้ URL Facebook แบบ HTTPS");
export const actionPayloadSchema = z.object({
  profileRunId: z.string().uuid().nullable().default(null),
  scheduleId: z.string().uuid().nullable().default(null), roundId: z.string().uuid().nullable().default(null),
  targetUrl: facebookUrl, sourceUrl: facebookUrl.optional(), groupName: z.string().max(200).optional(),
  caption: z.string().max(10000).default(""), media: z.array(z.string().max(4096)).max(10).default([]),
  headless: z.boolean().nullable().default(null), delayMin: z.number().int().min(0).max(86400).default(30),
  delayMax: z.number().int().min(0).max(86400).default(90), repeatMinutes: z.number().int().min(0).max(525600).default(0),
  channelId: z.string().uuid().nullable().default(null),
  commentTemplates: z.array(z.object({ text: z.string().max(10000), image: z.string().max(4096).default("") })).max(50).default([]),
  commentEnabled: z.boolean().default(false), likeEnabled: z.boolean().default(false), shareEnabled: z.boolean().default(false),
  shareTargets: z.array(z.object({ url: facebookUrl, name: z.string().max(200), caption: z.string().max(10000).default(""), media: z.array(z.string().max(4096)).max(10).default([]) })).max(2000).default([]),
}).refine(data => data.delayMax >= data.delayMin, "เวลาพักสูงสุดต้องไม่น้อยกว่าเวลาพักต่ำสุด");
export type ActionPayload = z.infer<typeof actionPayloadSchema>;
export type ActionKind = "post" | "comment" | "share" | "like";
export interface AutomationTask { id: string; accountId: string; projectId: string | null; parentId: string | null; action: ActionKind; status: string; submissionState?: string;
  payload: ActionPayload; resultUrl: string | null; lastError: string | null; attempts: number; maxAttempts?: number; scheduledAt: string }
export class ActionBlockedError extends Error {}
export class UncertainResultError extends Error {}
export class RetryableBeforeSubmitError extends Error {}
