// fighter_focus_recommendations used to be one row per athlete, upserted on
// every high-confidence completed debrief, so what FightIQ had suggested and
// when was gone the moment a better session came in. Same class of bug as the
// focus and the bodyweight before those became histories.
//
// Tested against persistDebriefResult itself, the function the upsert bug
// actually lived in, rather than a restatement of the schema.

import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { applySchema } from "../lib/debrief-db.ts";
import { persistDebriefResult } from "../lib/debrief-server.ts";
import { getMemorySnapshot } from "../lib/product-db.ts";

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
async function logSession(db, ownerId, at) {
  const id = `entry-${entryCount += 1}`;
  await db.prepare(`INSERT INTO training_entries (id, owner_id, discipline, session_type, raw_entry, input_method, created_at)
    VALUES (?, ?, 'BJJ', 'Class', 'a note', 'text', ?)`).bind(id, ownerId, at).run();
  return id;
}

/** A minimal, high-confidence completed result, the shape that recommends a focus. */
function completeResult(focus, overrides = {}) {
  return {
    status: "complete",
    summary: "summary",
    takeaway: "takeaway",
    coach_detail: "coach detail",
    fightiq_explanation: "Because it kept coming up.",
    next_session_focus: focus,
    confidence: 0.8,
    memory: { techniques: [], positions: [], successes: [], problems: [], concepts: [], sparring_observations: [], related_topics: [], instructor_details: [], reported_facts: [], fightiq_hypotheses: [], what_worked: [], what_failed: [], experiments: [] },
    intelligence: { discipline: "BJJ", technique: "", goal: "", problem: "", suspected_cause: "", coach_instructor_cue: "", what_worked: "", what_failed: "", context: "", confidence: 0.8, follow_up_needed: false, reported_facts: [], fightiq_hypotheses: [], experiment_result: "unknown" },
    question: { prompt: "", choices: [], target_field: "", why_asked: "" },
    ...overrides,
  };
}

test("a second high-confidence debrief adds a recommendation rather than erasing the first", async () => {
  const db = await fresh();
  const first = await logSession(db, "owner", "2026-08-09T20:00:00.000Z");
  await persistDebriefResult(db, first, "owner", completeResult("Win the grip before you attack"), 1);
  const second = await logSession(db, "owner", "2026-08-10T20:00:00.000Z");
  await persistDebriefResult(db, second, "owner", completeResult("Keep the frames in early"), 1);

  const rows = await db.prepare("SELECT focus FROM fighter_focus_recommendation_log WHERE owner_id = ? ORDER BY created_at ASC")
    .bind("owner").all();
  assert.deepEqual(rows.results.map((row) => row.focus), ["Win the grip before you attack", "Keep the frames in early"]);
});

test("the memory snapshot reads the most recent recommendation, not the first", async () => {
  const db = await fresh();
  const first = await logSession(db, "owner", "2026-08-09T20:00:00.000Z");
  await persistDebriefResult(db, first, "owner", completeResult("Win the grip before you attack"), 1);
  const second = await logSession(db, "owner", "2026-08-10T20:00:00.000Z");
  await persistDebriefResult(db, second, "owner", completeResult("Keep the frames in early"), 1);

  const memory = await getMemorySnapshot(db, "owner");
  assert.equal(memory.currentFocus, "Keep the frames in early");
});

test("a low-confidence or safety-held debrief never becomes a recommendation", async () => {
  const db = await fresh();
  const entry = await logSession(db, "owner", "2026-08-09T20:00:00.000Z");
  await persistDebriefResult(db, entry, "owner", completeResult("Test the ankle lock again", { confidence: 0.4 }), 1);
  const held = await logSession(db, "owner", "2026-08-10T20:00:00.000Z");
  await persistDebriefResult(db, held, "owner", completeResult("Push through the head knock"), 1, true);

  const rows = await db.prepare("SELECT focus FROM fighter_focus_recommendation_log WHERE owner_id = ?").bind("owner").all();
  assert.deepEqual(rows.results, []);
});
