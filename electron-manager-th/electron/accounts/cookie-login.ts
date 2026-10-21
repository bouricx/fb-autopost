import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import type { CookieCandidate } from "./cookie-parser";
import { SessionChecker } from "./session-checker";
import { SecretVault } from "../core/secrets";

/** Browser verification only. Account persistence is owned by AccountManager. */
export class CookieLogin {
  constructor(private readonly vault: SecretVault, private readonly checker: SessionChecker) {}

  async verify(candidate: CookieCandidate, profilePath: string, headless = true) {
    await mkdir(profilePath, { recursive: true });
    const context = await chromium.launchPersistentContext(profilePath, {
      channel: "chrome", headless, locale: "th-TH", timezoneId: "Asia/Bangkok",
      viewport: { width: 1365, height: 900 }, args: ["--disable-notifications"],
    });
    try {
      await context.addCookies(candidate.cookies);
      const session = await this.checker.check(context, candidate.userId);
      const cookies = await context.cookies("https://www.facebook.com/");
      return { session, encryptedCookies: this.vault.encryptCookies(JSON.stringify(cookies)), format: candidate.format };
    } finally {
      await context.close();
    }
  }
}
