import { Pool } from "pg";
import type { Store } from "./store";
import type { Activity, ActivityFilter, Developer, Identity, Repository, SyncRun } from "../types";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS developers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  hidden BOOLEAN NOT NULL DEFAULT FALSE,
  primary_identity_id TEXT,
  created_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE developers ADD COLUMN IF NOT EXISTS primary_identity_id TEXT;
CREATE TABLE IF NOT EXISTS identities (
  id TEXT PRIMARY KEY,
  developer_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  external_id TEXT NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  email TEXT,
  UNIQUE (platform, external_id)
);
CREATE INDEX IF NOT EXISTS identities_dev_idx ON identities (developer_id);
CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  external_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT,
  language TEXT,
  is_private BOOLEAN NOT NULL DEFAULT FALSE,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_synced_at TIMESTAMPTZ,
  default_branch TEXT,
  branches JSONB NOT NULL DEFAULT '[]',
  tracked_branch TEXT,
  synced_branch TEXT
);
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS default_branch TEXT;
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS branches JSONB NOT NULL DEFAULT '[]';
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS tracked_branch TEXT;
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS synced_branch TEXT;
CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  identity_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  additions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  url TEXT
);
CREATE INDEX IF NOT EXISTS activities_time_idx ON activities (occurred_at);
CREATE INDEX IF NOT EXISTS activities_repo_idx ON activities (repo_id, occurred_at);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  trigger TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  total INTEGER NOT NULL DEFAULT 0,
  repos INTEGER NOT NULL DEFAULT 0,
  activities INTEGER NOT NULL DEFAULT 0,
  errors JSONB NOT NULL DEFAULT '[]'
);
ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT '';
ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS total INTEGER NOT NULL DEFAULT 0;
`;

/* eslint-disable @typescript-eslint/no-explicit-any */
const dev = (r: any): Developer => ({
  id: r.id,
  displayName: r.display_name,
  avatarUrl: r.avatar_url,
  hidden: r.hidden,
  primaryIdentityId: r.primary_identity_id ?? null,
  createdAt: r.created_at,
});
const ident = (r: any): Identity => ({
  id: r.id,
  developerId: r.developer_id,
  platform: r.platform,
  externalId: r.external_id,
  username: r.username,
  displayName: r.display_name,
  avatarUrl: r.avatar_url,
  email: r.email,
});
const repo = (r: any): Repository => ({
  id: r.id,
  platform: r.platform,
  externalId: r.external_id,
  owner: r.owner,
  name: r.name,
  fullName: r.full_name,
  url: r.url,
  description: r.description,
  language: r.language,
  isPrivate: r.is_private,
  archived: r.archived,
  defaultBranch: r.default_branch ?? null,
  branches: r.branches ?? [],
  trackedBranch: r.tracked_branch ?? null,
  syncedBranch: r.synced_branch ?? null,
  enabled: r.enabled,
  lastSyncedAt: r.last_synced_at,
});
const act = (r: any): Activity => ({
  id: r.id,
  identityId: r.identity_id,
  repoId: r.repo_id,
  type: r.type,
  occurredAt: r.occurred_at,
  additions: r.additions,
  deletions: r.deletions,
  title: r.title,
  url: r.url,
});
const run = (r: any): SyncRun => ({
  id: r.id,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  status: r.status,
  trigger: r.trigger,
  label: r.label ?? "",
  total: r.total ?? 0,
  repos: r.repos,
  activities: r.activities,
  errors: r.errors ?? [],
});

/** camelCase patch keys -> column names (whitelist, so keys never reach SQL unchecked). */
const COLS: Record<string, string> = {
  displayName: "display_name",
  avatarUrl: "avatar_url",
  hidden: "hidden",
  primaryIdentityId: "primary_identity_id",
  username: "username",
  email: "email",
  finishedAt: "finished_at",
  status: "status",
  repos: "repos",
  total: "total",
  label: "label",
  activities: "activities",
  errors: "errors",
};

export class PostgresStore implements Store {
  readonly kind = "postgres" as const;
  private pool: Pool;

  constructor(url: string) {
    this.pool = new Pool({ connectionString: url, max: 10 });
  }

  async init() {
    await this.pool.query(SCHEMA);
  }
  async close() {
    await this.pool.end();
  }

  private async patch(table: string, id: string, patch: Record<string, unknown>) {
    const keys = Object.keys(patch).filter((k) => patch[k] !== undefined && COLS[k]);
    if (!keys.length) return;
    const sets = keys.map((k, i) => `${COLS[k]} = $${i + 2}`);
    const vals = keys.map((k) => (k === "errors" ? JSON.stringify(patch[k]) : patch[k]));
    await this.pool.query(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = $1`, [id, ...vals]);
  }

  async listDevelopers() {
    return (await this.pool.query("SELECT * FROM developers")).rows.map(dev);
  }
  async createDeveloper(d: Developer) {
    await this.pool.query(
      "INSERT INTO developers (id, display_name, avatar_url, hidden, primary_identity_id, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [d.id, d.displayName, d.avatarUrl, d.hidden, d.primaryIdentityId, d.createdAt],
    );
  }
  updateDeveloper(id: string, p: Partial<Developer>) {
    return this.patch("developers", id, p);
  }
  async deleteDeveloper(id: string) {
    await this.pool.query("DELETE FROM developers WHERE id = $1", [id]);
  }

  async listIdentities() {
    return (await this.pool.query("SELECT * FROM identities")).rows.map(ident);
  }
  async findIdentity(platform: string, externalId: string) {
    const r = await this.pool.query("SELECT * FROM identities WHERE platform=$1 AND external_id=$2", [platform, externalId]);
    return r.rows[0] ? ident(r.rows[0]) : null;
  }
  async createIdentity(i: Identity) {
    await this.pool.query(
      `INSERT INTO identities (id, developer_id, platform, external_id, username, display_name, avatar_url, email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (platform, external_id) DO NOTHING`,
      [i.id, i.developerId, i.platform, i.externalId, i.username, i.displayName, i.avatarUrl, i.email],
    );
  }
  updateIdentityProfile(id: string, p: Partial<Identity>) {
    return this.patch("identities", id, p);
  }
  async setIdentityDeveloper(identityId: string, developerId: string) {
    await this.pool.query("UPDATE identities SET developer_id=$2 WHERE id=$1", [identityId, developerId]);
  }

  async listRepositories() {
    return (await this.pool.query("SELECT * FROM repositories ORDER BY full_name")).rows.map(repo);
  }
  async upsertRepository(r: Repository) {
    // `enabled` and `last_synced_at` are intentionally preserved on conflict.
    await this.pool.query(
      `INSERT INTO repositories (id, platform, external_id, owner, name, full_name, url, description, language, is_private, archived, enabled, default_branch, branches)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
       ON CONFLICT (id) DO UPDATE SET owner=EXCLUDED.owner, name=EXCLUDED.name, full_name=EXCLUDED.full_name,
         url=EXCLUDED.url, description=EXCLUDED.description, language=EXCLUDED.language,
         is_private=EXCLUDED.is_private, archived=EXCLUDED.archived,
         default_branch=EXCLUDED.default_branch, branches=EXCLUDED.branches`,
      [r.id, r.platform, r.externalId, r.owner, r.name, r.fullName, r.url, r.description, r.language, r.isPrivate, r.archived, r.enabled, r.defaultBranch, JSON.stringify(r.branches)],
    );
  }
  async setRepositoryEnabled(id: string, enabled: boolean) {
    await this.pool.query("UPDATE repositories SET enabled=$2 WHERE id=$1", [id, enabled]);
  }
  async setRepositoryBranch(id: string, trackedBranch: string | null) {
    await this.pool.query("UPDATE repositories SET tracked_branch=$2 WHERE id=$1", [id, trackedBranch]);
  }
  async setRepositorySyncedBranch(id: string, branch: string | null) {
    await this.pool.query("UPDATE repositories SET synced_branch=$2 WHERE id=$1", [id, branch]);
  }
  async deleteActivitiesForRepo(repoId: string) {
    await this.pool.query("DELETE FROM activities WHERE repo_id=$1", [repoId]);
  }
  async markRepositorySynced(id: string, at: Date | null) {
    await this.pool.query("UPDATE repositories SET last_synced_at=$2 WHERE id=$1", [id, at]);
  }

  async isEmpty() {
    return (await this.pool.query("SELECT 1 FROM activities LIMIT 1")).rowCount === 0;
  }
  async upsertActivities(items: Activity[]) {
    const size = 500;
    for (let s = 0; s < items.length; s += size) {
      const chunk = items.slice(s, s + size);
      const params: unknown[] = [];
      const rows = chunk.map((a, i) => {
        const o = i * 9;
        params.push(a.id, a.identityId, a.repoId, a.type, a.occurredAt, a.additions, a.deletions, a.title, a.url);
        return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8},$${o + 9})`;
      });
      await this.pool.query(
        `INSERT INTO activities (id, identity_id, repo_id, type, occurred_at, additions, deletions, title, url)
         VALUES ${rows.join(",")}
         ON CONFLICT (id) DO UPDATE SET identity_id=EXCLUDED.identity_id, occurred_at=EXCLUDED.occurred_at,
           additions=EXCLUDED.additions, deletions=EXCLUDED.deletions, title=EXCLUDED.title, url=EXCLUDED.url`,
        params,
      );
    }
  }
  async queryActivities(f: ActivityFilter) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (f.from) {
      params.push(f.from);
      where.push(`occurred_at >= $${params.length}`);
    }
    if (f.to) {
      params.push(f.to);
      where.push(`occurred_at < $${params.length}`);
    }
    if (f.repoIds) {
      params.push(f.repoIds);
      where.push(`repo_id = ANY($${params.length})`);
    }
    const sql = `SELECT * FROM activities ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY occurred_at DESC`;
    return (await this.pool.query(sql, params)).rows.map(act);
  }

  async listIdentityIdsWithActivity(repoIds: string[]) {
    if (!repoIds.length) return [];
    const r = await this.pool.query("SELECT DISTINCT identity_id FROM activities WHERE repo_id = ANY($1)", [repoIds]);
    return r.rows.map((x: { identity_id: string }) => x.identity_id);
  }

  async getSetting<T>(key: string) {
    const r = await this.pool.query("SELECT value FROM settings WHERE key=$1", [key]);
    return r.rows[0] ? (r.rows[0].value as T) : null;
  }
  async setSetting(key: string, value: unknown) {
    await this.pool.query(
      "INSERT INTO settings (key, value) VALUES ($1,$2::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value",
      [key, JSON.stringify(value)],
    );
  }

  async createSyncRun(r: SyncRun) {
    await this.pool.query(
      "INSERT INTO sync_runs (id, started_at, finished_at, status, trigger, label, total, repos, activities, errors) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [r.id, r.startedAt, r.finishedAt, r.status, r.trigger, r.label, r.total, r.repos, r.activities, JSON.stringify(r.errors)],
    );
  }
  updateSyncRun(id: string, p: Partial<SyncRun>) {
    return this.patch("sync_runs", id, p);
  }
  async listSyncRuns(limit: number) {
    return (await this.pool.query("SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT $1", [limit])).rows.map(run);
  }
}
