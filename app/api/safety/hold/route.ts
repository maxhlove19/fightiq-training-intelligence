import { actOnOpenHold, getOpenHold } from "../../../../lib/hold-db";
import { ensureProductSchema, getProductOwnerId, getProductRuntime, productError } from "../../../../lib/product-db";
import { describeHold, type HoldAction } from "../../../../lib/return-to-training";
import { readJsonObject } from "../../../../lib/request-body";

export const dynamic = "force-dynamic";

const ACTIONS = new Set(["advance", "setback", "record_medical_clearance", "close", "dismiss"]);

async function view(db: Parameters<typeof getOpenHold>[0], ownerId: string) {
  const hold = await getOpenHold(db, ownerId);
  return hold ? describeHold(hold, new Date()) : null;
}

export async function GET() {
  const ownerId = await getProductOwnerId();
  if (!ownerId) return productError("AUTH_REQUIRED", "Authentication required.", 401);
  const { db } = getProductRuntime();
  if (!db) return productError("STORAGE_UNAVAILABLE", "FightIQ memory is unavailable.", 503);
  await ensureProductSchema(db);
  return Response.json({ hold: await view(db, ownerId) }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const ownerId = await getProductOwnerId();
  if (!ownerId) return productError("AUTH_REQUIRED", "Authentication required.", 401);
  const { db } = getProductRuntime();
  if (!db) return productError("STORAGE_UNAVAILABLE", "FightIQ memory is unavailable.", 503);

  const body = await readJsonObject(request) as { action?: unknown; symptomFree?: unknown } | null;
  if (!body) return productError("INVALID_REQUEST", "That step could not be read.", 400);
  const action = typeof body.action === "string" ? body.action : "";
  if (!ACTIONS.has(action)) return productError("INVALID_ACTION", "That is not a step this hold has.", 422);

  await ensureProductSchema(db);
  // Every guard lives in applyHoldAction, so a replayed or hand-made request
  // gets the same refusal the button would have.
  const request_: HoldAction = action === "advance"
    ? { type: "advance", symptomFree: body.symptomFree === true }
    : { type: action as "setback" | "record_medical_clearance" | "close" | "dismiss" };
  const { error } = await actOnOpenHold(db, ownerId, request_);
  return Response.json({ hold: await view(db, ownerId), error }, { headers: { "cache-control": "no-store" } });
}
