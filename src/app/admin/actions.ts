"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { login, logout, requireAdmin } from "@/lib/auth";
import { getStore } from "@/lib/db";
import { mergeDevelopers, unlinkIdentity } from "@/lib/identities";
import { DEFAULT_WEIGHTS } from "@/lib/scoring";
import { clearStatsCache } from "@/lib/stats";
import { requestCancel } from "@/lib/cancel";
import { isSyncing, runSync, type SyncOptions } from "@/lib/sync";
import { ACTIVITY_TYPES } from "@/lib/types";

/** "all" = everything (a 100-year window); otherwise a whole number of days. */
const parseDays = (v: FormDataEntryValue | null): number | undefined => {
  if (v === "all") return 36_500;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 36_500 ? n : undefined;
};

const back = (tab: string, msg?: string, error = false) =>
  redirect(`/admin?tab=${tab}${msg ? `&${error ? "error" : "ok"}=${encodeURIComponent(msg)}` : ""}`);

export async function loginAction(_: unknown, form: FormData): Promise<{ error: string } | null> {
  const h = await headers();
  const key = h.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const ok = await login(String(form.get("username") ?? ""), String(form.get("password") ?? ""), key);
  if (!ok) return { error: "Invalid credentials, or too many attempts. Try again later." };
  redirect("/admin");
}

export async function logoutAction() {
  await logout();
  redirect("/");
}

/** Starts a background sync. mode: incremental (default) | full (re-read the look-back window) | discover (refresh repo list). */
export async function startSyncAction(form: FormData) {
  await requireAdmin();
  const mode = String(form.get("mode") ?? "incremental");
  const opts: SyncOptions = {
    full: mode === "full",
    discoverOnly: mode === "discover",
    lookbackDays: parseDays(form.get("days")),
  };
  if (isSyncing()) back("overview", "A sync is already running.", true);
  // Runs in the background; the admin page polls for progress.
  void runSync("manual", opts).catch((e) => console.error("[devpulse] sync failed:", e));
  back("overview", mode === "discover" ? "Looking for new repositories…" : mode === "full" ? "Full re-sync started." : "Sync started.");
}

/**
 * Stops the running sync. It halts before the next API request; repositories already finished keep
 * their data. If the row says "running" but no sync is active here (e.g. the app restarted), it is closed.
 */
export async function stopSyncAction() {
  await requireAdmin();
  if (isSyncing()) {
    requestCancel();
    back("overview", "Stopping… the sync halts at its next step.");
  }
  const store = await getStore();
  let closed = 0;
  for (const r of await store.listSyncRuns(10)) {
    if (r.status === "running") {
      await store.updateSyncRun(r.id, { status: "cancelled", finishedAt: new Date(), errors: [...r.errors, "Marked as stopped (no sync was active)"] });
      closed++;
    }
  }
  back("overview", closed ? "Marked the stuck run as stopped." : "No sync is running.");
}

/** Re-reads the whole look-back window for a single repository. */
export async function syncRepoAction(form: FormData) {
  await requireAdmin();
  const id = String(form.get("id") ?? "");
  if (isSyncing()) back("repos", "A sync is already running.", true);
  if (id) {
    void runSync("manual", {
      repoIds: [id],
      full: true,
      lookbackDays: parseDays(form.get("days")),
    }).catch((e) => console.error("[devpulse] repo sync failed:", e));
  }
  back("repos", "Repository sync started. Results appear under Overview & sync.");
}

export async function mergeAction(form: FormData) {
  await requireAdmin();
  try {
    await mergeDevelopers(String(form.get("target")), String(form.get("source")));
  } catch (e) {
    back("developers", (e as Error).message, true);
  }
  revalidatePath("/", "layout");
  back("developers", "Developers merged. Stats from both accounts are now combined.");
}

export async function unlinkAction(form: FormData) {
  await requireAdmin();
  try {
    await unlinkIdentity(String(form.get("identity")));
  } catch (e) {
    back("developers", (e as Error).message, true);
  }
  revalidatePath("/", "layout");
  back("developers", "Account unlinked into its own developer.");
}

/** Chooses which linked account's picture represents the developer. */
export async function setPrimaryAction(form: FormData) {
  await requireAdmin();
  const store = await getStore();
  const developerId = String(form.get("developer"));
  const identityId = String(form.get("identity"));
  const owns = (await store.listIdentities()).some((i) => i.id === identityId && i.developerId === developerId);
  if (!owns) back("developers", "That account is not linked to this developer.", true);
  await store.updateDeveloper(developerId, { primaryIdentityId: identityId });
  clearStatsCache();
  revalidatePath("/", "layout");
  back("developers", "Primary account updated.");
}

export async function setHiddenAction(form: FormData) {
  await requireAdmin();
  const store = await getStore();
  await store.updateDeveloper(String(form.get("id")), { hidden: form.get("hidden") === "true" });
  clearStatsCache();
  revalidatePath("/", "layout");
  back("developers");
}

export async function renameDeveloperAction(form: FormData) {
  await requireAdmin();
  const name = String(form.get("name") ?? "").trim().slice(0, 100);
  if (name) {
    const store = await getStore();
    await store.updateDeveloper(String(form.get("id")), { displayName: name });
    clearStatsCache();
    revalidatePath("/", "layout");
  }
  back("developers");
}

export async function setRepoEnabledAction(form: FormData) {
  await requireAdmin();
  const store = await getStore();
  await store.setRepositoryEnabled(String(form.get("id")), form.get("enabled") === "true");
  clearStatsCache();
  revalidatePath("/", "layout");
  back("repos");
}

/** Chooses which branch of a repository is read ("" = automatic). The next sync replaces data read from the old branch. */
export async function setBranchAction(form: FormData) {
  await requireAdmin();
  const store = await getStore();
  const id = String(form.get("id") ?? "");
  const branch = String(form.get("branch") ?? "");
  const repo = (await store.listRepositories()).find((r) => r.id === id);
  if (!repo) back("repos", "Repository not found.", true);
  else if (branch && !repo.branches.includes(branch)) back("repos", "That branch does not exist. Run Discover repositories to refresh branches.", true);
  else {
    await store.setRepositoryBranch(id, branch || null);
    clearStatsCache();
    revalidatePath("/", "layout");
    if (repo.enabled && !isSyncing()) {
      void runSync("manual", { repoIds: [id], full: true }).catch((e) => console.error("[devpulse] repo sync failed:", e));
    }
    back("repos", "Branch saved. Re-reading the repository from that branch now.");
  }
}

export async function saveWeightsAction(form: FormData) {
  await requireAdmin();
  const weights: Record<string, number> = {};
  for (const t of ACTIVITY_TYPES) {
    const n = Number(form.get(t));
    weights[t] = Number.isFinite(n) && n >= 0 && n <= 1000 ? n : DEFAULT_WEIGHTS[t];
  }
  await (await getStore()).setSetting("weights", weights);
  clearStatsCache();
  revalidatePath("/", "layout");
  back("scoring", "Scoring weights saved.");
}
