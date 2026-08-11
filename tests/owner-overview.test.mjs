// The owner dashboard is the only place someone decides whether this business
// is working. Wrong numbers there are worse than no numbers.

import assert from "node:assert/strict";
import test from "node:test";
import { buildOwnerOverview, stateLabel } from "../lib/owner-overview.ts";
import { checkOwner, ownerCount } from "../lib/owner-access.ts";

const NOW = new Date("2026-08-11T12:00:00.000Z");
const ago = (days) => new Date(NOW.getTime() - days * 86400000).toISOString();
const account = (id, joined, seen = joined, extra = {}) =>
  ({ ownerId: id, email: `${id}@example.test`, displayName: id, firstSeenAt: ago(joined), lastSeenAt: ago(seen), visits: 3, ...extra });
const session = (id, days, extra = {}) =>
  ({ ownerId: id, discipline: "Muay Thai", sessionType: "Class", createdAt: ago(days), debriefComplete: true, ...extra });

test("an empty deployment says so instead of showing zeroes", () => {
  const overview = buildOwnerOverview([], [], [], NOW);
  assert.equal(overview.totals.athletes, 0);
  assert.match(overview.headlines[0], /Nobody has signed in yet/);
});

test("counts the things an owner actually decides on", () => {
  const overview = buildOwnerOverview(
    [account("ana", 40, 1), account("ben", 3, 0), account("cal", 60, 45)],
    [session("ana", 1), session("ana", 4), session("ana", 30), session("ben", 2), session("cal", 45)],
    [],
    NOW,
  );
  assert.equal(overview.totals.athletes, 3);
  assert.equal(overview.totals.signedUpThisWeek, 1, "only ben joined this week");
  assert.equal(overview.totals.activeThisWeek, 2, "ana and ben trained this week");
  assert.equal(overview.totals.sessions, 5);
  assert.equal(overview.totals.sessionsThisWeek, 3);
  assert.equal(overview.totals.lapsed, 1, "cal last trained 45 days ago");
});

test("somebody who signed in and never logged is counted separately from somebody who quit", () => {
  const overview = buildOwnerOverview([account("ghost", 30), account("quitter", 30)], [session("quitter", 29)], [], NOW);
  assert.equal(overview.totals.neverLogged, 1);
  assert.equal(overview.totals.lapsed, 1);
  assert.equal(overview.athletes.find((a) => a.ownerId === "ghost").state, "never_logged");
  assert.equal(overview.athletes.find((a) => a.ownerId === "quitter").state, "lapsed");
});

test("someone who joined today has not lapsed, they have just arrived", () => {
  const overview = buildOwnerOverview([account("fresh", 0)], [], [], NOW);
  assert.equal(overview.athletes[0].state, "new");
  assert.equal(stateLabel("new"), "Just joined");
});

test("a hold outranks everything else about an athlete", () => {
  const overview = buildOwnerOverview(
    [account("ana", 40, 0)],
    [session("ana", 40)],
    [{ ownerId: "ana", reason: "head_impact", openedAt: ago(1) }],
    NOW,
  );
  assert.equal(overview.athletes[0].state, "held");
  assert.equal(overview.totals.holdsOpen, 1);
  assert.match(overview.headlines.join(" "), /return to training hold/);
});

test("the roster leads with whoever needs attention, not the alphabet", () => {
  const overview = buildOwnerOverview(
    [account("aaron", 30, 0), account("zoe", 30, 0), account("held", 30, 0)],
    [session("aaron", 1), session("zoe", 40)],
    [{ ownerId: "held", reason: "acute_injury", openedAt: ago(2) }],
    NOW,
  );
  assert.equal(overview.athletes[0].ownerId, "held");
  assert.equal(overview.athletes[1].ownerId, "zoe", "lapsed should outrank the athlete who is fine");
  assert.equal(overview.athletes.at(-1).ownerId, "aaron");
});

test("retention answers the only question that matters early on", () => {
  const overview = buildOwnerOverview(
    [account("one", 20), account("two", 20), account("many", 20)],
    [session("one", 10), session("two", 10), session("two", 9), ...Array.from({ length: 6 }, (_, i) => session("many", i + 1))],
    [], NOW,
  );
  assert.deepEqual(overview.retention, { loggedOnce: 3, loggedTwice: 2, loggedFive: 1 });
  assert.match(overview.headlines.join(" "), /logged once and stopped/);
});

test("no training note text can reach the dashboard, whatever is passed in", () => {
  const overview = buildOwnerOverview(
    [account("ana", 5)],
    [{ ...session("ana", 1), note: "PRIVATE: got rocked and cried in the car park", rawEntry: "PRIVATE" }],
    [], NOW,
  );
  assert.doesNotMatch(JSON.stringify(overview), /PRIVATE|car park/, "an athlete's own words must never appear here");
});

test("sparring share is a percentage of what they actually did", () => {
  const overview = buildOwnerOverview(
    [account("ana", 20)],
    [session("ana", 1, { sessionType: "Sparring" }), session("ana", 2, { sessionType: "Open mat" }), session("ana", 3), session("ana", 4)],
    [], NOW,
  );
  assert.equal(overview.athletes[0].sparringShare, 50);
});

test("junk timestamps do not produce nonsense", () => {
  const overview = buildOwnerOverview(
    [{ ownerId: "x", email: null, displayName: null, firstSeenAt: "not a date", lastSeenAt: "", visits: 0 }],
    [{ ownerId: "x", discipline: "", sessionType: "", createdAt: "nope", debriefComplete: false }],
    [], NOW,
  );
  assert.equal(overview.athletes[0].name, "Athlete");
  assert.ok(Number.isFinite(overview.athletes[0].sessions));
  assert.doesNotMatch(JSON.stringify(overview), /NaN|Invalid/);
});

test("the dashboard is shut unless somebody is explicitly named", () => {
  assert.deepEqual(checkOwner("max@example.test", ""), { allowed: false, unconfigured: true });
  assert.deepEqual(checkOwner("max@example.test", undefined), { allowed: false, unconfigured: true });
  assert.equal(checkOwner("max@example.test", "max@example.test").allowed, true);
  assert.equal(checkOwner("MAX@Example.Test", " max@example.test ").allowed, true, "email comparison is case and space insensitive");
  assert.equal(checkOwner("someone@else.test", "max@example.test").allowed, false);
  assert.equal(checkOwner(null, "max@example.test").allowed, false);
  assert.equal(checkOwner("", "max@example.test").allowed, false);
});

test("several owners can be named at once, and junk entries are ignored", () => {
  const list = "max@example.test, coach@example.test\nnot-an-email";
  assert.equal(ownerCount(list), 2);
  assert.equal(checkOwner("coach@example.test", list).allowed, true);
  assert.equal(checkOwner("not-an-email", list).allowed, false);
});
