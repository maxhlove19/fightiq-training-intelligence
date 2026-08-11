// The first card anyone sees was spending its headline on a label describing
// itself, with the actual finding demoted underneath in smaller type.

import assert from "node:assert/strict";
import test from "node:test";
import { homeInsight } from "../lib/home-insight.ts";

test("the headline is the finding, not a label", () => {
  const insight = homeInsight({
    latestTakeaway: "Your support foot is turning after the shin arrives. That is why the kicks land soft.",
    latestFocus: "Turn the support foot before the leg",
    focusReason: "unused",
  });
  assert.equal(insight.title, "Your support foot is turning after the shin arrives.");
  assert.doesNotMatch(insight.title, /what matters next|build your baseline/i);
  // The body earns its place by adding, never by repeating the headline.
  assert.doesNotMatch(insight.body, /support foot is turning after/);
  assert.match(insight.body, /That is why the kicks land soft\./);
  assert.match(insight.body, /Next session: Turn the support foot before the leg\./);
});

test("a one-sentence takeaway still gets a body worth reading", () => {
  const insight = homeInsight({ latestTakeaway: "You are squaring up under pressure.", latestFocus: "Keep the front foot turned in", focusReason: "unused" });
  assert.equal(insight.title, "You are squaring up under pressure.");
  assert.equal(insight.body, "Next session: Keep the front foot turned in.");
});

test("a takeaway with no focus falls back rather than showing an empty body", () => {
  const insight = homeInsight({ latestTakeaway: "You are squaring up under pressure.", latestFocus: "", focusReason: "This gives your next sessions one clear direction." });
  assert.equal(insight.body, "This gives your next sessions one clear direction.");
});

test("day one keeps its own headline and body", () => {
  const opening = { title: "Muay Thai starts at the support foot.", body: "Almost every kick that lands soft has the same cause." };
  assert.deepEqual(homeInsight({ opening, latestTakeaway: "ignored", focusReason: "ignored" }), opening);
});

test("sessions logged but nothing debriefed does not claim a blank slate", () => {
  // "Build your baseline" to somebody who already built one is the app failing
  // to read its own data.
  const insight = homeInsight({ latestTakeaway: null, focusReason: "Your starting focus will sharpen as FightIQ learns." });
  assert.doesNotMatch(insight.title, /baseline/i);
  assert.equal(insight.body, "Your starting focus will sharpen as FightIQ learns.");
});

test("a takeaway with no sentence break is not turned into a wall", () => {
  const long = "x".repeat(200);
  const insight = homeInsight({ latestTakeaway: long, focusReason: "fallback" });
  assert.ok(insight.title.length <= 110, "the headline has to fit a headline");
});
