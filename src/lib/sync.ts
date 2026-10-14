import { randomUUID } from "node:crypto";
import { configuredPlatforms, syncConfig } from "./config";
import { getStore, type Store } from "./db";
import { clearStatsCache } from "./stats";
import type { Provider, RemoteActor, RemoteRepo } from "./providers/types";
import type { Activity, Developer, Identity, Platform, Repository, SyncRun } from "./types";

const DAY = 86_400_000;
const g = globalThis as unknown as { __devpulseSyncing?: boolean };

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
        if (a.username && a.username !== found.username) patch.username = a.username;
      }
      if (a.email && !found.email) patch.email = a.email;
      if (Object.keys(patch).length) {
        await this.store.updateIdentityProfile(found.id, patch);
        found = { ...found, ...patch };
        this.index(found);
      }
      return found;
    }

    const developer: Developer = {
      id: randomUUID(),
      displayName: a.displayName,
      avatarUrl: a.avatarUrl,
      hidden: false,
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

export async function runSync(trigger: SyncRun["trigger"], opts: SyncOptions = {}): Promise<SyncRun> {
  const store = await getStore();
  if (g.__devpulseSyncing) throw new Error("A sync is already running.");
  g.__devpulseSyncing = true;

  // Runs left "running" by a crashed process can never finish.
  for (const r of await store.listSyncRuns(5)) {
    if (r.status === "running") {
      await store.updateSyncRun(r.id, { status: "failed", finishedAt: new Date(), errors: [...r.errors, "Interrupted (process restarted)"] });
    }
  }

  const run: SyncRun = { id: randomUUID(), startedAt: new Date(), finishedAt: null, status: "running", trigger, repos: 0, activities: 0, errors: [] };
  await store.createSyncRun(run);

  try {
    let providers = await buildProviders();
    if (opts.repoIds?.length) {
      const wanted = new Set(opts.repoIds.map((id) => id.split(":")[0]));
      providers = providers.filter((p) => wanted.has(p.platform));
    }
    if (providers.length === 0) run.errors.push("No platform configured (set GitHub and/or Bitbucket credentials).");
    const lookbackDays = opts.lookbackDays ?? syncConfig().lookbackDays;
    const resolver = new IdentityResolver(store, await store.listIdentities());

    for (const provider of providers) {
      let remote: RemoteRepo[];
      try {
        remote = await provider.listRepos();
      } catch (e) {
        run.errors.push(`${provider.platform}: listing repositories failed - ${(e as Error).message}`);
        continue;
      }
      for (const r of remote) {
        const repo: Repository = {
          id: `${provider.platform}:${r.externalId}`,
          platform: provider.platform,
          ...r,
          enabled: true,
          lastSyncedAt: null,
        };
        await store.upsertRepository(repo);
      }
      if (opts.discoverOnly) {
        run.repos += remote.length;
        continue;
      }
      const known = (await store.listRepositories()).filter(
        (r) => r.platform === provider.platform && r.enabled && (!opts.repoIds || opts.repoIds.includes(r.id)),
      );
      const remoteById = new Map(remote.map((r) => [`${provider.platform}:${r.externalId}`, r]));

      for (const repo of known) {
        const rr = remoteById.get(repo.id);
        if (!rr) continue; // no longer visible to the token
        const startedAt = new Date();
        // Re-read a 2-day overlap so late-arriving reviews/merges are not missed.
        const since = repo.lastSyncedAt && !opts.full ? new Date(repo.lastSyncedAt.getTime() - 2 * DAY) : new Date(Date.now() - lookbackDays * DAY);
        try {
          const items = await provider.fetchActivities(rr, since);
          const activities: Activity[] = [];
          for (const it of items) {
            const identity = await resolver.resolve(provider.platform, it.actor);
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
          await store.upsertActivities(activities);
          await store.markRepositorySynced(repo.id, startedAt);
          run.activities += activities.length;
          run.repos += 1;
        } catch (e) {
          run.errors.push(`${repo.fullName}: ${(e as Error).message}`);
        }
        await store.updateSyncRun(run.id, { repos: run.repos, activities: run.activities });
      }
    }
    run.status = run.errors.length === 0 ? "success" : run.repos > 0 ? "partial" : "failed";
  } catch (e) {
    run.errors.push((e as Error).message);
    run.status = "failed";
  } finally {
    run.finishedAt = new Date();
    await store.updateSyncRun(run.id, { status: run.status, finishedAt: run.finishedAt, repos: run.repos, activities: run.activities, errors: run.errors.slice(0, 50) });
    clearStatsCache();
    g.__devpulseSyncing = false;
  }
  return run;
}
