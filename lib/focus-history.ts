// What the athlete has actually worked on, and when.
//
// Until now "current focus" was one field the app overwrote whenever the
// evidence moved. That makes the app unable to answer the only question worth
// paying for after month one: did the thing you told me to work on actually
// change anything? The answer to that is a sequence, and the sequence was being
// thrown away every time it advanced.
//
// It is also the one kind of data loss that cannot be repaired later. A layout
// bug can be fixed next week and the athlete sees the fix. A month of focus
// changes nobody wrote down is gone, and no amount of later work brings it back.
// That is why this landed before the design work rather than after it.
//
// Session counts are derived from training_entries by date range rather than
// stored, so a count can never drift out of step with the sessions it claims.

import type { D1 } from "./debrief-db";

export type FocusSource = "stated" | "fightiq" | "opening" | "backfilled";

export type FocusPeriod = {
  id: string;
  focus: string;
  reason: string;
  source: FocusSource;
  startedAt: string;
  /** Null while this is the focus they are on. */
  endedAt: string | null;
  /** Sessions logged inside the period, counted from the entries themselves. */
  sessions: number;
  /** Distinct calendar days trained inside it. Two sessions in one night is one day. */
  days: number;
  /** How long it has been live, or was live. At least 1, because a focus set today has lasted a day. */
  spanDays: number;
  disciplines: Array<{ name: string; sessions: number }>;
  /** The last thing a completed debrief said inside the period. What they left it saying. */
  closingTakeaway: string | null;
};

/** Two focuses are the same focus if they only differ by case, spacing or a full stop. */
export function sameFocus(left: string, right: string) {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return normalize(left) === normalize(right);
}

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

/**
 * Note the focus the athlete is on, opening a new period when it has changed.
 *
 * Called from the read path on purpose. The current focus is a derived value
 * that can change without anybody pressing anything, when a debrief produces new
 * evidence, so the only reliable moment to record it is the moment it is
 * decided. Doing nothing is the common case and costs one indexed lookup.
 *
 * The insert is guarded by WHERE NOT EXISTS rather than a read-then-write, so two
 * requests arriving together cannot both open a period.
 */
export async function recordFocus(db: D1, ownerId: string, args: {
  focus: string;
  reason: string;
  source: FocusSource;
  now: string;
  /**
   * When the athlete already has training but no history, the first period
   * starts at their first session rather than at this instant. Otherwise the
   * record opens by claiming they have trained zero times on their current
   * focus, which is false and is the first thing they would read.
   */
  firstSessionAt?: string | null;
}) {
  const focus = args.focus.replace(/\s+/g, " ").trim();
  if (!focus) return;
  const open = await db.prepare("SELECT id, focus, reason FROM focus_periods WHERE owner_id = ? AND ended_at IS NULL LIMIT 1")
    .bind(ownerId).first<{ id: string; focus: string; reason: string }>();
  if (open) {
    if (sameFocus(open.focus, focus)) {
      // The same focus with a better explanation behind it is not a new period.
      if (args.reason && args.reason !== open.reason) {
        await db.prepare("UPDATE focus_periods SET reason = ? WHERE id = ?").bind(args.reason, open.id).run();
      }
      return;
    }
    await db.prepare("UPDATE focus_periods SET ended_at = ? WHERE id = ? AND ended_at IS NULL").bind(args.now, open.id).run();
  }
  const startedAt = !open && args.firstSessionAt ? args.firstSessionAt : args.now;
  const source = !open && args.firstSessionAt ? "backfilled" : args.source;
  await db.prepare(`INSERT INTO focus_periods (id, owner_id, focus, reason, source, started_at, ended_at)
    SELECT ?, ?, ?, ?, ?, ?, NULL
    WHERE NOT EXISTS (SELECT 1 FROM focus_periods WHERE owner_id = ? AND ended_at IS NULL)`)
    .bind(crypto.randomUUID(), ownerId, focus, args.reason ?? "", source, startedAt, ownerId).run();
}

type PeriodRow = { id: string; focus: string; reason: string; source: string; started_at: string; ended_at: string | null };
type EntryRow = { discipline: string | null; created_at: string; takeaway: string | null; debrief_status: string | null };

