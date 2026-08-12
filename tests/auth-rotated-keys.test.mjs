// The live project as it actually stands, one day after a key rotation.
//
// Supabase rotated this project's JWT signing key. The dashboard now shows a
// current key of type ECC (P-256) and a previous key of type Legacy HS256
// (Shared Secret), and the published JWKS serves exactly one entry: alg ES256,
// kty EC, crv P-256, use sig. No HS256 key is published at all.
//
// lib/jwks.ts and verifyEs256 were written for exactly this and are tested on
// their own. What was never tested is the combination this deployment is
// actually in, which is the one that matters and the one nobody would think to
// set up on purpose:
//
//   a project signing ES256, and SUPABASE_JWT_SECRET still set on the Worker
//   because nobody removes a secret when a key rotates underneath them
//
// Both configured at once, through the real sign in route rather than through
// the verifier in isolation. The ordering in lib/identity.ts is what decides
// whether that deployment works, and ordering is the kind of thing that is
// obviously right until it is obviously wrong.

import assert from "node:assert/strict";
import test from "node:test";

// The rotation left this behind. It signs nothing the project issues now.
const STALE_SECRET = "the-legacy-hs256-shared-secret-left-over-from-before";
// A different project URL from the other auth test file on purpose: JWKS key
// sets are cached per URL at module scope and would otherwise leak between them.
const PROJECT_URL = "https://rotated.supabase.co";
const ISSUER = `${PROJECT_URL}/auth/v1`;
// Lower case, as the JWKS serves it. The dashboard displays the same value
// upper cased, which is a display choice and not a second key.
const CURRENT_KID = "25a231ea-607d-4be0-9a2c-6f12635cd079";

process.env.NODE_ENV = "production";
process.env.SUPABASE_URL = PROJECT_URL;
process.env.SUPABASE_ANON_KEY = "anon-key";
process.env.SUPABASE_JWT_SECRET = STALE_SECRET;

const b64url = (input) => Buffer.from(input).toString("base64url");

// A real P-256 pair, so this verifies through WebCrypto rather than through a
// fixture that agrees with itself.
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);

/** The document the live project serves, shaped as reported. */
const JWKS_DOCUMENT = {
  keys: [{
    kid: CURRENT_KID, kty: "EC", crv: "P-256", alg: "ES256", use: "sig",
    x: publicJwk.x, y: publicJwk.y,
  }],
};

const CLAIMS = {
  sub: "abc-123", email: "maxhlove@gmail.com", aud: "authenticated", iss: ISSUER,
  user_metadata: { full_name: "Max" },
};

/** An access token signed the way this project signs them now. */
async function currentToken(overrides = {}) {
  const head = b64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid: CURRENT_KID }));
  const body = b64url(JSON.stringify({ ...CLAIMS, exp: Math.floor(Date.now() / 1000) + 3600, ...overrides }));
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(`${head}.${body}`),
  ));
  return `${head}.${body}.${Buffer.from(signature).toString("base64url")}`;
}

