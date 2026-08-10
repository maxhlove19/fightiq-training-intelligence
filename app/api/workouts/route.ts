import { personalizeWorkoutPlan } from "../../../lib/product-ai";
import { ensureProductSchema, getMemorySnapshot, getProductOwnerId, getProductRuntime, productError } from "../../../lib/product-db";

export const dynamic = "force-dynamic";

const equipmentChoices = ["bodyweight", "bands", "dumbbells", "kettlebells", "barbell rack", "bench", "cables machines", "cardio", "sled med ball", "full gym"] as const;
type Equipment = typeof equipmentChoices[number];
type Setup = { equipment: Equipment[]; location: string; defaultDuration: number; unit: "lb" | "kg"; limitations: string };
type Exercise = {
  key: string; name: string; equipment: Equipment[]; substitute: string; sets: number; reps: string; repMax: number; rest: string;
  target: string; why: string; helps: string; intensity: "explosive" | "strength" | "controlled" | "moderate"; keyLift?: boolean;
};

const library: Record<string, Exercise[]> = {
  MMA: [
    { key: "split-squat", name: "Rear-foot elevated split squat", equipment: ["dumbbells", "kettlebells", "barbell rack", "bench", "full gym"], substitute: "Bodyweight split squat", sets: 3, reps: "6 each side", repMax: 6, rest: "90 sec", target: "2 reps left", why: "Single-leg strength supports stance changes and level changes.", helps: "Shots, scrambles, and striking base", intensity: "strength", keyLift: true },
    { key: "med-ball-throw", name: "Split-stance med-ball throw", equipment: ["sled med ball", "full gym"], substitute: "Explosive band punch", sets: 4, reps: "4 each side", repMax: 4, rest: "60 sec", target: "Fast and crisp", why: "Builds rotational force without slow grinding reps.", helps: "Punch-to-shot transitions", intensity: "explosive" },
    { key: "copenhagen", name: "Copenhagen plank", equipment: ["bench", "full gym", "bodyweight"], substitute: "Side plank with top-leg lift", sets: 3, reps: "20 sec each side", repMax: 20, rest: "45 sec", target: "Controlled", why: "Builds groin and trunk strength.", helps: "Clinch pressure and takedown defense", intensity: "controlled" },
    { key: "bike-repeat", name: "Bike sprint repeat", equipment: ["cardio", "full gym"], substitute: "Shadow-sprawl intervals", sets: 6, reps: "15 sec work / 45 sec easy", repMax: 15, rest: "45 sec easy", target: "Sharp, not redline", why: "Trains repeat bursts without extra sparring volume.", helps: "Explosive exchanges", intensity: "moderate" },
  ],
  BJJ: [
    { key: "rdl", name: "Paused Romanian deadlift", equipment: ["dumbbells", "kettlebells", "barbell rack", "full gym"], substitute: "Single-leg bodyweight hinge", sets: 3, reps: "6", repMax: 6, rest: "90 sec", target: "2 reps left", why: "Builds hinge strength and tension in stretched positions.", helps: "Guard posture and bridging", intensity: "strength", keyLift: true },
    { key: "row", name: "Half-kneeling row", equipment: ["cables machines", "bands", "dumbbells", "full gym"], substitute: "Towel row isometric", sets: 3, reps: "8 each side", repMax: 8, rest: "75 sec", target: "2 reps left", why: "Builds pulling strength without momentum.", helps: "Grip fighting and elbow connection", intensity: "controlled", keyLift: true },
    { key: "deadbug", name: "Dead bug with pulldown", equipment: ["bands", "cables machines", "full gym"], substitute: "Slow dead bug", sets: 3, reps: "8 each side", repMax: 8, rest: "45 sec", target: "Ribs down", why: "Links lat tension to trunk control.", helps: "Frames and guard retention", intensity: "controlled" },
  ],
  Wrestling: [
    { key: "split-squat", name: "Front-foot elevated split squat", equipment: ["dumbbells", "kettlebells", "barbell rack", "bench", "full gym"], substitute: "Paused reverse lunge", sets: 3, reps: "6 each side", repMax: 6, rest: "90 sec", target: "2 reps left", why: "Develops strength through deep wrestling angles.", helps: "Penetration steps and finishes", intensity: "strength", keyLift: true },
    { key: "neck-iso", name: "Neck isometric series", equipment: ["bands", "bodyweight", "full gym"], substitute: "Hand-resisted neck isometric", sets: 3, reps: "15 sec each direction", repMax: 15, rest: "45 sec", target: "No pain", why: "Controlled neck work supports stronger posture.", helps: "Hand fighting and snaps", intensity: "controlled" },
    { key: "sled-push", name: "Sled push", equipment: ["sled med ball", "full gym"], substitute: "Bear crawl", sets: 6, reps: "15 m", repMax: 15, rest: "60 sec", target: "Drive, don't grind", why: "Lets you drive hard with less soreness.", helps: "Mat returns and cage pressure", intensity: "moderate" },
  ],
  Boxing: [
    { key: "landmine-press", name: "Landmine press", equipment: ["barbell rack", "full gym"], substitute: "Half-kneeling dumbbell press", sets: 3, reps: "8 each side", repMax: 8, rest: "75 sec", target: "2 reps left", why: "Builds pressing strength through a shoulder-friendly arc.", helps: "Punch structure and shoulder endurance", intensity: "strength", keyLift: true },
    { key: "rotational-throw", name: "Rotational med-ball scoop toss", equipment: ["sled med ball", "full gym"], substitute: "Explosive band punch", sets: 4, reps: "4 each side", repMax: 4, rest: "60 sec", target: "Fast and crisp", why: "Builds hip-to-hand speed with low fatigue.", helps: "Power from the floor", intensity: "explosive" },
    { key: "lateral-bound", name: "Lateral bound to stick", equipment: ["bodyweight"], substitute: "Lateral step-to-stick", sets: 3, reps: "5 each side", repMax: 5, rest: "45 sec", target: "Own the landing", why: "Teaches force production and balanced exits.", helps: "Angles and footwork", intensity: "explosive" },
  ],
  "Muay Thai": [
    { key: "split-squat", name: "Rear-foot elevated split squat", equipment: ["dumbbells", "kettlebells", "barbell rack", "bench", "full gym"], substitute: "Bodyweight split squat", sets: 3, reps: "6 each side", repMax: 6, rest: "90 sec", target: "2 reps left", why: "Builds single-leg force and control.", helps: "Kicking balance and stance recovery", intensity: "strength", keyLift: true },
    { key: "pallof", name: "Cable anti-rotation press", equipment: ["cables machines", "bands", "full gym"], substitute: "Band anti-rotation press", sets: 3, reps: "8 each side", repMax: 8, rest: "60 sec", target: "Stay square", why: "Trains the trunk to resist being pulled off line.", helps: "Clinch posture and balance", intensity: "controlled", keyLift: true },
    { key: "calf-iso", name: "Calf isometric", equipment: ["bodyweight", "dumbbells", "full gym"], substitute: "Two-leg calf isometric", sets: 3, reps: "30 sec each side", repMax: 30, rest: "45 sec", target: "Steady hold", why: "Builds lower-leg capacity with little soreness.", helps: "Footwork, checks, and repeated kicks", intensity: "controlled" },
  ],
};

