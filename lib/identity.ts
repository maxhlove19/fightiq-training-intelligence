// Who is asking, whichever way they signed in.
//
// FightIQ started with sign in through ChatGPT, which was free to build and
// meant every athlete needed a ChatGPT account to use a Muay Thai app. That is
// a barrier you cannot see until you watch somebody hit it.
//
// Email sign up is now the front door. ChatGPT sign in keeps working, because
// everybody who already has data is keyed to a ChatGPT user id and taking that
// away would delete their training history from their point of view.
//
// Both paths produce the same Athlete, and the rest of the app never learns
// which one somebody used.

import { verifyHs256 } from "./jwt";

export type AuthProvider = "email" | "chatgpt";

export type Athlete = {
  /** Stable, and what every row in the database is keyed to. */
  id: string;
  email: string;
  displayName: string;
  provider: AuthProvider;
};

export type IdentityConfig = {
  /** Supabase project JWT secret. Without it, email sign in is switched off rather than insecure. */
  jwtSecret?: string;
  /** https://<ref>.supabase.co/auth/v1, checked on every token. */
  issuer?: string;
  now?: Date;
};

export const SESSION_COOKIE = "fightiq_session";
export const REFRESH_COOKIE = "fightiq_refresh";

/**
 * Email accounts are prefixed so an id can never collide with a ChatGPT one,
 * and so it is obvious in the database which door somebody came through.
 */
export function emailOwnerId(subject: string): string {
  return `sb:${subject}`;
}

export function isEmailOwnerId(ownerId: string): boolean {
  return ownerId.startsWith("sb:");
}

/** Reads one cookie without pulling in a parser, and without trusting the shape. */
export function readCookie(header: string | null | undefined, name: string): string {
  if (!header) return "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return ""; }
  }
  return "";
}

/** The athlete carried by a verified Supabase access token, or null. */
export async function athleteFromAccessToken(token: string, config: IdentityConfig): Promise<Athlete | null> {
  if (!token || !config.jwtSecret) return null;
  const verified = await verifyHs256(token, {
    secret: config.jwtSecret,
    issuer: config.issuer,
    audience: "authenticated",
    now: config.now,
  });
  if (!verified) return null;
  const email = verified.email.trim();
  return {
    id: emailOwnerId(verified.sub),
    email,
    displayName: verified.name || email.split("@")[0] || "Athlete",
    provider: "email",
  };
}

/**
 * The athlete described by the hosting platform's identity headers.
 *
 * These are injected by the platform proxy and cannot be set by a browser, so
 * they are trusted in the same way a signed token is. They are only read when
 * there is no session cookie, so a signed in email account always wins.
 */
export function athleteFromPlatformHeaders(get: (name: string) => string | null): Athlete | null {
  const id = get("oai-authenticated-user-id");
  const email = get("oai-authenticated-user-email");
  if (!id || !email) return null;
  const encodedName = get("oai-authenticated-user-full-name");
  const encoding = get("oai-authenticated-user-full-name-encoding");
  let name: string | null = null;
  if (encodedName && encoding === "percent-encoded-utf-8") {
    try { name = decodeURIComponent(encodedName); } catch { name = null; }
  }
  return { id, email, displayName: name || email, provider: "chatgpt" };
}

/**
 * The one place the app asks who is here.
 *
 * A session cookie is checked first so that somebody who signed up with email
 * is never silently swapped onto a different account by a stray platform
 * header, which would show them somebody else's training.
 */
export async function resolveAthlete(
  headers: { get: (name: string) => string | null },
  config: IdentityConfig,
): Promise<Athlete | null> {
  const cookie = readCookie(headers.get("cookie"), SESSION_COOKIE);
  if (cookie) {
    const athlete = await athleteFromAccessToken(cookie, config);
    if (athlete) return athlete;
  }
  // A bearer token is accepted too, for anything that is not a browser.
  const authorization = headers.get("authorization") ?? "";
  if (/^Bearer\s+/i.test(authorization)) {
    const athlete = await athleteFromAccessToken(authorization.replace(/^Bearer\s+/i, "").trim(), config);
    if (athlete) return athlete;
  }
  return athleteFromPlatformHeaders((name) => headers.get(name));
}

/** Cookie attributes for a session. Written once so no route can weaken them. */
export function sessionCookie(name: string, value: string, maxAgeSeconds: number, secure = true): string {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  // Secure is dropped only for local http development, never in a deployment.
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function clearedCookie(name: string, secure = true): string {
  return sessionCookie(name, "", 0, secure);
}
