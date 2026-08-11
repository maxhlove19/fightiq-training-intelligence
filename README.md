# vinext-starter

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Email and name are intended for display or contact purposes.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Going Live

Run the preflight against the deployed host. It reads `/api/health`, names every
setting in plain words, and exits non-zero when the app cannot store a session:

```bash
npm run preflight -- https://<your-host>

FightIQ preflight · https://<your-host>
Status: DEGRADED (HTTP 200)

  ok   Session storage (D1 binding: DB)
  ok   Schema applied and readable
 off   Session analysis (ANTHROPIC_API_KEY)
  ok   Meal photos (R2 binding: UPLOADS)
 off   Live video search (YOUTUBE_API_KEY)
```

`/api/health` is the same information as JSON, with booleans and no secrets, for
a monitor to poll:

```bash
curl -s https://<your-host>/api/health
{"status":"ok","checks":{"database":true,"schema":true,"sessionAnalysis":true,
 "photoUploads":true,"liveVideoSearch":false},"notes":["No YOUTUBE_API_KEY. ..."]}
```

`status` is one of:

- **`ok`** (HTTP 200) — everything an athlete touches works.
- **`degraded`** (HTTP 200) — sessions save and are kept in full, but nothing
  reads them back. Almost always a missing or exhausted model key. Athletes are
  told the reading half is not switched on, rather than being offered a retry
  that cannot work. Adding the key makes every past session readable.
- **`down`** (HTTP 503) — no database, or the schema could not be applied.
  Nothing can be saved or read. Point a monitor at this.

### What each setting does, and what happens without it

| Setting | Required | Without it |
| --- | --- | --- |
| D1 binding `DB` | Yes | The app is down. Every screen fails. |
| `ANTHROPIC_API_KEY` | For analysis | Notes still save and are never lost; the debrief says the reading half is not switched on. Set this and past sessions become readable. Get one at console.anthropic.com. |
| R2 binding `UPLOADS` | For meal photos | Everything else works; photos cannot be stored. |
| `YOUTUBE_API_KEY` | No | Learn serves the curated studies from `lib/video-recommendations.ts`. This is a supported way to run. |
| `FIGHTIQ_ALLOW_MOCK_AI` | Local only | Leave unset in production. It lets the app answer without a model key. |
| `FIGHTIQ_OWNER_EMAILS` | For `/admin` | Nobody can open the owner view. The app itself is unaffected. |
| `SUPABASE_URL` + `SUPABASE_ANON_KEY` | For email sign up | Email sign up is off and says so. ChatGPT sign in still works. Both are needed, or neither applies. |
| `SUPABASE_JWT_SECRET` | No | Nothing on a current Supabase project. It is a fallback for a project still signing tokens with the old shared HS256 secret. |

The bindings themselves are declared in `.openai/hosting.json`.

### The model that reads the notes

Every word this app writes back to an athlete comes from Claude Opus 5, through
one file: `lib/claude.ts`. The model, the timeouts, the retry, the caching and
the refusal handling are decided there once, so four call sites cannot drift
apart.

Three things about that file are deliberate and worth knowing before changing
them.

**Effort is the dial, not the model.** The debrief and Coach run at `high`,
because those are the two surfaces anybody is paying for. The meal estimate and
the strength ranking run at `low`, because recognising a plate and sorting a
fixed list are not reasoning problems, and a fast answer is what makes someone
log food twice. If a route feels slow, lower its effort. Never disable thinking
to speed it up: that is the more expensive lever and it brings failure modes
that lower effort does not.

**Thinking counts against `max_tokens`.** The ceiling covers the reasoning and
the answer together, which is why the numbers look large for a two sentence
reply. Cut them and the JSON comes back truncated rather than short.

**The shape is enforced, not requested.** Each call declares a JSON schema and
the API constrains the answer to it. A model that decides to write a paragraph
instead cannot reach an athlete.

The coaching method is sent as a cached block, so the part that never changes is
not paid for on every session. The part that does change, the reading of how
much the athlete actually wrote, is sent after it and deliberately not cached.

A refused, truncated or unreadable answer never becomes an error screen. The
debrief falls back to the offline reading in `resilientDebrief`, because the
note is already saved and losing it to a model failure would be the worst thing
this app could do.

### Day one

An athlete answers six screens of setup and then lands on the home screen with
nothing logged. That moment decides whether they come back, and for a while the
app's first act was to ask them for more: "Build your baseline. Log today's
training and FightIQ will give you one clear thing to work on next."

`lib/first-session.ts` is what it says instead. The fault that is usually there
at their level in their sport, why it costs them, and the one question tonight
answers. It is curated rather than generated, which means it is instant, free,
and the same every time, and every entry says out loud that this is the usual
one at their level rather than a read on their game. FightIQ has seen nothing
yet, and pretending otherwise gets caught on day two.