function parseSetup(row: Record<string, unknown> | null): Setup | null {
  if (!row) return null;
  let equipment: Equipment[] = [];
  try { const parsed = JSON.parse(String(row.equipment_json ?? "[]")); if (Array.isArray(parsed)) equipment = parsed.filter((item): item is Equipment => equipmentChoices.includes(item as Equipment)); } catch { /* invalid legacy data falls back safely */ }
  return { equipment, location: String(row.location ?? "").slice(0, 80), defaultDuration: Number(row.default_duration_minutes ?? 35), unit: row.unit === "kg" ? "kg" : "lb", limitations: String(row.limitations ?? "").slice(0, 300) };
}

function hasEquipment(exercise: Exercise, setup: Setup) {
  return setup.equipment.includes("full gym") || exercise.equipment.some((item) => setup.equipment.includes(item));
}

function fallbackExercise(exercise: Exercise): Exercise {
  return { ...exercise, name: exercise.substitute, equipment: ["bodyweight"], keyLift: false, target: "Smooth, controlled reps" };
}

async function lastPerformance(db: Awaited<ReturnType<typeof getProductRuntime>>["db"], ownerId: string, key: string) {
  if (!db) return null;
  return db.prepare("SELECT load_value, completed_reps, effort, next_action, next_load_value, unit, created_at FROM workout_performances WHERE owner_id = ? AND exercise_key = ? ORDER BY created_at DESC LIMIT 1").bind(ownerId, key).first<Record<string, unknown>>();
}

