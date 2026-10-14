/** Runs a data loader, turning failures (usually "no database") into a value the page can render. */
export async function safe<T>(fn: () => Promise<T>): Promise<{ data: T; error?: undefined } | { data?: undefined; error: string }> {
  try {
    return { data: await fn() };
  } catch (e) {
    console.error("[devpulse]", e);
    return { error: (e as Error).message };
  }
}
