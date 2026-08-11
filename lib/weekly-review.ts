// Per-session analysis tells an athlete what happened on Tuesday. It cannot
// tell them whether they are actually getting better, because improvement in
// this sport does not happen inside one session — it happens across a month of
// them, and by then nobody remembers what Tuesday said.
//
// This reads the sessions already in memory and answers the question a training
// app owes anyone who bothers to log: what did I actually do this week, what
// kept coming up, and what stopped.
//
// It is deterministic. No model call, no network, no cost, no waiting — which
// means it is there on a Sunday night on gym wifi, and it says the same thing
// twice if you open it twice.

export type ReviewSession = {
  discipline: string;
  sessionType: string;
  note: string;
  takeaway: string | null;
  focus: string | null;
  createdAt: string;
};

export type ThemeStatus = "still_open" | "quiet_lately" | "new_this_week" | "came_back";

export type ReviewTheme = {
  label: string;
  sessions: number;
  status: ThemeStatus;
};

export type WeeklyReview = {
  hasData: boolean;
  sessions: number;
  target: number;
  /** Distinct calendar days trained — two sessions in one day is one day of recovery load. */
  days: number;
  disciplines: Array<{ name: string; sessions: number }>;
  hardestGapDays: number;
  themes: ReviewTheme[];
  headline: string;
  subline: string;
  /**
   * Whether any session predates the window.
   *
   * Without it, "new this week" gets stamped on every theme an athlete has,
   * because on their first week everything is new. The badge only means
   * something when there is an earlier week to be new against.
   */
  hasEarlierHistory: boolean;
};

// The terms an athlete's own notes actually contain. Frequency alone would rank
// "round" and "coach" at the top; this keeps the count on things you could go
// and drill.
const LEXICON: Array<[string, RegExp]> = [
  ["support foot", /\b(support|standing|plant(ed|ing)?) foot\b|\bpivot(ing)?\b/i],
  ["hip rotation", /\bhips?\b[^.!?]{0,18}\b(turn|rotat|through|travel|square)|\bhip rotation\b/i],
  ["head position", /\bhead position\b|\bhead (up|down|drop|dropped|inside|outside)\b/i],
  ["guard retention", /\bguard retention\b|\b(keep|keeping|losing|lost) (my )?guard\b|\bpassed my guard\b/i],
  ["the underhook", /\bunderhook(s|ed)?\b|\bwhizzer\b/i],
  ["half guard", /\bhalf ?guard\b/i],
  ["back takes", /\bback take\b|\btaking the back\b|\bseatbelt\b|\bhooks in\b/i],
  ["arm drags", /\barm ?drag(s|ged)?\b/i],
  ["takedown finishes", /\b(single|double) leg\b|\btakedown\b|\bfinish(ing)? the shot\b/i],
  ["sprawl and defence", /\bsprawl(ed|ing)?\b|\bstuff(ed|ing)? the shot\b/i],
  ["the clinch", /\bclinch(ed|ing|work)?\b|\bplum\b|\bdouble collar\b/i],
  ["the teep", /\bteep(s|ed)?\b|\bpush kick\b/i],
  ["round kicks", /\bround ?(house)? ?kick\b|\bleg kick\b|\bshin\b/i],
  ["checking kicks", /\bcheck(ing|ed)? (the )?kick\b|\bchecked it\b/i],
  ["the jab", /\bjab(s|bing)?\b/i],
  ["counters", /\bcounter(s|ing|ed)?\b|\bcaught me (coming|stepping) in\b/i],
  ["footwork", /\bfootwork\b|\bcut(ting)? the (cage|ring)\b|\bangles?\b/i],
  ["defence and guard hands", /\b(hands? (drop|down|low)|chin up|keep(ing)? my hands up)\b/i],
  ["distance", /\bdistance\b|\brange\b|\btoo close\b|\bstepping in\b/i],
  ["timing", /\btiming\b|\ba beat (late|slow)\b|\btoo early\b/i],
  ["cardio and pace", /\b(gassed|cardio|out of breath|pace|conditioning)\b/i],
  ["grip fighting", /\bgrip(s| fighting)?\b|\bcollar and sleeve\b/i],
  ["escapes", /\bescape(s|d)?\b|\bgot out\b|\bstuck under\b/i],
  ["submissions", /\bsubmission\b|\barmbar\b|\btriangle\b|\bchoke\b|\bheel hook\b|\bkimura\b/i],
];

