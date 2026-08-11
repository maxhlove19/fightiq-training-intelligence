// fighter_focus_recommendations used to be one row per owner, upserted on
// every completed debrief with owner_id as the primary key. What FightIQ
// suggested last week was gone the moment it suggested something this week,
// the same class of bug as focus and bodyweight before they became records.
//
// This is now append-only, like focus_periods and athlete_weigh_ins. Because
// the old table already existed with owner_id as its primary key, moving to
// an id primary key is a real migration rather than a fresh CREATE TABLE, so
// this file also proves the upgrade path preserves the one row an existing
// athlete already had.

import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { applySchema } from "../lib/debrief-db.ts";

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

/** The table as it existed before this migration: one row per owner, keyed on owner_id. */
function oldSchemaDatabase() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`CREATE TABLE fighter_focus_recommendations (
      owner_id TEXT PRIMARY KEY NOT NULL,
      focus TEXT NOT NULL,
      reason TEXT NOT NULL,
      confidence REAL NOT NULL,
      entry_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
  return d1(raw);
}

async function recommend(db, { owner = "owner", focus, reason = "reason", confidence = 0.8, entryId = "entry-1", at }) {
  await db.prepare(`INSERT INTO fighter_focus_recommendations (id, owner_id, focus, reason, confidence, entry_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), owner, focus, reason, confidence, entryId, at).run();
}

async function latest(db, owner = "owner") {
  return db.prepare("SELECT focus, reason, confidence, entry_id, created_at FROM fighter_focus_recommendations WHERE owner_id = ? ORDER BY created_at DESC LIMIT 1")
    .bind(owner).first();
}

test("a second recommendation does not erase the first", async () => {
  const db = await fresh();
  await recommend(db, { focus: "clear the frame before the roll under", at: "2026-08-01T08:00:00.000Z" });
  await recommend(db, { focus: "stop chasing the far-side collar", at: "2026-08-04T08:00:00.000Z" });
  const rows = (await db.prepare("SELECT focus FROM fighter_focus_recommendations WHERE owner_id = ? ORDER BY created_at ASC").bind("owner").all()).results;
  assert.deepEqual(rows.map((row) => row.focus), ["clear the frame before the roll under", "stop chasing the far-side collar"]);
});

test("the read path takes the most recent suggestion", async () => {
  const db = await fresh();
  await recommend(db, { focus: "old advice", at: "2026-08-01T08:00:00.000Z" });
  await recommend(db, { focus: "current advice", at: "2026-08-04T08:00:00.000Z" });
  const row = await latest(db);
  assert.equal(row.focus, "current advice");
});

test("an existing athlete's one recommendation survives the upgrade", async () => {
  const db = oldSchemaDatabase();
  await db.prepare(`INSERT INTO fighter_focus_recommendations (owner_id, focus, reason, confidence, entry_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .bind("owner", "watch the underhook before it is gone", "it kept slipping in three sessions", 0.75, "entry-9", "2026-07-20T08:00:00.000Z").run();
  await applySchema(db);
  const row = await latest(db);
  assert.equal(row.focus, "watch the underhook before it is gone");
  assert.equal(row.entry_id, "entry-9");
});

test("a recommendation made after the upgrade does not collide with the carried-over one", async () => {
  const db = oldSchemaDatabase();
  await db.prepare(`INSERT INTO fighter_focus_recommendations (owner_id, focus, reason, confidence, entry_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .bind("owner", "the carried-over suggestion", "reason", 0.75, "entry-9", "2026-07-20T08:00:00.000Z").run();
  await applySchema(db);
  await recommend(db, { focus: "the new suggestion", at: "2026-08-05T08:00:00.000Z" });
  const rows = (await db.prepare("SELECT focus FROM fighter_focus_recommendations WHERE owner_id = ? ORDER BY created_at ASC").bind("owner").all()).results;
  assert.deepEqual(rows.map((row) => row.focus), ["the carried-over suggestion", "the new suggestion"]);
});

test("upgrading twice changes nothing, because every request does it", async () => {
  const db = oldSchemaDatabase();
  await db.prepare(`INSERT INTO fighter_focus_recommendations (owner_id, focus, reason, confidence, entry_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .bind("owner", "the only suggestion", "reason", 0.75, "entry-9", "2026-07-20T08:00:00.000Z").run();
  await applySchema(db);
  await applySchema(db);
  await applySchema(db);
  const rows = (await db.prepare("SELECT focus FROM fighter_focus_recommendations WHERE owner_id = ?").bind("owner").all()).results;
  assert.deepEqual(rows.map((row) => row.focus), ["the only suggestion"], "the carried-over row should not be duplicated by re-running the upgrade");
});

test("a fresh database never had the legacy table, and the upgrade is still a no-op", async () => {
  const db = await fresh();
  await applySchema(db);
  const rows = (await db.prepare("SELECT id FROM fighter_focus_recommendations").all()).results;
  assert.deepEqual(rows, []);
});
