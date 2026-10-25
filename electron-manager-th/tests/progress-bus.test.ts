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
it("a failed renderer observer cannot abort delivery or skip other observers",()=>{
 const bus=new ProgressBus(),next=vi.fn();bus.subscribe(()=>{throw new Error('window closed');});bus.subscribe(next);
 expect(()=>bus.publish({type:'target.succeeded',message:'fixture'})).not.toThrow();expect(next).toHaveBeenCalledOnce();
});
