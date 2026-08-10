import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../app/chatgpt-auth";
import type { DebriefResult } from "./debrief-ai";
import type { D1 } from "./debrief-db";

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
  // A completed experiment is evidence. A single untested observation is not enough
  // to silently replace the athlete's longer-term focus.
  const shouldPromoteFocus = result.status === "complete"
    && result.intelligence.experiment_result === "helped"
    && result.confidence >= 0.65
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
        result.next_session_focus, JSON.stringify({ ...result.memory, intelligence: result.intelligence }), status, result.status === "question" ? sequence : sequence - 1,
        result.confidence, now, now),
    db.prepare(`UPDATE training_followups SET confidence_after = ?
      WHERE entry_id = ? AND owner_id = ? AND sequence = ? AND status IN ('answered', 'skipped')`)
      .bind(result.confidence, entryId, ownerId, sequence - 1),
    ...(shouldPromoteFocus ? [db.prepare(`UPDATE fighter_profiles SET current_focus = ?, focus_reason = ?, updated_at = ? WHERE owner_id = ?`)
      .bind(result.next_session_focus || result.takeaway, result.fightiq_explanation || result.takeaway, now, ownerId)] : []),
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
}

export function apiError(code: string, message: string, status: number, extra: Record<string, unknown> = {}) {
  return Response.json({ error: { code, message }, ...extra }, { status });
}
