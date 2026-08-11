// What FightIQ says to somebody who has just finished setup and logged nothing.
//
// This is the moment the app is judged. An athlete has spent six screens telling
// it what they train, how often, how long they have been at it and what they are
// building toward, and the honest empty state was "Build your baseline. Log
// today's training and FightIQ will give you one clear thing to work on next."
// That is an app asking to be paid before it has said anything.
//
// So it says something. Not a guess about their game, which it has no right to
// make, but the thing that is almost always true at their level in their sport,
// framed as what it is: a hypothesis for them to check tonight. That is a real
// coaching move. It is also what makes the first log worth reading, because they
// come back with an answer instead of four words about a class.
//
// Nothing here is invented coaching. Each one is the standard first correction
// for that discipline at that level, which is exactly why it can be written down
// in advance. The moment there is real training to read, none of this is used.

import { sessionCue } from "./session-cue";

export type OpeningBrief = {
  /** Names their sport back to them, so the first line proves the setup was read. */
  title: string;
  /** The thing that usually goes wrong, and why it costs them. Two sentences. */
  body: string;
  /** The single question tonight's session answers. */
  watchFor: string;
  /** The same thing as something to go and do. This is what the session gets tested against. */
  mission: string;
  /** The short form, for the rail on the way into the gym. */
  cue: string;
  /** What happens with the answer. Never a promise this cannot keep. */
  promise: string;
};

type Opening = { title: string; body: string; watchFor: string; mission: string };

/**
 * Two tiers, not four. The gap between somebody in their first month and
 * somebody building fundamentals is not a different correction, it is the same
 * correction explained differently, and pretending otherwise produces content
 * that is thinner in every bucket.
 */
type Tier = "developing" | "experienced";

function tierFor(experienceLevel: string): Tier {
  return /competitor|advanced|coach/i.test(experienceLevel) ? "experienced" : "developing";
}

const OPENINGS: Array<{ pattern: RegExp; developing: Opening; experienced: Opening }> = [
  {
    pattern: /muay thai|kickbox/i,
    developing: {
      title: "Muay Thai starts at the support foot.",
      body: "Almost every kick that lands soft has the same cause, and it is not the kicking leg. The foot on the floor stays planted, the hip cannot come through behind the shin, and the shot arrives as a leg swing rather than as body weight.",
      watchFor: "Does your back heel turn over before the shin arrives, or after it?",
      mission: "Turn the support foot before the shin arrives",
    },
    experienced: {
      title: "The kick is fine. The setup is late.",
      body: "At your level the mechanics are usually already there and the cost has moved. Kicks land clean on the pads and get read in the round, because the entry looks the same every time and the opponent is leaving before the shin does.",
      watchFor: "In live rounds, what were you doing immediately before the kicks that landed?",
      mission: "Change what comes before the kick, not the kick",
    },
  },
  {
    pattern: /boxing/i,
    developing: {
      title: "Boxing is won on the exit.",
      body: "New boxers get taught to throw and never get taught to leave. The combination is fine, then they stand in front of it admiring the work, and everything they get hit with arrives in that half second.",
      watchFor: "After your last punch, do you move, or do you stand there?",
      mission: "Move after the last punch, every time",
    },
    experienced: {
      title: "You are probably square before you know it.",
      body: "Under pressure the front foot stops turning in, the shoulders come level, and the whole defensive frame goes with it. It happens two or three exchanges into a hard round and it is invisible from inside the round.",
      watchFor: "When you got caught tonight, were your feet still on a line, or level?",
      mission: "Keep the front foot turned in under pressure",
    },
  },
  {
    pattern: /bjj|jiu/i,
    developing: {
      title: "Frames before hips, every time.",
      body: "Most bad positions in your first year are not lost where they end, they are lost a beat earlier when the frames collapse and the hips have nothing to work against. Then everything becomes a strength problem, because it is.",
      watchFor: "When you got flattened out, had the frames already gone?",
      mission: "Get the frames in before the hips are needed",
    },
    experienced: {
      title: "Your guard is retention, not attack.",
      body: "At your level the guard usually holds and stops paying. Rounds get spent surviving good passers rather than threatening them, and the sweep or the submission never gets started because the position was only ever being defended.",
      watchFor: "How many times tonight did your guard threaten something rather than just hold?",
      mission: "Make the guard threaten, not just hold",
    },
  },
  {
    pattern: /wrestl/i,
    developing: {
      title: "One entry, made reliable.",
      body: "New wrestlers collect entries and finish none of them. The shot that works is the one drilled to the point of being boring, and the level change is where it is won or lost, well before the hands arrive.",
      watchFor: "On your shots tonight, did the level change happen before the step or with it?",
      mission: "Level change before the step, on every shot",
    },
    experienced: {
      title: "The finish, not the entry.",
      body: "At your level the entry is rarely the problem. Attacks die in the second and third position, in the scramble after the initial shot, where the fight is about hips and reattacks rather than about the shot you planned.",
      watchFor: "When an attack died tonight, was it stopped on the entry or in the scramble?",
      mission: "Finish one attack past the first position",
    },
  },
  {
    pattern: /judo/i,
    developing: {
      title: "The grip decides the throw.",
      body: "Beginners fight for the throw and take whatever grip they are given. Nearly every failed attack traces back to starting from a grip that could never have finished it, and no amount of technique fixes a grip you have already lost.",
      watchFor: "On your attacks tonight, did you have your grip first, or theirs?",
      mission: "Win the grip before you attack",
    },
    experienced: {
      title: "Your kumi kata is being read.",
      body: "At your level the throws work and the sequence into them is predictable. Good opponents defend the grip you always want rather than the throw, which means the fight is over before the attack starts.",
      watchFor: "Did anyone kill your grip tonight before you got to attack?",
      mission: "Get to the throw from a second grip",
    },
  },
  {
    pattern: /\bmma\b/i,
    developing: {
      title: "MMA punishes the transitions.",
      body: "The striking is fine, the grappling is fine, and everything falls apart in the two seconds between them. That is where the takedown lands, where the fence gets used, and where most rounds are actually decided.",
      watchFor: "Tonight, where did it break down: striking, grappling, or the moment between them?",
      mission: "Hold your position through one transition",
    },
    experienced: {
      title: "You have a preferred range and it is being taken.",
      body: "At your level most problems are not technical, they are about who decides where the fight happens. If someone can keep you out of the range you are best in, the skills in that range never get used.",
      watchFor: "Who decided the range tonight, you or them?",
      mission: "Decide the range instead of accepting it",
    },
  },
];

