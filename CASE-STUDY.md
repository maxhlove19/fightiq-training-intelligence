# Building FightIQ with an AI coding agent

This is a working record of how this repository was built, written for someone
deciding whether to pay for the same approach. It includes the mistakes,
because a case study that hides them is not evidence of anything.

Every number below is verifiable from this repository. Each one says how.

---

## What exists

| Fact | Number | How to check it |
| --- | --- | --- |
| Tests, all passing | 366 | `npm test` |
| Test files | 35 | `ls tests/*.test.mjs \| wc -l` |
| Merged pull requests | 11 | `git log --oneline --merges \| wc -l` |
| Commits | 89 | `git log --oneline \| wc -l` |
| Application source, TypeScript | 9,974 lines | `find app lib -name "*.ts" -o -name "*.tsx" \| xargs wc -l` |
| Database tables | 24 | `grep -c "CREATE TABLE IF NOT EXISTS" lib/schema.ts` |
| Gates that must pass before a session can end | 7 | `node -e 'import("./.claude/hooks/gates.mjs").then(m => console.log(m.GATES.map(g => g.name)))'` |

`npm test` is not only unit tests. It runs typecheck, then a production build,
then the suite. A green result means the thing compiles, builds and behaves.

The seven gates are typecheck, lint, build, tests, house-style, tokens, layout.
The last three are custom and are described below.

---

## What was actually hard

Not the features. Four things, in the order they cost the most time.

### 1. Tests passing is not evidence that a screen works

Two of the worst defects in this codebase passed every test in it.

The chat composer was `position: sticky` inside a container with
`flex: 1` and no overflow. Flex-basis zero meant the container sized itself to
one viewport while holding the whole conversation, so the composer anchored to
the bottom of a box a fraction of the height of its own contents and floated in
the middle of the screen. Every test passed. It was obvious the moment anything
measured a bounding box.

Fixing that introduced the second one. Making the composer `static` removed the
positioned ancestor that its mic and send buttons were absolutely positioned
against, so both buttons resolved against the page and rendered roughly 200px
outside the phone frame. Invisible on a phone, where the frame fills the screen.
That is how it survived review.

The response was not "be more careful". It was `scripts/layout-sweep.mjs`, which
renders the app's screens against its own compiled stylesheet in headless
Chromium, measures every bounding box inside the frame, and fails if anything
escapes. Run it with `node scripts/layout-sweep.mjs`. It also counts distinct
saturated colours per screen, so "this looks cheap" becomes a number instead of
an opinion.

`tests/coach-layout.test.mjs` now asserts the *relationship* between the
composer and its absolutely positioned children, rather than just the absence of
the property that broke last time.

### 2. An instruction in a prompt is not a guarantee

The house style forbids em dashes. Both system prompts said so, in those words,
before any of this work started. The model used them anyway, and they reached a
coaching answer that a human read.

The lesson generalises past punctuation: **anything that must be true of what
reaches a user has to be made true on the way out, not requested on the way in.**

`lib/house-style.ts` now runs at `requestJson`, the single point every model call
returns through, so all four model surfaces are covered and a fifth added later
inherits the rule rather than having to remember it. It walks the parsed response
structurally rather than naming fields, because naming fields is how you fix the
debrief and miss the coaching answer underneath it.

It also runs again at display time. Generation-time alone would have left every
answer written before the fix sitting untouched in an existing conversation.

### 3. Data that is overwritten cannot be recovered later

Three fields in this app were stored as current values when a user would
reasonably expect a record.

**Current focus** was one column, overwritten whenever the evidence moved. The
moment it changed, there was no record it had existed, when it started, or what
was logged while it was live. That makes the only question worth paying for after
month one unanswerable, because the answer is the sequence.

**Bodyweight** lived inside a JSON blob that onboarding upserts wholesale, so
updating it destroyed the previous value. In combat sports the weight curve is
half of what an athlete manages.

**Model cost** was not recorded at all.

All three are now append-only tables: `focus_periods`, `athlete_weigh_ins`,
`model_usage`. Check with
`grep -c "CREATE TABLE IF NOT EXISTS \(focus_periods\|athlete_weigh_ins\|model_usage\)" lib/schema.ts`
which returns 3.

This is the one class of defect that argues for its own priority. A layout bug
fixed next week is a layout bug the user sees fixed. A month of changes nobody
wrote down is gone. That reasoning moved these ahead of design work twice.

### 4. Instrument before pricing

This app runs Claude Opus 5 at high effort with thinking enabled for its two
most-used surfaces, and at low effort for two mechanical ones. Verify with
`grep -n 'effort: "high"\|effort: "low"' lib/debrief-ai.ts lib/product-ai.ts`.

Nothing recorded what a call cost. That is not a missing metric. It means nobody
could say whether the product is profitable at any price, and the most expensive
configuration available was being spent on every interaction with no way to
notice.

`model_usage` now records tokens in and out, cache reads and writes, per owner
and per surface, on failures as well as successes, because a refusal costs what
an answer costs. All four surfaces are named: `grep -o 'surface: "[a-z-]*"'
lib/product-ai.ts lib/debrief-ai.ts | sort -u` returns coach, debrief,
meal-estimate, workout-plan.

**The tiering decision was deliberately not made.** The obvious move is to run
the cheap surfaces on a cheaper configuration, and the honest position is that
nobody knows yet whether the answers get worse. `goals.md` carries the
instruction to run the same prompt at both configurations and compare, rather
than to tier on instinct.

