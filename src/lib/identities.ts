import { randomUUID } from "node:crypto";
import { getStore } from "./db";
import { effectiveAvatar } from "./avatar";
import { clearStatsCache } from "./stats";
import type { Developer, Identity } from "./types";

export interface DeveloperWithIdentities {
  developer: Developer;
  identities: Identity[];
}

/**
 * Developers for the admin screens. A developer is listed only if at least one of their
 * accounts has activity in an enabled repository, so people who appear solely in disabled
 * repositories are left out. (Developers hidden from rankings are still listed so they can be unhidden.)
 */
export async function listDevelopersWithIdentities(): Promise<DeveloperWithIdentities[]> {
  const store = await getStore();
  const enabledRepoIds = (await store.listRepositories()).filter((r) => r.enabled).map((r) => r.id);
  const [devs, allIdents, activeIds] = await Promise.all([store.listDevelopers(), store.listIdentities(), store.listIdentityIdsWithActivity(enabledRepoIds)]);
  const active = new Set(activeIds);
  const visibleDevs = new Set(allIdents.filter((i) => active.has(i.id)).map((i) => i.developerId));
  const idents = allIdents.filter((i) => visibleDevs.has(i.developerId));
  const by = new Map<string, Identity[]>();
  for (const i of idents) (by.get(i.developerId) ?? by.set(i.developerId, []).get(i.developerId)!).push(i);
  return devs
    .map((d) => ({ developer: { ...d, avatarUrl: effectiveAvatar(d, by.get(d.id) ?? []) }, identities: by.get(d.id) ?? [] }))
    .filter((x) => x.identities.length > 0)
    .sort((a, b) => a.developer.displayName.localeCompare(b.developer.displayName));
}

/**
 * Merge `sourceId` into `targetId`. Activities reference identities (not developers),
 * so re-pointing the identities is enough: every past and future stat follows.
 */
export async function mergeDevelopers(targetId: string, sourceId: string) {
  if (targetId === sourceId) throw new Error("Choose two different developers.");
  const store = await getStore();
  const idents = await store.listIdentities();
  const devs = await store.listDevelopers();
  const target = devs.find((d) => d.id === targetId);
  if (!target || !devs.some((d) => d.id === sourceId)) throw new Error("Developer not found.");
  for (const i of idents.filter((x) => x.developerId === sourceId)) await store.setIdentityDeveloper(i.id, targetId);
  await store.deleteDeveloper(sourceId);
  clearStatsCache();
}

/** Split one linked account back out into its own developer. */
export async function unlinkIdentity(identityId: string) {
  const store = await getStore();
  const idents = await store.listIdentities();
  const ident = idents.find((i) => i.id === identityId);
  if (!ident) throw new Error("Account not found.");
  if (idents.filter((i) => i.developerId === ident.developerId).length < 2) throw new Error("A developer needs at least one account.");
  const dev: Developer = { id: randomUUID(), displayName: ident.displayName, avatarUrl: ident.avatarUrl, hidden: false, primaryIdentityId: null, createdAt: new Date() };
  await store.createDeveloper(dev);
  await store.setIdentityDeveloper(ident.id, dev.id);
  const oldDev = (await store.listDevelopers()).find((d) => d.id === ident.developerId);
  if (oldDev?.primaryIdentityId === ident.id) await store.updateDeveloper(oldDev.id, { primaryIdentityId: null });
  clearStatsCache();
}

export interface MergeSuggestion {
  a: DeveloperWithIdentities;
  b: DeveloperWithIdentities;
  reason: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Heuristic suggestions: same email, same username, or same full name across different developers. */
export function suggestMerges(devs: DeveloperWithIdentities[]): MergeSuggestion[] {
  const out: MergeSuggestion[] = [];
  const seen = new Set<string>();
  for (let x = 0; x < devs.length; x++) {
    for (let y = x + 1; y < devs.length; y++) {
      const A = devs[x];
      const B = devs[y];
      let reason: string | null = null;
      for (const ia of A.identities) {
        for (const ib of B.identities) {
          if (ia.email && ib.email && ia.email.toLowerCase() === ib.email.toLowerCase()) reason = `same email (${ia.email})`;
          else if (!reason && norm(ia.username).length > 2 && norm(ia.username) === norm(ib.username)) reason = `same username (${ia.username})`;
          else if (!reason && norm(ia.displayName).length > 4 && norm(ia.displayName) === norm(ib.displayName) && ia.displayName.includes(" ")) reason = `same name (${ia.displayName})`;
        }
      }
      const key = `${A.developer.id}|${B.developer.id}`;
      if (reason && !seen.has(key)) {
        seen.add(key);
        out.push({ a: A, b: B, reason });
      }
    }
  }
  return out.slice(0, 30);
}
