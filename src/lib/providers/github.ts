import { githubConfig } from "../config";
import { getJson, HttpError, mapLimit } from "./http";
import type { Provider, RemoteActivity, RemoteActor, RemoteRepo } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

function nextLink(h: Headers): string | null {
  const m = /<([^>]+)>;\s*rel="next"/.exec(h.get("link") ?? "");
  return m ? m[1] : null;
}

function actorFromUser(u: any): RemoteActor | null {
  if (!u || !u.login || u.type === "Bot" || /\[bot\]$/.test(u.login)) return null;
  return {
    externalId: String(u.id),
    username: u.login,
    displayName: u.name ?? u.login,
    avatarUrl: u.avatar_url ?? null,
    email: null,
  };
}

export class GitHubProvider implements Provider {
  readonly platform = "github" as const;
  private cfg = githubConfig()!;

  private headers() {
    return {
      Authorization: `Bearer ${this.cfg.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "devpulse",
    };
  }

  /** Follows pagination; `stop` lets callers end early once items are older than the window. */
  private async paged<T = any>(url: string, stop?: (page: T[]) => boolean): Promise<T[]> {
    const all: T[] = [];
    let next: string | null = url;
    while (next) {
      const { data, headers } = await getJson<T[]>(next, this.headers());
      all.push(...data);
      if (stop?.(data)) break;
      next = nextLink(headers);
    }
    return all;
  }

  async listRepos(): Promise<RemoteRepo[]> {
    const out: RemoteRepo[] = [];
    for (const org of this.cfg.orgs) {
      // Orgs first; fall back to a user account namespace.
      let repos: any[];
      try {
        repos = await this.paged(`${this.cfg.apiUrl}/orgs/${encodeURIComponent(org)}/repos?per_page=100&type=all`);
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) {
          repos = await this.paged(`${this.cfg.apiUrl}/users/${encodeURIComponent(org)}/repos?per_page=100`);
        } else throw e;
      }
      for (const r of repos) {
        if (this.cfg.repoFilter.length && !this.cfg.repoFilter.some((f) => f === r.full_name || f === r.name)) continue;
        out.push({
          externalId: String(r.id),
          owner: r.owner.login,
          name: r.name,
          fullName: r.full_name,
          url: r.html_url,
          description: r.description ?? null,
          language: r.language ?? null,
          isPrivate: !!r.private,
          archived: !!r.archived,
        });
      }
    }
    return out;
  }

  async fetchActivities(repo: RemoteRepo, since: Date): Promise<RemoteActivity[]> {
    const base = `${this.cfg.apiUrl}/repos/${repo.fullName}`;
    const out: RemoteActivity[] = [];
    const sinceIso = since.toISOString();

    // Commits (merge commits excluded: they are not authored work).
    const commits = await this.paged(`${base}/commits?per_page=100&since=${sinceIso}`).catch((e) => {
      // 409 = empty repository
      if (e instanceof HttpError && e.status === 409) return [] as any[];
      throw e;
    });
    for (const c of commits) {
      if ((c.parents?.length ?? 0) > 1) continue;
      let actor = actorFromUser(c.author);
      if (!actor) {
        if (c.author && (c.author.type === "Bot" || /\[bot\]$/.test(c.author.login ?? ""))) continue;
        const email: string | undefined = c.commit?.author?.email;
        if (!email) continue;
        // "12345+login@users.noreply.github.com" identifies the GitHub account even when the API
        // did not link the commit to it.
        const noreply = /^(\d+)\+([^@]+)@users\.noreply\.github\.com$/i.exec(email);
        actor = {
          externalId: noreply ? noreply[1] : `email:${email.toLowerCase()}`,
          username: noreply ? noreply[2] : email.split("@")[0],
          displayName: c.commit.author.name ?? email,
          avatarUrl: null,
          email,
        };
      } else {
        actor.email = c.commit?.author?.email ?? null;
        actor.displayName = c.commit?.author?.name || actor.displayName;
      }
      out.push({
        key: `commit:${c.sha}`,
        actor,
        type: "commit",
        occurredAt: new Date(c.commit.author?.date ?? c.commit.committer.date),
        additions: 0,
        deletions: 0,
        title: String(c.commit.message ?? "").split("\n")[0].slice(0, 200),
        url: c.html_url ?? null,
      });
    }

    // Pull requests, newest-updated first; stop once a page is entirely older than the window.
    const prs = await this.paged<any>(
      `${base}/pulls?state=all&sort=updated&direction=desc&per_page=100`,
      (page) => page.length > 0 && page.every((p) => new Date(p.updated_at) < since),
    );
    const recent = prs.filter((p) => new Date(p.updated_at) >= since);

    await mapLimit(recent, 4, async (pr) => {
      const prUrl = pr.html_url as string;
      const author = actorFromUser(pr.user);
      const title = String(pr.title ?? "").slice(0, 200);
      if (author && new Date(pr.created_at) >= since) {
        out.push({ key: `pr_opened:${pr.number}`, actor: author, type: "pr_opened", occurredAt: new Date(pr.created_at), additions: 0, deletions: 0, title, url: prUrl });
      }
      if (author && pr.merged_at && new Date(pr.merged_at) >= since) {
        const { data: detail } = await getJson<any>(`${base}/pulls/${pr.number}`, this.headers());
        out.push({
          key: `pr_merged:${pr.number}`,
          actor: author,
          type: "pr_merged",
          occurredAt: new Date(pr.merged_at),
          additions: detail.additions ?? 0,
          deletions: detail.deletions ?? 0,
          title,
          url: prUrl,
        });
      }
      const reviews = await this.paged<any>(`${base}/pulls/${pr.number}/reviews?per_page=100`);
      for (const r of reviews) {
        const reviewer = actorFromUser(r.user);
        if (!reviewer || !r.submitted_at || r.state === "PENDING" || r.state === "DISMISSED") continue;
        if (reviewer.externalId === author?.externalId) continue; // self-review doesn't count
        const at = new Date(r.submitted_at);
        if (at < since) continue;
        out.push({ key: `review:${r.id}`, actor: reviewer, type: "review", occurredAt: at, additions: 0, deletions: 0, title, url: r.html_url ?? prUrl });
      }
    });

    // Inline review comments across the repository.
    const comments = await this.paged<any>(`${base}/pulls/comments?per_page=100&sort=created&direction=desc&since=${sinceIso}`);
    for (const c of comments) {
      const a = actorFromUser(c.user);
      if (!a || new Date(c.created_at) < since) continue;
      out.push({ key: `comment:${c.id}`, actor: a, type: "comment", occurredAt: new Date(c.created_at), additions: 0, deletions: 0, title: null, url: c.html_url ?? null });
    }
    return out;
  }
}
