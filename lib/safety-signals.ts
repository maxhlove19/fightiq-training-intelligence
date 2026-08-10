// A training app that reads what happened at practice and then tells a fighter
// what to drill has one obligation before it says anything about technique:
// notice when the note describes a head knock or an injury, and stop
// recommending training.
//
// This runs on the raw note, deterministically, before and independently of any
// model. A safety response must not depend on an API being reachable, a prompt
// being followed, or a schema validating. It never diagnoses — it recognises
// the words athletes actually use, says plainly that an app cannot judge them,
// and points at a qualified human.
//
// It is deliberately tuned to over-fire. A false positive costs one dismissible
// card. A false negative tells a concussed fighter to go and spar.

export type SafetyLevel = "head_impact" | "acute_injury" | "illness_or_load" | "none";

export type SafetySignal = {
  level: SafetyLevel;
  /** The phrases from the athlete's own note that triggered this, so the card can show its working. */
  matched: string[];
  eyebrow: string;
  title: string;
  body: string;
  /** What to do now. Plain, ordered, actionable. */
  advice: string[];
  redFlagsTitle: string;
  /** Signs that mean emergency care rather than an appointment. Head impacts only. */
  redFlags: string[];
  sourceNote: string;
  dismissLabel: string;
  /** When true, FightIQ must not push a next-session drill off the back of this note. */
  holdTraining: boolean;
};

type Rule = { label: string; pattern: RegExp; ambiguous?: boolean };

const rule = (label: string, source: string): Rule => ({ label, pattern: new RegExp(source, "i") });

/**
 * Fight vernacular that means "I took a shot" without saying where it landed.
 * "Got cracked" is a concussion in one note and a body kick in the next, so
 * these only count as a head impact when nothing in the sentence says otherwise.
 */
const loose = (label: string, source: string): Rule => ({ label, pattern: new RegExp(source, "i"), ambiguous: true });

// Said outright. No corroboration needed.
const HEAD_EXPLICIT: Rule[] = [
  rule("concussion", "\\bconcus(sion|sed)\\b"),
  rule("knocked out", "\\b(knocked out|got ko'?d|ko'?d me|kayo'?d)\\b"),
  rule("lost consciousness", "\\b(lost consciousness|passed out|went out cold|out cold)\\b"),
  rule("blacked out", "\\bblack(ed)? out\\b"),
  rule("saw stars", "\\b(saw stars|lights went out|vision went)\\b"),
  rule("can't remember", "\\b(can'?t|don'?t|couldn'?t)\\s+(\\w+\\s+)?remember\\b"),
];

// Fight vernacular for taking a shot that landed. Written so the athlete has to
// be on the receiving end: "I dropped him" is a good round, and so is "dei uma
// bomba nele".
const HEAD_IMPACT: Rule[] = [
  loose("got rocked", "\\b(got|was|felt) (rocked|buzzed|stunned|wobbled|scrambled)\\b|\\brocked me\\b"),
  loose("got dropped", "\\b(got|was) dropped\\b|\\bdropped me\\b"),
  loose("got cracked", "\\b(got|was) (cracked|clipped|caught|tagged|smashed|rattled)\\b|\\b(cracked|clipped|tagged|caught) me\\b"),
  rule("head clash", "\\b(head ?butt|clash(ed)? (of )?heads|heads clashed|banged heads)\\b"),
  rule("took a knock to the head", "\\b(shot|kick|knee|elbow|punch|hook|cross|uppercut|head kick|overhand)\\b[^.!?]{0,28}\\b(to|on|off) (my|the) (head|temple|jaw|chin|face|skull)\\b"),
  rule("hit my head", "\\b(hit|banged|bounced|cracked|whacked) (my|the back of my) (head|skull)\\b"),
  rule("slammed", "\\b(got|was) (slammed|spiked|dumped on my head)\\b"),
];

// Symptoms. One of these plus any striking or head context is enough; two of
// them is enough on their own.
const HEAD_SYMPTOM: Rule[] = [
  rule("dizzy", "\\b(dizzy|dizziness|light ?headed|room was spinning|spinning)\\b"),
  rule("headache", "\\b(headache|head is (banging|pounding|splitting)|pressure in my head)\\b"),
  rule("vision problems", "\\b(blurr?y|blurred|double) vision\\b|\\bseeing double\\b"),
  rule("nausea", "\\b(nausea|nauseous|felt sick|threw up|vomit(ed|ing)?|puked)\\b"),
  rule("ringing ears", "\\b(ringing|ears? (were )?ringing|tinnitus)\\b"),
  rule("foggy", "\\b(foggy|fuzzy|cloudy|out of it|not with it|felt weird after|felt off after)\\b"),
  rule("confusion", "\\b(confused|couldn'?t think|slow to react|slurr?(ed|ing)|couldn'?t focus)\\b"),
  rule("balance", "\\b(off balance|unsteady|stumbl(ed|ing)|legs went)\\b"),
  rule("light or noise sensitivity", "\\b(light hurt|sensitive to (light|noise)|bright lights)\\b"),
];

