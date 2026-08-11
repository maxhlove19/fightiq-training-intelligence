// "MEMORY UPDATED" and "KEY INSIGHT" are claims the debrief screen makes in
// large type. They were being made over the offline fallback, whose takeaway is
// "your session is saved with the detail you logged" — an acknowledgement
// presented as an insight, which is the fastest way to stop being believed.

import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { applySchema, getDebriefState } from "../lib/debrief-db.ts";

function d1(db) {
  const bind = (args) => args.map((value) => (value === undefined ? null : value));
  const prepare = (sql) => {
    const base = { sql, args: [] };
    base.bind = (...args) => ({ ...base, bind: base.bind, args: bind(args), run: base.run, first: base.first, all: base.all });
    base.run = async function run() { db.prepare(this.sql ?? sql).run(...(this.args ?? [])); return { success: true }; };
    base.first = async function first() { return db.prepare(this.sql ?? sql).get(...(this.args ?? [])) ?? null; };
    base.all = async function all() { return { results: db.prepare(this.sql ?? sql).all(...(this.args ?? [])) }; };
    return base;
  };
  return { prepare, batch: async (statements) => { for (const statement of statements) await statement.run(); } };
}

async function debriefWith(nextSessionFocus) {
  const db = d1(new DatabaseSync(":memory:"));
  await applySchema(db);
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO training_entries (id, owner_id, discipline, session_type, raw_entry, input_method, created_at)
    VALUES ('e1', 'owner', 'Muay Thai', 'Class', 'kicks landing flat', 'voice_or_text', ?)`).bind(now).run();
  await db.prepare(`INSERT INTO training_debriefs (entry_id, owner_id, summary, takeaway, coach_detail, fightiq_explanation, next_session_focus, structured_memory_json, status, question_count, confidence, created_at, updated_at)
    VALUES ('e1', 'owner', 'summary', 'a takeaway', '', '', ?, '{"techniques":[]}', 'complete', 0, 0.6, ?, ?)`)
    .bind(nextSessionFocus, now, now).run();
  return getDebriefState(db, "e1", "owner");
}

test("a debrief that gives you something for next session claims the insight", async () => {
  const state = await debriefWith("Turn the support foot before the shin arrives");
  assert.equal(state.status, "complete");
  assert.equal(state.memoryUpdated, true);
});

test("the offline fallback is called a saved note, not a key insight", async () => {
  // Every fallback path returns an empty next-session focus. So does a debrief
  // held back for a head knock, and calling that one a saved note is right too.
  assert.equal((await debriefWith("")).memoryUpdated, false);
  assert.equal((await debriefWith("   ")).memoryUpdated, false);
});

test("a debrief nobody has started is not reported as complete", async () => {
  const db = d1(new DatabaseSync(":memory:"));
  await applySchema(db);
  const state = await getDebriefState(db, "missing", "owner");
  assert.equal(state.status, "not_started");
});
