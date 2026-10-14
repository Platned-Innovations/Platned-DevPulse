# DevPulse

A unified developer contribution leaderboard for **GitHub** and **Bitbucket**. It tracks commits, pull requests, merged changes, code reviews and review comments across your company's repositories, then ranks developers and projects by day, week, month, quarter, year or all time.

The app is branded **`<COMPANY_NAME> DevPulse`** (set `COMPANY_NAME`; without it the name is just "DevPulse").

## Features

- **Unified leaderboard** with podium, rank movement vs the previous period, trend sparklines and a platform / project filter.
- **Time-based rankings**: daily, weekly, monthly, quarterly, yearly, all time, with previous/next period stepping.
- **Project rankings** and per-project pages: contributors, activity chart, top contributor, last activity.
- **Developer profiles**: 12-month heatmap, project and platform breakdown, lifetime totals, achievements and milestones.
- **Team insights**: hall of fame (MVP, Commit King, Merge Master, Review Champion, Heavy Lifter, Streak Keeper, Explorer, Rising Star, Bridge Builder), trending projects, weekday pattern, review-per-PR ratio, knowledge-concentration warnings, GitHub vs Bitbucket split.
- **One or both platforms**: configure GitHub, Bitbucket, or both. With both, each developer's stats are summed.
- **Identity merging (admin)**: the same person usually has different IDs on each platform. Admin merges them (suggestions are offered by matching email, username or name); stats from all linked accounts then show as one record, retroactively and on every future sync. Accounts can be unlinked again. The admin can also mark one linked account as **primary**; its picture is used on the leaderboard.
- **Admin-only login**: no end-user accounts. The leaderboard is open; the admin area manages sync, merging, hiding bots/alumni, enabling repositories and the scoring weights.
- **Automatic sync**: a background schedule plus a manual "Sync now" in the admin area.

### Which branch is read

Work is usually merged into a development branch, while the default branch (often `main`/`PROD`) only receives release merges by a few leads. DevPulse therefore reads, **per repository**:

- **commits** on the chosen branch, and
- **pull requests that target that branch** (with their reviews and review comments).

By default the branch is picked automatically: `develop`, `dev` or `development` if one exists (case-insensitive), otherwise `main`, `master`, `prod` or `production`, otherwise the repository's default branch. Change the order with `BRANCH_PRIORITY` (comma-separated). In **Admin > Repositories** the **Branch read** column lets you choose any branch instead; saving re-reads that repository from the new branch and **replaces** what was stored from the old one. Branch lists refresh on every sync (or with **Discover repositories**).

### Scoring

Default points: commit 1, PR opened 3, PR merged 5, review 4, review comment 1. Editable by the admin (applies to history immediately). Merge commits, bot accounts and self-reviews are ignored.

## Run it (one command)

Next.js serves the UI and the API/background sync from a single process.

```bash
npm install
cp .env.example .env.local     # fill in the values
npm run dev                    # development: http://localhost:3000
npm run serve                  # production: build + start
```

### Startup, first sync and migration

On every start the app connects to the database and creates/updates the schema. If the database has **no activity yet** and GitHub and/or Bitbucket credentials are configured, the **first real sync** starts in the background. No demo or fake data is ever loaded. Set `AUTO_SEED=false` to disable that automatic first sync.

| Command | What it does |
| --- | --- |
| `npm run migrate` | Creates/updates the schema only (idempotent). |
| "Sync now" / "Stop" (admin) | Pulls real data from the configured platforms; Stop halts a running sync at its next step (finished repositories keep their data). |

## Configuration

See [.env.example](.env.example) for every variable.

