import assert from "node:assert/strict";
import test from "node:test";
import { scanTrainingNote } from "../lib/safety-signals.ts";

const level = (note) => scanTrainingNote(note).level;

test("catches head knocks written the way fighters write them", () => {
  const notes = [
    "Sparring went ok until the last round, got rocked by a left hook and sat the rest out.",
    "He dropped me with a body kick, felt weird after so I stopped.",
    "Caught a knee to the head in the clinch, ears were ringing for a while.",
    "Took a bad slam, banged my head on the mat.",
    "Think I got a slight concussion, will see how it is tomorrow.",
    "Was out cold for a second after the head kick.",
    "Can't remember the last two rounds properly.",
    "Head is banging and I feel sick since the spar.",
    "Bit dizzy after sparring, probably just tired.",
  ];
  for (const note of notes) assert.equal(level(note), "head_impact", note);
});

test("two symptoms alone are enough, with no impact described", () => {
  assert.equal(level("Felt dizzy and a bit nauseous through the whole session."), "head_impact");
});

test("one vague symptom with no head or striking context is not a head flag", () => {
  assert.notEqual(level("Legs went at the end of the run, no strength left."), "head_impact");
  assert.equal(level("Legs went on the last hill sprint, absolutely exhausted."), "illness_or_load");
});

test("does not fire when the athlete is the one landing the shot", () => {
  assert.equal(level("Good session. I dropped him with a right hand and finished the round."), "none");
  assert.equal(level("Cracked the pads harder than last week, felt strong."), "none");
});

test("respects negation", () => {
  assert.equal(level("Hard sparring but no headache and no dizziness afterwards, felt sharp."), "none");
  assert.equal(level("Didn't get rocked at all this week, defence is improving."), "none");
});

test("a contrast word ends the negator's reach", () => {
  assert.equal(level("No pain in the knee, but my head is banging since the last round."), "head_impact");
});

test("catches acute injuries", () => {
  const notes = [
    "Heard a pop in my knee when he went for the heel hook.",
    "Tapped late to an armbar and my elbow got cranked.",
    "Shoulder came out of the socket in the scramble, popped it back.",
    "Can't put weight on my ankle after the takedown.",
    "Fingers went numb after the gi choke and still are.",
  ];
  for (const note of notes) assert.equal(level(note), "acute_injury", note);
});

test("catches illness and load without holding training", () => {
  const signal = scanTrainingNote("Trained anyway with a fever, absolutely exhausted and haven't slept.");
  assert.equal(signal.level, "illness_or_load");
  assert.equal(signal.holdTraining, false);
});

test("head impacts outrank everything else and hold training", () => {
  const signal = scanTrainingNote("Exhausted, tweaked my knee, and got rocked in the last round.");
  assert.equal(signal.level, "head_impact");
  assert.equal(signal.holdTraining, true);
  assert.ok(signal.redFlags.length >= 5);
});

test("shows the athlete which of their own words triggered it", () => {
  const signal = scanTrainingNote("Got rocked in the third and felt dizzy after.");
  assert.ok(signal.matched.includes("got rocked"));
  assert.ok(signal.matched.includes("dizzy"));
  assert.match(signal.body, /got rocked/);
});

test("never diagnoses", () => {
  const signal = scanTrainingNote("Got knocked out cold in sparring.");
  assert.doesNotMatch(signal.body, /you have|diagnos/i);
  assert.match(signal.body, /qualified/i);
});

test("an ordinary technique note is left alone", () => {
  const notes = [
    "Did BJJ today. We worked arm drags. Professor said to grab behind the armpit rather than the tricep.",
    "Muay Thai pads, worked the switch kick, support foot is still lazy.",
    "Wrestling: shot fifty single legs, finish is getting cleaner.",
  ];
  for (const note of notes) assert.equal(level(note), "none", note);
});

test("empty and junk input is safe", () => {
  assert.equal(level(""), "none");
  assert.equal(level("   "), "none");
  assert.equal(scanTrainingNote(undefined).level, "none");
});
