import { ensureProductSchema, getProductOwnerId, getProductRuntime, productError } from "../../../../../lib/product-db";
import { readJsonObject } from "../../../../../lib/request-body";

export const dynamic = "force-dynamic";

type Result = { exerciseKey?: unknown; completedSets?: unknown; reps?: unknown; load?: unknown; unit?: unknown; effort?: unknown };
const efforts = new Set(["easy", "right", "hard", "missed", "pain", "not_logged"]);

function nextStep(load: number | null, unit: "lb" | "kg", effort: string, reps: number | null, completedSets: number) {
  if (effort === "pain") return { nextAction: "Stop this movement and use the listed substitute next time. If pain persists, get qualified medical guidance.", nextLoad: null };
  if (load === null || reps === null || completedSets === 0) return { nextAction: "Log the final clean set next time so FightIQ can set your load.", nextLoad: null };
  const increment = unit === "kg" ? 2.5 : 5;
  if (effort === "easy" && reps >= 6) return { nextAction: `Add ${increment} ${unit} next time if your warm-up still feels clean.`, nextLoad: Math.round((load + increment) * 10) / 10 };
  if (effort === "hard" || effort === "missed") {
    const reduced = Math.max(unit === "kg" ? 2.5 : 5, Math.round((load * 0.95) * 10) / 10);
    return { nextAction: `Use ${reduced} ${unit} next time and own the full rep range.`, nextLoad: reduced };
  }
  return { nextAction: `Keep ${load} ${unit} next time. Add load only after it feels easier at the top of the rep range.`, nextLoad: load };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = await getProductOwnerId(); if (!ownerId) return productError("AUTH_REQUIRED", "Authentication required.", 401);
  const { db } = getProductRuntime(); if (!db) return productError("STORAGE_UNAVAILABLE", "Workouts are unavailable.", 503);
  const { id } = await params; if (!id || id.length > 100) return productError("INVALID_WORKOUT", "Invalid workout.", 400);
  const body = await readJsonObject(request) as { results?: unknown } | null;
  if (!body) return productError("INVALID_REQUEST", "Invalid workout results.", 400);
  const rawResults = Array.isArray(body.results) ? body.results.slice(0, 4) : [];
  await ensureProductSchema(db);
  const workout = await db.prepare("SELECT id, plan_json FROM workout_plans WHERE id = ? AND owner_id = ? LIMIT 1").bind(id, ownerId).first<{ id: string; plan_json: string }>();
  if (!workout) return productError("WORKOUT_NOT_FOUND", "That workout is no longer available.", 404);
  let plan: { exercises?: Array<{ key?: string; keyLift?: boolean }> } = {}; try { plan = JSON.parse(workout.plan_json) as typeof plan; } catch { /* no results can still mark it complete */ }
  const allowed = new Set((plan.exercises ?? []).filter((exercise) => exercise.keyLift && typeof exercise.key === "string").map((exercise) => exercise.key));
  const results = rawResults.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const item = raw as Result; const exerciseKey = typeof item.exerciseKey === "string" ? item.exerciseKey : "";
    if (!allowed.has(exerciseKey)) return [];
    const completedSets = typeof item.completedSets === "number" ? Math.max(0, Math.min(12, Math.round(item.completedSets))) : 0;
    const reps = typeof item.reps === "number" ? Math.max(0, Math.min(100, Math.round(item.reps))) : null;
    const load = typeof item.load === "number" && Number.isFinite(item.load) ? Math.max(0, Math.min(2000, Math.round(item.load * 10) / 10)) : null;
    // `as const` matters: without it the literal widens to string in the array
    // below, and the load progression stops being checked against its own units.
    const unit = item.unit === "kg" ? "kg" as const : "lb" as const;
    const effort = typeof item.effort === "string" && efforts.has(item.effort) ? item.effort : "not_logged";
    return [{ exerciseKey, completedSets, reps, load, unit, effort }];
  });
  const now = new Date().toISOString();
  const guidance = results.map((result) => ({ exerciseKey: result.exerciseKey, ...nextStep(result.load, result.unit, result.effort, result.reps, result.completedSets) }));
  const statements = results.map((result, index) => db.prepare(`INSERT INTO workout_performances
    (id, workout_id, owner_id, exercise_key, completed_sets, completed_reps, load_value, unit, effort, next_action, next_load_value, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workout_id, exercise_key) DO UPDATE SET completed_sets = excluded.completed_sets,
    completed_reps = excluded.completed_reps, load_value = excluded.load_value, unit = excluded.unit, effort = excluded.effort, next_action = excluded.next_action,
    next_load_value = excluded.next_load_value, created_at = excluded.created_at`)
    .bind(crypto.randomUUID(), id, ownerId, result.exerciseKey, result.completedSets, result.reps, result.load, result.unit, result.effort, guidance[index].nextAction, guidance[index].nextLoad, now));
  statements.push(db.prepare("UPDATE workout_plans SET status = 'completed', completed_at = ? WHERE id = ? AND owner_id = ?").bind(now, id, ownerId));
  await db.batch(statements);
  return Response.json({ ok: true, guidance: guidance.length ? guidance : [{ nextAction: "Workout saved. Log a key final set next time when you want a precise load recommendation.", nextLoad: null }] });
}
