import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

async function render(headers = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html", ...headers } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the secure FightIQ sign-in surface without starter artifacts", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /FightIQ/);
  // The front door states the problem before it names the product, and offers
  // exactly one thing to do.
  assert.match(html, /You train hard/);
  assert.match(html, /You forget most of it/);
  assert.match(html, /Start free/);
  // Signing up must not require a ChatGPT account, so the form is on the page.
  assert.match(html, /CREATE MY ACCOUNT/);
  assert.match(html, /EMAIL/);
  assert.match(html, /PASSWORD/);
  // The old door stays open for anyone who already has training in here.
  assert.match(html, /signin-with-chatgpt/);
  // The fighter carries the page. A door with no picture on it is a form.
  assert.match(html, /fighter-posters/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton|codex-preview/i);
  // A model key is a server secret. It must never reach a rendered page.
  assert.doesNotMatch(html, /ANTHROPIC_API_KEY|sk-ant-|api\.anthropic\.com/);
});

test("renders the authenticated application shell from trusted identity headers", async () => {
  const response = await render({
    "oai-authenticated-user-id": "test-user",
    "oai-authenticated-user-email": "sam@example.com",
    "oai-authenticated-user-full-name": "Sam%20Rivera",
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /FIGHT/);
  // The visible sentence rather than the node boundary, so that composing the
  // greeting differently is not a test failure while the wrong name would be.
  assert.match(html, /Welcome back, Sam\./);
  assert.match(html, /Checking your athlete profile/);
  assert.doesNotMatch(html, /Sign in to FightIQ/);
});

test("no real person's name is hardcoded as a fallback anywhere in the shell", () => {
  // The fallback that used to sit here was unreachable, because lib/identity.ts
  // resolves displayName as `name || email` and an authenticated athlete always
  // has one. So this is dead code carrying a real first name rather than a live
  // bug, and it is worth stating that precisely rather than overselling it.
  //
  // The greeting still composes correctly with an empty name, so the day that
  // fallback stops being unreachable it degrades to "Good evening" rather than
  // to "Good evening, ".
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /displayName\?\.split\(" "\)\[0\] \?\? ""/);
  const shell = readFileSync(new URL("../app/components/FightIQApp.tsx", import.meta.url), "utf8");
  assert.match(shell, /name \? `\$\{localTime\.greeting\}, \$\{name\}` : localTime\.greeting/);
});
