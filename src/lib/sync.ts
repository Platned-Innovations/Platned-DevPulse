import { randomUUID } from "node:crypto";
import { configuredPlatforms, syncConfig } from "./config";
import { getStore, type Store } from "./db";
import { effectiveBranch } from "./branches";
import { resetCancel, SyncCancelled, throwIfCancelled } from "./cancel";
import { clearStatsCache } from "./stats";
import { logEvent, resetLog, setNow } from "./synclog";
import type { Provider, RemoteActor, RemoteRepo } from "./providers/types";
import type { Activity, Developer, Identity, Platform, Repository, SyncRun } from "./types";

const DAY = 86_400_000;
const g = globalThis as unknown as { __devpulseSyncing?: boolean; __devpulseRunId?: string | null };

export function isSyncing() {
  return !!g.__devpulseSyncing;
}

async function buildProviders(): Promise<Provider[]> {
  const out: Provider[] = [];
  for (const p of configuredPlatforms()) {
    if (p === "github") out.push(new (await import("./providers/github")).GitHubProvider());
    else out.push(new (await import("./providers/bitbucket")).BitbucketProvider());
  }
  return out;
}

/** Maps platform accounts to developers, creating a developer for any account seen for the first time. */
class IdentityResolver {
  private byKey = new Map<string, Identity>();
  private byEmail = new Map<string, Identity>();

  constructor(
    private store: Store,
    existing: Identity[],
  ) {
    for (const i of existing) this.index(i);
  }

  private index(i: Identity) {
    this.byKey.set(`${i.platform}:${i.externalId}`, i);
    if (i.email) this.byEmail.set(`${i.platform}:${i.email.toLowerCase()}`, i);
  }

  async resolve(platform: Platform, a: RemoteActor): Promise<Identity> {
    const key = `${platform}:${a.externalId}`;
    let found = this.byKey.get(key);

    // An unlinked commit author (email only) may belong to a known account with that email.
    if (!found && a.email && a.externalId.startsWith("email:")) {
      found = this.byEmail.get(`${platform}:${a.email.toLowerCase()}`);
      if (found) this.byKey.set(key, found);
    }

    if (found) {
      const patch: Partial<Identity> = {};
      if (!a.externalId.startsWith("email:")) {
        if (a.avatarUrl && a.avatarUrl !== found.avatarUrl) patch.avatarUrl = a.avatarUrl;
        // Only trust names from full profiles (they carry an avatar); commit-derived ones may be stale.
        if (a.avatarUrl && a.username && a.username !== found.username) patch.username = a.username;
      }
      if (a.email && !found.email) patch.email = a.email;
      if (Object.keys(patch).length) {
        await this.store.updateIdentityProfile(found.id, patch);
        found = { ...found, ...patch };
        this.index(found);
      }
      return found;
    }

    // A new email-only author (for example a commit made with a GitHub noreply address on Bitbucket)
    // joins the developer that already owns that email or that GitHub account, rather than
    // becoming a duplicate person.
    if (a.externalId.startsWith("email:") && a.email) {
      const email = a.email.toLowerCase();
      const noreply = /^(\d+)\+[^@]+@users\.noreply\.github\.com$/i.exec(email);
      const owner =
        [...this.byKey.values()].find((i) => i.email?.toLowerCase() === email) ??
        (noreply ? this.byKey.get(`github:${noreply[1]}`) : undefined);
      if (owner) {
        const linked: Identity = {
          id: randomUUID(),
          developerId: owner.developerId,
          platform,
          externalId: a.externalId,
          username: a.username,
          displayName: a.displayName,
          avatarUrl: a.avatarUrl,
          email: a.email,
        };
        await this.store.createIdentity(linked);
        const persisted = (await this.store.findIdentity(platform, a.externalId)) ?? linked;
        this.index(persisted);
        return persisted;
      }
    }

    const developer: Developer = {
      id: randomUUID(),
      displayName: a.displayName,
      avatarUrl: a.avatarUrl,
      hidden: false,
      primaryIdentityId: null,
      createdAt: new Date(),
    };
    await this.store.createDeveloper(developer);
    const identity: Identity = {
      id: randomUUID(),
      developerId: developer.id,
      platform,
      externalId: a.externalId,
      username: a.username,
      displayName: a.displayName,
      avatarUrl: a.avatarUrl,
      email: a.email,
    };
    await this.store.createIdentity(identity);
    // createIdentity is a no-op on a race; re-read to get the persisted row.
    const persisted = (await this.store.findIdentity(platform, a.externalId)) ?? identity;
    if (persisted.id !== identity.id) await this.store.deleteDeveloper(developer.id);
    this.index(persisted);
    return persisted;
  }
}

