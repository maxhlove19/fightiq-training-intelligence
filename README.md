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

Read `/api/health` straight after a deploy. It answers the only question that
matters at that moment — is this deployment actually configured — with booleans
and no secrets:

```bash
curl -s https://<your-host>/api/health
{"status":"ok","checks":{"database":true,"schema":true,"sessionAnalysis":true,
 "photoUploads":true,"liveVideoSearch":false},"notes":["No YOUTUBE_API_KEY. ..."]}
```

`status` is one of:

- **`ok`** (HTTP 200) — everything an athlete touches works.
- **`degraded`** (HTTP 200) — sessions save, but the debrief and Coach will show
  a retry instead of an answer. Almost always a missing or exhausted model key.
- **`down`** (HTTP 503) — no database, or the schema could not be applied.
  Nothing can be saved or read. Point a monitor at this.

### What each setting does, and what happens without it

| Setting | Required | Without it |
| --- | --- | --- |
| D1 binding `DB` | Yes | The app is down. Every screen fails. |
| `OPENAI_API_KEY` | For analysis | Notes still save and are never lost; the debrief and Coach show "your note is safe" and a retry. |
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

### Before you point real athletes at it

- `npm test` — build, then the unit and boot suites.
- `curl /api/health` on the deployed host and confirm `status` is `ok`.
- Open the app as a user who has never logged anything. You should land on
  onboarding, not an error.
- Log one session end to end and confirm the debrief returns.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
