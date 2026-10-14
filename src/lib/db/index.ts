import { dbConfig } from "../config";
import type { Store } from "./store";

export type { Store } from "./store";

const g = globalThis as unknown as { __devpulseStore?: Promise<Store> };

export class DbNotConfiguredError extends Error {
  constructor() {
    super("No database configured. Set POSTGRES_URL (PostgreSQL) or MONGODB_URI (MongoDB) in your environment.");
  }
}

async function storeClass(kind: "postgres" | "mongodb") {
  return kind === "postgres" ? (await import("./postgres")).PostgresStore : (await import("./mongo")).MongoStore;
}

/**
 * Lazily creates one shared store per process, picking the backend from env.
 * In development, hot reloads re-evaluate the store classes; a store built from an older
 * class (old row mapping, old schema) is closed and rebuilt so schema changes take effect.
 */
export async function getStore(): Promise<Store> {
  const cfg = dbConfig();
  if (!cfg) throw new DbNotConfiguredError();
  const Cls = await storeClass(cfg.kind);

  if (g.__devpulseStore) {
    const existing = await g.__devpulseStore.catch(() => null);
    if (existing instanceof Cls) return existing;
    // Not closed: a running sync may still hold it. Its idle connections time out on their own.
    g.__devpulseStore = undefined;
  }

  const p = (async () => {
    const store: Store = new Cls(cfg.url);
    await store.init();
    return store;
  })();
  g.__devpulseStore = p;
  p.catch(() => {
    if (g.__devpulseStore === p) g.__devpulseStore = undefined; // allow retry after a failed connect
  });
  return p;
}
