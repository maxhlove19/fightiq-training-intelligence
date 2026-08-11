import { ensureProductSchema, getProductOwnerId, getProductRuntime, productError } from "../../../lib/product-db";
import { readJsonObject } from "../../../lib/request-body";
import { getWeightRecord, isUsableWeight, recordWeighIn } from "../../../lib/weight-history";

export const dynamic = "force-dynamic";

/**
 * Log today's weight.
 *
 * Deliberately its own route rather than a field on the profile: a weigh-in is
 * an event with a date, and putting it on the profile is exactly the mistake
 * that lost every previous one.
 */
export async function POST(request: Request) {
  const ownerId = await getProductOwnerId();
  if (!ownerId) return productError("AUTH_REQUIRED", "Authentication required.", 401);
  const { db } = getProductRuntime();
  if (!db) return productError("STORAGE_UNAVAILABLE", "FightIQ memory is unavailable.", 503);
  await ensureProductSchema(db);
  const body = await readJsonObject(request);
  const weightKg = typeof body?.weightKg === "number" ? Math.round(body.weightKg * 10) / 10 : NaN;
  if (!isUsableWeight(weightKg)) {
    return productError("INVALID_REQUEST", "That weight does not look right. Enter it in kilograms.", 400);
  }
  await recordWeighIn(db, ownerId, { weightKg, source: "logged", now: new Date().toISOString() });
  // The whole record back, so the screen can show the new curve without a
  // second round trip and without waiting on a revalidation.
  return Response.json({ weight: await getWeightRecord(db, ownerId) });
}
