export type D1 = D1Database;

export async function ensureDebriefSchema(db: D1) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS training_debriefs (
      entry_id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      summary TEXT,
      takeaway TEXT,
      coach_detail TEXT,
      fightiq_explanation TEXT,
      next_session_focus TEXT,
      structured_memory_json TEXT,
      status TEXT NOT NULL,
      question_count INTEGER NOT NULL DEFAULT 0,
      confidence REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_training_debriefs_owner_status ON training_debriefs (owner_id, status)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS training_followups (
      id TEXT PRIMARY KEY NOT NULL,
      entry_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      question TEXT NOT NULL,
      choices_json TEXT NOT NULL,
      target_field TEXT NOT NULL,
      why_asked TEXT NOT NULL,
      answer TEXT,
      answer_source TEXT,
      status TEXT NOT NULL,
      confidence_before REAL NOT NULL,
      confidence_after REAL,
      created_at TEXT NOT NULL,
      answered_at TEXT
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_training_followups_entry_sequence ON training_followups (entry_id, sequence)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_training_followups_owner_status ON training_followups (owner_id, status)"),
  ]);
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

export async function finishDebrief(db: D1, entryId: string, ownerId: string) {
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE training_followups SET status = 'skipped', answer_source = 'finish', answered_at = ? WHERE entry_id = ? AND owner_id = ? AND status = 'pending'").bind(now, entryId, ownerId),
    db.prepare(`INSERT INTO training_debriefs (entry_id, owner_id, takeaway, structured_memory_json, next_session_focus, status, question_count, confidence, created_at, updated_at)
      VALUES (?, ?, 'Your training note is saved.', NULL, NULL, 'complete', 0, 0, ?, ?)
      ON CONFLICT(entry_id) DO UPDATE SET takeaway = excluded.takeaway, structured_memory_json = NULL, next_session_focus = NULL, status = 'complete', updated_at = excluded.updated_at`)
      .bind(entryId, ownerId, now, now),
  ]);
}
