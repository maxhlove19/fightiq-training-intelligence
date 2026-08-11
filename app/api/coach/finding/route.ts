// The athlete's verdict on the coach's verdict.
//
// Nothing the model decides reaches My Game on its own. A wrong finding written
// durably is worse than no finding, because it shapes every week after it and
// the athlete has no reason to doubt it. So the model proposes, this route
// records what the athlete says about the proposal, and only a confirmed one
// becomes part of their game.
//
// Retracting is the same route. Somebody finding out later that they were wrong
// is a normal part of training, and a record that cannot be corrected stops
// being trusted for everything else too.

import { ensureProductSchema, getProductOwnerId, getProductRuntime, productError } from "../../../../lib/product-db";
import { readJsonObject } from "../../../../lib/request-body";

export const dynamic = "force-dynamic";

type Verdict = "confirmed" | "rejected";

export async function POST(request: Request) {
  const ownerId = await getProductOwnerId();
  if (!ownerId) return productError("AUTH_REQUIRED", "Authentication required.", 401);
  const { db } = getProductRuntime();
  if (!db) return productError("STORAGE_UNAVAILABLE", "FightIQ memory is unavailable.", 503);
  await ensureProductSchema(db);

  const body = await readJsonObject(request);
  if (!body) return productError("INVALID_REQUEST", "That did not come through.", 400);
  // Two callers, two identifiers. Coach has the reply it belongs to, My Game has
  // the row. Both are unique and both are scoped to the owner below.
  const messageId = typeof body.messageId === "string" ? body.messageId.trim() : "";
  const findingId = typeof body.findingId === "string" ? body.findingId.trim() : "";
  const verdict: Verdict | "" = body.verdict === "confirmed" || body.verdict === "rejected" ? body.verdict : "";
  const handle = messageId || findingId;
  if (!handle || handle.length > 100 || !verdict) return productError("INVALID_REQUEST", "That did not come through.", 400);

  // A finding can be agreed to, or taken back later once it stops being true.
  // It cannot be un-rejected, and it cannot be agreed to twice, so a replayed
  // tap changes nothing.
  const allowedFrom = verdict === "confirmed" ? ["proposed"] : ["proposed", "confirmed"];
  const column = messageId ? "assistant_message_id" : "id";
  const now = new Date().toISOString();
  const result = await db.prepare(
    `UPDATE coach_findings SET status = ?, decided_at = ?
     WHERE ${column} = ? AND owner_id = ? AND status IN (${allowedFrom.map(() => "?").join(", ")})`
  ).bind(verdict, now, handle, ownerId, ...allowedFrom).run();

  // The same answer whether the row belongs to somebody else or does not exist.
  if (!result.meta?.changes) return productError("NOT_FOUND", "That finding is no longer there.", 404);
  return Response.json({ ok: true, status: verdict }, { headers: { "cache-control": "no-store" } });
}