| Area | Variables |
| --- | --- |
| Branding | `COMPANY_NAME` |
| Database (**one of**) | `POSTGRES_URL` **or** `MONGODB_URI` (PostgreSQL wins if both are set) |
| GitHub | `GITHUB_TOKEN`, `GITHUB_ORGS` (optional `GITHUB_REPOS`, `GITHUB_API_URL`) |
| Bitbucket Cloud | `BITBUCKET_WORKSPACES` + (`BITBUCKET_USERNAME` + `BITBUCKET_APP_PASSWORD`) or `BITBUCKET_ACCESS_TOKEN`; optional `BITBUCKET_PROJECTS`, `BITBUCKET_REPOS` |
| Sync | `SYNC_INTERVAL_MINUTES` (0 = off), `SYNC_LOOKBACK_DAYS` |
| Admin | `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_SECRET` (16+ chars) |

Tables, collections and indexes are created automatically on first start for both databases. All times are UTC; weeks start on Monday.

## Deploying to Azure Web Apps (Linux, Node 22)

1. **Create** a Web App (Linux, Node 22 LTS). Turn **Always On** on (the background sync runs in-process) and keep **one instance** (extra instances would each sync; if you scale out, set `SYNC_INTERVAL_MINUTES=0` on the extras: syncing is idempotent, so it is only wasteful).
2. **Database**: Azure Database for PostgreSQL (use `?sslmode=require`) or Azure Cosmos DB for MongoDB / MongoDB Atlas. For Cosmos DB RU accounts add `retrywrites=false` to the URI.
3. **App settings** (Configuration > Application settings): everything from `.env.example` that applies. Also set `SCM_DO_BUILD_DURING_DEPLOYMENT=false` (the package is already built). `PORT` and `HOSTNAME` need no setting: the bundled starter binds to all interfaces and defaults to Azure's port 8080.
4. **Startup command**: leave empty or use `npm start` (both run `node start.cjs`). Do **not** deploy the repository root with `next start`; deploy the `dist/` bundle below.
5. **Health check** path: `/api/health` (use `/api/health?deep=1` to also verify the database).
6. **Deploy**: the included workflow [.github/workflows/azure-webapp.yml](.github/workflows/azure-webapp.yml) builds the standalone bundle and deploys it (secret `AZURE_WEBAPP_PUBLISH_PROFILE`, variable `AZURE_WEBAPP_NAME`). Manually: `npm run build:standalone`, then zip-deploy the **contents** of the `dist/` folder (so `package.json` and `start.cjs` sit at the root of the zip).
   Alternative: a container image from the included `Dockerfile` (listens on `PORT`, default 8080; set `WEBSITES_PORT=8080`).
7. If you serve the app through a custom domain or proxy that rewrites the Host header, set `ALLOWED_ORIGINS=app.example.com`.

HTTPS is terminated by Azure; the admin session cookie is `Secure`, `HttpOnly` and `SameSite=Lax`.

## Getting credentials

Keep tokens in `.env` / Azure app settings only. Never commit them or paste them into chats. Prefer a service or bot account over a personal one, so the data does not depend on one person's access.

### GitHub token

