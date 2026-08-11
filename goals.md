# goals.md

At four in the morning this file is the only instruction an unattended session
has. Read it before choosing what to work on. If the top unblocked item is
already done, or is specified too loosely to build, stop and say so. Do not
invent work.

---

## What FightIQ is for

**Class is random. Your game is not.**

That is the claim. It comes from the largest stated frustration in the sport
rather than from a feature request. In a 254-comment thread on what is wrong
with how BJJ is taught, the top answer at 218 upvotes: the room is full of
different abilities, motivations, aptitudes and ages, everyone is taught the
same technique, often chosen at random, and is expected to improve. Beneath it
an instructor of fifteen years at 32 asks for a full-path framework, a physical
book, here are the major positions and here is what to focus on from white belt.
At 31: you will have to own your learning eventually, might as well be now. At
17: BJJ has some of the worst pedagogy of any subject.

The complaint is not that people forget what they were taught. It is that what
they were taught was chosen at random and was not for them. **There is no
personal curriculum, only a room and a technique of the day.**

That single line reorganises everything else in this file. Voice capture exists
so the record costs nothing. The before-class surface exists because that is
when a curriculum is worth reading. Observables rather than summaries, because
that is what a curriculum for a body looks like. The map is earned rather than
canonical, because a curriculum you did not earn is the trains guy. Training
partners are first class because who you rolled with is why the same hole keeps
appearing.

The old tagline was "you train hard, you forget most of it". Retire it. The
sharpest critic in the niche says forgetting is not the bottleneck and he is
right.

### Who, specifically

A hobbyist training three or four times a week around a job. Not a
professional, not a competitor by default. "It is okay to be a hobbyist" drew
224 upvotes and 164 comments in the same community.

---

## What the research says, with the numbers that make the argument

The research was done by reading r/bjj, r/MuayThai, r/amateur_boxing,
r/wrestling and r/MMA. Numbers are upvotes, and they are here because they are
the argument.

**This niche does not want apps. It wants artefacts.** Posts showing someone's
own training notes: 876, 860, 741, 733, 692, 421, 393, 254. Posts announcing
training apps, same subs, same years: 29, 24, 8, 2, 0, 0, 0. The test for every
screen is whether a fighter would screenshot it and post it, or be embarrassed
to.

**Notes are write-only.** In a 76-comment thread asking what people use to log
classes, the top comment at 51 is a man saying he does not log and would never
reread it if he did. Underneath, independently: "I took notes through blue belt,
never looked at them." And the useful version: "I write detailed notes and
mostly never revisit them, but the act of writing down the parts of the
technique in sequence really helps me remember." **Capture has value. Storage has
almost none. Retrieval has value at exactly one moment.**

**That moment is before class.** A white belt in the same thread: he hopes going
through his notes before class will help him find his ten moves. That is the
retrieval surface and the app does not have it.

**Forgetting is not the bottleneck.** A coach in r/MuayThai: 99% of what people
do wrong is not something they forgot, it is something they struggle to make
their body do by default, and most of his real advice is relative foot position,
smaller or bigger steps, step out, open more, when to rotate. Our tagline says
"you forget most of it". The sharpest person in the room disagrees. **Observables
beat recall. Anything that only summarises the past is dead weight.**

**Slop is punished in public.** A reply to an app survey in r/MuayThai, in full:
"AI generated shite to promote a shitty app." This is the commercial argument
for the copy rules below, not an aesthetic one.

**They spend real money on organised knowledge.** A scraped database of BJJ
instructionals, 3,393 titles, drew 533 upvotes for a spreadsheet. Average price
went from $78 in 2018 to $140 in 2023. Gordon Ryan averages $346. And the top
substantive reply is a man who has neither the will nor the money, looking for
counters and counter-counters he cannot find free on YouTube, told by the thread
that nobody has any tips.

**Most of them are hobbyists.** "It is okay to be a hobbyist" drew 224 upvotes
and 164 comments. Three or four sessions a week around a job. Do not build for
professionals.

**The category's ceiling with real users in the room is "I will give it a try."**
In the grapple.ninja launch thread, users named mattime.io as abandonware and
BJJ Training Journal as glitchy and unusable.

### Not this

