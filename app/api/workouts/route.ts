import { ensureProductSchema, getProductOwnerId, getProductRuntime, productError } from "../../../lib/product-db";

export const dynamic = "force-dynamic";

type Exercise = { name: string; dose: string; why: string; helps: string; intensity: string };
const plans: Record<string, Exercise[]> = {
  MMA: [
    { name: "Split-stance med-ball throw", dose: "4 × 4 each side", why: "Builds rotational force without slow grinding reps.", helps: "Punch-to-shot transitions and finishing power", intensity: "explosive" },
    { name: "Rear-foot elevated split squat", dose: "3 × 6 each side", why: "Single-leg strength supports stance changes and level changes.", helps: "Striking base, shots, and scramble stability", intensity: "strength" },
    { name: "Copenhagen plank", dose: "3 × 20 sec each side", why: "Groin and trunk strength help you resist being folded or widened.", helps: "Takedown defense and clinch control", intensity: "controlled" },
    { name: "Bike sprint repeat", dose: "6 × 15 sec / 45 sec easy", why: "Short bursts match the demand of explosive exchanges.", helps: "Repeat attacks without losing technique", intensity: "hard" },
  ],
  BJJ: [
    { name: "Paused Romanian deadlift", dose: "3 × 6", why: "Strengthens the hinge while teaching tension in stretched positions.", helps: "Guard posture, bridging, and finishing control", intensity: "strength" },
    { name: "Half-kneeling cable row", dose: "3 × 8 each side", why: "Builds pulling strength without relying on momentum.", helps: "Grip fighting and keeping elbows connected", intensity: "controlled" },
    { name: "Dead bug with band pulldown", dose: "3 × 8 each side", why: "Links lat tension to trunk control.", helps: "Frames, guard retention, and passing posture", intensity: "controlled" },
    { name: "Easy nasal-breathing circuit", dose: "8 minutes", why: "Adds capacity without another hard rolling session.", helps: "Recovery between positional exchanges", intensity: "easy" },
  ],
  Wrestling: [
    { name: "Trap-bar jump", dose: "5 × 3", why: "Trains force quickly from a wrestling-ready position.", helps: "Penetration steps and mat returns", intensity: "explosive" },
    { name: "Front-foot elevated split squat", dose: "3 × 6 each side", why: "Develops strength through the deep angles used in shots.", helps: "Finishing underneath an opponent", intensity: "strength" },
    { name: "Neck isometric series", dose: "3 × 15 sec each direction", why: "Controlled neck strength supports safer posture under pressure.", helps: "Hand fighting and resisting snaps", intensity: "controlled" },
    { name: "Sled push", dose: "6 × 15 m", why: "Lets you drive hard with less eccentric soreness.", helps: "Finishes and cage pressure", intensity: "hard" },
  ],
  Boxing: [
    { name: "Rotational med-ball scoop toss", dose: "4 × 4 each side", why: "Builds hip-to-hand speed with low fatigue.", helps: "Power that starts from the floor", intensity: "explosive" },
    { name: "Landmine press", dose: "3 × 8 each side", why: "Presses through a shoulder-friendly arc while the trunk resists rotation.", helps: "Punch structure and shoulder endurance", intensity: "controlled" },
    { name: "Lateral bound to stick", dose: "3 × 5 each side", why: "Teaches you to produce and absorb force side to side.", helps: "Angle changes and balanced exits", intensity: "explosive" },
    { name: "Jump-rope rhythm rounds", dose: "5 × 2 min / 30 sec easy", why: "Builds elastic foot rhythm without heavy leg fatigue.", helps: "Efficient movement through full rounds", intensity: "moderate" },
  ],
  "Muay Thai": [
    { name: "Rear-foot elevated split squat", dose: "3 × 6 each side", why: "Builds single-leg force and control.", helps: "Kicking balance, knees, and stance recovery", intensity: "strength" },
    { name: "Cable anti-rotation press", dose: "3 × 8 each side", why: "Trains the trunk to stay organized while force pulls you off line.", helps: "Clinch posture and balanced combinations", intensity: "controlled" },
    { name: "Calf isometric", dose: "3 × 30 sec each side", why: "Builds lower-leg capacity with little soreness.", helps: "Footwork, checking, and repeated kicks", intensity: "controlled" },
    { name: "Tempo bike", dose: "8 × 30 sec steady / 30 sec easy", why: "Builds round-to-round conditioning without extra impact.", helps: "Sustaining output late in pad rounds", intensity: "moderate" },
  ],
};

