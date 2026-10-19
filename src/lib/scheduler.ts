import { configuredPlatforms, dbConfig, syncConfig } from "./config";
import { getStore } from "./db";
import { isSyncing, runSync } from "./sync";

const g = globalThis as unknown as { __devpulseTimer?: NodeJS.Timeout; __devpulseSchedulerOn?: boolean };

/** How often the scheduler checks whether a sync is due. Short ticks survive host sleeps and clock jumps that a single long timer does not. */
const TICK_MS = 60_000;

function enabled() {
  const { intervalMinutes } = syncConfig();
  return intervalMinutes > 0 && !!dbConfig() && configuredPlatforms().length > 0;
}

/**
 * Starts a sync when the last stored run is older than SYNC_INTERVAL_MINUTES (0 disables). Safe to call often
 * (on every tick, from the health endpoint): it does nothing while a sync is running or when none is due.
 *
 * Due time is measured from the last stored run, not from process start. This matters on hosts that
 * stop idle apps and restart them on the next visit (Azure Free/Shared plans): a restart must not
 * trigger a new sync each time, which would burn the plan's daily CPU quota.
 */
export async function syncIfDue(): Promise<boolean> {
  if (!enabled() || isSyncing()) return false;
  const intervalMs = syncConfig().intervalMinutes * 60_000;
  try {
    const last = (await (await getStore()).listSyncRuns(1))[0];
    if (last && Date.now() < last.startedAt.getTime() + intervalMs) return false;
    console.log("[devpulse] scheduled sync due, starting");
    void runSync("schedule").catch((e) => console.error("[devpulse] scheduled sync failed:", (e as Error).message));
    return true;
  } catch (e) {
    console.error("[devpulse] schedule check failed:", (e as Error).message);
    return false;
  }
}

export function startScheduler(opts: { skipInitial?: boolean } = {}) {
  if (g.__devpulseSchedulerOn || !enabled()) return;
  g.__devpulseSchedulerOn = true;
  console.log(`[devpulse] background sync every ${syncConfig().intervalMinutes} min (checked each minute)`);
  // When the first sync is already running, isSyncing() holds the next check off.
  const first = opts.skipInitial ? TICK_MS : 10_000;
  const tick = () => {
    void syncIfDue().finally(() => {
      g.__devpulseTimer = setTimeout(tick, TICK_MS);
      g.__devpulseTimer.unref?.();
    });
  };
  g.__devpulseTimer = setTimeout(tick, first);
  g.__devpulseTimer.unref?.();
}
