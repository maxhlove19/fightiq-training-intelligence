import { currentAthlete } from "../../../../lib/current-athlete";
import { checkOwner } from "../../../../lib/owner-access";
import { getCostReport } from "../../../../lib/model-cost";
import { ensureProductSchema, getProductRuntime, productError } from "../../../../lib/product-db";

export const dynamic = "force-dynamic";

/**
 * What the product spends, per active athlete.
 *
 * Owner only, and behind the same "Not found" as the rest of the admin surface,
 * so a stranger probing it learns nothing. Thirty days by default because that
 * is the window a subscription price has to clear.
 */
export async function GET(request: Request) {
  const athlete = await currentAthlete();
  const { db, ownerEmails } = getProductRuntime();
  const owner = checkOwner(athlete?.email, ownerEmails);
  if (!owner.allowed) return productError("NOT_FOUND", "Not found.", 404);
  if (!db) return productError("STORAGE_UNAVAILABLE", "FightIQ memory is unavailable.", 503);
  await ensureProductSchema(db);
  const days = Math.min(365, Math.max(1, Number(new URL(request.url).searchParams.get("days")) || 30));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  return Response.json(await getCostReport(db, since), { headers: { "cache-control": "no-store" } });
}
