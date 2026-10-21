import { describe, expect, it } from "vitest";
import { parseCookies } from "../electron/accounts/cookie-parser";

describe("Cookie parser", () => {
  it("splits raw accounts without exposing values", () => {
    const results = parseCookies("c_user=123; xs=secret=a\nc_user=456; xs=other");
    expect(results.map(row => row.userId)).toEqual(["123", "456"]);
    expect(results[0].cookies[1].value).toBe("secret=a");
  });
  it("normalizes Cookie-Editor JSON", () => {
    const result = parseCookies(JSON.stringify([{ name: "c_user", value: "123" }, { name: "xs", value: "test", sameSite: "no_restriction" }]));
    expect(result[0].cookies[1]).toMatchObject({ sameSite: "None", secure: true, domain: ".facebook.com", expires: -1 });
  });
  it("supports Netscape HTTP-only cookies", () => {
    expect(parseCookies("# Netscape HTTP Cookie File\n.facebook.com\tTRUE\t/\tTRUE\t0\tc_user\t123\n#HttpOnly_.facebook.com\tTRUE\t/\tTRUE\t0\txs\ttest")[0].cookies[1].httpOnly).toBe(true);
  });
  it("rejects foreign domains and ambiguous identities", () => {
    expect(() => parseCookies('[{"name":"c_user","value":"123","domain":"evilfacebook.com"}]')).toThrow();
    expect(() => parseCookies("c_user=123; xs=secret; c_user=456")).toThrow();
  });
});
