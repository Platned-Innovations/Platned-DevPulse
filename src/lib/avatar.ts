import type { Developer, Identity } from "./types";

/**
 * Picture shown for a developer: the admin-chosen primary account's avatar, otherwise the
 * developer's own, otherwise any linked account that has one.
 */
export function effectiveAvatar(dev: Developer, identities: Identity[]): string | null {
  const primary = dev.primaryIdentityId ? identities.find((i) => i.id === dev.primaryIdentityId) : undefined;
  return primary?.avatarUrl ?? dev.avatarUrl ?? identities.find((i) => i.avatarUrl)?.avatarUrl ?? null;
}
