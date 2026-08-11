// Counting what an account has already started, from rows the app already
// writes. No new table, no write on the hot path: both queries are covered by
// indexes that exist for other reasons.

import type { D1 } from "./debrief-db";
import { type UsageCounts, usageWindows } from "./usage-limits";

async function countSince(db: D1, sql: string, ownerId: string, since: string) {
  const row = await db.prepare(sql).bind(ownerId, since).first<{ total: number }>();
  return Number(row?.total) || 0;
}

/** Sessions logged recently — the number of debriefs this account can have started. */
export async function countRecentSessions(db: D1, ownerId: string, now: Date = new Date()): Promise<UsageCounts> {
  const { hourAgo, dayAgo } = usageWindows(now);
  const sql = "SELECT COUNT(*) AS total FROM training_entries WHERE owner_id = ? AND created_at >= ?";
  return { lastHour: await countSince(db, sql, ownerId, hourAgo), lastDay: await countSince(db, sql, ownerId, dayAgo) };
}

/** Questions the athlete has asked Coach recently. Their own turns only. */
export async function countRecentCoachQuestions(db: D1, ownerId: string, now: Date = new Date()): Promise<UsageCounts> {
  const { hourAgo, dayAgo } = usageWindows(now);
  const sql = "SELECT COUNT(*) AS total FROM coach_messages WHERE owner_id = ? AND role = 'user' AND created_at >= ?";
  return { lastHour: await countSince(db, sql, ownerId, hourAgo), lastDay: await countSince(db, sql, ownerId, dayAgo) };
}
