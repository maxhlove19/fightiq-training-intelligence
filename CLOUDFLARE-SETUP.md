# Putting FightIQ on Cloudflare

A checklist for one person, in order. You do not need to write code.

**Every step says what you should see when it worked.** If you do not see that,
stop at that step rather than continuing, because the later steps will fail in
ways that are harder to read.

Steps marked **[PAID]** cannot be done on a free account. Steps marked
**[SKIPPABLE]** can be left out and the app still runs, with one feature off.

---

## Before you start

You need: a Cloudflare account, and a terminal on the machine that has this
repository.

You do **not** need a card for the core of this. You need one for R2, which is
optional. See step 6.

---

## 1. Create the Cloudflare account

Go to `dash.cloudflare.com/sign-up`, sign up, and confirm the email.

**You should see:** a dashboard with a left-hand menu containing "Compute
(Workers)" and "Storage & Databases".

Free is enough to start. Workers Free allows 100,000 requests a day and 10ms of
CPU per request. Nothing in this app is close to either.

---

## 2. Log the terminal into that account

In the repository folder, run:

```
npx wrangler login
```

A browser window opens asking you to authorise Wrangler.

**You should see:** the terminal print `Successfully logged in.` To double check,
run `npx wrangler whoami` and it prints the account email and an Account ID.

---

## 3. Create the database

```
npx wrangler d1 create fightiq
```

**You should see:** a block of configuration printed back, containing a line like
`database_id = "0f2c…"`. **Copy that id.**

**Then:** open `wrangler.jsonc` in this repository and replace
`REPLACE_ME_D1_DATABASE_ID` with the id you copied. Keep the quotes.

**You should see:** in the dashboard, under Storage & Databases, D1 SQL Database,
a database named `fightiq` with 0 tables. Zero is correct at this point. The app
creates its own tables the first time it is used.

D1 Free allows 5 million rows read and 100,000 rows written per day, and 5GB
stored. One athlete logging sessions is nowhere near this.

---

## 4. Set the one secret the app genuinely needs

```
npx wrangler secret put ANTHROPIC_API_KEY
```

It prompts for the value. Paste the key and press enter. Nothing is echoed to
the screen, which is normal.

**You should see:** `Success! Uploaded secret ANTHROPIC_API_KEY`.

Without this the app still runs, still saves sessions and still shows history.
The debrief and Coach say the reading half is not switched on. With it, they
work.

---

## 5. Set the sign-in secrets, if email sign-in is wanted

**[SKIPPABLE]** Skip all three if the only people using it arrive through a link
with identity headers. Set all three or none, because two out of three does not
work.

```
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put SUPABASE_JWT_SECRET
```

These come from the existing Supabase project, under Project Settings, API. They
are not new values and nothing about Supabase changes in this move.

**You should see:** `Success! Uploaded secret …` three times.

---

## 6. Create the file store for meal photos

**[SKIPPABLE]** and the only step that asks for a card.

R2 has a genuinely free allowance of 10GB-month, 1 million class A operations
and 10 million class B operations. **But adding R2 to an account requires
completing a checkout flow, which means putting a card on file even though the
free allowance costs nothing.**

If that is acceptable:

```
npx wrangler r2 bucket create fightiq-uploads
```

**You should see:** `Created bucket fightiq-uploads`.

If it is not acceptable right now: open `wrangler.jsonc` and delete the whole
`"r2_buckets"` block, from the line starting `"r2_buckets"` to its closing `],`.

**What you lose by skipping:** meal photos cannot be stored. `/api/health` will
report `photoUploads: false`. Sessions, the debrief, Coach, the weight record
and everything else are unaffected.

---

## 7. Deploy

This step used to be two commands and it did not work. Running it on a real Mac
produced five failures in sequence. Four of the five were defects in this
repository and are now fixed in it; this section is written so that a fresh
clone does not meet them again, and so that you can recognise them if you do.

### 7a. Check the setup before touching the account

```
npx @vinext/cloudflare deploy --dry-run
```

This validates and then stops. It does not build, does not upload and does not
need you to be logged in, so it costs nothing to run first.

**You should see:** `Project: fightiq`, `Router: App Router`, and
`Dry run complete. No build or deploy performed.`

**You should also see a notice** saying `next/image is served unoptimized` and
suggesting `--image-optimization=cloudflare-images`. **That notice is expected
and is not a problem.** It is inferred from the Vite config alone, and this app
does its own image optimisation in `worker/index.ts:36`, which handles
`/_vinext/image` through the IMAGES binding. Following the suggestion would add
a second mechanism on top of a working one. Leave it.

**If instead it says `Missing @cloudflare/vite-plugin in your Vite config`:**
you are on a clone from before this was fixed. `git pull` and try again. The
plugin was in fact present the whole time, but it was imported dynamically
inside the config factory, where a tool reading the file as text cannot see it.
It is now imported at the top level of `vite.config.ts`, and the import ordering
that the dynamic import existed to protect lives in `build/wrangler-log-path.ts`.

### 7b. Deploy

```
npx @vinext/cloudflare deploy
```

One command, not two. **It runs its own build first**, so a separate
`npm run build` beforehand is wasted time. More to the point, and this is the
part that costs people an afternoon, **anything you edit inside `dist/` between
the two is regenerated and thrown away.** `dist/server/wrangler.json` in particular cannot
be fixed by hand. Fix `wrangler.jsonc` or `vite.config.ts` instead.

**You should see:** the upload report a size in KiB, then a URL ending in
`.workers.dev`.

> **Not yet verified.** As this is written, a run has uploaded successfully and
> no run has completed. Nothing below step 8 has been observed working on
> Cloudflare. Treat step 8 as the test that tells you, not as a formality.