function buildPlan(discipline: string, fatigue: string, duration: number, recentSessions: number) {
  const base = plans[discipline] ?? plans.MMA;
  const highFatigue = fatigue === "high" || recentSessions >= 3;
  const limit = duration <= 25 ? 3 : 4;
  const selected = base.filter((exercise) => !highFatigue || !["hard", "strength"].includes(exercise.intensity)).slice(0, limit);
  if (selected.length < 3) selected.push(...base.filter((exercise) => !selected.includes(exercise) && exercise.intensity !== "hard").slice(0, 3 - selected.length));
  return {
    title: highFatigue ? `${discipline} recovery-support session` : `${discipline} performance session`,
    loadNote: highFatigue ? "Your recent martial-arts load is high, so this plan removes hard conditioning and heavy grinding work." : "This session adds qualities that support skill training without trying to replace it.",
    warmup: highFatigue ? "6 minutes easy movement, mobility, and nasal breathing" : "6 minutes movement prep, low pogo hops, and two technique-speed ramp sets",
    exercises: selected,
    finish: highFatigue ? "Stop feeling better than you started. No finisher today." : "Finish with 4 minutes easy cooldown breathing.",
  };
}

export async function GET() {
  const ownerId = await getProductOwnerId();
  if (!ownerId) return productError("AUTH_REQUIRED", "Authentication required.", 401);
  const { db } = getProductRuntime();
  if (!db) return productError("STORAGE_UNAVAILABLE", "Workouts are unavailable.", 503);
  await ensureProductSchema(db);
  const result = await db.prepare("SELECT id, discipline, goal, fatigue, duration_minutes, plan_json, status, created_at FROM workout_plans WHERE owner_id = ? ORDER BY created_at DESC LIMIT 8").bind(ownerId).all();
  return Response.json({ workouts: result.results ?? [] });
}

export async function POST(request: Request) {
  const ownerId = await getProductOwnerId();
  if (!ownerId) return productError("AUTH_REQUIRED", "Authentication required.", 401);
  const { db } = getProductRuntime();
  if (!db) return productError("STORAGE_UNAVAILABLE", "Workouts are unavailable.", 503);
  let body: { discipline?: unknown; goal?: unknown; fatigue?: unknown; duration?: unknown };
  try { body = await request.json(); } catch { return productError("INVALID_REQUEST", "Invalid workout request.", 400); }
  const discipline = typeof body.discipline === "string" && body.discipline in plans ? body.discipline : "MMA";
  const goal = typeof body.goal === "string" ? body.goal.slice(0, 80) : "Performance";
  const fatigue = ["low", "medium", "high"].includes(String(body.fatigue)) ? String(body.fatigue) : "medium";
  const duration = typeof body.duration === "number" ? Math.min(60, Math.max(20, Math.round(body.duration))) : 35;
  await ensureProductSchema(db);
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const recent = await db.prepare("SELECT COUNT(*) AS count FROM training_entries WHERE owner_id = ? AND created_at >= ?").bind(ownerId, cutoff).first<{ count: number }>();
  const plan = buildPlan(discipline, fatigue, duration, recent?.count ?? 0);
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db.prepare(`INSERT INTO workout_plans (id, owner_id, discipline, goal, fatigue, duration_minutes, plan_json, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'planned', ?)`)
    .bind(id, ownerId, discipline, goal, fatigue, duration, JSON.stringify(plan), createdAt).run();
  return Response.json({ id, discipline, goal, fatigue, duration, plan, createdAt }, { status: 201 });
}
