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

// A false positive is no longer one dismissible card. It opens a hold that
// stands between the athlete and their own training for days, so the ordinary
// striking vocabulary below has to come back clean.
test("a shot that landed on the body is not a head impact", () => {
  const bodyShots = [
    "Sparred light today. He caught me with a body kick a few times, need to keep my elbow down.",
    "Got cracked in the ribs with a knee, winded me for a second but fine.",
    "He dropped me with a leg kick in round two. Checked the rest of them after that.",
    "Got tagged in the liver and had to take a knee.",
    "He clipped my shoulder with a cross.",
  ];
  for (const note of bodyShots) assert.equal(level(note), "none", note);
});

test("naming the body does not explain away a separate head shot", () => {
  // One run-on note, two different events. The clause is the window, not the note.
  assert.equal(level("Exhausted, tweaked my knee, and got rocked in the last round."), "head_impact");
  assert.equal(level("Got cracked in the ribs, then caught a head kick and my ears were ringing."), "head_impact");
  assert.equal(level("Got cracked in the face."), "head_impact");
});

test("an unqualified 'got cracked' still holds, because the cost runs one way", () => {
  assert.equal(level("Hard sparring, got cracked in the third."), "head_impact");
  assert.equal(level("Got rocked."), "head_impact");
});

test("sore ribs after body work is a normal Tuesday, not a week off", () => {
  assert.equal(level("Got hit a lot to the body, my ribs are sore."), "none");
  assert.equal(level("Ribs hurt a bit from the body sparring."), "none");
  // A rib that pops, or that makes breathing hurt, is a different thing.
  assert.equal(level("Something cracked in my ribs and it hurts to breathe."), "acute_injury");
});

test("the ways athletes actually describe an injury are caught", () => {
  assert.equal(level("Something popped in my knee when I checked a kick."), "acute_injury");
  assert.equal(level("My shoulder gave when I posted."), "acute_injury");
});

test("memory loss counts however it is phrased", () => {
  assert.equal(level("Sparring, I don't really remember the last round."), "head_impact");
  assert.equal(level("Can't properly remember the third."), "head_impact");
});

test("clashing heads is caught in the words people use for it", () => {
  for (const note of ["Clashed heads in the clinch.", "We banged heads going for the same shot.", "Headbutt by accident in the clinch."]) {
    assert.equal(level(note), "head_impact", note);
  }
});
