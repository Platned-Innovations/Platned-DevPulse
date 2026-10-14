import Link from "next/link";
import { notFound } from "next/navigation";
import { ActivityBars, Heatmap, SplitBar } from "@/components/Charts";
import { Avatar, fmt, PeriodControls, PlatformChips, PLATFORM_LABEL, SetupNotice, Stat } from "@/components/ui";
import { parseFilters, type SearchParams } from "@/lib/filters";
import { safe } from "@/lib/safe";
import { ACTIVITY_LABELS } from "@/lib/scoring";
import { getDeveloperProfile } from "@/lib/stats";

const COLORS = { github: "var(--github)", bitbucket: "var(--bitbucket)" };

export default async function DeveloperPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  const filters = parseFilters(await searchParams);
  const res = await safe(() => getDeveloperProfile(id, filters));
  if (!res.ok) return <SetupNotice error={res.error} />;
  if (!res.data) notFound();
  const p = res.data;
  const r = p.row;

  return (
    <>
      <p><Link href="/" className="muted">← Leaderboard</Link></p>
      <div className="page-head">
        <div className="row" style={{ gap: 18 }}>
          <Avatar name={p.developer.displayName} src={p.developer.avatarUrl} size="xl" />
          <div>
            <h1>{p.developer.displayName}</h1>
            <p className="muted">
              {r ? <>Rank <b>#{r.rank}</b> of {p.totalDevelopers} · {p.range.label}</> : <>No activity in {p.range.label}</>}
            </p>
            <div className="row" style={{ marginTop: 8 }}>
              {p.identities.map((i) => (
                <span key={i.id} className="chip" title={i.email ?? undefined}>
                  <span className={`dot ${i.platform}`} /> {PLATFORM_LABEL[i.platform]} · {i.username}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <PeriodControls base={`/developers/${id}`} filters={filters} range={p.range} />

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat label="Points" value={fmt(r?.points ?? 0)} />
        <Stat label="Commits" value={fmt(r?.counts.commit ?? 0)} />
        <Stat label="PRs merged" value={fmt(r?.counts.pr_merged ?? 0)} />
        <Stat label="Reviews" value={fmt(r?.counts.review ?? 0)} />
        <Stat label="PRs opened" value={fmt(r?.counts.pr_opened ?? 0)} />
        <Stat label="Lines merged" value={`+${fmt(r?.additions ?? 0)} / −${fmt(r?.deletions ?? 0)}`} />
        <Stat label="Active days" value={fmt(r?.activeDays ?? 0)} />
        <Stat label="Longest streak" value={`${r?.streak ?? 0} d`} />
      </div>

      {(p.awards.length > 0 || p.milestones.length > 0) && (
        <div className="card">
          <h2>Achievements</h2>
          <div className="awards">
            {p.awards.map((a) => (
              <div key={a.key} className="award">
                <span className="ic" aria-hidden>{a.icon}</span>
                <div><div className="t">{a.title} · {p.range.label}</div><div className="d">{a.description} ({a.value})</div></div>
              </div>
            ))}
            {p.milestones.map((m) => (
              <div key={m.key} className="award">
                <span className="ic" aria-hidden>{m.icon}</span>
                <div><div className="t">{m.title}</div><div className="d">Lifetime: {fmt(m.progress)}</div></div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h2>Contribution activity · last 12 months</h2>
        <Heatmap data={p.heat} />
      </div>

      <div className="card">
        <h2>Points over {p.range.label}</h2>
        <ActivityBars data={p.series} />
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="card" style={{ margin: 0 }}>
          <h2>By project</h2>
          {p.perRepo.length === 0 ? <p className="muted">Nothing in this period.</p> : (
            <ul className="list">
              {p.perRepo.slice(0, 10).map((x) => (
                <li key={x.repo.id}>
                  <span><span className={`dot ${x.repo.platform}`} /> <Link href={`/projects/${encodeURIComponent(x.repo.id)}`}>{x.repo.fullName}</Link></span>
                  <span className="num"><b>{fmt(x.points)}</b> pts</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card" style={{ margin: 0 }}>
          <h2>By platform</h2>
          {p.perPlatform.length === 0 ? <p className="muted">Nothing in this period.</p> : (
            <SplitBar parts={p.perPlatform.map((x) => ({ label: PLATFORM_LABEL[x.platform], value: x.points, color: COLORS[x.platform] }))} />
          )}
          <h2 style={{ marginTop: 18 }}>Lifetime</h2>
          <p className="muted num">
            {fmt(p.lifetime.points)} pts · {fmt(p.lifetime.counts.commit)} commits · {fmt(p.lifetime.counts.pr_merged)} PRs merged · {fmt(p.lifetime.counts.review)} reviews · {p.lifetime.repos} projects
          </p>
          <PlatformChips platforms={p.identities.map((i) => i.platform).filter((v, i, a) => a.indexOf(v) === i)} />
        </div>
      </div>

      <div className="card">
        <h2>Recent activity</h2>
        {p.recent.length === 0 ? <p className="muted">Nothing in this period.</p> : (
          <ul className="list">
            {p.recent.map((x, i) => (
              <li key={i}>
                <span>
                  <span className="chip">{ACTIVITY_LABELS[x.type]}</span>{" "}
                  {x.url ? <a href={x.url} target="_blank" rel="noreferrer noopener">{x.title}</a> : x.title}{" "}
                  <span className="faint">· {x.repoName}</span>
                </span>
                <span className="faint num">{new Date(x.at).toISOString().slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
