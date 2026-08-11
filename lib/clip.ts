// Truncation that an athlete can trust.
//
// A pre-training mission came back as "Repeat ankle locks with controlled
// resistance and note what stays consis": a hard slice at 72 characters, no
// ellipsis, cut mid-word inside "consistent". A mission is an instruction, and
// half an instruction is worse than a long one.
//
// So ceilings are generous now, and when one is genuinely reached the cut lands
// on a word boundary and says so. Nothing silently loses its last syllable.

/**
 * Trim to a ceiling on a word boundary, with an ellipsis when anything was lost.
 *
 * The ellipsis is counted inside the limit, so the result never exceeds it. A
 * single word longer than the whole ceiling is the one case with no good answer,
 * and it is cut hard rather than returned over-length.
 */
export function clip(value: string, limit: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  const room = Math.max(1, limit - 1);
  const window = clean.slice(0, room + 1);
  const lastSpace = window.lastIndexOf(" ");
  // A break in the last 40% of the ceiling keeps the sentence recognisable. A
  // break earlier than that means one very long word, so the hard cut is honest.
  const head = lastSpace > Math.floor(room * 0.4) ? window.slice(0, lastSpace) : clean.slice(0, room);
  return `${head.replace(/[\s,;:.!?]+$/, "")}…`;
}

/**
 * The same ceiling, for a value that is a label rather than a sentence.
 *
 * Labels lose their terminal punctuation because "Arm drags." reads wrong on a
 * chip. Sentences keep theirs, which is why this is a separate function: the old
 * helper stripped the full stop off everything, and that is how a reason ended
 * up on screen as "Ankle-lock execution felt successful in this session" with no
 * stop at the end of it.
 */
export function clipLabel(value: string, limit: number): string {
  return clip(value.replace(/[.!?]+$/g, "").trim(), limit);
}

/** Give a sentence its full stop back, without doubling one it already has. */
export function sentence(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return clean;
  return /[.!?…]$/.test(clean) ? clean : `${clean}.`;
}

/**
 * True for a string still carrying the old hard 72-character mission cut:
 * no ellipsis, stopped mid-word. `clipLabel` never produces that shape, so a
 * stored row matching it predates this file and needs regenerating rather
 * than displaying as-is.
 */
export function looksHardTruncated(value: string): boolean {
  return value.length === 72 && !value.endsWith("…") && /\w$/.test(value);
}
