import { configuredPlatforms, dbConfig } from "./config";
import { getStore } from "./db";

const g = globalThis as unknown as { __devpulseBooted?: boolean };

/**
 * Runs once at server start:
 *  1. connects and creates/updates the schema (idempotent migration),
 *  2. if the database holds no activity yet (and AUTO_SEED is not "false") and GitHub/Bitbucket
 *     credentials are configured, kicks off the first real sync in the background.
 * No fake data is ever loaded.
 */
export async function bootstrap(): Promise<{ firstSync: boolean }> {
  if (g.__devpulseBooted || !dbConfig()) return { firstSync: false };
  g.__devpulseBooted = true;
  try {
    const store = await getStore();
    console.log(`[devpulse] database ready (${store.kind})`);
    if (process.env.AUTO_SEED?.toLowerCase() === "false" || !(await store.isEmpty())) return { firstSync: false };

    if (configuredPlatforms().length > 0) {
      const { runSync } = await import("./sync");
      console.log("[devpulse] empty database: running the first sync in the background");
      void runSync("schedule").catch((e) => console.error("[devpulse] first sync failed:", e.message));
      return { firstSync: true };
    }
  } catch (e) {
    g.__devpulseBooted = false;
    console.error("[devpulse] startup bootstrap failed:", (e as Error).message);
  }
  return { firstSync: false };
}
