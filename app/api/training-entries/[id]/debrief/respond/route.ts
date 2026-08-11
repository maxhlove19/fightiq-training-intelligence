import { DebriefAIError, generateDebrief } from "../../../../../../lib/debrief-ai";
import {
  claimDebriefGeneration, ensureDebriefSchema, finishDebrief, getDebriefRecord, getDebriefState, getFollowupHistory,
  getOwnedEntry, markDebriefError, markDebriefPreparing, releaseDebriefGeneration,
} from "../../../../../../lib/debrief-db";
import { apiError, getOwnerId, getRuntime, persistDebriefResult } from "../../../../../../lib/debrief-server";
import { ensureProductSchema, getExperimentForEntry, getMemorySnapshot, persistFighterBrainEvidence, updateExperimentForEntry } from "../../../../../../lib/product-db";
import { getOpenHold } from "../../../../../../lib/hold-db";
import { describeHold, trainingPermission } from "../../../../../../lib/return-to-training";
import { scanTrainingNote } from "../../../../../../lib/safety-signals";
import { readJsonObject } from "../../../../../../lib/request-body";

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

  // Every reply from this route replaces the debrief state the screen is holding,
  // so it has to carry the safety card and the hold with it. Dropping them here
  // used to make both vanish the moment the athlete answered a question.
  const safety = scanTrainingNote(entry.raw_entry);
  const openHold = await getOpenHold(db, ownerId);
  const holdView = openHold ? describeHold(openHold, new Date()) : null;
  const held = safety.holdTraining || !trainingPermission(openHold, new Date()).allowsSkillWork;
  const state = async (status?: number) => Response.json(
    { ...await getDebriefState(db, id, ownerId), safety, hold: holdView },
    status ? { status } : undefined,
  );

  const body = await readJsonObject(request) as Body | null;
  if (!body) return apiError("INVALID_REQUEST", "Invalid response.", 400);
  const action = body.action;
  if (action === "finish") {
    // Finish is a real write, not just a UI dismissal. It shares the same
    // lease as generation so a late model response cannot overwrite the
    // athlete's explicit decision to stop here.
    const leaseId = await claimDebriefGeneration(db, id, ownerId);
    if (!leaseId) return state(202);
    try {
      const finished = await finishDebrief(db, id, ownerId);
      if (finished.structuredMemory) await persistFighterBrainEvidence(db, ownerId, entry, finished.structuredMemory, finished.confidence);
      await db.prepare("UPDATE pre_training_briefs SET consumed_at = ? WHERE owner_id = ? AND consumed_at IS NULL")
        .bind(new Date().toISOString(), ownerId).run();
      await updateExperimentForEntry(db, ownerId, id, "inconclusive", "The athlete finished the debrief before there was enough evidence to judge the experiment.");
      return state();
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
  if (!leaseId) return state(202);
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
      // The debrief prompt is told to pitch at the athlete's level and to know
      // whether this is their first session. Both have to actually be sent.
      sessions_logged: memory.sessionsLogged,
      athlete_level: { experience: memory.experienceLevel, competing: memory.competitionIntent, disciplines: memory.disciplines },
      current_focus: memory.currentFocus,
      recurring_problems: memory.recurringProblems.slice(0, 3),
      emerging_strengths: memory.emergingStrengths.slice(0, 3),
      instructor_details: memory.instructorDetails.slice(0, 3),
      recent_training: memory.recentTraining.slice(0, 3).map((item) => ({ discipline: item.discipline, note: item.note.slice(0, 500), takeaway: item.takeaway, focus: item.focus })),
    };
    const result = await generateDebrief({ apiKey, allowMockAi, ownerId, entry, history, current, preTrainingBrief: experimentContext, activeExperiment: experimentContext, fighterBrain });
    // The hold has to be passed here too. Without it, answering a follow-up
    // re-wrote the debrief with a next-session drill the hold had just removed.
    await persistDebriefResult(db, id, ownerId, result, history.length + 1, held);
    if (result.status === "complete") await updateExperimentForEntry(db, ownerId, id, result.intelligence.experiment_result, result.summary);
    return state();
  } catch (error) {
    await markDebriefError(db, id, ownerId);
    const carried = { entrySaved: true, answerSaved: true, safety, hold: holdView };
    if (error instanceof DebriefAIError) return apiError(error.code, error.message, error.status, { ...carried, development: error.development });
    console.error("Unexpected FightIQ debrief response failure", error);
    return apiError("AI_UNAVAILABLE", "Your answer was saved, but FightIQ could not continue yet.", 503, carried);
  } finally { await releaseDebriefGeneration(db, id, ownerId, leaseId); }
}
