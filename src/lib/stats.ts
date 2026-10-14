import { getStore } from "./db";
import { effectiveAvatar } from "./avatar";
import { configuredPlatforms } from "./config";
import { dayKey, previousRange, resolveRange, type PeriodKey, type Range } from "./periods";
import { DEFAULT_WEIGHTS } from "./scoring";
import {
  ACTIVITY_TYPES,
  type Activity,
  type ActivityType,
  type Developer,
  type Identity,
  type Platform,
  type Repository,
  type ScoreWeights,
} from "./types";

const DAY = 86_400_000;
const TTL_MS = 60_000;

/* ----------------------------- caching ----------------------------- */

const g = globalThis as unknown as {
  __dpCtx?: { at: number; value: Ctx };
  __dpActs?: Map<string, { at: number; value: Fact[] }>;
};

export function clearStatsCache() {
  g.__dpCtx = undefined;
  g.__dpActs = undefined;
}

/* ------------------------------ context ---------------------------- */

interface Ctx {
  developers: Map<string, Developer>;
  identities: Map<string, Identity>;
  repos: Map<string, Repository>;
  weights: ScoreWeights;
}

export async function getWeights(): Promise<ScoreWeights> {
  const store = await getStore();
  const saved = await store.getSetting<Partial<ScoreWeights>>("weights");
  return { ...DEFAULT_WEIGHTS, ...(saved ?? {}) };
}

async function loadCtx(): Promise<Ctx> {
  if (g.__dpCtx && Date.now() - g.__dpCtx.at < TTL_MS) return g.__dpCtx.value;
  const store = await getStore();
  const [devs, idents, repos, weights] = await Promise.all([
    store.listDevelopers(),
    store.listIdentities(),
    store.listRepositories(),
    getWeights(),
  ]);
  const value: Ctx = {
    developers: new Map(devs.map((d) => [d.id, { ...d, avatarUrl: effectiveAvatar(d, idents.filter((i) => i.developerId === d.id)) }])),
    identities: new Map(idents.map((i) => [i.id, i])),
    repos: new Map(repos.map((r) => [r.id, r])),
    weights,
  };
  g.__dpCtx = { at: Date.now(), value };
  return value;
}

/** An activity resolved to its (possibly merged) developer. */
export interface Fact {
  developerId: string;
  platform: Platform;
  repoId: string;
  type: ActivityType;
  at: number;
  additions: number;
  deletions: number;
  title: string | null;
  url: string | null;
}

async function loadFacts(from: Date, to: Date): Promise<Fact[]> {
  const ctx = await loadCtx();
  const cacheKey = `${from.getTime()}-${to.getTime()}`;
  g.__dpActs ??= new Map();
  const hit = g.__dpActs.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const store = await getStore();
  const acts: Activity[] = await store.queryActivities({ from, to });
  const facts: Fact[] = [];
  for (const a of acts) {
    const repo = ctx.repos.get(a.repoId);
    const ident = ctx.identities.get(a.identityId);
    if (!repo || !repo.enabled || !ident) continue;
    const dev = ctx.developers.get(ident.developerId);
    if (!dev || dev.hidden) continue;
    facts.push({
      developerId: dev.id,
      platform: repo.platform,
      repoId: repo.id,
      type: a.type,
      at: a.occurredAt.getTime(),
      additions: a.additions,
      deletions: a.deletions,
      title: a.title,
      url: a.url,
    });
  }
  if (g.__dpActs.size > 30) g.__dpActs.clear();
  g.__dpActs.set(cacheKey, { at: Date.now(), value: facts });
  return facts;
}

/* ------------------------------ filters ---------------------------- */

export interface Filters {
  period: PeriodKey;
  offset: number;
  platform?: Platform | null;
  repoId?: string | null;
}

function applyFilters(facts: Fact[], f: Pick<Filters, "platform" | "repoId">) {
  return facts.filter((x) => (!f.platform || x.platform === f.platform) && (!f.repoId || x.repoId === f.repoId));
}

/* ----------------------------- aggregates -------------------------- */

export type Counts = Record<ActivityType, number>;
const emptyCounts = (): Counts => ({ commit: 0, pr_opened: 0, pr_merged: 0, review: 0, comment: 0 });

interface Agg {
  counts: Counts;
  points: number;
  additions: number;
  deletions: number;
  repos: Set<string>;
  platforms: Set<Platform>;
  days: Set<string>;
  last: number;
}
const emptyAgg = (): Agg => ({ counts: emptyCounts(), points: 0, additions: 0, deletions: 0, repos: new Set(), platforms: new Set(), days: new Set(), last: 0 });

