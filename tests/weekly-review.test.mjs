import assert from "node:assert/strict";
import test from "node:test";
import { buildWeeklyReview, isPluralLabel, restTile, themeStatusLabel } from "../lib/weekly-review.ts";

const NOW = new Date("2026-08-10T20:00:00.000Z");
const daysAgo = (days, hour = 19) => new Date(NOW.getTime() - days * 86400000).toISOString().slice(0, 11) + String(hour).padStart(2, "0") + ":00:00.000Z";

const session = (overrides) => ({
  discipline: "Muay Thai", sessionType: "Class", note: "", takeaway: null, focus: null,
  createdAt: daysAgo(1), ...overrides,
});

test("an empty week says so without pretending", () => {
  const review = buildWeeklyReview([], 4, NOW);
  assert.equal(review.hasData, false);
  assert.equal(review.sessions, 0);
  assert.match(review.headline, /No sessions logged/);
});

test("only counts the last seven days", () => {
  const review = buildWeeklyReview([
    session({ createdAt: daysAgo(2) }),
    session({ createdAt: daysAgo(6) }),
    session({ createdAt: daysAgo(9) }),
    session({ createdAt: daysAgo(40) }),
  ], 4, NOW);
  assert.equal(review.sessions, 2);
});

test("counts days trained, not just sessions", () => {
  const review = buildWeeklyReview([
    session({ createdAt: daysAgo(2, 10) }),
    session({ createdAt: daysAgo(2, 19) }),
    session({ createdAt: daysAgo(4) }),
  ], 4, NOW);
  assert.equal(review.sessions, 3);
  assert.equal(review.days, 2);
});

test("splits the week by discipline, busiest first", () => {
  const review = buildWeeklyReview([
    session({ discipline: "BJJ", createdAt: daysAgo(1) }),
    session({ discipline: "BJJ", createdAt: daysAgo(3) }),
    session({ discipline: "Muay Thai", createdAt: daysAgo(5) }),
  ], 3, NOW);
  assert.deepEqual(review.disciplines, [{ name: "BJJ", sessions: 2 }, { name: "Muay Thai", sessions: 1 }]);
});

test("finds the longest rest gap inside the week", () => {
  const review = buildWeeklyReview([
    session({ createdAt: daysAgo(6) }),
    session({ createdAt: daysAgo(2) }),
    session({ createdAt: daysAgo(1) }),
  ], 3, NOW);
  assert.equal(review.hardestGapDays, 3);
});

test("a session older than the window is outside it, even by an hour", () => {
  const justInside = buildWeeklyReview([session({ createdAt: daysAgo(6, 21) })], 3, NOW);
  const justOutside = buildWeeklyReview([session({ createdAt: daysAgo(7, 19) })], 3, NOW);
  assert.equal(justInside.sessions, 1);
  assert.equal(justOutside.sessions, 0);
});

test("ranks themes by how many sessions mention them, not how often", () => {
  const review = buildWeeklyReview([
    session({ createdAt: daysAgo(6), note: "support foot lazy again, support foot, support foot" }),
    session({ createdAt: daysAgo(4), note: "clinch work, kept getting my head pulled down" }),
    session({ createdAt: daysAgo(1), note: "clinch again tonight" }),
  ], 3, NOW);
  assert.equal(review.themes[0].label, "the clinch");
  assert.equal(review.themes[0].sessions, 2);
});

test("says what is still open versus what went quiet", () => {
  const review = buildWeeklyReview([
    session({ createdAt: daysAgo(6), note: "guard retention was terrible, kept losing my guard" }),
    session({ createdAt: daysAgo(5), note: "support foot not turning on the round kick" }),
    session({ createdAt: daysAgo(1), note: "support foot still not turning, pivot is late" }),
  ], 3, NOW);
  const byLabel = Object.fromEntries(review.themes.map((theme) => [theme.label, theme.status]));
  assert.equal(byLabel["support foot"], "still_open");
  assert.equal(byLabel["guard retention"], "quiet_lately");
});

test("a theme that only appears late is new, not resolved", () => {
  const review = buildWeeklyReview([
    session({ createdAt: daysAgo(6), note: "good rounds, nothing to report" }),
    session({ createdAt: daysAgo(1), note: "kept getting caught by counters stepping in" }),
  ], 3, NOW);
  assert.equal(review.themes[0].label, "counters");
  assert.equal(review.themes[0].status, "new_this_week");
});

test("the headline reads against the athlete's own target", () => {
  const hit = buildWeeklyReview([session({}), session({ createdAt: daysAgo(3) })], 2, NOW);
  assert.match(hit.headline, /That’s your week/);
  const missed = buildWeeklyReview([session({})], 4, NOW);
  assert.match(missed.headline, /out of 4/);
  const noTarget = buildWeeklyReview([session({})], 0, NOW);
  assert.match(noTarget.headline, /1 session logged across 1 day/);
});