const DAY = 24 * 60 * 60 * 1000;

function themeLabels(session: ReviewSession) {
  const text = `${session.note} ${session.takeaway ?? ""} ${session.focus ?? ""}`;
  return LEXICON.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

const EMPTY: WeeklyReview = {
  hasData: false, sessions: 0, target: 0, days: 0, disciplines: [], hardestGapDays: 0, themes: [], hasEarlierHistory: false,
  headline: "No sessions logged in the last seven days.",
  subline: "Log one and this fills in. A week of notes is where the pattern starts to show.",
};

/**
 * @param sessions the athlete's recent training, newest first or in any order
 * @param target sessions per week from their profile, 0 when unset
 * @param now injected so the review is testable and stable
 */
export function buildWeeklyReview(sessions: ReviewSession[], target: number, now: Date = new Date()): WeeklyReview {
  const since = now.getTime() - 7 * DAY;
  const week = (sessions ?? [])
    .filter((session) => {
      const at = new Date(session.createdAt).getTime();
      return Number.isFinite(at) && at >= since && at <= now.getTime() + DAY;
    })
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  if (!week.length) return { ...EMPTY, target };

  const days = new Set(week.map((session) => dayKey(session.createdAt)));
  const byDiscipline = new Map<string, number>();
  for (const session of week) {
    const name = session.discipline?.trim() || "Training";
    byDiscipline.set(name, (byDiscipline.get(name) ?? 0) + 1);
  }

  // The longest run of rest days inside the window. Two sessions on Monday and
  // two on Sunday is not the same week as four spread across it.
  const stamps = [...days].sort();
  let hardestGapDays = 0;
  for (let index = 1; index < stamps.length; index += 1) {
    const gap = Math.round((new Date(stamps[index]).getTime() - new Date(stamps[index - 1]).getTime()) / DAY) - 1;
    if (gap > hardestGapDays) hardestGapDays = gap;
  }

  // "New this week" has to mean new. Judged only inside the window, a problem
  // the athlete has been writing about for a fortnight gets labelled new the
  // moment it skips the first half of one week — which is not what the athlete
  // reads it as, and not something worth paying for.
  const earlier = new Set<string>();
  for (const session of sessions ?? []) {
    const at = new Date(session.createdAt).getTime();
    if (Number.isFinite(at) && at < since) for (const label of themeLabels(session)) earlier.add(label);
  }

  // A theme counts once per session, so one long note cannot outvote three
  // sessions that all hit the same problem.
  const seen = new Map<string, { sessions: number; firstHalf: boolean; secondHalf: boolean; lastSeen: number }>();
  const midpoint = since + 3.5 * DAY;
  for (const session of week) {
    const at = new Date(session.createdAt).getTime();
    for (const label of new Set(themeLabels(session))) {
      const entry = seen.get(label) ?? { sessions: 0, firstHalf: false, secondHalf: false, lastSeen: 0 };
      entry.sessions += 1;
      entry.lastSeen = Math.max(entry.lastSeen, at);
      if (at < midpoint) entry.firstHalf = true; else entry.secondHalf = true;
      seen.set(label, entry);
    }
  }

  // What is unresolved leads, then what recurred most, then what is most
  // recent. Alphabetical order would put whatever starts with "c" on top of the
  // thing the athlete is actually still losing rounds to.
  const RANK: Record<ThemeStatus, number> = { still_open: 0, came_back: 1, new_this_week: 2, quiet_lately: 3 };
  const themes: ReviewTheme[] = [...seen.entries()]
    .map(([label, entry]) => ({
      label,
      sessions: entry.sessions,
      lastSeen: entry.lastSeen,
      // Deliberately describes the notes, not the athlete. FightIQ knows what
      // stopped being written down; it does not know what got fixed.
      status: (entry.firstHalf && entry.secondHalf ? "still_open"
        : entry.firstHalf ? "quiet_lately"
          // Late in the week and seen before the window is a return, not a debut.
          : earlier.has(label) ? "came_back" : "new_this_week") as ThemeStatus,
    }))
    .sort((a, b) => RANK[a.status] - RANK[b.status] || b.sessions - a.sessions || b.lastSeen - a.lastSeen || a.label.localeCompare(b.label))
    .map(({ label, sessions, status }) => ({ label, sessions, status }))
    .slice(0, 5);

  const disciplines = [...byDiscipline.entries()]
    .map(([name, count]) => ({ name, sessions: count }))
    .sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));

  const open = themes.filter((theme) => theme.status === "still_open");
  const headline = target > 0
    ? week.length >= target
      ? `${plural(week.length, "session", "sessions")} logged. That’s your week.`
      : `${plural(week.length, "session", "sessions")} logged, out of ${target}.`
    : `${plural(week.length, "session", "sessions")} logged across ${plural(days.size, "day", "days")}.`;

  const subline = open.length
    ? `${sentenceCase(open[0].label)} came up in ${plural(open[0].sessions, "session", "sessions")} and ${isPluralLabel(open[0].label) ? "were" : "was"} still there at the end of the week.`
    : themes.length
      // One mention is not a thread. Saying it is teaches an athlete to discount
      // the summary, and then the weeks where it is true get discounted too.
      ? themes[0].sessions > 1
        ? `${sentenceCase(themes[0].label)} ${isPluralLabel(themes[0].label) ? "were" : "was"} the thread running through the week.`
        : `${sentenceCase(themes[0].label)} came up once. Worth seeing whether it repeats.`
      : "Your notes did not repeat a theme this week. Worth writing down what specifically broke down next time.";

  return { hasData: true, sessions: week.length, target, days: days.size, disciplines, hardestGapDays, themes, headline, subline, hasEarlierHistory: earlier.size > 0 };
}

