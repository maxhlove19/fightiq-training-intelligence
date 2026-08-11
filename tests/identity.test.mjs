// Two doors into the same app. The rule that matters: nobody is ever shown
// somebody else's training because the wrong door was consulted.

import assert from "node:assert/strict";
import test from "node:test";
import {
  REFRESH_COOKIE, SESSION_COOKIE, athleteFromAccessToken, athleteFromPlatformHeaders,
  clearedCookie, emailOwnerId, isEmailOwnerId, readCookie, resolveAthlete, sessionCookie,
} from "../lib/identity.ts";

const SECRET = "a-very-long-supabase-jwt-secret-value-for-testing";
const ISSUER = "https://proj.supabase.co/auth/v1";
const config = { jwtSecret: SECRET, issuer: ISSUER };
const b64url = (input) => Buffer.from(input).toString("base64url");

async function token(payload) {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({
    sub: "abc-123", email: "max@example.test", aud: "authenticated", iss: ISSUER,
    exp: Math.floor(Date.now() / 1000) + 3600, user_metadata: { full_name: "Max Love" }, ...payload,
  }));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${Buffer.from(sig).toString("base64url")}`;
}

const headers = (map) => ({ get: (name) => map[name.toLowerCase()] ?? null });

test("an email account becomes an athlete with a namespaced id", async () => {
  const athlete = await athleteFromAccessToken(await token({}), config);
  assert.equal(athlete.provider, "email");
  assert.equal(athlete.id, "sb:abc-123");
  assert.equal(athlete.email, "max@example.test");
  assert.equal(athlete.displayName, "Max Love");
  assert.ok(isEmailOwnerId(athlete.id));
});

test("an email id can never collide with a ChatGPT one", () => {
  assert.notEqual(emailOwnerId("abc"), "abc");
  assert.equal(isEmailOwnerId("user_01ABCDEF"), false, "a platform id must not look like an email account");
});

test("without a configured secret, email sign in is off rather than insecure", async () => {
  assert.equal(await athleteFromAccessToken(await token({}), { jwtSecret: "" }), null);
  assert.equal(await athleteFromAccessToken(await token({}), {}), null);
});

test("platform headers still work, so nobody with existing training loses it", () => {
  const athlete = athleteFromPlatformHeaders((name) => headers({
    "oai-authenticated-user-id": "user_9", "oai-authenticated-user-email": "sam@gym.test",
    "oai-authenticated-user-full-name": "Sam%20Okonkwo", "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  }).get(name));
  assert.deepEqual(athlete, { id: "user_9", email: "sam@gym.test", displayName: "Sam Okonkwo", provider: "chatgpt" });
});

test("half a set of platform headers is nobody", () => {
  assert.equal(athleteFromPlatformHeaders(() => null), null);
  assert.equal(athleteFromPlatformHeaders((n) => (n === "oai-authenticated-user-id" ? "user_9" : null)), null);
});

test("a signed in email session beats a stray platform header", async () => {
  // The failure this prevents: an athlete signed in with email being shown a
  // different account's training because a proxy added its own headers.
  const athlete = await resolveAthlete(headers({
    cookie: `${SESSION_COOKIE}=${await token({})}`,
    "oai-authenticated-user-id": "somebody-else",
    "oai-authenticated-user-email": "other@gym.test",
  }), config);
  assert.equal(athlete.id, "sb:abc-123");
  assert.equal(athlete.provider, "email");
});

test("an expired or forged cookie falls back rather than granting the wrong account", async () => {
  const expired = await token({ exp: Math.floor(Date.now() / 1000) - 60 });
  const athlete = await resolveAthlete(headers({
    cookie: `${SESSION_COOKIE}=${expired}`,
    "oai-authenticated-user-id": "user_9", "oai-authenticated-user-email": "sam@gym.test",
  }), config);
  assert.equal(athlete.id, "user_9", "a dead session must not become somebody");

  const forged = await resolveAthlete(headers({ cookie: `${SESSION_COOKIE}=not.a.token` }), config);
  assert.equal(forged, null);
});

test("a bearer token works for anything that is not a browser", async () => {
  const athlete = await resolveAthlete(headers({ authorization: `Bearer ${await token({})}` }), config);
  assert.equal(athlete.id, "sb:abc-123");
  assert.equal(await resolveAthlete(headers({ authorization: "Bearer nonsense" }), config), null);
});

test("nobody signed in is null, not a guest account", async () => {
  assert.equal(await resolveAthlete(headers({}), config), null);
  assert.equal(await resolveAthlete(headers({ cookie: "other=1" }), config), null);
});

test("cookies are read exactly, not by prefix", () => {
  assert.equal(readCookie(`x=1; ${SESSION_COOKIE}=abc; y=2`, SESSION_COOKIE), "abc");
  assert.equal(readCookie(`${SESSION_COOKIE}_other=abc`, SESSION_COOKIE), "");
  assert.equal(readCookie("", SESSION_COOKIE), "");
  assert.equal(readCookie(null, SESSION_COOKIE), "");
  assert.equal(readCookie("malformed", SESSION_COOKIE), "");
});

test("a session cookie cannot be read by JavaScript or sent across sites", () => {
  const cookie = sessionCookie(SESSION_COOKIE, "value", 3600);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=3600/);
  // Local http development is the only case that drops Secure.
  assert.doesNotMatch(sessionCookie(SESSION_COOKIE, "v", 60, false), /Secure/);
});

test("signing out clears both cookies rather than leaving one behind", () => {
  for (const name of [SESSION_COOKIE, REFRESH_COOKIE]) {
    assert.match(clearedCookie(name), new RegExp(`^${name}=;`));
    assert.match(clearedCookie(name), /Max-Age=0/);
  }
});
