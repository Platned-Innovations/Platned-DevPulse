import { configuredPlatforms, dbConfig } from "./config";
import { getStore } from "./db";

const g = globalThis as unknown as { __devpulseBooted?: boolean };

/**
 * Runs once at server start:
 *  1. connects and creates/updates the schema (idempotent migration),
 *  2. if the database holds no activity yet (and AUTO_SEED is not "false"):
 *     - platform credentials configured -> kicks off the first real sync in the background,
 *     - nothing configured              -> loads fictional demo data so the app is not blank.
 * Real credentials never trigger demo data, so production is never polluted with fakes.
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
    const { seedDemoData } = await import("./seed");
    const r = await seedDemoData(store);
    console.log(`[devpulse] empty database and no platform configured: loaded demo data (${r.activities} activities)`);
  } catch (e) {
    g.__devpulseBooted = false;
    console.error("[devpulse] startup bootstrap failed:", (e as Error).message);
  }
  return { firstSync: false };
}
