import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../app/chatgpt-auth";
import type { D1 } from "./debrief-db";

export type FighterProfile = {
  owner_id: string;
  current_focus: string | null;
  focus_reason: string | null;
  primary_goal: string;
  style_influences_json: string;
  calorie_target: number;
  protein_target: number;
  carb_target: number;
  fat_target: number;
};

export type MemorySnapshot = {
  currentFocus: string;
  focusReason: string;
  strongestAreas: string[];
  recurringProblems: string[];
  recentImprovement: string;
  styleInfluences: string[];
  nextEvolution: string;
  instructorDetails: string[];
  emergingStrengths: string[];
  oneTimeObservations: string[];
  recentTraining: Array<{ discipline: string; sessionType: string; note: string; takeaway: string | null; focus: string | null; createdAt: string }>;
};

export type PreTrainingBrief = { mission: string; reason: string; cue: string; sourceFocus: string; createdAt: string };

export async function getProductOwnerId() {
  const user = await getChatGPTUser();
  return user?.userId ?? (process.env.NODE_ENV !== "production" ? "preview-user" : null);
}

export function getProductRuntime() {
  const runtime = env as unknown as { DB?: D1; UPLOADS?: R2Bucket; OPENAI_API_KEY?: string; FIGHTIQ_ALLOW_MOCK_AI?: string };
  return { db: runtime.DB, uploads: runtime.UPLOADS, apiKey: runtime.OPENAI_API_KEY, allowMockAi: runtime.FIGHTIQ_ALLOW_MOCK_AI === "true" };
}