async function buildPlan(db: NonNullable<Awaited<ReturnType<typeof getProductRuntime>>["db"]>, ownerId: string, discipline: string, fatigue: string, duration: number, setup: Setup, recentSessions: number, apiKey?: string) {
  const highFatigue = fatigue === "high" || recentSessions >= 3;
  const base = library[discipline] ?? library.MMA;
  const matching = base.map((exercise) => hasEquipment(exercise, setup) ? exercise : fallbackExercise(exercise));
  const safe = highFatigue ? matching.filter((exercise) => !["strength", "moderate"].includes(exercise.intensity)) : matching;
  const initial = (safe.length >= 2 ? safe : matching).slice(0, duration <= 25 ? 3 : 4);
  const memory = await getMemorySnapshot(db, ownerId);
  const personal = await personalizeWorkoutPlan({ apiKey, ownerId, memory, discipline, fatigue, limitations: setup.limitations, availableKeys: initial.map((exercise) => exercise.key) });
  const selected = personal?.priorityKeys.length ? [...initial].sort((a, b) => {
    const aRank = personal.priorityKeys.indexOf(a.key); const bRank = personal.priorityKeys.indexOf(b.key);
    return (aRank < 0 ? 99 : aRank) - (bRank < 0 ? 99 : bRank);
  }) : initial;
  const exercises = await Promise.all(selected.map(async (exercise) => {
    const previous = exercise.keyLift ? await lastPerformance(db, ownerId, exercise.key) : null;
    const previousLoad = typeof previous?.next_load_value === "number" ? previous.next_load_value : typeof previous?.load_value === "number" ? previous.load_value : null;
    const loadInstruction = previousLoad !== null
      ? `Start at ${previousLoad} ${setup.unit}. ${String(previous?.next_action ?? "Use clean reps and stop with 2 left.")}`
      : exercise.keyLift ? "Calibration: use a load you could do for 2 more clean reps. Save your final set so FightIQ can set your next load." : "Use a load that keeps every rep fast and clean.";
    return { ...exercise, loadInstruction, progression: exercise.keyLift ? (previousLoad !== null ? "FightIQ will update this after your final set." : "Your first logged set creates your starting point.") : "Progress quality before adding load." };
  }));
  return {
    title: highFatigue ? `${discipline} recovery-support session` : `${discipline} performance session`,
    loadNote: setup.limitations ? `You noted: ${setup.limitations}. Skip anything painful and use the swap option.` : personal?.loadNote || (highFatigue ? "Your combat-sport load is high, so this keeps strength sharp without piling on fatigue." : "Built around your martial-arts work, equipment, and current recovery."),
    warmup: "6 minutes easy movement, joint prep, then 2 lighter ramp sets for the first strength exercise.",
    exercises,
    finish: highFatigue ? "Finish feeling better than you started. No hard finisher today." : "4 minutes easy breathing and downshift work.",
  };
}

export async function GET() {
  const ownerId = await getProductOwnerId(); if (!ownerId) return productError("AUTH_REQUIRED", "Authentication required.", 401);
  const { db } = getProductRuntime(); if (!db) return productError("STORAGE_UNAVAILABLE", "Workouts are unavailable.", 503);
  await ensureProductSchema(db);
  const [setupRow, plans, progression] = await Promise.all([
    db.prepare("SELECT * FROM workout_setups WHERE owner_id = ? LIMIT 1").bind(ownerId).first<Record<string, unknown>>(),
    db.prepare("SELECT id, discipline, goal, fatigue, duration_minutes, plan_json, status, created_at, completed_at FROM workout_plans WHERE owner_id = ? ORDER BY created_at DESC LIMIT 8").bind(ownerId).all(),
    db.prepare("SELECT exercise_key, load_value, completed_reps, effort, next_action, next_load_value, unit, created_at FROM workout_performances WHERE owner_id = ? ORDER BY created_at DESC LIMIT 12").bind(ownerId).all(),
  ]);
  return Response.json({ setup: parseSetup(setupRow), workouts: plans.results ?? [], progression: progression.results ?? [] });
}

