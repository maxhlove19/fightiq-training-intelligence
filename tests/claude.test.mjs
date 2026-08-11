// The model call is the one thing in this app that costs money on every use and
// cannot be reasoned about by reading a database. These tests pin the request
// shape and, more importantly, every way the call can fail: a refusal, a
// truncated answer, a rate limit. Each of those used to end at an athlete's
// screen as the same unhelpful error.

import assert from "node:assert/strict";
import test from "node:test";
import { CLAUDE_MODEL, ClaudeError, hashOwner, imagePart, requestJson } from "../lib/claude.ts";

const SCHEMA = { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } };

/** A stub that records what was sent and replies with whatever the test wants. */
function stub(responder) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    const headers = new Headers(init.headers);
    calls.push({ url: String(url), body, headers });
    const reply = await responder(body, calls.length, headers);
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json", "request-id": "req_test" },
    });
  };
  return { calls, fetchImpl };
}

function message(overrides = {}) {
  return {
    id: "msg_1", type: "message", role: "assistant", model: CLAUDE_MODEL,
    content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
    stop_reason: "end_turn", stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
    ...overrides,
  };
}

function call(fetchImpl, overrides = {}) {
  return requestJson({
    apiKey: "sk-ant-test", userHash: "hash", system: ["The method.", "The depth reading."],
    user: [{ type: "text", text: "the note" }], schema: SCHEMA,
    effort: "high", maxTokens: 8000, timeoutMs: 5000, fetchImpl, ...overrides,
  });
}

test("the request is Opus 5, with the effort and the schema the caller asked for", async () => {
  const { calls, fetchImpl } = stub(() => ({ body: message() }));
  assert.deepEqual(await call(fetchImpl), { ok: true });

  const [sent] = calls;
  assert.equal(sent.body.model, "claude-opus-5");
  assert.equal(sent.body.output_config.effort, "high");
  assert.equal(sent.body.output_config.format.type, "json_schema");
  assert.deepEqual(sent.body.output_config.format.schema, SCHEMA);
  assert.equal(sent.body.max_tokens, 8000);
  // The owner reaches the provider as a hash and nothing else.
  assert.equal(sent.body.metadata.user_id, "hash");
});

test("nothing this model rejects is ever sent", async () => {
  const { calls, fetchImpl } = stub(() => ({ body: message() }));
  await call(fetchImpl);
  // All four return a 400 on Opus 5. Depth is set by effort instead.
  for (const banned of ["temperature", "top_p", "top_k"]) {
    assert.equal(banned in calls[0].body, false, `${banned} was sent`);
  }
  assert.equal(JSON.stringify(calls[0].body).includes("budget_tokens"), false);
  // Thinking is on by default on this model, so there is nothing to configure.
  assert.equal("thinking" in calls[0].body, false);
});

test("the coaching method is cached and the part that changes per note is not", async () => {
  const { calls, fetchImpl } = stub(() => ({ body: message() }));
  await call(fetchImpl);
  const [stable, varying] = calls[0].body.system;
  assert.deepEqual(stable.cache_control, { type: "ephemeral" });
  assert.equal("cache_control" in varying, false, "caching the varying block would invalidate the prefix every time");
});

test("a declined request is re-run on the recommended substitute", async () => {
  const { calls, fetchImpl } = stub(() => ({ body: message() }));
  await call(fetchImpl);
  assert.equal(calls[0].body.fallbacks, "default");
  assert.match(calls[0].headers.get("anthropic-beta") ?? "", /server-side-fallback-2026-07-01/);
});

test("an account without the fallback beta still gets a working app", async () => {
  const { calls, fetchImpl } = stub((body, index) => index === 1
    ? { status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "unsupported beta: server-side-fallback-2026-07-01" } } }
    : { body: message() });
  assert.deepEqual(await call(fetchImpl), { ok: true });
  assert.equal(calls.length, 2);
  assert.equal("fallbacks" in calls[1].body, false);
});