const HEAD_CONTEXT = /\b(head|skull|temple|jaw|chin|face|spar(ring|red)?|strik|punch|kick|elbow|knee|hook|cross|slam|takedown)/i;

const ACUTE_INJURY: Rule[] = [
  rule("heard a pop", "\\b(heard|felt) (a|it) (pop|snap|crack|tear|crunch)\\b|\\bpopped (out|in|my)\\b|\\b(something|it|my \\w+) (popped|snapped|gave)\\b"),
  rule("joint gave way", "\\b(gave way|gave out|buckled|dislocat(ed|ion)|came out of (the|its) socket|subluxed)\\b"),
  rule("can't bear weight", "\\bcan'?t (put weight|bear weight|walk|stand)\\b|\\bcouldn'?t (put weight|bear weight|walk)\\b"),
  rule("numbness or tingling", "\\b(numb(ness)?|tingl(ing|y)|pins and needles|no feeling in)\\b"),
  rule("caught late in a submission", "\\b(tapped (late|too late)|didn'?t tap|got cranked|cranked (my|on my)|hyper ?extended|torqued)\\b"),
  rule("swelling", "\\b(swollen|swelling|ballooned up|puffed up)\\b"),
  rule("suspected break or tear", "\\b(broke|broken|fractur(e|ed)|torn|tore (my|a)|ruptur(e|ed))\\b"),
  rule("sharp pain", "\\bsharp pain\\b|\\bshooting pain\\b|\\bstabbing pain\\b"),
  rule("can't move it normally", "\\bcan'?t (straighten|bend|lift|rotate|move) (my|it)\\b"),
  // Sore ribs after body sparring is a normal Tuesday. A rib that pops, cracks,
  // or makes breathing hurt is not.
  rule("ribs", "\\b(rib|ribs)\\b[^.!?]{0,24}\\b(pop|popped|crack|cracked|broke|broken|breath|breathe)\\b|\\b(hard|hurts|painful) to breathe\\b"),
];

const ILLNESS_OR_LOAD: Rule[] = [
  rule("illness", "\\b(fever|flu|sick|infection|chest infection|throat|covid)\\b"),
  rule("no sleep", "\\b(no sleep|haven'?t slept|barely slept|couldn'?t sleep|two hours(' )?sleep)\\b"),
  rule("exhaustion", "\\b(exhaust(ed|ion)|burnt? out|running on empty|wiped out|dead legs|overtrain(ed|ing))\\b"),
  rule("weight cut", "\\b(cutting weight|water cut|dehydrat(ed|ion)|not eating)\\b"),
];

