export type Platform = "github" | "bitbucket";

export type ActivityType =
  | "commit"
  | "pr_opened"
  | "pr_merged"
  | "review"
  | "comment";

export const ACTIVITY_TYPES: ActivityType[] = [
  "commit",
  "pr_opened",
  "pr_merged",
  "review",
  "comment",
];

export interface Developer {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  /** Hidden developers (bots, alumni) are excluded from every ranking. */
  hidden: boolean;
  createdAt: Date;
}

/** One account on one platform. Many identities can belong to one developer. */
export interface Identity {
  id: string;
  developerId: string;
  platform: Platform;
  /** Stable platform id (GitHub numeric id, Bitbucket account_id, or `email:<addr>`). */
  externalId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  email: string | null;
}

export interface Repository {
  id: string;
  platform: Platform;
  externalId: string;
  /** owner/workspace */
  owner: string;
  name: string;
  fullName: string;
  url: string;
  description: string | null;
  language: string | null;
  isPrivate: boolean;
  archived: boolean;
  /** Disabled repositories are skipped by sync and ignored in rankings. */
  enabled: boolean;
  lastSyncedAt: Date | null;
}

export interface Activity {
  /** Deterministic id => sync is idempotent. */
  id: string;
  identityId: string;
  repoId: string;
  type: ActivityType;
  occurredAt: Date;
  additions: number;
  deletions: number;
  title: string | null;
  url: string | null;
}

export interface SyncRun {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: "running" | "success" | "partial" | "failed";
  trigger: "manual" | "schedule";
  repos: number;
  activities: number;
  errors: string[];
}

export type ScoreWeights = Record<ActivityType, number>;

export interface ActivityFilter {
  from?: Date;
  to?: Date;
  repoIds?: string[];
}
