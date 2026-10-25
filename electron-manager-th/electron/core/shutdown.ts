/** Electron does not await async event listeners. Hold quit until cleanup finishes. */
export function createQuitHandler(cleanup: () => Promise<void>, quit: () => void, onError: (error: unknown) => void) {
  let ready = false;
  let pending: Promise<void> | null = null;
  return (event: { preventDefault(): void }): Promise<void> | undefined => {
    if (ready) return;
    event.preventDefault();
    if (pending) return pending;
    pending = Promise.resolve().then(cleanup).then(() => {
      ready = true;
      quit();
    }).catch(error => { onError(error); }).finally(() => { pending = null; });
    return pending;
  };
}
