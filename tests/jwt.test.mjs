// This is the code that decides whether somebody is who they say they are.
// Every one of these is a real way tokens get forged.

import assert from "node:assert/strict";
import test from "node:test";
import { verifyHs256 } from "../lib/jwt.ts";

const SECRET = "a-very-long-supabase-jwt-secret-value-for-testing";
const b64url = (input) => Buffer.from(input).toString("base64url");

async function sign(payload, { secret = SECRET, alg = "HS256", header } = {}) {
  const head = b64url(JSON.stringify(header ?? { alg, typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${Buffer.from(signature).toString("base64url")}`;
}

const future = () => Math.floor(Date.now() / 1000) + 3600;
const claims = (extra = {}) => ({
  sub: "user-123", email: "max@example.test", exp: future(),
  aud: "authenticated", iss: "https://proj.supabase.co/auth/v1",
  user_metadata: { full_name: "Max Love" }, ...extra,
});

test("a properly signed token is accepted and its claims come back", async () => {
  const token = await sign(claims());
  const verified = await verifyHs256(token, { secret: SECRET, audience: "authenticated", issuer: "https://proj.supabase.co/auth/v1" });
  assert.ok(verified);
  assert.equal(verified.sub, "user-123");
  assert.equal(verified.email, "max@example.test");
  assert.equal(verified.name, "Max Love");
});

test("a token signed with a different secret is rejected", async () => {
  const token = await sign(claims(), { secret: "not-the-real-secret-not-even-close" });
  assert.equal(await verifyHs256(token, { secret: SECRET }), null);
});

test("a tampered payload is rejected even though the signature is well formed", async () => {
  const token = await sign(claims());
  const [head, , signature] = token.split(".");
  const forged = `${head}.${b64url(JSON.stringify(claims({ sub: "somebody-else" })))}.${signature}`;
  assert.equal(await verifyHs256(forged, { secret: SECRET }), null);
});

test('alg "none" is rejected, however convincing the rest of the token looks', async () => {
  const head = b64url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const body = b64url(JSON.stringify(claims()));
  assert.equal(await verifyHs256(`${head}.${body}.`, { secret: SECRET }), null);
  assert.equal(await verifyHs256(`${head}.${body}.anything`, { secret: SECRET }), null);
});

test("a token asking to be checked as RS256 is rejected, not verified against the secret", async () => {
  // Algorithm confusion: sign with HMAC but label it RS256 so a naive verifier
  // treats the public key as a shared secret.
  const token = await sign(claims(), { header: { alg: "RS256", typ: "JWT" } });
  assert.equal(await verifyHs256(token, { secret: SECRET }), null);
});

test("an expired token is rejected, and the leeway is small", async () => {
  const expired = await sign(claims({ exp: Math.floor(Date.now() / 1000) - 120 }));
  assert.equal(await verifyHs256(expired, { secret: SECRET }), null);
  // Just inside the allowance still works, so a second of clock drift is not a logout.
  const edge = await sign(claims({ exp: Math.floor(Date.now() / 1000) - 2 }));
  assert.ok(await verifyHs256(edge, { secret: SECRET, leewaySeconds: 5 }));
});

test("a token with no expiry is rejected rather than treated as forever", async () => {
  const token = await sign({ sub: "user-123", email: "max@example.test", aud: "authenticated" });
  assert.equal(await verifyHs256(token, { secret: SECRET }), null);
});

test("a token from another project is rejected", async () => {
  const token = await sign(claims({ iss: "https://someone-elses-project.supabase.co/auth/v1" }));
  assert.equal(await verifyHs256(token, { secret: SECRET, issuer: "https://proj.supabase.co/auth/v1" }), null);
});

test("a token for a different audience is rejected", async () => {
  const token = await sign(claims({ aud: "anon" }));
  assert.equal(await verifyHs256(token, { secret: SECRET, audience: "authenticated" }), null);
  // An array audience containing ours is fine, which is how some providers sign.
  const many = await sign(claims({ aud: ["authenticated", "other"] }));
  assert.ok(await verifyHs256(many, { secret: SECRET, audience: "authenticated" }));
});

test("a token with no subject is rejected, because there is nobody to be", async () => {
  const token = await sign(claims({ sub: "" }));
  assert.equal(await verifyHs256(token, { secret: SECRET }), null);
});

test("malformed input never throws, it just fails", async () => {
  for (const bad of ["", "a", "a.b", "a.b.c.d", "....", "not a token at all", "a.b.c", null, undefined, 42, {}]) {
    assert.equal(await verifyHs256(bad, { secret: SECRET }), null, String(bad));
  }
  assert.equal(await verifyHs256(await sign(claims()), { secret: "" }), null, "no secret configured means nobody is verified");
});

test("a token whose payload is valid base64 but not an object is rejected", async () => {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  for (const body of ["null", '"a string"', "[1,2,3]", "12"]) {
    const encoded = b64url(body);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${head}.${encoded}`)));
    assert.equal(await verifyHs256(`${head}.${encoded}.${Buffer.from(sig).toString("base64url")}`, { secret: SECRET }), null, body);
  }
});

test("a missing name is null rather than a guess", async () => {
  const token = await sign(claims({ user_metadata: {} }));
  const verified = await verifyHs256(token, { secret: SECRET });
  assert.equal(verified.name, null);
});
