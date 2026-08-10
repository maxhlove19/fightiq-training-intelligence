import { APP_SCHEMA } from "./schema";

export type D1 = D1Database;

export async function ensureDebriefSchema(db: D1) {
  await db.batch(APP_SCHEMA.map((statement) => db.prepare(statement)));
}

export async function getOwnedEntry(db: D1, entryId: string, ownerId: string) {
  return db.prepare(
    "SELECT id, discipline, session_type, raw_entry, created_at FROM training_entries WHERE id = ? AND owner_id = ? LIMIT 1"
  ).bind(entryId, ownerId).first<{ id: string; discipline: string; session_type: string; raw_entry: string; created_at: string }>();
}

type DebriefRow = {
  entry_id: string; summary: string | null; takeaway: string | null; coach_detail: string | null;
  fightiq_explanation: string | null; next_session_focus: string | null; structured_memory_json: string | null;
  status: string; question_count: number; confidence: number; updated_at: string;
};

type FollowupRow = {
  id: string; sequence: number; question: string; choices_json: string; target_field: string;
  why_asked: string; answer: string | null; answer_source: string | null; status: string;
  confidence_before: number; confidence_after: number | null;
};

export async function getDebriefState(db: D1, entryId: string, ownerId: string) {
  const debrief = await db.prepare(
    "SELECT * FROM training_debriefs WHERE entry_id = ? AND owner_id = ? LIMIT 1"
  ).bind(entryId, ownerId).first<DebriefRow>();
  if (!debrief) return { entryId, status: "not_started" as const };

  const followups = await db.prepare(
    "SELECT * FROM training_followups WHERE entry_id = ? AND owner_id = ? ORDER BY sequence ASC"
  ).bind(entryId, ownerId).all<FollowupRow>();
  const rows = followups.results ?? [];
  const pending = rows.find((row) => row.status === "pending");
  const answeredCount = rows.filter((row) => row.status === "answered").length;
  const base = {
    entryId,
    summary: debrief.summary,
    takeaway: debrief.takeaway ?? "Your training note is saved.",
    fightiqExplanation: debrief.fightiq_explanation,
    nextSessionFocus: debrief.next_session_focus,
    answeredCount,
    questionCount: rows.length,
    memoryUpdated: debrief.status === "complete" && Boolean(debrief.structured_memory_json),
    coachDetail: debrief.coach_detail,
  };
  if (debrief.status === "complete") return { ...base, status: "complete" as const };
  if (pending) return {
    ...base,
    status: "question" as const,
    question: {
      id: pending.id,
      sequence: pending.sequence,
      prompt: pending.question,
      choices: safeChoices(pending.choices_json),
      targetField: pending.target_field,
    },
  };
  return { ...base, status: debrief.status === "error" ? "error" as const : "preparing" as const };
}

function safeChoices(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, 3) : [];
  } catch { return []; }
}

export async function getFollowupHistory(db: D1, entryId: string, ownerId: string) {
  const result = await db.prepare(
    "SELECT sequence, question, answer, answer_source, status, target_field FROM training_followups WHERE entry_id = ? AND owner_id = ? ORDER BY sequence ASC"
  ).bind(entryId, ownerId).all<{ sequence: number; question: string; answer: string | null; answer_source: string | null; status: string; target_field: string }>();
  return result.results ?? [];
}

export async function getDebriefRecord(db: D1, entryId: string, ownerId: string) {
  return db.prepare(
    "SELECT summary, takeaway, coach_detail, fightiq_explanation, next_session_focus, structured_memory_json, status, question_count, confidence FROM training_debriefs WHERE entry_id = ? AND owner_id = ? LIMIT 1"
  ).bind(entryId, ownerId).first<Record<string, unknown>>();
}

