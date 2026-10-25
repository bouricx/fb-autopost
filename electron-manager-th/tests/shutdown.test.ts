import { expect, it, vi } from "vitest";
import { createQuitHandler } from "../electron/core/shutdown";
it("prevents quit synchronously, cleans up once, then allows the second quit", async () => {
  let finish!: () => void;
  const cleanup = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const quit = vi.fn(), error = vi.fn(), event = { preventDefault: vi.fn() };
  const handle = createQuitHandler(cleanup, quit, error);
  const pending = handle(event); expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(handle(event)).toBe(pending); await Promise.resolve(); expect(cleanup).toHaveBeenCalledOnce(); expect(quit).not.toHaveBeenCalled();
  finish(); await pending; expect(quit).toHaveBeenCalledOnce(); expect(error).not.toHaveBeenCalled();
  const second = { preventDefault: vi.fn() }; expect(handle(second)).toBeUndefined(); expect(second.preventDefault).not.toHaveBeenCalled();
});
it("keeps the app alive after cleanup failure and permits another exit attempt", async () => {
  const cleanup = vi.fn().mockRejectedValueOnce(new Error("locked")).mockResolvedValueOnce(undefined);
  const quit = vi.fn(), error = vi.fn(); const handle = createQuitHandler(cleanup, quit, error);
  await handle({ preventDefault() {} }); expect(error).toHaveBeenCalledOnce(); expect(quit).not.toHaveBeenCalled();
  await handle({ preventDefault() {} }); expect(quit).toHaveBeenCalledOnce();
});
