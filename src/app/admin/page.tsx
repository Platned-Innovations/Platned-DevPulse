import Link from "next/link";
import { SyncPoller } from "@/components/SyncPoller";
import { Avatar, fmt, PLATFORM_LABEL, SetupNotice } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { appName, bitbucketConfig, dbConfig, githubConfig, syncConfig } from "@/lib/config";
import { getStore } from "@/lib/db";
import { listDevelopersWithIdentities, suggestMerges } from "@/lib/identities";
import { safe } from "@/lib/safe";
import { ACTIVITY_LABELS } from "@/lib/scoring";
import { getWeights } from "@/lib/stats";
import { isSyncing } from "@/lib/sync";
import { ACTIVITY_TYPES } from "@/lib/types";
import { logoutAction, mergeAction, renameDeveloperAction, saveWeightsAction, setHiddenAction, setRepoEnabledAction, startSyncAction, syncRepoAction, unlinkAction } from "./actions";

export const metadata = { title: "Admin" };

const TABS = [
  { key: "overview", label: "Overview & sync" },
  { key: "developers", label: "Developers & merging" },
  { key: "repos", label: "Repositories" },
  { key: "scoring", label: "Scoring" },
];

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "overview";
  const syncing = isSyncing();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{appName()} admin</h1>
          <p className="muted">Manage data sources, developer identities and scoring.</p>
        </div>
        <form action={logoutAction}><button>Sign out</button></form>
      </div>

      <nav className="tabs sub-tabs" aria-label="Admin sections">
        {TABS.map((t) => (
          <Link key={t.key} href={`/admin?tab=${t.key}`} aria-current={t.key === tab}>{t.label}</Link>
        ))}
      </nav>
      {sp.ok && <p className="ok-text" role="status">{sp.ok}</p>}
      {sp.error && <p className="error-text" role="alert">{sp.error}</p>}

      <SyncPoller active={syncing} />
      {tab === "overview" && <Overview syncing={syncing} />}
      {tab === "developers" && <Developers />}
      {tab === "repos" && <Repos />}
      {tab === "scoring" && <Scoring />}
    </>
  );
}

