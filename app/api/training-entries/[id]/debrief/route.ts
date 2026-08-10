import { DebriefAIError, generateDebrief } from "../../../../../lib/debrief-ai";
import {
  claimDebriefGeneration, ensureDebriefSchema, getDebriefRecord, getDebriefState, getFollowupHistory,
  getOwnedEntry, markDebriefError, markDebriefPreparing, releaseDebriefGeneration,
} from "../../../../../lib/debrief-db";
import { apiError, getOwnerId, getRuntime, persistDebriefResult } from "../../../../../lib/debrief-server";
import { scanTrainingNote } from "../../../../../lib/safety-signals";
import { ensureProductSchema, getExperimentForEntry, getMemorySnapshot, updateExperimentForEntry } from "../../../../../lib/product-db";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const ownerId = await getOwnerId();
  if (!ownerId) return apiError("AUTH_REQUIRED", "Authentication required.", 401);
  const { id } = await context.params;
  const { db } = getRuntime();
  if (!db) return apiError("STORAGE_UNAVAILABLE", "Training storage is unavailable.", 503);
  await ensureDebriefSchema(db);
  await ensureProductSchema(db);
  const entry = await getOwnedEntry(db, id, ownerId);
  if (!entry) return apiError("NOT_FOUND", "Training entry not found.", 404);
  return Response.json({ ...await getDebriefState(db, id, ownerId), safety: scanTrainingNote(entry.raw_entry) });
}

export async function POST(_request: Request, context: Context) {
  const ownerId = await getOwnerId();
  if (!ownerId) return apiError("AUTH_REQUIRED", "Authentication required.", 401);
  const { id } = await context.params;
  const { db, apiKey, allowMockAi } = getRuntime();
  if (!db) return apiError("STORAGE_UNAVAILABLE", "Training storage is unavailable.", 503, { entrySaved: true });
  await ensureDebriefSchema(db);
  await ensureProductSchema(db);
  const entry = await getOwnedEntry(db, id, ownerId);
  if (!entry) return apiError("NOT_FOUND", "Training entry not found.", 404);
  // Read on the raw note, before any model runs. A head knock has to be caught
  // even when the AI is unreachable, mocked, or simply wrong about the session.
  const safety = scanTrainingNote(entry.raw_entry);
  const existing = await getDebriefState(db, id, ownerId);
  if (existing.status === "question" || existing.status === "complete") return Response.json({ ...existing, safety });
  const leaseId = await claimDebriefGeneration(db, id, ownerId);
  // The client can safely poll this state. We never launch a second model call
  // for the same saved entry while another worker owns the generation.
  if (!leaseId) return Response.json({ ...await getDebriefState(db, id, ownerId), safety }, { status: 202 });
  await markDebriefPreparing(db, id, ownerId);
  const history = await getFollowupHistory(db, id, ownerId);
  const current = await getDebriefRecord(db, id, ownerId);
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
    const sequence = history.length + 1;
    await persistDebriefResult(db, id, ownerId, result, sequence, safety.holdTraining);
    if (result.status === "complete") await updateExperimentForEntry(db, ownerId, id, result.intelligence.experiment_result, result.summary);
    return Response.json({ ...await getDebriefState(db, id, ownerId), safety });
  } catch (error) {
    await markDebriefError(db, id, ownerId);
    if (error instanceof DebriefAIError) return apiError(error.code, error.message, error.status, { entrySaved: true, development: error.development });
    console.error("Unexpected FightIQ debrief failure", error);
    return apiError("AI_UNAVAILABLE", "FightIQ could not prepare the debrief.", 503, { entrySaved: true });
  } finally { await releaseDebriefGeneration(db, id, ownerId, leaseId); }
}
