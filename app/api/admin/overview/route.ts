import { getChatGPTUser } from "../../../chatgpt-auth";
import { readOwnerData } from "../../../../lib/accounts-db";
import { checkOwner } from "../../../../lib/owner-access";
import { buildOwnerOverview } from "../../../../lib/owner-overview";
import { ensureProductSchema, getProductRuntime, productError } from "../../../../lib/product-db";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  const { db, ownerEmails } = getProductRuntime();
  const owner = checkOwner(user?.email, ownerEmails);
  // The same answer either way. A stranger probing this endpoint learns nothing
  // about whether the dashboard exists or who is allowed to open it.
  if (!owner.allowed) return productError("NOT_FOUND", "Not found.", 404);
  if (!db) return productError("STORAGE_UNAVAILABLE", "FightIQ memory is unavailable.", 503);
  await ensureProductSchema(db);
  const { accounts, sessions, holds } = await readOwnerData(db);
  return Response.json(buildOwnerOverview(accounts, sessions, holds), { headers: { "cache-control": "no-store" } });
}
