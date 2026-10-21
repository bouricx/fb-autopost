import { expect, it } from "vitest";
import { isProfileBusy, ProfileBusyError } from "../electron/core/errors";
it("recognizes Chrome profile contention without exposing launch arguments", () => {
  expect(isProfileBusy(new Error("browserType.launchPersistentContext: Opening in existing browser session. --user-data-dir=private"))).toBe(true);
  expect(isProfileBusy(new Error("The user data directory is already in use"))).toBe(true);
  expect(isProfileBusy(new Error("network timeout"))).toBe(false);
  const error = new ProfileBusyError();
  expect(error.message).toContain("ไม่ต้องนำเข้า Cookie ใหม่");
  expect(error.message).not.toContain("--user-data-dir");
});
