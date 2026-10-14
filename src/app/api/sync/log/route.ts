import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { isCancelRequested } from "@/lib/cancel";
import { isSyncing } from "@/lib/sync";
import { readLog } from "@/lib/synclog";

export const dynamic = "force-dynamic";

/** Live sync log for the admin panel. Admin only; entries after `?after=<seq>`. */
export async function GET(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const after = Number(new URL(req.url).searchParams.get("after")) || 0;
  return NextResponse.json({ running: isSyncing(), cancelling: isCancelRequested(), ...readLog(after) }, { headers: { "Cache-Control": "no-store" } });
}