const FALLBACK: { developing: Opening; experienced: Opening } = {
  developing: {
    title: "Make one thing reliable first.",
    body: "Early on, the fastest progress comes from one technique that works every time rather than five that work sometimes. Reliable beats broad, because a technique you trust is the one that comes out when the pace goes up.",
    watchFor: "Which one thing held up tonight when the pace went up?",
      mission: "Make one technique hold up when the pace goes up",
  },
  experienced: {
    title: "The gap is in what holds up live.",
    body: "At your level the difference between drilling and live work is where the useful information is. Things that are clean on the pads or in flow become something else entirely once someone is fighting back.",
    watchFor: "What changed tonight between the drilling and the live rounds?",
      mission: "Carry one drilled detail into a live round",
  },
};

function openingFor(disciplines: string[], tier: Tier): Opening {
  const text = disciplines.join(" ");
  const match = OPENINGS.find((item) => item.pattern.test(text));
  return match ? match[tier] : FALLBACK[tier];
}

/**
 * What the empty cards on My Game are waiting for.
 *
 * Five cards saying "nothing yet" is the screen that most makes an app feel
 * thin. The evidence rules behind them are real and deliberate, and saying what
 * they are turns an absence into a standard: FightIQ is not being coy, it is
 * refusing to call one session a weakness.
 */
export const FIRST_WEEK_CARDS = {
  // These sit in a narrow card that clips. Short enough to read whole beats
  // accurate and cut off at "One bad nig…".
  strengths: "Nothing is a strength until it holds up three sessions running.",
  problems: "Nothing is recurring until it has happened twice.",
  improvement: "Improvement needs a before and an after. Tonight is the before.",
} as const;

/** How much repeated evidence each claim needs before FightIQ will make it. */
const EVIDENCE_NEEDED = { strengths: 3, problems: 2 } as const;

function countdown(needed: number, sessionsLogged: number, whenReady: string, whatItNames: string): string {
  const remaining = Math.max(0, needed - Math.max(0, sessionsLogged));
  if (remaining === 0) return whenReady;
  const word = remaining === 1 ? "One more session" : `${remaining === 2 ? "Two" : remaining === 3 ? "Three" : remaining} more sessions`;
  return `${word} and FightIQ can ${whatItNames}.`;
}

/**
 * What an empty card is waiting for, said as a countdown rather than a blank.
 *
 * "Still learning your strongest areas" tells an athlete nothing is there.
 * "Two more sessions and FightIQ can name your strongest position" is the same
 * fact and makes the wait feel like the product working. Once the count is met
 * and there is still nothing, the honest answer is that nothing has repeated
 * yet, which is a finding rather than a delay.
 */
export function unlockCards(sessionsLogged: number) {
  return {
    strengths: countdown(EVIDENCE_NEEDED.strengths, sessionsLogged, FIRST_WEEK_CARDS.strengths, "name your strongest position"),
    problems: countdown(EVIDENCE_NEEDED.problems, sessionsLogged, FIRST_WEEK_CARDS.problems, "tell a pattern from a bad night"),
    improvement: sessionsLogged < 2
      ? FIRST_WEEK_CARDS.improvement
      : "Nothing has changed enough to call improvement yet. It needs the same thing to get better twice.",
  };
}

