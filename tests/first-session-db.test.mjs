// The opening brief has to be the same instruction everywhere an athlete meets
// it, and it has to get out of the way the moment there is real training.
//
// Both of those are database behaviour, not copy, so they are tested against a
// real database running the app's own code rather than a restatement of it.

import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { applySchema } from "../lib/debrief-db.ts";
import { getMemorySnapshot, getOrCreatePreTrainingBrief } from "../lib/product-db.ts";
import { openingFromMemory } from "../lib/first-session.ts";

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

async function athlete(setup = {}) {
  const sqlite = new DatabaseSync(":memory:");
  const db = d1(sqlite);
  await applySchema(db);
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO fighter_profiles (owner_id, onboarding_completed_at, athlete_setup_json, current_focus, focus_reason, primary_goal, style_influences_json, calorie_target, protein_target, carb_target, fat_target, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'performance', '[]', 2400, 180, 260, 70, ?, ?)`)
    .bind("owner", now, JSON.stringify({ disciplines: ["Muay Thai"], experienceLevel: "Building fundamentals", sessionsPerWeek: 3, competitionIntent: "I may compete", ...setup }), setup.currentFocus ?? null, "reason", now, now).run();
  return db;
}

async function logSession(db, note) {
  await db.prepare(`INSERT INTO training_entries (id, owner_id, discipline, session_type, raw_entry, input_method, created_at)
    VALUES (?, 'owner', 'Muay Thai', 'Class', ?, 'voice_or_text', ?)`)
    .bind(crypto.randomUUID(), note, new Date().toISOString()).run();
}

test("before any training, the brief the gym screen opens is the opening one", async () => {
  const db = await athlete();
  const memory = await getMemorySnapshot(db, "owner");
  const opening = openingFromMemory(memory);
  const brief = await getOrCreatePreTrainingBrief(db, "owner", memory);
  // The rail, the sheet behind it and the card above it are one instruction.
  // They used to disagree: the rail said pivot, the sheet said distance.
  assert.equal(brief.mission, opening.mission);
  assert.equal(brief.cue, opening.cue);
});

test("the same brief comes back on a second visit rather than being rewritten", async () => {
  const db = await athlete();
  const first = await getOrCreatePreTrainingBrief(db, "owner");
  const second = await getOrCreatePreTrainingBrief(db, "owner");
  assert.equal(second.mission, first.mission);
  assert.equal(second.createdAt, first.createdAt);
});

test("the first real session retires the opening brief immediately", async () => {
  const db = await athlete();
  const opening = await getOrCreatePreTrainingBrief(db, "owner");
  await logSession(db, "Muay Thai class, worked the switch kick, kept landing flat");

  const after = await getOrCreatePreTrainingBrief(db, "owner");
  // Not eighteen hours later. An athlete who has trained should never be read
  // their day-one note back as though nothing had happened.
  assert.notEqual(after.mission, opening.mission);
  assert.notEqual(after.sourceFocus, opening.sourceFocus);
  assert.equal(openingFromMemory(await getMemorySnapshot(db, "owner")), null);
});

test("a focus the athlete typed themselves drives the brief", async () => {
  const db = await athlete({ currentFocus: "Sharper boxing entries" });
  const brief = await getOrCreatePreTrainingBrief(db, "owner");
  assert.match(brief.mission, /boxing entries/i);
});

test("the memory snapshot counts sessions, so day one can be told apart", async () => {
  const db = await athlete();
  assert.equal((await getMemorySnapshot(db, "owner")).sessionsLogged, 0);
  await logSession(db, "first one");
  assert.equal((await getMemorySnapshot(db, "owner")).sessionsLogged, 1);
  await logSession(db, "second one");
  assert.equal((await getMemorySnapshot(db, "owner")).sessionsLogged, 2);
});

test("the setup the athlete filled in reaches the snapshot the models read", async () => {
  // The debrief prompt is told to pitch at their level. This is where the level
  // actually comes from, and it was missing for the whole life of that rule.
  const memory = await getMemorySnapshot(await athlete(), "owner");
  assert.equal(memory.experienceLevel, "Building fundamentals");
  assert.equal(memory.competitionIntent, "I may compete");
  assert.deepEqual(memory.disciplines, ["Muay Thai"]);
});
