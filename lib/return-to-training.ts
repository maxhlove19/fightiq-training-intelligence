// What happens after FightIQ reads a head knock or an injury in a training note.
//
// The scanner in safety-signals.ts notices. This decides what the app does about
// it for the next week — because a card that can be dismissed and forgotten is
// not a hold, it is a disclaimer.
//
// The shape of the ladder is the graduated return-to-sport strategy used across
// sport: rest, then light aerobic work, then sport-specific movement, then full
// non-contact training, and only then contact — a minimum of 24 hours at each
// step, back a step if symptoms come back, and a qualified professional's
// clearance before anything with contact in it.
//
// FightIQ does not clear anyone. It cannot examine you, it does not know what a
// doctor said, and it will believe whatever you tell it. What it can do is
// refuse to hand you a sparring drill two days after you wrote "got rocked,
// still foggy", keep the clock honestly, and hold the last step shut until you
// have told it in as many words that a professional cleared you. Combat sports
// commissions also impose fixed no-contact suspensions after a knockout; those
// are longer than this ladder and they override it.

export type HoldReason = "head_impact" | "acute_injury";

export type Stage = {
  key: string;
  /** 1-based, and shown to the athlete as "step 3 of 6". */
  step: number;
  title: string;
  /** What this step is for, in one line. */
  goal: string;
  /** What this step permits. Written so it can be read at the gym door. */
  allowed: string[];
  notAllowed: string[];
  /** Hours at this step before the next one can be unlocked. */
  minHours: number;
  /** True where a professional has to have said yes before this step opens. */
  requiresMedicalClearance: boolean;
  /** True once training partners are hitting back. */
  isContact: boolean;
  /** True once working on technique is useful again — the point a drill recommendation stops being reckless. */
  allowsSkillWork: boolean;
};

const HEAD_LADDER: Stage[] = [
  {
    key: "rest", step: 1, title: "Off the mats",
    goal: "Let the symptoms settle, and get looked at by someone qualified.",
    allowed: ["Walking", "Daily life, as long as it does not bring symptoms on"],
    notAllowed: ["Training of any kind", "Lifting", "Anything that makes the symptoms worse"],
    minHours: 24, requiresMedicalClearance: false, isContact: false, allowsSkillWork: false,
  },
  {
    key: "light", step: 2, title: "Light movement",
    goal: "Easy aerobic work. You should be able to hold a conversation.",
    allowed: ["Walking or a stationary bike, 10–15 minutes", "Easy, steady, nothing sharp"],
    notAllowed: ["The gym floor", "Resistance training", "Anything with your head moving fast"],
    minHours: 24, requiresMedicalClearance: false, isContact: false, allowsSkillWork: false,
  },
  {
    key: "sport", step: 3, title: "Your sport, on your own",
    goal: "Movement that looks like training, with nobody near you.",
    allowed: ["Shadow boxing", "Footwork", "Bag work at an easy pace", "Solo drilling"],
    notAllowed: ["Partner drills", "Anything you can be hit in", "Hard rounds"],
    minHours: 24, requiresMedicalClearance: false, isContact: false, allowsSkillWork: true,
  },
  {
    key: "drills", step: 4, title: "Full training, no contact",
    goal: "Back in the room, in everything except being hit.",
    allowed: ["Partner drilling at a controlled pace", "Pad work", "Normal conditioning and lifting"],
    notAllowed: ["Sparring of any intensity", "Live rounds", "Hard positional work to the head"],
    minHours: 24, requiresMedicalClearance: false, isContact: false, allowsSkillWork: true,
  },
  {
    key: "contact", step: 5, title: "Full contact",
    goal: "Normal training, sparring included. This step does not open on its own.",
    allowed: ["Sparring", "Live rounds", "Everything you did before"],
    notAllowed: ["Competing, until you have done a full week of this without symptoms"],
    minHours: 168, requiresMedicalClearance: true, isContact: true, allowsSkillWork: true,
  },
  {
    key: "competition", step: 6, title: "Competition",
    goal: "Back to normal, including fighting.",
    allowed: ["Everything"],
    notAllowed: [],
    minHours: 0, requiresMedicalClearance: true, isContact: true, allowsSkillWork: true,
  },
];

