// The Fighter Brain is what Coach and the debrief reason from, so anything wrong
// in here is wrong everywhere at once, quietly.
//
// Observed on the live app: an athlete with eleven logged sessions across three
// disciplines carried `disciplines: []` in his memory snapshot, because
// onboarding was the only source and he had skipped it. My Game could tell you
// "BJJ x7, Muay Thai x3, Wrestling x1" straight off the session rows while the
// brain feeding Coach believed it knew nothing about what he trains.

import assert from "node:assert/strict";
import test from "node:test";
import { disciplinesFromSessions, mergeDisciplines, isObservation } from "../lib/product-db.ts";

const SESSIONS = [
  ...Array.from({ length: 7 }, () => ({ discipline: "BJJ" })),
  ...Array.from({ length: 3 }, () => ({ discipline: "Muay Thai" })),
  { discipline: "Wrestling" },
];

test("what he trains is counted from what he logged", () => {
  assert.deepEqual(disciplinesFromSessions(SESSIONS), [
    { name: "BJJ", sessions: 7 },
    { name: "Muay Thai", sessions: 3 },
    { name: "Wrestling", sessions: 1 },
  ]);
});

test("the most trained discipline leads, because that is the part that changes an answer", () => {
  const [first] = disciplinesFromSessions(SESSIONS);
  assert.equal(first.name, "BJJ");
});

test("casing and spacing do not split one discipline into three", () => {
  const counted = disciplinesFromSessions([
    { discipline: "bjj" }, { discipline: "BJJ" }, { discipline: "  Bjj  " },
  ]);
  assert.equal(counted.length, 1);
  assert.equal(counted[0].sessions, 3);
});

test("blank and missing disciplines are skipped rather than counted as a sport", () => {
  assert.deepEqual(disciplinesFromSessions([{ discipline: "" }, { discipline: null }, {}]), []);
});

test("logged sessions lead, and anything named at setup but never trained still counts", () => {
  const logged = disciplinesFromSessions(SESSIONS);
  assert.deepEqual(mergeDisciplines(["Judo", "bjj"], logged), ["BJJ", "Muay Thai", "Wrestling", "Judo"]);
});

test("an athlete who only filled in the form keeps what they said", () => {
  assert.deepEqual(mergeDisciplines(["Boxing"], []), ["Boxing"]);
});

test("an observation has to say something happened, not name a technique", () => {
  // Both of these were sitting in the live Fighter Brain as observations.
  assert.equal(isObservation("Arm Drag"), false);
  assert.equal(isObservation("Did Ankle Locks"), false);
  // The athlete's own note read back to him is not an observation either.
  assert.equal(isObservation("Drilled the guard passing sequence"), false);
});

test("a real observation survives the bar", () => {
  assert.equal(isObservation("The support foot stopped turning once the pace went up"), true);
  assert.equal(isObservation("Guard retention held until the second round and then broke"), true);
  assert.equal(isObservation("You are working on kick form while hitting the bag"), true);
});