function add(a: Agg, f: Fact, w: ScoreWeights) {
  a.counts[f.type]++;
  a.points += w[f.type];
  if (f.type === "pr_merged") {
    a.additions += f.additions;
    a.deletions += f.deletions;
  }
  a.repos.add(f.repoId);
  a.platforms.add(f.platform);
  a.days.add(dayKey(new Date(f.at)));
  if (f.at > a.last) a.last = f.at;
}

function groupBy(facts: Fact[], key: (f: Fact) => string, w: ScoreWeights) {
  const m = new Map<string, Agg>();
  for (const f of facts) {
    const k = key(f);
    let a = m.get(k);
    if (!a) m.set(k, (a = emptyAgg()));
    add(a, f, w);
  }
  return m;
}

export function longestStreak(days: Iterable<string>): number {
  const sorted = [...new Set(days)].sort();
  let best = 0;
  let run = 0;
  let prev = 0;
  for (const d of sorted) {
    const t = Date.parse(d);
    run = prev && t - prev === DAY ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return best;
}

export interface SeriesPoint {
  date: string;
  points: number;
  count: number;
}

/** Points per bucket across [from, to). Buckets widen so a series never exceeds ~70 points. */
function series(facts: Fact[], from: Date, to: Date, w: ScoreWeights): SeriesPoint[] {
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY));
  const bucket = Math.max(1, Math.ceil(days / 70));
  const n = Math.ceil(days / bucket);
  const out: SeriesPoint[] = Array.from({ length: n }, (_, i) => ({
    date: dayKey(new Date(from.getTime() + i * bucket * DAY)),
    points: 0,
    count: 0,
  }));
  for (const f of facts) {
    const i = Math.floor((f.at - from.getTime()) / (bucket * DAY));
    if (i >= 0 && i < n) {
      out[i].points += w[f.type];
      out[i].count++;
    }
  }
  return out;
}

/** For "all time" ranges, start at the first activity instead of 1970. */
function effectiveRange(r: Range, facts: Fact[]): { from: Date; to: Date } {
  if (r.key !== "all") return { from: r.from, to: r.to };
  const first = facts.reduce((m, f) => Math.min(m, f.at), Date.now());
  const from = new Date(Math.floor(first / DAY) * DAY);
  return { from, to: new Date(Math.floor(Date.now() / DAY) * DAY + DAY) };
}

/* ---------------------------- leaderboard -------------------------- */

export interface LeaderboardRow {
  rank: number;
  developerId: string;
  name: string;
  avatarUrl: string | null;
  platforms: Platform[];
  counts: Counts;
  points: number;
  additions: number;
  deletions: number;
  repoCount: number;
  activeDays: number;
  streak: number;
  previousPoints: number | null;
  previousRank: number | null;
  series: SeriesPoint[];
}

export interface Leaderboard {
  range: Range;
  rows: LeaderboardRow[];
  totals: { points: number; counts: Counts; developers: number; repos: number; additions: number; deletions: number };
  previousTotals: { points: number; developers: number; commits: number; merged: number; reviews: number } | null;
}

function rank<T extends { points: number }>(items: T[]): (T & { rank: number })[] {
  const sorted = [...items].sort((a, b) => b.points - a.points);
  let last = -1;
  let lastRank = 0;
  return sorted.map((it, i) => {
    if (it.points !== last) {
      lastRank = i + 1;
      last = it.points;
    }
    return { ...it, rank: lastRank };
  });
}