test("the subline leads with what is still open", () => {
  const review = buildWeeklyReview([
    session({ createdAt: daysAgo(6), note: "head position dropped on the finish" }),
    session({ createdAt: daysAgo(1), note: "head down again on the single leg finish" }),
  ], 3, NOW);
  // Capitalised, because it opens the sentence. It used to render as
  // "head position came up in 2 sessions", starting a sentence in lower case.
  assert.match(review.subline, /^Head position/);
  assert.match(review.subline, /still there at the end of the week/);
});

test("the verb agrees with the theme", () => {
  // "Arm drags was the thread running through the week" is the sort of mistake
  // that makes an athlete quietly stop trusting the rest of the page.
  const plural = buildWeeklyReview([
    session({ createdAt: daysAgo(2), note: "arm drag worked well" }),
    session({ createdAt: daysAgo(1), note: "hit an arm drag again in rounds" }),
  ], 0, NOW);
  assert.match(plural.subline, /^Arm drags (came up|were)/);
  assert.doesNotMatch(plural.subline, /Arm drags was\b/);

  const singular = buildWeeklyReview([
    session({ createdAt: daysAgo(2), note: "support foot late on the kick" }),
    session({ createdAt: daysAgo(1), note: "standing foot did not turn again" }),
  ], 0, NOW);
  assert.doesNotMatch(singular.subline, /Support foot were\b/);
});

test("every lexicon label plays by the plural rule", () => {
  // isPluralLabel derives agreement from the label rather than a parallel table.
  // That only stays true while no singular entry in LEXICON ends in "s", so this
  // is the guard for anyone adding one later.
  const singulars = ["support foot", "hip rotation", "head position", "guard retention",
    "the underhook", "half guard", "sprawl and defence", "the clinch", "the teep",
    "the jab", "footwork", "distance", "timing", "cardio and pace", "grip fighting"];
  const plurals = ["back takes", "arm drags", "takedown finishes", "round kicks",
    "checking kicks", "counters", "escapes", "submissions", "defence and guard hands"];
  for (const label of singulars) assert.equal(isPluralLabel(label), false, `${label} should be singular`);
  for (const label of plurals) assert.equal(isPluralLabel(label), true, `${label} should be plural`);
});

test("new this week means nothing on a first week, so it is not shown", () => {
  // Every theme carried the badge because every theme was new, which made the
  // badge decoration rather than information.
  const firstWeek = buildWeeklyReview([
    session({ createdAt: daysAgo(1), note: "arm drag and head position both came up" }),
  ], 0, NOW);
  assert.equal(firstWeek.hasEarlierHistory, false);
  assert.equal(themeStatusLabel("new_this_week", firstWeek.hasEarlierHistory), null);

  const withHistory = buildWeeklyReview([
    session({ createdAt: daysAgo(20), note: "worked the teep" }),
    session({ createdAt: daysAgo(1), note: "arm drag worked well" }),
  ], 0, NOW);
  assert.equal(withHistory.hasEarlierHistory, true);
  assert.equal(themeStatusLabel("new_this_week", withHistory.hasEarlierHistory), "new this week");
});

test("describes the notes rather than claiming a fix", () => {
  const review = buildWeeklyReview([
    session({ createdAt: daysAgo(7), note: "teep timing was late all session" }),
  ], 3, NOW);
  assert.doesNotMatch(review.subline, /fixed|solved|improved/i);
  assert.equal(themeStatusLabel("quiet_lately"), "went quiet");
});

test("keeps at most five themes so the screen stays readable", () => {
  const everything = "support foot hips turn head position guard retention underhook half guard back take arm drag single leg sprawl clinch teep round kick jab counters footwork distance timing gassed grips escape armbar";
  const review = buildWeeklyReview([session({ note: everything })], 3, NOW);
  assert.equal(review.themes.length, 5);
});

test("survives junk timestamps and missing fields", () => {
  const review = buildWeeklyReview([
    { discipline: "", sessionType: "", note: "clinch", takeaway: null, focus: null, createdAt: "not a date" },
    session({ discipline: "", note: "clinch work" }),
  ], 0, NOW);
  assert.equal(review.sessions, 1);
  assert.equal(review.disciplines[0].name, "Training");
});

test("what is unresolved and most recent leads, not what starts with an early letter", () => {
  const review = buildWeeklyReview([
    session({ createdAt: daysAgo(6), note: "counters landing on me, and the support foot never turns" }),
    session({ createdAt: daysAgo(5), note: "guard retention drills, felt sharp" }),
    session({ createdAt: daysAgo(1), note: "support foot again, still not pivoting" }),
  ], 3, NOW);
  // Counters and guard retention both stopped being written down. The support
  // foot is the one still there on the last night of the week.
  assert.equal(review.themes[0].label, "support foot");
  assert.equal(review.themes[0].status, "still_open");
  // Both of the others went quiet; the more recently written one ranks above
  // the older one.
  assert.deepEqual(review.themes.slice(1).map((theme) => theme.label), ["guard retention", "counters"]);
  assert.ok(review.themes.slice(1).every((theme) => theme.status === "quiet_lately"));
});

