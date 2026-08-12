# HANDOFF

Written automatically at 2026-08-12T06:49:32.830Z (run by hand).

Read this before doing anything else. It is generated from git state and
structured signals, never from conversation text, so it can be thin but it
cannot be wrong about what it does say.

## Where the work is

- Branch: `claude/deploy-pipeline`
- HEAD: `c353208` "Make a deploy of main possible, and make it not need a laptop"
- Tracking `origin/claude/deploy-pipeline`, pushed

## Uncommitted work, 1 file(s)

This is the part that disappears if the container is reclaimed.

- `M .claude/HANDOFF.md`

## What this branch is probably against

Inferred from the branch name, so treat it as a hint rather than a fact:

> 1. **Never merge.** Never push to `main`. Never deploy.

## What was verified

- Last test run seen in this session: **444/444 passing, 0 failing.**

## What was NOT verified

State this honestly rather than leaving it blank.

- **A passing test suite is not evidence a screen looks right.** Unless a
  browser measurement appears in the PR body for this branch, assume no
  visual check was done.
- Nothing here confirms anything is deployed. Merged is not live: see the
  known defect in goals.md about the live build being behind main.

## Pull requests seen in this session

The most recent, in the order they appeared, numbers returned by the API rather than inferred: #34, #27, #31, #35.

Re-read the list before relying on their state. A number appearing here means it existed, not that it is still open.

## Files touched in this session

- `app/api/auth/signin/route.ts`
- `lib/auth-routes.ts`
- `app/api/auth/signup/route.ts`
- `lib/identity.ts`
- `lib/current-athlete.ts`
- `lib/jwks.ts`
- `lib/supabase-auth.ts`
- `worker/index.ts`
- `app/components/SignInPanel.tsx`
- `node_modules/vinext/dist/server/app-route-handler-response.js`
- `lib/jwt.ts`
- `public/sw.js`
- `app/api/auth/password/route.ts`
- `tests/auth-session-cookies.test.mjs`
- `tests/auth-rotated-keys.test.mjs`
- `build/wrangler-log-path.ts`
- `vite.config.ts`
- `wrangler.jsonc`
- `scripts/prepare-deploy-config.mjs`
- `tests/worker-bindings.test.mjs`
- `CLOUDFLARE-SETUP.md`

## The next action

Commit or discard the uncommitted work above before starting anything new.

---

This file is **tracked** in git. If it is untracked it does not reach a
cloud session or a phone, because those clone the repository and nothing else.
It is written by a hook and committed by a human, deliberately: see the PR that
introduced it.