- Not a tracker. Logging is the cost of the product, never the product.
- Not homework. Anything that feels like an assignment is dead on arrival.
- Not a memory aid as the headline promise. See "forgetting is not the
  bottleneck".
- **No canonical technique library.** No pre-seeded encyclopedia of the sport.
- **No map node the athlete has not personally earned.** See the constraint
  below, which is the one most likely to be violated by a well-meaning
  implementation at four in the morning.
- Not built for professionals.
- **No tagline or copy that rests on forgetting.** Retired deliberately: the
  bottleneck is what the body defaults to and what the room taught at random,
  not what the mind lost.

### The map constraint, in full, because it is subtle

A man posted a 3D conceptual map of all BJJ positions. 98 comments, and the
community mocked it: "did you take a 10mg or 30mg adderall" at 305, "I am
guessing you also really like trains" at 298, "what is even the point of this"
at 41. A nine-month white belt posted his own notes that had grown into a web of
linked positions: 733 upvotes, and a stranger at 179 begging him to release it.

**Same idea, opposite reception. The variable is whose graph it is.** A canonical
taxonomy reads as someone who likes systems more than fighting. A messy personal
map of what one person is actually working on reads as earned.

So: the map is a byproduct of the athlete's own logs, contains only positions
they have personally been in, and is small when their history is small. That
smallness is the honesty that makes people want it.

And: **the edges are the product, the nodes are just labels.** The best comment
in that thread, at 59, says the poster focused on positioning rather than
transitioning. What people want to see is that they keep ending up in the same
place and losing the same exit. Our session data supports that; a static
position library cannot.

---

## Invariants. Breaking one of these is a bug, not a trade-off.

1. **Nothing an athlete would expect to be a record may be stored as a current
   value.** Focus and bodyweight were both overwritten in place and both are now
   append-only histories. Before adding any field, ask whether a fighter would
   expect to see it over time.
2. **A failed or hanging request must never blank a screen that already had good
   data.** The gym failure mode is a hang, not a clean error.
3. **What the athlete just changed shows immediately**, never after a
   revalidation.
4. **No user-visible string may be cut mid-word.** Use `lib/clip.ts`.
5. **No em dash or en dash anywhere a reader can see**, in source or in model
   output. Enforced at generation, at display, and by test.
6. **Write to the athlete, never about them.** Never "the athlete", "the user".
7. **Never claim more than the evidence supports.** Nothing is a strength until
   it holds up three sessions running. Nothing is recurring until it has
   happened twice.
8. **Never infer something that cannot honestly be inferred.** Experience level
   cannot be derived from session count. "Not stated" beats a guess.

---

## House style

Measure every rewrite against these four lines from the live app. They are the
register. Do not touch them.

- "Nothing is a strength until it holds up three sessions running."
- "Nothing is recurring until it has happened twice."
- "FightIQ can see what you stopped writing down. It cannot see what you fixed.
  That part is still your call."
- "Watch whether the support foot turns before the hip comes through."

They are specific, they state a rule or an observable, and they sound like
somebody who knows the sport.

**Banned, each because it is how a language model writes rather than how a coach
talks:**

- Em dashes and en dashes. Already tested.
- **American spelling.** The user is British. defence, offence, recognise,
  practise (verb). Currently the app says "defense" seven times in Coach and
  "reliable offense" in My Game.
- Symmetrical three-item lists. "Tailor training, fuel, and recovery."
- Headings that restate what is underneath them. "YOUR FIGHTER BRAIN" above
  My Game. "YOUR COACH" above Ask FightIQ.
- Encouragement with no information. "Let us keep building your game."
- Hedged nominalisations doing the work of a fact. "Ankle-lock execution felt
  successful in this session" is "the ankle lock worked".
- Labels that lie. "RECENT IMPROVEMENT" above a quote is not an improvement.
- Any sentence that would survive being deleted.
- **A fixed answer skeleton.** Every Coach answer currently opens by restating
  the question, gives four or five bullets, and ends with "Next step:". Five
  substantive answers in one thread ended that way. A coach answers a narrow
  question in one or two sentences and does not hand over a protocol every time.

Every rule here needs a test. A rule that only lives in a prompt does not hold:
the em dash rule was in both system prompts, in those words, and the model
ignored it until there was a sanitiser and a test.

