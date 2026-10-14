import type { SeriesPoint } from "@/lib/stats";

/** Tiny trend line for table rows. */
export function Sparkline({ data, width = 96, height = 26 }: { data: SeriesPoint[]; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(1, ...data.map((d) => d.points));
  const step = width / (data.length - 1);
  const pts = data.map((d, i) => `${(i * step).toFixed(1)},${(height - 2 - (d.points / max) * (height - 4)).toFixed(1)}`);
  const total = data.reduce((s, d) => s + d.points, 0);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Activity trend, ${total} points`}>
      <polyline points={pts.join(" ")} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Column chart of points per day/bucket. One series: the title names it, so no legend. */
export function ActivityBars({ data, height = 140 }: { data: SeriesPoint[]; height?: number }) {
  if (data.length === 0) return null;
  const W = 640;
  const pad = { t: 8, b: 20, l: 30, r: 4 };
  const max = Math.max(1, ...data.map((d) => d.points));
  const bw = (W - pad.l - pad.r) / data.length;
  const h = height - pad.t - pad.b;
  const ticks = [0, Math.round(max / 2), max];
  const labelEvery = Math.ceil(data.length / 6);
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label="Contribution points over time" style={{ display: "block" }}>
      {ticks.map((t, i) => {
        const y = pad.t + h - (t / max) * h;
        return (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="var(--border)" strokeWidth={1} />
            <text x={pad.l - 6} y={y + 3} textAnchor="end">{t}</text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const bh = Math.max(d.points ? 2 : 0, (d.points / max) * h);
        const x = pad.l + i * bw;
        return (
          <g key={d.date}>
            <rect x={x + 1} y={pad.t + h - bh} width={Math.max(1, bw - 2)} height={bh} rx={Math.min(3, bw / 3)} fill="var(--accent)">
              <title>{`${d.date}: ${d.points} pts (${d.count} activities)`}</title>
            </rect>
            {i % labelEvery === 0 && (
              <text x={x + bw / 2} y={height - 5} textAnchor="middle">{d.date.slice(5)}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Day-of-week distribution. */
export function WeekdayBars({ data }: { data: { label: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <ul className="list" aria-label="Activity by weekday">
      {data.map((d) => (
        <li key={d.label} style={{ alignItems: "center" }}>
          <span style={{ width: 36 }}>{d.label}</span>
          <span style={{ flex: 1 }} className="bar" title={`${d.count} activities`}>
            <span style={{ width: `${(d.count / max) * 100}%`, background: "var(--accent)" }} />
          </span>
          <span className="num muted" style={{ width: 48, textAlign: "right" }}>{d.count}</span>
        </li>
      ))}
    </ul>
  );
}

/** GitHub-style yearly heatmap (53 weeks x 7 days) in one-hue sequential steps. */
export function Heatmap({ data }: { data: { date: string; points: number }[] }) {
  const map = new Map(data.map((d) => [d.date, d.points]));
  const max = Math.max(1, ...data.map((d) => d.points));
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today.getTime() - 364 * 86_400_000);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7)); // back to Monday
  const cell = 11;
  const gap = 3;
  const weeks = Math.ceil((today.getTime() - start.getTime()) / (7 * 86_400_000)) + 1;
  const level = (p: number) => (p === 0 ? 0 : Math.min(4, Math.ceil((p / max) * 4)));
  const fills = ["var(--heat-0)", "color-mix(in srgb, var(--accent) 25%, var(--heat-0))", "color-mix(in srgb, var(--accent) 50%, var(--heat-0))", "color-mix(in srgb, var(--accent) 75%, var(--heat-0))", "var(--accent)"];
  const cells: React.ReactNode[] = [];
  const months: React.ReactNode[] = [];
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const t = new Date(start.getTime() + (w * 7 + d) * 86_400_000);
      if (t > today) continue;
      const key = t.toISOString().slice(0, 10);
      const p = map.get(key) ?? 0;
      cells.push(
        <rect key={key} x={w * (cell + gap)} y={d * (cell + gap) + 14} width={cell} height={cell} rx={2} fill={fills[level(p)]}>
          <title>{`${key}: ${p} pts`}</title>
        </rect>,
      );
      if (d === 0 && t.getUTCMonth() !== lastMonth) {
        lastMonth = t.getUTCMonth();
        months.push(<text key={key} x={w * (cell + gap)} y={9}>{t.toLocaleString("en", { month: "short", timeZone: "UTC" })}</text>);
      }
    }
  }
  const W = weeks * (cell + gap);
  return (
    <div style={{ overflowX: "auto" }}>
      <svg className="heat" viewBox={`0 0 ${W} ${7 * (cell + gap) + 14}`} width={W} role="img" aria-label="Contribution heatmap for the last 12 months">
        {months}
        {cells}
      </svg>
      <div className="legend" style={{ marginTop: 4 }}>
        <span>Less</span>
        {fills.map((f, i) => (
          <svg key={i} width={11} height={11}><rect width={11} height={11} rx={2} fill={f} /></svg>
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

/** Stacked horizontal bar with an always-visible legend (identity never relies on colour alone). */
export function SplitBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return null;
  return (
    <div>
      <div className="bar" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(", ")}>
        {parts.filter((p) => p.value > 0).map((p) => (
          <span key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.label}: ${p.value}`} />
        ))}
      </div>
      <div className="legend">
        {parts.map((p) => (
          <span key={p.label}>
            <span className="dot" style={{ background: p.color }} /> {p.label} <b className="num">{p.value.toLocaleString()}</b> ({Math.round((p.value / total) * 100)}%)
          </span>
        ))}
      </div>
    </div>
  );
}
