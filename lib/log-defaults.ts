// What the log screen assumes before an athlete touches it.
//
// It used to assume MMA and a wrestling example, for everybody. A Muay Thai
// athlete who had just spent six screens saying "Muay Thai" opened the one
// screen this app exists for and was shown someone else's sport, with their
// first session quietly filed under the wrong discipline unless they noticed a
// collapsed "Training details" row and fixed it.
//
// Getting this right is not a nicety. The discipline is stored on the session
// and read back by every model call, so a wrong default is wrong evidence.

/** The disciplines the log screen offers. A default has to be one of these. */
const LOGGABLE = ["MMA", "BJJ", "Wrestling", "Boxing", "Muay Thai", "Kickboxing", "Judo", "Other"] as const;

/**
 * The discipline to open on, from what the athlete told setup.
 *
 * Their first listed discipline wins. Someone who trains Muay Thai and BJJ put
 * one of them first, and that is a better guess than the app's own preference.
 */
export function disciplineFromSetup(disciplines: string[]): string {
  for (const raw of disciplines) {
    const value = raw.toLowerCase();
    const match = LOGGABLE.find((item) => item.toLowerCase() === value)
      ?? (/muay thai/.test(value) ? "Muay Thai"
        : /kickbox/.test(value) ? "Kickboxing"
          : /box/.test(value) ? "Boxing"
            : /wrestl/.test(value) ? "Wrestling"
              : /bjj|jiu/.test(value) ? "BJJ"
                : /judo/.test(value) ? "Judo"
                  : /mma|mixed/.test(value) ? "MMA"
                    : null);
    if (match) return match;
  }
  return "MMA";
}

/**
 * The session type to open on.
 *
 * Only when setup names exactly one is it safe to assume: somebody who ticked
 * Class, Sparring and Open mat has told us nothing about tonight, and guessing
 * from that list is worse than the honest default.
 */
export function sessionTypeFromSetup(sessionTypes: string[]): string {
  return sessionTypes.length === 1 && sessionTypes[0] ? sessionTypes[0] : "Class";
}

const PLACEHOLDERS: Array<[RegExp, string]> = [
  [/muay thai|kickbox/i, "Pad rounds and clinch work. My kicks kept landing flat and coach said I was not turning the support foot…"],
  [/boxing/i, "Six rounds on the bag, then light sparring. I kept standing in front of my combinations…"],
  [/bjj|jiu/i, "Drilled guard retention, then rolled. Kept getting flattened out once my frames went…"],
  [/wrestl/i, "Takedown entries and live goes. My shots were getting stuffed on the first contact…"],
  [/judo/i, "Uchi komi then randori. Could not get my grip before they got theirs…"],
];

/**
 * The example note in an empty box.
 *
 * It is read by everyone who has never logged before, so it is doing two jobs:
 * it is in their sport, and it quietly shows the shape of a note worth reading.
 * What you worked on, what went wrong, what your coach said.
 */
export function notePlaceholder(discipline: string): string {
  const match = PLACEHOLDERS.find(([pattern]) => pattern.test(discipline));
  return match?.[1] ?? "What you worked on, what went wrong, and anything your coach told you…";
}