const NEGATORS = /\b(no|not|never|without|didn'?t|don'?t|wasn'?t|weren'?t|isn'?t|nothing|zero|avoided?)\b/i;
const CONTRAST = /\b(but|though|however|although)\b|[;,]/i;

// "no headache" is a negation. "no pain in my knee but my head is banging" is
// not — a contrast word or a clause break ends the negator's reach.
function isNegated(text: string, index: number) {
  const window = text.slice(Math.max(0, index - 26), index);
  const clause = window.split(/[.!?]/).pop() ?? "";
  if (!NEGATORS.test(clause)) return false;
  const afterNegator = clause.slice(clause.search(NEGATORS));
  return !CONTRAST.test(afterNegator);
}

// Where the shot landed, when the note says. "Got cracked in the ribs" is a
// body shot; "caught me with a body kick" is a body shot; "got cracked" on its
// own stays a head impact, because the cost of being wrong runs one way.
const BODY_TARGET = /\b(rib|ribs|body|liver|solar plexus|stomach|gut|belly|leg|legs|thigh|calf|shin|knee|ankle|foot|arm|shoulder|hand|wrist|back|hip)\b/i;
const HEAD_TARGET = /\b(head|skull|temple|jaw|chin|face|nose|ear|eye|neck)\b/i;

// Athletes write notes as one long run-on line. A sentence is far too wide a
// window: "tweaked my knee, and got rocked in the last round" has a body part
// and a head impact in it, and they are not the same event. Clauses are.
const CLAUSE_BREAK = /[.!?,;]|\b(and|then|but|though|however|also|plus)\b/gi;

/**
 * True when the clause around an ambiguous hit names a body target and no head
 * target — "got cracked in the ribs". A bare "got cracked" names nothing and
 * stays a head impact, because the cost of being wrong runs one way.
 */
function landedOnTheBody(text: string, index: number) {
  let start = 0;
  let end = text.length;
  CLAUSE_BREAK.lastIndex = 0;
  for (let hit = CLAUSE_BREAK.exec(text); hit; hit = CLAUSE_BREAK.exec(text)) {
    if (hit.index + hit[0].length <= index) start = hit.index + hit[0].length;
    else { end = hit.index; break; }
  }
  const clause = text.slice(start, end);
  return BODY_TARGET.test(clause) && !HEAD_TARGET.test(clause);
}

function matches(text: string, rules: Rule[]): string[] {
  const found: string[] = [];
  for (const item of rules) {
    const hit = item.pattern.exec(text);
    if (!hit || isNegated(text, hit.index)) continue;
    if (item.ambiguous && landedOnTheBody(text, hit.index)) continue;
    found.push(item.label);
  }
  return found;
}

type Copy = {
  eyebrow: Record<Exclude<SafetyLevel, "none">, string>;
  redFlagsTitle: string;
  dismiss: string;
  source: (matched: string) => string;
  list: (items: string[]) => string;
  head: { title: string; body: (matched: string) => string; advice: string[]; redFlags: string[] };
  injury: { title: string; body: (matched: string) => string; advice: string[] };
  load: { title: string; body: (matched: string) => string; advice: string[] };
};

// All of the card's words live here rather than in the component, so the copy
// that matters most is reviewable in one place.
const COPY: Copy = {
  eyebrow: { head_impact: "STOP — READ THIS FIRST", acute_injury: "INJURY REPORTED", illness_or_load: "LOAD WARNING" },
  redFlagsTitle: "GO TO EMERGENCY CARE NOW IF ANY OF THIS HAPPENS",
  dismiss: "That is not what I meant — hide this",
  source: (matched) => `FightIQ is not a medical service and cannot assess you. This is general safety guidance, triggered by your own words: ${matched}.`,
  list: (items) => (items.length <= 1 ? items[0] ?? "" : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`),
  head: {
    title: "Stop training and get your head checked",
    body: (matched) => `You wrote about ${matched}. That is how a head injury shows up, and no app — this one included — can tell the difference between a rattle and something that needs treating. FightIQ is holding your next session plan until a qualified person has looked at you.`,
    advice: [
      "Do not train, spar, roll or lift again today. Not even light rounds.",
      "Get seen by a doctor or another qualified medical professional before your next session, and follow what they tell you rather than how you feel.",
      "Tell your coach and someone at home what happened, so you are not the only person watching for it.",
      "Do not drive yourself anywhere while you feel off.",
      "Symptoms can arrive or get worse hours later. Treat tonight as part of the injury, not the end of it.",
    ],
    redFlags: [
      "A headache that keeps getting worse",
      "Being sick repeatedly",
      "A seizure or fit",
      "Weakness, numbness, or trouble walking, talking or seeing",
      "Getting more confused or drowsy, or being hard to wake",
      "Clear fluid or blood coming from the nose or ears",
      "Neck pain after the impact",
    ],
  },
  injury: {
    title: "Get this looked at before you load it again",
    body: (matched) => `You wrote about ${matched}. FightIQ cannot tell a tweak from a tear, and training through the second one is how fighters lose a season instead of a fortnight.`,
    advice: [
      "Stop loading it today, and do not test it in sparring to see how bad it is.",
      "Get it assessed if it is still painful, swollen or unstable tomorrow, if it gives way, or if you cannot move it or put weight on it normally.",
      "Log how it feels after a night's sleep. That comparison is worth more to a physio than a rating out of ten today.",
    ],
  },
  load: {
    title: "This is a day to train light or not at all",
    body: (matched) => `You wrote about ${matched}. Sessions logged like this are where most injuries actually come from — the technique work below still stands, but the load should not.`,
    advice: [
      "Keep the next session technical: drilling and positional work, not hard rounds.",
      "If you are ill with a fever, or below the neck, sit it out completely.",
      "Sleep and food fix more of this than any session plan will.",
    ],
  },
};

const NONE: SafetySignal = {
  level: "none", matched: [], eyebrow: "", title: "", body: "",
  advice: [], redFlagsTitle: "", redFlags: [], sourceNote: "", dismissLabel: "", holdTraining: false,
};

export function scanTrainingNote(note: string): SafetySignal {
  const text = (note ?? "").toLowerCase();
  if (text.trim().length < 3) return NONE;

  const explicit = matches(text, HEAD_EXPLICIT);
  const impact = matches(text, HEAD_IMPACT);
  const symptoms = matches(text, HEAD_SYMPTOM);
  const headFlagged = explicit.length > 0
    || impact.length > 0
    || symptoms.length >= 2
    || (symptoms.length === 1 && HEAD_CONTEXT.test(text));

  const build = (level: Exclude<SafetyLevel, "none">, labels: string[], holdTraining: boolean): SafetySignal => {
    const copy = COPY;
    const pack = level === "head_impact" ? copy.head : level === "acute_injury" ? copy.injury : copy.load;
    const redFlags = level === "head_impact" ? copy.head.redFlags : [];
    return {
      level,
      matched: labels,
      eyebrow: copy.eyebrow[level],
      title: pack.title,
      body: pack.body(copy.list(labels)),
      advice: pack.advice,
      redFlagsTitle: redFlags.length ? copy.redFlagsTitle : "",
      redFlags,
      sourceNote: copy.source(labels.join(", ")),
      dismissLabel: copy.dismiss,
      holdTraining,
    };
  };

  if (headFlagged) return build("head_impact", [...explicit, ...impact, ...symptoms], true);

  const injury = matches(text, ACUTE_INJURY);
  if (injury.length) return build("acute_injury", injury, true);

  const load = matches(text, ILLNESS_OR_LOAD);
  if (load.length) return build("illness_or_load", load, false);

  return NONE;
}
