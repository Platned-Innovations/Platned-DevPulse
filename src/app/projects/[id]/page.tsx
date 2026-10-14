import Link from "next/link";
import { notFound } from "next/navigation";
import { ActivityBars } from "@/components/Charts";
import { Avatar, EmptyState, fmt, PeriodControls, PLATFORM_LABEL, SetupNotice, Stat } from "@/components/ui";
import { parseFilters, type SearchParams } from "@/lib/filters";
import { safe } from "@/lib/safe";
import { ACTIVITY_LABELS } from "@/lib/scoring";
import { getProjectDetail } from "@/lib/stats";

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const id = decodeURIComponent((await params).id);
  const filters = { ...parseFilters(await searchParams), repoId: null };
  const res = await safe(() => getProjectDetail(id, filters));
  if (!res.ok) return <SetupNotice error={res.error} />;
  if (!res.data) notFound();
  const { repo, board, series, recent } = res.data;

  return (
    <>
      <p><Link href="/projects" className="muted">← Projects</Link></p>
      <div className="page-head">
        <div>
          <h1><span className={`dot ${repo.platform}`} /> {repo.fullName}</h1>
          <p className="muted">
            {PLATFORM_LABEL[repo.platform]}
            {repo.language ? ` · ${repo.language}` : ""} · <a href={repo.url} target="_blank" rel="noreferrer noopener">Open repository ↗</a>
          </p>
          {repo.description && <p className="muted">{repo.description}</p>}
        </div>
      </div>
      <PeriodControls base={`/projects/${encodeURIComponent(id)}`} filters={filters} range={board.range} />

      {board.rows.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="grid cols-4" style={{ marginBottom: 16 }}>
            <Stat label="Points" value={fmt(board.totals.points)} />
            <Stat label="Contributors" value={board.totals.developers} />
            <Stat label="Commits" value={fmt(board.totals.counts.commit)} />
            <Stat label="PRs merged" value={fmt(board.totals.counts.pr_merged)} />
          </div>
          <div className="card">
            <h2>Points over time</h2>
            <ActivityBars data={series} />
          </div>
          <div className="card">
            <h2>Contributors</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>#</th><th>Developer</th><th className="r">Points</th><th className="r">Commits</th><th className="r">PRs merged</th><th className="r">Reviews</th></tr>
                </thead>
                <tbody>
                  {board.rows.map((r) => (
                    <tr key={r.developerId}>
                      <td className="rank num">{r.rank}</td>
                      <td><div className="person"><Avatar name={r.name} src={r.avatarUrl} /><Link href={`/developers/${r.developerId}`}><b>{r.name}</b></Link></div></td>
                      <td className="r num points">{fmt(r.points)}</td>
                      <td className="r num">{fmt(r.counts.commit)}</td>
                      <td className="r num">{fmt(r.counts.pr_merged)}</td>
                      <td className="r num">{fmt(r.counts.review)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card">
            <h2>Recent activity</h2>
            <ul className="list">
              {recent.map((x, i) => (
                <li key={i}>
                  <span>
                    <span className="chip">{ACTIVITY_LABELS[x.type]}</span>{" "}
                    {x.url ? <a href={x.url} target="_blank" rel="noreferrer noopener">{x.title}</a> : x.title}{" "}
                    <span className="faint">· {x.developerName}</span>
                  </span>
                  <span className="faint num">{new Date(x.at).toISOString().slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </>
  );
}
