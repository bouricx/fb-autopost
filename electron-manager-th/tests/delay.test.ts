import { describe, expect, it } from "vitest";
import { delayMilliseconds, validateDelay } from "../src/shared/delay";
describe("account cooldown", () => {
  it("uses fixed values and inclusive randomized ranges", () => {
    expect(delayMilliseconds(60, 60)).toBe(60000);
    expect(delayMilliseconds(30, 90, () => 0)).toBe(30000);
    expect(delayMilliseconds(30, 90, () => 0.999999)).toBe(90000);
    expect(delayMilliseconds(0, 0)).toBe(0);
  });
  it("rejects inverted, fractional and invalid ranges", () => {
    expect(validateDelay(90, 30)).not.toBeNull();
    expect(validateDelay(-1, 10)).not.toBeNull();
    expect(validateDelay(0.5, 10)).not.toBeNull();
    expect(validateDelay(NaN, 10)).not.toBeNull();
    expect(validateDelay(0, 86401)).not.toBeNull();
  });
});
