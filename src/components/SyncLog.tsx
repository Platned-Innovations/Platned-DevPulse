"use client";

import { useEffect, useRef, useState } from "react";

interface Entry {
  seq: number;
  t: number;
  level: "info" | "ok" | "warn" | "error";
  text: string;
}

interface Reply {
  seq: number;
  epoch: number;
  now: string;
  running: boolean;
  entries: Entry[];
}

const COLORS = { info: "var(--text-2)", ok: "var(--good)", warn: "var(--gold)", error: "var(--bad)" } as const;

/** Live view of the running sync: a "now" line plus a rolling log. Polls only while a sync is active. */
export function SyncLog({ active }: { active: boolean }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [now, setNow] = useState("");
  const [running, setRunning] = useState(active);
  const lastSeq = useRef(0);
  const epoch = useRef(-1);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    let stopped = false; // per effect run, so a second (dev double-mounted) loop cannot double up
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      let again = 3000;
      try {
        const res = await fetch(`/api/sync/log?after=${epoch.current < 0 ? 0 : lastSeq.current}`, { cache: "no-store" });
        if (res.ok && !stopped) {
          const d: Reply = await res.json();
          if (d.epoch !== epoch.current) {
            // A new run started (or first load): replace everything.
            // Sequence numbers only grow, so "after lastSeq" already contains the whole new run.
            epoch.current = d.epoch;
            lastSeq.current = d.entries.at(-1)?.seq ?? d.seq;
            setEntries(d.entries.slice(-400));
          } else if (d.entries.length) {
            // Only append entries newer than what is already shown (guards against overlapping polls).
            const fresh = d.entries.filter((e) => e.seq > lastSeq.current);
            if (fresh.length) {
              lastSeq.current = fresh[fresh.length - 1].seq;
              setEntries((prev) => [...prev, ...fresh.filter((e) => e.seq > (prev.at(-1)?.seq ?? 0))].slice(-400));
            }
          }
          setNow(d.now);
          setRunning(d.running);
          again = d.running || active ? 1200 : 0; // idle and finished: stop polling
        }
      } catch {
        /* retry */
      }
      if (!stopped && again > 0) timer = setTimeout(tick, again);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active]);

  useEffect(() => {
    if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [entries]);

  if (!running && entries.length === 0) return null;

  return (
    <div style={{ marginTop: 16 }}>
      <div className="row spread" style={{ marginBottom: 6 }}>
        <b>{running ? "Live activity" : "Last run log"}</b>
        {running && now && <span className="muted" style={{ fontSize: 13 }}>▶ {now}</span>}
      </div>
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        role="log"
        aria-live="off"
        style={{ height: 240, overflow: "auto", background: "var(--surface-2)", borderRadius: 8, padding: "8px 10px", font: "12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" }}
      >
        {entries.map((e) => (
          <div key={e.seq} style={{ color: COLORS[e.level], whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            <span className="faint">{new Date(e.t).toISOString().slice(11, 19)}</span> {e.text}
          </div>
        ))}
      </div>
    </div>
  );
}
