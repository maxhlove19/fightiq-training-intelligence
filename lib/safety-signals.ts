// A training app that reads what happened at practice and then tells a fighter
// what to drill next has one obligation before it says anything about
// technique: notice when the note describes a head knock or an injury, and
// stop recommending training.
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
  title: string;
  body: string;
  /** What to do now. Plain, ordered, actionable. */
  advice: string[];
  /** Signs that mean emergency care rather than a GP appointment. Head impacts only. */
  redFlags: string[];
  /** When true, FightIQ must not push a next-session drill off the back of this note. */
  holdTraining: boolean;
};

type Rule = { label: string; pattern: RegExp };

const rule = (label: string, source: string): Rule => ({ label, pattern: new RegExp(source, "i") });

// Said outright. No corroboration needed.
const HEAD_EXPLICIT: Rule[] = [
  rule("concussion", "\\bconcus(sion|sed)\\b"),
  rule("knocked out", "\\b(knocked out|got ko'?d|ko'?d me|kayo'?d)\\b"),
  rule("lost consciousness", "\\b(lost consciousness|passed out|went out cold|out cold)\\b"),
  rule("blacked out", "\\bblack(ed)? out\\b"),
  rule("saw stars", "\\b(saw stars|lights went out|vision went)\\b"),
  rule("can't remember", "\\b(can'?t|don'?t|couldn'?t) remember\\b"),
];

// Fight vernacular for taking a shot that landed. Written so the athlete has to
// be on the receiving end: "I dropped him" is a good round, not a head knock.
const HEAD_IMPACT: Rule[] = [
  rule("got rocked", "\\b(got|was|felt) (rocked|buzzed|stunned|wobbled|scrambled)\\b|\\brocked me\\b"),
  rule("got dropped", "\\b(got|was) dropped\\b|\\bdropped me\\b"),
  rule("got cracked", "\\b(got|was) (cracked|clipped|caught|tagged|smashed|rattled)\\b|\\b(cracked|clipped|tagged|caught) me\\b"),
  rule("head clash", "\\b(head ?butt|clash of heads|heads clashed|banged heads)\\b"),
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
  rule("heard a pop", "\\b(heard|felt) (a|it) (pop|snap|crack|tear|crunch)\\b|\\bpopped (out|my)\\b"),
  rule("joint gave way", "\\b(gave way|gave out|buckled|dislocat(ed|ion)|came out of (the|its) socket|subluxed)\\b"),
  rule("can't bear weight", "\\bcan'?t (put weight|bear weight|walk|stand)\\b|\\bcouldn'?t (put weight|bear weight|walk)\\b"),
  rule("numbness or tingling", "\\b(numb(ness)?|tingl(ing|y)|pins and needles|no feeling in)\\b"),
  rule("caught late in a submission", "\\b(tapped (late|too late)|didn'?t tap|got cranked|cranked (my|on my)|hyper ?extended|torqued)\\b"),
  rule("swelling", "\\b(swollen|swelling|ballooned up|puffed up)\\b"),
  rule("suspected break or tear", "\\b(broke|broken|fractur(e|ed)|torn|tore (my|a)|ruptur(e|ed))\\b"),
  rule("sharp pain", "\\bsharp pain\\b|\\bshooting pain\\b|\\bstabbing pain\\b"),
  rule("can't move it normally", "\\bcan'?t (straighten|bend|lift|rotate|move) (my|it)\\b"),
  rule("ribs", "\\b(rib|ribs)\\b[^.!?]{0,24}\\b(hurt|pain|sore|pop|crack|breath)\\b|\\bhard to breathe\\b"),
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

function matches(text: string, rules: Rule[]) {
  const found: string[] = [];
  for (const item of rules) {
    const hit = item.pattern.exec(text);
    if (!hit || isNegated(text, hit.index)) continue;
    found.push(item.label);
  }
  return found;
}

const HEAD_RED_FLAGS = [
  "A headache that keeps getting worse",
  "Being sick repeatedly",
  "A seizure or fit",
  "Weakness, numbness, or trouble walking, talking or seeing",
  "Getting more confused or drowsy, or being hard to wake",
  "Clear fluid or blood coming from the nose or ears",
  "Neck pain after the impact",
];

function list(items: string[]) {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const NONE: SafetySignal = { level: "none", matched: [], title: "", body: "", advice: [], redFlags: [], holdTraining: false };

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

  if (headFlagged) {
    const matched = [...explicit, ...impact, ...symptoms];
    return {
      level: "head_impact",
      matched,
      title: "Stop training and get your head checked",
      body: `You wrote about ${list(matched)}. That is how a head injury shows up, and no app — this one included — can tell the difference between a rattle and something that needs treating. FightIQ is holding your next session plan until a qualified person has looked at you.`,
      advice: [
        "Do not train, spar, roll or lift again today. Not even light rounds.",
        "Get seen by a doctor or another qualified medical professional before your next session, and follow what they tell you rather than how you feel.",
        "Tell your coach and someone at home what happened, so you are not the only person watching for it.",
        "Do not drive yourself anywhere while you feel off.",
        "Symptoms can arrive or get worse hours later. Treat tonight as part of the injury, not the end of it.",
      ],
      redFlags: HEAD_RED_FLAGS,
      holdTraining: true,
    };
  }

  const injury = matches(text, ACUTE_INJURY);
  if (injury.length) {
    return {
      level: "acute_injury",
      matched: injury,
      title: "Get this looked at before you load it again",
      body: `You wrote about ${list(injury)}. FightIQ cannot tell a tweak from a tear, and training through the second one is how fighters lose a season instead of a fortnight.`,
      advice: [
        "Stop loading it today, and do not test it in sparring to see how bad it is.",
        "Get it assessed if it is still painful, swollen or unstable tomorrow, if it gives way, or if you cannot move it or put weight on it normally.",
        "Log how it feels after a night's sleep. That comparison is worth more to a physio than a rating out of ten today.",
      ],
      redFlags: [],
      holdTraining: true,
    };
  }

  const load = matches(text, ILLNESS_OR_LOAD);
  if (load.length) {
    return {
      level: "illness_or_load",
      matched: load,
      title: "This is a day to train light or not at all",
      body: `You wrote about ${list(load)}. Sessions logged like this are where most injuries actually come from — the technique work below still stands, but the load should not.`,
      advice: [
        "Keep the next session technical: drilling and positional work, not hard rounds.",
        "If you are ill with a fever, or below the neck, sit it out completely.",
        "Sleep and food fix more of this than any session plan will.",
      ],
      redFlags: [],
      holdTraining: false,
    };
  }

  return NONE;
}
