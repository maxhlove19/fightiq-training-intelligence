// Can this app run on Supabase?
//
// Not "probably", and not "after some work". This builds the entire schema in a
// real Postgres and executes every SQL statement the app ships against it, so
// the answer is a number rather than an opinion.
//
// PGlite is Postgres 18 compiled to wasm. Same parser, same planner, same
// error messages.

import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { APP_COLUMNS, APP_INDEXES, APP_TABLES } from "../lib/schema.ts";
import { addColumnStatement, numberPlaceholders, rewriteInsertOrIgnore, rewriteScalarMinMax, toPostgres } from "../lib/sql-dialect.ts";

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (!/node_modules|\.next|dist|\.wrangler/.test(path)) out.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

/** Every SQL string the app hands to the database, minus the ones built at runtime. */
function appQueries() {
  const found = [];
  for (const file of [...sourceFiles("lib"), ...sourceFiles("app/api")]) {
    for (const match of readFileSync(file, "utf8").matchAll(/\.prepare\(\s*(`[\s\S]*?`|"[^"]*"|'[^']*')/g)) {
      const sql = match[1].slice(1, -1);
      if (sql.includes("${")) continue;
      if (!/\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql)) continue;
      found.push({ file, sql });
    }
  }
  return found;
}

async function freshPostgres() {
  const db = await PGlite.create();
  for (const statement of APP_TABLES) await db.exec(toPostgres(statement));
  for (const { table, column, definition } of APP_COLUMNS) {
    await db.exec(addColumnStatement(table, column, definition, "postgres"));
  }
  for (const statement of APP_INDEXES) await db.exec(toPostgres(statement));
  return db;
}

test("placeholders are numbered, and only the real ones", async () => {
  assert.equal(numberPlaceholders("SELECT * FROM t WHERE a = ? AND b = ?"), "SELECT * FROM t WHERE a = $1 AND b = $2");
  // A question mark inside somebody's own words is not a parameter.
  assert.equal(numberPlaceholders("INSERT INTO t (note) VALUES ('what now?')"), "INSERT INTO t (note) VALUES ('what now?')");
  assert.equal(numberPlaceholders("SELECT ? , 'is this ok?' , ?"), "SELECT $1 , 'is this ok?' , $2");
  assert.equal(numberPlaceholders("SELECT 'it''s fine?' , ?"), "SELECT 'it''s fine?' , $1");
  assert.equal(numberPlaceholders("SELECT ? -- and ? in a comment\n, ?"), "SELECT $1 -- and ? in a comment\n, $2");
});

test("INSERT OR IGNORE becomes the Postgres spelling", () => {
  assert.equal(
    rewriteInsertOrIgnore("INSERT OR IGNORE INTO t (a) VALUES (?)"),
    "INSERT INTO t (a) VALUES (?) ON CONFLICT DO NOTHING",
  );
  // A statement that already says what to do on conflict is left alone.
  const explicit = "INSERT INTO t (a) VALUES (?) ON CONFLICT(a) DO UPDATE SET a = excluded.a";
  assert.equal(rewriteInsertOrIgnore(explicit), explicit);
});

test("two argument MAX becomes GREATEST, and the aggregate is left alone", () => {
  // SQLite's MAX(a, b) picks the larger of two values. Postgres calls that GREATEST
  // and reserves MAX for the aggregate, which is a genuinely different function.
  assert.equal(rewriteScalarMinMax("SET c = MAX(t.c, excluded.c)"), "SET c = GREATEST(t.c, excluded.c)");
  assert.equal(rewriteScalarMinMax("SELECT MIN(a, b)"), "SELECT LEAST(a, b)");
  assert.equal(rewriteScalarMinMax("SELECT MAX(created_at) FROM t"), "SELECT MAX(created_at) FROM t");
  assert.equal(rewriteScalarMinMax("SELECT MAX(confidence) AS best FROM t GROUP BY owner_id"), "SELECT MAX(confidence) AS best FROM t GROUP BY owner_id");
});

test("the whole schema builds on a real Postgres", async () => {
  const db = await freshPostgres();
  const tables = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
  assert.equal(tables.rows.length, APP_TABLES.length, "every table should exist");
  for (const { table, column } of APP_COLUMNS) {
    const found = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2", [table, column]);
    assert.equal(found.rows.length, 1, `${table}.${column} is missing`);
  }
});

test("applying the schema twice changes nothing, because every request applies it", async () => {
  const db = await freshPostgres();
  for (const statement of APP_TABLES) await db.exec(toPostgres(statement));
  for (const { table, column, definition } of APP_COLUMNS) await db.exec(addColumnStatement(table, column, definition, "postgres"));
  for (const statement of APP_INDEXES) await db.exec(toPostgres(statement));
});

test("every query this app ships parses on Postgres", async () => {
  const db = await freshPostgres();
  const queries = appQueries();
  assert.ok(queries.length > 90, `expected the app's queries, found ${queries.length}`);
  const broken = [];
  for (const { file, sql } of queries) {
    const translated = toPostgres(sql);
    try {
      // PREPARE parses and plans without running, which is the check that matters.
      await db.exec(`PREPARE parity_check AS ${translated}`);
      await db.exec("DEALLOCATE parity_check");
    } catch (error) {
      broken.push(`${file}: ${error.message}\n      ${translated.replace(/\s+/g, " ").slice(0, 150)}`);
    }
  }
  assert.deepEqual(broken, [], `queries that will not run on Postgres:\n  ${broken.join("\n  ")}`);
});

test("a session can actually be written and read back on Postgres", async () => {
  const db = await freshPostgres();
  const now = new Date().toISOString();
  await db.query(toPostgres(
    "INSERT INTO training_entries (id, owner_id, discipline, session_type, raw_entry, input_method, created_at, client_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),
    ["e1", "max", "Muay Thai", "Class", "Switch kicks, support foot late.", "voice_or_text", now, "k1"]);

  const read = await db.query(toPostgres(
    "SELECT id, raw_entry FROM training_entries WHERE owner_id = ? ORDER BY created_at DESC LIMIT 10"), ["max"]);
  assert.equal(read.rows.length, 1);
  assert.equal(read.rows[0].raw_entry, "Switch kicks, support foot late.");

  // The duplicate guard has to hold on Postgres too, or gym wifi costs an
  // athlete a second copy of every session.
  await assert.rejects(() => db.query(toPostgres(
    "INSERT INTO training_entries (id, owner_id, discipline, session_type, raw_entry, input_method, created_at, client_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),
    ["e2", "max", "Muay Thai", "Class", "Same note again.", "voice_or_text", now, "k1"]));
});

test("the upserts the app relies on behave the same way", async () => {
  const db = await freshPostgres();
  const now = new Date().toISOString();
  const upsert = toPostgres(`INSERT INTO athlete_accounts (owner_id, email, display_name, first_seen_at, last_seen_at, visits)
     VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(owner_id) DO UPDATE SET last_seen_at = excluded.last_seen_at, visits = athlete_accounts.visits + 1`);
  await db.query(upsert, ["max", "max@e.test", "Max", now, now]);
  await db.query(upsert, ["max", "max@e.test", "Max", now, now]);
  const row = await db.query("SELECT visits FROM athlete_accounts WHERE owner_id = $1", ["max"]);
  assert.equal(Number(row.rows[0].visits), 2, "a second visit should increment rather than insert");

  // And INSERT OR IGNORE, once translated, must not throw on a repeat.
  const ignore = toPostgres("INSERT OR IGNORE INTO fighter_profiles (owner_id, created_at, updated_at) VALUES (?, ?, ?)");
  await db.query(ignore, ["max", now, now]);
  await db.query(ignore, ["max", now, now]);
  const profiles = await db.query("SELECT COUNT(*) AS n FROM fighter_profiles");
  assert.equal(Number(profiles.rows[0].n), 1);
});
