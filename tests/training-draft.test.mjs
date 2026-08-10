import assert from "node:assert/strict";
import test from "node:test";
import { DRAFT_KEY, clearDraft, draftAge, readDraft, writeDraft } from "../lib/training-draft.ts";

function fakeStorage(initial = {}) {
  const store = { ...initial };
  return {
    store,
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
  };
}

const draft = { text: "Rolled six rounds, kept losing the underhook.", discipline: "BJJ", sessionType: "Open mat", savedAt: "2026-08-10T18:00:00.000Z" };

test("a note written on the device comes back intact", () => {
  const storage = fakeStorage();
  writeDraft(storage, draft);
  assert.deepEqual(readDraft(storage), draft);
});

test("saving clears it, so a saved session never reappears as a draft", () => {
  const storage = fakeStorage();
  writeDraft(storage, draft);
  clearDraft(storage);
  assert.equal(readDraft(storage), null);
});

test("an emptied note clears itself rather than restoring a blank draft", () => {
  const storage = fakeStorage();
  writeDraft(storage, draft);
  writeDraft(storage, { ...draft, text: "   " });
  assert.equal(readDraft(storage), null);
});

test("corrupt or foreign storage never throws at the athlete", () => {
  assert.equal(readDraft(fakeStorage({ [DRAFT_KEY]: "{not json" })), null);
  assert.equal(readDraft(fakeStorage({ [DRAFT_KEY]: "null" })), null);
  assert.equal(readDraft(fakeStorage({ [DRAFT_KEY]: '{"text":123}' })), null);
  assert.equal(readDraft(fakeStorage()), null);
  assert.equal(readDraft(null), null);
  assert.equal(readDraft(undefined), null);
});

test("a draft missing its context still restores the words", () => {
  const storage = fakeStorage({ [DRAFT_KEY]: '{"text":"sparred hard"}' });
  const restored = readDraft(storage);
  assert.equal(restored.text, "sparred hard");
  assert.equal(restored.discipline, "MMA");
  assert.equal(restored.sessionType, "Class");
});

test("storage that refuses to write does not break typing", () => {
  const hostile = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); }, removeItem: () => { throw new Error("blocked"); } };
  assert.doesNotThrow(() => writeDraft(hostile, draft));
  assert.doesNotThrow(() => clearDraft(hostile));
  assert.equal(readDraft(hostile), null);
});

test("the age reads the way an athlete would say it", () => {
  const now = new Date("2026-08-10T18:00:00.000Z");
  const at = (minutes) => new Date(now.getTime() - minutes * 60000).toISOString();
  assert.equal(draftAge(at(0), now), "just now");
  assert.equal(draftAge(at(1), now), "1 minute ago");
  assert.equal(draftAge(at(42), now), "42 minutes ago");
  assert.equal(draftAge(at(60), now), "1 hour ago");
  assert.equal(draftAge(at(60 * 5), now), "5 hours ago");
  assert.equal(draftAge(at(60 * 30), now), "yesterday");
  assert.equal(draftAge(at(60 * 24 * 3), now), "3 days ago");
  assert.equal(draftAge("not a date", now), "earlier");
});
