# DEPLOY.md

Written from the code rather than from assumption, because the deploy pipeline
has failed five consecutive times and the next decision depends on knowing what
this application actually is.

Everything below states how it was determined so it can be checked.

---

## The headline: this is not a Next.js app on standard hosting

It is a **Cloudflare Worker**, built by `vinext`, and the coupling is deep rather
than incidental.

`import { env } from "cloudflare:workers"` appears in at least five files
including `lib/product-db.ts`, `lib/current-athlete.ts`, `lib/auth-routes.ts`,
`lib/debrief-server.ts` and `app/api/training-entries/route.ts`. That import does
not exist outside the Workers runtime, so those modules cannot execute on Node.

`worker/index.ts` is the entry point and declares its bindings directly:
`ASSETS`, `DB` (a `D1Database`), `UPLOADS` (an `R2Bucket`) and `IMAGES`
(Cloudflare's image transform binding, used by `/_vinext/image`).

**So "does it run on standard Next.js hosting today" has a clear answer: no.**
Not because of configuration, but because the database, the object store, the
image pipeline and the environment accessor are all platform primitives. Moving
to Vercel or a Node host is a port, not a redeploy.

Determined by: `grep -rn "cloudflare:workers"`, reading `worker/index.ts`, and
`package.json` where every script is `vinext dev | build | start`.

## Supabase is the auth provider, not the database

This corrects a premise worth correcting before anyone plans around it.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_JWT_SECRET` are read in
`getProductRuntime` and used to verify sign-in tokens. `grep -rn "supabase"`
against `lib/product-db.ts` and `lib/debrief-db.ts` returns **nothing**: no
query, no table, no connection.

**Every table this app owns lives in Cloudflare D1**, and there are no Supabase
migrations to apply anywhere.

### How the schema actually reaches production

There is no migration step and none can be missed.

`applySchema` in `lib/debrief-db.ts` issues `CREATE TABLE IF NOT EXISTS` for
every table, then adds columns, then indexes. `ensureProductSchema` calls it in
**44 API routes**, so it runs on essentially every request.

The `drizzle/` directory contains five SQL files and none of them mention
`model_usage`, `focus_periods` or `athlete_weigh_ins`. It is vestigial for
anything added recently and is not the mechanism.

**Consequence: a successful deploy creates every missing table on the first
request, with no manual step.** That is why restoring shipping is the entire fix
for the missing cost instrumentation rather than the first half of it.

---

## Environment: what is genuinely required

Read from `getProductRuntime` in `lib/product-db.ts`, `worker/index.ts`, and the
failure paths in `lib/health.ts`.

### Bindings, not variables. Without these the app is not the app.

| Binding | Required | What breaks without it |
| --- | --- | --- |
| `DB` (D1) | **Yes** | Every route returns `STORAGE_UNAVAILABLE`. Nothing works. |
| `ASSETS` | **Yes** | No static assets are served. |
| `IMAGES` | Only for `/_vinext/image` | Image optimisation endpoint fails; images still load unoptimised. |
| `UPLOADS` (R2) | No | `photoUploads` reports false; food photos cannot be stored. Everything else works. |

### Variables

| Variable | Required | Effect if absent |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | For the product to be the product | Coach and the debrief return `AI_NOT_CONFIGURED`. The app loads, logs sessions and shows history. It cannot think. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET` | For email sign-in | Email accounts cannot sign in. Header-based identity still works. |
| `YOUTUBE_API_KEY` | No | `liveVideoSearch` false, curated studies only. This is its current live state. |
| `FIGHTIQ_OWNER_EMAILS` | No | `/admin` returns 404 to everyone, including the owner. This is its current live state. |
| `FIGHTIQ_ALLOW_MOCK_AI` | No | Development only. |

So the genuinely required set for a working product is **`DB`, `ASSETS`,
`ANTHROPIC_API_KEY`**, plus the three Supabase values if email sign-in matters.
Everything else degrades a feature rather than the app.

## Build and start

```
npm run build    # vinext build
npm start        # vinext start
npm test         # typecheck, then build, then the suite
```

`npm test` running a real production build is why a broken build cannot pass
review here.

---

## The narrow question: another way to trigger a build on this host

**From the repository, no such trigger exists, and I could not find one.**

- There is no `.github/` directory at all, so no Actions workflow, no CI, and no
  webhook this repository controls.
- `.openai/hosting.json` contains three keys: `project_id`, `d1` and `r2`. It
  declares bindings. It does not describe a build, a command, or a trigger.
- There is no `wrangler.toml`, `wrangler.json` or `wrangler.jsonc`.

**Stating the limit honestly:** whether the platform offers a build trigger
outside the failing tooling is a question about that platform's console and API,
not about this repository, and I cannot answer it from the code. What I can say
is that nothing in this repository can invoke, bypass or repair it, which
matches the failure appearing before any fetch or build happens.

---

## Verifying that a deploy actually landed

The live site serves a deployment identifier at
`/.well-known/sites-deployment-id`. **Use it rather than comparing bundle
filenames or asset hashes.** One request, one string, and it either changed or it
did not.

At the time of writing it returns:

```
appgdep_6a7b45efb61081918c43b23ea8b7c0d9
```

**That identifier corresponds to a build that predates PR #12**, established
independently: `/api/admin/cost` returns 404 against it, and that route ships in
#12. So this value is a known-stale reference point. If a deploy is attempted and
this string is unchanged afterwards, the deploy did nothing, regardless of what
the pipeline reported.

This matters because a deploy has already silently reported success and changed
nothing once. Asset-hash comparison caught it, but it takes several requests and
a stylesheet can legitimately keep its hash when only JavaScript changed, which
produced a real moment of ambiguity. The deployment id has neither problem.

## What a move actually requires

Listed as work rather than as an argument, so the cost is visible.

**1. A `wrangler.jsonc` that does not exist yet.** The bindings currently live in
the platform's own file. Moving to Cloudflare directly means declaring `DB`,
`ASSETS`, `UPLOADS` and `IMAGES` in Wrangler's format, plus the compatibility
date and the assets directory. This is the smallest item and it is real work
that has never been done.

**2. The D1 database does not travel.** This is the item that matters most and
is easiest to overlook. A new deployment gets a new, empty D1 instance. The
schema will build itself on first request, and **every logged session, focus
period, weigh-in and coach conversation stays behind** unless the existing
database is exported and imported first. On a product with one real athlete that
is recoverable. It stops being recoverable the moment it is not.

**3. Auth redirect URLs.** Supabase sign-in is configured against the current
origin. A new hostname needs the redirect allow-list updated in Supabase, which
is a console change rather than a code change. **Not touched here.**

**4. R2 contents.** Any stored food photos are in the existing bucket and do not
follow the code either.

**5. A first deploy will look broken for one request.** The schema is created
lazily, so the very first request to a fresh database does the table creation
inline. That is by design and self-healing, but somebody watching will see it.

### What would not break

Worth stating, because it is the reassuring half. The runtime is the same, so
`cloudflare:workers`, D1 and R2 all behave identically on Cloudflare's own
platform. The port is only painful if the destination is **not** Cloudflare.

---

## Three questions answered from the code

### Does the Images binding need paid Images storage?

**No. Transformations only, which the Free plan covers.**

`IMAGES` is read in exactly one place, `worker/index.ts:40`, and the call is
`env.IMAGES.input(body).transform(...).output(...)`. That is the transformation
API: a stream in, a transformed stream out. Nothing is stored.

`grep -rn "IMAGES" lib app` returns nothing, so no application code touches it
at all. It serves `/_vinext/image`, which optimises images already being served
from the Worker's own assets.

Cloudflare Free allows 5,000 unique transformations a month. Storing images
inside Images is the paid feature and this codebase does not use it.

**Photo uploads are unrelated to this.** `/api/health` reports `photoUploads`
from `Boolean(runtime.uploads)` at `app/api/health/route.ts:29`, which is the
**R2** binding, not Images. So the Images plan cannot break photo uploads, and a
pilot without R2 loses only meal photos.

### Which secrets does the running Worker actually require?

One. Everything else degrades a feature.

| Secret | Required | Read at | Without it |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | For the product to think | `lib/product-db.ts:106`, `lib/debrief-server.ts:14`; failures raised at `lib/debrief-ai.ts:131`, `lib/product-ai.ts:154` and `:357` | Sessions still save and history still shows. The debrief and Coach return `AI_NOT_CONFIGURED`. |
| `SUPABASE_URL` | Only for email sign-in | `lib/current-athlete.ts:15`, `lib/auth-routes.ts:8` | Email sign-in unavailable. Header identity still works. |
| `SUPABASE_ANON_KEY` | Only for email sign-in | `lib/auth-routes.ts:8` | As above. Set all three or none. |
| `SUPABASE_JWT_SECRET` | Only for email sign-in | `lib/current-athlete.ts:16` | As above. |
| `YOUTUBE_API_KEY` | No | `lib/product-db.ts:105` | Curated studies only. This is its current live state. |
| `FIGHTIQ_OWNER_EMAILS` | No | `lib/product-db.ts:107` | `/admin` returns 404 to everyone. This is its current live state. |
| `FIGHTIQ_ALLOW_MOCK_AI` | No | `lib/product-db.ts:107`, `lib/debrief-server.ts:14` | Development only. |

**`OPENAI_API_KEY` is read nowhere.** `grep -rn "OPENAI_API_KEY"` across every
`.ts`, `.tsx`, `.mjs` and `.json` in the repository returns no matches outside
vendored dependencies. It does not need to be carried across, and it should not
be set on the new account.

### Does the build produce a Worker bundle wrangler can deploy?

**Yes. Run, not inferred.**

`npm run build` was executed on a clean `dist/`. It exited 0 and printed
`Build complete.` The Worker entry is at **`dist/server/index.js`**, 211,307
bytes. Static assets are at `dist/client/`.

Those two paths are what `wrangler.jsonc` points `main` and `assets.directory`
at.

One caveat worth stating: the build also emits `dist/.openai/hosting.json`, a
copy of the old platform's config. It is inert on Cloudflare and can be ignored.

The framework ships its own deploy command, `npx @vinext/cloudflare deploy`,
which knows this layout. `CLOUDFLARE-SETUP.md` uses it rather than raw
`wrangler deploy`.

### The binding cross-check, which found a real gap

`.openai/hosting.json` declares two bindings: `"d1": "DB"` and `"r2": "UPLOADS"`.

The Worker requires **four**. `ASSETS` is read at `worker/index.ts:38` and
`IMAGES` at `worker/index.ts:40`, and neither appears in that file. The old
platform supplied them implicitly.

**A wrangler config written by copying `hosting.json` would deploy successfully
and then serve no static assets.** This is exactly why the bindings were
enumerated from the source and cross-checked rather than either being trusted.

## The cost of the move

**Every row currently stored is lost. Stated plainly because it is a real
decision rather than a footnote.**

The D1 database lives inside the old platform's account. It does not travel, and
nothing in `CLOUDFLARE-SETUP.md` moves it. A new deployment gets an empty
database, the schema rebuilds itself on the first request, and every training
entry, debrief, focus period, weigh-in and Coach conversation stays behind. Any
meal photos in the old R2 bucket stay behind too.

**The decision is that this is acceptable, and the reason is the traffic.** Site
analytics for the thirty days to 11 August show 5 unique visitors and 826 page
views, all inside three days, with three of those five being the people building
it. The data being abandoned is one person's eleven logged sessions and the
records derived from them.

**If that reasoning is wrong, it is wrong in a visible way**, which is why it is
written here as a decision: if anyone other than those five has logged real
training, the cost is no longer close to free and the database has to be
exported before the move rather than after. The check is one query against the
old database for distinct `owner_id` values in `training_entries`.

## Is moving the wrong call?

**Moving to a non-Cloudflare host would be the wrong call**, and expensively so:
it means replacing D1, R2, the image binding and the environment accessor, which
touches the data layer of every feature. That is a rewrite wearing the costume of
a migration.

**Moving to Cloudflare directly is a different proposition** and is mostly
authoring a Wrangler config and moving a database. The runtime does not change.

The argument for moving is not that the current host lacks features. It offers a
custom domain, so that objection does not hold. The argument is narrower and
harder to dismiss: **the pipeline has failed five consecutive times with an error
inside the platform's own sandbox, before fetching or building, and nothing in
this repository can cause, avoid or repair it.** A deploy path that cannot be
fixed from the code and cannot be escalated is not a deploy path.

**What I would do before deciding:** the cheapest possible test of whether this
is transient. If the same error appears again after a wait, the pipeline is not
recovering on its own and the Wrangler route becomes the shortest path back to
shipping, with the database export as its one genuinely delicate step.
