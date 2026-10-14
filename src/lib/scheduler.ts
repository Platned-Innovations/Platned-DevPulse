import { configuredPlatforms, dbConfig, syncConfig } from "./config";
import { getStore } from "./db";
import { isSyncing, runSync } from "./sync";

const g = globalThis as unknown as { __devpulseTimer?: NodeJS.Timeout; __devpulseSchedulerOn?: boolean };

/**
 * Periodic sync driven by SYNC_INTERVAL_MINUTES (0 disables).
 *
 * The next run is timed from the last stored run, not from process start. This matters on hosts that
 * stop idle apps and restart them on the next visit (Azure Free/Shared plans): a restart must not
 * trigger a new sync each time, which would burn the plan's daily CPU quota.
 */
export function startScheduler(opts: { skipInitial?: boolean } = {}) {
  if (g.__devpulseSchedulerOn) return;
  const { intervalMinutes } = syncConfig();
  if (!(intervalMinutes > 0) || !dbConfig() || configuredPlatforms().length === 0) return;
  g.__devpulseSchedulerOn = true;
  const intervalMs = intervalMinutes * 60_000;

  const schedule = (delayMs: number) => {
    g.__devpulseTimer = setTimeout(async () => {
      if (!isSyncing()) {
        try {
          await runSync("schedule");
        } catch (e) {
          console.error("[devpulse] scheduled sync failed:", (e as Error).message);
        }
      }
      schedule(intervalMs);
    }, delayMs);
    g.__devpulseTimer.unref?.();
  };

  void (async () => {
    let delay = 10_000;
    try {
      const last = (await (await getStore()).listSyncRuns(1))[0];
      if (last) delay = Math.max(10_000, last.startedAt.getTime() + intervalMs - Date.now());
    } catch {
      /* no database yet: fall back to a quick first run */
    }
    if (opts.skipInitial) delay = intervalMs; // the first sync is already running
    console.log(`[devpulse] background sync every ${intervalMinutes} min, next in ${Math.round(delay / 60_000)} min`);
    schedule(delay);
  })();
}
