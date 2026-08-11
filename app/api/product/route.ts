import { currentAthlete } from "../../../lib/current-athlete";
import { recordAthleteVisit } from "../../../lib/accounts-db";
import { buildLearnFeed } from "../../../lib/video-recommendations";
import { ensureProductSchema, getActiveTrainingExperiment, getAthleteSetup, getMemorySnapshot, getOrCreatePreTrainingBrief, getOrCreateProfile, getProductOwnerId, getProductRuntime, getConfirmedFindings, getTodayNutrition, productError } from "../../../lib/product-db";
import { openingFromMemory } from "../../../lib/first-session";
import { homeInsight } from "../../../lib/home-insight";
import { getFocusHistory, getTrainingLifetime } from "../../../lib/focus-history";
import { getWeightRecord } from "../../../lib/weight-history";

export const dynamic = "force-dynamic";

function refreshCursor(request: Request) {
  const raw = Number(new URL(request.url).searchParams.get("cursor") ?? "0");
  return Number.isInteger(raw) && raw > 0 && raw < 10000 ? raw : 0;
}

function requestedTopic(request: Request) {
  const value = new URL(request.url).searchParams.get("topic")?.replace(/\s+/g, " ").trim() ?? "";
  return value.length >= 2 && value.length <= 140 ? value : undefined;
}

export async function GET(request: Request) {
  const ownerId = await getProductOwnerId();
  if (!ownerId) return productError("AUTH_REQUIRED", "Authentication required.", 401);
  const { db, youtubeApiKey } = getProductRuntime();
  if (!db) return productError("STORAGE_UNAVAILABLE", "FightIQ memory is unavailable.", 503);
  await ensureProductSchema(db);
  // Every screen loads this first, so it is where an anonymous id becomes an
  // account somebody can see. A failure here must never cost an athlete their
  // home screen, so it is allowed to fail on its own.
  try {
    const athlete = await currentAthlete();
    if (athlete) await recordAthleteVisit(db, { userId: athlete.id, email: athlete.email, displayName: athlete.displayName });
  } catch { /* the roster can miss a visit; the athlete cannot miss their app */ }

  const [profile, memory, nutrition, recentWorkouts, trainingCount, foodCount] = await Promise.all([
    getOrCreateProfile(db, ownerId),
    getMemorySnapshot(db, ownerId),
    getTodayNutrition(db, ownerId),
    db.prepare("SELECT id, discipline, goal, fatigue, duration_minutes, plan_json, status, created_at FROM workout_plans WHERE owner_id = ? ORDER BY created_at DESC LIMIT 3").bind(ownerId).all(),
    db.prepare("SELECT COUNT(*) AS count FROM training_entries WHERE owner_id = ?").bind(ownerId).first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM nutrition_entries WHERE owner_id = ?").bind(ownerId).first<{ count: number }>(),
  ]);
  const cursor = refreshCursor(request);
  const topic = requestedTopic(request);
  const athleteSetup = getAthleteSetup(profile);
  const recommendationMemory = athleteSetup.disciplines.length
    ? { ...memory, oneTimeObservations: [...memory.oneTimeObservations, `${athleteSetup.disciplines.join(" ")} ${athleteSetup.sessionTypes.join(" ")} ${athleteSetup.competitionIntent}`] }
    : memory;
  // Read after getMemorySnapshot, never alongside it: that call is what decides
  // the current focus and therefore what opens or closes a period, so reading in
  // parallel would race the write and show a history one request out of date.
  const [preTrainingBrief, learn, activeExperiment] = await Promise.all([
    getOrCreatePreTrainingBrief(db, ownerId, memory),
    buildLearnFeed({ db, ownerId, memory: recommendationMemory, youtubeApiKey, refreshCursor: cursor, topicOverride: topic }),
    getActiveTrainingExperiment(db, ownerId),
  ]);
  const [focusHistory, lifetime, weight] = await Promise.all([
    getFocusHistory(db, ownerId),
    getTrainingLifetime(db, ownerId),
    getWeightRecord(db, ownerId),
  ]);
  const confirmedFindings = await getConfirmedFindings(db, ownerId);
  const latestCompletedTraining = memory.recentTraining.find((entry) => Boolean(entry.takeaway));
  // Day one has no training to read, which used to mean the largest card on the
  // home screen said the app knew nothing. It knows what they just spent six
  // screens telling it, so it says the thing that is usually true at their level
  // and is honest that it is a hypothesis rather than a read on their game.
  const opening = openingFromMemory(memory);
  return Response.json({
    profile: {
      currentFocus: profile.current_focus,
      focusReason: profile.focus_reason,
      primaryGoal: profile.primary_goal,
      styleInfluences: JSON.parse(profile.style_influences_json || "[]"),
      targets: { calories: profile.calorie_target, protein: profile.protein_target, carbs: profile.carb_target, fat: profile.fat_target },
      athleteSetup,
    },
    onboarding: { status: profile.onboarding_completed_at ? "complete" : ((trainingCount?.count ?? 0) || (foodCount?.count ?? 0)) ? "legacy" : "required" },
    memory,
    // What they have worked on and for how long, and everything they have ever
    // logged rather than the last seven days of it.
    focusHistory,
    lifetime,
    /** Every weigh-in on record, oldest first. See lib/weight-history.ts. */
    weight,
    // The headline is the finding, not a label describing the card. See
    // lib/home-insight.ts.
    insight: {
      ...homeInsight({
        opening,
        latestTakeaway: latestCompletedTraining?.takeaway,
        latestFocus: latestCompletedTraining?.focus,
        focusReason: memory.focusReason,
      }),
      currentFocus: memory.currentFocus,
    },
    opening,
    confirmedFindings,
    sessionsLogged: memory.sessionsLogged,
    videos: learn.videos,
    learn: { studyTopic: learn.studyTopic, exploreUrl: learn.exploreUrl, liveDiscoveryAvailable: learn.liveDiscoveryAvailable, refreshed: learn.refreshed },
    preTrainingBrief,
    activeExperiment: activeExperiment ? { id: activeExperiment.id, mission: activeExperiment.mission, cue: activeExperiment.cue, reason: activeExperiment.reason, startedAt: activeExperiment.started_at } : null,
    nutrition,
    recentWorkouts: recentWorkouts.results ?? [],
  });
}
