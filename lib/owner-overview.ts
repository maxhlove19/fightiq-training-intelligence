// What the person who runs FightIQ needs to know, worked out from rows the app
// already keeps.
//
// Deliberately not in here: the text of anybody's training notes. An athlete
// writes those in a changing room believing they are theirs, and an operator
// does not need to read a diary to know whether the product is working. What is
// here is behaviour: who signed up, who came back, who is stuck, who stopped.
// That is the difference between running a business and reading somebody's post.

export type AccountRow = {
  ownerId: string;
  email: string | null;
  displayName: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  visits: number;
};

export type SessionRow = {
  ownerId: string;
  discipline: string;
  sessionType: string;
  createdAt: string;
  /** Whether the debrief for this session finished. */
  debriefComplete: boolean;
};

export type HoldRow = { ownerId: string; reason: string; openedAt: string };

export type AthleteSummary = {
  ownerId: string;
  name: string;
  email: string;
  joinedAt: string;
  lastSeenAt: string;
  /** Whole days since they last logged a session. null when they never have. */
  daysSinceLastSession: number | null;
  sessions: number;
  sessionsThisWeek: number;
  disciplines: string[];
  sparringShare: number;
  debriefsCompleted: number;
  holdOpen: boolean;
  /** One word for where this athlete stands, so a long list can be read at a glance. */
  state: "new" | "active" | "slowing" | "lapsed" | "never_logged" | "held";
};

export type OwnerOverview = {
  totals: {
    athletes: number;
    signedUpThisWeek: number;
    activeThisWeek: number;
    activeThisMonth: number;
    lapsed: number;
    neverLogged: number;
    sessions: number;
    sessionsThisWeek: number;
    debriefsCompleted: number;
    holdsOpen: number;
  };
  /** Of the athletes who logged a first session, how many logged a second, and a fifth. */
  retention: { loggedOnce: number; loggedTwice: number; loggedFive: number };
  athletes: AthleteSummary[];
  /** Plain sentences a person can read without decoding the numbers themselves. */
  headlines: string[];
};

const DAY = 86_400_000;

function time(value: string): number {
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : 0;
}

