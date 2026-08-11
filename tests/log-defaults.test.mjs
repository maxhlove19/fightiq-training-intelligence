// The log screen used to open on MMA with a wrestling example, for everybody.
//
// This is not cosmetic. The discipline is stored on the session and read back by
// every model call, so an athlete who does not notice a collapsed row files
// their Muay Thai night as MMA and gets coached on someone else's sport for it.

import assert from "node:assert/strict";
import test from "node:test";
import { disciplineFromSetup, notePlaceholder, sessionTypeFromSetup } from "../lib/log-defaults.ts";

test("the screen opens on the sport they said they train", () => {
  assert.equal(disciplineFromSetup(["Muay Thai"]), "Muay Thai");
  assert.equal(disciplineFromSetup(["BJJ"]), "BJJ");
  assert.equal(disciplineFromSetup(["Boxing"]), "Boxing");
  assert.equal(disciplineFromSetup(["Judo"]), "Judo");
});

test("the first discipline they listed wins", () => {
  // Somebody who trains both put one of them first, and that beats a default.
  assert.equal(disciplineFromSetup(["Muay Thai", "BJJ"]), "Muay Thai");
  assert.equal(disciplineFromSetup(["BJJ", "Muay Thai"]), "BJJ");
});

test("a discipline written loosely still lands somewhere sensible", () => {
  assert.equal(disciplineFromSetup(["muay thai"]), "Muay Thai");
  assert.equal(disciplineFromSetup(["Brazilian Jiu-Jitsu"]), "BJJ");
  assert.equal(disciplineFromSetup(["Kickboxing"]), "Kickboxing");
  assert.equal(disciplineFromSetup(["Freestyle wrestling"]), "Wrestling");
  assert.equal(disciplineFromSetup(["Mixed martial arts"]), "MMA");
});

test("an empty or unknown setup falls back rather than guessing wrong", () => {
  assert.equal(disciplineFromSetup([]), "MMA");
  assert.equal(disciplineFromSetup(["Sambo"]), "MMA");
});

test("a session type is only assumed when setup named exactly one", () => {
  assert.equal(sessionTypeFromSetup(["Sparring"]), "Sparring");
  // Three ticked boxes say nothing about tonight. Guessing from them is worse
  // than the honest default.
  assert.equal(sessionTypeFromSetup(["Class", "Sparring", "Open mat"]), "Class");
  assert.equal(sessionTypeFromSetup([]), "Class");
});

test("the example note is in their sport and shows the shape of a good one", () => {
  const muayThai = notePlaceholder("Muay Thai");
  assert.match(muayThai, /kick|clinch|pad/i);
  assert.doesNotMatch(muayThai, /double.?leg|wall wrestling/i);
  // What you worked on, what went wrong, what your coach said. The example is
  // the only place most people ever learn what a useful note looks like.
  assert.match(muayThai, /coach/i);
  assert.match(notePlaceholder("BJJ"), /guard|frame|roll/i);
  assert.match(notePlaceholder("Judo"), /grip|randori|uchi/i);
});

test("a discipline with no example still gets a usable prompt", () => {
  const other = notePlaceholder("Other");
  assert.ok(other.length > 20);
  assert.match(other, /coach/i);
});
