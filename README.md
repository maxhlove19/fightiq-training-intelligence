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
 off   Session analysis (OPENAI_API_KEY)
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
| `OPENAI_API_KEY` | For analysis | Notes still save and are never lost; the debrief says the reading half is not switched on. Set this and past sessions become readable. |
| R2 binding `UPLOADS` | For meal photos | Everything else works; photos cannot be stored. |
| `YOUTUBE_API_KEY` | No | Learn serves the curated studies from `lib/video-recommendations.ts`. This is a supported way to run. |
| `FIGHTIQ_ALLOW_MOCK_AI` | Local only | Leave unset in production. It lets the app answer without a model key. |

The bindings themselves are declared in `.openai/hosting.json`.

### The schema takes care of itself

Every table and index lives in `lib/schema.ts`, and every request applies the
whole list idempotently. A brand-new database needs no migration step before
first use — the first request creates what it needs.

Adding a table means adding it to `lib/schema.ts` and nowhere else.
`tests/schema-boot.test.mjs` prepares every SQL statement in the codebase
against a fresh in-memory database, so a query written against a table that
does not exist fails in CI rather than on someone's first screen.

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

- `npm test` — build, then the unit and boot suites.
- `npm run preflight -- https://<your-host>` and confirm it exits 0.
- Set `OPENAI_API_KEY` before launch. Without it the app is honest and loses
  nothing, but it does not do the thing it is for.
- Open the app as a user who has never logged anything. You should land on
  onboarding, not an error.
- Log one session end to end and confirm the debrief returns.
- Log a session containing "got rocked, still foggy" and confirm the hold opens,
  the home screen leads with it, and a sparring plan is refused.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
