import { dbConfig } from "../config";
import type { Store } from "./store";

export type { Store } from "./store";

const g = globalThis as unknown as { __devpulseStore?: Promise<Store> };

export class DbNotConfiguredError extends Error {
  constructor() {
    super("No database configured. Set POSTGRES_URL (PostgreSQL) or MONGODB_URI (MongoDB) in your environment.");
  }
}

/** Lazily creates one shared store per process, picking the backend from env. */
export function getStore(): Promise<Store> {
  if (!g.__devpulseStore) {
    const p = (async () => {
      const cfg = dbConfig();
      if (!cfg) throw new DbNotConfiguredError();
      const store: Store =
        cfg.kind === "postgres"
          ? new (await import("./postgres")).PostgresStore(cfg.url)
          : new (await import("./mongo")).MongoStore(cfg.url);
      await store.init();
      return store;
    })();
    g.__devpulseStore = p;
    p.catch(() => {
      g.__devpulseStore = undefined; // allow retry after a failed connect
    });
  }
  return g.__devpulseStore;
}
