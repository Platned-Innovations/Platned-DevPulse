import { throwIfCancelled } from "../cancel";

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
    message: string,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET JSON with retry on rate limits / transient errors. Returns body + headers. */
export async function getJson<T>(
  url: string,
  headers: Record<string, string>,
  attempt = 0,
): Promise<{ data: T; headers: Headers }> {
  throwIfCancelled();
  const res = await fetch(url, { headers, cache: "no-store" });
  if (res.ok) return { data: (await res.json()) as T, headers: res.headers };

  const retryable = res.status === 429 || res.status >= 500 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0");
  if (retryable && attempt < 3) {
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    const retryAfter = Number(res.headers.get("retry-after"));
    let wait = 1000 * 2 ** attempt;
    if (retryAfter) wait = retryAfter * 1000;
    else if (reset) wait = Math.max(wait, reset * 1000 - Date.now() + 1000);
    // Never block a sync for more than a minute on one request; fail instead.
    if (wait <= 60_000) {
      await sleep(wait);
      return getJson<T>(url, headers, attempt + 1);
    }
  }
  const body = (await res.text()).slice(0, 200);
  throw new HttpError(res.status, url, `HTTP ${res.status} for ${url.split("?")[0]}: ${body}`);
}

/** Run async tasks with bounded parallelism. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        throwIfCancelled();
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}