const INJURY_LADDER: Stage[] = [
  {
    key: "rest", step: 1, title: "Off it",
    goal: "Stop loading the injury and get it looked at by someone qualified.",
    allowed: ["Whatever does not involve the injured part", "Rest"],
    notAllowed: ["Training through it", "Testing it to see how bad it is"],
    minHours: 24, requiresMedicalClearance: false, isContact: false, allowsSkillWork: false,
  },
  {
    key: "rehab", step: 2, title: "Cleared, and building back",
    goal: "What the person who assessed you told you to do, at the pace they set.",
    allowed: ["The rehab you were given", "Training that leaves the injury alone"],
    notAllowed: ["Rounds that put it under load", "Anything sharp or unplanned"],
    minHours: 72, requiresMedicalClearance: true, isContact: false, allowsSkillWork: true,
  },
  {
    key: "full", step: 3, title: "Full training",
    goal: "Back to everything, and watching for it to speak up.",
    allowed: ["Everything"],
    notAllowed: [],
    minHours: 0, requiresMedicalClearance: true, isContact: true, allowsSkillWork: true,
  },
];

export function ladderFor(reason: HoldReason): Stage[] {
  return reason === "head_impact" ? HEAD_LADDER : INJURY_LADDER;
}

export type Hold = {
  id: string;
  reason: HoldReason;
  /** The note that opened this, so the athlete can see what FightIQ read. */
  entryId: string | null;
  matched: string[];
  openedAt: string;
  step: number;
  stepEnteredAt: string;
  medicalClearedAt: string | null;
  clearedAt: string | null;
  /** Why it closed: walked off, or opened on a note the scanner misread. */
  clearedReason: ClearedReason | null;
  /** How many times symptoms sent them back a step. Two is a reason to go back to a doctor. */
  setbacks: number;
};

export type HoldAction =
  | { type: "advance"; symptomFree: boolean }
  | { type: "setback" }
  | { type: "record_medical_clearance" }
  | { type: "close" }
  /** The scanner read the note wrong. Nothing happened, and the hold should never have opened. */
  | { type: "dismiss" };

export type ClearedReason = "completed" | "misread";

export type HoldView = {
  open: boolean;
  reason: HoldReason;
  stage: Stage;
  nextStage: Stage | null;
  totalSteps: number;
  /** Whole days since the note that opened this. */
  daysHeld: number;
  /** Hours left at this step before the next one can be unlocked. 0 when eligible. */
  hoursRemaining: number;
  canAdvance: boolean;
  /** Everything standing between the athlete and the next step, in plain words. */
  blockers: string[];
  needsMedicalClearance: boolean;
  /** The three questions the rest of the app asks before recommending anything. */
  allowsTraining: boolean;
  allowsSkillWork: boolean;
  allowsContact: boolean;
  eyebrow: string;
  title: string;
  body: string;
  advanceLabel: string;
  setbackLabel: string;
  /** Shown when the same hold has sent them backwards more than once. */
  escalation: string;
  footnote: string;
  /** The way out when the scanner was simply wrong, and what the athlete has to confirm to take it. */
  dismissLabel: string;
  dismissTitle: string;
  dismissBody: string;
  dismissChecklist: string[];
  dismissConfirmLabel: string;
};

const HOUR = 3600_000;

function toTime(value: string | Date): number {
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : Number.NaN;
}

/** Hours between two instants, never negative — a clock that went backwards is not credit. */
function hoursBetween(from: string, to: string | Date): number {
  const start = toTime(from);
  const end = toTime(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, (end - start) / HOUR);
}

export function openHold(input: { id: string; reason: HoldReason; entryId?: string | null; matched?: string[]; now: string | Date }): Hold {
  const at = new Date(toTime(input.now)).toISOString();
  return {
    id: input.id,
    reason: input.reason,
    entryId: input.entryId ?? null,
    matched: input.matched ?? [],
    openedAt: at,
    step: 1,
    stepEnteredAt: at,
    medicalClearedAt: null,
    clearedAt: null,
    clearedReason: null,
    setbacks: 0,
  };
}

