import { configuredPlatforms, dbConfig, syncConfig } from "./config";
import { isSyncing, runSync } from "./sync";

const g = globalThis as unknown as { __devpulseTimer?: NodeJS.Timeout };

/** Periodic sync driven by SYNC_INTERVAL_MINUTES (0 disables). */
export function startScheduler() {
  if (g.__devpulseTimer) return;
  const { intervalMinutes } = syncConfig();
  if (!(intervalMinutes > 0) || !dbConfig() || configuredPlatforms().length === 0) return;

  const tick = async () => {
    if (isSyncing()) return;
    try {
      await runSync("schedule");
    } catch (e) {
      console.error("[devpulse] scheduled sync failed:", (e as Error).message);
    }
  };
  g.__devpulseTimer = setInterval(tick, intervalMinutes * 60_000);
  g.__devpulseTimer.unref?.();
  setTimeout(tick, 10_000).unref?.(); // first sync shortly after boot
  console.log(`[devpulse] background sync every ${intervalMinutes} min`);
}