/**
 * The whole history, newest first, with every count derived from the sessions.
 *
 * Two queries rather than a correlated subquery per period: the periods, then
 * every session, bucketed in memory. An athlete has tens of periods and hundreds
 * of sessions at most, and this keeps the counting rules in one readable place
 * instead of spread across SQL.
 */
export async function getFocusHistory(db: D1, ownerId: string, limit = 24): Promise<FocusPeriod[]> {
  const [periodResult, entryResult] = await Promise.all([
    db.prepare("SELECT id, focus, reason, source, started_at, ended_at FROM focus_periods WHERE owner_id = ? ORDER BY started_at DESC, id DESC LIMIT ?")
      .bind(ownerId, limit).all<PeriodRow>(), // id is the tiebreaker, not rowid: rowid is SQLite only.
    db.prepare(`SELECT e.discipline, e.created_at, d.takeaway, d.status AS debrief_status
      FROM training_entries e LEFT JOIN training_debriefs d ON d.entry_id = e.id AND d.owner_id = e.owner_id
      WHERE e.owner_id = ? ORDER BY e.created_at ASC`).bind(ownerId).all<EntryRow>(),
  ]);
  const periods = periodResult.results ?? [];
  const entries = entryResult.results ?? [];
  return periods.map((period) => {
    const inside = entries.filter((entry) => entry.created_at >= period.started_at && (!period.ended_at || entry.created_at < period.ended_at));
    const byDiscipline = new Map<string, { name: string; sessions: number }>();
    for (const entry of inside) {
      const name = (entry.discipline ?? "").replace(/\s+/g, " ").trim();
      if (!name) continue;
      const existing = byDiscipline.get(name.toLowerCase()) ?? { name, sessions: 0 };
      existing.sessions += 1;
      byDiscipline.set(name.toLowerCase(), existing);
    }
    const closing = [...inside].reverse().find((entry) => entry.debrief_status === "complete" && entry.takeaway);
    const endedAt = period.ended_at;
    const finished = endedAt ? Date.parse(endedAt) : Date.now();
    const elapsed = finished - Date.parse(period.started_at);
    return {
      id: period.id,
      focus: period.focus,
      reason: period.reason,
      source: (["stated", "fightiq", "opening", "backfilled"].includes(period.source) ? period.source : "fightiq") as FocusSource,
      startedAt: period.started_at,
      endedAt,
      sessions: inside.length,
      days: new Set(inside.map((entry) => dayKey(entry.created_at))).size,
      // A focus set this morning has lasted a day, not zero days.
      spanDays: Math.max(1, Math.ceil(elapsed / 86_400_000) || 1),
      disciplines: [...byDiscipline.values()].sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name)),
      closingTakeaway: closing?.takeaway ?? null,
    };
  });
}

export type TrainingLifetime = {
  sessions: number;
  days: number;
  firstSessionAt: string | null;
  latestSessionAt: string | null;
  disciplines: Array<{ name: string; sessions: number }>;
};

/**
 * Everything they have ever logged, not the last seven days of it.
 *
 * My Game could only ever say "11 sessions logged across 1 day", because the only
 * summary in the app was a rolling seven day window. Five days later those same
 * eleven sessions fall out of that window and the screen says no sessions at all,
 * which is the product quietly forgetting the athlete in front of it.
 */
export async function getTrainingLifetime(db: D1, ownerId: string): Promise<TrainingLifetime> {
  const result = await db.prepare("SELECT discipline, created_at FROM training_entries WHERE owner_id = ? ORDER BY created_at ASC")
    .bind(ownerId).all<{ discipline: string | null; created_at: string }>();
  const rows = result.results ?? [];
  const byDiscipline = new Map<string, { name: string; sessions: number }>();
  for (const row of rows) {
    const name = (row.discipline ?? "").replace(/\s+/g, " ").trim();
    if (!name) continue;
    const existing = byDiscipline.get(name.toLowerCase()) ?? { name, sessions: 0 };
    existing.sessions += 1;
    byDiscipline.set(name.toLowerCase(), existing);
  }
  return {
    sessions: rows.length,
    days: new Set(rows.map((row) => dayKey(row.created_at))).size,
    firstSessionAt: rows[0]?.created_at ?? null,
    latestSessionAt: rows.at(-1)?.created_at ?? null,
    disciplines: [...byDiscipline.values()].sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name)),
  };
}
