// Turning a sign-in into an account somebody can see.
//
// The platform hands each request a stable id, an email and sometimes a name.
// Nothing was keeping any of it, so an owner could not tell whether they had
// five athletes or five hundred. One upsert on a screen the app already loads
// is enough.

import type { D1 } from "./debrief-db";
import type { AccountRow, HoldRow, SessionRow } from "./owner-overview";

export type VisitingAthlete = { userId: string; email?: string | null; fullName?: string | null; displayName?: string | null };

/** Records that this athlete opened the app. Cheap enough to run on every load. */
export async function recordAthleteVisit(db: D1, user: VisitingAthlete): Promise<void> {
  const now = new Date().toISOString();
  const name = (user.fullName || user.displayName || "").trim().slice(0, 120) || null;
  const email = (user.email || "").trim().slice(0, 200) || null;
  await db.prepare(
    `INSERT INTO athlete_accounts (owner_id, email, display_name, first_seen_at, last_seen_at, visits)
     VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(owner_id) DO UPDATE SET
       last_seen_at = excluded.last_seen_at,
       visits = athlete_accounts.visits + 1,
       email = COALESCE(excluded.email, athlete_accounts.email),
       display_name = COALESCE(excluded.display_name, athlete_accounts.display_name)`
  ).bind(user.userId, email, name, now, now).run();
}

/**
 * Everything the dashboard reads, in three queries.
 *
 * Note the session query selects no note text. The exclusion lives here, at the
 * database, rather than in whatever renders it, so no future screen can leak an
 * athlete's own words by accident.
 */
export async function readOwnerData(db: D1): Promise<{ accounts: AccountRow[]; sessions: SessionRow[]; holds: HoldRow[] }> {
  const accountRows = await db.prepare(
    "SELECT owner_id, email, display_name, first_seen_at, last_seen_at, visits FROM athlete_accounts ORDER BY first_seen_at DESC LIMIT 2000"
  ).all<{ owner_id: string; email: string | null; display_name: string | null; first_seen_at: string; last_seen_at: string; visits: number }>();

  const sessionRows = await db.prepare(
    `SELECT e.owner_id, e.discipline, e.session_type, e.created_at, d.status AS debrief_status
     FROM training_entries e LEFT JOIN training_debriefs d ON d.entry_id = e.id AND d.owner_id = e.owner_id
     ORDER BY e.created_at DESC LIMIT 20000`
  ).all<{ owner_id: string; discipline: string; session_type: string; created_at: string; debrief_status: string | null }>();

  const holdRows = await db.prepare(
    "SELECT owner_id, reason, opened_at FROM training_holds WHERE cleared_at IS NULL"
  ).all<{ owner_id: string; reason: string; opened_at: string }>();

  return {
    accounts: (accountRows.results ?? []).map((row) => ({
      ownerId: row.owner_id, email: row.email, displayName: row.display_name,
      firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at, visits: Number(row.visits) || 0,
    })),
    sessions: (sessionRows.results ?? []).map((row) => ({
      ownerId: row.owner_id, discipline: row.discipline, sessionType: row.session_type,
      createdAt: row.created_at, debriefComplete: row.debrief_status === "complete",
    })),
    holds: (holdRows.results ?? []).map((row) => ({ ownerId: row.owner_id, reason: row.reason, openedAt: row.opened_at })),
  };
}