/** Last resort for a sync that does not react to Stop: release the lock and close its history row. */
export async function forceStopSync(): Promise<void> {
  g.__devpulseRunId = null;
  g.__devpulseSyncing = false;
  const store = await getStore();
  for (const r of await store.listSyncRuns(10)) {
    if (r.status === "running") {
      await store.updateSyncRun(r.id, { status: "cancelled", finishedAt: new Date(), errors: [...r.errors, "Force-stopped by admin"] });
    }
  }
  clearStatsCache();
}

export interface SyncOptions {
  /** Only sync these repositories (ids like "github:123"). */
  repoIds?: string[];
  /** Ignore each repository's sync cursor and re-read the whole look-back window. */
  full?: boolean;
  /** Look-back window for full / first syncs (default SYNC_LOOKBACK_DAYS). */
  lookbackDays?: number;
  /** Only refresh the repository list; do not read activity. */
  discoverOnly?: boolean;
}

const windowLabel = (d: number) => (d >= 36_500 ? "all history" : d >= 365 && d % 365 === 0 ? `${d / 365} year${d === 365 ? "" : "s"}` : `${d} days`);

/** Window wording for a start date: "all history" or "90 days". */
const windowSince = (since: Date) => (since.getFullYear() < 1990 ? "all history" : windowLabel(Math.max(1, Math.round((Date.now() - since.getTime()) / DAY))));

function describeRun(opts: SyncOptions, lookbackDays: number): string {
  if (opts.discoverOnly) return "Discover repositories";
  const n = opts.repoIds?.length ?? 0;
  if (n > 0) return `${n === 1 ? "Single repository" : `${n} repositories`} · full re-sync · ${windowLabel(lookbackDays)}`;
  if (opts.full) return `Full re-sync · ${windowLabel(lookbackDays)}`;
  return "Incremental · new since last sync";
}

