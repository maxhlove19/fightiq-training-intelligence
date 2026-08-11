// The card at the top of the home screen.
//
// It is the first thing anyone sees and it was spending that space on a label.
// "Here's what matters next." is a heading describing the card rather than
// saying anything, with the actual finding demoted to the body underneath in
// smaller type. So the finding is the headline now, and the body carries what
// to do about it.

import { isPlaceholderMemory } from "./first-session";
import { clip } from "./clip";

export type HomeInsight = { title: string; body: string };

/** The first sentence, which is where a good takeaway puts the point. */
function headline(takeaway: string): { head: string; rest: string } {
  const clean = takeaway.replace(/\s+/g, " ").trim();
  const match = /^(.+?[.!?])(\s+|$)([\s\S]*)$/.exec(clean);
  // A headline cut mid-word is the first thing anyone sees, so the break lands
  // on a word and the remainder starts where the headline actually stopped.
  if (!match || match[1].length > 110) {
    const head = clip(clean, 110);
    const kept = head.replace(/…$/, "").trim();
    return { head, rest: clean.length > kept.length ? clean.slice(kept.length).trim() : "" };
  }
  return { head: match[1].trim(), rest: (match[3] ?? "").trim() };
}

export function homeInsight(args: {
  /** Day one, before there is any training. Already a headline and a body. */
  opening?: { title: string; body: string } | null;
  /** The takeaway from the most recent completed debrief. */
  latestTakeaway?: string | null;
  /** What that debrief said to work on next. */
  latestFocus?: string | null;
  focusReason: string;
}): HomeInsight {
  if (args.opening) return { title: args.opening.title, body: args.opening.body };

  const takeaway = (args.latestTakeaway ?? "").trim();
  // The offline fallback's takeaway is an acknowledgement that the note saved.
  // Promoting that to the headline claims an insight nobody had.
  if (takeaway && !isPlaceholderMemory(takeaway)) {
    const { head, rest } = headline(takeaway);
    const focus = (args.latestFocus ?? "").trim();
    // The body earns its place by saying what to do, not by repeating the
    // headline. Only the part of the takeaway the headline did not carry.
    const body = [rest, focus ? `Next session: ${focus.replace(/[.\s]+$/, "")}.` : ""].filter(Boolean).join(" ");
    return { title: head, body: body || args.focusReason };
  }

  // Sessions logged, nothing debriefed yet. Saying "build your baseline" to
  // somebody who has already built one is the app not reading its own data.
  return { title: "Nothing confirmed yet.", body: args.focusReason };
}
