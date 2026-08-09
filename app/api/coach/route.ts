import { answerCoach, ProductAIError } from "../../../lib/product-ai";
import { ensureProductSchema, getMemorySnapshot, getOrCreateProfile, getProductOwnerId, getProductRuntime, getTodayNutrition, productError } from "../../../lib/product-db";

export const dynamic = "force-dynamic";

export async function GET() {
  const ownerId = await getProductOwnerId();
  if (!ownerId) return productError("AUTH_REQUIRED", "Authentication required.", 401);
  const { db } = getProductRuntime();
  if (!db) return productError("STORAGE_UNAVAILABLE", "FightIQ Coach is unavailable.", 503);
  await ensureProductSchema(db);
  const [messages, memory] = await Promise.all([
    db.prepare(`SELECT id, role, content, created_at FROM (
      SELECT id, role, content, created_at FROM coach_messages WHERE owner_id = ? ORDER BY created_at DESC LIMIT 60
    ) ORDER BY created_at ASC`).bind(ownerId).all(),
    getMemorySnapshot(db, ownerId),
  ]);
  return Response.json({ messages: messages.results ?? [], currentFocus: memory.currentFocus });
}

export async function POST(request: Request) {
  const ownerId = await getProductOwnerId();
  if (!ownerId) return productError("AUTH_REQUIRED", "Authentication required.", 401);
  const { db, apiKey } = getProductRuntime();
  if (!db) return productError("STORAGE_UNAVAILABLE", "FightIQ Coach is unavailable.", 503);
  let body: { question?: unknown };
  try { body = await request.json(); } catch { return productError("INVALID_REQUEST", "Invalid question.", 400); }
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (question.length < 2 || question.length > 3000) return productError("INVALID_QUESTION", "Question must be between 2 and 3,000 characters.", 422);
  await ensureProductSchema(db);
  const [memory, profile, workoutRows, nutrition, historyRows] = await Promise.all([
    getMemorySnapshot(db, ownerId),
    getOrCreateProfile(db, ownerId),
    db.prepare("SELECT discipline, goal, fatigue, duration_minutes, plan_json, status, created_at FROM workout_plans WHERE owner_id = ? ORDER BY created_at DESC LIMIT 4").bind(ownerId).all(),
    getTodayNutrition(db, ownerId),
    db.prepare("SELECT role, content FROM coach_messages WHERE owner_id = ? ORDER BY created_at DESC LIMIT 8").bind(ownerId).all<{ role: string; content: string }>(),
  ]);
  const now = new Date().toISOString();
  const userMessageId = crypto.randomUUID();
  await db.prepare("INSERT INTO coach_messages (id, owner_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)")
    .bind(userMessageId, ownerId, question, now).run();
  try {
    const answer = await answerCoach({ apiKey, ownerId, question, memory, profile, workouts: workoutRows.results ?? [], nutrition, history: (historyRows.results ?? []).reverse() });
    const assistantMessageId = crypto.randomUUID();
    await db.prepare("INSERT INTO coach_messages (id, owner_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)")
      .bind(assistantMessageId, ownerId, answer, new Date().toISOString()).run();
    return Response.json({ user: { id: userMessageId, role: "user", content: question, created_at: now }, assistant: { id: assistantMessageId, role: "assistant", content: answer, created_at: new Date().toISOString() } });
  } catch (error) {
    if (error instanceof ProductAIError) return productError(error.code, error.message, error.status);
    return productError("AI_UNAVAILABLE", "FightIQ Coach couldn’t answer right now.", 503);
  }
}
