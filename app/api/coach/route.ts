import { answerCoach, ProductAIError } from "../../../lib/product-ai";
import { scanTrainingNote } from "../../../lib/safety-signals";
import type { D1 } from "../../../lib/debrief-db";
import { ensureProductSchema, getActiveTrainingExperiment, getCoachSuggestions, getMemorySnapshot, getOrCreateProfile, getProductOwnerId, getProductRuntime, getTodayNutrition, productError } from "../../../lib/product-db";
import { readJsonObject } from "../../../lib/request-body";
import { FINDING_CHOICES, findingKey } from "../../../lib/coach-finding";
import { countRecentCoachQuestions } from "../../../lib/usage-db";
import { checkUsage } from "../../../lib/usage-limits";

export const dynamic = "force-dynamic";

type StoredAssistant = { id: string; role: "assistant"; content: string; created_at: string; follow_up: string | null; follow_up_choices_json: string | null; video_mode: "none" | "offer" | "direct" | null; video_topic: string | null; video_prompt: string | null };
type StoredCoachMessage = Omit<StoredAssistant, "role"> & { role: "user" | "assistant" };
type CoachConversationContext = { follow_up: string | null; video_topic: string | null };
type CoachChat = { id: string; title: string; created_at: string; updated_at: string };

async function ensureCoachChat(db: D1, ownerId: string, requestedId?: string | null) {
  const requested = requestedId ? await db.prepare("SELECT id, title, created_at, updated_at FROM coach_chats WHERE id = ? AND owner_id = ? LIMIT 1").bind(requestedId, ownerId).first<CoachChat>() : null;
  if (requested) return requested;
  const existing = await db.prepare("SELECT id, title, created_at, updated_at FROM coach_chats WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 1").bind(ownerId).first<CoachChat>();
  if (existing) return existing;
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  await db.batch([
    db.prepare("INSERT INTO coach_chats (id, owner_id, title, created_at, updated_at) VALUES (?, ?, 'General', ?, ?)").bind(id, ownerId, now, now),
    db.prepare("UPDATE coach_messages SET chat_id = ? WHERE owner_id = ? AND chat_id IS NULL").bind(id, ownerId),
    db.prepare("UPDATE coach_turns SET chat_id = ? WHERE owner_id = ? AND chat_id IS NULL").bind(id, ownerId),
  ]);
  return { id, title: "General", created_at: now, updated_at: now };
}

function safeFollowUpChoices(value: string | null) {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((choice): choice is string => typeof choice === "string" && choice.trim().length > 1).map((choice) => choice.trim()).slice(0, 3)
      : [];
  } catch { return []; }
}

function coachMessageForClient(message: StoredCoachMessage) {
  const followUp = message.follow_up?.trim() || null;
  return {
    id: message.id, role: message.role, content: message.content, created_at: message.created_at,
    follow_up: followUp,
    follow_up_choices: followUp ? safeFollowUpChoices(message.follow_up_choices_json) : [],
    video_mode: message.video_mode, video_topic: message.video_topic, video_prompt: message.video_prompt,
  };
}

async function completedTurnResponse(db: D1, ownerId: string, userMessageId: string, userContent: string, userCreatedAt: string) {
  const assistant = await db.prepare(`SELECT messages.id, messages.role, messages.content, messages.created_at,
      enrichments.follow_up, enrichments.follow_up_choices_json, enrichments.video_mode, enrichments.video_topic, enrichments.video_prompt
    FROM coach_turns turns
    INNER JOIN coach_messages messages ON messages.id = turns.assistant_message_id AND messages.owner_id = turns.owner_id
    LEFT JOIN coach_message_enrichments enrichments ON enrichments.assistant_message_id = messages.id AND enrichments.owner_id = messages.owner_id
    WHERE turns.user_message_id = ? AND turns.owner_id = ? AND turns.status = 'complete' LIMIT 1`)
    .bind(userMessageId, ownerId).first<StoredAssistant>();
  if (!assistant) return null;
  return { user: { id: userMessageId, role: "user" as const, content: userContent, created_at: userCreatedAt }, assistant: coachMessageForClient(assistant) };
}

