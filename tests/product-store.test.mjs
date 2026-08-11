// Measured on the live site: a cold load fired /api/product twice before the
// athlete touched anything, at 613ms and 1947ms into the load, taking 1321ms and
// 1129ms. Every screen change after that fired another one. On gym wifi each of
// those is a fighter standing in a corridor waiting for a screen they have
// already seen.
//
// The two rules below matter more than the deduping, because they are what stop
// a cache being worse than no cache.

import assert from "node:assert/strict";
import test from "node:test";
import { createProductStore } from "../lib/product-store.ts";

function fakeFetch(responses) {
  const calls = [];
  // init has to be passed through, or the abort signal never reaches the fake and
  // the timeout test hangs instead of testing the timeout.
  const impl = async (url, init) => {
    calls.push(String(url));
    const next = responses.shift();
    if (typeof next === "function") return next(url, init);
    return { ok: true, json: async () => next ?? { value: "payload" } };
  };
  impl.calls = calls;
  return impl;
}

function clock(start = 1000) {
  const state = { t: start };
  return { now: () => state.t, advance: (ms) => { state.t += ms; } };
}

test("a screen change costs nothing while the copy is still good", async () => {
  const time = clock();
  const fetchImpl = fakeFetch([{ value: "one" }]);
  const store = createProductStore({ fetchImpl, now: time.now, staleMs: 30_000 });
  await store.load();
  // Home, Learn, Coach, My Game, back to Home.
  await store.load(); await store.load(); await store.load(); await store.load();
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(store.getState().data.value, "one");
});

test("two components mounting together share one request rather than racing", async () => {
  // This is the exact shape of the two requests a cold arrival was firing.
  const time = clock();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fetchImpl = fakeFetch([async () => { await gate; return { ok: true, json: async () => ({ value: "one" }) }; }]);
  const store = createProductStore({ fetchImpl, now: time.now });
  const both = Promise.all([store.load(), store.load()]);
  release();
  await both;
  assert.equal(fetchImpl.calls.length, 1);
});

test("a stale copy is refreshed", async () => {
  const time = clock();
  const fetchImpl = fakeFetch([{ value: "one" }, { value: "two" }]);
  const store = createProductStore({ fetchImpl, now: time.now, staleMs: 30_000 });
  await store.load();
  time.advance(31_000);
  await store.load();
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(store.getState().data.value, "two");
});

test("what the athlete just changed is on screen immediately, not after a revalidation", async () => {
  const time = clock();
  const fetchImpl = fakeFetch([{ value: "one" }, { value: "saved" }]);
  const store = createProductStore({ fetchImpl, now: time.now, staleMs: 30_000 });
  await store.load();
  // A save inside the stale window still has to be fetched and shown.
  await store.load({ force: true });
  assert.equal(store.getState().data.value, "saved");

  // And a write-through is visible without any request at all.
  store.set({ value: "typed" });
  assert.equal(store.getState().data.value, "typed");
});

test("a failed refetch never blanks a screen that already had good data", async () => {
  const time = clock();
  const fetchImpl = fakeFetch([
    { value: "good" },
    async () => { throw new Error("network down"); },
  ]);
  const store = createProductStore({ fetchImpl, now: time.now });
  await store.load();
  const ok = await store.load({ force: true });
  assert.equal(ok, false);
  // The screen keeps what it had.
  assert.equal(store.getState().data.value, "good");
  assert.equal(store.getState().error, "network down");
});

test("a server error never blanks good data either", async () => {
  const time = clock();
  const fetchImpl = fakeFetch([
    { value: "good" },
    async () => ({ ok: false, json: async () => ({ error: { message: "FightIQ memory is unavailable." } }) }),
  ]);
  const store = createProductStore({ fetchImpl, now: time.now });
  await store.load();
  await store.load({ force: true });
  assert.equal(store.getState().data.value, "good");
  assert.equal(store.getState().error, "FightIQ memory is unavailable.");
});

test("a hung request ends, and what was on screen survives it", async () => {
  // The failure mode in a gym is not a clean error, it is a request that never
  // comes back, so a screen without a timeout spins until the athlete gives up.
  const time = clock();
  const fetchImpl = fakeFetch([
    { value: "good" },
    (url, init) => new Promise((resolve, reject) => {
      const signal = init?.signal;
      if (signal) signal.addEventListener("abort", () => reject(new Error("aborted")));
    }),
  ]);
  const store = createProductStore({ fetchImpl, now: time.now, timeoutMs: 40 });
  await store.load();
  const ok = await store.load({ force: true });
  assert.equal(ok, false);
  assert.equal(store.getState().data.value, "good");
  assert.equal(store.getState().loading, false);
});

test("only somebody with nothing to look at is shown a spinner", async () => {
  const time = clock();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fetchImpl = fakeFetch([
    { value: "good" },
    async () => { await gate; return { ok: true, json: async () => ({ value: "fresher" }) }; },
  ]);
  const store = createProductStore({ fetchImpl, now: time.now });
  const first = store.load();
  assert.equal(store.getState().loading, true, "an empty screen says it is working");
  await first;

  const second = store.load({ force: true });
  assert.equal(store.getState().loading, false, "a refresh behind real data is silent");
  release();
  await second;
});

test("a different topic is a different request, not the same one twice", async () => {
  const time = clock();
  const fetchImpl = fakeFetch([{ value: "feed" }, { value: "topic" }]);
  const store = createProductStore({ fetchImpl, now: time.now, staleMs: 30_000 });
  await store.load();
  await store.load({ url: "/api/product?topic=arm%20drag" });
  assert.deepEqual(fetchImpl.calls, ["/api/product", "/api/product?topic=arm%20drag"]);
  assert.equal(store.getState().data.value, "topic");
});

test("every subscriber hears about a change", async () => {
  const time = clock();
  const store = createProductStore({ fetchImpl: fakeFetch([{ value: "one" }]), now: time.now });
  let home = 0, game = 0;
  const stopHome = store.subscribe(() => { home += 1; });
  store.subscribe(() => { game += 1; });
  await store.load();
  assert.ok(home > 0 && game > 0);
  stopHome();
  const before = home;
  store.set({ value: "two" });
  assert.equal(home, before, "an unmounted screen stops being told");
  assert.ok(game > 0);
});

test("signing out leaves nothing behind for the next person on the phone", async () => {
  const time = clock();
  const store = createProductStore({ fetchImpl: fakeFetch([{ value: "mine" }]), now: time.now });
  await store.load();
  store.clear();
  assert.equal(store.getState().data, null);
  assert.equal(store.getState().fetchedAt, 0);
});
