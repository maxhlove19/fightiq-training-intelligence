// Every debrief and Coach answer is a paid call, and nothing capped how many
// one account could start. The limits have to hold — and, just as importantly,
// they have to be somewhere no real athlete ever reaches.

import assert from "node:assert/strict";
import test from "node:test";
import { LIMITS, checkUsage, usageWindows } from "../lib/usage-limits.ts";

test("ordinary training is nowhere near a limit", () => {
  // A heavy week: three sessions a day, two Coach questions after each.
  assert.equal(checkUsage("session_debrief", { lastHour: 1, lastDay: 3 }).allowed, true);
  assert.equal(checkUsage("coach_question", { lastHour: 6, lastDay: 12 }).allowed, true);
  // Even a fortnight's backlog typed up in one sitting stays under the day cap.
  assert.equal(checkUsage("session_debrief", { lastHour: 8, lastDay: 20 }).allowed, true);
});

test("the hourly ceiling holds, and says when to come back", () => {
  const decision = checkUsage("session_debrief", { lastHour: LIMITS.session_debrief.hour, lastDay: 15 });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "HOURLY_LIMIT_REACHED");
  assert.ok(decision.retryAfterSeconds > 0);
});

test("the daily ceiling outranks the hourly one, so the message is the true one", () => {
  const decision = checkUsage("session_debrief", { lastHour: 0, lastDay: LIMITS.session_debrief.day });
  assert.equal(decision.code, "DAILY_LIMIT_REACHED");
  assert.match(decision.message, /tomorrow/);
});

test("no refusal ever suggests an athlete lost what they wrote", () => {
  for (const kind of ["session_debrief", "coach_question"]) {
    for (const counts of [{ lastHour: 9999, lastDay: 0 }, { lastHour: 0, lastDay: 9999 }]) {
      const decision = checkUsage(kind, counts);
      assert.equal(decision.allowed, false);
      assert.match(decision.message, /saved|still here/i, `${kind}: ${decision.message}`);
      assert.doesNotMatch(decision.message, /error|failed|denied|blocked|abuse/i, decision.message);
    }
  }
});

test("junk counts never open the gate or wedge it shut", () => {
  assert.equal(checkUsage("session_debrief", { lastHour: -5, lastDay: -5 }).allowed, true);
  assert.equal(checkUsage("session_debrief", { lastHour: NaN, lastDay: NaN }).allowed, true);
  assert.equal(checkUsage("session_debrief", { lastHour: 1.9, lastDay: 2.9 }).allowed, true);
  assert.equal(checkUsage("session_debrief", { lastHour: Infinity, lastDay: 0 }).allowed, false);
});

test("the coach limit is the looser one, because a conversation is many turns", () => {
  assert.ok(LIMITS.coach_question.hour > LIMITS.session_debrief.hour);
  assert.ok(LIMITS.coach_question.day > LIMITS.session_debrief.day);
});

test("the windows are an hour and a day, measured from now", () => {
  const now = new Date("2026-08-11T12:00:00.000Z");
  const { hourAgo, dayAgo } = usageWindows(now);
  assert.equal(hourAgo, "2026-08-11T11:00:00.000Z");
  assert.equal(dayAgo, "2026-08-10T12:00:00.000Z");
});
