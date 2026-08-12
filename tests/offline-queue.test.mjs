// An athlete finishes in a basement, writes the session, and walks out. What
// this file is really testing is that the walk out is the only thing they have
// to remember to do.
//
// The failure that mattered before this existed was quieter than a lost note:
// the save path told them "FightIQ will send it the moment you are back online"
// and there was nothing anywhere that sent it.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  QUEUE_KEY, QUEUE_LIMIT, enqueueNote, flushQueue, outcomeForStatus,
  readQueue, removeQueued, waitingMessage,
} from "../lib/offline-queue.ts";
import { DRAFT_KEY } from "../lib/training-draft.ts";

function storage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
    get size() { return data.size; },
  };
}

function note(overrides = {}) {
  return {
    clientKey: "key-1",
    text: "Rolled six rounds, kept losing the underhook from half guard.",
    discipline: "BJJ",
    sessionType: "Sparring",
    queuedAt: "2026-08-12T20:00:00.000Z",
    ...overrides,
  };
}

/** Records what was sent, and answers with the statuses given to it in order. */
function server(statuses) {
  const sent = [];
  const queue = [...statuses];
  return {
    sent,
    fetch: async (url, init) => {
      sent.push({ url, body: JSON.parse(init.body) });
      const next = queue.shift() ?? 200;
      if (next === "offline") throw new TypeError("Failed to fetch");
      return { ok: next >= 200 && next < 300, status: next };
    },
  };
}

test("a note written with no signal is still there after the app is closed", () => {
  const store = storage();
  enqueueNote(store, note());
  assert.deepEqual(readQueue(store).map((entry) => entry.text), [note().text]);
});

test("pressing save twice on the same note queues one session, not two", () => {
  const store = storage();
  enqueueNote(store, note({ text: "first attempt" }));
  enqueueNote(store, note({ text: "second attempt, same note" }));
  const queued = readQueue(store);
  assert.equal(queued.length, 1);
  // The later text wins, because it is what the athlete last saw on screen.
  assert.equal(queued[0].text, "second attempt, same note");
});

test("two different sessions in one signal free evening both survive", () => {
  const store = storage();
  enqueueNote(store, note({ clientKey: "key-1", text: "morning wrestling" }));
  enqueueNote(store, note({ clientKey: "key-2", text: "evening bjj" }));
  assert.deepEqual(readQueue(store).map((entry) => entry.text), ["morning wrestling", "evening bjj"]);
});

test("unreadable storage never throws on the path that opens the log screen", () => {
  assert.deepEqual(readQueue(storage({ [QUEUE_KEY]: "not json" })), []);
  assert.deepEqual(readQueue(storage({ [QUEUE_KEY]: '{"not":"an array"}' })), []);
  assert.deepEqual(readQueue(storage({ [QUEUE_KEY]: '[{"clientKey":"k"}]' })), [], "a note with no text is not a note");
  assert.deepEqual(readQueue(null), []);
  const throwing = { getItem() { throw new Error("disabled in private mode"); }, setItem() {}, removeItem() {} };
  assert.deepEqual(readQueue(throwing), []);
  assert.doesNotThrow(() => enqueueNote(throwing, note()));
});

test("a phone offline for a fortnight keeps the newest sessions rather than filling up", () => {
  const store = storage();
  for (let index = 0; index < QUEUE_LIMIT + 5; index += 1) {
    enqueueNote(store, note({ clientKey: `key-${index}`, text: `session ${index}` }));
  }
  const queued = readQueue(store);
  assert.equal(queued.length, QUEUE_LIMIT);
  assert.equal(queued.at(-1).text, `session ${QUEUE_LIMIT + 4}`);
});

test("signal returns and the sessions go up, oldest first", async () => {
  const store = storage();
  enqueueNote(store, note({ clientKey: "key-1", text: "monday" }));
  enqueueNote(store, note({ clientKey: "key-2", text: "wednesday" }));
  const remote = server([200, 200]);

  const result = await flushQueue(store, remote.fetch);

  assert.deepEqual(result, { sent: 2, discarded: 0, waiting: 0 });
  assert.deepEqual(remote.sent.map((call) => call.body.rawEntry), ["monday", "wednesday"]);
  assert.deepEqual(readQueue(store), [], "nothing is left on the phone once the server has it");
});

test("the client key travels with the note, so a retry cannot become a second session", async () => {
  const store = storage();
  enqueueNote(store, note({ clientKey: "key-abc" }));
  const remote = server([200]);
  await flushQueue(store, remote.fetch);
  assert.equal(remote.sent[0].body.clientKey, "key-abc");
  assert.equal(remote.sent[0].url, "/api/training-entries");
});

