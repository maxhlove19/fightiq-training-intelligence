# Moving FightIQ to Vercel and Supabase

Written for a developer deciding whether to do it, not to argue for it.

FightIQ runs today on Cloudflare Workers with D1 (SQLite) and R2, deployed
through the OpenAI Sites hosting platform. Everything works, it is tested, and
there is no technical emergency forcing a move.

There is one product reason that is worth taking seriously, and it has nothing
to do with the database.

> **Update: the auth half of this is now done.** Email sign up is live and works
> without moving the database. Supabase Auth is used as an identity provider
> while every row stays in D1. The rest of this document is still accurate about
> what a full move would cost, and the recommendation at the bottom has changed
> accordingly.

## The reason this document existed

**Every user had to have a ChatGPT account.**

Sign-in comes from identity headers injected by the hosting platform. That is
genuinely secure and it took no code, but it means a fighter who wants to try
this app must first have, and be willing to use, a ChatGPT account. For a paid
consumer app aimed at people who train three nights a week, that is a real
adoption barrier and it is invisible until you watch someone bounce off it.

Supabase Auth gives email and password, magic links, Google, and Apple. That is
the difference between "sign in with ChatGPT" and "sign up". If FightIQ is going
to be sold to strangers rather than shown to friends, that matters more than any
database question.

Everything below is about how expensive the rest of the move is, so the decision
can be made on the auth question rather than on fear of the migration.

## The database: three differences, and they are already handled

`lib/sql-dialect.ts` translates this app's SQL to Postgres.
`tests/postgres-parity.test.mjs` builds the entire schema and executes **every
one of the 100 SQL statements this app ships** against a real Postgres 18
(PGlite, the same engine compiled to wasm). It passes.

The complete list of incompatibilities found:

| Difference | Count | Fix |
| --- | --- | --- |
| `?` placeholders | 96 statements | Numbered to `$1`, `$2` by a scanner that skips string literals and comments |
| `INSERT OR IGNORE` | 4 statements | Rewritten to `ON CONFLICT DO NOTHING` |
| Two argument `MAX(a, b)` | 1 statement | Rewritten to `GREATEST(a, b)`; the aggregate `MAX(col)` is left alone |

That is all of it. The types (`TEXT`, `INTEGER`, `REAL`), the upserts
(`ON CONFLICT ... DO UPDATE SET x = excluded.x`), the unique indexes and the
subquery `LIMIT` are standard in both engines. That is not luck: it comes of
storing every timestamp as an ISO string and every id as `TEXT`, rather than
reaching for a dialect's conveniences.

The tests also prove behaviour, not just parsing: a session writes and reads
back, the duplicate guard still rejects a repeated client key, and the account
upsert increments a visit rather than inserting a second row.

## What the move actually costs

Roughly in order of effort.

**1. Auth. Already done, and it did not need the move.** `lib/identity.ts` is the
only place a request becomes a person, and it already accepts a Supabase session
alongside the platform headers. Email accounts are prefixed `sb:` so they never
collide with a ChatGPT user id, and both doors stay open, which means nobody who
already has training logged loses it.

**2. The database handle.** Every call goes through one shape:
`db.prepare(sql).bind(...).run() | .first() | .all()` and `db.batch([...])`.
Write that interface over a Postgres driver, run every statement through
`toPostgres`, and nothing else in the app changes. `meta.changes` becomes the
driver's row count, and `.first()` becomes `rows[0] ?? null`.

**3. Storage.** R2 is used in exactly one feature, meal photos:
`app/api/nutrition/photos/[id]/route.ts` and the upload path. Supabase Storage
is a small adapter. Keep the ownership check exactly as it is; it is what stops
one athlete reading another's photos.

**4. Runtime and build.** `cloudflare:workers` supplies `env`. On Vercel that is
`process.env`, which is simpler. `vinext` becomes plain `next build`. The health
endpoint, the preflight script and the schema bootstrap need no changes beyond
the handle in point 2.

**5. Batches.** `db.batch()` is all or nothing on D1. Postgres gives you real
transactions, so this gets stronger rather than weaker. Keep the ordering in
`applySchema`: tables, then columns, then indexes. It matters on both engines.

## What you would lose

Be honest about this before starting.

- The hosting platform currently handles auth, TLS, the OAuth callback and the
  identity headers for free. You would own all of it.
- D1 and R2 are configured by two lines in `.openai/hosting.json`. You would
  own connection pooling, which on serverless Postgres means Supabase's pooler
  and a connection limit to think about.
- Everything currently deployed and working would need re-verifying. The suite
  here is 194 tests, so that is a day of confidence rather than a month, but it
  is not zero.

## What to do first, if you do it

1. Stand up Supabase and run the schema through `toPostgres`. It already works;
   the test proves it.
2. Write the database handle. Run the existing test suite against it.
3. Auth needs nothing. It already speaks Supabase.

## Recommendation

Nothing here needs moving right now.

The one real limit was auth, and it has been solved without a migration:
Supabase Auth issues the session, this app verifies it, and the data stays in
D1. That is the cheapest version of your friend's suggestion and it keeps a
tested deployment intact.

Move the database later, if a reason turns up that is about the database:
wanting SQL access to production, wanting Postgres features like full text
search over training notes, or wanting one provider to bill. When that day
comes, the work is the four points above and the parity test already proves the
first one.