export async function getLeaderboard(f: Filters): Promise<Leaderboard> {
  const ctx = await loadCtx();
  const range = resolveRange(f.period, f.offset);
  const prev = previousRange(range);
  const [raw, prevRaw] = await Promise.all([loadFacts(range.from, range.to), prev ? loadFacts(prev.from, prev.to) : Promise.resolve([])]);
  const facts = applyFilters(raw, f);
  const prevFacts = applyFilters(prevRaw, f);
  const w = ctx.weights;
  const eff = effectiveRange(range, facts);

  const groups = groupBy(facts, (x) => x.developerId, w);
  const prevGroups = groupBy(prevFacts, (x) => x.developerId, w);
  const prevRanked = new Map(rank([...prevGroups].map(([id, a]) => ({ id, points: a.points }))).map((r) => [r.id, r]));

  const byDev = new Map<string, Fact[]>();
  for (const x of facts) (byDev.get(x.developerId) ?? byDev.set(x.developerId, []).get(x.developerId)!).push(x);

  const rows = rank(
    [...groups].map(([id, a]) => ({
      developerId: id,
      name: ctx.developers.get(id)?.displayName ?? "Unknown",
      avatarUrl: ctx.developers.get(id)?.avatarUrl ?? null,
      platforms: [...a.platforms],
      counts: a.counts,
      points: a.points,
      additions: a.additions,
      deletions: a.deletions,
      repoCount: a.repos.size,
      activeDays: a.days.size,
      streak: longestStreak(a.days),
      previousPoints: prev ? (prevGroups.get(id)?.points ?? 0) : null,
      previousRank: prevRanked.get(id)?.rank ?? null,
      series: series(byDev.get(id) ?? [], eff.from, eff.to, w),
    })),
  ).map((r) => r);

  const totals = emptyAgg();
  for (const x of facts) add(totals, x, w);
  const pt = emptyAgg();
  for (const x of prevFacts) add(pt, x, w);

  return {
    range,
    rows,
    totals: { points: totals.points, counts: totals.counts, developers: rows.length, repos: totals.repos.size, additions: totals.additions, deletions: totals.deletions },
    previousTotals: prev ? { points: pt.points, developers: prevGroups.size, commits: pt.counts.commit, merged: pt.counts.pr_merged, reviews: pt.counts.review } : null,
  };
}

/* ------------------------------ projects --------------------------- */

export interface ProjectRow {
  rank: number;
  repo: Repository;
  counts: Counts;
  points: number;
  additions: number;
  deletions: number;
  contributors: number;
  topContributor: { id: string; name: string; share: number } | null;
  lastActivity: number | null;
  previousPoints: number | null;
  series: SeriesPoint[];
}

export async function getProjectRankings(f: Filters): Promise<{ range: Range; rows: ProjectRow[] }> {
  const ctx = await loadCtx();
  const range = resolveRange(f.period, f.offset);
  const prev = previousRange(range);
  const [raw, prevRaw] = await Promise.all([loadFacts(range.from, range.to), prev ? loadFacts(prev.from, prev.to) : Promise.resolve([])]);
  const facts = applyFilters(raw, f);
  const w = ctx.weights;
  const eff = effectiveRange(range, facts);
  const groups = groupBy(facts, (x) => x.repoId, w);
  const prevGroups = groupBy(applyFilters(prevRaw, f), (x) => x.repoId, w);

  const rows = rank(
    [...groups].flatMap(([id, a]) => {
      const repo = ctx.repos.get(id);
      if (!repo) return [];
      const repoFacts = facts.filter((x) => x.repoId === id);
      const perDev = groupBy(repoFacts, (x) => x.developerId, w);
      const top = [...perDev].sort((x, y) => y[1].points - x[1].points)[0];
      return [
        {
          repo,
          counts: a.counts,
          points: a.points,
          additions: a.additions,
          deletions: a.deletions,
          contributors: perDev.size,
          topContributor: top ? { id: top[0], name: ctx.developers.get(top[0])?.displayName ?? "Unknown", share: a.points ? top[1].points / a.points : 0 } : null,
          lastActivity: a.last,
          previousPoints: prev ? (prevGroups.get(id)?.points ?? 0) : null,
          series: series(repoFacts, eff.from, eff.to, w),
        },
      ];
    }),
  );
  return { range, rows };
}

export async function getProjectDetail(repoId: string, f: Filters) {
  const ctx = await loadCtx();
  const repo = ctx.repos.get(repoId);
  if (!repo) return null;
  const board = await getLeaderboard({ ...f, repoId });
  const facts = applyFilters(await loadFacts(board.range.from, board.range.to), { repoId });
  const eff = effectiveRange(board.range, facts);
  const s = series(facts, eff.from, eff.to, ctx.weights);
  const recent = facts
    .filter((x) => x.title)
    .sort((a, b) => b.at - a.at)
    .slice(0, 15)
    .map((x) => ({ ...x, developerName: ctx.developers.get(x.developerId)?.displayName ?? "Unknown" }));
  return { repo, board, series: s, recent };
}

/* ------------------------------ awards ----------------------------- */

export interface Award {
  key: string;
  icon: string;
  title: string;
  description: string;
  winner: { id: string; name: string; avatarUrl: string | null };
  value: string;
}

