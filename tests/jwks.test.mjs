// Verifying tokens the way Supabase actually signs them now.
//
// The bug this covers cost a real signup. Supabase migrated the project to
// asymmetric signing keys: it publishes one EC P-256 key at
// <SUPABASE_URL>/auth/v1/.well-known/jwks.json and signs access tokens with
// ES256. The app verified with HS256 against the old shared secret, so every
// token it was handed failed verification. Sign up succeeded, the account was
// created, and the next request bounced the person back to the landing page,
// which looks like anything except an auth bug.
//
// Everything here uses real WebCrypto keys and real signatures. A mocked
// verifier would have passed against the broken code too.

import assert from "node:assert/strict";
import test from "node:test";
import { athleteFromAccessToken } from "../lib/identity.ts";
import { createJwksSource, jwksUrlForIssuer } from "../lib/jwks.ts";
import { verifyEs256 } from "../lib/jwt.ts";

const ISSUER = "https://project-ref.supabase.test/auth/v1";
const KID = "eb0e5a1f-0000-4000-8000-abcdefabcdef";
const b64url = (input) => Buffer.from(input).toString("base64url");

/** A P-256 signing pair plus the public half as a JWKS document would carry it. */
async function keypair(kid = KID) {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { pair, jwk: { kid, kty: "EC", crv: "P-256", alg: "ES256", use: "sig", x: jwk.x, y: jwk.y } };
}

function claims(overrides = {}) {
  return {
    sub: "11111111-2222-4333-8444-555555555555",
    email: "athlete@example.test",
    aud: "authenticated",
    iss: ISSUER,
    exp: Math.floor(Date.now() / 1000) + 3600,
    user_metadata: { full_name: "Sam Rivera" },
    ...overrides,
  };
}

async function signEs256(privateKey, payload, header = {}) {
  const head = b64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid: KID, ...header }));
  const body = b64url(JSON.stringify(payload));
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(`${head}.${body}`),
  ));
  return `${head}.${body}.${Buffer.from(signature).toString("base64url")}`;
}

