// Shared plumbing for the four auth routes, so the cookie rules and the
// Supabase configuration are written once rather than four times.

import { env } from "cloudflare:workers";
import { REFRESH_COOKIE, SESSION_COOKIE, clearedCookie, sessionCookie } from "./identity";
import type { AuthSession, SupabaseConfig } from "./supabase-auth";

type AuthEnv = { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string; SUPABASE_JWT_SECRET?: string };

/** Null when email sign in is not configured, so routes can say so plainly. */
export function supabaseConfig(): SupabaseConfig | null {
  const runtime = env as unknown as AuthEnv;
  const url = (runtime.SUPABASE_URL ?? "").trim();
  const anonKey = (runtime.SUPABASE_ANON_KEY ?? "").trim();
  // Without the JWT secret the server could mint a session it cannot then
  // verify, which would look like a silent sign in failure on the next request.
  if (!url || !anonKey || !(runtime.SUPABASE_JWT_SECRET ?? "").trim()) return null;
  return { url, anonKey };
}

export function authNotConfigured(): Response {
  return Response.json(
    { error: { code: "AUTH_NOT_CONFIGURED", message: "Email sign in is not switched on for this deployment yet." } },
    { status: 503 },
  );
}

const secureCookies = () => process.env.NODE_ENV === "production";

/** Sets both cookies. The refresh token outlives the access token by design. */
export function withSession(body: Record<string, unknown>, session: AuthSession, status = 200): Response {
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  headers.append("set-cookie", sessionCookie(SESSION_COOKIE, session.accessToken, session.expiresIn, secureCookies()));
  headers.append("set-cookie", sessionCookie(REFRESH_COOKIE, session.refreshToken, 60 * 60 * 24 * 30, secureCookies()));
  return new Response(JSON.stringify(body), { status, headers });
}

export function withoutSession(body: Record<string, unknown>, status = 200): Response {
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  headers.append("set-cookie", clearedCookie(SESSION_COOKIE, secureCookies()));
  headers.append("set-cookie", clearedCookie(REFRESH_COOKIE, secureCookies()));
  return new Response(JSON.stringify(body), { status, headers });
}
