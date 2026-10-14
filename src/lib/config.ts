/** All environment-driven configuration lives here. */

function list(v: string | undefined): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function companyName(): string {
  return (process.env.COMPANY_NAME ?? "").trim();
}

/** "<Company> DevPulse" or just "DevPulse" when COMPANY_NAME is unset. */
export function appName(): string {
  const c = companyName();
  return c ? `${c} DevPulse` : "DevPulse";
}

export function githubConfig() {
  const token = process.env.GITHUB_TOKEN?.trim();
  const orgs = list(process.env.GITHUB_ORGS ?? process.env.GITHUB_ORG);
  if (!token || orgs.length === 0) return null;
  return {
    token,
    orgs,
    apiUrl: (process.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/$/, ""),
    /** Optional comma-separated allow list of "owner/name" or bare names. */
    repoFilter: list(process.env.GITHUB_REPOS),
  };
}

export function bitbucketConfig() {
  const workspaces = list(process.env.BITBUCKET_WORKSPACES ?? process.env.BITBUCKET_WORKSPACE);
  const accessToken = process.env.BITBUCKET_ACCESS_TOKEN?.trim();
  const username = process.env.BITBUCKET_USERNAME?.trim();
  const appPassword = (process.env.BITBUCKET_APP_PASSWORD ?? process.env.BITBUCKET_API_TOKEN)?.trim();
  if (workspaces.length === 0) return null;
  if (!accessToken && !(username && appPassword)) return null;
  return {
    workspaces,
    accessToken,
    username,
    appPassword,
    apiUrl: (process.env.BITBUCKET_API_URL ?? "https://api.bitbucket.org/2.0").replace(/\/$/, ""),
    /** Optional project keys: "KEY" (any configured workspace) or "workspace/KEY". */
    projectFilter: list(process.env.BITBUCKET_PROJECTS).map((p) => p.toUpperCase()),
    repoFilter: list(process.env.BITBUCKET_REPOS),
  };
}

export function configuredPlatforms(): ("github" | "bitbucket")[] {
  const out: ("github" | "bitbucket")[] = [];
  if (githubConfig()) out.push("github");
  if (bitbucketConfig()) out.push("bitbucket");
  return out;
}

export type DbKind = "postgres" | "mongodb";

/** Postgres wins if both are provided. */
export function dbConfig(): { kind: DbKind; url: string } | null {
  const pg = (process.env.POSTGRES_URL ?? process.env.DATABASE_URL_POSTGRES)?.trim();
  const mongo = (process.env.MONGODB_URI ?? process.env.MONGO_URL)?.trim();
  if (pg) {
    if (mongo) console.warn("[devpulse] Both POSTGRES_URL and MONGODB_URI are set; using PostgreSQL.");
    return { kind: "postgres", url: pg };
  }
  if (mongo) return { kind: "mongodb", url: mongo };
  return null;
}

export function syncConfig() {
  return {
    intervalMinutes: Number(process.env.SYNC_INTERVAL_MINUTES ?? 60),
    lookbackDays: Number(process.env.SYNC_LOOKBACK_DAYS ?? 90),
  };
}

export function adminConfig() {
  return {
    username: process.env.ADMIN_USERNAME ?? "admin",
    password: process.env.ADMIN_PASSWORD ?? "",
    secret: process.env.SESSION_SECRET ?? "",
  };
}
