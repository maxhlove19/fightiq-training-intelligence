// The hold is the one part of this app where a bug has a consequence that is
// not a bad drill recommendation. Every guard is tested from the outside: given
// a hold and a clock, what does the app allow?

import assert from "node:assert/strict";
import test from "node:test";
import {
  applyHoldAction, describeHold, ladderFor, openHold, sessionConflictsWithHold, trainingPermission,
} from "../lib/return-to-training.ts";

const START = "2026-03-01T18:00:00.000Z";
const hoursAfter = (iso, hours) => new Date(Date.parse(iso) + hours * 3600_000).toISOString();

function newHold(reason = "head_impact") {
  return openHold({ id: "hold-1", reason, entryId: "entry-1", matched: ["got rocked"], now: START });
}

/** Walk a hold up the ladder, honestly, waiting out every clock. */
function climb(hold, { clearance = true } = {}) {
  let current = hold;
  let clock = START;
  for (let guard = 0; guard < 20; guard += 1) {
    const view = describeHold(current, clock);
    if (!view.nextStage) return { hold: current, clock };
    clock = hoursAfter(clock, view.stage.minHours);
    if (view.needsMedicalClearance && clearance) {
      current = applyHoldAction(current, { type: "record_medical_clearance" }, clock).hold;
    }
    const result = applyHoldAction(current, { type: "advance", symptomFree: true }, clock);
    if (!result.changed) return { hold: current, clock, blocked: result.error };
    current = result.hold;
  }
  throw new Error("ladder did not terminate");
}

test("a new hold starts off the mats, and says so", () => {
  const view = describeHold(newHold(), START);
  assert.equal(view.open, true);
  assert.equal(view.stage.step, 1);
  assert.equal(view.allowsTraining, false);
  assert.equal(view.allowsContact, false);
  assert.match(view.title, /Step 1 of 6/);
});

test("the next step will not open before the clock has run", () => {
  const hold = newHold();
  const view = describeHold(hold, hoursAfter(START, 6));
  assert.equal(view.canAdvance, false);
  assert.equal(view.hoursRemaining, 18);
  assert.match(view.blockers[0], /18 more hours/);

  const refused = applyHoldAction(hold, { type: "advance", symptomFree: true }, hoursAfter(START, 6));
  assert.equal(refused.changed, false);
  assert.equal(refused.hold.step, 1);
  assert.match(refused.error, /18 more hours/);
});

test("24 clean hours opens exactly one step, not the ladder", () => {
  const hold = newHold();
  const result = applyHoldAction(hold, { type: "advance", symptomFree: true }, hoursAfter(START, 24));
  assert.equal(result.changed, true);
  assert.equal(result.hold.step, 2);
  // The clock restarts. Waiting a week at step 1 does not buy a week at step 2.
  assert.equal(describeHold(result.hold, hoursAfter(START, 24)).hoursRemaining, 24);
});

test("saying the symptoms are still there never advances anything", () => {
  const result = applyHoldAction(newHold(), { type: "advance", symptomFree: false }, hoursAfter(START, 240));
  assert.equal(result.changed, false);
  assert.equal(result.hold.step, 1);
  assert.match(result.error, /setback/i);
});

test("contact does not open without a recorded clearance, however long you wait", () => {
  const { hold, blocked } = climb(newHold(), { clearance: false });
  const view = describeHold(hold, hoursAfter(START, 24 * 60));
  assert.equal(view.stage.key, "drills");
  assert.equal(view.allowsContact, false);
  assert.equal(view.canAdvance, false);
  assert.equal(view.needsMedicalClearance, true);
  assert.match(blocked ?? "", /clearance/i);
  assert.ok(view.blockers.some((entry) => /doctor has to clear you/.test(entry)));
});

test("with a clearance recorded, the whole ladder can be walked", () => {
  const { hold } = climb(newHold());
  const view = describeHold(hold, hoursAfter(START, 24 * 60));
  assert.equal(view.stage.key, "competition");
  assert.equal(view.allowsContact, true);
  assert.equal(view.nextStage, null);
});

test("the fastest honest route back to sparring is not a couple of days", () => {
  const { hold, clock } = climb(newHold());
  const daysToContact = describeHold(hold, clock).daysHeld;
  assert.ok(daysToContact >= 4, `expected at least four days before contact, got ${daysToContact}`);
});

test("symptoms coming back drops a step and restarts the clock", () => {
  let hold = applyHoldAction(newHold(), { type: "advance", symptomFree: true }, hoursAfter(START, 24)).hold;
  hold = applyHoldAction(hold, { type: "advance", symptomFree: true }, hoursAfter(START, 48)).hold;
  assert.equal(hold.step, 3);

  const back = applyHoldAction(hold, { type: "setback" }, hoursAfter(START, 60));
  assert.equal(back.changed, true);
  assert.equal(back.hold.step, 2);
  assert.equal(back.hold.setbacks, 1);
  assert.equal(describeHold(back.hold, hoursAfter(START, 60)).hoursRemaining, 24);
});

test("a setback at the first step cannot push the step below one", () => {
  const back = applyHoldAction(newHold(), { type: "setback" }, hoursAfter(START, 2));
  assert.equal(back.hold.step, 1);
  assert.equal(back.hold.setbacks, 1);
});

test("two setbacks stops being something the app manages", () => {
  let hold = applyHoldAction(newHold(), { type: "setback" }, hoursAfter(START, 2)).hold;
  hold = applyHoldAction(hold, { type: "setback" }, hoursAfter(START, 4)).hold;
  assert.match(describeHold(hold, hoursAfter(START, 4)).escalation, /go back to the person who assessed you/);
});

