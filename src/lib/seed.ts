/**
 * Fictional demo data so the UI can be explored without GitHub/Bitbucket credentials.
 * Three people appear on both platforms under separate records, so the admin
 * "merge developers" flow and the suggested merges can be tried out.
 */
import { randomUUID } from "node:crypto";
import type { Store } from "./db";
import type { Activity, ActivityType, Identity, Platform, Repository } from "./types";

let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];

const PEOPLE = [
  { name: "Alex Rivera", user: "arivera", both: true, level: 1.6 },
  { name: "Sam Okafor", user: "sokafor", both: true, level: 1.3 },
  { name: "Priya Nair", user: "pnair", both: false, level: 1.5 },
  { name: "Jonas Weber", user: "jweber", both: false, level: 1.0 },
  { name: "Mei Tanaka", user: "mtanaka", both: true, level: 1.2 },
  { name: "Luca Bianchi", user: "lbianchi", both: false, level: 0.9 },
  { name: "Zoe Martin", user: "zmartin", both: false, level: 0.8 },
  { name: "Omar Haddad", user: "ohaddad", both: false, level: 0.7 },
  { name: "Ines Costa", user: "icosta", both: false, level: 1.1 },
  { name: "Tomás Silva", user: "tsilva", both: false, level: 0.5 },
  { name: "Hana Novak", user: "hnovak", both: false, level: 0.6 },
  { name: "Ravi Menon", user: "rmenon", both: false, level: 0.4 },
];

const REPOS: { platform: Platform; name: string; lang: string; weight: number }[] = [
  { platform: "github", name: "web-portal", lang: "TypeScript", weight: 5 },
  { platform: "github", name: "mobile-app", lang: "Kotlin", weight: 3 },
  { platform: "github", name: "infra-as-code", lang: "HCL", weight: 2 },
  { platform: "github", name: "design-system", lang: "TypeScript", weight: 2 },
  { platform: "bitbucket", name: "billing-service", lang: "Java", weight: 4 },
  { platform: "bitbucket", name: "data-pipeline", lang: "Python", weight: 3 },
  { platform: "bitbucket", name: "legacy-erp-adapter", lang: "C#", weight: 1 },
];

const TITLES = ["Fix flaky test", "Refactor auth flow", "Add pagination", "Bump dependencies", "Improve error handling", "Add caching layer", "Update docs", "Handle null case", "Optimise query", "Add retry logic"];

export async function seedDemoData(store: Store) {
  const now = Date.now();
  const DAY = 86_400_000;

  const repos: Repository[] = REPOS.map((r) => ({
    id: `${r.platform}:demo-${r.name}`,
    platform: r.platform,
    externalId: `demo-${r.name}`,
    owner: "demo-org",
    name: r.name,
    fullName: `demo-org/${r.name}`,
    url: `https://example.com/demo-org/${r.name}`,
    description: `Demo repository (${r.name})`,
    language: r.lang,
    isPrivate: false,
    archived: false,
    enabled: true,
    lastSyncedAt: new Date(),
  }));
  for (const r of repos) await store.upsertRepository(r);

  // Identities: "both" people get a separate developer record per platform.
  const idents: { identity: Identity; level: number }[] = [];
  for (const p of PEOPLE) {
    const platforms: Platform[] = p.both ? ["github", "bitbucket"] : [pick<Platform>(["github", "bitbucket"])];
    for (const platform of platforms) {
      const existing = await store.findIdentity(platform, `demo-${p.user}`);
      if (existing) {
        idents.push({ identity: existing, level: p.level });
        continue;
      }
      const developerId = randomUUID();
      await store.createDeveloper({ id: developerId, displayName: p.name, avatarUrl: null, hidden: false, createdAt: new Date() });
      const identity: Identity = {
        id: randomUUID(),
        developerId,
        platform,
        externalId: `demo-${p.user}`,
        username: p.user,
        displayName: p.name,
        avatarUrl: null,
        email: p.both ? `${p.user}@example.com` : null,
      };
      await store.createIdentity(identity);
      idents.push({ identity, level: p.both ? p.level / 2 : p.level });
    }
  }

  const acts: Activity[] = [];
  let n = 0;
  for (let d = 0; d < 150; d++) {
    const date = new Date(now - d * DAY);
    const weekday = date.getUTCDay();
    if (weekday === 0 || weekday === 6) if (rnd() > 0.12) continue;
    for (const { identity, level } of idents) {
      if (rnd() > 0.55 * Math.min(level, 1.4) + 0.1) continue;
      const pool = repos.filter((r) => r.platform === identity.platform);
      const repo = pick(pool.flatMap((r) => Array(REPOS.find((x) => x.name === r.name)!.weight).fill(r)));
      const add = (type: ActivityType, count: number, extra: Partial<Activity> = {}) => {
        for (let i = 0; i < count; i++) {
          acts.push({
            id: `${repo.id}:demo:${n++}`,
            identityId: identity.id,
            repoId: repo.id,
            type,
            occurredAt: new Date(date.getTime() + Math.floor(rnd() * 10 + 8) * 3600_000),
            additions: 0,
            deletions: 0,
            title: pick(TITLES),
            url: null,
            ...extra,
          });
        }
      };
      add("commit", 1 + Math.floor(rnd() * 4 * level));
      if (rnd() < 0.35) add("pr_opened", 1);
      if (rnd() < 0.25) add("pr_merged", 1, { additions: Math.floor(rnd() * 400) + 5, deletions: Math.floor(rnd() * 150) });
      if (rnd() < 0.4 * level) add("review", 1 + Math.floor(rnd() * 2));
      if (rnd() < 0.3) add("comment", 1 + Math.floor(rnd() * 3), { title: null });
    }
  }
  await store.upsertActivities(acts);
  return { repos: repos.length, accounts: idents.length, activities: acts.length };
}
