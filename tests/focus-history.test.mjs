// The record the product's whole promise depends on.
//
// "Current focus" was one field the app overwrote whenever the evidence moved,
// so the moment it changed the old one was gone. Six weeks of training would
// still have rendered as "11 sessions logged across 1 day" and every night in
// between would have been unrecoverable, because the answer to "did what you
// told me to work on actually change anything" is the sequence.
//
// Database behaviour, so it is tested against a real database running the app's
// own code rather than a restatement of it.

import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { applySchema } from "../lib/debrief-db.ts";
import { getFocusHistory, getTrainingLifetime, recordFocus, sameFocus } from "../lib/focus-history.ts";

/** Enough of the D1 surface for these paths, backed by real SQLite. */
function d1(db) {
  const bindArgs = (args) => args.map((value) => (value === undefined ? null : value));
  const prepare = (sql) => {
    const statement = { sql, args: [] };
    statement.bind = (...args) => ({ ...statement, bind: statement.bind, args: bindArgs(args), run: statement.run, first: statement.first, all: statement.all });
    statement.run = async function run() { db.prepare(this.sql ?? sql).run(...(this.args ?? [])); return { success: true }; };
    statement.first = async function first() { return db.prepare(this.sql ?? sql).get(...(this.args ?? [])) ?? null; };
    statement.all = async function all() { return { results: db.prepare(this.sql ?? sql).all(...(this.args ?? [])) }; };
    return statement;
  };
  return { prepare, batch: async (statements) => { for (const statement of statements) await statement.run(); } };
}

async function fresh() {
  const db = d1(new DatabaseSync(":memory:"));
  await applySchema(db);
  return db;
}

let entryCount = 0;
async function logSession(db, { at, discipline = "BJJ", takeaway = null }) {
  const id = `entry-${entryCount += 1}`;
  await db.prepare(`INSERT INTO training_entries (id, owner_id, discipline, session_type, raw_entry, input_method, created_at)
    VALUES (?, 'owner', ?, 'Class', 'a note', 'text', ?)`).bind(id, discipline, at).run();
  if (takeaway) {
    await db.prepare(`INSERT INTO training_debriefs (entry_id, owner_id, summary, takeaway, status, confidence, created_at, updated_at)
      VALUES (?, 'owner', 'summary', ?, 'complete', 0.7, ?, ?)`).bind(id, takeaway, at, at).run();
  }
}

test("a focus that has not changed does not open a second period", async () => {
  const db = await fresh();
  await recordFocus(db, "owner", { focus: "Win the grip first", reason: "r", source: "fightiq", now: "2026-08-01T10:00:00.000Z" });
  await recordFocus(db, "owner", { focus: "Win the grip first", reason: "r", source: "fightiq", now: "2026-08-02T10:00:00.000Z" });
  // The same focus written differently is the same focus, not a new one.
  await recordFocus(db, "owner", { focus: "win the grip first.", reason: "r", source: "fightiq", now: "2026-08-03T10:00:00.000Z" });
  const history = await getFocusHistory(db, "owner");
  assert.equal(history.length, 1);
  assert.equal(history[0].endedAt, null);
});

test("sameFocus ignores case, spacing and a full stop, and nothing else", () => {
  assert.equal(sameFocus("Win the grip first", "win the grip first."), true);
  assert.equal(sameFocus("Win  the grip   first", "Win the grip first"), true);
  assert.equal(sameFocus("Win the grip first", "Win the grip early"), false);
});

test("a changed focus closes the old period and opens a new one", async () => {
  const db = await fresh();
  await recordFocus(db, "owner", { focus: "Win the grip first", reason: "r", source: "fightiq", now: "2026-08-01T10:00:00.000Z" });
  await recordFocus(db, "owner", { focus: "Keep the frames in early", reason: "r2", source: "stated", now: "2026-08-09T10:00:00.000Z" });
  const history = await getFocusHistory(db, "owner");
  assert.equal(history.length, 2);
  // Newest first.
  assert.equal(history[0].focus, "Keep the frames in early");
  assert.equal(history[0].endedAt, null);
  assert.equal(history[1].focus, "Win the grip first");
  assert.equal(history[1].endedAt, "2026-08-09T10:00:00.000Z");
});

test("only one period is ever open, even if two requests arrive together", async () => {
  const db = await fresh();
  await Promise.all([
    recordFocus(db, "owner", { focus: "Win the grip first", reason: "", source: "fightiq", now: "2026-08-01T10:00:00.000Z" }),
    recordFocus(db, "owner", { focus: "Win the grip first", reason: "", source: "fightiq", now: "2026-08-01T10:00:00.000Z" }),
  ]);
  const open = await db.prepare("SELECT COUNT(*) AS n FROM focus_periods WHERE owner_id = 'owner' AND ended_at IS NULL").bind().first();
  assert.equal(open.n, 1);
});

test("sessions, days and disciplines are counted from the sessions themselves", async () => {
  const db = await fresh();
  await recordFocus(db, "owner", { focus: "Repeat ankle locks with controlled resistance", reason: "r", source: "fightiq", now: "2026-08-01T00:00:00.000Z" });
  await logSession(db, { at: "2026-08-02T20:00:00.000Z", discipline: "BJJ" });
  await logSession(db, { at: "2026-08-02T22:00:00.000Z", discipline: "BJJ" });
  await logSession(db, { at: "2026-08-04T20:00:00.000Z", discipline: "Muay Thai", takeaway: "The teep landed clean all night." });
  const [period] = await getFocusHistory(db, "owner");
  assert.equal(period.sessions, 3);
  // Two sessions in one night is one day of training.
  assert.equal(period.days, 2);
  assert.deepEqual(period.disciplines, [{ name: "BJJ", sessions: 2 }, { name: "Muay Thai", sessions: 1 }]);
  // What they left the focus saying.
  assert.equal(period.closingTakeaway, "The teep landed clean all night.");
});

