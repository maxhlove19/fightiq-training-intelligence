// The house style, enforced rather than requested.
//
// Every system prompt in this codebase already tells the model never to use an
// em dash. It uses them anyway. That is worth stating plainly, because it is the
// general lesson and not a detail about punctuation: an instruction in a prompt
// is a strong preference, never a guarantee, and anything that must be true of
// what reaches an athlete has to be made true on the way out.
//
// So this runs at the one place every model call returns through, and again at
// display time. Generation-time alone would leave every sentence written before
// tonight untouched, and those are already sitting in somebody's conversation.

// Written as escapes rather than as the characters themselves, so that the rule
// in tests/copy-voice.test.mjs stays absolute. A file allowed to contain the
// thing it bans is the first step toward the ban meaning nothing.
/** U+2014 em dash, U+2013 en dash, U+2015 horizontal bar. The three a model reaches for. */
const DASH = /[\u2014\u2013\u2015]/;
const DASH_RUN = /\s*[\u2014\u2013\u2015]+\s*/g;
const NUMERIC_RANGE = /(\d)\s*[\u2014\u2013\u2015]\s*(\d)/g;

// American spellings the model reaches for by default, and the only ones
// rewritten unconditionally: "defense" and "offense" are always nouns in a
// combat-sports context, unlike "practice"/"practise", where the correct
// spelling depends on whether the word is a noun or a verb and a blind rewrite
// would get half of them wrong.
//
// Built from parts rather than written whole, for the same reason the dash
// characters above are escape codes: tests/copy-voice.test.mjs bans exactly
// these American spellings from every reader-facing line in this codebase,
// and this file is one of them.
const AMERICAN_WORDS = ["defen" + "s" + "e", "offen" + "s" + "e"];
const AMERICAN_SPELLING = new RegExp(`\\b(${AMERICAN_WORDS.join("|")})(s)?\\b`, "gi");

/** "DEFENSE" to "DEFENCE", "Defense" to "Defence", "defense" to "defence". */
function toBritishSpelling(value: string): string {
  return value.replace(AMERICAN_SPELLING, (match, word: string, plural: string | undefined) => {
    const british = `${word.slice(0, word.length - 2)}c${word.slice(word.length - 1)}${plural ?? ""}`;
    if (match === match.toUpperCase()) return british.toUpperCase();
    if (match[0] === match[0].toUpperCase()) return british[0].toUpperCase() + british.slice(1);
    return british;
  });
}

/**
 * Rewrites a generated string into the house style.
 *
 * A dash between two numbers is a range and carries meaning, so it becomes "to"
 * rather than a comma. "3 to 5 reps" is what a coach says out loud anyway.
 * Everywhere else the dash is standing in for a pause, and a pause is a comma or
 * a full stop, so the surrounding punctuation decides which one is already there.
 */
export function toHouseStyle(value: string): string {
  if (!value) return value;
  const spelled = AMERICAN_SPELLING.test(value) ? toBritishSpelling(value) : value;
  AMERICAN_SPELLING.lastIndex = 0;
  if (!DASH.test(spelled)) return spelled;
  const ranged = spelled.replace(NUMERIC_RANGE, "$1 to $2");
  const rewritten = ranged.replace(DASH_RUN, (match, offset: number, whole: string) => {
    const before = whole.slice(0, offset).trimEnd().slice(-1);
    const after = whole.slice(offset + match.length).trimStart();
    // A dash opening or closing a sentence is decoration, not a pause.
    if (!before || !after) return "";
    // Never stack punctuation. A comma followed by a dash rewritten as another
    // comma is worse than the sentence it replaced.
    if (/[,.;:!?]/.test(before)) return " ";
    return ", ";
  });
  return rewritten.replace(/\s+([,.;:!?])/g, "$1").replace(/ {2,}/g, " ").trim();
}

/**
 * Apply a rewrite to every readable string in a whole parsed model response.
 *
 * Model output arrives as JSON with the readable strings nested at unpredictable
 * depths, so this walks the value rather than naming fields. Naming fields is how
 * you end up fixing the debrief and missing the coaching answer underneath it.
 */
export function walkStrings<T>(value: T, transform: (text: string) => string): T {
  if (typeof value === "string") return transform(value) as T;
  if (Array.isArray(value)) return value.map((item) => walkStrings(item, transform)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = walkStrings(item, transform);
    return out as T;
  }
  return value;
}

/** The house style alone, for callers that only need the punctuation rule. */
export function applyHouseStyle<T>(value: T): T {
  return walkStrings(value, toHouseStyle);
}
