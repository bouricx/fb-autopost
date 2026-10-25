import type { BrowserContext, Page } from "playwright-core";

export interface VerifiedFacebookIdentity {
  userId: string;
  name: string;
  photoUrl: string | null;
  actorType: "profile" | "page";
}

export function profileIdFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!/(^|\.)facebook\.com$/.test(url.hostname)) return null;
    const id = url.pathname === "/profile.php" ? url.searchParams.get("id") : url.pathname.match(/^\/([0-9]{5,})\/?$/)?.[1];
    return id && /^[0-9]{5,}$/.test(id) ? id : null;
  } catch { return null; }
}

/** A profile link must match the authenticated c_user; do not infer a Page from a group or arbitrary avatar. */
export async function inspectFacebookIdentity(page: Page, context: BrowserContext, expectedUserId?: string): Promise<VerifiedFacebookIdentity | null> {
  const cookies = await context.cookies("https://www.facebook.com/");
  const userId = cookies.find(cookie => cookie.name === "c_user")?.value;
  if (!userId || !/^[0-9]{5,}$/.test(userId) || (expectedUserId && userId !== expectedUserId)) return null;
  const control = page.getByRole("button", { name: /Your profile|Account|โปรไฟล์ของคุณ|บัญชีของคุณ/i }).first();
  if (!await control.isVisible().catch(() => false)) return null;
  const candidates = await page.locator('a[href*="profile.php"],a[href*="facebook.com/"]').evaluateAll(links => links.map(link => {
    const anchor = link as HTMLAnchorElement;
    const img = anchor.querySelector<HTMLImageElement>("img");
    return { url: anchor.href, name: (anchor.textContent || "").replace(/\s+/g, " ").trim(),
      photoUrl: img?.currentSrc || img?.src || null };
  }));
  const matches = candidates.filter(item => profileIdFromUrl(item.url) === userId && !!item.name && item.name.length <= 80 &&
    !/^(?:Profile|Your profile|See your profile|โปรไฟล์|ดูโปรไฟล์)$/i.test(item.name));
  const names = [...new Set(matches.map(item => item.name))];
  if (names.length !== 1) return null;
  const image = matches.find(item => item.photoUrl && /^https:/.test(item.photoUrl));
  return { userId, name: names[0], photoUrl: image?.photoUrl || null, actorType: "profile" };
}
