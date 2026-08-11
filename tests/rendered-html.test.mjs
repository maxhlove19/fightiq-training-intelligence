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
