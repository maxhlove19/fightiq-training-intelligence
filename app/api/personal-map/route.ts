import { buildPersonalMap, type MapSession } from "../../../lib/personal-map";
import { ensureProductSchema, getProductOwnerId, getProductRuntime, productError } from "../../../lib/product-db";

export const dynamic = "force-dynamic";

/**
 * The positions actually named in one session's own debrief memory, and
 * nothing else. structured_memory_json is per entry_id, one row per session,
 * written from that session's raw note alone (see lib/debrief-ai.ts and
 * lib/debrief-server.ts). A question-stage debrief has no completed memory
 * yet, so this reads status = 'complete' only, the same bar Fighter Brain
 * evidence uses.
 */
function positionsFromMemory(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const positions = (parsed as Record<string, unknown>).positions;
    return Array.isArray(positions) ? positions.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}

/**
 * The athlete's own map: the graph a training log actually earns. Read-only,
 * and no model call anywhere on this path, because the map is a byproduct of
 * sessions already saved rather than something that needs interpreting.
 */
export async function GET() {
  const ownerId = await getProductOwnerId();
  if (!ownerId) return productError("AUTH_REQUIRED", "Authentication required.", 401);
  const { db } = getProductRuntime();
  if (!db) return productError("STORAGE_UNAVAILABLE", "FightIQ memory is unavailable.", 503);
  await ensureProductSchema(db);

  const result = await db.prepare(`SELECT e.created_at, d.structured_memory_json
    FROM training_entries e
    INNER JOIN training_debriefs d ON d.entry_id = e.id AND d.owner_id = e.owner_id
    WHERE e.owner_id = ? AND d.status = 'complete'
    ORDER BY e.created_at ASC`).bind(ownerId).all<{ created_at: string; structured_memory_json: string | null }>();
  const rows = result.results ?? [];
  const sessions: MapSession[] = rows.map((row) => ({
    createdAt: row.created_at,
    positions: positionsFromMemory(row.structured_memory_json),
  }));
  return Response.json(buildPersonalMap(sessions));
}
