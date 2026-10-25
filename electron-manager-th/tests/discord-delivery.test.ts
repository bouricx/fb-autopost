import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscordBotAdapter, DiscordWebhookAdapter } from "../electron/adapters/discord";
import type { PublishContext } from "../electron/adapters/types";
import { UncertainResultError } from "../electron/automation/contracts";
import { RateLimitError, AuthenticationError } from "../electron/core/errors";
afterEach(() => vi.unstubAllGlobals());
function context(): PublishContext {
  return { destination: { url: "https://discord.com/api/webhooks/123/mock?wait=false", remoteId: "123456789012345" }, job: { caption: "fixture", media: [] }, secret: "test", onSubmitting: vi.fn(), onRejected: vi.fn() } as unknown as PublishContext;
}
describe.each([new DiscordWebhookAdapter(), new DiscordBotAdapter()])("$type delivery", adapter => {
  it("marks submission before network; a lost response is uncertain", async () => {
    const c = context(); const fetch = vi.fn().mockImplementation(() => { expect(c.onSubmitting).toHaveBeenCalledOnce(); throw new Error("lost response"); });
    vi.stubGlobal("fetch", fetch);
    await expect(adapter.publish(c)).rejects.toBeInstanceOf(UncertainResultError);
    expect(c.onRejected).not.toHaveBeenCalled();
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "error", method: "POST" });
    if (adapter.type === "discord-webhook") expect(new URL(fetch.mock.calls[0][0]).searchParams.getAll("wait")).toEqual(["true"]);
  });
  it("distinguishes a definite rate-limit rejection from an unknown outcome", async () => {
    const c = context(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ retry_after: 2 }), { status: 429 })));
    await expect(adapter.publish(c)).rejects.toBeInstanceOf(RateLimitError);
    expect(c.onRejected).toHaveBeenCalledOnce();
  });
  it("marks explicit auth rejection as not sent", async () => {
    const c = context(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 403 })));
    await expect(adapter.publish(c)).rejects.toBeInstanceOf(AuthenticationError);
    expect(c.onRejected).toHaveBeenCalledOnce();
  });
  it("does not claim success for 5xx, malformed JSON or a missing message id", async () => {
    for (const response of [new Response("{}", { status: 500 }), new Response("not json"), new Response("{}")]) {
      const c = context(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      await expect(adapter.publish(c)).rejects.toBeInstanceOf(UncertainResultError);
      expect(c.onRejected).not.toHaveBeenCalled();
    }
  });
  it("validates caption and local media before marking or sending", async () => {
    for (const job of [{ caption: "x".repeat(2001), media: [] }, { caption: "fixture", media: ["/nonexistent/autopost-fixture.png"] }]) {
      const c = { ...context(), job } as PublishContext; const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
      await expect(adapter.publish(c)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled(); expect(c.onSubmitting).not.toHaveBeenCalled();
    }
  });
  it("returns a validated remote message", async () => {
    const c = context(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"id":"123","channel_id":"456","guild_id":"789"}')));
    expect((await adapter.publish(c)).remoteId).toBe("123"); expect(c.onRejected).not.toHaveBeenCalled();
  });
});
it("rejects credential-bearing and lookalike webhook URLs before network", async () => {
  vi.stubGlobal("fetch", vi.fn());
  for (const url of ["https://discord.com.evil.test/api/webhooks/123/token", "https://user@discord.com/api/webhooks/123/token", "https://discord.com:8443/api/webhooks/123/token"]) {
    const c = context(); c.destination.url = url; await expect(new DiscordWebhookAdapter().publish(c)).rejects.toBeInstanceOf(AuthenticationError);
  }
  expect(fetch).not.toHaveBeenCalled();
});
it("invalid retry_after cannot produce an invalid retry date",async()=>{
 for(const body of ['null','{"retry_after":"invalid"}','{"retry_after":-2}']){
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(body,{status:429})));
  try{await new DiscordWebhookAdapter().publish(context());throw new Error('expected rate limit');}
  catch(error){expect(error).toBeInstanceOf(RateLimitError);expect(Number.isFinite((error as RateLimitError).retryAfterMs)).toBe(true);expect((error as RateLimitError).retryAfterMs).toBeGreaterThan(0);}
 }
});
