// The app talks to the athlete everywhere it writes its own copy. Strings a
// model wrote and stored months ago drift into the third person, and "Athlete
// reported the technique always worked" is a clinician writing about a patient.

import assert from "node:assert/strict";
import test from "node:test";
import { toAthleteVoice } from "../lib/athlete-voice.ts";

test("case-note phrasing becomes something a coach would say", () => {
  assert.equal(toAthleteVoice("Athlete reported the technique always worked."), "You said the technique always worked.");
  assert.equal(toAthleteVoice("The athlete keeps losing inside position."), "You keep losing inside position.");
  assert.equal(toAthleteVoice("The athlete's guard is passive."), "Your guard is passive.");
});

test("the verb follows the person", () => {
  // "You keeps" would be worse than the third person it replaced.
  assert.equal(toAthleteVoice("The athlete is squaring up."), "You are squaring up.");
  assert.equal(toAthleteVoice("The athlete has not tested it."), "You have not tested it.");
  assert.equal(toAthleteVoice("Athlete needs more rounds."), "You need more rounds.");
});

test("a sentence still starts with a capital", () => {
  assert.match(toAthleteVoice("The athlete lost the angle. The athlete recovered."), /^You lost the angle\. You recovered\.$/);
});

test("it leaves the athlete's own words about other people alone", () => {
  // "my training partner" is not "the athlete", and rewriting it would put
  // words in their mouth.
  const note = "My training partner kept squaring up, and my coach said to turn the front foot.";
  assert.equal(toAthleteVoice(note), note);
  assert.equal(toAthleteVoice("Your hips are late."), "Your hips are late.");
});

test("copy the app wrote about itself is untouched", () => {
  const line = "FightIQ needs another completed debrief to confirm a distinct improvement.";
  assert.equal(toAthleteVoice(line), line);
});

test("empty input is not turned into anything", () => {
  assert.equal(toAthleteVoice(""), "");
});
