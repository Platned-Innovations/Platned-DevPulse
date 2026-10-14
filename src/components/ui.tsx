import Link from "next/link";
import { qs } from "@/lib/filters";
import { PERIODS } from "@/lib/periods";
import type { Filters } from "@/lib/stats";
import type { Platform } from "@/lib/types";
import type { Range } from "@/lib/periods";

export function Avatar({ name, src, size }: { name: string; src: string | null; size?: "sm" | "lg" | "xl" }) {
  const cls = `avatar${size ? " " + size : ""}`;
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img className={cls} src={src} alt="" referrerPolicy="no-referrer" loading="lazy" /> : <span className={cls} aria-hidden>{initials}</span>;
}

export const PLATFORM_LABEL: Record<Platform, string> = { github: "GitHub", bitbucket: "Bitbucket" };

export function PlatformChips({ platforms }: { platforms: Platform[] }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      {platforms.map((p) => (
        <span key={p} className="chip">
          <span className={`dot ${p}`} /> {PLATFORM_LABEL[p]}
        </span>
      ))}
    </span>
  );
}

export function Delta({ now, before, suffix = "" }: { now: number; before: number | null; suffix?: string }) {
  if (before == null) return null;
  const d = now - before;
  if (d === 0) return <span className="delta flat">no change{suffix}</span>;
  const pct = before > 0 ? ` (${d > 0 ? "+" : ""}${Math.round((d / before) * 100)}%)` : "";
  return (
    <span className={`delta ${d > 0 ? "up" : "down"}`}>
      {d > 0 ? "▲" : "▼"} {Math.abs(d).toLocaleString()}
      {pct}
      {suffix}
    </span>
  );
}

export function RankMove({ rank, previous }: { rank: number; previous: number | null }) {
  if (previous == null) return <span className="chip" title="New this period">new</span>;
  const d = previous - rank;
  if (d === 0) return <span className="faint" title="Same rank as previous period">–</span>;
  return (
    <span className={`delta ${d > 0 ? "up" : "down"}`} title={`Was #${previous} in the previous period`}>
      {d > 0 ? "▲" : "▼"} {Math.abs(d)}
    </span>
  );
}

export function Stat({ label, value, children }: { label: string; value: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="card stat">
      <span className="k">{label}</span>
      <span className="v num">{value}</span>
      {children}
    </div>
  );
}

/** Period tabs + previous/next stepper. Pure links, so it works without client JS. */
export function PeriodControls({ base, filters, range }: { base: string; filters: Filters; range: Range }) {
  return (
    <div className="toolbar">
      <nav className="tabs" aria-label="Time period">
        {PERIODS.map((p) => (
          <Link key={p.key} href={`${base}${qs({ ...filters, period: p.key, offset: 0 })}`} aria-current={p.key === filters.period}>
            {p.label}
          </Link>
        ))}
      </nav>
      {filters.period !== "all" && (
        <div className="stepper">
          <Link href={`${base}${qs({ ...filters, offset: filters.offset - 1 })}`} aria-label="Previous period">‹</Link>
          <span className="label num">{range.label}</span>
          {filters.offset < 0 ? (
            <Link href={`${base}${qs({ ...filters, offset: filters.offset + 1 })}`} aria-label="Next period">›</Link>
          ) : (
            <span className="btn" aria-hidden>›</span>
          )}
        </div>
      )}
    </div>
  );
}

export function SetupNotice({ error }: { error: string }) {
  const noDb = /No database configured/.test(error);
  return (
    <div className="notice err">
      <h2>{noDb ? "Database not configured" : "Something went wrong"}</h2>
      <p className="muted">{error}</p>
      {noDb && (
        <p className="muted">
          Copy <code>.env.example</code> to <code>.env.local</code>, set either <code>POSTGRES_URL</code> or <code>MONGODB_URI</code>, then restart the app.
        </p>
      )}
    </div>
  );
}

export function EmptyState({ title = "No activity in this period", children }: { title?: string; children?: React.ReactNode }) {
  return (
    <div className="notice">
      <h2>{title}</h2>
      <p className="muted">
        {children ?? (
          <>
            Try another period or filter. If the app is new, an admin can run the first sync from the <Link href="/admin">admin area</Link>.
          </>
        )}
      </p>
    </div>
  );
}

export const fmt = (n: number) => n.toLocaleString("en-US");
export const ago = (ms: number) => {
  const d = Math.floor((Date.now() - ms) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d}d ago`;
};