async function Overview({ syncing }: { syncing: boolean }) {
  const res = await safe(async () => (await getStore()).listSyncRuns(10));
  if (!res.ok) return <SetupNotice error={res.error} />;
  const db = dbConfig();
  const gh = githubConfig();
  const bb = bitbucketConfig();
  const { intervalMinutes, lookbackDays } = syncConfig();
  const runs = res.data;

  return (
    <>
      <div className="grid cols-3">
        <div className="card" style={{ margin: 0 }}>
          <h2>Database</h2>
          <p><b>{db?.kind === "postgres" ? "PostgreSQL" : "MongoDB"}</b></p>
        </div>
        <div className="card" style={{ margin: 0 }}>
          <h2>Platforms</h2>
          <p><span className={`dot github`} /> GitHub: {gh ? <b>{gh.orgs.join(", ")}</b> : <span className="muted">not configured</span>}</p>
          <p><span className={`dot bitbucket`} /> Bitbucket: {bb ? <><b>{bb.workspaces.join(", ")}</b>{bb.projectFilter.length > 0 && <span className="muted"> · projects {bb.projectFilter.join(", ")}</span>}</> : <span className="muted">not configured</span>}</p>
          {gh && bb && <p className="faint" style={{ fontSize: 13 }}>Both configured: stats are summed per developer.</p>}
        </div>
        <div className="card" style={{ margin: 0 }}>
          <h2>Schedule</h2>
          <p>{intervalMinutes > 0 ? <>Every <b>{intervalMinutes}</b> min</> : "Automatic sync off"}</p>
          <p className="faint" style={{ fontSize: 13 }}>First sync looks back {lookbackDays} days.</p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="row spread">
          <h2 style={{ margin: 0 }}>Sync</h2>
          <form action={startSyncAction}>
            <input type="hidden" name="mode" value="incremental" />
            <button className="primary" disabled={syncing || (!gh && !bb)}>{syncing ? "Sync running…" : "Sync now"}</button>
          </form>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <form action={startSyncAction} className="row" style={{ gap: 6 }}>
            <input type="hidden" name="mode" value="full" />
            <label className="muted" htmlFor="full-days">Full re-sync, last</label>
            <select id="full-days" name="days" defaultValue={String(lookbackDays)}>
              {[...new Set([30, 90, 180, 365, lookbackDays])].sort((a, b) => a - b).map((d) => <option key={d} value={d}>{d} days</option>)}
            </select>
            <button disabled={syncing || (!gh && !bb)} title="Re-reads the whole window for every enabled repository (safe: no duplicates)">Run</button>
          </form>
          <form action={startSyncAction}>
            <input type="hidden" name="mode" value="discover" />
            <button disabled={syncing || (!gh && !bb)} title="Looks for new repositories without reading their activity">Discover repositories</button>
          </form>
        </div>
        <p className="faint" style={{ fontSize: 13 }}>
          Automatic sync {intervalMinutes > 0 ? <>runs every {intervalMinutes} min</> : "is off"}. <b>Sync now</b> reads what is new since each repository's last sync; <b>Full re-sync</b> re-reads the chosen window; individual repositories can be synced from the Repositories tab.
        </p>
        {!gh && !bb && <p className="error-text">No platform is configured. Set GitHub and/or Bitbucket variables.</p>}
        {runs.length === 0 ? <p className="muted">No sync has run yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Started (UTC)</th><th>Trigger</th><th>Status</th><th className="r">Repos</th><th className="r">Activities</th><th>Notes</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="num">{r.startedAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                    <td>{r.trigger}</td>
                    <td><span className={`status ${r.status}`}>{r.status}</span></td>
                    <td className="r num">{r.repos}</td>
                    <td className="r num">{fmt(r.activities)}</td>
                    <td className="wrap-cell muted" style={{ maxWidth: 420 }}>{r.errors.slice(0, 3).join(" · ")}{r.errors.length > 3 ? ` (+${r.errors.length - 3} more)` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

async function Developers() {
  const res = await safe(listDevelopersWithIdentities);
  if (!res.ok) return <SetupNotice error={res.error} />;
  const devs = res.data;
  const suggestions = suggestMerges(devs);
  const options = devs.map((d) => (
    <option key={d.developer.id} value={d.developer.id}>
      {d.developer.displayName} ({d.identities.map((i) => `${PLATFORM_LABEL[i.platform]}:${i.username}`).join(", ")})
    </option>
  ));

  return (
    <>
      <div className="card">
        <h2>Merge developers</h2>
        <p className="muted" style={{ marginTop: -6 }}>
          The same person often has different IDs on GitHub and Bitbucket. Merging combines their accounts into one record: from now on, past and future stats from every linked account are summed under one name.
        </p>
        <form action={mergeAction} className="row">
          <label className="row" style={{ gap: 6 }}>
            <span>Merge</span>
            <select name="source" required defaultValue="">
              <option value="" disabled>Select developer…</option>
              {options}
            </select>
          </label>
          <label className="row" style={{ gap: 6 }}>
            <span>into</span>
            <select name="target" required defaultValue="">
              <option value="" disabled>Select the record to keep…</option>
              {options}
            </select>
          </label>
          <button className="primary">Merge</button>
        </form>
      </div>

      {suggestions.length > 0 && (
        <div className="card">
          <h2>Suggested merges</h2>
          <ul className="list">
            {suggestions.map((s) => (
              <li key={`${s.a.developer.id}${s.b.developer.id}`}>
                <span>
                  <b>{s.a.developer.displayName}</b> ({s.a.identities.map((i) => `${PLATFORM_LABEL[i.platform]}:${i.username}`).join(", ")}) ↔{" "}
                  <b>{s.b.developer.displayName}</b> ({s.b.identities.map((i) => `${PLATFORM_LABEL[i.platform]}:${i.username}`).join(", ")}) <span className="faint">· {s.reason}</span>
                </span>
                <form action={mergeAction}>
                  <input type="hidden" name="target" value={s.a.developer.id} />
                  <input type="hidden" name="source" value={s.b.developer.id} />
                  <button>Merge</button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <h2>All developers ({devs.length})</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Developer</th><th>Linked accounts</th><th>Visibility</th></tr></thead>
            <tbody>
              {devs.map(({ developer: d, identities }) => (
                <tr key={d.id}>
                  <td>
                    <div className="person">
                      <Avatar name={d.displayName} src={d.avatarUrl} />
                      <form action={renameDeveloperAction} className="row" style={{ gap: 6 }}>
                        <input type="hidden" name="id" value={d.id} />
                        <input type="text" name="name" defaultValue={d.displayName} aria-label="Display name" style={{ width: 170 }} />
                        <button>Rename</button>
                      </form>
                    </div>
                  </td>
                  <td className="wrap-cell">
                    {identities.map((i) => (
                      <div key={i.id} className="row" style={{ gap: 8, marginBottom: 4 }}>
                        <span className="chip"><span className={`dot ${i.platform}`} /> {PLATFORM_LABEL[i.platform]} · {i.username}{i.email ? ` · ${i.email}` : ""}</span>
                        {identities.length > 1 && (
                          <form action={unlinkAction}>
                            <input type="hidden" name="identity" value={i.id} />
                            <button className="danger" title="Split this account into its own developer">Unlink</button>
                          </form>
                        )}
                      </div>
                    ))}
                  </td>
                  <td>
                    <form action={setHiddenAction}>
                      <input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="hidden" value={String(!d.hidden)} />
                      <button title="Hidden developers are excluded from every ranking (bots, alumni)">{d.hidden ? "Hidden - show" : "Visible - hide"}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

async function Repos() {
  const res = await safe(async () => (await getStore()).listRepositories());
  if (!res.ok) return <SetupNotice error={res.error} />;
  return (
    <div className="card">
      <h2>Repositories ({res.data.length})</h2>
      <p className="muted" style={{ marginTop: -6 }}>Disabled repositories are skipped by sync and excluded from all rankings.</p>
      {res.data.length === 0 ? <p className="muted">None discovered yet. Run a sync.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Repository</th><th>Platform</th><th>Last synced</th><th>Tracking</th><th>Manual sync</th></tr></thead>
            <tbody>
              {res.data.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.fullName}</b> {r.isPrivate && <span className="chip">private</span>} {r.archived && <span className="chip">archived</span>}</td>
                  <td><span className={`dot ${r.platform}`} /> {PLATFORM_LABEL[r.platform]}</td>
                  <td className="muted num">{r.lastSyncedAt ? r.lastSyncedAt.toISOString().slice(0, 16).replace("T", " ") : "never"}</td>
                  <td>
                    <form action={setRepoEnabledAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="enabled" value={String(!r.enabled)} />
                      <button>{r.enabled ? "Enabled - disable" : "Disabled - enable"}</button>
                    </form>
                  </td>
                  <td>
                    <form action={syncRepoAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <button disabled={!r.enabled || isSyncing()} title={r.enabled ? "Re-read this repository's recent history now" : "Enable the repository first"}>Sync now</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

async function Scoring() {
  const res = await safe(getWeights);
  if (!res.ok) return <SetupNotice error={res.error} />;
  return (
    <div className="card" style={{ maxWidth: 520 }}>
      <h2>Scoring weights</h2>
      <p className="muted" style={{ marginTop: -6 }}>Points awarded per activity. Changes apply to every period immediately, including history.</p>
      <form action={saveWeightsAction}>
        <ul className="list">
          {ACTIVITY_TYPES.map((t) => (
            <li key={t} style={{ alignItems: "center" }}>
              <label htmlFor={`w-${t}`}>{ACTIVITY_LABELS[t]}</label>
              <input id={`w-${t}`} name={t} type="number" min={0} max={1000} step="0.5" defaultValue={res.data[t]} style={{ width: 90 }} />
            </li>
          ))}
        </ul>
        <p><button className="primary">Save weights</button></p>
      </form>
    </div>
  );
}
