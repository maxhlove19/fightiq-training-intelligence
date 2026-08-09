import { ensureProductSchema, getProductOwnerId, getProductRuntime, productError, startPreTrainingExperiment } from "../../../../lib/product-db";

export const dynamic = "force-dynamic";

export async function POST() {
  const ownerId = await getProductOwnerId();
  if (!ownerId) return productError("AUTH_REQUIRED", "Authentication required.", 401);
  const { db } = getProductRuntime();
  if (!db) return productError("STORAGE_UNAVAILABLE", "FightIQ memory is unavailable.", 503);
  await ensureProductSchema(db);
  return Response.json({ experiment: await startPreTrainingExperiment(db, ownerId) });
}
