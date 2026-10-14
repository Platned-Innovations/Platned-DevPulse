/** In-memory activity log of the current (or last) sync, shown live in the admin area. */

export interface LogEntry {
  seq: number;
  t: number;
  level: "info" | "ok" | "warn" | "error";
  text: string;
}

const MAX = 600;
const g = globalThis as unknown as { __devpulseLog?: { seq: number; epoch: number; entries: LogEntry[]; now: string } };
const state = () => (g.__devpulseLog ??= { seq: 0, epoch: 0, entries: [], now: "" });

export function resetLog() {
  const s = state();
  s.entries = [];
  s.now = "";
  s.epoch++;
}

export function logEvent(text: string, level: LogEntry["level"] = "info") {
  const s = state();
  s.entries.push({ seq: ++s.seq, t: Date.now(), level, text: text.slice(0, 400) });
  if (s.entries.length > MAX) s.entries.splice(0, s.entries.length - MAX);
}

/** One overwritten "what is happening right now" line. */
export function setNow(text: string) {
  state().now = text.slice(0, 300);
}

export function readLog(after = 0) {
  const s = state();
  return { seq: s.seq, epoch: s.epoch, now: s.now, entries: s.entries.filter((e) => e.seq > after) };
}
