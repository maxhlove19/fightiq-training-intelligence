// Running the same app on SQLite or on Postgres.
//
// FightIQ was written for D1, which is SQLite. Supabase is Postgres. Before
// deciding whether to move, it is worth knowing exactly how far apart they are,
// and the honest answer turned out to be: three things, in one statement each
// except the placeholders.
//
//   1. Placeholders. SQLite takes `?`, Postgres takes `$1`, `$2`.
//   2. `INSERT OR IGNORE`, which Postgres spells `ON CONFLICT DO NOTHING`.
//   3. Two argument `MAX(a, b)`. In SQLite that is a scalar picking the larger
//      of two values; in Postgres `MAX` is an aggregate and the scalar is
//      called `GREATEST`. One statement in this app uses it.
//
// Everything else in this codebase already runs on both. The types (TEXT,
// INTEGER, REAL), the upserts (`ON CONFLICT ... DO UPDATE SET x = excluded.x`),
// the partial indexes and the subquery LIMIT are all standard in each. That is
// not luck. It is what comes of storing timestamps as ISO strings and ids as
// TEXT rather than reaching for a dialect's conveniences.
//
// tests/postgres-parity.test.mjs runs the whole schema and every query this app
// ships against a real Postgres, so this file is proven rather than believed.

export type Dialect = "sqlite" | "postgres";

/**
 * Rewrites `?` placeholders as `$1`, `$2`, and so on.
 *
 * Scans rather than replaces, because a `?` inside a string literal is a
 * question mark in somebody's copy, not a parameter. Double quoted identifiers
 * and both comment styles are skipped for the same reason.
 */
export function numberPlaceholders(sql: string): string {
  let out = "";
  let index = 0;
  let quote: "'" | '"' | null = null;
  let comment: "line" | "block" | null = null;

  for (let position = 0; position < sql.length; position += 1) {
    const character = sql[position];
    const next = sql[position + 1];

    if (comment === "line") { out += character; if (character === "\n") comment = null; continue; }
    if (comment === "block") { out += character; if (character === "*" && next === "/") { out += next; position += 1; comment = null; } continue; }
    if (!quote && character === "-" && next === "-") { comment = "line"; out += character; continue; }
    if (!quote && character === "/" && next === "*") { comment = "block"; out += character; continue; }

    if (quote) {
      out += character;
      // Doubled quotes are an escaped quote, not the end of the literal.
      if (character === quote) { if (next === quote) { out += next; position += 1; } else quote = null; }
      continue;
    }
    if (character === "'" || character === '"') { quote = character; out += character; continue; }
    if (character === "?") { index += 1; out += `$${index}`; continue; }
    out += character;
  }
  return out;
}

/** `INSERT OR IGNORE INTO t ...` becomes `INSERT INTO t ... ON CONFLICT DO NOTHING`. */
export function rewriteInsertOrIgnore(sql: string): string {
  if (!/INSERT\s+OR\s+IGNORE/i.test(sql)) return sql;
  const rewritten = sql.replace(/INSERT\s+OR\s+IGNORE\s+INTO/i, "INSERT INTO");
  if (/ON\s+CONFLICT/i.test(rewritten)) return rewritten;
  return `${rewritten.replace(/;\s*$/, "").trimEnd()} ON CONFLICT DO NOTHING`;
}

/**
 * `MAX(a, b)` in SQLite is `GREATEST(a, b)` in Postgres, where `MAX` is an
 * aggregate. Only the two argument form is rewritten: a one argument `MAX(col)`
 * is the aggregate and means the same thing in both.
 */
export function rewriteScalarMinMax(sql: string): string {
  return sql.replace(/\b(MAX|MIN)\s*\(([^(),]+),([^()]+)\)/gi, (whole, name: string, first: string, second: string) => {
    if (second.includes(",")) return whole;
    return `${name.toUpperCase() === "MAX" ? "GREATEST" : "LEAST"}(${first},${second})`;
  });
}

/** Every difference, applied in one place. */
export function toPostgres(sql: string): string {
  return numberPlaceholders(rewriteInsertOrIgnore(rewriteScalarMinMax(sql)));
}

/** Leaves SQLite alone and translates for Postgres, so callers do not branch. */
export function forDialect(sql: string, dialect: Dialect): string {
  return dialect === "postgres" ? toPostgres(sql) : sql;
}

/**
 * The one DDL difference worth naming: SQLite has no ADD COLUMN IF NOT EXISTS
 * and Postgres does, so on Postgres the column additions stop being a swallowed
 * error and become an ordinary statement.
 */
export function addColumnStatement(table: string, column: string, definition: string, dialect: Dialect): string {
  return dialect === "postgres"
    ? `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition}`
    : `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`;
}
