// A takeaway that says "felt successful in this session" is vague to everyone
// except the app. The athlete wants to know which night it is talking about.

import assert from "node:assert/strict";
import test from "node:test";
import { sessionDay, shortDate } from "../lib/when.ts";

// A fixed Tuesday afternoon, so the wording is deterministic.
const NOW = new Date("2026-08-11T14:00:00");

test("today and yesterday are said the way a fighter says them", () => {
  assert.equal(sessionDay("2026-08-11T20:30:00", NOW), "this night");
  assert.equal(sessionDay("2026-08-11T07:30:00", NOW), "this morning");
  assert.equal(sessionDay("2026-08-10T20:30:00", NOW), "yesterday night");
});

test("inside the week it is the weekday, because that is what locates it", () => {
  assert.equal(sessionDay("2026-08-09T23:51:00", NOW), "Sunday night");
  assert.equal(sessionDay("2026-08-07T10:00:00", NOW), "Friday morning");
});

test("past a week the weekday stops locating anything, so it becomes a date", () => {
  assert.equal(sessionDay("2026-07-20T20:00:00", NOW), "20 Jul");
});

test("a session logged later today is not described as being in the future", () => {
  assert.equal(sessionDay("2026-08-11T23:00:00", NOW), "this night");
});

test("an unusable timestamp says nothing rather than saying Invalid Date", () => {
  assert.equal(sessionDay("not a date", NOW), "");
  assert.equal(shortDate("not a date"), "");
});

test("short dates are short", () => {
  assert.equal(shortDate("2026-08-09T23:51:00"), "9 Aug");
});
