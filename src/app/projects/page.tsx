import Link from "next/link";
import { FilterBar } from "@/components/FilterBar";
import { Sparkline } from "@/components/Charts";
import { TableFilter } from "@/components/TableFilter";
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
          <TableFilter
            tableId="projects-table"
            noun="projects"
            placeholder="Search project, language or top contributor"
            filters={[
              { key: "language", label: "Language", options: [...new Set(data.rows.map((r) => r.repo.language).filter((l): l is string => !!l))].sort().map((l) => ({ value: l.toLowerCase().replace(/s+/g, "-"), label: l })) },
              { key: "team", label: "Contributors", options: [{ value: "solo", label: "Single person" }, { value: "team", label: "2 or more" }] },
              { key: "risk", label: "Concentration", options: [{ value: "high", label: "One person does 70%+" }] },
              ...(filters.period === "all" ? [] : [{ key: "trend", label: "Trend vs previous period", options: [{ value: "up", label: "Growing" }, { value: "down", label: "Declining" }, { value: "flat", label: "Unchanged" }] }]),
            ]}
          />
          <div className="table-wrap fit">
            <table id="projects-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Project</th>
                  <th className="r">Points</th>
                  <th className="r">Commits</th>
                  <th className="r">PRs merged</th>
                  <th className="r hide-sm">Reviews</th>
                  <th className="r">Contributors</th>
                  <th className="hide-sm">Top contributor</th>
                  <th className="hide-md">Last activity</th>
                  <th className="hide-md">Trend</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr
                    key={r.repo.id}
                    data-search={`${r.repo.fullName} ${r.repo.language ?? ""} ${r.topContributor?.name ?? ""} ${r.repo.platform}`.toLowerCase()}
                    data-language={(r.repo.language ?? "").toLowerCase().replace(/s+/g, "-")}
                    data-team={r.contributors > 1 ? "team" : "solo"}
                    data-risk={(r.topContributor?.share ?? 0) >= 0.7 ? "high" : "ok"}
                    data-trend={r.previousPoints == null ? "none" : r.points > r.previousPoints ? "up" : r.points < r.previousPoints ? "down" : "flat"}
                  >
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
                    <td className="r num hide-sm">{fmt(r.counts.review)}</td>
                    <td className="r num">{r.contributors}</td>
                    <td className="wrap-cell hide-sm">
                      {r.topContributor && (
                        <Link href={`/developers/${r.topContributor.id}`}>{r.topContributor.name}</Link>
                      )}{" "}
                      {r.topContributor && <span className="faint">({Math.round(r.topContributor.share * 100)}%)</span>}
                    </td>
                    <td className="muted nowrap hide-md">{r.lastActivity ? ago(r.lastActivity) : "–"}</td>
                    <td className="hide-md"><Sparkline data={r.series} /></td>
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