1. Open **GitHub > Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token** (direct link: https://github.com/settings/personal-access-tokens/new). For organisation repositories set **Resource owner** to the organisation.
2. Choose **All repositories**, or only the ones to track.
3. Under **Repository permissions** set **Read-only** for **Contents**, **Pull requests** and **Metadata** (Metadata is added automatically).
4. Generate and copy the token (shown once). If the organisation requires approval for fine-grained tokens, an org owner must approve it.
5. If fine-grained tokens are blocked, use a classic token with the `repo` scope and authorise it for SSO when the organisation uses SSO.

```
GITHUB_TOKEN=<token>
GITHUB_ORGS=<org-login>[,<another-org>]
# GitHub Enterprise Server only: GITHUB_API_URL=https://<host>/api/v3
```

### Bitbucket Cloud token

**Option A: Atlassian API token (tied to a user account)**

1. Sign in as the account that will own the token and open https://id.atlassian.com/manage-profile/security/api-tokens.
2. Click **Create API token with scopes**, choose **Bitbucket**, and select these scopes: `read:repository:bitbucket`, `read:pullrequest:bitbucket`, `read:workspace:bitbucket`, `read:user:bitbucket`.
3. Copy the token (shown once). The account must have access to the repositories to track.

```
BITBUCKET_WORKSPACES=<workspace-slug>
BITBUCKET_USERNAME=<Atlassian account email>
BITBUCKET_APP_PASSWORD=<API token>     # BITBUCKET_API_TOKEN is accepted as an alias
```

The workspace slug is the part of the URL after `bitbucket.org/`.

**Narrowing the scope (workspace > project > repositories).** By default every repository in the workspace is tracked. Optionally limit it:

```
BITBUCKET_PROJECTS=PLAT,WEB          # project keys; or workspace-qualified: acme/PLAT
BITBUCKET_REPOS=api-gateway,billing  # optional: only these repos (within the selected projects)
```

A project key is the short uppercase key shown in the project's URL and settings. Each filter only narrows the previous one.

**Option B: workspace access token (not tied to a person)**

Bitbucket > **Workspace settings > Security > Access tokens > Create**, with Read for Repositories and Pull requests (may require a paid plan).

```
BITBUCKET_WORKSPACES=<workspace-slug>
BITBUCKET_ACCESS_TOKEN=<token>
```

`admin.atlassian.com` (the organisation admin portal) does not create these tokens; it only lets admins review or restrict them.

### Verify

Start the app and use **Admin > Overview & sync > Sync now**. The sync history shows errors: 401 usually means a wrong token or username, 403/404 means missing scopes or no access to that repository.

### Repositories missing?

- **Admin > Overview & sync** has **Discover repositories** (refresh the repository list), **Sync now** (what is new), and **Full re-sync** (re-read a chosen window: 30 days up to 5 years, or **All history**). **Admin > Repositories** has a per-repository **Sync now**. All are safe to repeat; nothing is duplicated.
- **GitHub private repositories not listed?** The token cannot see them. For a fine-grained token, the **Resource owner** must be the organisation (not your user), **Repository access** must include those repositories, and an org owner must approve the token. For a classic token, use the `repo` scope and click **Configure SSO > Authorize** for the organisation. Then run **Discover repositories**.

## Notes and limits

- Rankings are computed in the app from the activity table (with a 60-second cache), which suits company-scale data (hundreds of developers, hundreds of thousands of events).
- GitHub commit line counts are not fetched (it would need one API call per commit); "lines merged" comes from merged pull requests on both platforms.
- Bitbucket has no explicit merge timestamp, so a merged PR's last-updated time is used.
- Anyone who can reach the URL can read the leaderboard (including names and activity). Restrict access at the Azure level (for example App Service Authentication or IP rules) if that is not acceptable.

### Troubleshooting Azure startup

- **Check which package is running.** In the Log stream, the start line must read `> node start.cjs` (standalone bundle) or `> node scripts/start.cjs` (source tree). If it still says `> next start -H 0.0.0.0`, an **old** package is deployed: redeploy.
- **Build the bundle on Linux** (the included GitHub workflow does this). A bundle built on Windows and zipped contains Windows-built files.
- **"Quota exceeded" on the Web App** usually means a Free/Shared (F1/D1) plan: they have a daily CPU-minute limit and small disk, and a crash-looping container uses it up. Use Basic (B1) or higher; Always On, which the background sync needs, is not available on Free.
- **`sh: next: not found` / 503 after "Site failed to startup"**: the root of the deployed package is not the `dist/` bundle (or an old bundle without `start.cjs` was deployed). Rebuild with `npm run build:standalone` and redeploy the `dist/` contents. Check the Log stream for `node start.cjs`.
- **Starts, then 503**: check **Log stream**; the app logs `database ready` or the database error. Verify the database firewall allows the Web App's outbound IPs and `POSTGRES_URL` / `MONGODB_URI` is set as an application setting.