The privacy rule is enforced rather than stated: the cost table records counts
and identifiers only. `tests/model-cost.test.mjs` asserts the **exact column
list**, so adding a field is a decision somebody has to make on purpose.

---

## The mistakes

### The deploy that silently did nothing

A deploy reported no error and changed nothing. The live site was still serving
the previous build. It was caught only by fetching the served HTML and comparing
asset filename hashes against the expected build, because the old build is a
working application and the page looked fine.

Every deploy since has been verified by asset hash rather than by appearance.

Separately, a later deploy failed four times with `ENOENT mkdir /root/.npm`,
because the hosting platform's build sandbox had `HOME` pointing at a directory
that did not exist. **The fix was to correct the sandbox, not the repository.**
No code was changed to work around it. That distinction matters: an agent that
is allowed to edit a repository until a broken environment stops complaining will
produce a repository shaped around a bug nobody remembers.

### A privacy test that cried wolf

The first version of the cost table's privacy test scanned the raw SQL for words
like `content` and `text`, and failed immediately, because `TEXT` is the SQL
column type. A test that fails for the wrong reason is a test somebody deletes.
It checks column names now.

### A hook that hung instead of failing

`.claude/hooks/observe.mjs` ran its main function on import. A test importing it
for its helper functions blocked forever reading stdin. In a live session that
would have looked like the agent freezing rather than like a bug.

The same file also shelled out to `npx tsc`, which on a machine without
TypeScript installed attempts to download it. It uses the local binary only if it
is already present. **A hook that hangs is worse than a hook that does nothing.**

Both were found by the tests that exist specifically for the hooks:
`grep -c '^test(' tests/hooks.test.mjs` returns 15.

### A plugin evaluated and rejected

The obvious choice for an autonomous loop was Anthropic's own `ralph-wiggum`
plugin. Its issue tracker showed five open issues in exactly the areas an
unattended loop depends on, including one where the loop command's prompt text is
parsed as shell code, and three where an unrecognised frontmatter key lets the
model invoke the loop command itself. A separate open issue asks for bounded
iterations and a push guard.

The loop was implemented natively instead, with the bounded iteration and the
push guard the plugin was missing. **Using something because it is official is
not evaluation.**

### Defects still visible in the shipped app

One of them, stated because it is still true. Two more that were here are fixed:
the day counts on My Game now come from one definition, distinct calendar days
trained, rather than mixing that with calendar-elapsed time in the same
sentence; and the discipline counts on that screen render `×` everywhere rather
than `×` in one place and `x` in two others.

**The stylesheet has four competing `:root` blocks.** Twelve custom properties are
declared more than once and the last declaration wins, so `--blue` resolves to a
cyan. `--nav-height` is declared three times as three different values while ten
rules read it, which is load-bearing geometry rather than colour. Run
`node scripts/token-check.mjs` to see the full list.

That last one ships as a **ratchet rather than a gate**: the current count is the
baseline and the check fails only if it grows. A gate that blocks every session
on a known scheduled defect is a gate somebody switches off.

---

## The autonomous part

A nightly scheduled session runs against this repository with nobody watching.
Everything it needs is committed, because cloud sessions do not read a developer's
local configuration.

- `goals.md` is the definition of done, and the only instruction the unattended
  run has. It carries the invariants, the copy rules, the known defects with
  evidence, an ordered backlog and an explicit not-now list.
- `.claude/settings.json` wires three hooks. `ls .claude/hooks/*.mjs | wc -l`
  returns 4.
- A **Stop** hook runs all seven gates and refuses to let a session end on a
  broken tree, returning the actual failure output so the next turn starts
  knowing what is wrong.
- A **PostToolUse** hook runs fast checks on the file that just changed and
  appends a structured line per tool call, so an unattended run leaves a record.
- A **SessionStart** hook puts `goals.md` in front of every session.

The hard part of the Stop hook is knowing when to give up. Consecutive
continuations are capped, so a hook that blocks on every failure spends the whole
allowance re-running the same failing test and then stops anyway. It fingerprints
the failure, and when the same gate fails twice with identical output it stops
blocking, writes a report and lets the turn end honestly.

The fingerprint strips timestamps and log paths. Without that, npm's timestamped
log line made every failure look new and the protection would never have fired
once. That was found by a test, not in production.

The loop is forbidden from merging, pushing to the default branch, deploying, or
touching environment variables. A human merges and verifies by asset hash.

---

## What a client would be buying

**Small verified increments.** Eleven merged pull requests, each one deployed and
checked on the live site before the next was started. Every one states what was
verified and how.

**Measurement instead of assertion.** When a screen is the deliverable, it gets
measured in a browser. When "it looks cheap" is the complaint, it becomes a count
of distinct colours. When a claim about the codebase turns out to be wrong, it
gets corrected in public: an early claim here that components were hardcoding
colours was wrong, and measuring found the real defect was four competing token
blocks, which is a different and more serious problem.

**Instrumentation before pricing.** No opinion was offered on what this product
should cost, because nothing recorded what it spends. The measurement was built
first and the recommendation deliberately withheld.

**Refusal to work around the environment.** When a platform sandbox broke the
build, the repository was left alone.

**Tests for the things that usually go untested.** The gates have their own
tests. The privacy rule has a test. The house style has a test, because the
version that lived only in a prompt did not hold.

---

*This document is generated from a repository that anybody can clone and verify.
If a number here is wrong, the command next to it will say so.*