const ADVANCE_LABEL: Record<string, string> = {
  rest: "I HAVE HAD 24 SYMPTOM-FREE HOURS",
  light: "LIGHT MOVEMENT BROUGHT NOTHING ON",
  sport: "SOLO WORK BROUGHT NOTHING ON",
  drills: "FULL TRAINING BROUGHT NOTHING ON",
  contact: "A FULL WEEK OF CONTACT, NO SYMPTOMS",
  rehab: "IT HELD UP THROUGH THE REHAB",
};

export function describeHold(hold: Hold, now: string | Date): HoldView {
  const ladder = ladderFor(hold.reason);
  const index = Math.min(Math.max(hold.step, 1), ladder.length) - 1;
  const stage = ladder[index];
  const nextStage = ladder[index + 1] ?? null;
  const head = hold.reason === "head_impact";
  const elapsed = hoursBetween(hold.stepEnteredAt, now);
  const hoursRemaining = Math.max(0, Math.ceil(stage.minHours - elapsed));
  const needsMedicalClearance = Boolean(nextStage?.requiresMedicalClearance) && !hold.medicalClearedAt;

  const blockers: string[] = [];
  if (nextStage && hoursRemaining > 0) {
    blockers.push(hoursRemaining >= 24
      ? `${Math.ceil(hoursRemaining / 24)} more day${Math.ceil(hoursRemaining / 24) === 1 ? "" : "s"} at this step.`
      : `${hoursRemaining} more hour${hoursRemaining === 1 ? "" : "s"} at this step.`);
  }
  if (needsMedicalClearance) {
    blockers.push(head
      ? "A doctor has to clear you before contact. FightIQ cannot do that part."
      : "Whoever assessed the injury has to say you can load it again.");
  }
  if (!nextStage) blockers.push("You are at the last step. Close the hold when you are back to normal.");

  const escalation = hold.setbacks >= 2
    ? "Symptoms have come back twice now. That is the point where this stops being something to manage on your own — go back to the person who assessed you."
    : "";

  return {
    open: !hold.clearedAt,
    reason: hold.reason,
    stage,
    nextStage,
    totalSteps: ladder.length,
    daysHeld: Math.floor(hoursBetween(hold.openedAt, now) / 24),
    hoursRemaining,
    canAdvance: Boolean(nextStage) && hoursRemaining === 0 && !needsMedicalClearance,
    blockers,
    needsMedicalClearance,
    // Step 1 is off the mats entirely. The other two come from the stage itself.
    allowsTraining: stage.step > 1,
    allowsSkillWork: stage.allowsSkillWork,
    allowsContact: stage.isContact,
    eyebrow: head ? "RETURN TO TRAINING" : "INJURY HOLD",
    title: `Step ${stage.step} of ${ladder.length} · ${stage.title}`,
    body: stage.goal,
    advanceLabel: ADVANCE_LABEL[stage.key] ?? "MOVE TO THE NEXT STEP",
    setbackLabel: head ? "Symptoms came back" : "It flared up again",
    escalation,
    dismissLabel: "FightIQ read this wrong",
    dismissTitle: head ? "Did any of this actually happen?" : "Did you actually hurt something?",
    dismissBody: head
      ? "FightIQ opened this by reading your own words, and it would rather be wrong this way round than the other. If none of the below is true, clear it and carry on — it will not hold it against you."
      : "FightIQ opened this from your note. If nothing is actually hurt, clear it and carry on.",
    dismissChecklist: head
      ? [
        "A shot, a fall or a clash landed on your head",
        "You were dazed, wobbled, or lost track of a moment",
        "A headache, nausea, ringing, fogginess or dizziness since training",
        "Anyone there thought you looked out of it",
      ]
      : [
        "Something is painful to load, or you are working around it",
        "A pop, a give, swelling, or pain that is not ordinary soreness",
      ],
    dismissConfirmLabel: head ? "NONE OF THAT HAPPENED — CLEAR IT" : "NOTHING IS HURT — CLEAR IT",
    footnote: head
      ? "This is the standard stepwise return used in sport, kept on your phone. It is not a medical assessment and FightIQ is not a doctor. If a commission has suspended you, that suspension is longer than this and it is the one that counts."
      : "FightIQ is not a doctor and has not seen the injury. This keeps the clock; the person who assessed you sets the pace.",
  };
}

