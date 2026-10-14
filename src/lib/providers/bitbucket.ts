import { bitbucketConfig } from "../config";
import { getJson, HttpError, mapLimit } from "./http";
import type { Provider, RemoteActivity, RemoteActor, RemoteRepo } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

function actorFromUser(u: any): RemoteActor | null {
  if (!u || !(u.account_id || u.uuid)) return null;
  return {
    externalId: String(u.account_id ?? u.uuid),
    username: u.nickname ?? u.display_name ?? "unknown",
    displayName: u.display_name ?? u.nickname ?? "Unknown",
    avatarUrl: u.links?.avatar?.href ?? null,
    email: null,
  };
}

/** Commit `author.raw` looks like `Name <email>`. */
function actorFromCommit(c: any): RemoteActor | null {
  const user = actorFromUser(c.author?.user);
  const m = /^(.*?)\s*<([^>]+)>$/.exec(c.author?.raw ?? "");
  if (user) {
    user.email = m?.[2] ?? null;
    return user;
  }
  if (!m) return null;
  return {
    externalId: `email:${m[2].toLowerCase()}`,
    username: m[2].split("@")[0],
    displayName: m[1] || m[2],
    avatarUrl: null,
    email: m[2],
  };
}

export class BitbucketProvider implements Provider {
  readonly platform = "bitbucket" as const;
  private cfg = bitbucketConfig()!;

  private headers() {
    const auth = this.cfg.accessToken
      ? `Bearer ${this.cfg.accessToken}`
      : `Basic ${Buffer.from(`${this.cfg.username}:${this.cfg.appPassword}`).toString("base64")}`;
    return { Authorization: auth, Accept: "application/json" };
  }

  /** Follows Bitbucket's `next` links; `stop` ends early once items are older than the window. */
  private async paged(url: string, stop?: (page: any[]) => boolean): Promise<any[]> {
    const all: any[] = [];
    let next: string | null = url;
    while (next) {
      const page: { data: any } = await getJson<any>(next, this.headers());
      const data = page.data;
      const values: any[] = data.values ?? [];
      all.push(...values);
      if (stop?.(values)) break;
      next = data.next ?? null;
    }
    return all;
  }

  /** Workspace > project > repository: with BITBUCKET_PROJECTS set, only repos in those projects are kept. */
  private inSelectedProject(workspace: string, projectKey: string | undefined): boolean {
    const wanted = this.cfg.projectFilter;
    if (wanted.length === 0) return true;
    const key = (projectKey ?? "").toUpperCase();
    const ws = workspace.toUpperCase();
    return wanted.some((p) => (p.includes("/") ? p === `${ws}/${key}` : p === key));
  }

  async listRepos(): Promise<RemoteRepo[]> {
    const out: RemoteRepo[] = [];
    for (const ws of this.cfg.workspaces) {
      const repos = await this.paged(`${this.cfg.apiUrl}/repositories/${encodeURIComponent(ws)}?pagelen=100`);
      for (const r of repos) {
        if (!this.inSelectedProject(ws, r.project?.key)) continue;
        if (this.cfg.repoFilter.length && !this.cfg.repoFilter.some((f) => f === r.full_name || f === r.slug)) continue;
        out.push({
          externalId: String(r.uuid),
          owner: ws,
          name: r.slug ?? r.name,
          fullName: r.full_name,
          url: r.links?.html?.href ?? `https://bitbucket.org/${r.full_name}`,
          description: r.description || null,
          language: r.language || null,
          isPrivate: !!r.is_private,
          archived: false,
        });
      }
    }
    return out;
  }

  async fetchActivities(repo: RemoteRepo, since: Date): Promise<RemoteActivity[]> {
    const base = `${this.cfg.apiUrl}/repositories/${repo.fullName}`;
    const out: RemoteActivity[] = [];

    // Commits arrive newest first; stop when the whole page is older than the window.
    const commits = await this.paged(
      `${base}/commits?pagelen=100`,
      (page) => page.length > 0 && page.every((c) => new Date(c.date) < since),
    ).catch((e) => {
      if (e instanceof HttpError && e.status === 404) return [] as any[]; // empty repo
      throw e;
    });
    for (const c of commits) {
      const at = new Date(c.date);
      if (at < since || (c.parents?.length ?? 0) > 1) continue;
      const actor = actorFromCommit(c);
      if (!actor) continue;
      out.push({
        key: `commit:${c.hash}`,
        actor,
        type: "commit",
        occurredAt: at,
        additions: 0,
        deletions: 0,
        title: String(c.message ?? "").split("\n")[0].slice(0, 200),
        url: c.links?.html?.href ?? null,
      });
    }

    const q = encodeURIComponent("state != \"SUPERSEDED\"");
    const prs = await this.paged(
      `${base}/pullrequests?state=OPEN&state=MERGED&state=DECLINED&sort=-updated_on&pagelen=50&q=${q}`,
      (page) => page.length > 0 && page.every((p) => new Date(p.updated_on) < since),
    );
    const recent = prs.filter((p) => new Date(p.updated_on) >= since);

    await mapLimit(recent, 4, async (pr) => {
      const author = actorFromUser(pr.author);
      const title = String(pr.title ?? "").slice(0, 200);
      const url = pr.links?.html?.href ?? null;
      if (author && new Date(pr.created_on) >= since) {
        out.push({ key: `pr_opened:${pr.id}`, actor: author, type: "pr_opened", occurredAt: new Date(pr.created_on), additions: 0, deletions: 0, title, url });
      }
      if (author && pr.state === "MERGED" && new Date(pr.updated_on) >= since) {
        let additions = 0;
        let deletions = 0;
        try {
          const { data } = await getJson<any>(`${base}/pullrequests/${pr.id}/diffstat?pagelen=500`, this.headers());
          for (const f of data.values ?? []) {
            additions += f.lines_added ?? 0;
            deletions += f.lines_removed ?? 0;
          }
        } catch {
          /* diffstat is best-effort */
        }
        // Bitbucket has no dedicated merged_at; updated_on of a merged PR is its merge time.
        out.push({ key: `pr_merged:${pr.id}`, actor: author, type: "pr_merged", occurredAt: new Date(pr.updated_on), additions, deletions, title, url });
      }

      // Approvals count as reviews; comments by someone other than the author count as review comments.
      const activity = await this.paged(`${base}/pullrequests/${pr.id}/activity?pagelen=100`);
      for (const item of activity) {
        if (item.approval) {
          const a = actorFromUser(item.approval.user);
          const at = new Date(item.approval.date);
          if (a && at >= since && a.externalId !== author?.externalId) {
            out.push({ key: `review:${pr.id}:${a.externalId}`, actor: a, type: "review", occurredAt: at, additions: 0, deletions: 0, title, url });
          }
        } else if (item.comment && !item.comment.deleted) {
          const a = actorFromUser(item.comment.user);
          const at = new Date(item.comment.created_on);
          if (a && at >= since && a.externalId !== author?.externalId) {
            out.push({ key: `comment:${item.comment.id}`, actor: a, type: "comment", occurredAt: at, additions: 0, deletions: 0, title: null, url: item.comment.links?.html?.href ?? url });
          }
        }
      }
    });
    return out;
  }
}
