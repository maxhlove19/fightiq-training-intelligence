import { DebriefAIError, generateDebrief } from "../../../../../../lib/debrief-ai";
import {
  claimDebriefGeneration, ensureDebriefSchema, finishDebrief, getDebriefRecord, getDebriefState, getFollowupHistory,
  getOwnedEntry, markDebriefError, markDebriefPreparing, releaseDebriefGeneration,
} from "../../../../../../lib/debrief-db";
import { apiError, getOwnerId, getRuntime, persistDebriefResult } from "../../../../../../lib/debrief-server";
import { ensureProductSchema, getExperimentForEntry, getMemorySnapshot, persistFighterBrainEvidence, updateExperimentForEntry } from "../../../../../../lib/product-db";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
type Body = { action?: unknown; questionId?: unknown; answer?: unknown; inputMethod?: unknown };

export async function POST(request: Request, context: Context) {
  const ownerId = await getOwnerId();
  if (!ownerId) return apiError("AUTH_REQUIRED", "Authentication required.", 401);
  const { id } = await context.params;
  const { db, apiKey, allowMockAi } = getRuntime();
  if (!db) return apiError("STORAGE_UNAVAILABLE", "Training storage is unavailable.", 503, { entrySaved: true });
  await ensureDebriefSchema(db);
  await ensureProductSchema(db);
  const entry = await getOwnedEntry(db, id, ownerId);
  if (!entry) return apiError("NOT_FOUND", "Training entry not found.", 404);

  let body: Body;
  try { body = await request.json(); } catch { return apiError("INVALID_REQUEST", "Invalid response.", 400); }
  const action = body.action;
  if (action === "finish") {
    // Finish is a real write, not just a UI dismissal. It shares the same
    // lease as generation so a late model response cannot overwrite the
    // athlete's explicit decision to stop here.
    const leaseId = await claimDebriefGeneration(db, id, ownerId);
    if (!leaseId) return Response.json(await getDebriefState(db, id, ownerId), { status: 202 });
    try {
      const finished = await finishDebrief(db, id, ownerId);
      if (finished.structuredMemory) await persistFighterBrainEvidence(db, ownerId, entry, finished.structuredMemory, finished.confidence);
      await db.prepare("UPDATE pre_training_briefs SET consumed_at = ? WHERE owner_id = ? AND consumed_at IS NULL")
        .bind(new Date().toISOString(), ownerId).run();
      await updateExperimentForEntry(db, ownerId, id, "inconclusive", "The athlete finished the debrief before there was enough evidence to judge the experiment.");
      return Response.json(await getDebriefState(db, id, ownerId));
    } finally { await releaseDebriefGeneration(db, id, ownerId, leaseId); }
  }
  if (action !== "answer" && action !== "skip") return apiError("INVALID_REQUEST", "Choose answer, skip, or finish.", 422);
  const questionId = typeof body.questionId === "string" ? body.questionId : "";
  const pending = await db.prepare(
    "SELECT id FROM training_followups WHERE id = ? AND entry_id = ? AND owner_id = ? AND status = 'pending' LIMIT 1"
  ).bind(questionId, id, ownerId).first<{ id: string }>();
  if (!pending) return apiError("QUESTION_NOT_FOUND", "This question is no longer active.", 409);
  const answer = typeof body.answer === "string" ? body.answer.trim() : "";
  if (action === "answer" && (answer.length < 1 || answer.length > 3000)) return apiError("INVALID_ANSWER", "Answer must be between 1 and 3,000 characters.", 422);
  const allowedInputMethods = new Set(["chip", "text", "voice"]);
  const inputMethod = typeof body.inputMethod === "string" && allowedInputMethods.has(body.inputMethod) ? body.inputMethod : "text";
  const now = new Date().toISOString();
  const leaseId = await claimDebriefGeneration(db, id, ownerId);
  if (!leaseId) return Response.json(await getDebriefState(db, id, ownerId), { status: 202 });
  const consumed = await db.prepare(`UPDATE training_followups SET answer = ?, answer_source = ?, status = ?, answered_at = ?
    WHERE id = ? AND entry_id = ? AND owner_id = ? AND status = 'pending'`)
    .bind(action === "skip" ? null : answer, action === "skip" ? "skip" : inputMethod, action === "skip" ? "skipped" : "answered", now, questionId, id, ownerId).run();
  if ((consumed.meta?.changes ?? 0) !== 1) {
    await releaseDebriefGeneration(db, id, ownerId, leaseId);
    return apiError("QUESTION_NOT_FOUND", "This question is no longer active.", 409);
  }

  const history = await getFollowupHistory(db, id, ownerId);
  const current = await getDebriefRecord(db, id, ownerId);
  await markDebriefPreparing(db, id, ownerId);
  try {
    const [experiment, memory] = await Promise.all([getExperimentForEntry(db, ownerId, id), getMemorySnapshot(db, ownerId)]);
    const experimentContext = experiment ? { mission: experiment.mission, cue: experiment.cue, reason: experiment.reason } : null;
    const fighterBrain = {
      current_focus: memory.currentFocus,
      recurring_problems: memory.recurringProblems.slice(0, 3),
      emerging_strengths: memory.emergingStrengths.slice(0, 3),
      instructor_details: memory.instructorDetails.slice(0, 3),
      recent_training: memory.recentTraining.slice(0, 3).map((item) => ({ discipline: item.discipline, note: item.note.slice(0, 500), takeaway: item.takeaway, focus: item.focus })),
    };
    const result = await generateDebrief({ apiKey, allowMockAi, ownerId, entry, history, current, preTrainingBrief: experimentContext, activeExperiment: experimentContext, fighterBrain });
    await persistDebriefResult(db, id, ownerId, result, history.length + 1);
    if (result.status === "complete") await updateExperimentForEntry(db, ownerId, id, result.intelligence.experiment_result, result.summary);
    return Response.json(await getDebriefState(db, id, ownerId));
  } catch (error) {
    await markDebriefError(db, id, ownerId);
    if (error instanceof DebriefAIError) return apiError(error.code, error.message, error.status, { entrySaved: true, answerSaved: true, development: error.development });
    console.error("Unexpected FightIQ debrief response failure", error);
    return apiError("AI_UNAVAILABLE", "Your answer was saved, but FightIQ could not continue yet.", 503, { entrySaved: true, answerSaved: true });
  } finally { await releaseDebriefGeneration(db, id, ownerId, leaseId); }
}