export type HoldResult = { hold: Hold; changed: boolean; error: string };

/**
 * The only way a hold moves. Every guard that matters lives here rather than in
 * a button's disabled attribute, so a replayed request cannot skip a step.
 */
export function applyHoldAction(hold: Hold, action: HoldAction, now: string | Date): HoldResult {
  const at = new Date(toTime(now)).toISOString();
  const unchanged = (error = "") => ({ hold, changed: false, error });
  if (hold.clearedAt) return unchanged("This hold is already closed.");

  const ladder = ladderFor(hold.reason);
  const view = describeHold(hold, now);

  if (action.type === "record_medical_clearance") {
    if (hold.medicalClearedAt) return unchanged();
    return { hold: { ...hold, medicalClearedAt: at }, changed: true, error: "" };
  }

  if (action.type === "setback") {
    // Back a step, and the clock starts again. Medical clearance is not revoked:
    // the appointment happened, and asking someone to go twice to prove it does
    // nothing except teach them to lie to the app.
    const step = Math.max(1, hold.step - 1);
    return { hold: { ...hold, step, stepEnteredAt: at, setbacks: hold.setbacks + 1 }, changed: true, error: "" };
  }

  if (action.type === "dismiss") {
    // Available at any point, deliberately. A hold that cannot be released when
    // the scanner is wrong teaches athletes to stop writing honest notes, and
    // that costs far more safety than it buys.
    return { hold: { ...hold, clearedAt: at, clearedReason: "misread" }, changed: true, error: "" };
  }

  if (action.type === "close") {
    if (view.stage.step < ladder.length) return unchanged("You are not at the last step yet.");
    return { hold: { ...hold, clearedAt: at, clearedReason: "completed" }, changed: true, error: "" };
  }

  if (!action.symptomFree) return unchanged("Advancing a step means the last one brought nothing on. Use the setback option instead.");
  if (!view.nextStage) return unchanged("You are at the last step.");
  if (view.hoursRemaining > 0) return unchanged(view.blockers[0] ?? "Not enough time at this step yet.");
  if (view.needsMedicalClearance) return unchanged("Record the clearance from whoever assessed you first.");
  return { hold: { ...hold, step: hold.step + 1, stepEnteredAt: at }, changed: true, error: "" };
}

/**
 * What the rest of the app asks before it recommends training. A closed hold, or
 * no hold at all, blocks nothing.
 */
export function trainingPermission(hold: Hold | null, now: string | Date): { allowsTraining: boolean; allowsSkillWork: boolean; allowsContact: boolean; reason: string } {
  if (!hold || hold.clearedAt) return { allowsTraining: true, allowsSkillWork: true, allowsContact: true, reason: "" };
  const view = describeHold(hold, now);
  return {
    allowsTraining: view.allowsTraining,
    allowsSkillWork: view.allowsSkillWork,
    allowsContact: view.allowsContact,
    reason: view.allowsContact ? "" : `${view.title} — FightIQ is not recommending ${view.allowsTraining ? "contact" : "training"} while this is open.`,
  };
}

/** Does what the athlete just wrote describe a session this hold does not allow? */
export function sessionConflictsWithHold(hold: Hold | null, sessionPlan: string, now: string | Date): string {
  if (!hold || hold.clearedAt) return "";
  const permission = trainingPermission(hold, now);
  if (permission.allowsContact) return "";
  const plan = sessionPlan.toLowerCase();
  const contact = /\bspar|rolling|roll\b|live|hard round|competition|comp\b|fight|smoker|shark tank|king of the (hill|mat)|wrestl(e|ing) live/.test(plan);
  if (!permission.allowsTraining) return permission.reason;
  if (contact) return permission.reason;
  return "";
}