export async function ensureProductSchema(db: D1) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS fighter_profiles (
      owner_id TEXT PRIMARY KEY NOT NULL,
      current_focus TEXT,
      focus_reason TEXT,
      primary_goal TEXT NOT NULL DEFAULT 'performance',
      style_influences_json TEXT NOT NULL DEFAULT '[]',
      calorie_target INTEGER NOT NULL DEFAULT 2400,
      protein_target INTEGER NOT NULL DEFAULT 180,
      carb_target INTEGER NOT NULL DEFAULT 260,
      fat_target INTEGER NOT NULL DEFAULT 70,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS coach_messages (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_coach_messages_owner_created ON coach_messages (owner_id, created_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS workout_plans (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      discipline TEXT NOT NULL,
      goal TEXT NOT NULL,
      fatigue TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      plan_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned',
      created_at TEXT NOT NULL,
      completed_at TEXT
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_workout_plans_owner_created ON workout_plans (owner_id, created_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS nutrition_entries (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      description TEXT NOT NULL,
      foods_json TEXT NOT NULL DEFAULT '[]',
      calories INTEGER NOT NULL,
      protein REAL NOT NULL,
      carbs REAL NOT NULL,
      fat REAL NOT NULL,
      input_method TEXT NOT NULL,
      photo_key TEXT,
      created_at TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_nutrition_entries_owner_created ON nutrition_entries (owner_id, created_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS pre_training_briefs (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      mission TEXT NOT NULL,
      reason TEXT NOT NULL,
      cue TEXT NOT NULL,
      source_focus TEXT NOT NULL,
      created_at TEXT NOT NULL,
      consumed_at TEXT
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_pre_training_briefs_owner_created ON pre_training_briefs (owner_id, created_at)"),
  ]);
  await db.prepare("PRAGMA optimize").run();
}

export async function getOrCreateProfile(db: D1, ownerId: string): Promise<FighterProfile> {
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO fighter_profiles (owner_id, created_at, updated_at)
    VALUES (?, ?, ?) ON CONFLICT(owner_id) DO NOTHING`).bind(ownerId, now, now).run();
  const profile = await db.prepare("SELECT * FROM fighter_profiles WHERE owner_id = ? LIMIT 1").bind(ownerId).first<FighterProfile>();
  if (!profile) throw new Error("Profile unavailable");
  return profile;
}

function safeStringArray(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 8) : [];
  } catch { return []; }
}

function titleCase(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function topValues(values: string[], limit: number) {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = raw.trim();
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([value]) => titleCase(value));
}

function normalizeInsight(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isDistinct(value: string, used: string[]) {
  const normalized = normalizeInsight(value);
  if (!normalized) return false;
  return !used.some((existing) => {
    const other = normalizeInsight(existing);
    return normalized === other || (normalized.length > 12 && other.includes(normalized)) || (other.length > 12 && normalized.includes(other));
  });
}

function takeDistinct(values: string[], used: string[], limit: number) {
  const picked: string[] = [];
  for (const value of values) {
    const clean = titleCase(value.trim());
    if (!clean || !isDistinct(clean, [...used, ...picked])) continue;
    picked.push(clean);
    if (picked.length === limit) break;
  }
  used.push(...picked);
  return picked;
}

function shortTopic(value: string, fallback: string) {
  const clean = value.replace(/[.!?]+$/g, "").trim();
  return (clean || fallback).slice(0, 72);
}

function compactTopic(value: string, fallback: string) {
  const words = shortTopic(value, fallback).split(/\s+/);
  return words.length > 8 ? `${words.slice(0, 8).join(" ")}…` : words.join(" ");
}

export function getCoachSuggestions(memory: MemorySnapshot) {
  const focus = compactTopic(memory.currentFocus, "your current focus");
  const confirmedProblem = memory.recurringProblems.find((item) => !item.toLowerCase().includes("no recurring"));
  const strength = memory.strongestAreas.find((item) => !item.toLowerCase().includes("still learning"));
  const latestDiscipline = memory.recentTraining[0]?.discipline;
  const instructor = memory.instructorDetails[0];
  const latestNote = memory.recentTraining[0]?.note.toLowerCase() ?? "";
  const armDrag = latestNote.includes("arm drag") || memory.currentFocus.toLowerCase().includes("arm drag");
  const candidates = [
    instructor ? `Why does that coach detail work better?` : `How should I test “${focus}” next session?`,
    armDrag ? "How do I stop them squaring after the arm drag?" : confirmedProblem ? `Why does ${shortTopic(confirmedProblem, "this problem")} keep breaking down?` : `What pattern should I watch for in my next live round?`,
    strength ? `How can I build offense from ${shortTopic(strength, "my strongest area")}?` : latestDiscipline ? `What should I notice earlier in ${latestDiscipline} rounds?` : `What should I review after my next session?`,
  ];
  const unique: string[] = [];
  for (const candidate of candidates) if (isDistinct(candidate, unique)) unique.push(candidate);
  const fallbacks = ["What is the smallest correction I can test next?", "What should I ask my coach to watch for?"];
  for (const fallback of fallbacks) if (unique.length < 3 && isDistinct(fallback, unique)) unique.push(fallback);
  return unique.slice(0, 3);
}

export async function getMemorySnapshot(db: D1, ownerId: string): Promise<MemorySnapshot> {
  const profile = await getOrCreateProfile(db, ownerId);
  const result = await db.prepare(`SELECT e.discipline, e.session_type, e.raw_entry, e.created_at,
      d.takeaway, d.next_session_focus, d.structured_memory_json
    FROM training_entries e LEFT JOIN training_debriefs d ON d.entry_id = e.id AND d.owner_id = e.owner_id
    WHERE e.owner_id = ? ORDER BY e.created_at DESC LIMIT 20`).bind(ownerId).all<{
      discipline: string; session_type: string; raw_entry: string; created_at: string;
      takeaway: string | null; next_session_focus: string | null; structured_memory_json: string | null;
    }>();
  const rows = result.results ?? [];
  const successes: string[] = [];
  const problems: string[] = [];
  const techniques: string[] = [];
  const concepts: string[] = [];
  const relatedTopics: string[] = [];
  const instructorDetails: string[] = [];
  for (const row of rows) {
    try {
      const memory = JSON.parse(row.structured_memory_json ?? "{}") as Record<string, unknown>;
      if (Array.isArray(memory.successes)) successes.push(...memory.successes.filter((v): v is string => typeof v === "string"));
      if (Array.isArray(memory.problems)) problems.push(...memory.problems.filter((v): v is string => typeof v === "string"));
      if (Array.isArray(memory.techniques)) techniques.push(...memory.techniques.filter((v): v is string => typeof v === "string"));
      if (Array.isArray(memory.concepts)) concepts.push(...memory.concepts.filter((v): v is string => typeof v === "string"));
      if (Array.isArray(memory.related_topics)) relatedTopics.push(...memory.related_topics.filter((v): v is string => typeof v === "string"));
      if (Array.isArray(memory.instructor_details)) instructorDetails.push(...memory.instructor_details.filter((v): v is string => typeof v === "string"));
    } catch { /* malformed historical memory is ignored */ }
  }
  const latestFocus = rows.find((row) => row.next_session_focus)?.next_session_focus;
  const currentFocus = profile.current_focus || latestFocus || "Build a reliable first layer of defense";
  const used = [currentFocus];
  const improvementCandidate = successes[0] ? titleCase(successes[0]) : rows[0]?.takeaway || "Log a few sessions and FightIQ will identify improvement.";
  // A skill needs repeated evidence before it becomes a "strength" or "recurring problem".
  const counts = (items: string[]) => new Map(items.map((item) => [normalizeInsight(item), (items.filter((other) => normalizeInsight(other) === normalizeInsight(item)).length)]));
  const successCounts = counts(successes);
  const problemCounts = counts(problems);
  const strongestAreas = takeDistinct(topValues(successes.filter((item) => (successCounts.get(normalizeInsight(item)) ?? 0) >= 3), 8), used, 3);
  const recurringProblems = takeDistinct(topValues(problems.filter((item) => (problemCounts.get(normalizeInsight(item)) ?? 0) >= 2), 8), used, 3);
  const emergingStrengths = takeDistinct(topValues(successes.filter((item) => (successCounts.get(normalizeInsight(item)) ?? 0) === 2), 8), used, 3);
  const improvement = isDistinct(improvementCandidate, used)
    ? improvementCandidate
    : rows.map((row) => row.takeaway).find((value): value is string => Boolean(value) && isDistinct(value as string, used)) || "FightIQ needs another completed debrief to confirm a distinct improvement.";
  used.push(improvement);
  const styleInfluences = takeDistinct(safeStringArray(profile.style_influences_json), used, 8);
  const evolutionTopic = takeDistinct(topValues([...relatedTopics, ...concepts, ...techniques], 12), used, 1)[0];
  const nextEvolution = evolutionTopic
    ? `Build ${evolutionTopic} as the layer that connects your current focus to reliable offense.`
    : "After your current focus becomes reliable, connect it to one repeatable offensive response.";
  return {
    currentFocus,
    focusReason: profile.focus_reason || (latestFocus ? "This is the clearest next step from your recent training debrief." : "This gives your next sessions one clear direction."),
    strongestAreas: strongestAreas.length ? strongestAreas : ["Still learning your strongest areas"],
    recurringProblems: recurringProblems.length ? recurringProblems : ["No recurring problem confirmed yet"],
    recentImprovement: improvement,
    styleInfluences,
    nextEvolution,
    instructorDetails: takeDistinct(topValues(instructorDetails, 8), [], 3),
    emergingStrengths,
    oneTimeObservations: takeDistinct(topValues([...techniques, ...problems, ...successes], 12), [], 4),
    recentTraining: rows.slice(0, 6).map((row) => ({ discipline: row.discipline, sessionType: row.session_type, note: row.raw_entry, takeaway: row.takeaway, focus: row.next_session_focus, createdAt: row.created_at })),
  };
}

function briefCue(mission: string) {
  const lower = mission.toLowerCase();
  if (lower.includes("arm drag") || lower.includes("drag")) return "Drag → take the angle.";
  if (lower.includes("frame")) return "Frames first → then move.";
  if (lower.includes("defense")) return "See it early → make space.";
  return "One clean rep → then notice what breaks.";
}

export async function getOrCreatePreTrainingBrief(db: D1, ownerId: string, memory?: MemorySnapshot): Promise<PreTrainingBrief> {
  const now = new Date();
  const since = new Date(now.getTime() - 18 * 60 * 60 * 1000).toISOString();
  const existing = await db.prepare(`SELECT mission, reason, cue, source_focus, created_at FROM pre_training_briefs
    WHERE owner_id = ? AND consumed_at IS NULL AND created_at >= ? ORDER BY created_at DESC LIMIT 1`).bind(ownerId, since).first<{ mission: string; reason: string; cue: string; source_focus: string; created_at: string }>();
  if (existing) {
    const refreshedCue = briefCue(existing.mission);
    if (refreshedCue !== existing.cue) await db.prepare("UPDATE pre_training_briefs SET cue = ? WHERE owner_id = ? AND created_at = ?").bind(refreshedCue, ownerId, existing.created_at).run();
    return { mission: existing.mission, reason: existing.reason, cue: refreshedCue, sourceFocus: existing.source_focus, createdAt: existing.created_at };
  }
  const fighterMemory = memory ?? await getMemorySnapshot(db, ownerId);
  const latest = fighterMemory.recentTraining[0];
  const focus = fighterMemory.currentFocus;
  const mission = latest?.focus || focus;
  const reason = latest?.takeaway || fighterMemory.focusReason;
  const brief: PreTrainingBrief = { mission: shortTopic(mission, "Test your current focus"), reason: shortTopic(reason, "Carry one clear detail from your last session into live work."), cue: briefCue(mission), sourceFocus: focus, createdAt: now.toISOString() };
  await db.prepare(`INSERT INTO pre_training_briefs (id, owner_id, mission, reason, cue, source_focus, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), ownerId, brief.mission, brief.reason, brief.cue, brief.sourceFocus, brief.createdAt).run();
  return brief;
}

export async function getLatestPreTrainingBrief(db: D1, ownerId: string) {
  return db.prepare(`SELECT id, mission, reason, cue, source_focus, created_at FROM pre_training_briefs
    WHERE owner_id = ? ORDER BY created_at DESC LIMIT 1`).bind(ownerId).first<{ id: string; mission: string; reason: string; cue: string; source_focus: string; created_at: string }>();
}

export async function consumePreTrainingBrief(db: D1, ownerId: string) {
  await db.prepare(`UPDATE pre_training_briefs SET consumed_at = ? WHERE id = (
    SELECT id FROM pre_training_briefs WHERE owner_id = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1
  )`).bind(new Date().toISOString(), ownerId).run();
}

export async function getTodayNutrition(db: D1, ownerId: string) {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const result = await db.prepare(`SELECT id, description, calories, protein, carbs, fat, photo_key, created_at
    FROM nutrition_entries WHERE owner_id = ? AND created_at >= ? ORDER BY created_at DESC`)
    .bind(ownerId, since.toISOString()).all<{ id: string; description: string; calories: number; protein: number; carbs: number; fat: number; photo_key: string | null; created_at: string }>();
  const entries = result.results ?? [];
  return {
    entries: entries.map(({ photo_key, ...entry }) => ({ ...entry, photoUrl: photo_key ? `/api/nutrition/photos/${entry.id}` : null })),
    totals: entries.reduce((total, entry) => ({
      calories: total.calories + entry.calories,
      protein: total.protein + entry.protein,
      carbs: total.carbs + entry.carbs,
      fat: total.fat + entry.fat,
    }), { calories: 0, protein: 0, carbs: 0, fat: 0 }),
  };
}

export function productError(code: string, message: string, status: number, development?: Record<string, unknown>) {
  return Response.json({ error: { code, message, ...(development ? { development } : {}) } }, { status });
}
