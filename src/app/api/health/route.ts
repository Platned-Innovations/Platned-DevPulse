import { NextResponse } from "next/server";
import { dbConfig } from "@/lib/config";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Liveness by default; `?deep=1` also verifies the database (use for Azure "Health check"). */
export async function GET(req: Request) {
  // Every ping doubles as a wake-up: it (re)starts the scheduler and runs a sync that came due while the app was asleep.
  const { startScheduler, syncIfDue } = await import("@/lib/scheduler");
  startScheduler();
  void syncIfDue();
  if (new URL(req.url).searchParams.get("deep") !== "1") return NextResponse.json({ status: "ok" });
  try {
    const store = await getStore();
    await store.listSyncRuns(1);
    return NextResponse.json({ status: "ok", db: store.kind });
  } catch (e) {
    return NextResponse.json({ status: "error", db: dbConfig()?.kind ?? null, message: (e as Error).message }, { status: 503 });
  }
}
