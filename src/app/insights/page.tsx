import Link from "next/link";
import { FilterBar } from "@/components/FilterBar";
import { ActivityBars, SplitBar, WeekdayBars } from "@/components/Charts";
import { Avatar, Delta, EmptyState, fmt, PeriodControls, PLATFORM_LABEL, SetupNotice, Stat } from "@/components/ui";
import { parseFilters, type SearchParams } from "@/lib/filters";
import { safe } from "@/lib/safe";
import { getFilterOptions, getInsights } from "@/lib/stats";

export const metadata = { title: "Insights" };

const COLORS = { github: "var(--github)", bitbucket: "var(--bitbucket)" };

export default async function InsightsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const filters = { ...parseFilters(await searchParams), repoId: null };
  const res = await safe(async () => ({ i: await getInsights(filters), opts: await getFilterOptions() }));
  if (!res.ok) return <SetupNotice error={res.error} />;
  const { i, opts } = res.data;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Team insights</h1>
          <p className="muted">Engagement, achievements and project health · {i.range.label}</p>
        </div>
      </div>
      <PeriodControls base="/insights" filters={filters} range={i.range} />
      <div className="toolbar">
        <FilterBar platforms={opts.platforms.map((p) => ({ value: p, label: PLATFORM_LABEL[p] }))} repos={[]} showRepo={false} />
      </div>

      {i.totals.points === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="grid cols-4" style={{ marginBottom: 16 }}>
            <Stat label="Contribution points" value={fmt(i.totals.points)}><Delta now={i.totals.points} before={i.previousTotals?.points ?? null} /></Stat>
            <Stat label="Active developers" value={i.totals.developers}><Delta now={i.totals.developers} before={i.previousTotals?.developers ?? null} /></Stat>
            <Stat label="Active projects" value={i.totals.repos} />
            <Stat label="Reviews per PR opened" value={i.reviewRatio.toFixed(2)}>
              <span className="faint" style={{ fontSize: 13 }}>{i.reviewRatio >= 1 ? "Healthy review culture" : "Below 1.0 - PRs may be merging with little review"}</span>
            </Stat>
          </div>

          <div className="card">
            <h2>Hall of fame · {i.range.label}</h2>
            <div className="awards">
              {i.awards.map((a) => (
                <div key={a.key} className="award">
                  <span className="ic" aria-hidden>{a.icon}</span>
                  <div>
                    <div className="t">{a.title}</div>
                    <div><Link href={`/developers/${a.winner.id}`}>{a.winner.name}</Link> · <b className="num">{a.value}</b></div>
                    <div className="d">{a.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid cols-2" style={{ marginTop: 16 }}>
            <div className="card" style={{ margin: 0 }}>
              <h2>Team activity (points)</h2>
              <ActivityBars data={i.series} />
            </div>
            <div className="card" style={{ margin: 0 }}>
              <h2>Activity by weekday</h2>
              <WeekdayBars data={i.weekday} />
            </div>
          </div>

          <div className="grid cols-2" style={{ marginTop: 16 }}>
            <div className="card" style={{ margin: 0 }}>
              <h2>Most active projects</h2>
              <ul className="list">
                {i.activeProjects.map((p) => (
                  <li key={p.repo.id}>
                    <span><span className={`dot ${p.repo.platform}`} /> <Link href={`/projects/${encodeURIComponent(p.repo.id)}`}>{p.repo.fullName}</Link></span>
                    <span className="num"><b>{fmt(p.points)}</b> pts · {p.contributors} contributors</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="card" style={{ margin: 0 }}>
              <h2>Trending up</h2>
              {i.trendingProjects.length === 0 ? <p className="muted">No project grew versus the previous period.</p> : (
                <ul className="list">
                  {i.trendingProjects.map((p) => (
                    <li key={p.repo.id}>
                      <span><Link href={`/projects/${encodeURIComponent(p.repo.id)}`}>{p.repo.fullName}</Link></span>
                      <span className="delta up">▲ {fmt(p.delta)} pts</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="grid cols-2" style={{ marginTop: 16 }}>
            <div className="card" style={{ margin: 0 }}>
              <h2>Knowledge concentration</h2>
              <p className="muted" style={{ marginTop: -6 }}>Projects where one person drives 70%+ of the activity.</p>
              {i.concentrationRisks.length === 0 ? <p className="ok-text">No single-person dependencies found.</p> : (
                <ul className="list">
                  {i.concentrationRisks.map((p) => (
                    <li key={p.repo.id}>
                      <span><Link href={`/projects/${encodeURIComponent(p.repo.id)}`}>{p.repo.fullName}</Link></span>
                      <span>{p.topContributor?.name} <b className="num">{Math.round((p.topContributor?.share ?? 0) * 100)}%</b></span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {i.platformSplit.length > 1 && (
              <div className="card" style={{ margin: 0 }}>
                <h2>GitHub vs Bitbucket</h2>
                <SplitBar parts={i.platformSplit.map((s) => ({ label: PLATFORM_LABEL[s.platform], value: s.points, color: COLORS[s.platform] }))} />
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
