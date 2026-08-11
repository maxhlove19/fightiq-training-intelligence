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

/**
 * Rewrites a generated string into the house style.
 *
 * A dash between two numbers is a range and carries meaning, so it becomes "to"
 * rather than a comma. "3 to 5 reps" is what a coach says out loud anyway.
 * Everywhere else the dash is standing in for a pause, and a pause is a comma or
 * a full stop, so the surrounding punctuation decides which one is already there.
 */
export function toHouseStyle(value: string): string {
  if (!value || !DASH.test(value)) return value;
  const ranged = value.replace(NUMERIC_RANGE, "$1 to $2");
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
 * The same rule applied to a whole parsed model response.
 *
 * Model output arrives as JSON with the readable strings nested at unpredictable
 * depths, so this walks the value rather than naming fields. Naming fields is how
 * you end up fixing the debrief and missing the coaching answer underneath it.
 */
export function applyHouseStyle<T>(value: T): T {
  if (typeof value === "string") return toHouseStyle(value) as T;
  if (Array.isArray(value)) return value.map((item) => applyHouseStyle(item)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = applyHouseStyle(item);
    return out as T;
  }
  return value;
}
