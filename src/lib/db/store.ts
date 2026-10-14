import type {
  Activity,
  ActivityFilter,
  Developer,
  Identity,
  Repository,
  SyncRun,
} from "../types";

/** Storage contract implemented by both the PostgreSQL and MongoDB backends. */
export interface Store {
  readonly kind: "postgres" | "mongodb";
  init(): Promise<void>;
  close(): Promise<void>;

  listDevelopers(): Promise<Developer[]>;
  createDeveloper(d: Developer): Promise<void>;
  updateDeveloper(id: string, patch: Partial<Pick<Developer, "displayName" | "avatarUrl" | "hidden" | "primaryIdentityId">>): Promise<void>;
  deleteDeveloper(id: string): Promise<void>;

  listIdentities(): Promise<Identity[]>;
  findIdentity(platform: string, externalId: string): Promise<Identity | null>;
  createIdentity(i: Identity): Promise<void>;
  updateIdentityProfile(id: string, patch: Partial<Pick<Identity, "username" | "displayName" | "avatarUrl" | "email">>): Promise<void>;
  setIdentityDeveloper(identityId: string, developerId: string): Promise<void>;

  listRepositories(): Promise<Repository[]>;
  upsertRepository(r: Repository): Promise<void>;
  setRepositoryEnabled(id: string, enabled: boolean): Promise<void>;
  markRepositorySynced(id: string, at: Date): Promise<void>;

  /** True when no activity has ever been stored (fresh database). */
  isEmpty(): Promise<boolean>;
  upsertActivities(items: Activity[]): Promise<void>;
  queryActivities(filter: ActivityFilter): Promise<Activity[]>;
  /** Ids of identities that have at least one activity in the given repositories. */
  listIdentityIdsWithActivity(repoIds: string[]): Promise<string[]>;

  getSetting<T>(key: string): Promise<T | null>;
  setSetting(key: string, value: unknown): Promise<void>;

  createSyncRun(r: SyncRun): Promise<void>;
  updateSyncRun(id: string, patch: Partial<SyncRun>): Promise<void>;
  listSyncRuns(limit: number): Promise<SyncRun[]>;
}
