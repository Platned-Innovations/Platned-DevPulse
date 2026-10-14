import Link from "next/link";
import { FilterBar } from "@/components/FilterBar";
import { Sparkline } from "@/components/Charts";
import { CoverageNotice, Delta, EmptyState, fmt, PeriodControls, PLATFORM_LABEL, SetupNotice, ago } from "@/components/ui";
import { parseFilters, type SearchParams } from "@/lib/filters";
import { safe } from "@/lib/safe";
import { getFilterOptions, getHistoryStart, getProjectRankings } from "@/lib/stats";

export const metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const filters = { ...parseFilters(await searchParams), repoId: null };
  const res = await safe(async () => ({ data: await getProjectRankings(filters), opts: await getFilterOptions(), historyStart: await getHistoryStart() }));
  if (!res.ok) return <SetupNotice error={res.error} />;
  const { data, opts, historyStart } = res.data;

  return (
    <div className="fill">
      <div className="page-head">
        <div>
          <h1>Project rankings</h1>
          <p className="muted">Which repositories are most active · {data.range.label}</p>
        </div>
      </div>
      <PeriodControls base="/projects" filters={filters} range={data.range} />
      <CoverageNotice range={data.range} historyStart={historyStart} />
      <div className="toolbar">
        <FilterBar platforms={opts.platforms.map((p) => ({ value: p, label: PLATFORM_LABEL[p] }))} repos={[]} showRepo={false} />
      </div>

      {data.rows.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="card grow">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Project</th>
                  <th className="r">Points</th>
                  <th className="r">Commits</th>
                  <th className="r">PRs merged</th>
                  <th className="r">Reviews</th>
                  <th className="r">Contributors</th>
                  <th>Top contributor</th>
                  <th>Last activity</th>
                  <th>Trend</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.repo.id}>
                    <td className="rank num">{r.rank}</td>
                    <td>
                      <span className={`dot ${r.repo.platform}`} title={PLATFORM_LABEL[r.repo.platform]} />{" "}
                      <Link href={`/projects/${encodeURIComponent(r.repo.id)}`}><b>{r.repo.fullName}</b></Link>
                      {r.repo.language && <span className="chip" style={{ marginLeft: 8 }}>{r.repo.language}</span>}
                      <div><Delta now={r.points} before={r.previousPoints} /></div>
                    </td>
                    <td className="r num points">{fmt(r.points)}</td>
                    <td className="r num">{fmt(r.counts.commit)}</td>
                    <td className="r num">{fmt(r.counts.pr_merged)}</td>
                    <td className="r num">{fmt(r.counts.review)}</td>
                    <td className="r num">{r.contributors}</td>
                    <td>
                      {r.topContributor && (
                        <Link href={`/developers/${r.topContributor.id}`}>{r.topContributor.name}</Link>
                      )}{" "}
                      {r.topContributor && <span className="faint">({Math.round(r.topContributor.share * 100)}%)</span>}
                    </td>
                    <td className="muted nowrap">{r.lastActivity ? ago(r.lastActivity) : "–"}</td>
                    <td><Sparkline data={r.series} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
