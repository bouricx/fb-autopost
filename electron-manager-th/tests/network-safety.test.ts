import { expect, it } from "vitest";
import { dnsFailureCode, NetworkUnavailableError } from "../electron/core/network-safety";
import { webhookFailureReason } from "../electron/notifications/webhook-diagnostics";

it("distinguishes DNS outages from generic navigation errors without exposing destinations", () => {
  expect(dnsFailureCode(new Error("page.goto: net::ERR_NAME_NOT_RESOLVED at https://www.facebook.com/groups/1"))).toBe("ERR_NAME_NOT_RESOLVED");
  expect(dnsFailureCode(new Error("page.goto: Timeout 60000ms exceeded"))).toBeNull();
  expect(new NetworkUnavailableError("Facebook", "ERR_NAME_NOT_RESOLVED").message).toContain("DNS");
});

it("reports Discord failure categories without logging the webhook token", () => {
  expect(webhookFailureReason({ status: 404 })).toContain("Webhook");
  expect(webhookFailureReason(null, Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND", message: "https://discord.com/api/webhooks/123/SECRET" } }))).toContain("DNS");
  expect(webhookFailureReason(null, new Error("https://discord.com/api/webhooks/123/SECRET"))).not.toContain("SECRET");
});
