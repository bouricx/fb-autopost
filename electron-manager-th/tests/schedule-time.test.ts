import { expect, it } from "vitest";
import { bangkokDay, scheduleInstant } from "../src/shared/schedule";
it("converts Thai daily slots to UTC without relying on Windows timezone", () => {
  expect(scheduleInstant("2026-10-18", "16:00")).toBe("2026-10-18T09:00:00.000Z");
  expect(scheduleInstant("2026-10-18", "00:15")).toBe("2026-10-17T17:15:00.000Z");
  expect(bangkokDay(Date.parse("2026-10-17T18:00:00Z"))).toBe("2026-10-18");
  expect(() => scheduleInstant("2026-02-31", "16:00")).toThrow();
  expect(() => scheduleInstant("2026-10-18", "24:00")).toThrow();
});
