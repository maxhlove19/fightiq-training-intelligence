// The two ways this feature goes wrong.
//
// It never lands, and the athlete gets seven good questions and no answer. Or
// it lands too hard, writes something wrong into My Game, and shapes every week
// after it while the athlete has no reason to doubt it.

import assert from "node:assert/strict";
import test from "node:test";
import { COMMIT_BY_EXCHANGE, findingKey, findingSchema, readFinding } from "../lib/coach-finding.ts";

const good = { state: "proposed", problem: "Your grip peels off the collar", because: "The elbow drifts away from your ribs, so the forearm takes the load instead of the back.", fix: "Keep the elbow pinned to your ribs on the first grip.", basis: ["you said it peels rather than slips"], confidence: "likely" };

test("a probing turn proposes nothing", () => {
  // The common case. Most turns are still narrowing, and a card that appears
  // mid-narrowing is the coach interrupting itself.
  assert.equal(readFinding({ ...good, state: "probing" }), null);
  assert.equal(readFinding(null), null);
  assert.equal(readFinding("proposed"), null);
});

test("a finding without a fix is not a finding", () => {
  // A diagnosis nobody can act on is the exact thing this feature exists to
  // stop. Half a finding is worse than none, because it fills the card.
  assert.equal(readFinding({ ...good, fix: "" }), null);
  assert.equal(readFinding({ ...good, fix: "do it" }), null);
  assert.equal(readFinding({ ...good, because: "" }), null);
  assert.equal(readFinding({ ...good, problem: "" }), null);
});

test("a complete finding survives with its parts intact", () => {
  const finding = readFinding(good);
  assert.equal(finding.problem, "Your grip peels off the collar");
  assert.equal(finding.confidence, "likely");
  assert.deepEqual(finding.basis, ["you said it peels rather than slips"]);
});

test("confidence defaults down, never up", () => {
  // "Likely" claims their logged training agrees. Anything unrecognised must
  // not be allowed to claim that by accident.
  assert.equal(readFinding({ ...good, confidence: "hunch" }).confidence, "hunch");
  assert.equal(readFinding({ ...good, confidence: "" }).confidence, "hunch");
  assert.equal(readFinding({ ...good, confidence: "certain" }).confidence, "hunch");
  assert.equal(readFinding({ ...good, confidence: 1 }).confidence, "hunch");
});

test("basis is what it saw, bounded and never invented into a list", () => {
  const many = readFinding({ ...good, basis: ["one thing here", "two things here", "three things", "four things", "five things"] });
  assert.equal(many.basis.length, 4);
  assert.deepEqual(readFinding({ ...good, basis: "not an array" }).basis, []);
  assert.deepEqual(readFinding({ ...good, basis: ["x", "  "] }).basis, []);
});

test("the same problem said two ways is one problem", () => {
  // Without this, My Game fills with the same finding in slightly different
  // words every time it comes up.
  assert.equal(findingKey("My grip keeps peeling off"), findingKey("the grip peeled off"));
  assert.notEqual(findingKey("Your grip peels off"), findingKey("Your hips are late"));
  assert.ok(findingKey("!!!").length > 0, "a key is always produced, so nothing is silently unfilable");
});

test("the schema only lets the model say probing or proposed", () => {
  // Anything else and the commit decision stops being a decision.
  assert.deepEqual(findingSchema.properties.state.enum, ["probing", "proposed"]);
  assert.deepEqual(findingSchema.properties.confidence.enum, ["", "hunch", "likely"]);
  assert.equal(findingSchema.additionalProperties, false);
  for (const key of ["state", "problem", "because", "fix", "basis", "confidence"]) {
    assert.ok(findingSchema.required.includes(key), `${key} is optional, so the model can omit it`);
  }
});

test("the commit backstop is a ceiling somebody would actually hit", () => {
  // Not a target. The prompt commits far earlier, on whether the next answer
  // would change the advice. This only stops a thread running forever.
  assert.ok(COMMIT_BY_EXCHANGE >= 3 && COMMIT_BY_EXCHANGE <= 5, "too low interrupts good narrowing, too high is the bug");
});
