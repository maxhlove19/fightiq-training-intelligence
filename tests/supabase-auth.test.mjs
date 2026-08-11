// Sign up and sign in, with the network faked so the behaviour is the thing
// under test rather than Supabase's uptime.

import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { refreshSession, requestPasswordReset, signIn, signUp, updatePassword, validateCredentials, validatePassword } from "../lib/supabase-auth.ts";

function fakeSupabase(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    const { status, body } = handler({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { config: { url: "https://proj.supabase.co", anonKey: "anon-key", fetchImpl }, calls };
}

const goodSession = { access_token: "access.token.value", refresh_token: "refresh-token", expires_in: 3600 };

test("a valid sign up returns a session", async () => {
  const { config, calls } = fakeSupabase(() => ({ status: 200, body: goodSession }));
  const outcome = await signUp(config, "max@example.test", "a-good-password", "Max Love");
  assert.equal(outcome.ok, true);
  assert.equal(outcome.session.accessToken, "access.token.value");
  assert.match(calls[0].url, /\/auth\/v1\/signup$/);
  assert.equal(calls[0].body.data.full_name, "Max Love");
});

test("a project that requires email confirmation is not treated as a failure", async () => {
  const { config } = fakeSupabase(() => ({ status: 200, body: { user: { id: "abc" } } }));
  const outcome = await signUp(config, "max@example.test", "a-good-password");
  assert.equal(outcome.ok, true);
  assert.equal(outcome.session, null);
  assert.match(outcome.message, /Check your email/);
});

test("Supabase's developer wording becomes something an athlete can act on", async () => {
  const cases = [
    [400, { error_description: "Invalid login credentials" }, "BAD_CREDENTIALS", /do not match/],
    [422, { msg: "User already registered" }, "ALREADY_REGISTERED", /Sign in instead/],
    [400, { msg: "Email not confirmed" }, "EMAIL_UNCONFIRMED", /confirm the address/],
    [422, { msg: "Password should be at least 6 characters" }, "WEAK_PASSWORD", /8 characters/],
    [429, { msg: "rate limit exceeded" }, "TOO_MANY", /Wait a minute/],
  ];
  for (const [status, body, code, message] of cases) {
    const { config } = fakeSupabase(() => ({ status, body }));
    const outcome = await signIn(config, "max@example.test", "a-good-password");
    assert.equal(outcome.ok, false, JSON.stringify(body));
    assert.equal(outcome.code, code);
    assert.match(outcome.message, message);
  }
});

test("a failure never leaks the raw provider error to the athlete", async () => {
  const { config } = fakeSupabase(() => ({ status: 500, body: { msg: "pgbouncer: connection pool exhausted at 10.0.0.4:6543" } }));
  const outcome = await signIn(config, "max@example.test", "a-good-password");
  assert.equal(outcome.ok, false);
  assert.doesNotMatch(outcome.message, /pgbouncer|10\.0\.0\.4|pool/);
});

test("an unreachable service says so instead of throwing", async () => {
  const config = { url: "https://proj.supabase.co", anonKey: "k", fetchImpl: async () => { throw new Error("network down"); } };
  const outcome = await signIn(config, "max@example.test", "a-good-password");
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "AUTH_UNREACHABLE");
  assert.equal(outcome.status, 503);
});

test("a password reset never reveals whether the account exists", async () => {
  for (const status of [200, 400, 404, 500]) {
    const { config } = fakeSupabase(() => ({ status, body: { msg: "User not found" } }));
    const outcome = await requestPasswordReset(config, "stranger@example.test");
    assert.equal(outcome.ok, true, `status ${status} should still look the same`);
    assert.match(outcome.message, /If there is an account/);
  }
});

test("refreshing sends the refresh token and nothing else", async () => {
  const { config, calls } = fakeSupabase(() => ({ status: 200, body: goodSession }));
  const outcome = await refreshSession(config, "refresh-token");
  assert.equal(outcome.ok, true);
  assert.match(calls[0].url, /grant_type=refresh_token/);
  assert.deepEqual(calls[0].body, { refresh_token: "refresh-token" });
});

test("credentials are checked before anything reaches the network", () => {
  assert.equal(validateCredentials("max@example.test", "a-good-password").ok, true);
  for (const [email, password, code] of [
    ["not-an-email", "a-good-password", "INVALID_EMAIL"],
    ["", "a-good-password", "INVALID_EMAIL"],
    ["max@example.test", "short", "WEAK_PASSWORD"],
    ["max@example.test", "", "WEAK_PASSWORD"],
    ["max@example.test", "x".repeat(300), "WEAK_PASSWORD"],
    [null, null, "INVALID_EMAIL"],
  ]) {
    const result = validateCredentials(email, password);
    assert.equal(result.ok, false, `${email} / ${password}`);
    assert.equal(result.code, code);
  }
});

test("the anon key is sent as the API key, never the user's own token", async () => {
  const { config, calls } = fakeSupabase(() => ({ status: 200, body: goodSession }));
  await signIn(config, "max@example.test", "a-good-password");
  assert.equal(calls[0].headers.apikey, "anon-key");
  assert.equal(calls[0].headers.authorization, "Bearer anon-key");
});

// Finishing a reset. The emailed link carries a short lived session, and the
// only thing that makes this safe is that the new password is set with that
// session rather than with the project's anon key.

test("the new password is set with the athlete's own token, not the anon key", async () => {
  const { config, calls } = fakeSupabase(() => ({ status: 200, body: { id: "user-1" } }));
  const outcome = await updatePassword(config, "recovery.access.token", "a-brand-new-password");
  assert.equal(outcome.ok, true);
  assert.match(calls[0].url, /\/auth\/v1\/user$/);
  // Supabase only accepts this for the account the token belongs to, which is
  // what stops a leaked link changing somebody else's password.
  assert.equal(calls[0].headers.authorization, "Bearer recovery.access.token");
  assert.equal(calls[0].headers.apikey, "anon-key");
  assert.equal(calls[0].body.password, "a-brand-new-password");
});

test("an expired or reused link says so rather than blaming the typing", async () => {
  for (const status of [401, 403]) {
    const { config } = fakeSupabase(() => ({ status, body: { msg: "invalid claim: missing sub claim" } }));
    const outcome = await updatePassword(config, "stale.token", "a-brand-new-password");
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, "LINK_EXPIRED");
    assert.match(outcome.message, /expired or has already been used/);
  }
});

