/** Runs a data loader, turning failures (usually "no database") into a value the page can render. */
export async function safe<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    console.error("[devpulse]", e);
    return { ok: false, error: (e as Error).message };
  }
}