export async function GET(request: Request) {
  const ownerId = await getProductOwnerId();
  if (!ownerId) return productError("AUTH_REQUIRED", "Authentication required.", 401);
  const { db } = getProductRuntime();
  if (!db) return productError("STORAGE_UNAVAILABLE", "FightIQ Coach is unavailable.", 503);
  await ensureProductSchema(db);
  const requestedChatId = new URL(request.url).searchParams.get("chatId");
  const activeChat = await ensureCoachChat(db, ownerId, requestedChatId);
  const [messages, memory, activeExperiment, conversationContext, chats] = await Promise.all([
    db.prepare(`SELECT messages.id, messages.role, messages.content, messages.created_at,
        enrichments.follow_up, enrichments.follow_up_choices_json, enrichments.video_mode, enrichments.video_topic, enrichments.video_prompt
      FROM (
      SELECT id, role, content, created_at FROM coach_messages WHERE owner_id = ? AND chat_id = ? ORDER BY created_at DESC LIMIT 60
      ) messages LEFT JOIN coach_message_enrichments enrichments
        ON enrichments.assistant_message_id = messages.id AND enrichments.owner_id = ?
      ORDER BY messages.created_at ASC`).bind(ownerId, activeChat.id, ownerId).all(),
    getMemorySnapshot(db, ownerId),
    getActiveTrainingExperiment(db, ownerId),
    db.prepare(`SELECT enrichments.follow_up, enrichments.video_topic
      FROM coach_messages messages
      LEFT JOIN coach_message_enrichments enrichments
        ON enrichments.assistant_message_id = messages.id AND enrichments.owner_id = messages.owner_id
      WHERE messages.owner_id = ? AND messages.chat_id = ?
      ORDER BY messages.created_at DESC LIMIT 1`).bind(ownerId, activeChat.id).first<CoachConversationContext>(),
    db.prepare("SELECT id, title, created_at, updated_at FROM coach_chats WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 20").bind(ownerId).all<CoachChat>(),
  ]);
  return Response.json({
    chats: chats.results ?? [], activeChatId: activeChat.id,
    messages: (messages.results ?? []).map((message) => coachMessageForClient(message as StoredCoachMessage)),
    currentFocus: memory.currentFocus,
    // Coach can be left for a video and reopened. Keep the suggestions attached
    // to the last actual conversation turn instead of falling back to generic
    // prompts after that round trip.
    suggestions: getCoachSuggestions(
      memory,
      activeExperiment ? { mission: activeExperiment.mission, cue: activeExperiment.cue } : null,
      conversationContext?.follow_up ? { followUp: conversationContext.follow_up, videoTopic: conversationContext.video_topic ?? undefined } : null,
    ),
  });
}

