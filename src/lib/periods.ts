/** Time windows for leaderboards. All boundaries are UTC; weeks start on Monday. */

export type PeriodKey = "day" | "week" | "month" | "quarter" | "year" | "all";

export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "day", label: "Daily" },
  { key: "week", label: "Weekly" },
  { key: "month", label: "Monthly" },
  { key: "quarter", label: "Quarterly" },
  { key: "year", label: "Yearly" },
  { key: "all", label: "All time" },
];

export interface Range {
  key: PeriodKey;
  offset: number;
  from: Date; // inclusive
  to: Date; // exclusive
  label: string;
}

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

export function parsePeriod(v: string | undefined): PeriodKey {
  return PERIODS.some((p) => p.key === v) ? (v as PeriodKey) : "month";
}

/** `offset` 0 = the current period, -1 = the previous one, and so on. */
export function resolveRange(key: PeriodKey, offset = 0, now = new Date()): Range {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  let from: Date;
  let to: Date;
  let label: string;
  switch (key) {
    case "day":
      from = utc(y, m, d + offset);
      to = utc(y, m, d + offset + 1);
      label = fmt(from);
      break;
    case "week": {
      const dow = (now.getUTCDay() + 6) % 7; // Monday = 0
      from = utc(y, m, d - dow + offset * 7);
      to = utc(y, m, d - dow + offset * 7 + 7);
      label = `${fmt(from)} - ${fmt(new Date(to.getTime() - 1))}`;
      break;
    }
    case "month":
      from = utc(y, m + offset, 1);
      to = utc(y, m + offset + 1, 1);
      label = `${MONTHS[from.getUTCMonth()]} ${from.getUTCFullYear()}`;
      break;
    case "quarter": {
      const q = Math.floor(m / 3) + offset;
      from = utc(y, q * 3, 1);
      to = utc(y, q * 3 + 3, 1);
      label = `Q${(((q % 4) + 4) % 4) + 1} ${from.getUTCFullYear()}`;
      break;
    }
    case "year":
      from = utc(y + offset, 0, 1);
      to = utc(y + offset + 1, 0, 1);
      label = String(from.getUTCFullYear());
      break;
    default:
      from = new Date(0);
      to = new Date(now.getTime() + 86_400_000);
      label = "All time";
  }
  return { key, offset: key === "all" ? 0 : offset, from, to, label };
}

export function previousRange(r: Range): Range | null {
  return r.key === "all" ? null : resolveRange(r.key, r.offset - 1);
}

export function parseOffset(v: string | undefined): number {
  const n = Number(v);
  return Number.isInteger(n) && n <= 0 && n > -1000 ? n : 0;
}

export const dayKey = (d: Date) => d.toISOString().slice(0, 10);
