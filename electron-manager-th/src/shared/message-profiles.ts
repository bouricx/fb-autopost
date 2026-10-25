import { z } from "zod";
import { postIdentity } from "../../electron/automation/post-target";
import { facebookUrl } from "../../electron/automation/contracts";
export const messageProfileSchema = z.object({
  name: z.string().trim().min(1).max(100), action: z.enum(["post", "comment"]),
  sets: z.array(z.object({ name: z.string().trim().min(1).max(80),
    links: z.array(facebookUrl).min(1).max(2000), caption: z.string().max(10000),
    media: z.array(z.string().min(1).max(4096)).max(10), mediaFolder: z.string().max(4096).optional(),
  })).min(1).max(52),
}).superRefine((profile, ctx) => {
  const seen = new Set<string>();
  for (const [index, set] of profile.sets.entries()) {
    if (!set.caption.trim() && !set.media.length) ctx.addIssue({ code: "custom", path: ["sets", index], message: "แต่ละชุดต้องมีข้อความหรือรูป" });
    if (profile.action === "comment" && set.media.length > 1) ctx.addIssue({ code: "custom", path: ["sets", index, "media"], message: "ความคิดเห็นแนบรูปได้หนึ่งรูป" });
    if (set.media.some(path => !/\.(jpe?g|png|webp|gif)$/i.test(path))) ctx.addIssue({ code: "custom", path: ["sets", index, "media"], message: "โปรไฟล์รองรับเฉพาะไฟล์รูปภาพ" });
    for (const link of set.links) {
      if (profile.action === "comment" && !postIdentity(link)) ctx.addIssue({ code: "custom", path: ["sets", index, "links"], message: "ดันเมนต์ต้องใช้ลิงก์ถาวรของโพสต์ /posts/… หรือ permalink" });
      const url = new URL(link); url.hash = ""; url.search = "";
      const key = url.pathname.replace(/\/$/, "") + (new URL(link).searchParams.get("story_fbid") || "");
      if (profile.action === "post" && !/^\/groups\/[^/]+\/?$/.test(url.pathname)) ctx.addIssue({ code: "custom", path: ["sets", index, "links"], message: "โปรไฟล์โพสต์ต้องใช้ลิงก์หน้ากลุ่ม" });
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["sets", index, "links"], message: "ลิงก์ซ้ำข้ามชุด กรุณาเลือกชุดเดียวต่อปลายทาง" });
      seen.add(key);
    }
  }
  if (seen.size > 2000) ctx.addIssue({ code: "custom", message: "รองรับไม่เกิน 2,000 ลิงก์ต่อโปรไฟล์" });
});
export type MessageProfileInput = z.infer<typeof messageProfileSchema>;
export type MessageProfile = MessageProfileInput & { id: string; updatedAt: string };
export const profileRunSchema = z.object({
  accountId: z.string().uuid(), profileId: z.string().uuid(), scheduledAt: z.string().datetime(),
  repeatMinutes: z.number().int().min(1).max(525600), rounds: z.number().int().min(0).max(10000),
  delayMin: z.number().int().min(0).max(86400), delayMax: z.number().int().min(0).max(86400),
  shareEnabled: z.boolean().default(false), shareDestinationIds: z.array(z.string().uuid()).max(2000).default([]),
  shareRepeatMinutes: z.number().int().min(0).max(525600).default(0),
}).refine(data => data.delayMax >= data.delayMin, "เวลาพักสูงสุดต้องไม่น้อยกว่าต่ำสุด")
  .refine(data => !(data.shareEnabled && data.shareRepeatMinutes > 0 && data.rounds !== 1), "แชร์ซ้ำใช้กับโปรไฟล์ 1 รอบ เพื่อป้องกันตารางวนซ้อนกัน");
export type ProfileRunInput = z.infer<typeof profileRunSchema>;
export type ProfileRun = ProfileRunInput & { id: string; enabled: boolean; completedRounds: number; nextRunAt: string; lastError: string | null; profileName: string; action: "post" | "comment" };
/** Fisher–Yates reorders complete records, never detaches text/media from their link. */
export function shuffledTargets(profile: MessageProfileInput, random = Math.random) {
  const targets = profile.sets.flatMap(set => set.links.map(targetUrl => ({ targetUrl, caption: set.caption, media: [...set.media], setName: set.name })));
  for (let i = targets.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [targets[i], targets[j]] = [targets[j], targets[i]]; }
  return targets;
}