/**
 * Whether a memory string is one of the app's own "nothing yet" placeholders.
 *
 * These are generated well away from the screen, so the card cannot ask the
 * snapshot whether it is empty. Matching the phrasings is contained and tested,
 * and the alternative is an empty state that only ever appears on day one.
 */
export function isPlaceholderMemory(value: string): boolean {
  return /still learning|no recurring problem|log a few completed sessions|needs? another completed debrief|needs? more repeated evidence|session is saved with the detail|training note is saved/i.test(value ?? "");
}

/**
 * What the next few sessions actually unlock, with a date attached.
 *
 * A new athlete deserves to know what they are waiting for and roughly when,
 * rather than being told to keep logging and trust it.
 */
export function firstWeekPlan(sessionsPerWeek: number): Array<{ after: string; gets: string }> {
  const perWeek = sessionsPerWeek >= 1 && sessionsPerWeek <= 14 ? sessionsPerWeek : 3;
  const when = (sessions: number) => {
    const weeks = sessions / perWeek;
    if (weeks <= 1) return "this week";
    if (weeks <= 2) return "in about two weeks";
    return "in about a month";
  };
  return [
    { after: "Session 1", gets: "A read on what you wrote, and one thing to test next time." },
    { after: `Session 3, ${when(3)}`, gets: "Repeats start getting named, and what you are shown follows them." },
    { after: `Session 6, ${when(6)}`, gets: "A weekly review of what actually changed, not what you did." },
  ];
}

/**
 * The one line under the greeting on day one. "Let's keep building your game"
 * is a lie to somebody who has built nothing here yet, and a reader hears it.
 */
export function openingGreeting(sessionsLogged: number): string {
  if (sessionsLogged === 0) return "Your first session is the one that starts everything.";
  if (sessionsLogged === 1) return "One session in. Two more and patterns start showing up.";
  if (sessionsLogged === 2) return "Two sessions in. FightIQ is starting to see a shape.";
  return "Let’s keep building your game.";
}

/**
 * The one construction site.
 *
 * The home card, the rail on the way into the gym and the brief that opens when
 * it is tapped are all the same instruction, so they are all built from here.
 * Returns null the moment there is real training to read.
 */
export function openingFromMemory(memory: {
  disciplines: string[];
  experienceLevel: string;
  competitionIntent: string;
  statedFocus: string | null;
  sessionsLogged: number;
}): OpeningBrief | null {
  if (memory.sessionsLogged > 0) return null;
  return openingBrief({
    disciplines: memory.disciplines,
    experienceLevel: memory.experienceLevel,
    competitionIntent: memory.competitionIntent,
    currentFocus: memory.statedFocus,
  });
}

/**
 * What FightIQ tells a brand new athlete before they have logged anything.
 *
 * When they typed a priority during setup, that wins. They have already told the
 * app what they care about, and answering a different question would be the
 * clearest possible sign that nobody was listening.
 */
export function openingBrief(setup: {
  disciplines: string[];
  experienceLevel: string;
  competitionIntent?: string;
  currentFocus?: string | null;
}): OpeningBrief {
  const stated = (setup.currentFocus ?? "").replace(/\s+/g, " ").trim();
  const tier = tierFor(setup.experienceLevel);
  const competing = /compete regularly|may compete/i.test(setup.competitionIntent ?? "");

  if (stated.length >= 4) {
    return {
      title: `You said: ${stated.charAt(0).toLowerCase()}${stated.slice(1)}.`,
      body: `That is where FightIQ will start. It has nothing from your training yet, so tonight it is your word rather than a pattern, and one session changes that.`,
      watchFor: `Tonight, what specifically goes wrong when you try it?`,
      mission: stated,
      cue: sessionCue(stated),
      promise: "Log tonight and FightIQ turns this into something it can track.",
    };
  }

  const opening = openingFor(setup.disciplines, tier);
  return {
    title: opening.title,
    body: opening.body,
    watchFor: opening.watchFor,
    mission: opening.mission,
    // Built from the mission, not the headline. The rail on the way into the gym
    // and the brief behind it have to be the same instruction, or the app is
    // arguing with itself on the screen somebody reads in a changing room.
    cue: sessionCue(opening.mission),
    // The honest framing. This is the standard fault at their level, not a
    // reading of their game, and saying so is what makes it trustworthy.
    promise: competing
      ? "This is the usual one at your level, not a read on you. Log tonight and FightIQ finds out whether it is actually yours."
      : "This is the usual one at your level, not a read on you. Log one session and FightIQ starts working from your training instead.",
  };
}