/** A token from before the rotation, still inside its hour. */
async function preRotationToken() {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ ...CLAIMS, exp: Math.floor(Date.now() / 1000) + 3600 }));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(STALE_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${Buffer.from(signature).toString("base64url")}`;
}

let supabaseReply = null;
let jwksRequests = 0;

globalThis.fetch = async (url) => {
  const target = String(url);
  if (target.includes("/.well-known/jwks.json")) {
    jwksRequests += 1;
    assert.equal(target, `${ISSUER}/.well-known/jwks.json`, "the JWKS was fetched from the wrong place");
    return new Response(JSON.stringify(JWKS_DOCUMENT), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify(supabaseReply), { status: 200, headers: { "content-type": "application/json" } });
};

const { POST: signin } = await import("../app/api/auth/signin/route.ts");
const { SESSION_COOKIE, readCookie, resolveAthlete } = await import("../lib/identity.ts");
const { identityConfig } = await import("../lib/current-athlete.ts");

const signInRequest = () => new Request("https://fightiq.example/api/auth/signin", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "maxhlove@gmail.com", password: "a-real-password" }),
});

/** The session cookie value, read back the way a browser would send it. */
function sessionFrom(response) {
  const header = response.headers.getSetCookie().find((entry) => entry.startsWith(`${SESSION_COOKIE}=`));
  assert.ok(header, "no session cookie on the response");
  return readCookie(header.split(";")[0], SESSION_COOKIE);
}

/** Whoever the next request would be, given that cookie. */
const whoIsThis = (token) => resolveAthlete(new Headers({ cookie: `${SESSION_COOKIE}=${token}` }), identityConfig());

test("an ES256 token from the rotated key signs somebody in, and the next request knows them", async () => {
  supabaseReply = { access_token: await currentToken(), refresh_token: "refresh-token-value", expires_in: 3600 };
  const response = await signin(signInRequest());

  // Before the ES256 verifier existed this was the whole bug: 200 here, and
  // 401 on everything after it.
  assert.equal(response.status, 200);
  const athlete = await whoIsThis(sessionFrom(response));
  assert.ok(athlete, "the cookie sign in just set does not verify on the next request");
  assert.equal(athlete.id, "sb:abc-123");
  assert.equal(athlete.email, "maxhlove@gmail.com");
  assert.equal(athlete.provider, "email");
});

test("the stale shared secret does not get in the way of the current key", async () => {
  // SUPABASE_JWT_SECRET is set and verifies nothing this project issues now.
  // ES256 is tried first, so its presence changes no outcome. If that ordering
  // ever flips, this is the test that says so.
  assert.equal(process.env.SUPABASE_JWT_SECRET, STALE_SECRET);
  supabaseReply = { access_token: await currentToken({ sub: "second-athlete" }), refresh_token: "r", expires_in: 3600 };
  const response = await signin(signInRequest());
  assert.equal(response.status, 200);
  assert.equal((await whoIsThis(sessionFrom(response)))?.id, "sb:second-athlete");
});

test("a token issued before the rotation still verifies, on the fallback", async () => {
  // Somebody signed in an hour before the key changed. Their cookie is HS256
  // and the project publishes no HS256 key, so only the legacy secret can
  // check it. Rotating a key must not sign out everybody holding one.
  const athlete = await whoIsThis(await preRotationToken());
  assert.ok(athlete, "a pre-rotation token was rejected, which signs out everybody mid-session");
  assert.equal(athlete.id, "sb:abc-123");
});

test("the published key set is fetched once, not once per request", async () => {
  // Module scope survives between requests on Workers. A fetch per sign in
  // would put Supabase's JWKS endpoint in the path of every request this app
  // serves.
  const before = jwksRequests;
  supabaseReply = { access_token: await currentToken({ sub: "third-athlete" }), refresh_token: "r", expires_in: 3600 };
  await signin(signInRequest());
  await whoIsThis(await currentToken({ sub: "fourth-athlete" }));
  assert.equal(jwksRequests, before, "the key set was refetched while it was still fresh");
  assert.ok(before > 0, "the key set was never fetched at all");
});

test("a token signed by a key the project no longer publishes is refused", async () => {
  // The other half of a rotation. A token from the retired ECC key carries a
  // kid that is not in the document, and no amount of valid signing makes it
  // verifiable.
  const retired = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const head = b64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid: "720f3a59-d7c9-4694-ba6b-4dc685165d34" }));
  const body = b64url(JSON.stringify({ ...CLAIMS, exp: Math.floor(Date.now() / 1000) + 3600 }));
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, retired.privateKey, new TextEncoder().encode(`${head}.${body}`),
  ));
  const token = `${head}.${body}.${Buffer.from(signature).toString("base64url")}`;

  assert.equal(await whoIsThis(token), null);

  // And sign in refuses to hand that cookie out in the first place, rather
  // than setting it and failing on the request after.
  supabaseReply = { access_token: token, refresh_token: "r", expires_in: 3600 };
  const response = await signin(signInRequest());
  assert.equal(response.status, 503);
  assert.deepEqual(response.headers.getSetCookie(), []);
});