/**
 * Plain-English label for a theme's status, kept next to the logic that sets it.
 *
 * Returns null when the label would not be telling the athlete anything. "New
 * this week" against a history that only started this week is true of every
 * theme at once, and a badge that every row carries is decoration.
 */
export function themeStatusLabel(status: ThemeStatus, hasEarlierHistory = true) {
  if (status === "still_open") return "still open";
  if (status === "quiet_lately") return "went quiet";
  if (status === "came_back") return "came back";
  return hasEarlierHistory ? "new this week" : null;
}

/**
 * Whether a theme label takes a plural verb.
 *
 * "Arm drags was the thread running through the week" is the sort of mistake
 * that makes an athlete quietly stop trusting everything else on the page. Every
 * plural entry in LEXICON ends in "s" and no singular one does, so the rule is
 * derived rather than kept in a parallel table somebody would forget to update.
 * The test suite checks that this still holds for every label in the list.
 */
export function isPluralLabel(label: string) {
  return /s$/i.test(label.trim().split(/\s+/).at(-1) ?? "");
}

/**
 * The rest-day tile, or nothing.
 *
 * "0" next to "days without a gap" is the best possible result rendered as a
 * failing score, on a day the athlete actually trained. And with only one day
 * in the window the number is not just unflattering, it is meaningless: there
 * is no gap to measure between a single day and itself.
 *
 * Returns null when there is nothing true to say, because a premium product
 * leaves a slot out rather than filling it with a zero.
 */
/** A label written by a model starts a sentence here, so it has to look like one. */
function sentenceCase(value: string): string {
  const clean = value.trim();
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : clean;
}

export function restTile(daysTrained: number, hardestGapDays: number): { value: string; label: string } | null {
  if (daysTrained < 2) return null;
  if (hardestGapDays <= 0) return { value: "None", label: "days off in a row" };
  return { value: String(hardestGapDays), label: hardestGapDays === 1 ? "day off in a row" : "days off in a row" };
}
