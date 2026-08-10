import { getOpenHold } from "../../../../lib/hold-db";
import { ensureProductSchema, getProductOwnerId, getProductRuntime, productError, startPreTrainingExperiment } from "../../../../lib/product-db";
import { describeHold, sessionConflictsWithHold } from "../../../../lib/return-to-training";
import { scanTrainingNote } from "../../../../lib/safety-signals";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ownerId = await getProductOwnerId();
  if (!ownerId) return productError("AUTH_REQUIRED", "Authentication required.", 401);
  const { db } = getProductRuntime();
  if (!db) return productError("STORAGE_UNAVAILABLE", "FightIQ memory is unavailable.", 503);
  let body: { sessionPlan?: unknown } = {};
  try { body = await request.json() as { sessionPlan?: unknown }; } catch { return productError("INVALID_REQUEST", "Tell FightIQ what you are training first.", 400); }
  const sessionPlan = typeof body.sessionPlan === "string" ? body.sessionPlan.replace(/\s+/g, " ").trim() : "";
  if (sessionPlan.length < 2 || sessionPlan.length > 240) return productError("INVALID_SESSION_PLAN", "Tell FightIQ what you are training in one short line.", 422);
  // Setting a mission for tonight is FightIQ telling someone to go and train.
  // If the plan itself describes a head knock, it does not get to do that.
  const safety = scanTrainingNote(sessionPlan);
  if (safety.holdTraining) return Response.json({ experiment: null, safety, hold: null });
  await ensureProductSchema(db);

  // A hold opened days ago outranks a plan typed just now. This is the whole
  // point of persisting it: the card from Tuesday is still in force on Thursday.
  const hold = await getOpenHold(db, ownerId);
  const conflict = sessionConflictsWithHold(hold, sessionPlan, new Date());
  if (hold && conflict) return Response.json({ experiment: null, safety, hold: describeHold(hold, new Date()), conflict });

  return Response.json({
    experiment: await startPreTrainingExperiment(db, ownerId, sessionPlan),
    safety,
    hold: hold ? describeHold(hold, new Date()) : null,
  });
}
