import Link from "next/link";
import { FilterBar } from "@/components/FilterBar";
import { Sparkline } from "@/components/Charts";
import { Avatar, CoverageNotice, Delta, EmptyState, fmt, PeriodControls, PlatformChips, PLATFORM_LABEL, RankMove, SetupNotice, Stat } from "@/components/ui";
import { appName } from "@/lib/config";
import { parseFilters, type SearchParams } from "@/lib/filters";
import { safe } from "@/lib/safe";
import { getFilterOptions, getHistoryStart, getLeaderboard } from "@/lib/stats";
import { ACTIVITY_LABELS } from "@/lib/scoring";

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const filters = parseFilters(await searchParams);
  const res = await safe(async () => ({ board: await getLeaderboard(filters), opts: await getFilterOptions(), historyStart: await getHistoryStart() }));
  if (!res.ok) return <SetupNotice error={res.error} />;
  const { board, opts, historyStart } = res.data;
  const { rows, totals, previousTotals, range } = board;
  const podium = rows.slice(0, 3);
  const medals = ["🥇", "🥈", "🥉"];
  const withQuery = (id: string) => `/developers/${id}${filters.period === "month" && !filters.offset ? "" : `?period=${filters.period}&offset=${filters.offset}`}`;

  return (
    <div className="fill">
      <div className="page-head">
        <div>
          <h1>{appName()} Leaderboard</h1>
          <p className="muted">Top contributors across {opts.platforms.map((p) => PLATFORM_LABEL[p]).join(" + ") || "your repositories"} · {range.label}</p>
        </div>
      </div>

      <PeriodControls base="/" filters={filters} range={range} />
      <CoverageNotice range={range} historyStart={historyStart} />
      <div className="toolbar">
        <FilterBar
          platforms={opts.platforms.map((p) => ({ value: p, label: PLATFORM_LABEL[p] }))}
          repos={opts.repos.map((r) => ({ value: r.id, label: r.fullName }))}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="grid cols-4" style={{ marginBottom: 16 }}>
            <Stat label="Contribution points" value={fmt(totals.points)}><Delta now={totals.points} before={previousTotals?.points ?? null} /></Stat>
            <Stat label="Active developers" value={fmt(totals.developers)}><Delta now={totals.developers} before={previousTotals?.developers ?? null} /></Stat>
            <Stat label="PRs merged" value={fmt(totals.counts.pr_merged)}><Delta now={totals.counts.pr_merged} before={previousTotals?.merged ?? null} /></Stat>
            <Stat label="Reviews" value={fmt(totals.counts.review)}><Delta now={totals.counts.review} before={previousTotals?.reviews ?? null} /></Stat>
          </div>

          <div className="podium">
            {[podium[1], podium[0], podium[2]].map((r, slot) => {
              if (!r) return <div key={slot} />;
              const place = slot === 1 ? 0 : slot === 0 ? 1 : 2;
              return (
                <div key={r.developerId} className={`card${place === 0 ? " first" : ""}`}>
                  <span className="medal" aria-label={`Rank ${r.rank}`}>{medals[place]}</span>
                  <Avatar name={r.name} src={r.avatarUrl} size={place === 0 ? "xl" : "lg"} />
                  <Link href={withQuery(r.developerId)}><b>{r.name}</b></Link>
                  <span className="pts num">{fmt(r.points)} pts</span>
                  <span className="muted num pod-extra" style={{ fontSize: 13 }}>
                    {r.counts.commit} commits · {r.counts.pr_merged} merged · {r.counts.review} reviews
                  </span>
                  <span className="pod-extra"><PlatformChips platforms={r.platforms} /></span>
                </div>
              );
            })}
          </div>

          <div className="card grow">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Developer</th>
                    <th className="r">Points</th>
                    <th className="r">{ACTIVITY_LABELS.commit}</th>
                    <th className="r">{ACTIVITY_LABELS.pr_opened}</th>
                    <th className="r">{ACTIVITY_LABELS.pr_merged}</th>
                    <th className="r">{ACTIVITY_LABELS.review}</th>
                    <th className="r">Lines merged</th>
                    <th className="r">Projects</th>
                    <th>Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.developerId}>
                      <td className={`rank num${r.rank <= 3 ? ` r${r.rank}` : ""}`}>{r.rank}</td>
                      <td>
                        <div className="person">
                          <Avatar name={r.name} src={r.avatarUrl} />
                          <div>
                            <Link href={withQuery(r.developerId)}><b>{r.name}</b></Link>
                            <div className="row" style={{ gap: 8 }}>
                              <RankMove rank={r.rank} previous={r.previousRank} />
                              {r.platforms.map((p) => <span key={p} className={`dot ${p}`} title={PLATFORM_LABEL[p]} />)}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="r num points">{fmt(r.points)}</td>
                      <td className="r num">{fmt(r.counts.commit)}</td>
                      <td className="r num">{fmt(r.counts.pr_opened)}</td>
                      <td className="r num">{fmt(r.counts.pr_merged)}</td>
                      <td className="r num">{fmt(r.counts.review)}</td>
                      <td className="r num muted">+{fmt(r.additions)} / −{fmt(r.deletions)}</td>
                      <td className="r num">{r.repoCount}</td>
                      <td><Sparkline data={r.series} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