export async function POST(request: Request) {
  const ownerId = await getProductOwnerId();
  if (!ownerId) return productError("AUTH_REQUIRED", "Authentication required.", 401);
  const { db, apiKey, allowMockAi } = getProductRuntime();
  if (!db) return productError("STORAGE_UNAVAILABLE", "FightIQ Coach is unavailable.", 503);
  const body = await readJsonObject(request) as { question?: unknown; messageId?: unknown; chatId?: unknown } | null;
  if (!body) return productError("INVALID_REQUEST", "Invalid question.", 400);
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const requestedMessageId = typeof body.messageId === "string" ? body.messageId.trim() : "";
  const requestedChatId = typeof body.chatId === "string" ? body.chatId.trim() : "";
  if (question.length < 2 || question.length > 3000) return productError("INVALID_QUESTION", "Question must be between 2 and 3,000 characters.", 422);
  // Coach is the other place an athlete describes a head knock — usually as a
  // question about whether they can train. The answer to that must not depend
  // on a model reading the room correctly, so the same deterministic scan runs
  // on what they typed and travels with every response, including the failures.
  const safety = scanTrainingNote(question);
  if (requestedMessageId && (requestedMessageId.length < 8 || requestedMessageId.length > 100)) return productError("INVALID_MESSAGE_ID", "Invalid message identifier.", 422);
  await ensureProductSchema(db);
  // A retry of a question already saved is not a new question, so it is not
  // counted against the ceiling — otherwise a flaky connection spends an
  // athlete's allowance on the same answer twice.
  if (!requestedMessageId) {
    const usage = checkUsage("coach_question", await countRecentCoachQuestions(db, ownerId));
    if (!usage.allowed) {
      return Response.json(
        { error: { code: usage.code, message: usage.message }, safety },
        { status: 429, headers: { "retry-after": String(usage.retryAfterSeconds) } },
      );
    }
  }
  const activeChat = await ensureCoachChat(db, ownerId, requestedChatId);
  if (requestedChatId && activeChat.id !== requestedChatId) return productError("CHAT_NOT_FOUND", "That Coach chat is unavailable.", 404);
  const existingMessage = requestedMessageId
    ? await db.prepare("SELECT id, owner_id, chat_id, role, content, created_at FROM coach_messages WHERE id = ? LIMIT 1").bind(requestedMessageId).first<{ id: string; owner_id: string; chat_id: string | null; role: string; content: string; created_at: string }>()
    : null;
  if (existingMessage && (existingMessage.owner_id !== ownerId || existingMessage.chat_id !== activeChat.id || existingMessage.role !== "user" || existingMessage.content !== question)) {
    return productError("MESSAGE_CONFLICT", "That saved message cannot be retried.", 409);
  }
  const now = new Date().toISOString();
  const userMessageId = existingMessage?.id ?? (requestedMessageId || crypto.randomUUID());
  const userCreatedAt = existingMessage?.created_at ?? now;
  if (!existingMessage) {
    await db.prepare("INSERT OR IGNORE INTO coach_messages (id, owner_id, chat_id, role, content, created_at) VALUES (?, ?, ?, 'user', ?, ?)")
      .bind(userMessageId, ownerId, activeChat.id, question, userCreatedAt).run();
  }
  // Make the retry path deterministic. The same user message either returns
  // the completed answer, waits for the in-flight one, or safely reopens a
  // failed turn—never creates a second Coach answer.
  const existingTurn = await db.prepare("SELECT status, created_at FROM coach_turns WHERE user_message_id = ? AND owner_id = ? LIMIT 1")
    .bind(userMessageId, ownerId).first<{ status: string; created_at: string }>();
  if (existingTurn?.status === "complete") {
    const completed = await completedTurnResponse(db, ownerId, userMessageId, question, userCreatedAt);
    if (completed) return Response.json({ ...completed, safety });
  }
  let ownsPendingTurn = false;
  if (existingTurn?.status === "failed") {
    const retried = await db.prepare("UPDATE coach_turns SET status = 'pending', assistant_message_id = NULL, completed_at = NULL, created_at = ? WHERE user_message_id = ? AND owner_id = ? AND status = 'failed'")
      .bind(now, userMessageId, ownerId).run();
    ownsPendingTurn = (retried.meta?.changes ?? 0) === 1;
  } else if (existingTurn?.status === "pending") {
    // A worker can die after reserving a turn. Reclaim only an old reservation;
    // a fresh pending turn remains idempotent and never gets two replies.
    const staleBefore = new Date(Date.now() - 45_000).toISOString();
    if (existingTurn.created_at <= staleBefore) {
      const reclaimed = await db.prepare(`UPDATE coach_turns SET created_at = ?, assistant_message_id = NULL, completed_at = NULL
        WHERE user_message_id = ? AND owner_id = ? AND status = 'pending' AND created_at = ?`)
        .bind(now, userMessageId, ownerId, existingTurn.created_at).run();
      ownsPendingTurn = (reclaimed.meta?.changes ?? 0) === 1;
    }
  } else if (!existingTurn) {
    const created = await db.prepare("INSERT OR IGNORE INTO coach_turns (user_message_id, owner_id, chat_id, status, created_at) VALUES (?, ?, ?, 'pending', ?)")
      .bind(userMessageId, ownerId, activeChat.id, now).run();
    ownsPendingTurn = (created.meta?.changes ?? 0) === 1;
  }
  if (!ownsPendingTurn) {
    const completed = await completedTurnResponse(db, ownerId, userMessageId, question, userCreatedAt);
    if (completed) return Response.json({ ...completed, safety });
    return productError("COACH_RESPONSE_PENDING", "FightIQ is still finishing that answer. Try again in a moment.", 409, { savedMessageId: userMessageId, safety });
  }
  const [memory, profile, workoutRows, nutrition, historyRows, activeExperiment] = await Promise.all([
    getMemorySnapshot(db, ownerId),
    getOrCreateProfile(db, ownerId),
    db.prepare("SELECT discipline, goal, fatigue, duration_minutes, plan_json, status, created_at FROM workout_plans WHERE owner_id = ? ORDER BY created_at DESC LIMIT 3").bind(ownerId).all(),
    getTodayNutrition(db, ownerId),
    db.prepare(`SELECT messages.id, messages.role, messages.content,
      enrichments.follow_up, enrichments.video_mode, enrichments.video_topic
      FROM coach_messages messages LEFT JOIN coach_message_enrichments enrichments
        ON enrichments.assistant_message_id = messages.id AND enrichments.owner_id = messages.owner_id
      WHERE messages.owner_id = ? AND messages.chat_id = ? ORDER BY messages.created_at DESC LIMIT 10`).bind(ownerId, activeChat.id).all<{
      id: string; role: string; content: string; follow_up: string | null; video_mode: string | null; video_topic: string | null;
    }>(),
    getActiveTrainingExperiment(db, ownerId),
  ]);
  try {
    const history = (historyRows.results ?? []).filter((message) => message.id !== userMessageId).reverse().map((message) => ({
      role: message.role, content: message.content, followUp: message.follow_up, videoMode: message.video_mode, videoTopic: message.video_topic,
    }));
    const answer = await answerCoach({ apiKey, allowMockAi, ownerId, db, question, memory, profile, workouts: workoutRows.results ?? [], nutrition, history, activeExperiment });
    const assistantMessageId = crypto.randomUUID();
    const assistantCreatedAt = new Date().toISOString();
    await db.batch([
      db.prepare("INSERT INTO coach_messages (id, owner_id, chat_id, role, content, created_at) VALUES (?, ?, ?, 'assistant', ?, ?)")
        .bind(assistantMessageId, ownerId, activeChat.id, answer.reply, assistantCreatedAt),
      db.prepare(`INSERT INTO coach_message_enrichments (
        assistant_message_id, owner_id, follow_up, follow_up_choices_json, video_mode, video_topic, video_prompt, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(assistantMessageId, ownerId, answer.followUp, JSON.stringify(answer.followUpChoices), answer.video.mode, answer.video.topic || null, answer.video.prompt || null, assistantCreatedAt),
      ...(answer.finding ? [db.prepare(`INSERT INTO coach_findings (
        id, owner_id, chat_id, assistant_message_id, problem, because, fix, basis_json, stated_confidence, status, canonical_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)`)
        .bind(crypto.randomUUID(), ownerId, activeChat.id, assistantMessageId, answer.finding.problem, answer.finding.because, answer.finding.fix,
          JSON.stringify(answer.finding.basis), answer.finding.confidence, findingKey(answer.finding.problem), assistantCreatedAt)] : []),
      db.prepare("UPDATE coach_turns SET assistant_message_id = ?, status = 'complete', completed_at = ? WHERE user_message_id = ? AND owner_id = ?")
        .bind(assistantMessageId, assistantCreatedAt, userMessageId, ownerId),
      db.prepare("UPDATE coach_chats SET title = CASE WHEN title IN ('General', 'New chat') THEN ? ELSE title END, updated_at = ? WHERE id = ? AND owner_id = ?")
        .bind(question.replace(/[?!.,]+$/g, "").slice(0, 42), assistantCreatedAt, activeChat.id, ownerId),
    ]);
    return Response.json({
      user: { id: userMessageId, role: "user", content: question, created_at: userCreatedAt },
      assistant: {
        id: assistantMessageId, role: "assistant", content: answer.reply, created_at: assistantCreatedAt,
        follow_up: answer.followUp || null, follow_up_choices: answer.followUpChoices, video_mode: answer.video.mode, video_topic: answer.video.topic || null, video_prompt: answer.video.prompt || null,
        // The card that asks whether the call is right. Nothing is recorded
        // until the athlete answers it.
        finding: answer.finding ? { ...answer.finding, messageId: assistantMessageId, status: "proposed" as const, choices: [...FINDING_CHOICES] } : null,
      },
      suggestions: getCoachSuggestions(
        memory,
        activeExperiment ? { mission: activeExperiment.mission, cue: activeExperiment.cue } : null,
        { followUp: answer.followUp, videoTopic: answer.video.topic },
      ),
      safety,
    });
  } catch (error) {
    await db.prepare("UPDATE coach_turns SET status = 'failed' WHERE user_message_id = ? AND owner_id = ? AND status = 'pending'").bind(userMessageId, ownerId).run();
    if (error instanceof ProductAIError) return productError(error.code, error.message, error.status, { ...error.development, savedMessageId: userMessageId, safety });
    console.error("Unexpected FightIQ Coach failure", error);
    return productError("AI_UNAVAILABLE", "FightIQ Coach couldn’t answer right now.", 503, { cause: error instanceof Error ? error.message.slice(0, 500) : "Unknown server error", savedMessageId: userMessageId, safety });
  }
}
