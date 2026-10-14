"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Refreshes the server-rendered admin page every few seconds while a sync is running. */
export function SyncPoller({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}