test("reusing the current password is its own message", async () => {
  const { config } = fakeSupabase(() => ({ status: 422, body: { msg: "New password should be different from the old password." } }));
  const outcome = await updatePassword(config, "recovery.token", "the-same-password");
  assert.equal(outcome.code, "PASSWORD_UNCHANGED");
  assert.match(outcome.message, /Choose a different one/);
});

test("an unreachable auth service does not look like a rejected password", async () => {
  const config = { url: "https://proj.supabase.co", anonKey: "anon-key", fetchImpl: async () => { throw new Error("offline"); } };
  const outcome = await updatePassword(config, "recovery.token", "a-brand-new-password");
  assert.equal(outcome.code, "AUTH_UNREACHABLE");
  assert.equal(outcome.status, 503);
});

test("one rule decides what a password has to be, everywhere", async () => {
  // Sign up and the reset screen must not disagree about this, or somebody sets
  // a password on one screen that the other would have refused.
  for (const bad of ["", "short", "x".repeat(201)]) {
    assert.equal(validatePassword(bad).ok, false);
    assert.equal(validateCredentials("max@example.test", bad).ok, false);
  }
  assert.equal(validatePassword("a-good-password").ok, true);
  assert.equal(validateCredentials("max@example.test", "a-good-password").ok, true);
});

test("the reset email points at a screen that can finish the job", () => {
  // The regression this guards: the link used to land on the site root, where
  // there was no way to set a password. The email arrived and did nothing.
  const route = readFileSync("app/api/auth/reset/route.ts", "utf8");
  assert.match(route, /\/reset-password/);
  assert.ok(existsSync("app/reset-password/page.tsx"), "the link has nowhere to land");
});
