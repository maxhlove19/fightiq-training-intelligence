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
  // This used to also require SUPABASE_JWT_SECRET, on the reasoning that
  // without it the server could mint a session it cannot then verify. The
  // reasoning was right and the gate is now the wrong one: a migrated project
  // signs with ES256 and publishes the verifying keys at a path derived from
  // SUPABASE_URL, so the secret proves nothing about whether a session can be
  // verified, and requiring it switches email sign in off on exactly the
  // projects where it works.
  //
  // The URL is what carries that guarantee now. See identityConfig() in
  // lib/current-athlete.ts, which builds the verifier from the same value.
  if (!url || !anonKey) return null;
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
