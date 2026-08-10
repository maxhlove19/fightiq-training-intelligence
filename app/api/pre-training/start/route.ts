import { ensureProductSchema, getProductOwnerId, getProductRuntime, productError, startPreTrainingExperiment } from "../../../../lib/product-db";

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
  await ensureProductSchema(db);
  return Response.json({ experiment: await startPreTrainingExperiment(db, ownerId, sessionPlan) });
}