export async function PUT(request: Request) {
  const ownerId = await getProductOwnerId(); if (!ownerId) return productError("AUTH_REQUIRED", "Authentication required.", 401);
  const { db } = getProductRuntime(); if (!db) return productError("STORAGE_UNAVAILABLE", "Workouts are unavailable.", 503);
  let body: Record<string, unknown>; try { body = await request.json() as Record<string, unknown>; } catch { return productError("INVALID_REQUEST", "Invalid workout setup.", 400); }
  const equipment = Array.isArray(body.equipment) ? body.equipment.filter((item): item is Equipment => typeof item === "string" && equipmentChoices.includes(item as Equipment)).slice(0, equipmentChoices.length) : [];
  if (!equipment.length) return productError("EQUIPMENT_REQUIRED", "Choose the equipment you can actually use.", 422);
  const duration = typeof body.defaultDuration === "number" ? Math.max(20, Math.min(90, Math.round(body.defaultDuration))) : 35;
  const location = typeof body.location === "string" ? body.location.trim().slice(0, 80) : "";
  const unit = body.unit === "kg" ? "kg" : "lb";
  const limitations = typeof body.limitations === "string" ? body.limitations.trim().slice(0, 300) : "";
  await ensureProductSchema(db); const now = new Date().toISOString();
  await db.prepare(`INSERT INTO workout_setups (owner_id, equipment_json, location, default_duration_minutes, unit, limitations, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET equipment_json = excluded.equipment_json, location = excluded.location,
    default_duration_minutes = excluded.default_duration_minutes, unit = excluded.unit, limitations = excluded.limitations, updated_at = excluded.updated_at`)
    .bind(ownerId, JSON.stringify(equipment), location, duration, unit, limitations, now, now).run();
  return Response.json({ setup: { equipment, location, defaultDuration: duration, unit, limitations } });
}

export async function POST(request: Request) {
  const ownerId = await getProductOwnerId(); if (!ownerId) return productError("AUTH_REQUIRED", "Authentication required.", 401);
  const { db, apiKey } = getProductRuntime(); if (!db) return productError("STORAGE_UNAVAILABLE", "Workouts are unavailable.", 503);
  let body: Record<string, unknown>; try { body = await request.json() as Record<string, unknown>; } catch { return productError("INVALID_REQUEST", "Invalid workout request.", 400); }
  await ensureProductSchema(db);
  const setup = parseSetup(await db.prepare("SELECT * FROM workout_setups WHERE owner_id = ? LIMIT 1").bind(ownerId).first<Record<string, unknown>>());
  if (!setup) return productError("WORKOUT_SETUP_REQUIRED", "Tell FightIQ what equipment you have first.", 409);
  const discipline = typeof body.discipline === "string" && body.discipline in library ? body.discipline : "MMA";
  const goal = typeof body.goal === "string" ? body.goal.slice(0, 80) : "Fight performance";
  const fatigue = ["low", "medium", "high"].includes(String(body.fatigue)) ? String(body.fatigue) : "medium";
  const duration = typeof body.duration === "number" ? Math.min(90, Math.max(20, Math.round(body.duration))) : setup.defaultDuration;
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const recent = await db.prepare("SELECT COUNT(*) AS count FROM training_entries WHERE owner_id = ? AND created_at >= ?").bind(ownerId, cutoff).first<{ count: number }>();
  const plan = await buildPlan(db, ownerId, discipline, fatigue, duration, setup, recent?.count ?? 0, apiKey);
  const id = crypto.randomUUID(); const createdAt = new Date().toISOString();
  await db.prepare(`INSERT INTO workout_plans (id, owner_id, discipline, goal, fatigue, duration_minutes, plan_json, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'planned', ?)`)
    .bind(id, ownerId, discipline, goal, fatigue, duration, JSON.stringify(plan), createdAt).run();
  // This read makes the memory dependency explicit: the plan is tied to the
  // authenticated athlete and remains available for Coach and future sessions.
  await getMemorySnapshot(db, ownerId);
  return Response.json({ id, discipline, goal, fatigue, duration, setup, plan, createdAt }, { status: 201 });
}
