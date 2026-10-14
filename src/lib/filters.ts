import { parseOffset, parsePeriod } from "./periods";
import type { Filters } from "./stats";

export type SearchParams = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseFilters(sp: SearchParams): Filters {
  const platform = one(sp.platform);
  return {
    period: parsePeriod(one(sp.period)),
    offset: parseOffset(one(sp.offset)),
    platform: platform === "github" || platform === "bitbucket" ? platform : null,
    repoId: one(sp.repo) || null,
  };
}

/** Build a query string from filters, with overrides; omits defaults. */
export function qs(f: Partial<Filters>, extra: Record<string, string | null | undefined> = {}) {
  const p = new URLSearchParams();
  if (f.period && f.period !== "month") p.set("period", f.period);
  if (f.offset) p.set("offset", String(f.offset));
  if (f.platform) p.set("platform", f.platform);
  if (f.repoId) p.set("repo", f.repoId);
  for (const [k, v] of Object.entries(extra)) {
    if (v) p.set(k, v);
    else p.delete(k);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}
