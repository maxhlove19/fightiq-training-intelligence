import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../app/chatgpt-auth";
import type { DebriefResult } from "./debrief-ai";
import type { D1 } from "./debrief-db";
import { persistFighterBrainEvidence } from "./product-db";

export async function getOwnerId() {
  const user = await getChatGPTUser();
  return user?.userId ?? (process.env.NODE_ENV !== "production" ? "preview-user" : null);
}

export function getRuntime() {
  const runtime = env as unknown as { DB?: D1; OPENAI_API_KEY?: string; FIGHTIQ_ALLOW_MOCK_AI?: string };
  return { db: runtime.DB, apiKey: runtime.OPENAI_API_KEY, allowMockAi: runtime.FIGHTIQ_ALLOW_MOCK_AI === "true" };
}

export async function persistDebriefResult(db: D1, entryId: string, ownerId: string, result: DebriefResult, sequence: number) {
  const now = new Date().toISOString();
  const status = result.status === "complete" ? "complete" : "question";
  const structuredMemory = JSON.stringify({ ...result.memory, intelligence: result.intelligence });
  // A recommendation can evolve after a high-confidence completed debrief. It is
  // not the same field as an athlete's manually pinned current focus.
  const shouldRecommendFocus = result.status === "complete"
    && result.confidence >= 0.7
    && Boolean(result.next_session_focus.trim());
  const statements = [
    db.prepare(`INSERT INTO training_debriefs (
      entry_id, owner_id, summary, takeaway, coach_detail, fightiq_explanation, next_session_focus,
      structured_memory_json, status, question_count, confidence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entry_id) DO UPDATE SET
      summary = excluded.summary, takeaway = excluded.takeaway, coach_detail = excluded.coach_detail,
      fightiq_explanation = excluded.fightiq_explanation, next_session_focus = excluded.next_session_focus,
      structured_memory_json = excluded.structured_memory_json, status = excluded.status,
      question_count = excluded.question_count, confidence = excluded.confidence, updated_at = excluded.updated_at`)
      .bind(entryId, ownerId, result.summary, result.takeaway, result.coach_detail, result.fightiq_explanation,
        result.next_session_focus, structuredMemory, status, result.status === "question" ? sequence : sequence - 1,
        result.confidence, now, now),
    db.prepare(`UPDATE training_followups SET confidence_after = ?
      WHERE entry_id = ? AND owner_id = ? AND sequence = ? AND status IN ('answered', 'skipped')`)
      .bind(result.confidence, entryId, ownerId, sequence - 1),
    ...(shouldRecommendFocus ? [db.prepare(`INSERT INTO fighter_focus_recommendations (owner_id, focus, reason, confidence, entry_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_id) DO UPDATE SET focus = excluded.focus, reason = excluded.reason,
        confidence = excluded.confidence, entry_id = excluded.entry_id, updated_at = excluded.updated_at`)
      .bind(ownerId, result.next_session_focus.trim().slice(0, 240), (result.fightiq_explanation || result.takeaway).trim().slice(0, 500), result.confidence, entryId, now)] : []),
    // A fresh completed conversation should create the next brief from the new
    // evidence, rather than revive a brief calculated before this session.
    ...(result.status === "complete" ? [db.prepare("UPDATE pre_training_briefs SET consumed_at = ? WHERE owner_id = ? AND consumed_at IS NULL")
      .bind(now, ownerId)] : []),
  ];
  if (result.status === "question") statements.push(
    db.prepare(`INSERT INTO training_followups (
      id, entry_id, owner_id, sequence, question, choices_json, target_field, why_asked,
      status, confidence_before, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
      .bind(crypto.randomUUID(), entryId, ownerId, sequence, result.question.prompt, JSON.stringify(result.question.choices),
        result.question.target_field, result.question.why_asked, result.confidence, now)
  );
  await db.batch(statements);
  if (result.status === "complete") {
    const entry = await db.prepare("SELECT id, discipline, created_at FROM training_entries WHERE id = ? AND owner_id = ? LIMIT 1")
      .bind(entryId, ownerId).first<{ id: string; discipline: string; created_at: string }>();
    if (entry) await persistFighterBrainEvidence(db, ownerId, entry, structuredMemory, result.confidence);
  }
}

export function apiError(code: string, message: string, status: number, extra: Record<string, unknown> = {}) {
  return Response.json({ error: { code, message }, ...extra }, { status });
}
