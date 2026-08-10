import { buildLearnFeed } from "../../../lib/video-recommendations";
import { ensureProductSchema, getActiveTrainingExperiment, getMemorySnapshot, getOrCreatePreTrainingBrief, getOrCreateProfile, getProductOwnerId, getProductRuntime, getTodayNutrition, productError } from "../../../lib/product-db";

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
  const [profile, memory, nutrition, recentWorkouts] = await Promise.all([
    getOrCreateProfile(db, ownerId),
    getMemorySnapshot(db, ownerId),
    getTodayNutrition(db, ownerId),
    db.prepare("SELECT id, discipline, goal, fatigue, duration_minutes, plan_json, status, created_at FROM workout_plans WHERE owner_id = ? ORDER BY created_at DESC LIMIT 3").bind(ownerId).all(),
  ]);
  const cursor = refreshCursor(request);
  const topic = requestedTopic(request);
  const [preTrainingBrief, learn, activeExperiment] = await Promise.all([
    getOrCreatePreTrainingBrief(db, ownerId, memory),
    buildLearnFeed({ db, ownerId, memory, youtubeApiKey, refreshCursor: cursor, topicOverride: topic }),
    getActiveTrainingExperiment(db, ownerId),
  ]);
  return Response.json({
    profile: {
      currentFocus: profile.current_focus,
      focusReason: profile.focus_reason,
      primaryGoal: profile.primary_goal,
      styleInfluences: JSON.parse(profile.style_influences_json || "[]"),
      targets: { calories: profile.calorie_target, protein: profile.protein_target, carbs: profile.carb_target, fat: profile.fat_target },
    },
    memory,
    insight: {
      title: memory.recurringProblems[0]?.includes("No recurring") ? "FightIQ is learning your patterns." : "Your game is showing a pattern.",
      body: memory.focusReason,
      currentFocus: memory.currentFocus,
    },
    videos: learn.videos,
    learn: { studyTopic: learn.studyTopic, exploreUrl: learn.exploreUrl, liveDiscoveryAvailable: learn.liveDiscoveryAvailable, refreshed: learn.refreshed },
    preTrainingBrief,
    activeExperiment: activeExperiment ? { id: activeExperiment.id, mission: activeExperiment.mission, cue: activeExperiment.cue, reason: activeExperiment.reason, startedAt: activeExperiment.started_at } : null,
    nutrition,
    recentWorkouts: recentWorkouts.results ?? [],
  });
}
