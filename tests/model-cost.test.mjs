// Nothing recorded what a model call cost, which is bigger than a missing
// metric: it means nobody could say whether this product is profitable at any
// price, and the most expensive configuration available was being spent on every
// interaction rather than on the ones that deserve it.
//
// The privacy rule is tested here rather than trusted, because it is the kind of
// rule that erodes one convenient field at a time.

import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { applySchema } from "../lib/debrief-db.ts";
import { costOf, getCostReport, readUsage, recordModelUsage, RATES } from "../lib/model-cost.ts";

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

const usage = (over = {}) => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, ...over });

test("the cost table records counts and nothing else", () => {
  // The hard rule. What an athlete tells a coach about their own body and their
  // own failures is the most private thing in this product, and a cost question
  // that needs it is the wrong question.
  const schema = readFileSync(new URL("../lib/schema.ts", import.meta.url), "utf8");
  const table = /CREATE TABLE IF NOT EXISTS model_usage \(([^`]*)\)`/.exec(schema)[1];
  // Column names only. Checking the raw block would trip on TEXT, the SQL type,
  // which is exactly the kind of false alarm that gets a privacy test deleted.
  const columns = table
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(",")
    .map((line) => line.trim().split(/\s+/)[0])
    .filter(Boolean);
  for (const forbidden of ["prompt", "response", "content", "question", "answer", "note", "raw_entry", "body", "message", "transcript"]) {
    assert.ok(!columns.some((name) => name.toLowerCase().includes(forbidden)), `model_usage must never carry a ${forbidden} column`);
  }
  assert.deepEqual(columns, [
    "id", "owner_id", "surface", "model", "effort",
    "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "ok", "created_at",
  ], "the whole table, so adding a column is a deliberate decision rather than a drift");
});

test("token counts are read out of whatever the SDK returns, without trusting it", () => {
  assert.deepEqual(readUsage({ input_tokens: 1200, output_tokens: 340, cache_read_input_tokens: 900, cache_creation_input_tokens: 50 }),
    { inputTokens: 1200, outputTokens: 340, cacheReadTokens: 900, cacheWriteTokens: 50 });
  // Missing, null and nonsense all become zero rather than NaN in a cost table.
  assert.deepEqual(readUsage(undefined), usage());
  assert.deepEqual(readUsage({ input_tokens: null, output_tokens: "many" }), usage());
  assert.deepEqual(readUsage({ input_tokens: -5 }), usage());
});

test("cost is arithmetic on the published rates, with cache priced separately", () => {
  assert.equal(costOf(usage({ inputTokens: 1_000_000 })), 15);
  assert.equal(costOf(usage({ outputTokens: 1_000_000 })), 75);
  assert.equal(costOf(usage({ cacheReadTokens: 1_000_000 })), 1.5);
  assert.equal(costOf(usage({ cacheWriteTokens: 1_000_000 })), 18.75);
  // Output is the expensive half, which is why a chatty surface costs more than
  // a long prompt does.
  assert.ok(RATES.output > RATES.input * 4);
});

test("cost per active owner is the number a price has to clear", async () => {
  const db = await fresh();
  const now = new Date().toISOString();
  await recordModelUsage(db, "max", { ...usage({ inputTokens: 20_000, outputTokens: 2_000 }), surface: "coach", model: "claude-opus-5", effort: "high", ok: true }, now);
  await recordModelUsage(db, "max", { ...usage({ inputTokens: 30_000, outputTokens: 3_000 }), surface: "debrief", model: "claude-opus-5", effort: "high", ok: true }, now);
  await recordModelUsage(db, "sam", { ...usage({ inputTokens: 10_000, outputTokens: 1_000 }), surface: "coach", model: "claude-opus-5", effort: "high", ok: true }, now);

  const report = await getCostReport(db, "1970-01-01T00:00:00.000Z");
  assert.equal(report.activeOwners, 2);
  assert.equal(report.calls, 3);
  const expected = costOf(usage({ inputTokens: 60_000, outputTokens: 6_000 }));
  assert.ok(Math.abs(report.costUsd - expected) < 0.0001);
  assert.ok(Math.abs(report.costPerActiveOwnerUsd - expected / 2) < 0.0001);
});

test("cost is broken down by surface, so a tiering decision has evidence", async () => {
  const db = await fresh();
  const now = new Date().toISOString();
  await recordModelUsage(db, "max", { ...usage({ outputTokens: 5_000 }), surface: "debrief", model: "m", effort: "high", ok: true }, now);
  await recordModelUsage(db, "max", { ...usage({ outputTokens: 500 }), surface: "meal-estimate", model: "m", effort: "low", ok: true }, now);
  const report = await getCostReport(db, "1970-01-01T00:00:00.000Z");
  // Most expensive first, because that is the surface worth arguing about.
  assert.equal(report.bySurface[0].surface, "debrief");
  assert.equal(report.bySurface[1].surface, "meal-estimate");
  assert.ok(report.bySurface[0].costUsd > report.bySurface[1].costUsd);
});

test("a failed call is still counted, because a refusal costs the same", async () => {
  const db = await fresh();
  await recordModelUsage(db, "max", { ...usage({ inputTokens: 9_000, outputTokens: 100 }), surface: "coach", model: "m", effort: "high", ok: false });
  const report = await getCostReport(db, "1970-01-01T00:00:00.000Z");
  assert.equal(report.calls, 1);
  assert.ok(report.costUsd > 0);
});

test("only the window asked for is counted", async () => {
  const db = await fresh();
  await recordModelUsage(db, "max", { ...usage({ outputTokens: 1000 }), surface: "coach", model: "m", effort: "high", ok: true }, "2026-01-01T00:00:00.000Z");
  await recordModelUsage(db, "max", { ...usage({ outputTokens: 1000 }), surface: "coach", model: "m", effort: "high", ok: true }, "2026-08-01T00:00:00.000Z");
  const report = await getCostReport(db, "2026-07-01T00:00:00.000Z");
  assert.equal(report.calls, 1);
});

test("an empty window reports zero rather than dividing by nobody", async () => {
  const report = await getCostReport(await fresh(), "2026-07-01T00:00:00.000Z");
  assert.equal(report.activeOwners, 0);
  assert.equal(report.costPerActiveOwnerUsd, 0);
});

test("a cost row is never worth failing a request over", async () => {
  // A database that rejects everything must not break a debrief.
  const broken = { prepare: () => ({ bind: () => ({ run: async () => { throw new Error("no such table"); } }) }) };
  await recordModelUsage(broken, "max", { ...usage(), surface: "coach", model: "m", effort: "high", ok: true });
});

test("every surface that spends money reports which one it is", () => {
  // If a fifth call site is added and forgets to name itself, cost per surface
  // becomes cost per unknown and the tiering question cannot be answered.
  const productAi = readFileSync(new URL("../lib/product-ai.ts", import.meta.url), "utf8");
  const debriefAi = readFileSync(new URL("../lib/debrief-ai.ts", import.meta.url), "utf8");
  const surfaces = [...`${productAi}${debriefAi}`.matchAll(/surface: "([\w-]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(surfaces)].sort(), ["coach", "debrief", "meal-estimate", "workout-plan"]);
  // As many askClaude call sites as there are named surfaces.
  assert.equal((productAi.match(/await askClaude\(\{/g) ?? []).length, 3);
});
