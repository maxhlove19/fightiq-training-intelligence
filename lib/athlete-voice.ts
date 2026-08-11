// Turning case notes back into a conversation.
//
// Everywhere the product writes its own copy it talks to the athlete. But some
// strings on screen were written by a model and stored months ago, and those
// drift into the third person: "Athlete reported the technique always worked."
// That is a clinician writing about a patient, and it is the single fastest way
// to stop sounding like a coach who was there.
//
// This runs at display time rather than at write time on purpose. A prompt
// change only fixes what has not been written yet, and there is already stored
// text that reads this way. Fixing it here fixes the past too.

/** Ordered. Longer, more specific forms first, so "the athlete's" never matches as "athlete". */
const REWRITES: Array<[RegExp, string]> = [
  [/\bthe athlete's\b/gi, "your"],
  [/\bathlete's\b/gi, "your"],
  [/\bthe athlete\b/gi, "you"],
  [/\bthis athlete\b/gi, "you"],
  [/\bathlete reported\b/gi, "you said"],
  [/\bathlete said\b/gi, "you said"],
  [/\bathlete\b/gi, "you"],
  // FightIQ referring to itself in the third person has the same problem, but
  // only in the middle of a sentence. "FightIQ needs another session" as a
  // whole statement is fine and is used deliberately elsewhere.
  [/\bthe user\b/gi, "you"],
];

/** Verbs that have to follow "you" rather than a third person subject. */
const AGREEMENT: Array<[RegExp, string]> = [
  [/\byou reports\b/gi, "you report"],
  [/\byou was\b/gi, "you were"],
  [/\byou has\b/gi, "you have"],
  [/\byou is\b/gi, "you are"],
  [/\byou does\b/gi, "you do"],
  [/\byou needs\b/gi, "you need"],
  [/\byou keeps\b/gi, "you keep"],
  [/\byou gets\b/gi, "you get"],
  [/\byou loses\b/gi, "you lose"],
  [/\byou tends\b/gi, "you tend"],
];

/**
 * Rewrites clinical third person into something a coach would say.
 *
 * Deliberately conservative. It only touches ways of naming the person reading
 * the screen, and it never rewrites the athlete's own words about somebody
 * else, because "my training partner" is not "the athlete".
 */
export function toAthleteVoice(value: string): string {
  if (!value) return value;
  let text = value;
  for (const [pattern, replacement] of REWRITES) text = text.replace(pattern, replacement);
  for (const [pattern, replacement] of AGREEMENT) text = text.replace(pattern, replacement);
  // A sentence that now starts with "you" or "your" still starts with a capital.
  return text.replace(/(^|[.!?]\s+)(your?\b)/g, (_match, lead: string, word: string) => `${lead}${word.charAt(0).toUpperCase()}${word.slice(1)}`);
}
