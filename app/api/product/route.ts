import { ensureProductSchema, getMemorySnapshot, getOrCreateProfile, getProductOwnerId, getProductRuntime, getTodayNutrition, productError } from "../../../lib/product-db";

export const dynamic = "force-dynamic";

const videoCatalog = [
  { id: "JYzGfyg-cig", title: "How to Escape Back Mount like a Black Belt", creator: "Chewjitsu", discipline: "MMA / BJJ", duration: "Deep dive", topics: ["back", "mount", "grappling", "escape", "mma"], description: "Build a safer first response when an opponent settles back control." },
  { id: "LXrXe9JUKsE", title: "8 Reasons Your Guard Retention Breaks Down", creator: "Chewjitsu", discipline: "MMA / BJJ", duration: "Technique", topics: ["guard", "retention", "hip", "frame", "grappling"], description: "Find the structural mistake that is letting opponents pass your legs." },
  { id: "L8ulYlpzWNc", title: "Basic Muay Thai Teep Tutorial", creator: "Muay Thai PROS", discipline: "Muay Thai / MMA", duration: "Tutorial", topics: ["teep", "distance", "striking", "balance", "kick"], description: "Use balance and the teep to manage distance before an opponent enters." },
  { id: "8kq7qd7QpwE", title: "Advanced Boxing Footwork Drill", creator: "Tony Jeffries", discipline: "Boxing / MMA", duration: "Quick drill", topics: ["boxing", "footwork", "exit", "balance", "striking"], description: "Keep your feet available to punch, defend, and exit after exchanges." },
  { id: "WZnT87UqcDA", title: "A Technical Mount Escape", creator: "Chewjitsu", discipline: "BJJ / MMA", duration: "Technique", topics: ["mount", "escape", "bridge", "grappling"], description: "Combine sound position with deliberate effort instead of wasting energy." },
  { id: "dLUhx1f8H6o", title: "Masters of the Teep", creator: "Muay Thai Scholar", discipline: "Muay Thai / MMA", duration: "Study", topics: ["teep", "distance", "timing", "striking"], description: "Study how elite strikers use the teep to control pace and center line." },
];

function personalizedVideos(memory: Awaited<ReturnType<typeof getMemorySnapshot>>) {
  const context = [memory.currentFocus, memory.buildNext, ...memory.recurringProblems, ...memory.recentTraining.map((item) => `${item.discipline} ${item.note}`)].join(" ").toLowerCase();
  return videoCatalog.map((video) => ({
    ...video,
    score: video.topics.reduce((score, topic) => score + (context.includes(topic) ? 3 : 0), video.discipline.includes("MMA") ? 1 : 0),
  })).sort((a, b) => b.score - a.score).slice(0, 4).map(({ score, ...video }, index) => ({
    ...video,
    thumbnail: `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`,
    url: `https://www.youtube.com/watch?v=${video.id}`,
    why: score > 1 ? `It connects directly to your current focus: ${memory.currentFocus}.` : index === 0 ? `It supports the next layer of your MMA game.` : `It develops a transferable skill without pulling you away from your current focus.`,
  }));
}

export async function GET() {
  const ownerId = await getProductOwnerId();
  if (!ownerId) return productError("AUTH_REQUIRED", "Authentication required.", 401);
  const { db } = getProductRuntime();
  if (!db) return productError("STORAGE_UNAVAILABLE", "FightIQ memory is unavailable.", 503);
  await ensureProductSchema(db);
  const [profile, memory, nutrition, recentWorkouts] = await Promise.all([
    getOrCreateProfile(db, ownerId),
    getMemorySnapshot(db, ownerId),
    getTodayNutrition(db, ownerId),
    db.prepare("SELECT id, discipline, goal, fatigue, duration_minutes, plan_json, status, created_at FROM workout_plans WHERE owner_id = ? ORDER BY created_at DESC LIMIT 3").bind(ownerId).all(),
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
    videos: personalizedVideos(memory),
    nutrition,
    recentWorkouts: recentWorkouts.results ?? [],
  });
}