function daysBetween(from: number, to: number): number {
  return Math.max(0, Math.floor((to - from) / DAY));
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * A state each athlete is in. Ordered so the most urgent thing about somebody
 * wins: a held athlete is held whatever else is true of them.
 */
function stateFor(input: { holdOpen: boolean; sessions: number; daysSinceLastSession: number | null; daysSinceJoined: number }): AthleteSummary["state"] {
  if (input.holdOpen) return "held";
  if (input.sessions === 0) return input.daysSinceJoined <= 3 ? "new" : "never_logged";
  if (input.daysSinceLastSession === null) return "never_logged";
  if (input.daysSinceLastSession <= 7) return "active";
  if (input.daysSinceLastSession <= 21) return "slowing";
  return "lapsed";
}

export function buildOwnerOverview(
  accounts: AccountRow[],
  sessions: SessionRow[],
  holds: HoldRow[],
  now: Date = new Date(),
): OwnerOverview {
  const nowMs = now.getTime();
  const weekAgo = nowMs - 7 * DAY;

  const byOwner = new Map<string, SessionRow[]>();
  for (const session of sessions ?? []) {
    const list = byOwner.get(session.ownerId) ?? [];
    list.push(session);
    byOwner.set(session.ownerId, list);
  }
  const heldOwners = new Set((holds ?? []).map((hold) => hold.ownerId));

  const athletes: AthleteSummary[] = (accounts ?? []).map((account) => {
    const own = byOwner.get(account.ownerId) ?? [];
    const stamps = own.map((session) => time(session.createdAt)).filter(Boolean);
    const latest = stamps.length ? Math.max(...stamps) : null;
    const joined = time(account.firstSeenAt);
    const disciplines = [...new Set(own.map((session) => session.discipline).filter(Boolean))].slice(0, 4);
    const sparring = own.filter((session) => /spar|open mat/i.test(session.sessionType)).length;
    const daysSinceLastSession = latest === null ? null : daysBetween(latest, nowMs);
    const holdOpen = heldOwners.has(account.ownerId);
    return {
      ownerId: account.ownerId,
      name: account.displayName?.trim() || account.email?.split("@")[0] || "Athlete",
      email: account.email ?? "",
      joinedAt: account.firstSeenAt,
      lastSeenAt: account.lastSeenAt,
      daysSinceLastSession,
      sessions: own.length,
      sessionsThisWeek: stamps.filter((at) => at >= weekAgo).length,
      disciplines,
      sparringShare: own.length ? Math.round((sparring / own.length) * 100) : 0,
      debriefsCompleted: own.filter((session) => session.debriefComplete).length,
      holdOpen,
      state: stateFor({ holdOpen, sessions: own.length, daysSinceLastSession, daysSinceJoined: daysBetween(joined, nowMs) }),
    };
  });

  // Whoever needs attention first: held, then lapsed, then the least recently
  // active. An alphabetical roster tells an owner nothing.
  const ORDER: Record<AthleteSummary["state"], number> = { held: 0, lapsed: 1, slowing: 2, never_logged: 3, new: 4, active: 5 };
  athletes.sort((a, b) => ORDER[a.state] - ORDER[b.state]
    || (b.daysSinceLastSession ?? 9999) - (a.daysSinceLastSession ?? 9999)
    || b.sessions - a.sessions
    || a.name.localeCompare(b.name));

  const sessionCounts = athletes.map((athlete) => athlete.sessions);
  const totals = {
    athletes: athletes.length,
    signedUpThisWeek: athletes.filter((athlete) => time(athlete.joinedAt) >= weekAgo).length,
    activeThisWeek: athletes.filter((athlete) => athlete.sessionsThisWeek > 0).length,
    activeThisMonth: athletes.filter((athlete) => (athlete.daysSinceLastSession ?? 9999) <= 30).length,
    lapsed: athletes.filter((athlete) => athlete.state === "lapsed").length,
    neverLogged: athletes.filter((athlete) => athlete.state === "never_logged").length,
    sessions: (sessions ?? []).length,
    sessionsThisWeek: (sessions ?? []).filter((session) => time(session.createdAt) >= weekAgo).length,
    debriefsCompleted: (sessions ?? []).filter((session) => session.debriefComplete).length,
    holdsOpen: heldOwners.size,
  };

  const retention = {
    loggedOnce: sessionCounts.filter((count) => count >= 1).length,
    loggedTwice: sessionCounts.filter((count) => count >= 2).length,
    loggedFive: sessionCounts.filter((count) => count >= 5).length,
  };

  const headlines: string[] = [];
  if (!totals.athletes) {
    headlines.push("Nobody has signed in yet. The first athlete to open the app will appear here.");
  } else {
    headlines.push(`${plural(totals.athletes, "athlete", "athletes")} signed up, ${totals.activeThisWeek} of them training this week.`);
    if (retention.loggedOnce) {
      const stuck = retention.loggedOnce - retention.loggedTwice;
      headlines.push(stuck > 0
        ? `${plural(retention.loggedTwice, "athlete", "athletes")} came back for a second session. ${plural(stuck, "person", "people")} logged once and stopped.`
        : `Everyone who logged a session came back for another.`);
    }
    if (totals.neverLogged) headlines.push(`${plural(totals.neverLogged, "person", "people")} signed in but never logged a session.`);
    if (totals.lapsed) headlines.push(`${plural(totals.lapsed, "athlete", "athletes")} last trained more than three weeks ago.`);
    if (totals.holdsOpen) headlines.push(`${plural(totals.holdsOpen, "athlete is", "athletes are")} on a return to training hold right now.`);
  }

  return { totals, retention, athletes, headlines };
}

/** Plain label for a state, kept beside the logic that decides it. */
export function stateLabel(state: AthleteSummary["state"]): string {
  if (state === "held") return "On hold";
  if (state === "active") return "Training";
  if (state === "slowing") return "Slowing down";
  if (state === "lapsed") return "Lapsed";
  if (state === "never_logged") return "Never logged";
  return "Just joined";
}