---

## Known defects, with evidence

**The token layer describes an app that does not exist.** `app/globals.css`
contains four separate `:root` blocks, appended over time rather than reconciled.
Twelve custom properties are declared more than once and the last declaration
wins. `--blue` is `#087cff` then `#006dff` then `#08c8df`, so the blue token
resolves to cyan. Measured, not estimated: run `node scripts/token-check.mjs`.

The consequence is already shipped. On one screen the app renders pure blue
`rgb(8,117,255)` and cyan `rgb(8,200,223)` and `rgb(24,217,237)` at the same
time. A live sweep of a signed-in session counted 23 distinct saturated colours
on Home, nine of them near-identical blues differing by as little as two points.
Nobody ships nine blues that differ by two points, and a fighter reads it as
cheap without being able to name why.

**`--nav-height` is declared three times as 86px, 72px and 70px, with ten
consumers.** Unlike colour this is load-bearing geometry, and every layout fix
made against it was computed against whichever declaration won in that context.

**Three different day counts on one screen.** My Game says "11 sessions logged
across 1 day", "11 sessions over 2 days" and "11 sessions across 1 day since
9 Aug". Both units are defensible; stating both without labels is not.

**Two glyphs for the same idea on one screen.** `BJJ ×7` in the seven day card,
`BJJ x7` in focus history and the lifetime line.

**`learn.studyTopic` leaks a search string onto the screen**, rendering as "MMA
Repeat ankle locks with controlled resistance and note what stays…". One string
is doing two jobs: it needs a query for the lookup and a short label for display.

**Pre-PR-7 `pre_training_briefs` rows still carry mid-word truncation.** Unlike
the third person case this cannot be repaired at display time. A stored brief
carrying a truncated mission should be treated as stale and regenerated.

**Repeated suggestion chips.** The chip "What pattern should I watch for in my
next live round" was sent four times in one thread and answered differently each
time, so the history reads as a man asking the same question because he was not
getting an answer.

**Live video search is switched off.** `/api/health` reports
`liveVideoSearch: false` because `YOUTUBE_API_KEY` is unset.

---

## Backlog, in order. Take the top unblocked item.

1. **The slop pass.** Fix the copy defects above and add a test for each rule,
   including the British spelling rule and a check on Coach answer shape.
2. **The four faults**: one day-count unit used consistently, one glyph,
   `learn.studyTopic` split into query and label, stale briefs regenerated.
3. **The recommendations record.** `fighter_focus_recommendations` is keyed on
   `owner_id` and upserted, so what FightIQ suggested and when is overwritten.
   Same class as the focus and the bodyweight.
4. **The design reconciliation.** Collapse four `:root` blocks into one, decide
   the accent colour, make `--nav-height` one number, then set a per-screen
   ceiling in `scripts/layout-sweep.mjs` at the honest number and let it fail on
   drift.
5. Product build order, **not agreed yet, do not start**: voice capture, the
   before-class surface, the personal position map with a share export, training
   partners as a first-class entity, live video search.

## Not now. Do not touch these.

- **PR #4** (`claude/artifact-intro-cover-uuyei3`, "Let Coach land the plane").
  Deliberately held until the owner has logged a real session and judged the
  debrief. Do not merge it, do not build on it, do not resolve its conflicts
  except when explicitly asked to rebase it.
- **Nutrition targets.** Agreed to behave as a current value.
- **Anything in section 5 of the backlog** until the shape is agreed.
- **`OPENAI_API_KEY`.** Verified dead, left in place on purpose.

---

## Rules for an unattended run

1. **Never merge.** Never push to `main`. Never deploy.
2. **Never touch environment variables or `.openai/hosting.json`.**
3. **One branch per run, named for the goals.md item.** Do not start a second
   item in the same run. Two branches racing on the same files is what has cost
   this project every rebase it has had.
4. **Never claim something works because a test passed.** If it is visible,
   measure it in a browser. Two of the worst bugs here passed every test.
5. **If a gate fails twice with identical output, stop.** Write what is broken
   and end the turn honestly. The Stop hook enforces this, but the reasoning is
   yours.
6. **If the top item is already done or too loosely specified to build, stop and
   say so.** Manufacturing work is worse than doing none.
