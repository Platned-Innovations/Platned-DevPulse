import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminConfig } from "./config";

const COOKIE = "devpulse_admin";
const MAX_AGE_S = 8 * 3600;

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Constant-time string comparison (hashes first so lengths never leak). */
function safeEqual(a: string, b: string) {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function adminConfigured() {
  const c = adminConfig();
  return c.password.length > 0 && c.secret.length >= 16;
}

/* Basic brute-force protection: 8 failures per 15 minutes per client key. */
const attempts = new Map<string, { n: number; reset: number }>();

export function loginAllowed(key: string) {
  const a = attempts.get(key);
  return !a || a.reset < Date.now() || a.n < 8;
}
function recordFailure(key: string) {
  const a = attempts.get(key);
  if (!a || a.reset < Date.now()) attempts.set(key, { n: 1, reset: Date.now() + 15 * 60_000 });
  else a.n++;
}

export async function login(username: string, password: string, clientKey: string): Promise<boolean> {
  const c = adminConfig();
  if (!adminConfigured() || !loginAllowed(clientKey)) return false;
  const ok = safeEqual(username, c.username) && safeEqual(password, c.password);
  if (!ok) {
    recordFailure(clientKey);
    return false;
  }
  attempts.delete(clientKey);
  const payload = Buffer.from(JSON.stringify({ u: username, exp: Date.now() + MAX_AGE_S * 1000 })).toString("base64url");
  const jar = await cookies();
  jar.set(COOKIE, `${payload}.${sign(payload, c.secret)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "true",
    path: "/",
    maxAge: MAX_AGE_S,
  });
  return true;
}

export async function logout() {
  (await cookies()).delete(COOKIE);
}

export async function isAdmin(): Promise<boolean> {
  const c = adminConfig();
  if (!adminConfigured()) return false;
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return false;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig || !safeEqual(sig, sign(payload, c.secret))) return false;
  try {
    const { exp, u } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof exp === "number" && exp > Date.now() && u === c.username;
  } catch {
    return false;
  }
}

/** Guard for admin pages and server actions. */
export async function requireAdmin() {
  if (!(await isAdmin())) redirect("/admin/login");
}