test("a recorded clearance survives a setback, because the appointment still happened", () => {
  let hold = applyHoldAction(newHold(), { type: "record_medical_clearance" }, hoursAfter(START, 3)).hold;
  hold = applyHoldAction(hold, { type: "setback" }, hoursAfter(START, 4)).hold;
  assert.ok(hold.medicalClearedAt);
});

test("the hold only closes at the top of the ladder", () => {
  const early = applyHoldAction(newHold(), { type: "close" }, hoursAfter(START, 24 * 30));
  assert.equal(early.changed, false);
  assert.match(early.error, /not at the last step/);

  const { hold, clock } = climb(newHold());
  const closed = applyHoldAction(hold, { type: "close" }, clock);
  assert.equal(closed.changed, true);
  assert.ok(closed.hold.clearedAt);
  assert.equal(describeHold(closed.hold, clock).open, false);
});

test("a closed hold stops blocking anything", () => {
  const { hold, clock } = climb(newHold());
  const closed = applyHoldAction(hold, { type: "close" }, clock).hold;
  const permission = trainingPermission(closed, clock);
  assert.deepEqual(permission, { allowsTraining: true, allowsSkillWork: true, allowsContact: true, reason: "" });
  assert.equal(applyHoldAction(closed, { type: "advance", symptomFree: true }, clock).changed, false);
});

test("no hold at all permits everything", () => {
  assert.deepEqual(trainingPermission(null, START), { allowsTraining: true, allowsSkillWork: true, allowsContact: true, reason: "" });
  assert.equal(sessionConflictsWithHold(null, "Sparring", START), "");
});

test("a held athlete typing 'sparring' is told, and typing 'yoga' is not", () => {
  // Step 4: full training is fine, contact is not.
  let hold = newHold();
  for (let step = 0; step < 3; step += 1) {
    hold = applyHoldAction(hold, { type: "advance", symptomFree: true }, hoursAfter(START, 24 * (step + 1))).hold;
  }
  const clock = hoursAfter(START, 24 * 4);
  assert.equal(describeHold(hold, clock).stage.key, "drills");
  assert.match(sessionConflictsWithHold(hold, "Hard sparring tonight", clock), /not recommending contact/);
  assert.match(sessionConflictsWithHold(hold, "open mat, rolling", clock), /not recommending contact/);
  assert.equal(sessionConflictsWithHold(hold, "Pad work and conditioning", clock), "");
});

test("at step one, every session conflicts — including the harmless-sounding ones", () => {
  const hold = newHold();
  assert.match(sessionConflictsWithHold(hold, "Muay Thai class", START), /not recommending training/);
  assert.match(sessionConflictsWithHold(hold, "light technique only", START), /not recommending training/);
});

test("an injury hold is a shorter ladder that still needs a professional", () => {
  const hold = newHold("acute_injury");
  const view = describeHold(hold, START);
  assert.equal(view.totalSteps, 3);
  assert.equal(view.eyebrow, "INJURY HOLD");
  assert.equal(view.needsMedicalClearance, true);
  assert.equal(applyHoldAction(hold, { type: "advance", symptomFree: true }, hoursAfter(START, 48)).changed, false);

  const cleared = applyHoldAction(hold, { type: "record_medical_clearance" }, hoursAfter(START, 24)).hold;
  const moved = applyHoldAction(cleared, { type: "advance", symptomFree: true }, hoursAfter(START, 48));
  assert.equal(moved.changed, true);
  assert.equal(moved.hold.step, 2);
});

test("technique work only unlocks once there is technique work to do", () => {
  // A drill recommendation at step 1 is the app telling a concussed athlete to
  // go and practise. Solo work at step 3 is the first point it is useful again.
  const hold = newHold();
  assert.equal(describeHold(hold, START).allowsSkillWork, false);
  const moved = applyHoldAction(hold, { type: "advance", symptomFree: true }, hoursAfter(START, 24)).hold;
  assert.equal(describeHold(moved, hoursAfter(START, 24)).allowsSkillWork, false);
  const solo = applyHoldAction(moved, { type: "advance", symptomFree: true }, hoursAfter(START, 48)).hold;
  assert.equal(describeHold(solo, hoursAfter(START, 48)).allowsSkillWork, true);
});

test("every stage on every ladder is readable at the gym door", () => {
  for (const reason of ["head_impact", "acute_injury"]) {
    for (const stage of ladderFor(reason)) {
      assert.ok(stage.title.length > 2, `${reason} step ${stage.step} has no title`);
      assert.ok(stage.goal.length > 10, `${reason} step ${stage.step} has no goal`);
      assert.ok(stage.allowed.length > 0, `${reason} step ${stage.step} says nothing you can do`);
    }
  }
});

test("a clock that runs backwards buys no credit", () => {
  const hold = newHold();
  const view = describeHold(hold, hoursAfter(START, -500));
  assert.equal(view.hoursRemaining, 24);
  assert.equal(view.daysHeld, 0);
  assert.equal(applyHoldAction(hold, { type: "advance", symptomFree: true }, hoursAfter(START, -500)).changed, false);
});

test("an unparseable timestamp does not accidentally clear anyone", () => {
  const hold = { ...newHold(), stepEnteredAt: "not a date" };
  assert.equal(describeHold(hold, START).canAdvance, false);
  assert.equal(applyHoldAction(hold, { type: "advance", symptomFree: true }, START).changed, false);
});

test("a step number outside the ladder is clamped rather than crashing", () => {
  for (const step of [0, -3, 99]) {
    const view = describeHold({ ...newHold(), step }, START);
    assert.ok(view.stage, `step ${step} produced no stage`);
    assert.ok(view.stage.step >= 1 && view.stage.step <= view.totalSteps);
  }
});
