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
- **Identity merging (admin)**: the same person usually has different IDs on each platform. Admin merges them (suggestions are offered by matching email, username or name); stats from all linked accounts then show as one record, retroactively and on every future sync. Accounts can be unlinked again.
- **Admin-only login**: no end-user accounts. The leaderboard is open; the admin area manages sync, merging, hiding bots/alumni, enabling repositories and the scoring weights.
- **Automatic sync**: a background schedule plus a manual "Sync now" in the admin area.

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

### Automatic seeding, manual seeding and migration

On every start the app connects to the database and creates/updates the schema. If the database has **no activity yet** it fills itself before you need to do anything:

- GitHub and/or Bitbucket credentials configured: the **first real sync** starts in the background.
- No platform configured: **fictional demo data** is loaded, so the UI is not blank (three people appear on both platforms so you can try merging). Real credentials never trigger demo data.

Set `AUTO_SEED=false` to turn this off. The manual options remain:

| Command | What it does |
| --- | --- |
| `npm run migrate` | Creates/updates the schema only (idempotent). |
| `npm run seed` | Loads the demo data (safe to re-run). |
| "Sync now" (admin) | Pulls real data from the configured platforms. |

Demo data is not removed automatically when you later add credentials; start from an empty database (or set `AUTO_SEED=false`) if you never want it.

## Configuration

See [.env.example](.env.example) for every variable.

| Area | Variables |
| --- | --- |
| Branding | `COMPANY_NAME` |
| Database (**one of**) | `POSTGRES_URL` **or** `MONGODB_URI` (PostgreSQL wins if both are set) |
| GitHub | `GITHUB_TOKEN`, `GITHUB_ORGS` (optional `GITHUB_REPOS`, `GITHUB_API_URL`) |
| Bitbucket Cloud | `BITBUCKET_WORKSPACES` + (`BITBUCKET_USERNAME` + `BITBUCKET_APP_PASSWORD`) or `BITBUCKET_ACCESS_TOKEN` |
| Sync | `SYNC_INTERVAL_MINUTES` (0 = off), `SYNC_LOOKBACK_DAYS` |
| Admin | `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_SECRET` (16+ chars) |

Tables, collections and indexes are created automatically on first start for both databases. All times are UTC; weeks start on Monday.

## Deploying to Azure Web Apps (Linux, Node 22)

1. **Create** a Web App (Linux, Node 22 LTS). Turn **Always On** on (the background sync runs in-process) and keep **one instance** (extra instances would each sync; if you scale out, set `SYNC_INTERVAL_MINUTES=0` on the extras: syncing is idempotent, so it is only wasteful).
2. **Database**: Azure Database for PostgreSQL (use `?sslmode=require`) or Azure Cosmos DB for MongoDB / MongoDB Atlas. For Cosmos DB RU accounts add `retrywrites=false` to the URI.
3. **App settings** (Configuration > Application settings): everything from `.env.example` that applies, plus `HOSTNAME=0.0.0.0`. Store tokens and passwords as Key Vault references where possible.
4. **Startup command**: `node server.js`
5. **Health check** path: `/api/health` (use `/api/health?deep=1` to also verify the database).
6. **Deploy**: the included workflow [.github/workflows/azure-webapp.yml](.github/workflows/azure-webapp.yml) builds the standalone bundle and deploys it (secret `AZURE_WEBAPP_PUBLISH_PROFILE`, variable `AZURE_WEBAPP_NAME`). Manually: `npm run build:standalone`, then zip-deploy the `dist/` folder.
   Alternative: a container image from the included `Dockerfile` (listens on `PORT`, default 8080; set `WEBSITES_PORT=8080`).
7. If you serve the app through a custom domain or proxy that rewrites the Host header, set `ALLOWED_ORIGINS=app.example.com`.

HTTPS is terminated by Azure; the admin session cookie is `Secure`, `HttpOnly` and `SameSite=Lax`.

## Tokens

- **GitHub**: a fine-grained token (or classic `repo` scope) with read access to contents and pull requests for the organisation's repositories.
- **Bitbucket**: an app password / API token with *Repositories: Read* and *Pull requests: Read*, or a workspace access token.

## Notes and limits

- Rankings are computed in the app from the activity table (with a 60-second cache), which suits company-scale data (hundreds of developers, hundreds of thousands of events).
- GitHub commit line counts are not fetched (it would need one API call per commit); "lines merged" comes from merged pull requests on both platforms.
- Bitbucket has no explicit merge timestamp, so a merged PR's last-updated time is used.
- Anyone who can reach the URL can read the leaderboard (including names and activity). Restrict access at the Azure level (for example App Service Authentication or IP rules) if that is not acceptable.
