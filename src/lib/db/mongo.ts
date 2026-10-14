import { MongoClient, type Db } from "mongodb";
import type { Store } from "./store";
import type { Activity, ActivityFilter, Developer, Identity, Repository, SyncRun } from "../types";

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Documents use the domain `id` as Mongo `_id`; these helpers convert both ways. */
const out = <T>(d: any): T => {
  const { _id, ...rest } = d;
  return { id: _id, ...rest } as T;
};
const into = (o: { id: string }): any => {
  const { id, ...rest } = o;
  return { _id: id, ...rest };
};

export class MongoStore implements Store {
  readonly kind = "mongodb" as const;
  private client: MongoClient;
  private _db: Db | null = null;

  constructor(private url: string) {
    this.client = new MongoClient(url);
  }

  private get db(): Db {
    if (!this._db) throw new Error("MongoStore not initialised");
    return this._db;
  }
  private col(name: string) {
    return this.db.collection<any>(name);
  }

  async init() {
    await this.client.connect();
    // Use the database named in the connection string, falling back to "devpulse".
    const dbName = this.client.options.dbName || "devpulse";
    this._db = this.client.db(dbName);
    await this.col("identities").createIndex({ platform: 1, externalId: 1 }, { unique: true });
    await this.col("identities").createIndex({ developerId: 1 });
    await this.col("activities").createIndex({ occurredAt: 1 });
    await this.col("activities").createIndex({ repoId: 1, occurredAt: 1 });
  }
  async close() {
    await this.client.close();
  }

  async listDevelopers() {
    return (await this.col("developers").find().toArray()).map((d) => ({ ...out<Developer>(d), primaryIdentityId: d.primaryIdentityId ?? null }));
  }
  async createDeveloper(d: Developer) {
    await this.col("developers").insertOne(into(d));
  }
  async updateDeveloper(id: string, patch: Partial<Developer>) {
    await this.col("developers").updateOne({ _id: id }, { $set: patch });
  }
  async deleteDeveloper(id: string) {
    await this.col("developers").deleteOne({ _id: id });
  }

  async listIdentities() {
    return (await this.col("identities").find().toArray()).map((d) => out<Identity>(d));
  }
  async findIdentity(platform: string, externalId: string) {
    const d = await this.col("identities").findOne({ platform, externalId });
    return d ? out<Identity>(d) : null;
  }
  async createIdentity(i: Identity) {
    await this.col("identities").updateOne(
      { platform: i.platform, externalId: i.externalId },
      { $setOnInsert: into(i) },
      { upsert: true },
    );
  }
  async updateIdentityProfile(id: string, patch: Partial<Identity>) {
    await this.col("identities").updateOne({ _id: id }, { $set: patch });
  }
  async setIdentityDeveloper(identityId: string, developerId: string) {
    await this.col("identities").updateOne({ _id: identityId }, { $set: { developerId } });
  }

  async listRepositories() {
    return (await this.col("repositories").find().sort({ fullName: 1 }).toArray()).map((d) => ({
      ...out<Repository>(d),
      defaultBranch: d.defaultBranch ?? null,
      branches: d.branches ?? [],
      trackedBranch: d.trackedBranch ?? null,
      syncedBranch: d.syncedBranch ?? null,
    }));
  }
  async upsertRepository(r: Repository) {
    const { enabled, lastSyncedAt, trackedBranch, syncedBranch, ...rest } = into(r);
    // Preserve admin-controlled settings and the sync cursor on existing docs.
    await this.col("repositories").updateOne(
      { _id: r.id },
      { $set: rest, $setOnInsert: { enabled, lastSyncedAt, trackedBranch, syncedBranch } },
      { upsert: true },
    );
  }
  async setRepositoryEnabled(id: string, enabled: boolean) {
    await this.col("repositories").updateOne({ _id: id }, { $set: { enabled } });
  }
  async setRepositoryBranch(id: string, trackedBranch: string | null) {
    await this.col("repositories").updateOne({ _id: id }, { $set: { trackedBranch } });
  }
  async setRepositorySyncedBranch(id: string, branch: string | null) {
    await this.col("repositories").updateOne({ _id: id }, { $set: { syncedBranch: branch } });
  }
  async deleteActivitiesForRepo(repoId: string) {
    await this.col("activities").deleteMany({ repoId });
  }
  async markRepositorySynced(id: string, at: Date | null) {
    await this.col("repositories").updateOne({ _id: id }, { $set: { lastSyncedAt: at } });
  }

  async isEmpty() {
    return (await this.col("activities").findOne({}, { projection: { _id: 1 } })) === null;
  }
  async upsertActivities(items: Activity[]) {
    const size = 1000;
    for (let s = 0; s < items.length; s += size) {
      const ops = items.slice(s, s + size).map((a) => ({
        replaceOne: { filter: { _id: a.id }, replacement: into(a), upsert: true },
      }));
      if (ops.length) await this.col("activities").bulkWrite(ops, { ordered: false });
    }
  }
  async queryActivities(f: ActivityFilter) {
    const q: any = {};
    if (f.from || f.to) {
      q.occurredAt = {};
      if (f.from) q.occurredAt.$gte = f.from;
      if (f.to) q.occurredAt.$lt = f.to;
    }
    if (f.repoIds) q.repoId = { $in: f.repoIds };
    return (await this.col("activities").find(q).sort({ occurredAt: -1 }).toArray()).map((d) => out<Activity>(d));
  }

  async listIdentityIdsWithActivity(repoIds: string[]) {
    if (!repoIds.length) return [];
    return (await this.col("activities").distinct("identityId", { repoId: { $in: repoIds } })) as string[];
  }

  async getSetting<T>(key: string) {
    const d = await this.col("settings").findOne({ _id: key });
    return d ? (d.value as T) : null;
  }
  async setSetting(key: string, value: unknown) {
    await this.col("settings").updateOne({ _id: key }, { $set: { value } }, { upsert: true });
  }

  async createSyncRun(r: SyncRun) {
    await this.col("sync_runs").insertOne(into(r));
  }
  async updateSyncRun(id: string, patch: Partial<SyncRun>) {
    await this.col("sync_runs").updateOne({ _id: id }, { $set: patch });
  }
  async listSyncRuns(limit: number) {
    return (await this.col("sync_runs").find().sort({ startedAt: -1 }).limit(limit).toArray()).map((d) => ({ ...out<SyncRun>(d), label: d.label ?? "", window: d.window ?? "", total: d.total ?? 0 }));
  }
}
