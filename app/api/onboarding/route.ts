import { calculateStartingMacros, validateOnboarding } from "../../../lib/athlete-onboarding";
import { ensureProductSchema, getProductOwnerId, getProductRuntime, productError } from "../../../lib/product-db";
import { startingFocus } from "../../../lib/session-cue";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ownerId = await getProductOwnerId();
  if (!ownerId) return productError("AUTH_REQUIRED", "Authentication required.", 401);
  const { db } = getProductRuntime();
  if (!db) return productError("STORAGE_UNAVAILABLE", "FightIQ memory is unavailable.", 503);
  let body: unknown;
  try { body = await request.json(); } catch { return productError("INVALID_REQUEST", "Invalid athlete setup.", 400); }
  const validation = validateOnboarding(body);
  if (!validation.input) return productError("INVALID_ONBOARDING", validation.error ?? "Check your athlete setup.", 422);
  await ensureProductSchema(db);
  const input = validation.input;
  const targets = calculateStartingMacros(input);
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO fighter_profiles (owner_id, onboarding_completed_at, athlete_setup_json, current_focus, focus_reason, primary_goal, style_influences_json, calorie_target, protein_target, carb_target, fat_target, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_id) DO UPDATE SET onboarding_completed_at = excluded.onboarding_completed_at, athlete_setup_json = excluded.athlete_setup_json,
      current_focus = excluded.current_focus, focus_reason = excluded.focus_reason, primary_goal = excluded.primary_goal,
      style_influences_json = excluded.style_influences_json, calorie_target = excluded.calorie_target, protein_target = excluded.protein_target,
      carb_target = excluded.carb_target, fat_target = excluded.fat_target, updated_at = excluded.updated_at`)
    .bind(
      ownerId, now, JSON.stringify({
        disciplines: input.disciplines, experienceLevel: input.experienceLevel, sessionsPerWeek: input.sessionsPerWeek,
        sessionTypes: input.sessionTypes, competitionIntent: input.competitionIntent, age: input.age, calculatorSex: input.calculatorSex,
        heightCm: input.heightCm, weightKg: input.weightKg, dietaryRestrictions: input.dietaryRestrictions, foodPreferences: input.foodPreferences,
        foodsToAvoid: input.foodsToAvoid, mealsPerDay: input.mealsPerDay, trainingTime: input.trainingTime,
      }),
      // "Build a stronger Muay Thai game" names the sport and nothing else. A
      // starting focus has to be something an athlete can act on tonight.
      input.currentFocus || startingFocus(input.disciplines),
      input.currentFocus ? "Set during your athlete setup." : "Your starting focus will sharpen as FightIQ learns from your training.",
      input.primaryGoal, JSON.stringify(input.styleInfluences), targets?.calories ?? 2400, targets?.protein ?? 180,
      targets?.carbs ?? 260, targets?.fat ?? 70, now, now,
    ).run();
  return Response.json({ ok: true, targets, profile: { primaryGoal: input.primaryGoal, disciplines: input.disciplines } }, { status: 201 });
}