Three rules hold this together, and breaking any of them is how it gets thin
again.

**One instruction, everywhere.** The home card, the current focus on My Game,
the rail on the way into the gym, the brief that opens when it is tapped, and
the question carried onto the log screen are all built from one place. They used
to be built from four, and they disagreed: the rail said pivot while the sheet
behind it said distance.

**What the athlete typed wins.** If they named a priority during setup, the
opening is about that. Answering a different question is the clearest possible
sign nobody read it.

**None of it survives real training.** The brief records itself as built from
"no training yet" rather than from a focus, so the first logged session retires
it on the spot instead of eighteen hours later. `tests/first-session-db.test.mjs`
runs that handoff against a real database.

The empty cards on My Game work the same way. The evidence rules behind them are
real, so they state the rule rather than the absence: nothing is a strength
until it holds up three sessions running, nothing is recurring until it has
happened twice. Above them, what the next few sessions unlock, with a date
worked out from how often the athlete said they train.

### The schema takes care of itself

Every table, column and index lives in `lib/schema.ts`, and every request
applies the whole thing idempotently. A brand-new database needs no migration
step; neither does an existing one.

**Order matters, and it is not negotiable.** `applySchema` runs tables, then
`APP_COLUMNS`, then indexes. An index over a column that `APP_COLUMNS` adds
cannot be created until that column exists — and on a database that predates
the column, it does not. Doing both in one batch worked perfectly on a fresh
database and returned 500 on *every request* against one with data in it,
because a D1 batch is all-or-nothing.

- Adding a **table** or **index**: add it to `APP_TABLES` / `APP_INDEXES`.
- Adding a **column** to a table that already exists anywhere: add it to the
  `CREATE TABLE` *and* to `APP_COLUMNS`. SQLite has no `ADD COLUMN IF NOT
  EXISTS`, so each is attempted alone and the duplicate-column failure is the
  success case on every run after the first.

`tests/schema-boot.test.mjs` does both halves: it prepares every SQL statement
in the codebase against a fresh database, *and* it builds the database an older
version of this app would have had and upgrades it using the app's own
`applySchema` rather than a restatement of it.

### Accounts and the owner view

There are two doors, and both produce the same athlete.

**Email sign up** is the front door. `/api/auth/signup`, `/signin`, `/signout`
and `/reset` talk to Supabase Auth over its REST API and set the session in
HttpOnly cookies, so no token is ever readable by a script on the page. Nothing
here rolls its own authentication: password hashing, reset tokens, email
confirmation and rate limiting are Supabase's job, and they are exactly the
things that are quietly easy to get wrong.

Set `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Both, or email sign up stays
switched off and says so rather than half working.

**`SUPABASE_JWT_SECRET` is not one of them any more.** Supabase now signs access
tokens with ES256 and publishes the public half of the key at
`<SUPABASE_URL>/auth/v1/.well-known/jwks.json`, so the app fetches and caches
that document and verifies against it. The URL is all it needs. The old shared
secret is still read, and still works for a project that has not migrated, but
on a migrated project it verifies nothing at all. **The database does not
move.** Supabase Auth is used as an identity provider; every
row still lives in D1.

Two settings on the Supabase side are not optional:

- **Redirect URLs must include `https://<your-host>/reset-password`.** That is
  where a recovery link lands, and Supabase refuses to redirect anywhere that is
  not on the list. Without it the reset email arrives and the link dead ends.
- **The project must sign tokens with the shared JWT secret, HS256.**
  `lib/jwt.ts` accepts exactly one algorithm on purpose, because accepting a
  list is how algorithm confusion attacks work. A project migrated to asymmetric
  signing keys will fail every sign in, silently, with a correct looking
  configuration. Use the legacy anon key and the legacy JWT secret together.

Finishing a reset is `app/reset-password/` plus `/api/auth/password`. Supabase
puts the recovery session in the URL fragment, which never reaches a server, so
the page reads it in the browser, strips it from the address bar, and hands it
to this app's own route. That route sets the password with the athlete's token
rather than the anon key, so a leaked link cannot touch another account, then
verifies the token itself before setting a session cookie.

**ChatGPT sign in** keeps working, because everybody who already has training
logged is keyed to a ChatGPT user id and removing it would look to them like
their history was deleted. Dispatch owns `/signin-with-chatgpt`,
`/signout-with-chatgpt` and `/callback`. Do not add app routes for those paths.

`lib/identity.ts` is the only place a request becomes a person. A verified
session cookie always wins over a platform header, so an athlete signed in with
email can never be silently swapped onto a different account. Email account ids
are prefixed `sb:` so they can never collide with a platform id.

