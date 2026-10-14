"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { login, logout, requireAdmin } from "@/lib/auth";
import { getStore } from "@/lib/db";
import { mergeDevelopers, unlinkIdentity } from "@/lib/identities";
import { DEFAULT_WEIGHTS } from "@/lib/scoring";
import { clearStatsCache } from "@/lib/stats";
import { isSyncing, runSync } from "@/lib/sync";
import { ACTIVITY_TYPES } from "@/lib/types";

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

export async function startSyncAction() {
  await requireAdmin();
  if (!isSyncing()) {
    // Runs in the background; the admin page polls for progress.
    void runSync("manual").catch((e) => console.error("[devpulse] sync failed:", e));
  }
  back("overview");
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