async function signHs256(secret, payload) {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${Buffer.from(signature).toString("base64url")}`;
}

/** A fetch that serves one JWKS document and counts how often it is asked. */
function servedJwks(keys) {
  const state = { calls: 0 };
  const fetchImpl = async () => {
    state.calls += 1;
    return { ok: true, json: async () => ({ keys }) };
  };
  return { state, fetchImpl };
}

test("the JWKS url is derived from the issuer, not configured separately", () => {
  assert.equal(jwksUrlForIssuer(ISSUER), `${ISSUER}/.well-known/jwks.json`);
  // A trailing slash on SUPABASE_URL must not produce a double slash.
  assert.equal(jwksUrlForIssuer(`${ISSUER}/`), `${ISSUER}/.well-known/jwks.json`);
});

test("an ES256 token signed by the published key verifies", async () => {
  const { pair, jwk } = await keypair();
  const { fetchImpl } = servedJwks([jwk]);
  const jwks = createJwksSource("https://jwks.test/keys", { fetchImpl });

  const verified = await verifyEs256(await signEs256(pair.privateKey, claims()), {
    keys: jwks, issuer: ISSUER, audience: "authenticated",
  });

  assert.ok(verified, "a correctly signed ES256 token must verify");
  assert.equal(verified.sub, "11111111-2222-4333-8444-555555555555");
  assert.equal(verified.email, "athlete@example.test");
  assert.equal(verified.name, "Sam Rivera");
});

test("an ES256 token becomes an athlete through the ordinary sign in path", async () => {
  const { pair, jwk } = await keypair();
  const { fetchImpl } = servedJwks([jwk]);
  const jwks = createJwksSource("https://jwks.test/keys", { fetchImpl });

  // No jwtSecret at all: this is the migrated deployment, and it must work.
  const athlete = await athleteFromAccessToken(await signEs256(pair.privateKey, claims()), { jwks, issuer: ISSUER });

  assert.ok(athlete, "a migrated project must be able to sign somebody in with no shared secret");
  assert.equal(athlete.id, "sb:11111111-2222-4333-8444-555555555555");
  assert.equal(athlete.provider, "email");
});

test("a token whose kid is not in the JWKS is rejected", async () => {
  const { pair } = await keypair();
  const other = await keypair("a-different-key-id");
  const { fetchImpl } = servedJwks([other.jwk]);
  const jwks = createJwksSource("https://jwks.test/keys", { fetchImpl });

  // Signed with a key the project does not publish, and labelled with a kid the
  // document does not contain.
  const token = await signEs256(pair.privateKey, claims());
  assert.equal(await verifyEs256(token, { keys: jwks, issuer: ISSUER, audience: "authenticated" }), null);
});

test("a token whose kid is present but signed by a different key is rejected", async () => {
  // The nastier version of the same thing: the kid matches, so a verifier that
  // trusted the header rather than the signature would let this through.
  const attacker = await keypair();
  const project = await keypair();
  const { fetchImpl } = servedJwks([project.jwk]);
  const jwks = createJwksSource("https://jwks.test/keys", { fetchImpl });

  const token = await signEs256(attacker.pair.privateKey, claims());
  assert.equal(await verifyEs256(token, { keys: jwks, issuer: ISSUER, audience: "authenticated" }), null);
});

test("an expired ES256 token is rejected", async () => {
  const { pair, jwk } = await keypair();
  const { fetchImpl } = servedJwks([jwk]);
  const jwks = createJwksSource("https://jwks.test/keys", { fetchImpl });
  const options = { keys: jwks, issuer: ISSUER, audience: "authenticated" };

  const expired = await signEs256(pair.privateKey, claims({ exp: Math.floor(Date.now() / 1000) - 120 }));
  assert.equal(await verifyEs256(expired, options), null);

  // Just past the leeway, so the boundary is tested rather than assumed.
  const edge = await signEs256(pair.privateKey, claims({ exp: Math.floor(Date.now() / 1000) - 8 }));
  assert.equal(await verifyEs256(edge, options), null);

  // And a valid one through the same source, so the rejections above are the
  // expiry rather than the whole fixture being broken.
  assert.ok(await verifyEs256(await signEs256(pair.privateKey, claims()), options));
});

test("an HS256 token is rejected when only JWKS is configured, however it is signed", async () => {
  const { jwk } = await keypair();
  const { fetchImpl } = servedJwks([jwk]);
  const jwks = createJwksSource("https://jwks.test/keys", { fetchImpl });

  // Signed with a plausible shared secret. On a migrated deployment there is no
  // HS256 path to reach at all, so the token cannot be accepted by any means.
  const token = await signHs256("a-very-long-supabase-jwt-secret-value-for-testing", claims());
  assert.equal(await athleteFromAccessToken(token, { jwks, issuer: ISSUER }), null);

  // Algorithm confusion in its usual form: an HS256 signature wearing an ES256
  // header, so a verifier that dispatched on the header would try to check a
  // MAC against a public key.
  const [, body, signature] = token.split(".");
  const disguised = `${b64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid: KID }))}.${body}.${signature}`;
  assert.equal(await athleteFromAccessToken(disguised, { jwks, issuer: ISSUER }), null);
});

test("the legacy shared secret still signs somebody in when it is configured", async () => {
  // A project that has not migrated must keep working. This is why the HS256
  // path is kept rather than deleted.
  const secret = "a-very-long-supabase-jwt-secret-value-for-testing";
  const athlete = await athleteFromAccessToken(await signHs256(secret, claims()), { jwtSecret: secret, issuer: ISSUER });
  assert.ok(athlete);
  assert.equal(athlete.id, "sb:11111111-2222-4333-8444-555555555555");
});

test("a token for a different project is rejected even with a good signature", async () => {
  const { pair, jwk } = await keypair();
  const { fetchImpl } = servedJwks([jwk]);
  const jwks = createJwksSource("https://jwks.test/keys", { fetchImpl });

  const token = await signEs256(pair.privateKey, claims({ iss: "https://someone-else.supabase.test/auth/v1" }));
  assert.equal(await verifyEs256(token, { keys: jwks, issuer: ISSUER, audience: "authenticated" }), null);
});

test("keys are cached, and an unknown kid does not refetch on every attempt", async () => {
  const { pair, jwk } = await keypair();
  const { state, fetchImpl } = servedJwks([jwk]);
  // minRefetchMs high enough that the second unknown-kid attempt is inside it.
  const jwks = createJwksSource("https://jwks.test/keys", { fetchImpl, minRefetchMs: 60_000 });
  const options = { keys: jwks, issuer: ISSUER, audience: "authenticated" };

  assert.ok(await verifyEs256(await signEs256(pair.privateKey, claims()), options));
  assert.equal(state.calls, 1, "the first verification fetches the document once");

  assert.ok(await verifyEs256(await signEs256(pair.privateKey, claims()), options));
  assert.equal(state.calls, 1, "a second token with a known kid must not fetch again");

  const stranger = await signEs256(pair.privateKey, claims(), { kid: "unknown-key-id" });
  assert.equal(await verifyEs256(stranger, options), null);
  assert.equal(state.calls, 1, "an unknown kid inside the refetch floor must not generate traffic");
});

test("a rotated key is picked up, because an unknown kid is the normal case", async () => {
  const first = await keypair("key-one");
  const second = await keypair("key-two");
  let published = [first.jwk];
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { ok: true, json: async () => ({ keys: published }) }; };
  // minRefetchMs 0: the point here is the refetch, not the rate limit.
  const jwks = createJwksSource("https://jwks.test/keys", { fetchImpl, minRefetchMs: 0 });
  const options = { keys: jwks, issuer: ISSUER, audience: "authenticated" };

  assert.ok(await verifyEs256(await signEs256(first.pair.privateKey, claims(), { kid: "key-one" }), options));

  published = [second.jwk];
  const rotated = await signEs256(second.pair.privateKey, claims(), { kid: "key-two" });
  assert.ok(await verifyEs256(rotated, options), "a token signed with a newly published key must verify");
  assert.ok(calls > 1, "picking up a rotation requires refetching");
});

test("an unreachable JWKS endpoint rejects rather than throwing", async () => {
  const { pair } = await keypair();
  const jwks = createJwksSource("https://jwks.test/keys", {
    fetchImpl: async () => { throw new Error("network is down"); },
  });

  const token = await signEs256(pair.privateKey, claims());
  assert.equal(await verifyEs256(token, { keys: jwks, issuer: ISSUER, audience: "authenticated" }), null);
});

test("a JWKS document that serves nothing usable does not sign everybody out", async () => {
  const { pair, jwk } = await keypair();
  let published = [jwk];
  const fetchImpl = async () => ({ ok: true, json: async () => ({ keys: published }) });
  const jwks = createJwksSource("https://jwks.test/keys", { fetchImpl, ttlMs: 0, minRefetchMs: 0 });
  const options = { keys: jwks, issuer: ISSUER, audience: "authenticated" };

  assert.ok(await verifyEs256(await signEs256(pair.privateKey, claims()), options));

  // The endpoint starts returning a document with no usable keys. The previous
  // working set is kept rather than replaced with nothing.
  published = [{ kid: "rsa-key", kty: "RSA", n: "…", e: "AQAB" }];
  assert.ok(
    await verifyEs256(await signEs256(pair.privateKey, claims()), options),
    "a briefly unreadable document must not invalidate keys that already work",
  );
});

test("a project with no usable keys is not refetched on every request", async () => {
  // The legacy deployment: still signing with HS256, so its JWKS document has
  // nothing this app can use. Rate limiting attempts by *success* would leave
  // this project fetching the document on every single request forever, because
  // it would never stop being stale.
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { ok: true, json: async () => ({ keys: [] }) }; };
  const jwks = createJwksSource("https://jwks.test/keys", { fetchImpl, minRefetchMs: 60_000 });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal(await jwks.get("any-key-id"), null);
  }
  assert.equal(calls, 1, "five sign in attempts against an empty JWKS must make one request, not five");
});

test("non-signing and wrong-curve keys in the document are ignored", async () => {
  const { pair, jwk } = await keypair();
  const { fetchImpl } = servedJwks([
    { ...jwk, use: "enc" },
    { ...jwk, kid: "wrong-curve", crv: "P-384" },
    { ...jwk, kid: "wrong-alg", alg: "ES384" },
  ]);
  const jwks = createJwksSource("https://jwks.test/keys", { fetchImpl });

  const token = await signEs256(pair.privateKey, claims());
  assert.equal(
    await verifyEs256(token, { keys: jwks, issuer: ISSUER, audience: "authenticated" }),
    null,
    "a key marked for encryption, or on another curve, must not verify a signature",
  );
});