`lib/jwt.ts` verifies the session token. It accepts exactly one algorithm, and
`tests/jwt.test.mjs` covers the ways tokens actually get forged: a tampered
payload, `alg: none`, algorithm confusion, an expired token, a token from
another project, and a token for another audience.

What the app adds is a record of who signed in. `athlete_accounts` is written on
the first screen every athlete loads, which is what turns an opaque user id into
a person with a name, an email and a join date.

`/admin` is the owner view. It is gated on `FIGHTIQ_OWNER_EMAILS`, a comma
separated allowlist of the email addresses allowed to open it. **Unset means
nobody**, so a deployment that forgets to configure it exposes nothing rather
than everything. Anyone else, signed in or not, gets the same 404 from the API
and a page that does not confirm a dashboard exists.

The dashboard shows behaviour, never diary entries: who joined, who came back,
who logged once and stopped, who is on a return to training hold, and who has
not trained in three weeks. **It does not show the text of anybody's training
notes**, and the exclusion is enforced in the query in `lib/accounts-db.ts`
rather than in whatever renders it, so a future screen cannot leak an athlete's
own words by accident.

### What stops one account spending everything

Every debrief and every Coach answer is a paid model call. `lib/usage-limits.ts`
caps how many one account can start — twelve sessions an hour and forty a day,
Coach looser again. The ceilings sit far above real use; a heavy training week
never approaches one, and the tests assert that.

It gates the reading, never the keeping: a session note is always saved, and
only its debrief waits. The counts come from rows the app already writes,
through indexes it already has, so nothing is written just to count it.

### The return-to-training hold

A note that describes a head knock or an injury does more than raise a card.
`app/api/training-entries/route.ts` opens a hold at the moment the note is
saved — before any model runs, so it survives an unreachable API — and that hold
stays in force across sessions and devices until it is walked off.

`lib/return-to-training.ts` owns the rules and is the only thing that can move a
hold: a stepwise ladder, a minimum of 24 hours per step, back a step when
symptoms return, and no contact step at all until the athlete records that a
professional cleared them in person. While a hold is open, `/api/pre-training/start`
refuses to set a mission the hold does not allow, and the debrief withholds a
next-session drill.

Every guard lives in `applyHoldAction`, not in a disabled button, so a replayed
or hand-written request gets the same refusal the UI would give.
`tests/return-to-training.test.mjs` covers it from the outside: given a hold and
a clock, what does the app allow?

FightIQ does not clear anyone, and the copy says so on every screen. Where a
commission has imposed a no-contact suspension, that suspension is longer than
this ladder and it is the one that counts.

### Before you point real athletes at it

- `npm test` — type check, build, then the unit and boot suites. It fails on a
  single type error; the codebase is at zero.
- `npm run preflight -- https://<your-host>` and confirm it exits 0.
- Set `ANTHROPIC_API_KEY` before launch. Without it the app is honest and loses
  nothing, but it does not do the thing it is for.
- Open the app as a user who has never logged anything. You should land on
  onboarding, not an error.
- Log one session end to end and confirm the debrief returns.
- Log a session containing "got rocked, still foggy" and confirm the hold opens,
  the home screen leads with it, and a sparring plan is refused.
- Log an ordinary hard session — "he caught me with a body kick, ribs are sore"
  — and confirm **nothing** is held. A false positive costs an athlete a week.
- Deploy over a database that already has data in it, not only a fresh one.
- Set `FIGHTIQ_OWNER_EMAILS` to the address you sign in with, then open `/admin`
  and confirm you can see it and a second account cannot.
- Sign up with an email address on a device that has never seen ChatGPT, log a
  session, sign out, and sign back in. The session must still be there.

### Running somewhere else

`docs/vercel-supabase.md` is an honest assessment of moving to Vercel and
Supabase, written for a developer deciding rather than to argue for it.

The short version: the database is not the reason to move. `lib/sql-dialect.ts`
translates this app's SQL to Postgres, and `tests/postgres-parity.test.mjs`
builds the whole schema and runs all 100 shipped statements against a real
Postgres 18 in the test suite. Three differences exist in total, and all three
are handled.

The reason that is worth taking seriously is auth: today every user needs a
ChatGPT account to sign in, which is a real barrier for a paid consumer app.

### House style

No em dashes. Not in the app's copy, not in the model's output, not anywhere a
reader can see. They are the clearest single tell that a machine wrote
something, and this product only works if an athlete believes a coach is
talking to them. `tests/copy-voice.test.mjs` fails the build on one, and both AI
prompts carry the same instruction because most of what an athlete reads is
written at runtime rather than shipped in the repo.

## Useful Commands

- `npm run dev`: start local development
- `npm run preflight -- <url>`: check a deployment's configuration, exit non-zero if unusable
- `npm run typecheck`: type check alone
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
