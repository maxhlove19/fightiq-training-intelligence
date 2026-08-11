// A pre-training mission reached the live app as "Repeat ankle locks with
// controlled resistance and note what stays consis": a hard slice at 72
// characters, no ellipsis, cut mid-word inside "consistent". The same sentence
// was stored complete at 77 characters on the profile, so the app was showing a
// worse version of something it had intact.
//
// A mission is an instruction. Half an instruction is worse than a long one.

import assert from "node:assert/strict";
import test from "node:test";
import { clip, clipLabel, looksHardTruncated, sentence } from "../lib/clip.ts";

const MISSION = "Repeat ankle locks with controlled resistance and note what stays consistent";

test("the reported bug does not survive the helper", () => {
  assert.equal(MISSION.length, 76);
  // At the old ceiling it would at least stop on a word and say it stopped.
  const cut = clip(MISSION, 72);
  assert.ok(!cut.includes("consis…"), "must not cut inside a word");
  assert.ok(cut.endsWith("…"), "a cut has to be visible");
  assert.ok(MISSION.startsWith(cut.slice(0, -1)), "what is kept is a real prefix");
  // At the ceiling the app actually uses now, nothing is lost at all.
  assert.equal(clip(MISSION, 240), MISSION);
});

test("no truncated string ever ends mid-word", () => {
  // The general guarantee rather than one example. If the result was cut, the
  // kept part must end exactly where a word ends in the original.
  const corpus = [
    MISSION,
    "Turn the support foot before the shin arrives, every single time you throw it",
    "Keep the frames in early so the hips have somewhere to go when they start passing",
    "Win the grip before you attack, and do not let go of it once the angle opens",
    "Finish each successful defense with a simple exit, stand up, and recover guard",
  ];
  for (const text of corpus) {
    for (let limit = 12; limit <= 90; limit += 1) {
      const result = clip(text, limit);
      assert.ok(result.length <= limit, `"${result}" exceeds ${limit}`);
      if (result === text) continue;
      assert.ok(result.endsWith("…"), `"${result}" was cut without saying so`);
      const kept = result.slice(0, -1);
      assert.ok(text.startsWith(kept), `"${kept}" is not a prefix of the original`);
      // The next character in the original must be a boundary, or we stopped
      // in the middle of a word.
      const next = text.charAt(kept.length);
      assert.ok(/[\s.,;:!?]/.test(next) || next === "", `cut mid-word before "${next}" in "${kept}"`);
    }
  }
});

test("a word longer than the whole ceiling is the one unavoidable hard cut", () => {
  const result = clip("Antidisestablishmentarianism", 12);
  assert.equal(result.length, 12);
  assert.ok(result.endsWith("…"));
});

test("a label loses its full stop and a sentence keeps one", () => {
  // The old helper stripped terminal punctuation off everything, which is how a
  // reason reached the screen as a sentence with no stop at the end of it.
  assert.equal(clipLabel("Arm drags.", 40), "Arm drags");
  assert.equal(clip("Ankle-lock execution felt successful.", 60), "Ankle-lock execution felt successful.");
  assert.equal(sentence("Ankle-lock execution felt successful"), "Ankle-lock execution felt successful.");
  assert.equal(sentence("Did it work?"), "Did it work?");
  assert.equal(sentence("Already stopped."), "Already stopped.");
});

test("whitespace is normalised rather than counted", () => {
  assert.equal(clip("  two   spaces  here  ", 40), "two spaces here");
});

test("nothing is added to a string that fits", () => {
  const short = "Win the grip first.";
  assert.equal(clip(short, 240), short);
  assert.ok(!clip(short, 240).endsWith("…"));
});

test("a row still carrying the old 72-character hard cut is recognised as stale", () => {
  // The exact reported bug: cut at 72 with no ellipsis, stopped inside "consis[tent]".
  const legacy = MISSION.slice(0, 72);
  assert.equal(legacy.length, 72);
  assert.ok(looksHardTruncated(legacy));
  // clip() at the same ceiling produces the fixed shape, which must not trip it.
  assert.ok(!looksHardTruncated(clip(MISSION, 72)));
  assert.ok(!looksHardTruncated("Win the grip first."));
});
