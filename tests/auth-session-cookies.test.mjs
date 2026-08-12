// Sign in has to leave you signed in.
//
// The bug this file exists for was reported as "the cookie is never set", and
// the evidence for that was document.cookie being empty on the domain. That
// evidence cannot say what it was asked to say: the session cookie is HttpOnly,
// so it is invisible to the page by design, and an empty document.cookie looks
// identical whether the cookie is missing or working perfectly.
//
// So these tests read the response the route actually returns, which is the
// only place the answer is unambiguous. Two things are checked, and they are
// different things:
//
//   1. The cookies are attached, with the attributes that make them a session.
//   2. The token in them is one this deployment can verify on the next request.
//
// The second is the one that was missing. A deployment can authenticate an
// athlete against Supabase perfectly and still be unable to recognise them a
// moment later, and when that happens sign in returns 200 and every request
// after it returns 401.

import assert from "node:assert/strict";
import test from "node:test";

const SECRET = "a-very-long-supabase-jwt-secret-value-for-testing";
const PROJECT_URL = "https://proj.supabase.co";
const ISSUER = `${PROJECT_URL}/auth/v1`;

// Set before the routes are imported: lib/auth-routes.ts and
// lib/current-athlete.ts read these through the cloudflare:workers shim, which
// reads process.env. "production" is not decoration here, it is what makes
// secureCookies() true, so Secure is asserted rather than assumed.
process.env.NODE_ENV = "production";
process.env.SUPABASE_URL = PROJECT_URL;
process.env.SUPABASE_ANON_KEY = "anon-key";
process.env.SUPABASE_JWT_SECRET = SECRET;

const b64url = (input) => Buffer.from(input).toString("base64url");

/** A token shaped and signed the way this deployment can verify one. */
async function realToken(overrides = {}) {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({
    sub: "abc-123", email: "maxhlove@gmail.com", aud: "authenticated", iss: ISSUER,
    exp: Math.floor(Date.now() / 1000) + 3600, user_metadata: { full_name: "Max" }, ...overrides,
  }));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${Buffer.from(signature).toString("base64url")}`;
}

/**
 * A token Supabase would accept and this deployment cannot check. Signed with a
 * different secret, which is what a project that has rotated its signing keys,
 * or migrated to asymmetric ones, looks like from here.
 */
async function foreignToken() {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({
    sub: "abc-123", email: "maxhlove@gmail.com", aud: "authenticated", iss: ISSUER,
    exp: Math.floor(Date.now() / 1000) + 3600,
  }));
  const other = await crypto.subtle.importKey("raw", new TextEncoder().encode("a-completely-different-signing-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", other, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${Buffer.from(signature).toString("base64url")}`;
}

/** What Supabase hands back on the next call. Set by each test. */
let supabaseReply = null;

globalThis.fetch = async (url) => {
  const target = String(url);
  // The project in these tests has not migrated, so it publishes no usable
  // keys. This is the case that made the missing check matter: verification
  // falls through to the legacy secret, and whether that works is exactly what
  // sign in was never asking.
  if (target.includes("/.well-known/jwks.json")) return new Response("not found", { status: 404 });
  return new Response(JSON.stringify(supabaseReply), { status: 200, headers: { "content-type": "application/json" } });
};

const { POST: signin } = await import("../app/api/auth/signin/route.ts");
const { POST: signup } = await import("../app/api/auth/signup/route.ts");

const post = (handler, path, body) => handler(new Request(`https://fightiq.example${path}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
}));

const CREDENTIALS = { email: "maxhlove@gmail.com", password: "a-real-password" };

/** The cookie of that name on the response, or "". */
function cookie(response, name) {
  return response.headers.getSetCookie().find((entry) => entry.startsWith(`${name}=`)) ?? "";
}

function assertIsASessionCookie(value, label) {
  assert.match(value, /HttpOnly/, `${label} is readable by a script`);
  assert.match(value, /Secure/, `${label} would travel over plain http`);
  assert.match(value, /SameSite=Lax/, `${label} has the wrong SameSite`);
  assert.match(value, /Path=\//, `${label} is not scoped to the whole site`);
}

test("signing in attaches both cookies to the response it returns", async () => {
  supabaseReply = { access_token: await realToken(), refresh_token: "refresh-token-value", expires_in: 3600 };
  const response = await post(signin, "/api/auth/signin", CREDENTIALS);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });

  const session = cookie(response, "fightiq_session");
  const refresh = cookie(response, "fightiq_refresh");
  assert.ok(session, "no session cookie on the sign in response");
  assert.ok(refresh, "no refresh cookie on the sign in response");
  assertIsASessionCookie(session, "the session cookie");
  assertIsASessionCookie(refresh, "the refresh cookie");
  // Two headers, not one joined by a comma. A single folded header is a cookie
  // neither browser stores.
  assert.equal(response.headers.getSetCookie().length, 2);
  // The refresh token outlives the access token, or signing in buys an hour.
  assert.match(refresh, /Max-Age=2592000/);
});

test("signing up attaches both cookies, so a new account lands inside the app", async () => {
  supabaseReply = { access_token: await realToken({ sub: "new-user" }), refresh_token: "refresh-token-value", expires_in: 3600 };
  const response = await post(signup, "/api/auth/signup", { ...CREDENTIALS, fullName: "Max" });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true, pending: false });
  assertIsASessionCookie(cookie(response, "fightiq_session"), "the session cookie");
  assertIsASessionCookie(cookie(response, "fightiq_refresh"), "the refresh cookie");
});

test("a session this deployment cannot verify is refused rather than set", async () => {
  supabaseReply = { access_token: await foreignToken(), refresh_token: "refresh-token-value", expires_in: 3600 };
  const response = await post(signin, "/api/auth/signin", CREDENTIALS);

  // 200 with a cookie here is the reported bug: Supabase records the sign in,
  // the browser stores a session, and every request after it is 401.
  assert.equal(response.status, 503);
  assert.deepEqual(response.headers.getSetCookie(), []);
  const body = await response.json();
  assert.equal(body.error.code, "SESSION_UNVERIFIABLE");
  // Nobody should go looking at their own typing over this.
  assert.match(body.error.message, /ours to fix/);
});

test("signing up says the account exists even when signing in could not finish", async () => {
  supabaseReply = { access_token: await foreignToken(), refresh_token: "refresh-token-value", expires_in: 3600 };
  const response = await post(signup, "/api/auth/signup", { ...CREDENTIALS, fullName: "Max" });

  assert.equal(response.status, 503);
  assert.deepEqual(response.headers.getSetCookie(), []);
  const body = await response.json();
  assert.equal(body.error.code, "SESSION_UNVERIFIABLE");
  assert.match(body.error.message, /account is created/);
});

test("a project with email confirmation on sets no cookie and says why", async () => {
  supabaseReply = { user: { id: "abc-123" } };
  const response = await post(signup, "/api/auth/signup", { ...CREDENTIALS, fullName: "Max" });

  assert.equal(response.status, 200);
  assert.deepEqual(response.headers.getSetCookie(), []);
  const body = await response.json();
  assert.equal(body.pending, true);
  assert.match(body.message, /confirm/i);
});