test("a session logged after a focus ended belongs to the next one, not the old one", async () => {
  const db = await fresh();
  await recordFocus(db, "owner", { focus: "Win the grip first", reason: "", source: "fightiq", now: "2026-08-01T00:00:00.000Z" });
  await logSession(db, { at: "2026-08-02T20:00:00.000Z" });
  await recordFocus(db, "owner", { focus: "Keep the frames in early", reason: "", source: "stated", now: "2026-08-03T00:00:00.000Z" });
  await logSession(db, { at: "2026-08-04T20:00:00.000Z" });
  const [current, previous] = await getFocusHistory(db, "owner");
  assert.equal(current.sessions, 1);
  assert.equal(previous.sessions, 1);
});

test("an athlete who already had training gets a record that starts where their training started", async () => {
  // Otherwise the very first thing the record says is that they have logged
  // nothing on the focus they are on, which is false.
  const db = await fresh();
  await logSession(db, { at: "2026-08-09T23:51:00.000Z" });
  await logSession(db, { at: "2026-08-09T23:59:00.000Z" });
  await recordFocus(db, "owner", {
    focus: "Repeat ankle locks with controlled resistance",
    reason: "", source: "fightiq", now: "2026-08-11T07:00:00.000Z",
    firstSessionAt: "2026-08-09T23:51:00.000Z",
  });
  const [period] = await getFocusHistory(db, "owner");
  assert.equal(period.startedAt, "2026-08-09T23:51:00.000Z");
  assert.equal(period.sessions, 2);
  // Marked, so the screen can be honest that the focus behind those sessions
  // was never written down.
  assert.equal(period.source, "backfilled");
});

test("the backfill only applies to the very first period", async () => {
  const db = await fresh();
  await logSession(db, { at: "2026-08-09T23:51:00.000Z" });
  await recordFocus(db, "owner", { focus: "First", reason: "", source: "fightiq", now: "2026-08-11T07:00:00.000Z", firstSessionAt: "2026-08-09T23:51:00.000Z" });
  await recordFocus(db, "owner", { focus: "Second", reason: "", source: "stated", now: "2026-08-12T07:00:00.000Z", firstSessionAt: "2026-08-09T23:51:00.000Z" });
  const [current] = await getFocusHistory(db, "owner");
  assert.equal(current.startedAt, "2026-08-12T07:00:00.000Z");
  assert.equal(current.source, "stated");
});

test("a focus with no sessions yet reports zero days rather than a guessed one", async () => {
  const db = await fresh();
  await recordFocus(db, "owner", { focus: "Win the grip first", reason: "", source: "fightiq", now: new Date().toISOString() });
  const [period] = await getFocusHistory(db, "owner");
  assert.equal(period.days, 0);
});

test("a better explanation for the same focus updates it rather than restarting it", async () => {
  const db = await fresh();
  await recordFocus(db, "owner", { focus: "Win the grip first", reason: "", source: "fightiq", now: "2026-08-01T10:00:00.000Z" });
  await recordFocus(db, "owner", { focus: "Win the grip first", reason: "Because the grip decides the exchange.", source: "fightiq", now: "2026-08-02T10:00:00.000Z" });
  const history = await getFocusHistory(db, "owner");
  assert.equal(history.length, 1);
  assert.equal(history[0].reason, "Because the grip decides the exchange.");
  assert.equal(history[0].startedAt, "2026-08-01T10:00:00.000Z");
});

test("lifetime is everything ever logged, not the last seven days of it", async () => {
  // The seven day window is why My Game could only ever say "11 sessions logged
  // across 1 day", and why five days later it would have said nothing at all.
  const db = await fresh();
  await logSession(db, { at: "2026-05-01T20:00:00.000Z", discipline: "BJJ" });
  await logSession(db, { at: "2026-06-14T20:00:00.000Z", discipline: "Wrestling" });
  await logSession(db, { at: "2026-08-09T20:00:00.000Z", discipline: "BJJ" });
  const lifetime = await getTrainingLifetime(db, "owner");
  assert.equal(lifetime.sessions, 3);
  assert.equal(lifetime.days, 3);
  assert.equal(lifetime.firstSessionAt, "2026-05-01T20:00:00.000Z");
  assert.equal(lifetime.latestSessionAt, "2026-08-09T20:00:00.000Z");
  assert.deepEqual(lifetime.disciplines, [{ name: "BJJ", sessions: 2 }, { name: "Wrestling", sessions: 1 }]);
});

test("an athlete with nothing logged gets an empty record rather than a wrong one", async () => {
  const db = await fresh();
  assert.deepEqual(await getFocusHistory(db, "owner"), []);
  const lifetime = await getTrainingLifetime(db, "owner");
  assert.equal(lifetime.sessions, 0);
  assert.equal(lifetime.firstSessionAt, null);
});

test("a blank focus is not recorded at all", async () => {
  const db = await fresh();
  await recordFocus(db, "owner", { focus: "   ", reason: "", source: "fightiq", now: "2026-08-01T10:00:00.000Z" });
  assert.deepEqual(await getFocusHistory(db, "owner"), []);
});
