// The house style says no em dashes. Every system prompt in this codebase
// already says so to the model, in those words, and the model used one anyway in
// a coaching answer an athlete then read on screen.
//
// That is the point of this file. A rule that only lives in a prompt is a
// preference. These tests are the difference between telling the model and
// making it true.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { toHouseStyle, applyHouseStyle, walkStrings } from "../lib/house-style.ts";

test("a dash standing in for a pause becomes punctuation", () => {
  assert.equal(
    toHouseStyle("Finish each successful pass with a simple exit — stand up, recover guard."),
    "Finish each successful pass with a simple exit, stand up, recover guard.",
  );
  // Unspaced is the same decision.
  assert.equal(toHouseStyle("It worked—then it stopped working."), "It worked, then it stopped working.");
  // En dash and horizontal bar are the same tell.
  assert.equal(toHouseStyle("Turn the foot – then kick."), "Turn the foot, then kick.");
  assert.equal(toHouseStyle("Turn the foot ― then kick."), "Turn the foot, then kick.");
});

test("a dash between numbers is a range, not a pause", () => {
  // "3, 5 reps" would be a wrong instruction rather than an ugly one.
  assert.equal(toHouseStyle("3–5 reps at RPE 7."), "3 to 5 reps at RPE 7.");
  assert.equal(toHouseStyle("Rest 60 — 90 seconds."), "Rest 60 to 90 seconds.");
});

test("punctuation never stacks", () => {
  assert.equal(toHouseStyle("Keep the frame in, — then move the hips."), "Keep the frame in, then move the hips.");
  assert.equal(toHouseStyle("He passed. — Then he settled."), "He passed. Then he settled.");
});

test("a dash opening or closing a sentence just goes", () => {
  assert.equal(toHouseStyle("— Start with the grip"), "Start with the grip");
  assert.equal(toHouseStyle("Start with the grip —"), "Start with the grip");
});

test("text without a dash is returned untouched", () => {
  const clean = "Turn the support foot before the shin arrives. Nothing else changes.";
  assert.equal(toHouseStyle(clean), clean);
  // Hyphens are not dashes and a compound word must survive.
  assert.equal(toHouseStyle("Ankle-lock execution felt successful."), "Ankle-lock execution felt successful.");
});

test("American spelling is rewritten to British, case preserved", () => {
  // The em dash rule was in every system prompt and the model used one anyway.
  // "Write in British English" is the same kind of instruction, so it gets the
  // same treatment rather than trusting the prompt.
  assert.equal(toHouseStyle("Build a reliable offense from that."), "Build a reliable offence from that.");
  assert.equal(toHouseStyle("Clinch pressure and takedown defense."), "Clinch pressure and takedown defence.");
  assert.equal(toHouseStyle("DEFENSE wins fights."), "DEFENCE wins fights.");
  assert.equal(toHouseStyle("Defenses fall apart under pace."), "Defences fall apart under pace.");
  // A word that already contains "defense" or "offense" as a substring, not as
  // itself, must survive. There are none in this vocabulary, but the boundary
  // is what makes that true rather than luck.
  const clean = "The defense rests on one detail.";
  assert.equal(toHouseStyle(clean), "The defence rests on one detail.");
});

test("running it twice changes nothing the second time", () => {
  const once = toHouseStyle("A simple exit — stand up, recover guard, or reset.");
  assert.equal(toHouseStyle(once), once);
});

test("it reaches every readable string in a model response, at any depth", () => {
  // Naming fields is how you fix the debrief and miss the coaching answer
  // underneath it, so the walk is structural.
  const response = applyHouseStyle({
    takeaway: "You kept the frame — then lost it.",
    intelligence: {
      problems: ["squaring up — under pressure"],
      nested: [{ note: "hips arrive late — every time" }],
    },
    confidence: 0.72,
    follow_up: null,
    complete: true,
  });
  assert.equal(response.takeaway, "You kept the frame, then lost it.");
  assert.deepEqual(response.intelligence.problems, ["squaring up, under pressure"]);
  assert.equal(response.intelligence.nested[0].note, "hips arrive late, every time");
  // Non-strings survive as themselves, including null and booleans.
  assert.equal(response.confidence, 0.72);
  assert.equal(response.follow_up, null);
  assert.equal(response.complete, true);
});

test("every model response passes through both sanitisers", () => {
  // The guarantee is structural: one choke point, so a fifth model call added
  // later inherits the rules instead of having to remember them. The voice pass
  // runs here as well as at display time, because stored model text is fed back
  // to the model as its own context on the next call, and a debrief saved as
  // "Athlete reported..." was teaching the next answer to write the same way.
  const claude = readFileSync(new URL("../lib/claude.ts", import.meta.url), "utf8");
  assert.match(claude, /return walkStrings\(parsed, \(text\) => toAthleteVoice\(toHouseStyle\(text\)\)\);/);
});

test("the walk applies whatever rule it is given, at any depth", () => {
  const shouted = walkStrings({ a: "one", b: ["two", { c: "three" }], n: 4 }, (text) => text.toUpperCase());
  assert.deepEqual(shouted, { a: "ONE", b: ["TWO", { c: "THREE" }], n: 4 });
});

test("stored text already written with an em dash is cleaned on the way to the screen", () => {
  // Generation-time alone would leave every answer written before tonight
  // untouched, and those are already sitting in somebody's conversation.
  const screens = readFileSync(new URL("../app/components/ProductScreens.tsx", import.meta.url), "utf8");
  assert.match(screens, /function cleanAiDisplay[\s\S]{0,200}toHouseStyle\(/);
});