function computeAwards(rows: LeaderboardRow[], bothPlatforms: boolean): Award[] {
  const out: Award[] = [];
  const pick = (key: string, icon: string, title: string, description: string, score: (r: LeaderboardRow) => number, fmtVal: (n: number) => string, min = 1) => {
    let best: LeaderboardRow | null = null;
    let bestScore = 0;
    for (const r of rows) {
      const s = score(r);
      if (s > bestScore) (best = r), (bestScore = s);
    }
    if (best && bestScore >= min) {
      out.push({ key, icon, title, description, winner: { id: best.developerId, name: best.name, avatarUrl: best.avatarUrl }, value: fmtVal(bestScore) });
    }
  };
  pick("mvp", "🏆", "MVP", "Highest overall contribution score", (r) => r.points, (n) => `${n} pts`);
  pick("committer", "⌨️", "Commit King", "Most commits", (r) => r.counts.commit, (n) => `${n} commits`);
  pick("merger", "🔀", "Merge Master", "Most pull requests merged", (r) => r.counts.pr_merged, (n) => `${n} merged`);
  pick("reviewer", "👀", "Review Champion", "Most code reviews given", (r) => r.counts.review, (n) => `${n} reviews`);
  pick("lifter", "📦", "Heavy Lifter", "Most lines changed in merged PRs", (r) => r.additions + r.deletions, (n) => `${n.toLocaleString()} lines`);
  pick("streak", "🔥", "Streak Keeper", "Longest run of consecutive active days", (r) => r.streak, (n) => `${n} days`, 3);
  pick("explorer", "🧭", "Explorer", "Contributed to the most projects", (r) => r.repoCount, (n) => `${n} projects`, 2);
  pick("rising", "🚀", "Rising Star", "Biggest score increase versus the previous period", (r) => (r.previousPoints == null ? 0 : r.points - r.previousPoints), (n) => `+${n} pts`, 5);
  if (bothPlatforms) {
    pick("bridge", "🌉", "Bridge Builder", "Active on both GitHub and Bitbucket", (r) => (r.platforms.length > 1 ? r.points : 0), (n) => `${n} pts`);
  }
  return out;
}

/* ------------------------------ insights --------------------------- */

export interface Insights {
  range: Range;
  totals: Leaderboard["totals"];
  previousTotals: Leaderboard["previousTotals"];
  series: SeriesPoint[];
  weekday: { label: string; count: number }[];
  awards: Award[];
  activeProjects: ProjectRow[];
  trendingProjects: (ProjectRow & { delta: number })[];
  concentrationRisks: ProjectRow[];
  reviewRatio: number;
  platformSplit: { platform: Platform; points: number; commits: number; merged: number; reviews: number }[];
}

export async function getInsights(f: Filters): Promise<Insights> {
  const ctx = await loadCtx();
  const [board, projects] = await Promise.all([getLeaderboard(f), getProjectRankings(f)]);
  const facts = applyFilters(await loadFacts(board.range.from, board.range.to), f);
  const eff = effectiveRange(board.range, facts);
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const weekday = days.map((label) => ({ label, count: 0 }));
  for (const x of facts) weekday[(new Date(x.at).getUTCDay() + 6) % 7].count++;

  const split = (["github", "bitbucket"] as Platform[])
    .map((p) => {
      const a = emptyAgg();
      for (const x of facts) if (x.platform === p) add(a, x, ctx.weights);
      return { platform: p, points: a.points, commits: a.counts.commit, merged: a.counts.pr_merged, reviews: a.counts.review };
    })
    .filter((s) => s.points > 0);

  const trending = projects.rows
    .filter((p) => p.previousPoints != null)
    .map((p) => ({ ...p, delta: p.points - (p.previousPoints ?? 0) }))
    .filter((p) => p.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 5);

  return {
    range: board.range,
    totals: board.totals,
    previousTotals: board.previousTotals,
    series: series(facts, eff.from, eff.to, ctx.weights),
    weekday,
    awards: computeAwards(board.rows, configuredPlatforms().length > 1),
    activeProjects: projects.rows.slice(0, 5),
    trendingProjects: trending,
    // Single-person dependency: one contributor owns >=70% of a project's activity.
    concentrationRisks: projects.rows.filter((p) => p.contributors >= 1 && p.points >= 20 && (p.topContributor?.share ?? 0) >= 0.7).slice(0, 6),
    reviewRatio: board.totals.counts.pr_opened ? board.totals.counts.review / board.totals.counts.pr_opened : 0,
    platformSplit: split,
  };
}

