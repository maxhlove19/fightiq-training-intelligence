// A ceiling on how much model work one account can start.
//
// Every debrief and every Coach answer is a paid call. Nothing stopped one
// account from starting an unbounded number of them — a script, a retry loop,
// or a bug in something that calls this app can run up a bill against the
// person running it rather than the person causing it.
//
// The limits are deliberately far above real use. Three sessions a day is a
// heavy week for the athletes this is built for; the hourly session ceiling is
// four times that, and the daily one is more than a fortnight's training in a
// single day. Nobody using this app the way it is meant to be used will meet
// one of these — which is the point. A limit an ordinary athlete can hit is a
// worse product, not a safer one.
//
// The counts come from rows the app already writes, read through indexes it
// already has, so nothing is written on the hot path just to count it.

export type LimitKind = "session_debrief" | "coach_question";

export type UsageCounts = {
  /** How many the account has started in the last hour. */
  lastHour: number;
  /** …and in the last twenty-four. */
  lastDay: number;
};

export type LimitDecision = {
  allowed: boolean;
  code: string;
  message: string;
  /** What to put in Retry-After. Zero when allowed. */
  retryAfterSeconds: number;
};

export const LIMITS: Record<LimitKind, { hour: number; day: number }> = {
  // Twelve sessions in an hour is already impossible to have trained.
  session_debrief: { hour: 12, day: 40 },
  // Coach is conversational, so the hourly ceiling is high enough to hold a
  // long back-and-forth without ever being noticed.
  coach_question: { hour: 40, day: 200 },
};

const COPY: Record<LimitKind, { hour: string; day: string }> = {
  session_debrief: {
    hour: "That is a lot of sessions in one hour. Your notes are all saved — FightIQ will read the rest shortly.",
    day: "Every session you logged today is saved. FightIQ has read as many as it can in a day; open any of them tomorrow and it will pick up where it left off.",
  },
  coach_question: {
    hour: "Coach needs a short breather. Your training is all still here — try again in a few minutes.",
    day: "Coach is done for today. Everything you logged is saved, and it will be back tomorrow.",
  },
};

const ALLOWED: LimitDecision = { allowed: true, code: "", message: "", retryAfterSeconds: 0 };

/**
 * Whether this account may start another paid call.
 *
 * Never refuses to keep an athlete's own words: this gates the reading, not the
 * writing, so a session note is always saved and only its debrief waits.
 */
export function checkUsage(kind: LimitKind, counts: UsageCounts): LimitDecision {
  const limit = LIMITS[kind];
  const hour = Math.max(0, Math.floor(counts.lastHour) || 0);
  const day = Math.max(0, Math.floor(counts.lastDay) || 0);
  if (day >= limit.day) {
    return { allowed: false, code: "DAILY_LIMIT_REACHED", message: COPY[kind].day, retryAfterSeconds: 3600 };
  }
  if (hour >= limit.hour) {
    return { allowed: false, code: "HOURLY_LIMIT_REACHED", message: COPY[kind].hour, retryAfterSeconds: 600 };
  }
  return ALLOWED;
}

/** The two cutoffs a caller counts against, so the windows are defined in one place. */
export function usageWindows(now: Date = new Date()) {
  return {
    hourAgo: new Date(now.getTime() - 3600_000).toISOString(),
    dayAgo: new Date(now.getTime() - 86_400_000).toISOString(),
  };
}
