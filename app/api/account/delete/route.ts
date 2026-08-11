import { deleteAccountData } from "../../../../lib/account-deletion";
import { withoutSession } from "../../../../lib/auth-routes";
import { ensureProductSchema, getProductOwnerId, getProductRuntime, productError } from "../../../../lib/product-db";
import { readJsonObject } from "../../../../lib/request-body";

export const dynamic = "force-dynamic";

/**
 * Self-service deletion. Hard delete, everything FightIQ has under this
 * athlete's owner id, done once and not reversible.
 *
 * App data only: the Supabase auth row, if one exists, is untouched. Deleting
 * it needs the service role key, this app has never held one, and adding that
 * credential for one route is not worth what it would put at risk. Both
 * sign-in doors still work afterward; there is simply nothing left behind
 * them for FightIQ to show.
 *
 * `confirm` has to be the literal word DELETE. The screen that calls this
 * makes someone type it, so a body without it means the request did not come
 * from that screen.
 */
export async function POST(request: Request) {
  const ownerId = await getProductOwnerId();
  if (!ownerId) return productError("AUTH_REQUIRED", "Authentication required.", 401);
  const body = await readJsonObject(request);
  if (body?.confirm !== "DELETE") return productError("CONFIRMATION_REQUIRED", "Type DELETE to confirm.", 422);
  const { db, uploads } = getProductRuntime();
  if (!db) return productError("STORAGE_UNAVAILABLE", "FightIQ memory is unavailable.", 503);
  await ensureProductSchema(db);
  await deleteAccountData(db, uploads, ownerId);
  return withoutSession({ ok: true });
}
