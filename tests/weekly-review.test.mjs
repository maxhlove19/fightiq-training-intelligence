import assert from "node:assert/strict";
import test from "node:test";
import { buildWeeklyReview, themeStatusLabel } from "../lib/weekly-review.ts";

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
  assert.match(hit.headline, /That is your week hit/);
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
  assert.match(review.subline, /head position/);
  assert.match(review.subline, /still there at the end of the week/);
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