/* ----------------------------- developer --------------------------- */

const MILESTONES: { key: string; icon: string; title: string; type: ActivityType; step: number[] }[] = [
  { key: "commits", icon: "⌨️", title: "Commits", type: "commit", step: [100, 500, 1000, 5000] },
  { key: "merged", icon: "🔀", title: "PRs merged", type: "pr_merged", step: [10, 50, 100, 500] },
  { key: "reviews", icon: "👀", title: "Reviews", type: "review", step: [25, 100, 500, 1000] },
];

export async function getDeveloperProfile(id: string, f: Filters) {
  const ctx = await loadCtx();
  const dev = ctx.developers.get(id);
  if (!dev) return null;
  const board = await getLeaderboard(f);
  const row = board.rows.find((r) => r.developerId === id) ?? null;
  const awards = computeAwards(board.rows, configuredPlatforms().length > 1).filter((a) => a.winner.id === id);

  // All-time facts drive the heatmap, lifetime totals and milestones.
  const all = (await loadFacts(new Date(0), new Date(Date.now() + DAY))).filter((x) => x.developerId === id);
  const w = ctx.weights;
  const lifetime = emptyAgg();
  for (const x of all) add(lifetime, x, w);

  const yearAgo = Date.now() - 364 * DAY;
  const heat = new Map<string, number>();
  for (const x of all) if (x.at >= yearAgo) heat.set(dayKey(new Date(x.at)), (heat.get(dayKey(new Date(x.at))) ?? 0) + w[x.type]);

  const inRange = all.filter((x) => x.at >= board.range.from.getTime() && x.at < board.range.to.getTime() && (!f.platform || x.platform === f.platform));
  const perRepo = [...groupBy(inRange, (x) => x.repoId, w)]
    .map(([repoId, a]) => ({ repo: ctx.repos.get(repoId)!, points: a.points, counts: a.counts }))
    .filter((r) => r.repo)
    .sort((a, b) => b.points - a.points);
  const perPlatform = [...groupBy(inRange, (x) => x.platform, w)].map(([p, a]) => ({ platform: p as Platform, points: a.points, counts: a.counts }));

  const milestones = MILESTONES.flatMap((m) => {
    const n = lifetime.counts[m.type];
    const reached = m.step.filter((s) => n >= s).pop();
    return reached ? [{ key: m.key, icon: m.icon, title: `${reached.toLocaleString()}+ ${m.title}`, progress: n }] : [];
  });

  const eff = effectiveRange(board.range, inRange);
  return {
    developer: dev,
    identities: [...ctx.identities.values()].filter((i) => i.developerId === id),
    range: board.range,
    row,
    totalDevelopers: board.rows.length,
    awards,
    milestones,
    lifetime: { counts: lifetime.counts, points: lifetime.points, activeDays: lifetime.days.size, streak: longestStreak(lifetime.days), repos: lifetime.repos.size, additions: lifetime.additions, deletions: lifetime.deletions },
    heat: [...heat].map(([date, points]) => ({ date, points })),
    series: series(inRange, eff.from, eff.to, w),
    perRepo,
    perPlatform,
    recent: inRange
      .filter((x) => x.title)
      .sort((a, b) => b.at - a.at)
      .slice(0, 15)
      .map((x) => ({ ...x, repoName: ctx.repos.get(x.repoId)?.fullName ?? "" })),
  };
}

/* ------------------------------ lookups ---------------------------- */

/** Date from which every enabled repository has been synced (history before it is incomplete). */
export async function getHistoryStart(): Promise<Date | null> {
  const ctx = await loadCtx();
  const coverage = (await (await getStore()).getSetting<Record<string, string>>("coverage")) ?? {};
  const starts = [...ctx.repos.values()].filter((r) => r.enabled).map((r) => coverage[r.id]).filter(Boolean);
  return starts.length ? new Date(starts.sort().at(-1)!) : null;
}

export async function getFilterOptions() {
  const ctx = await loadCtx();
  return {
    repos: [...ctx.repos.values()].filter((r) => r.enabled).sort((a, b) => a.fullName.localeCompare(b.fullName)),
    platforms: [...new Set([...ctx.repos.values()].map((r) => r.platform))] as Platform[],
  };
}

export const typeList = ACTIVITY_TYPES;
