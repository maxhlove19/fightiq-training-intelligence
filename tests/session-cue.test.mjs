// The cue is the most-read line in the app. A striker used to fall through to
// "Pick one detail to pay attention to" on almost every session, so the thing
// worth testing is coverage of the vocabulary athletes actually write.

import assert from "node:assert/strict";
import test from "node:test";
import { cueForMission, sessionCue } from "../lib/session-cue.ts";

test("the sport this app is mostly used for is covered", () => {
  const striking = [
    "Keep the support foot pivoting on the switch kick",
    "Stop dropping the lead hand when I kick",
    "Land the teep to control distance",
    "Check low kicks earlier",
    "Get inside position in the clinch",
    "Stop standing square",
    "Work the body before going upstairs",
    "Counter on the way out instead of trading",
    "Cut angles instead of walking straight forward",
    "Win the outside foot against southpaws",
  ];
  for (const mission of striking) {
    const result = cueForMission(mission);
    assert.notEqual(result, "", `no cue for: ${mission}`);
    assert.ok(result.length <= 60, `cue too long to hold onto: ${result}`);
  }
});

test("grappling did not regress when striking was added", () => {
  assert.match(cueForMission("Hit the arm drag to take the back"), /Drag/);
  assert.match(cueForMission("Keep frames when he passes"), /Frames first/);
  assert.match(cueForMission("Finish the double leg"), /Level change/);
});

test("every cue is a trigger and a response, not a slogan", () => {
  const missions = [
    "switch kick", "teep", "clinch", "low kick", "jab", "angles", "defence",
    "arm drag", "guard retention", "conditioning", "elbows", "feints",
  ];
  for (const mission of missions) {
    const result = cueForMission(mission);
    assert.notEqual(result, "", mission);
    assert.match(result, /→/, `${mission} produced a cue with no action: ${result}`);
  }
});

test("cues are distinct enough to be worth reading twice", () => {
  const missions = ["switch kick", "teep", "clinch", "jab", "angles", "arm drag", "passing", "escapes"];
  const produced = missions.map((mission) => cueForMission(mission));
  assert.equal(new Set(produced).size, produced.length, "two different problems produced the same cue");
});

test("the specific beats the general", () => {
  // "Low kick" must not be swallowed by the bare "kick" rule.
  assert.notEqual(cueForMission("Land the low kick"), cueForMission("Land the kick"));
  assert.match(cueForMission("Land the low kick"), /above the knee/);
});

test("an unmatched mission names the athlete's own focus instead of shrugging", () => {
  const result = sessionCue("Stay calmer when the round speeds up");
  assert.match(result, /One thing tonight/);
  assert.match(result, /calmer/);
  assert.doesNotMatch(result, /Pick one detail to pay attention to/);
});

test("a long mission is trimmed without cutting a word in half", () => {
  const result = sessionCue("Remember everything my coach told me on Tuesday about staying calm and relaxed the whole way through");
  assert.ok(result.length < 90, result);
  assert.match(result, /…\.$/);
  assert.doesNotMatch(result, /calm[a-z]*…/);
  assert.doesNotMatch(result, /\s…/);
});

test("an empty or junk mission never invents coaching advice", () => {
  for (const mission of ["", "  ", "a", undefined]) {
    assert.equal(cueForMission(mission), "");
    assert.equal(sessionCue(mission), "Pick one detail and watch it all session.");
  }
});

test("day one names something from the sport the athlete actually trains", async () => {
  const { startingFocus } = await import("../lib/session-cue.ts");
  assert.match(startingFocus(["Muay Thai"]), /guard and a distance/);
  assert.match(startingFocus(["BJJ"]), /guard you can keep/);
  assert.match(startingFocus(["Boxing"]), /jab/);
  // Whatever it says, the cue built from it has to be a real cue.
  for (const discipline of ["Muay Thai", "Kickboxing", "Boxing", "BJJ", "Wrestling", "Judo", "MMA", "Other"]) {
    const focus = startingFocus([discipline]);
    assert.ok(focus.length > 10, discipline);
    assert.doesNotMatch(sessionCue(focus), /Pick one detail and watch it all session/, discipline);
  }
});

test("kick defence gets the defensive cue, not the offensive one", () => {
  assert.match(cueForMission("sharper kick defence"), /Shin up early/);
  assert.match(cueForMission("land the switch kick"), /support foot/);
});
