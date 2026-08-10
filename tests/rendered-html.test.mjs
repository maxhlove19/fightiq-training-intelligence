import assert from "node:assert/strict";
import test from "node:test";

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
  assert.match(html, /Your game/);
  assert.match(html, /Sign in to FightIQ/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton|codex-preview/i);
  assert.doesNotMatch(html, /OPENAI_API_KEY|api\.openai\.com/);
});

test("renders the authenticated application shell from trusted identity headers", async () => {
  const response = await render({
    "oai-authenticated-user-id": "test-user",
    "oai-authenticated-user-email": "max@example.com",
    "oai-authenticated-user-full-name": "Max%20Love",
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /FIGHT/);
  assert.match(html, /Welcome back/);
  assert.match(html, />Max</);
  assert.match(html, /Checking your athlete profile/);
  assert.doesNotMatch(html, /Sign in to FightIQ/);
});
