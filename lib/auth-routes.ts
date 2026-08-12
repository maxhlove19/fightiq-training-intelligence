// Shared plumbing for the four auth routes, so the cookie rules and the
// Supabase configuration are written once rather than four times.

import { env } from "cloudflare:workers";
import { REFRESH_COOKIE, SESSION_COOKIE, athleteFromAccessToken, clearedCookie, sessionCookie } from "./identity";
import { identityConfig } from "./current-athlete";
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

/**
 * Can this deployment verify the session it was just handed?
 *
 * Supabase returning a session proves the password was right. It does not prove
 * this Worker can check that token on the next request, and those are two
 * different questions whenever the project's signing keys and what this
 * deployment verifies with have drifted apart. A project that has migrated to
 * asymmetric keys publishes them at a path derived from SUPABASE_URL; one that
 * has not still signs with SUPABASE_JWT_SECRET, and sign in no longer requires
 * that secret to be set. So a deployment can authenticate somebody perfectly
 * and then be unable to recognise them.
 *
 * When that happens the failure is silent and it is the worst kind. Sign in
 * returns 200, Supabase records the sign in, the cookie is set correctly, and
 * every request after it is 401 with nothing on screen saying why. From the
 * outside it looks like the cookie was never set, because an HttpOnly cookie is
 * invisible to the page that is failing.
 *
 * So the token goes through the same function an ordinary request uses. This is
 * what /api/auth/password has always done with the token a recovery link
 * carries, and the reasoning is identical: a token this route accepts is one the
 * next request will accept too.
 */
export async function sessionIsUsable(session: AuthSession): Promise<boolean> {
  return (await athleteFromAccessToken(session.accessToken, identityConfig())) !== null;
}

/**
 * Said when the session cannot be verified, and said without a cookie.
 *
 * Setting one would hand over a session guaranteed to be rejected on the next
 * request, which is how this turns into a sign in loop nobody can diagnose.
 */
export function sessionNotUsable(message: string): Response {
  return Response.json(
    { error: { code: "SESSION_UNVERIFIABLE", message } },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}

export function withoutSession(body: Record<string, unknown>, status = 200): Response {
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  headers.append("set-cookie", clearedCookie(SESSION_COOKIE, secureCookies()));
  headers.append("set-cookie", clearedCookie(REFRESH_COOKIE, secureCookies()));
  return new Response(JSON.stringify(body), { status, headers });
}
