// Self-service deletion. The claim is "hard delete, everything, one owner",
// and the two ways that claim quietly breaks are a table nobody remembered to
// add here, and a photo left behind in R2 because only the database row was
// deleted. Both are tested directly rather than trusted.

import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { applySchema } from "../lib/debrief-db.ts";
import { DELETABLE_TABLES, deleteAccountData, rollUpDaily } from "../lib/account-deletion.ts";

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

function fakeR2(pageSize = 2) {
  const objects = new Map();
  return {
    async put(key) { objects.set(key, true); },
    async list({ prefix = "", cursor } = {}) {
      const keys = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const page = keys.slice(start, start + pageSize);
      const truncated = start + pageSize < keys.length;
      return { objects: page.map((key) => ({ key })), truncated, cursor: truncated ? String(start + pageSize) : undefined };
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
    has: (key) => objects.has(key),
    size: () => objects.size,
  };
}

// The whole point of the list: a table gets an owner_id column and this test
// is the thing that notices nobody added it to the delete path.
test("every table with an owner_id column is in the delete list", () => {
  const schema = readFileSync(new URL("../lib/schema.ts", import.meta.url), "utf8");
  const tableBlocks = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\s*\)`/g)];
  assert.ok(tableBlocks.length > 20, "expected to find the app's tables");
  const ownerTables = tableBlocks
    .filter(([, , body]) => /\bowner_id\b/.test(body))
    .map(([, name]) => name);
  assert.ok(ownerTables.length > 15, "expected most of the schema to be owner-scoped");
  assert.deepEqual(
    [...DELETABLE_TABLES].sort(),
    [...ownerTables].sort(),
    "DELETABLE_TABLES in lib/account-deletion.ts must list exactly the tables schema.ts keys on owner_id",
  );
});

test("model_usage_daily carries no owner_id", () => {
  const schema = readFileSync(new URL("../lib/schema.ts", import.meta.url), "utf8");
  const table = /CREATE TABLE IF NOT EXISTS model_usage_daily \(([\s\S]*?)\n\s*\)`/.exec(schema)[1];
  assert.ok(!/owner_id/.test(table), "the rollup must not be traceable to a person");
});

test("rollUpDaily folds calls by day, surface, model and effort", () => {
  const totals = rollUpDaily([
    { surface: "coach", model: "opus", effort: "high", ok: 1, input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_write_tokens: 10, created_at: "2026-08-01T09:00:00.000Z" },
    { surface: "coach", model: "opus", effort: "high", ok: 0, input_tokens: 20, output_tokens: 0, cache_read_tokens: 5, cache_write_tokens: 0, created_at: "2026-08-01T18:00:00.000Z" },
    { surface: "debrief", model: "opus", effort: "high", ok: 1, input_tokens: 200, output_tokens: 90, cache_read_tokens: 0, cache_write_tokens: 0, created_at: "2026-08-02T09:00:00.000Z" },
  ]);
  assert.equal(totals.length, 2);
  const coachDay = totals.find((total) => total.surface === "coach");
  assert.deepEqual(coachDay, {
    day: "2026-08-01", surface: "coach", model: "opus", effort: "high",
    calls: 2, okCalls: 1, inputTokens: 120, outputTokens: 50, cacheReadTokens: 5, cacheWriteTokens: 10,
  });
});

test("deleting an account removes every row for that owner, leaves other owners alone, and rolls up model_usage", async () => {
  const db = await fresh();
  const now = new Date().toISOString();
  for (const ownerId of ["athlete-a", "athlete-b"]) {
    await db.prepare("INSERT INTO fighter_profiles (owner_id, created_at, updated_at) VALUES (?, ?, ?)").bind(ownerId, now, now).run();
    await db.prepare("INSERT INTO training_entries (id, owner_id, discipline, session_type, raw_entry, input_method, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(`entry-${ownerId}`, ownerId, "BJJ", "Class", "note", "text", now).run();
    await db.prepare(`INSERT INTO model_usage (id, owner_id, surface, model, effort, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, ok, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(`usage-${ownerId}`, ownerId, "coach", "opus", "high", 100, 40, 0, 0, 1, now).run();
    await db.prepare(`INSERT INTO nutrition_entries (id, owner_id, description, foods_json, calories, protein, carbs, fat, input_method, photo_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(`meal-${ownerId}`, ownerId, "chicken and rice", "[]", 600, 40, 60, 15, "photo", `${ownerId}/nutrition/meal-${ownerId}`, now).run();
  }

  const uploads = fakeR2();
  await uploads.put("athlete-a/nutrition/meal-athlete-a");
  await uploads.put("athlete-a/nutrition/extra-photo");
  await uploads.put("athlete-a/nutrition/third-photo");
  await uploads.put("athlete-b/nutrition/meal-athlete-b");

  await deleteAccountData(db, uploads, "athlete-a");

  for (const table of DELETABLE_TABLES) {
    const remaining = await db.prepare(`SELECT owner_id FROM ${table} WHERE owner_id = ?`).bind("athlete-a").all();
    assert.equal(remaining.results.length, 0, `${table} still has rows for a deleted owner`);
  }

  const otherProfile = await db.prepare("SELECT owner_id FROM fighter_profiles WHERE owner_id = ?").bind("athlete-b").first();
  assert.ok(otherProfile, "deleting one athlete must not touch another athlete's row");
  const otherEntry = await db.prepare("SELECT id FROM training_entries WHERE owner_id = ?").bind("athlete-b").first();
  assert.ok(otherEntry, "another athlete's training entry must survive");

  assert.equal(uploads.size(), 1, "only the deleted athlete's objects should be removed");
  assert.ok(uploads.has("athlete-b/nutrition/meal-athlete-b"), "another athlete's photo must survive");

  const rollup = await db.prepare("SELECT * FROM model_usage_daily WHERE surface = 'coach' AND model = 'opus' AND effort = 'high'").first();
  assert.ok(rollup, "the deleted athlete's spend must survive as an aggregate");
  assert.equal(rollup.calls, 1);
  assert.equal(rollup.input_tokens, 100);
  assert.equal("owner_id" in rollup, false, "the rollup row must not carry an owner_id key");
});

test("deleting an account with no R2 binding still deletes the D1 rows", async () => {
  const db = await fresh();
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO fighter_profiles (owner_id, created_at, updated_at) VALUES (?, ?, ?)").bind("solo", now, now).run();
  await deleteAccountData(db, undefined, "solo");
  const row = await db.prepare("SELECT owner_id FROM fighter_profiles WHERE owner_id = ?").bind("solo").first();
  assert.equal(row, null);
});

test("R2 deletion follows the cursor rather than stopping at the first page", async () => {
  const uploads = fakeR2(2);
  await uploads.put("athlete-c/nutrition/1");
  await uploads.put("athlete-c/nutrition/2");
  await uploads.put("athlete-c/nutrition/3");
  await uploads.put("athlete-c/nutrition/4");
  await uploads.put("athlete-c/nutrition/5");
  const db = await fresh();
  await deleteAccountData(db, uploads, "athlete-c");
  assert.equal(uploads.size(), 0, "every page of objects must be deleted, not just the first");
});
