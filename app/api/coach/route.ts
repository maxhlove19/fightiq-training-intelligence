import { answerCoach, ProductAIError } from "../../../lib/product-ai";
import { ensureProductSchema, getActiveTrainingExperiment, getCoachSuggestions, getMemorySnapshot, getOrCreateProfile, getProductOwnerId, getProductRuntime, getTodayNutrition, productError } from "../../../lib/product-db";

export const dynamic = "force-dynamic";

export async function GET() {
  const ownerId = await getProductOwnerId();
  if (!ownerId) return productError("AUTH_REQUIRED", "Authentication required.", 401);
  const { db } = getProductRuntime();
  if (!db) return productError("STORAGE_UNAVAILABLE", "FightIQ Coach is unavailable.", 503);
  await ensureProductSchema(db);
  const [messages, memory, activeExperiment] = await Promise.all([
    db.prepare(`SELECT messages.id, messages.role, messages.content, messages.created_at,
        enrichments.follow_up, enrichments.video_mode, enrichments.video_topic, enrichments.video_prompt
      FROM (
      SELECT id, role, content, created_at FROM coach_messages WHERE owner_id = ? ORDER BY created_at DESC LIMIT 60
      ) messages LEFT JOIN coach_message_enrichments enrichments
        ON enrichments.assistant_message_id = messages.id AND enrichments.owner_id = ?
      ORDER BY messages.created_at ASC`).bind(ownerId, ownerId).all(),
    getMemorySnapshot(db, ownerId),
    getActiveTrainingExperiment(db, ownerId),
  ]);
  return Response.json({ messages: messages.results ?? [], currentFocus: memory.currentFocus, suggestions: getCoachSuggestions(memory, activeExperiment ? { mission: activeExperiment.mission, cue: activeExperiment.cue } : null) });
}

export async function POST(request: Request) {
  const ownerId = await getProductOwnerId();
  if (!ownerId) return productError("AUTH_REQUIRED", "Authentication required.", 401);
  const { db, apiKey, allowMockAi } = getProductRuntime();
  if (!db) return productError("STORAGE_UNAVAILABLE", "FightIQ Coach is unavailable.", 503);
  let body: { question?: unknown; messageId?: unknown };
  try { body = await request.json(); } catch { return productError("INVALID_REQUEST", "Invalid question.", 400); }
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const requestedMessageId = typeof body.messageId === "string" ? body.messageId.trim() : "";
  if (question.length < 2 || question.length > 3000) return productError("INVALID_QUESTION", "Question must be between 2 and 3,000 characters.", 422);
  if (requestedMessageId && (requestedMessageId.length < 8 || requestedMessageId.length > 100)) return productError("INVALID_MESSAGE_ID", "Invalid message identifier.", 422);
  await ensureProductSchema(db);
  const existingMessage = requestedMessageId
    ? await db.prepare("SELECT id, owner_id, role, content, created_at FROM coach_messages WHERE id = ? LIMIT 1").bind(requestedMessageId).first<{ id: string; owner_id: string; role: string; content: string; created_at: string }>()
    : null;
  if (existingMessage && (existingMessage.owner_id !== ownerId || existingMessage.role !== "user" || existingMessage.content !== question)) {
    return productError("MESSAGE_CONFLICT", "That saved message cannot be retried.", 409);
  }
  const [memory, profile, workoutRows, nutrition, historyRows, activeExperiment] = await Promise.all([
    getMemorySnapshot(db, ownerId),
    getOrCreateProfile(db, ownerId),
    db.prepare("SELECT discipline, goal, fatigue, duration_minutes, plan_json, status, created_at FROM workout_plans WHERE owner_id = ? ORDER BY created_at DESC LIMIT 4").bind(ownerId).all(),
    getTodayNutrition(db, ownerId),
    db.prepare("SELECT id, role, content FROM coach_messages WHERE owner_id = ? ORDER BY created_at DESC LIMIT 8").bind(ownerId).all<{ id: string; role: string; content: string }>(),
    getActiveTrainingExperiment(db, ownerId),
  ]);
  const now = new Date().toISOString();
  const userMessageId = existingMessage?.id ?? (requestedMessageId || crypto.randomUUID());
  const userCreatedAt = existingMessage?.created_at ?? now;
  if (!existingMessage) {
    await db.prepare("INSERT OR IGNORE INTO coach_messages (id, owner_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)")
      .bind(userMessageId, ownerId, question, userCreatedAt).run();
  }
  try {
    const history = (historyRows.results ?? []).filter((message) => message.id !== userMessageId).reverse();
    const answer = await answerCoach({ apiKey, allowMockAi, ownerId, question, memory, profile, workouts: workoutRows.results ?? [], nutrition, history, activeExperiment });
    const assistantMessageId = crypto.randomUUID();
    await db.prepare("INSERT INTO coach_messages (id, owner_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)")
      .bind(assistantMessageId, ownerId, answer.reply, new Date().toISOString()).run();
    const assistantCreatedAt = new Date().toISOString();
    await db.prepare(`INSERT INTO coach_message_enrichments (
      assistant_message_id, owner_id, follow_up, video_mode, video_topic, video_prompt, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(assistantMessageId, ownerId, answer.followUp, answer.video.mode, answer.video.topic || null, answer.video.prompt || null, assistantCreatedAt).run();
    return Response.json({
      user: { id: userMessageId, role: "user", content: question, created_at: userCreatedAt },
      assistant: {
        id: assistantMessageId, role: "assistant", content: answer.reply, created_at: assistantCreatedAt,
        follow_up: answer.followUp, video_mode: answer.video.mode, video_topic: answer.video.topic || null, video_prompt: answer.video.prompt || null,
      },
    });
  } catch (error) {
    if (error instanceof ProductAIError) return productError(error.code, error.message, error.status, { ...error.development, savedMessageId: userMessageId });
    console.error("Unexpected FightIQ Coach failure", error);
    return productError("AI_UNAVAILABLE", "FightIQ Coach couldn’t answer right now.", 503, { cause: error instanceof Error ? error.message.slice(0, 500) : "Unknown server error", savedMessageId: userMessageId });
  }
}