test("a refusal is read from the stop reason, never from the content", async () => {
  // On a refusal there is nothing in content. Code that reads content[0] first
  // breaks here, which is exactly why this test exists.
  const { fetchImpl } = stub(() => ({ body: message({ content: [], stop_reason: "refusal", stop_details: { category: "cyber", explanation: "declined" } }) }));
  const error = await call(fetchImpl).catch((thrown) => thrown);
  assert.ok(error instanceof ClaudeError);
  assert.equal(error.code, "AI_REFUSED");
  assert.equal(error.development.category, "cyber");
});

test("a half written answer is a failure, not a debrief", async () => {
  const { fetchImpl } = stub(() => ({ body: message({ content: [{ type: "text", text: "{\"ok\": tr" }], stop_reason: "max_tokens" }) }));
  const error = await call(fetchImpl).catch((thrown) => thrown);
  assert.equal(error.code, "AI_TRUNCATED");
});

test("prose where JSON was promised does not reach the athlete", async () => {
  const { fetchImpl } = stub(() => ({ body: message({ content: [{ type: "text", text: "Sure, here is what I think." }] }) }));
  const error = await call(fetchImpl).catch((thrown) => thrown);
  assert.equal(error.code, "AI_UNPARSEABLE");
});

test("an empty answer is reported rather than parsed as nothing", async () => {
  const { fetchImpl } = stub(() => ({ body: message({ content: [] }) }));
  const error = await call(fetchImpl).catch((thrown) => thrown);
  assert.equal(error.code, "AI_EMPTY");
});

test("thinking blocks are skipped and only the answer is parsed", async () => {
  const { fetchImpl } = stub(() => ({ body: message({ content: [
    { type: "thinking", thinking: "not the answer", signature: "sig" },
    { type: "text", text: JSON.stringify({ ok: true }) },
  ] }) }));
  assert.deepEqual(await call(fetchImpl), { ok: true });
});

test("a rate limit keeps its status, so the app can say wait rather than broken", async () => {
  const { fetchImpl } = stub(() => ({ status: 429, body: { type: "error", error: { type: "rate_limit_error", message: "slow down" } } }));
  const error = await call(fetchImpl).catch((thrown) => thrown);
  assert.equal(error.code, "AI_UPSTREAM_ERROR");
  assert.equal(error.status, 429);
});

test("a rejected key is reported as upstream, never as the athlete's fault", async () => {
  const { fetchImpl } = stub(() => ({ status: 401, body: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } }));
  const error = await call(fetchImpl).catch((thrown) => thrown);
  assert.equal(error.code, "AI_UPSTREAM_ERROR");
  assert.equal(error.status, 503);
  assert.match(String(error.development.providerMessage), /ANTHROPIC_API_KEY/);
});

test("a job with no system prompt does not send an empty one", async () => {
  const { calls, fetchImpl } = stub(() => ({ body: message() }));
  await call(fetchImpl, { system: [] });
  assert.equal("system" in calls[0].body, false);
});

test("a photo is split into its type and its bytes", async () => {
  const part = imagePart("data:image/jpeg;base64,QUJD", "image/jpeg");
  assert.deepEqual(part, { type: "image", mimeType: "image/jpeg", base64: "QUJD" });
  // A PDF or an SVG renamed as a photo is refused rather than forwarded.
  assert.equal(imagePart("data:application/pdf;base64,QUJD", "image/png"), null);
  assert.equal(imagePart("data:image/png;base64,", "image/png"), null);
});

test("a photo reaches the model as base64, not as a data URL", async () => {
  const { calls, fetchImpl } = stub(() => ({ body: message() }));
  await call(fetchImpl, { user: [{ type: "text", text: "what is this" }, imagePart("data:image/png;base64,QUJD", "image/png")] });
  const [text, image] = calls[0].body.messages[0].content;
  assert.equal(text.type, "text");
  assert.deepEqual(image, { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } });
});

test("the owner identifier that leaves this app cannot be read back", async () => {
  const hash = await hashOwner("sb:a-real-user-id");
  assert.equal(hash.length, 48);
  assert.equal(hash.includes("sb:"), false);
  assert.equal(hash, await hashOwner("sb:a-real-user-id"), "the same athlete must hash the same way");
  assert.notEqual(hash, await hashOwner("sb:someone-else"));
});
