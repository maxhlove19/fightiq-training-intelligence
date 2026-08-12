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

**[SKIPPABLE]** Skip both if the only people using it arrive through a link with
identity headers. Set both or neither, because one of the two does not work.

```
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY
```

These come from the existing Supabase project, under Project Settings, API. They
are not new values and nothing about Supabase changes in this move.

**You should see:** `Success! Uploaded secret …` twice.

### Do not set SUPABASE_JWT_SECRET

**This step used to ask for a third secret, and that instruction was wrong.**

Supabase now signs access tokens with a key pair rather than a shared secret,
and publishes the public half at
`<SUPABASE_URL>/auth/v1/.well-known/jwks.json`. The app reads that document, so
`SUPABASE_URL` is all it needs to verify a session. The old secret verifies
nothing on a migrated project.

Setting it does no harm, so if it is already set you can leave it. It is only
read as a fallback for a project that has not migrated.

**Why this is called out rather than quietly dropped:** requiring it was not a
cosmetic mistake. It switched email sign-in off entirely, in a way that looked
like anything but an auth problem. Signing up worked, the account was created,
and the next request sent the person back to the landing page as though they had
never signed up. If you see that symptom, this is where to look.

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

## 7. Connect the repository so deploys happen on their own

This step used to be two commands typed on a Mac. That is exactly how this
project ended up serving a build from before the sign-in fix for a full day
while `main` had the fix in it the whole time: a hand-run deploy uploads
whatever happens to be sitting in one person's folder, and nothing anywhere
tells you it is stale. The dashboard cannot tell you either. It shows when the
upload happened, never which commit was in it.

Cloudflare can build straight from GitHub instead. Once this is connected, every
merge into `main` redeploys on its own and no laptop is in the path at all.

1. In the dashboard, open **Workers and Pages**, click **fightiq**, then
   **Settings**, then **Build**.
2. **Connect a Git repository**, choose **GitHub**, authorize it, and pick
   `maxhlove19/fightiq-training-intelligence`.
3. Branch: **main**.
4. **Build command:**
   `npm run build && node scripts/prepare-deploy-config.mjs`
5. **Deploy command:**
   `npx wrangler deploy --config dist/server/wrangler.json`
6. Add one **build variable**, not a Worker secret, because these are two
   different lists in two different places and only this one is read while the
   build runs:
   `D1_DATABASE_ID` = the **Database ID** shown under **Storage and Databases**,
   **D1**, **fightiq**.
7. **Save**, then trigger the first build.

**Why the deploy command names a file.** The build merges `wrangler.jsonc` with
what the Cloudflare plugin contributes and writes the result to
`dist/server/wrangler.json`. That merged file is the one holding the real
bindings, so it is the one to deploy. Plain `npx wrangler deploy` reads
`wrangler.jsonc`, which still has `REPLACE_ME_D1_DATABASE_ID` in it.

**Why there is a second command in the build step.**
`scripts/prepare-deploy-config.mjs` puts the database id into that merged file,
because the id names one specific database and is not kept in the repository. It
also refuses to continue if the config would upload the wrong bindings, which is
worth more than it sounds: a deploy carrying a duplicated `DB` binding used to
be rejected by Cloudflare, and the version of that failure where it is *not*
rejected is an app that looks perfect and saves every session into a database
belonging to nobody.

**You should see:** a build log ending with the upload size and a `.workers.dev`
URL. Open it.

---

## 8. Check it actually worked

Do not judge this by the page looking right. A working old build looks exactly
like a working new one.

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