export async function runSync(trigger: SyncRun["trigger"], opts: SyncOptions = {}): Promise<SyncRun> {
  const store = await getStore();
  if (g.__devpulseSyncing) throw new Error("A sync is already running.");
  g.__devpulseSyncing = true;
  resetCancel();

  let run: SyncRun;
  try {
    // Runs left "running" by a crashed process can never finish.
    for (const r of await store.listSyncRuns(5)) {
      if (r.status === "running") {
        await store.updateSyncRun(r.id, { status: "failed", finishedAt: new Date(), errors: [...r.errors, "Interrupted (process restarted)"] });
      }
    }
    run = { id: randomUUID(), startedAt: new Date(), finishedAt: null, status: "running", trigger, label: describeRun(opts, opts.lookbackDays ?? syncConfig().lookbackDays), total: 0, repos: 0, activities: 0, errors: [] };
    await store.createSyncRun(run);
    g.__devpulseRunId = run.id;
  } catch (e) {
    g.__devpulseSyncing = false; // could not even start: do not leave the lock held
    throw e;
  }
  resetLog();
  logEvent(`Sync started: ${run.label} (${trigger === "schedule" ? "automatic" : "manual"})`);
  setNow("Starting…");

  try {
    let providers = await buildProviders();
    if (opts.repoIds?.length) {
      const wanted = new Set(opts.repoIds.map((id) => id.split(":")[0]));
      providers = providers.filter((p) => wanted.has(p.platform));
    }
    if (providers.length === 0) run.errors.push("No platform configured (set GitHub and/or Bitbucket credentials).");
    const lookbackDays = opts.lookbackDays ?? syncConfig().lookbackDays;
    const resolver = new IdentityResolver(store, await store.listIdentities());
    const coverage = (await store.getSetting<Record<string, string>>("coverage")) ?? {};
    const rereads: { reason: string; since: Date }[] = [];

    for (const provider of providers) {
      let remote: RemoteRepo[];
      const pname = provider.platform === "github" ? "GitHub" : "Bitbucket";
      try {
        setNow(`${pname}: listing repositories and branches…`);
        remote = await provider.listRepos();
        logEvent(`${pname}: found ${remote.length} repositories`);
      } catch (e) {
        if (e instanceof SyncCancelled) throw e;
        run.errors.push(`${provider.platform}: listing repositories failed - ${(e as Error).message}`);
        logEvent(`${pname}: listing repositories failed - ${(e as Error).message}`, "error");
        continue;
      }
      for (const r of remote) {
        const repo: Repository = {
          id: `${provider.platform}:${r.externalId}`,
          platform: provider.platform,
          ...r,
          trackedBranch: null,
          syncedBranch: null,
          enabled: true,
          lastSyncedAt: null,
        };
        await store.upsertRepository(repo);
      }
      if (opts.discoverOnly) {
        run.repos += remote.length;
        run.total = run.repos;
        await store.updateSyncRun(run.id, { repos: run.repos, total: run.total });
        continue;
      }
      const known = (await store.listRepositories()).filter(
        (r) => r.platform === provider.platform && r.enabled && (!opts.repoIds || opts.repoIds.includes(r.id)),
      );
      const remoteById = new Map(remote.map((r) => [`${provider.platform}:${r.externalId}`, r]));
      run.total += known.filter((r) => remoteById.has(r.id)).length;
      await store.updateSyncRun(run.id, { total: run.total });

      for (const repo of known) {
        throwIfCancelled();
        const rr = remoteById.get(repo.id);
        if (!rr) continue; // no longer visible to the token
        const startedAt = new Date();
        // Re-read a 2-day overlap so late-arriving reviews/merges are not missed.
        const branch = effectiveBranch(repo);
        // Activity read from a different branch before (or, for older data, from the default branch)
        // must be replaced, otherwise commits of the old branch would stay in the totals.
        const switched = repo.syncedBranch != null ? repo.syncedBranch !== branch : repo.lastSyncedAt != null && branch !== repo.defaultBranch;
        const full = !!opts.full || switched || !repo.lastSyncedAt;
        const firstRead = !repo.lastSyncedAt && !opts.full;
        const windowStart = new Date(Date.now() - lookbackDays * DAY);
        const since = switched
          ? new Date(Math.min(windowStart.getTime(), coverage[repo.id] ? Date.parse(coverage[repo.id]) : Infinity))
          : repo.lastSyncedAt && !opts.full
            ? new Date(repo.lastSyncedAt.getTime() - 2 * DAY)
            : windowStart;
        if (switched || firstRead) {
          // The run does more than its name says for this repository: tell the history table.
          rereads.push({ reason: switched ? "branch changed" : "first sync", since });
          const reasons = [...new Set(rereads.map((r) => r.reason))].join(", ");
          const widest = new Date(Math.min(...rereads.map((r) => r.since.getTime())));
          const label = `${run.label.split(" + ")[0]} + ${rereads.length} ${rereads.length === 1 ? "repository" : "repositories"} read in full (${reasons}, ${windowSince(widest)})`;
          if (label !== run.label) {
            run.label = label;
            await store.updateSyncRun(run.id, { label });
          }
        }
        const position = `[${run.repos + run.errors.length + 1}/${run.total}]`;
        logEvent(`${position} ${repo.fullName} · branch ${branch ?? "default"} · ${since.getFullYear() < 1990 ? "all history" : `since ${since.toISOString().slice(0, 10)}`}${switched ? " · branch changed, replacing stored data" : ""}`);
        setNow(`${repo.fullName}: starting`);
        try {
          const items = await provider.fetchActivities(rr, since, branch, (m) => {
            setNow(`${repo.fullName}: ${m}`);
            if (/^\d+ (commits|pull requests)/.test(m)) logEvent(`    ${m}`);
          });
          if (switched) await store.deleteActivitiesForRepo(repo.id);
          const activities: Activity[] = [];
          const counts: Record<string, number> = {};
          let shown = 0;
          for (const [n, it] of items.entries()) {
            if (n % 25 === 0) setNow(`${repo.fullName}: matching authors ${n}/${items.length}`);
            const identity = await resolver.resolve(provider.platform, it.actor);
            counts[it.type] = (counts[it.type] ?? 0) + 1;
            if (shown < 6 && (it.type === "commit" || it.type === "pr_merged")) {
              shown++;
              logEvent(`    ${it.type === "commit" ? "commit " + it.key.slice(7, 14) : "merged PR #" + it.key.slice(10)} · ${identity.displayName}${it.title ? ` · ${it.title.slice(0, 70)}` : ""}`);
            }
            activities.push({
              id: `${repo.id}:${it.key}`,
              identityId: identity.id,
              repoId: repo.id,
              type: it.type,
              occurredAt: it.occurredAt,
              additions: it.additions,
              deletions: it.deletions,
              title: it.title,
              url: it.url,
            });
          }
          setNow(`${repo.fullName}: saving ${activities.length} activities`);
          await store.upsertActivities(activities);
          logEvent(`    saved ${activities.length}: ${Object.entries(counts).map(([t, c]) => `${c} ${t.replace("_", " ")}`).join(", ") || "nothing new"}`, "ok");
          await store.markRepositorySynced(repo.id, startedAt);
          await store.setRepositorySyncedBranch(repo.id, branch);
          // Remember how far back this repository's history is complete.
          if (full && (!coverage[repo.id] || since.toISOString() < coverage[repo.id])) coverage[repo.id] = since.toISOString();
          run.activities += activities.length;
          run.repos += 1;
        } catch (e) {
          if (e instanceof SyncCancelled) throw e;
          run.errors.push(`${repo.fullName}: ${(e as Error).message}`);
          logEvent(`    failed: ${(e as Error).message}`, "error");
        }
        await store.updateSyncRun(run.id, { repos: run.repos, activities: run.activities, total: run.total });
        await store.setSetting("coverage", coverage); // keep progress even if the run is stopped later
      }
    }
    await store.setSetting("coverage", coverage);
    run.status = run.errors.length === 0 ? "success" : run.repos > 0 ? "partial" : "failed";
  } catch (e) {
    run.errors.push((e as Error).message);
    run.status = e instanceof SyncCancelled ? "cancelled" : "failed";
  } finally {
    run.finishedAt = new Date();
    resetCancel();
    setNow("");
    logEvent(`Sync ${run.status}: ${run.repos} repositories, ${run.activities} activities${run.errors.length ? `, ${run.errors.length} problem(s)` : ""}`, run.status === "success" ? "ok" : run.status === "failed" ? "error" : "warn");
    try {
      await store.updateSyncRun(run.id, { label: run.label, status: run.status, finishedAt: run.finishedAt, repos: run.repos, activities: run.activities, errors: run.errors.slice(0, 50) });
    } catch (e) {
      console.error("[devpulse] could not save the sync result:", (e as Error).message);
    }
    clearStatsCache();
    // Always released, otherwise Stop/Sync would stay blocked until restart. A force-stopped (zombie) run
    // must not release the lock of a newer run, hence the id check.
    if (g.__devpulseRunId === run.id) {
      g.__devpulseRunId = null;
      g.__devpulseSyncing = false;
    }
  }
  return run;
}
