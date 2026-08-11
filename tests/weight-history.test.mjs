// Bodyweight lived inside athlete_setup_json, and the onboarding route upserts
// that whole blob, so an athlete who went back through setup and typed a new
// weight destroyed the old one.
//
// In most apps that is a nice-to-have. In combat sports the weight curve is the
// sport, and it is the same unrecoverable class as the focus was: every day
// without it is a day nobody can reconstruct.

import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { applySchema } from "../lib/debrief-db.ts";
import { getWeightRecord, isUsableWeight, recordWeighIn } from "../lib/weight-history.ts";

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

const log = (db, weightKg, now, source = "logged") => recordWeighIn(db, "owner", { weightKg, source, now });

test("changing your weight keeps the one before it", async () => {
  // The whole point. Onboarding overwrote the old number; this keeps both.
  const db = await fresh();
  await log(db, 84.2, "2026-06-01T08:00:00.000Z", "onboarding");
  await log(db, 81.5, "2026-07-01T08:00:00.000Z", "onboarding");
  await log(db, 77.4, "2026-08-01T08:00:00.000Z", "onboarding");
  const record = await getWeightRecord(db, "owner");
  assert.deepEqual(record.entries.map((item) => item.weightKg), [84.2, 81.5, 77.4]);
  assert.equal(record.first.weightKg, 84.2, "oldest first, so the curve reads left to right");
  assert.equal(record.latest.weightKg, 77.4);
});

test("the same weight again is not a new weigh-in", async () => {
  // /api/product is read on every screen. A record that gains a row per page
  // load is not a record.
  const db = await fresh();
  assert.equal(await log(db, 77.4, "2026-08-01T08:00:00.000Z", "onboarding"), true);
  assert.equal(await log(db, 77.4, "2026-08-02T08:00:00.000Z", "onboarding"), false);
  assert.equal(await log(db, 77.4, "2026-08-03T08:00:00.000Z", "onboarding"), false);
  const record = await getWeightRecord(db, "owner");
  assert.equal(record.entries.length, 1);
});

test("correcting a typo on the same day replaces it rather than adding a second morning", async () => {
  const db = await fresh();
  await log(db, 774, "2026-08-01T08:00:00.000Z");
  await log(db, 77.4, "2026-08-01T08:02:00.000Z");
  const record = await getWeightRecord(db, "owner");
  assert.equal(record.entries.length, 1);
  assert.equal(record.latest.weightKg, 77.4);
});

test("change is stated across a real window, not against the previous row", async () => {
  // "Down 2kg since last Tuesday" and "down 2kg over a month" are different
  // facts, and only the second one says anything about a camp.
  const db = await fresh();
  await log(db, 84.0, "2026-07-02T08:00:00.000Z");
  await log(db, 82.0, "2026-07-16T08:00:00.000Z");
  await log(db, 81.0, "2026-07-31T08:00:00.000Z");
  await log(db, 80.6, "2026-08-01T08:00:00.000Z");
  const record = await getWeightRecord(db, "owner");
  // Nearest weigh-in to thirty days before the latest is 2 July.
  assert.equal(record.changeKg, -3.4);
  assert.equal(record.changeDays, 30);
});

test("one weigh-in states no change at all rather than a change of zero", async () => {
  const db = await fresh();
  await log(db, 77.4, "2026-08-01T08:00:00.000Z");
  const record = await getWeightRecord(db, "owner");
  assert.equal(record.changeKg, null);
  assert.equal(record.changeDays, 0);
});

test("an athlete with nothing on record gets an empty curve, not a wrong one", async () => {
  const record = await getWeightRecord(await fresh(), "owner");
  assert.deepEqual(record.entries, []);
  assert.equal(record.latest, null);
  assert.equal(record.first, null);
  assert.equal(record.changeKg, null);
});

test("a number that cannot be a bodyweight is refused", async () => {
  // A typo or a unit mix-up in the record is worse than a gap in it.
  assert.equal(isUsableWeight(0), false);
  assert.equal(isUsableWeight(-77), false);
  assert.equal(isUsableWeight(24), false);
  assert.equal(isUsableWeight(301), false);
  assert.equal(isUsableWeight(NaN), false);
  assert.equal(isUsableWeight("77"), false);
  assert.equal(isUsableWeight(null), false);
  assert.equal(isUsableWeight(77.4), true);
  assert.equal(isUsableWeight(56), true);

  const db = await fresh();
  assert.equal(await log(db, 7.4, "2026-08-01T08:00:00.000Z"), false);
  assert.deepEqual((await getWeightRecord(db, "owner")).entries, []);
});

test("where a weigh-in came from is kept, so setup and a real weigh-in are distinguishable", async () => {
  const db = await fresh();
  await log(db, 84.0, "2026-06-01T08:00:00.000Z", "onboarding");
  await log(db, 77.4, "2026-08-01T08:00:00.000Z", "logged");
  const record = await getWeightRecord(db, "owner");
  assert.deepEqual(record.entries.map((item) => item.source), ["onboarding", "logged"]);
});

test("a scale disagreeing with itself by grams is not a new weigh-in", async () => {
  const db = await fresh();
  await log(db, 77.40, "2026-08-01T08:00:00.000Z");
  assert.equal(await log(db, 77.42, "2026-08-05T08:00:00.000Z"), false);
  assert.equal((await getWeightRecord(db, "owner")).entries.length, 1);
});
