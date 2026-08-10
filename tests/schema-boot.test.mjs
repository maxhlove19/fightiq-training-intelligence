// A fresh install is a database with nothing in it. Every read path in this app
// joins across the whole schema, so "does it boot" is really "does every query
// in the codebase parse against a database that has only ever been created".
//
// SQLite resolves table and column names at prepare time, so preparing every
// statement the app ships is enough to catch a missing table, a renamed column,
// or a query written against a schema that only exists on someone's laptop.

import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { APP_SCHEMA } from "../lib/schema.ts";

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (!/node_modules|\.next|dist|\.wrangler|examples/.test(path)) out.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

// Every SQL string the app hands to the database, minus the ones assembled at
// runtime — those cannot be parsed statically and are not what this guards.
function preparedStatements() {
  const found = [];
  for (const file of [...sourceFiles("lib"), ...sourceFiles("app/api")]) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\.prepare\(\s*(`[\s\S]*?`|"[^"]*"|'[^']*')\s*[,)]/g)) {
      const sql = match[1].slice(1, -1);
      if (sql.includes("${")) continue;
      if (!/\b(SELECT|INSERT|UPDATE|DELETE|CREATE)\b/i.test(sql)) continue;
      found.push({ file, sql });
    }
  }
  return found;
}

function freshDatabase() {
  const db = new DatabaseSync(":memory:");
  for (const statement of APP_SCHEMA) db.exec(statement);
  return db;
}

test("the schema applies cleanly to an empty database", () => {
  assert.ok(APP_SCHEMA.length > 20, "expected the full schema, not a fragment");
  assert.doesNotThrow(() => freshDatabase());
});

test("the schema is idempotent, because every request applies it", () => {
  const db = freshDatabase();
  assert.doesNotThrow(() => { for (const statement of APP_SCHEMA) db.exec(statement); });
});

test("every query the app ships parses against a fresh database", () => {
  const db = freshDatabase();
  const statements = preparedStatements();
  assert.ok(statements.length > 30, `expected to find the app's queries, found ${statements.length}`);
  const broken = [];
  for (const { file, sql } of statements) {
    try { db.prepare(sql); } catch (error) { broken.push(`${file}: ${error.message}\n    ${sql.replace(/\s+/g, " ").slice(0, 120)}`); }
  }
  assert.deepEqual(broken, [], `queries that cannot run on a fresh database:\n  ${broken.join("\n  ")}`);
});

test("the tables the first screen reads exist before anything is written", () => {
  const db = freshDatabase();
  // The exact failure this guards: /api/product is the first call the app makes,
  // and it joins the session log and the debriefs written from it.
  for (const table of ["training_entries", "training_debriefs", "training_followups", "fighter_profiles", "coach_chats", "nutrition_entries", "workout_setups"]) {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    assert.ok(row, `${table} is missing from a fresh database`);
  }
});

test("a brand new athlete reads empty, not broken", () => {
  const db = freshDatabase();
  const rows = db.prepare("SELECT id FROM training_entries WHERE owner_id = ? ORDER BY created_at DESC LIMIT 10").all("nobody");
  assert.deepEqual(rows, []);
});
