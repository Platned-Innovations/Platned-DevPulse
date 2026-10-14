/** Cooperative cancellation for the (single, in-process) running sync. */
const g = globalThis as unknown as { __devpulseCancel?: boolean };

export class SyncCancelled extends Error {
  constructor() {
    super("Stopped by admin");
  }
}

export const requestCancel = () => {
  g.__devpulseCancel = true;
};
export const resetCancel = () => {
  g.__devpulseCancel = false;
};
export const isCancelRequested = () => !!g.__devpulseCancel;
export const throwIfCancelled = () => {
  if (g.__devpulseCancel) throw new SyncCancelled();
};
