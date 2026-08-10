// Storage for the return-to-training hold. The rules live in
// return-to-training.ts; this only moves rows.

import type { D1 } from "./debrief-db";
import { applyHoldAction, type Hold, type HoldAction, type HoldReason } from "./return-to-training";

type HoldRow = {
  id: string;
  reason: string;
  entry_id: string | null;
  matched_json: string;
  opened_at: string;
  step: number;
  step_entered_at: string;
  medical_cleared_at: string | null;
  cleared_at: string | null;
  setbacks: number;
};

function parseMatched(value: string): string[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, 8) : [];
  } catch { return []; }
}

function toHold(row: HoldRow): Hold {
  return {
    id: row.id,
    reason: row.reason === "acute_injury" ? "acute_injury" : "head_impact",
    entryId: row.entry_id,
    matched: parseMatched(row.matched_json),
    openedAt: row.opened_at,
    step: Number(row.step) || 1,
    stepEnteredAt: row.step_entered_at,
    medicalClearedAt: row.medical_cleared_at,
    clearedAt: row.cleared_at,
    setbacks: Number(row.setbacks) || 0,
  };
}

export async function getOpenHold(db: D1, ownerId: string): Promise<Hold | null> {
  const row = await db.prepare(
    "SELECT id, reason, entry_id, matched_json, opened_at, step, step_entered_at, medical_cleared_at, cleared_at, setbacks FROM training_holds WHERE owner_id = ? AND cleared_at IS NULL ORDER BY opened_at DESC LIMIT 1"
  ).bind(ownerId).first<HoldRow>();
  return row ? toHold(row) : null;
}

/**
 * Opens a hold for a note that described a head knock or an injury, unless one
 * is already open. A second knock during an existing hold is a setback, not a
 * second hold — an athlete should never be looking at two ladders.
 */
export async function openHoldForNote(
  db: D1,
  ownerId: string,
  input: { reason: HoldReason; entryId: string | null; matched: string[] },
): Promise<Hold> {
  const existing = await getOpenHold(db, ownerId);
  const now = new Date().toISOString();
  if (existing) {
    // A head impact outranks an injury hold: the ladder is longer and the
    // clearance requirement is stricter, so it is the one to be on.
    const promote = input.reason === "head_impact" && existing.reason === "acute_injury";
    const setback = applyHoldAction(existing, { type: "setback" }, now);
    const updated: Hold = promote
      ? { ...setback.hold, reason: "head_impact", step: 1, matched: input.matched, entryId: input.entryId }
      : setback.hold;
    await saveHold(db, ownerId, updated);
    return updated;
  }
  const hold: Hold = {
    id: crypto.randomUUID(),
    reason: input.reason,
    entryId: input.entryId,
    matched: input.matched.slice(0, 8),
    openedAt: now,
    step: 1,
    stepEnteredAt: now,
    medicalClearedAt: null,
    clearedAt: null,
    setbacks: 0,
  };
  await db.prepare(
    `INSERT INTO training_holds (id, owner_id, reason, entry_id, matched_json, opened_at, step, step_entered_at, medical_cleared_at, cleared_at, setbacks, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?)`
  ).bind(hold.id, ownerId, hold.reason, hold.entryId, JSON.stringify(hold.matched), hold.openedAt, hold.step, hold.stepEnteredAt, now).run();
  return hold;
}

export async function saveHold(db: D1, ownerId: string, hold: Hold): Promise<void> {
  await db.prepare(
    `UPDATE training_holds SET reason = ?, matched_json = ?, step = ?, step_entered_at = ?, medical_cleared_at = ?, cleared_at = ?, setbacks = ?, updated_at = ?
     WHERE id = ? AND owner_id = ?`
  ).bind(
    hold.reason, JSON.stringify(hold.matched), hold.step, hold.stepEnteredAt,
    hold.medicalClearedAt, hold.clearedAt, hold.setbacks, new Date().toISOString(), hold.id, ownerId,
  ).run();
}

/** Applies an action to whatever hold is open, and persists it if it changed. */
export async function actOnOpenHold(db: D1, ownerId: string, action: HoldAction): Promise<{ hold: Hold | null; error: string }> {
  const hold = await getOpenHold(db, ownerId);
  if (!hold) return { hold: null, error: "No hold is open." };
  const result = applyHoldAction(hold, action, new Date());
  if (result.changed) await saveHold(db, ownerId, result.hold);
  return { hold: result.hold, error: result.error };
}
