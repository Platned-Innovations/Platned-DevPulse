import type { ActivityType, Platform } from "../types";

export interface RemoteRepo {
  externalId: string;
  owner: string;
  name: string;
  fullName: string;
  url: string;
  description: string | null;
  language: string | null;
  isPrivate: boolean;
  archived: boolean;
}

export interface RemoteActor {
  /** Stable id on the platform; `email:<addr>` when the commit author is not linked to an account. */
  externalId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  email: string | null;
}

export interface RemoteActivity {
  /** Unique within the repository, e.g. `commit:<sha>`. */
  key: string;
  actor: RemoteActor;
  type: ActivityType;
  occurredAt: Date;
  additions: number;
  deletions: number;
  title: string | null;
  url: string | null;
}

export interface Provider {
  readonly platform: Platform;
  listRepos(): Promise<RemoteRepo[]>;
  /** Activities that happened at or after `since`. Must be safe to call repeatedly (ids are deterministic). */
  fetchActivities(repo: RemoteRepo, since: Date): Promise<RemoteActivity[]>;
}