### If `vinext init` gets suggested to you

You should not need it: the plugin, the dependency and the versions it would set
up are all committed. But the deploy tool suggests it in its own error text, so
if you do run `npx vinext init --platform=cloudflare`, it asks five questions
before it does anything. Here are the answers this project wants and what each
one costs, because being stopped by an unexpected prompt is how people abandon a
checklist.

| Prompt | Answer | Why, and what it costs |
| --- | --- | --- |
| CDN cache | **1, Workers Cache** | The default and the only one needing no extra binding. |
| Data cache | **2, None** | Not the default. The default is Cloudflare KV, which adds a third binding whose namespace id must be created and pasted in before any deploy will work. Nothing in this app asks for a data cache. Costs nothing. |
| Image optimization | **1, Cloudflare Images** | Transformations are free on the Free plan; only *storing* inside Images is paid, and this app stores nothing there. |
| Pre-render all static routes | **n** | Every screen is per-athlete, so there is nothing static to pre-render, and it adds a build step that fails without a database. |
| Experimental Workers Cache pre-warm | **n** | Experimental steps in the deploy path make every later failure ambiguous. |

**Warning: `vinext init` rewrites `vite.config.ts`.** That file carries three
things it does not know about: the `sites()` plugin, the import-ordering rule at
the top, and the condition that stops `.openai/hosting.json` from injecting
duplicate bindings. If you let it rewrite the file, check `git diff` before
building, and expect to put those back.

It also writes an import of `@vinext/cloudflare` into the config **without
adding the package to `package.json`**, so the next build dies with
`ERR_MODULE_NOT_FOUND` on an import the tool itself just wrote. That is why this
repository pins `@vinext/cloudflare` as a dev dependency rather than relying on
init.

### If `npm install` fails with ERESOLVE

`@vinext/cloudflare@1.0.0-beta.5` requires peer `vinext ^1.0.0-beta.5`. This
project used to pin `vinext@1.0.0-beta.2`, which is three pre-releases behind and
does not satisfy it.

**Do not use `--legacy-peer-deps`.** It does not fix anything; it silences the
check and leaves the Cloudflare plugin running against a framework it was not
built for, which moves the failure somewhere much harder to read. Both packages
are now pinned to `1.0.0-beta.5` together, and they should be bumped together.

### If the deploy says a binding is assigned twice

The message is `DB assigned to multiple D1 Database bindings`, or the same for
`UPLOADS` and R2, or it asks you to enable R2 for a bucket named
`site-creator-r2` that you never created.

That was this repository's fault and it is fixed. `vite.config.ts` read
`.openai/hosting.json`, whose `"d1": "DB"` and `"r2": "UPLOADS"` keys made the
build synthesise placeholder bindings under the same names as the real ones in
`wrangler.jsonc`. It now skips that whenever a `wrangler.jsonc` is present.

**Worth understanding rather than skipping**, because it is the most dangerous
thing found in this whole exercise: the placeholder sorted *first* in both
lists, and its database id was all zeros. Cloudflare refusing the deploy is the
good outcome. Had it merged first-wins instead, the deploy would have succeeded,
the app would have looked completely fine, and every session logged would have
gone to a database that is not anybody's. `tests/worker-bindings.test.mjs` now
fails if a duplicate binding or a `site-creator-` placeholder ever reaches the
build again.

---

## 8. Check it actually worked

Do not judge this by the page looking right. A working old build looks exactly
like a working new one.

**Nothing in this step has been observed on Cloudflare yet.** It describes what
the app returns and what each field means, all of which is read from the code in
`lib/health.ts`. Whether a Cloudflare deploy actually reaches it is the open
question, and this step is where you find out.

Open `<your-url>/api/health`.

**You should see:** JSON containing `"status":"ok"` and a `checks` block. In it:

- `"database": true` and `"schema": true` are the two that matter. If either is
  false, the database is not connected and nothing will save. Go back to step 3.
- `"sessionAnalysis": true` means the Anthropic key is set. False means step 4
  did not take.
- `"photoUploads"` is `true` if you did step 6 and `false` if you skipped it.
  Both are correct outcomes.
- `"liveVideoSearch": false` is expected and fine. It means the optional YouTube
  key is not set, and Learn serves curated studies.

Then open `<your-url>/api/admin/cost?days=30`.

**You should see:** either JSON with a `costUsd` field, or a 404. A 404 here
means you are logged in as somebody who is not an owner, which is expected
unless `FIGHTIQ_OWNER_EMAILS` has been set. **A 404 does not mean the deploy
failed.** It is only a problem if `/api/health` also fails.

---

## 9. Optional extras, any time later

**[SKIPPABLE]** Each of these adds one feature and none are needed to run.

```
npx wrangler secret put YOUTUBE_API_KEY      # turns on live video search
npx wrangler secret put FIGHTIQ_OWNER_EMAILS # unlocks /admin for those emails
```

`FIGHTIQ_OWNER_EMAILS` is a comma-separated list of email addresses.

---

## What this does not do

**Nothing from the current site comes with you.** The database on the old
platform stays there. Any sessions, weigh-ins or conversations logged on the old
site are not in the new one, and there is no step in this checklist that moves
them. That is a deliberate decision, and the reasoning is written down in
`DEPLOY.md` under "The cost of the move".

---

## If a step fails

Run `npx wrangler whoami` first. Most failures at any step are the terminal
being logged out or logged into the wrong account.

The deployment identifier at `<your-url>/.well-known/sites-deployment-id` is the
fastest way to confirm whether a later redeploy actually replaced the running
build. One request, one string, and it either changed or it did not.
