import { ensureProductSchema, getOrCreateProfile, getProductOwnerId, getProductRuntime, productError } from "../../../lib/product-db";
import { readJsonObject } from "../../../lib/request-body";

export const dynamic = "force-dynamic";
const goals = new Set(["cut", "maintain", "gain muscle", "performance"]);

export async function POST(request: Request) {
  const ownerId = await getProductOwnerId();
  if (!ownerId) return productError("AUTH_REQUIRED", "Authentication required.", 401);
  const { db } = getProductRuntime();
  if (!db) return productError("STORAGE_UNAVAILABLE", "FightIQ memory is unavailable.", 503);
  await ensureProductSchema(db);
  const existing = await getOrCreateProfile(db, ownerId);
  const body = await readJsonObject(request);
  if (!body) return productError("INVALID_REQUEST", "Invalid profile update.", 400);
  const currentFocus = typeof body.currentFocus === "string" ? body.currentFocus.trim().slice(0, 240) : existing.current_focus;
  const focusReason = typeof body.focusReason === "string" ? body.focusReason.trim().slice(0, 500) : existing.focus_reason;
  const primaryGoal = typeof body.primaryGoal === "string" && goals.has(body.primaryGoal) ? body.primaryGoal : existing.primary_goal;
  let existingInfluences: string[] = [];
  try { const parsed = JSON.parse(existing.style_influences_json); if (Array.isArray(parsed)) existingInfluences = parsed.filter((item): item is string => typeof item === "string"); } catch { /* keep empty */ }
  const styleInfluences = Array.isArray(body.styleInfluences) ? body.styleInfluences.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim().slice(0, 80)).slice(0, 8) : existingInfluences;
  const targets = body.targets && typeof body.targets === "object" && !Array.isArray(body.targets) ? body.targets as Record<string, unknown> : {};
  const clamp = (value: unknown, fallback: number, min: number, max: number) => typeof value === "number" && Number.isFinite(value) ? Math.round(Math.min(max, Math.max(min, value))) : fallback;
  await db.prepare(`UPDATE fighter_profiles SET current_focus = ?, focus_reason = ?, primary_goal = ?, style_influences_json = ?,
    calorie_target = ?, protein_target = ?, carb_target = ?, fat_target = ?, updated_at = ? WHERE owner_id = ?`)
    .bind(currentFocus, focusReason, primaryGoal, JSON.stringify(styleInfluences), clamp(targets.calories, existing.calorie_target, 800, 7000), clamp(targets.protein, existing.protein_target, 20, 500), clamp(targets.carbs, existing.carb_target, 20, 1000), clamp(targets.fat, existing.fat_target, 10, 400), new Date().toISOString(), ownerId).run();
  return Response.json({ ok: true });
}