test("a session the server already has is not sent again and not kept", async () => {
  // The note API answers a known client key with 200 and duplicate: true, which
  // is the case where a reply went missing rather than the request.
  const store = storage();
  enqueueNote(store, note());
  const result = await flushQueue(store, server([200]).fetch);
  assert.deepEqual(result, { sent: 1, discarded: 0, waiting: 0 });
});

test("no network means the session stays exactly where it was", async () => {
  const store = storage();
  enqueueNote(store, note());
  const result = await flushQueue(store, server(["offline"]).fetch);
  assert.deepEqual(result, { sent: 0, discarded: 0, waiting: 1 });
  assert.equal(readQueue(store)[0].text, note().text);
});

test("a flush stops at the first session it could not send, rather than timing out forty times", async () => {
  const store = storage();
  for (const key of ["key-1", "key-2", "key-3"]) enqueueNote(store, note({ clientKey: key }));
  const remote = server([200, "offline", 200]);

  const result = await flushQueue(store, remote.fetch);

  assert.equal(remote.sent.length, 2, "it gave up after the one that failed");
  assert.deepEqual(result, { sent: 1, discarded: 0, waiting: 2 });
});

test("an expired session is worth another go, because signing back in is the point", async () => {
  const store = storage();
  enqueueNote(store, note());
  const result = await flushQueue(store, server([401]).fetch);
  assert.equal(result.waiting, 1, "a 401 must never discard training");
  assert.equal(outcomeForStatus(401), "keep");
  assert.equal(outcomeForStatus(500), "keep");
  assert.equal(outcomeForStatus(503), "keep");
});

test("a session the API can never accept is dropped rather than retried for ever", () => {
  assert.equal(outcomeForStatus(422), "discard");
  assert.equal(outcomeForStatus(400), "discard");
  assert.equal(outcomeForStatus(200), "sent");
});

test("removing one session leaves the others alone", () => {
  const store = storage();
  enqueueNote(store, note({ clientKey: "key-1" }));
  enqueueNote(store, note({ clientKey: "key-2" }));
  assert.deepEqual(removeQueued(store, "key-1").map((entry) => entry.clientKey), ["key-2"]);
});

test("an empty queue leaves nothing behind in storage", () => {
  const store = storage();
  enqueueNote(store, note());
  removeQueued(store, "key-1");
  assert.equal(store.size, 0, "an empty outbox should not sit in storage as an empty array");
});

test("what the athlete is told separates saved from sent", () => {
  assert.equal(waitingMessage(0), "");
  assert.equal(waitingMessage(1), "1 session saved on this phone, waiting for signal.");
  assert.equal(waitingMessage(3), "3 sessions saved on this phone, waiting for signal.");
});

// public/offline.html cannot import this module. It is plain HTML with no build
// step behind it on purpose, because it is the one screen that has to work when
// nothing can be fetched. That makes it the second copy of this format, and
// this is what stops the two from drifting apart in a way nobody notices until
// an athlete's session is written to a key the app never reads.
test("the offline page writes to the same place the app reads from", () => {
  const page = readFileSync("public/offline.html", "utf8");
  assert.match(page, new RegExp(`"${QUEUE_KEY}"`), "offline.html does not use the queue key the app reads");
  assert.match(page, new RegExp(`"${DRAFT_KEY}"`), "offline.html does not use the draft key the app restores from");
  assert.match(page, new RegExp(`QUEUE_LIMIT = ${QUEUE_LIMIT}`), "offline.html caps the queue at a different length");
  for (const field of ["clientKey", "text", "discipline", "sessionType", "queuedAt"]) {
    assert.match(page, new RegExp(`${field}:`), `offline.html does not write ${field}`);
  }
});

test("a note written on the offline page is one the app can send", async () => {
  // Built the way offline.html builds it, then read and flushed by this module,
  // which is the actual handover between the two halves of this feature.
  const store = storage();
  store.setItem(QUEUE_KEY, JSON.stringify([{
    clientKey: "written-in-a-basement",
    text: "Six rounds, the left hook kept landing on me.",
    discipline: "Boxing",
    sessionType: "Sparring",
    queuedAt: "2026-08-12T21:00:00.000Z",
  }]));
  const remote = server([200]);

  const result = await flushQueue(store, remote.fetch);

  assert.deepEqual(result, { sent: 1, discarded: 0, waiting: 0 });
  assert.deepEqual(remote.sent[0].body, {
    discipline: "Boxing",
    sessionType: "Sparring",
    rawEntry: "Six rounds, the left hook kept landing on me.",
    clientKey: "written-in-a-basement",
  });
});
