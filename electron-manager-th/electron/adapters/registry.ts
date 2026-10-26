import type { AdapterType } from "../../src/shared/types";
import type { PlatformAdapter } from "./types";
import { DiscordBotAdapter, DiscordWebhookAdapter } from "./discord";
import { FacebookBrowserAdapter } from "./facebook-browser";

export class AdapterRegistry {
  private readonly adapters = new Map<AdapterType, PlatformAdapter>();

  constructor(cookieSession?: ConstructorParameters<typeof FacebookBrowserAdapter>[0]) {
    for (const adapter of [new FacebookBrowserAdapter(cookieSession), new DiscordWebhookAdapter(), new DiscordBotAdapter()]) {
      this.adapters.set(adapter.type, adapter);
    }
  }

  get(type: AdapterType): PlatformAdapter {
    const adapter = this.adapters.get(type);
    if (!adapter) throw new Error(`ไม่รองรับ adapter: ${type}`);
    return adapter;
  }

  async close() {
    await Promise.allSettled([...this.adapters.values()].map((adapter) => adapter.close?.()));
  }
}
