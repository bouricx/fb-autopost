import { expect, it, vi } from "vitest";
import { ProgressBus } from "../electron/core/progress-bus";

it("delivers timestamped events and unsubscribes cleanly", () => {
  const bus = new ProgressBus(), listener = vi.fn();
  const unsubscribe = bus.subscribe(listener);
  bus.publish({ type: "job.started", accountId: "account", message: "เริ่มงาน" });
  expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: "job.started", at: expect.any(String) }));
  unsubscribe(); bus.publish({ type: "job.completed", message: "จบงาน" });
  expect(listener).toHaveBeenCalledTimes(1);
});
