import type { Repository } from "./types";

/** Branch preference when no branch has been chosen: development branches first, then production-like ones. */
export function branchPriority(): string[] {
  const v = process.env.BRANCH_PRIORITY?.split(",").map((s) => s.trim()).filter(Boolean);
  return v?.length ? v : ["develop", "dev", "development", "main", "master", "prod", "production"];
}

/** Branch picked automatically: first match from the priority list, else the repository's default branch. */
export function autoBranch(repo: Pick<Repository, "branches" | "defaultBranch">): string | null {
  const byLower = new Map(repo.branches.map((b) => [b.toLowerCase(), b]));
  for (const name of branchPriority()) {
    const hit = byLower.get(name.toLowerCase());
    if (hit) return hit;
  }
  return repo.defaultBranch;
}

/** The branch DevPulse reads for this repository: the admin's choice if it still exists, otherwise automatic. */
export function effectiveBranch(repo: Pick<Repository, "branches" | "defaultBranch" | "trackedBranch">): string | null {
  if (repo.trackedBranch && (repo.branches.length === 0 || repo.branches.includes(repo.trackedBranch))) return repo.trackedBranch;
  return autoBranch(repo);
}