export async function markDebriefPreparing(db: D1, entryId: string, ownerId: string) {
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO training_debriefs (entry_id, owner_id, status, question_count, confidence, created_at, updated_at)
    VALUES (?, ?, 'preparing', 0, 0, ?, ?)
    ON CONFLICT(entry_id) DO UPDATE SET status = 'preparing', updated_at = excluded.updated_at`)
    .bind(entryId, ownerId, now, now).run();
}

export async function markDebriefError(db: D1, entryId: string, ownerId: string) {
  await db.prepare("UPDATE training_debriefs SET status = 'error', updated_at = ? WHERE entry_id = ? AND owner_id = ?")
    .bind(new Date().toISOString(), entryId, ownerId).run();
}

const DEBRIEF_LEASE_MS = 45_000;

/**
 * One debrief generation may own an entry at a time. A lease expires so a
 * crashed worker cannot leave a saved training note in “preparing” forever.
 */
export async function claimDebriefGeneration(db: D1, entryId: string, ownerId: string) {
  const now = new Date();
  const leaseId = crypto.randomUUID();
  await db.prepare("DELETE FROM debrief_generation_leases WHERE entry_id = ? AND owner_id = ? AND expires_at <= ?")
    .bind(entryId, ownerId, now.toISOString()).run();
  const claimed = await db.prepare(`INSERT OR IGNORE INTO debrief_generation_leases (entry_id, owner_id, lease_id, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)`)
    .bind(entryId, ownerId, leaseId, new Date(now.getTime() + DEBRIEF_LEASE_MS).toISOString(), now.toISOString()).run();
  return (claimed.meta?.changes ?? 0) === 1 ? leaseId : null;
}

export async function releaseDebriefGeneration(db: D1, entryId: string, ownerId: string, leaseId: string) {
  await db.prepare("DELETE FROM debrief_generation_leases WHERE entry_id = ? AND owner_id = ? AND lease_id = ?")
    .bind(entryId, ownerId, leaseId).run();
}

function preservedArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 1).map((item) => item.replace(/\s+/g, " ").trim()).slice(0, 8)
    : [];
}

// Finishing early means “don't infer more,” not “forget what the athlete and
// coach already said.” This preserves factual context at low confidence while
// removing tentative problems, causes, and recommendations.
function conservativeFinishMemory(value: string | null, coachDetail: string | null, answeredFacts: string[] = []) {
  try {
    const parsed = JSON.parse(value ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const memory = parsed as Record<string, unknown>;
    const intelligence = memory.intelligence && typeof memory.intelligence === "object" && !Array.isArray(memory.intelligence)
      ? memory.intelligence as Record<string, unknown>
      : {};
    const coachCues = [...preservedArray(memory.instructor_details), ...(coachDetail?.trim() ? [coachDetail.trim()] : []), ...(typeof intelligence.coach_instructor_cue === "string" && intelligence.coach_instructor_cue.trim() ? [intelligence.coach_instructor_cue.trim()] : [])]
      .filter((item, index, values) => values.indexOf(item) === index).slice(0, 4);
    // The most important thing to retain during a timeout/error is the
    // athlete's actual answer. It belongs in durable factual memory even when
    // FightIQ never got a chance to interpret it.
    const facts = [...preservedArray(memory.reported_facts), ...preservedArray(intelligence.reported_facts), ...answeredFacts]
      .filter((item, index, values) => values.indexOf(item) === index).slice(0, 8);
    const technique = typeof intelligence.technique === "string" ? intelligence.technique.trim().slice(0, 160) : "";
    return JSON.stringify({
      techniques: preservedArray(memory.techniques), positions: preservedArray(memory.positions), successes: [], problems: [],
      concepts: preservedArray(memory.concepts), sparring_observations: [], related_topics: preservedArray(memory.related_topics), instructor_details: coachCues,
      reported_facts: facts, fightiq_hypotheses: [], what_worked: [], what_failed: [], experiments: preservedArray(memory.experiments),
      intelligence: {
        discipline: typeof intelligence.discipline === "string" ? intelligence.discipline.slice(0, 80) : "",
        technique, goal: "", problem: "", suspected_cause: "", coach_instructor_cue: coachCues[0] ?? "",
        what_worked: "", what_failed: "", context: typeof intelligence.context === "string" ? intelligence.context.slice(0, 120) : "",
        confidence: 0.25, follow_up_needed: false, reported_facts: facts, fightiq_hypotheses: [], experiment_result: "unknown",
      },
    });
  } catch { return null; }
}

export async function finishDebrief(db: D1, entryId: string, ownerId: string) {
  const now = new Date().toISOString();
  const [existing, answers] = await Promise.all([
    db.prepare(`SELECT summary, takeaway, coach_detail, structured_memory_json, question_count
      FROM training_debriefs WHERE entry_id = ? AND owner_id = ? LIMIT 1`)
      .bind(entryId, ownerId).first<{ summary: string | null; takeaway: string | null; coach_detail: string | null; structured_memory_json: string | null; question_count: number | null }>(),
    db.prepare(`SELECT answer FROM training_followups
      WHERE entry_id = ? AND owner_id = ? AND status = 'answered' AND answer IS NOT NULL
      ORDER BY sequence ASC`).bind(entryId, ownerId).all<{ answer: string }>(),
  ]);
  const answeredFacts = (answers.results ?? []).map((row) => row.answer.replace(/\s+/g, " ").trim().slice(0, 500)).filter(Boolean).slice(0, 5);
  const preservedMemory = conservativeFinishMemory(existing?.structured_memory_json ?? null, existing?.coach_detail ?? null, answeredFacts);
  const takeaway = existing?.takeaway?.trim() || "Your training note is saved.";
  const confidence = preservedMemory ? 0.25 : 0;
  await db.batch([
    db.prepare("UPDATE training_followups SET status = 'skipped', answer_source = 'finish', confidence_after = ?, answered_at = ? WHERE entry_id = ? AND owner_id = ? AND status = 'pending'").bind(confidence, now, entryId, ownerId),
    db.prepare(`INSERT INTO training_debriefs (entry_id, owner_id, summary, takeaway, coach_detail, structured_memory_json, next_session_focus, status, question_count, confidence, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, 'complete', ?, ?, ?, ?)
      ON CONFLICT(entry_id) DO UPDATE SET summary = excluded.summary, takeaway = excluded.takeaway,
        coach_detail = excluded.coach_detail, structured_memory_json = excluded.structured_memory_json,
        fightiq_explanation = NULL, next_session_focus = NULL, status = 'complete', confidence = excluded.confidence, updated_at = excluded.updated_at`)
      .bind(entryId, ownerId, existing?.summary ?? null, takeaway, existing?.coach_detail ?? null, preservedMemory, existing?.question_count ?? 0, confidence, now, now),
  ]);
  return { structuredMemory: preservedMemory, confidence };
}
