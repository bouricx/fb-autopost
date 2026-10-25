import { describe, expect, it } from "vitest";
import { renderTemplate } from "../electron/core/template";

describe("renderTemplate", () => {
  it("replaces random choices deterministically", () => {
    expect(renderTemplate("สินค้า {random:A|B|C}", new Date("2026-01-01T12:00:00Z"), () => 0.5)).toBe("สินค้า B");
  });

  it("leaves ordinary braces untouched", () => {
    expect(renderTemplate("ราคา {amount}", new Date(), () => 0)).toBe("ราคา {amount}");
  });
  it("supports AutoPostPro bracket placeholders without altering ordinary content", () => {
    expect(renderTemplate("[date] [time] #[rand]", new Date("2026-01-01T12:00:00Z"), () => 0))
      .toBe("2026-01-01 19:00:00 #1000");
  });
});