// Judged only inside the seven-day window, a problem an athlete has been
// writing about for a fortnight gets labelled "new this week" the moment it
// skips the first half of one week. That is not what they read it as.
test("a theme from before this week is never called new", () => {
  const now = new Date("2026-08-10T18:00:00.000Z");
  const at = (daysAgo) => new Date(now.getTime() - daysAgo * 86400000).toISOString();
  const sessions = [
    { discipline: "Muay Thai", sessionType: "Class", note: "support foot not turning on the kick", createdAt: at(13) },
    { discipline: "Muay Thai", sessionType: "Class", note: "support foot still lazy on the right", createdAt: at(9) },
    { discipline: "Muay Thai", sessionType: "Sparring", note: "kicks landing, support foot turning now", createdAt: at(1) },
  ];
  const review = buildWeeklyReview(sessions, 3, now);
  const theme = review.themes.find((item) => /support foot/i.test(item.label));
  assert.ok(theme, `expected a support foot theme, got ${JSON.stringify(review.themes)}`);
  assert.notEqual(theme.status, "new_this_week", "it has been in the notes for a fortnight");
  assert.equal(theme.status, "came_back");
  assert.equal(themeStatusLabel(theme.status), "came back");
});

test("something genuinely written for the first time is still called new", () => {
  const now = new Date("2026-08-10T18:00:00.000Z");
  const at = (daysAgo) => new Date(now.getTime() - daysAgo * 86400000).toISOString();
  const sessions = [
    { discipline: "Muay Thai", sessionType: "Class", note: "worked the teep all session", createdAt: at(13) },
    { discipline: "Muay Thai", sessionType: "Sparring", note: "kept getting caught in the clinch", createdAt: at(1) },
  ];
  const theme = buildWeeklyReview(sessions, 3, now).themes.find((item) => /clinch/i.test(item.label));
  assert.ok(theme);
  assert.equal(theme.status, "new_this_week");
});

test("what is unresolved still outranks what came back", () => {
  const now = new Date("2026-08-10T18:00:00.000Z");
  const at = (daysAgo) => new Date(now.getTime() - daysAgo * 86400000).toISOString();
  const sessions = [
    { discipline: "Muay Thai", sessionType: "Class", note: "support foot flat", createdAt: at(12) },
    { discipline: "Muay Thai", sessionType: "Class", note: "losing the clinch", createdAt: at(6) },
    { discipline: "Muay Thai", sessionType: "Class", note: "losing the clinch again", createdAt: at(1) },
    { discipline: "Muay Thai", sessionType: "Class", note: "support foot flat again", createdAt: at(1) },
  ];
  const review = buildWeeklyReview(sessions, 3, now);
  assert.equal(review.themes[0].status, "still_open");
});

test("every status a theme can have reads as plain English", () => {
  for (const status of ["still_open", "quiet_lately", "came_back", "new_this_week"]) {
    const label = themeStatusLabel(status);
    assert.ok(label && label === label.toLowerCase(), status);
    assert.doesNotMatch(label, /_/, `${status} leaked its identifier into the UI`);
  }
});

test("one mention is not called a thread running through the week", () => {
  const now = new Date("2026-08-10T18:00:00.000Z");
  const at = (daysAgo) => new Date(now.getTime() - daysAgo * 86400000).toISOString();
  const once = buildWeeklyReview([
    { discipline: "Muay Thai", sessionType: "Class", note: "pad work, felt sharp", createdAt: at(4) },
    { discipline: "Muay Thai", sessionType: "Class", note: "losing the clinch", createdAt: at(1) },
  ], 3, now);
  assert.doesNotMatch(once.subline, /thread running through the week/);
  assert.match(once.subline, /came up once/);

  const twice = buildWeeklyReview([
    { discipline: "Muay Thai", sessionType: "Class", note: "losing the clinch", createdAt: at(4) },
    { discipline: "Muay Thai", sessionType: "Class", note: "losing the clinch again", createdAt: at(3) },
  ], 3, now);
  assert.match(twice.subline, /clinch/);
});

test("a zero rest-day count is never rendered as a failing score", () => {
  // "0" next to "days without a gap", on a day the athlete trained, is the best
  // possible result shown as the worst looking number on the screen.
  assert.deepEqual(restTile(3, 0), { value: "None", label: "days off in a row" });
  assert.deepEqual(restTile(4, 2), { value: "2", label: "days off in a row" });
  assert.deepEqual(restTile(3, 1), { value: "1", label: "day off in a row" });
});

test("with one day trained the gap tile says nothing, so it is not shown", () => {
  // There is no gap between a single day and itself. Eleven sessions in one day
  // produced "0 days without a gap", which is meaningless and reads as failure.
  assert.equal(restTile(1, 0), null);
  assert.equal(restTile(0, 0), null);
});
