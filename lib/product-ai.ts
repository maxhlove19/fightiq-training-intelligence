import type { FighterProfile, MemorySnapshot } from "./product-db";

export class ProductAIError extends Error {
  constructor(public code: string, message: string, public status: number, public development?: Record<string, unknown>) { super(message); }
}

export type CoachVideoOffer = {
  mode: "none" | "offer" | "direct";
  topic: string;
  prompt: string;
};

export type CoachReply = {
  reply: string;
  followUp: string;
  video: CoachVideoOffer;
};

async function safetyIdentifier(ownerId: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`fightiq:${ownerId}`));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 48);
}

function extractOutputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text;
  if (!Array.isArray(payload.output)) return null;
  for (const item of payload.output) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const message = item as Record<string, unknown>;
    if (!Array.isArray(message.content)) continue;
    for (const content of message.content) {
      if (content && typeof content === "object" && !Array.isArray(content)) {
        const block = content as Record<string, unknown>;
        if (block.type === "output_text" && typeof block.text === "string") return block.text;
      }
    }
  }
  return null;
}

// Models sometimes reach for Markdown even when the product language is conversational.
// Keep the stored and rendered coach voice clean rather than relying on each surface to strip it.
export function cleanCoachText(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/(?<!\*)\*(?!\*)/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const coachReplySchema = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "follow_up", "video"],
  properties: {
    reply: { type: "string" },
    follow_up: { type: "string" },
    video: {
      type: "object",
      additionalProperties: false,
      required: ["mode", "topic", "prompt"],
      properties: {
        mode: { type: "string", enum: ["none", "offer", "direct"] },
        topic: { type: "string" },
        prompt: { type: "string" },
      },
    },
  },
};

function coachReplyFrom(value: unknown): CoachReply {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProductAIError("AI_INVALID_OUTPUT", "FightIQ returned an incomplete answer.", 502);
  const reply = value as Record<string, unknown>;
  const video = reply.video;
  if (typeof reply.reply !== "string" || typeof reply.follow_up !== "string" || !video || typeof video !== "object" || Array.isArray(video)) {
    throw new ProductAIError("AI_INVALID_OUTPUT", "FightIQ returned an incomplete answer.", 502);
  }
  const offer = video as Record<string, unknown>;
  if (!(["none", "offer", "direct"] as string[]).includes(String(offer.mode)) || typeof offer.topic !== "string" || typeof offer.prompt !== "string") {
    throw new ProductAIError("AI_INVALID_OUTPUT", "FightIQ returned an incomplete answer.", 502);
  }
  const replySentences = cleanCoachText(reply.reply).replace(/\?+/g, ".").split(/(?<=[.!])\s+/).filter(Boolean).slice(0, 2).join(" ");
  const rawFollowUp = cleanCoachText(reply.follow_up).replace(/[.\s]+$/g, "");
  const videoMode = offer.mode as CoachVideoOffer["mode"];
  const cleaned = {
    reply: replySentences.slice(0, 420),
    followUp: `${rawFollowUp.replace(/\?+/g, "").slice(0, 148)}?`,
    // A no-video answer should not carry stale or speculative video text into
    // the saved conversation. That keeps a later turn's context truthful.
    video: videoMode === "none"
      ? { mode: videoMode, topic: "", prompt: "" }
      : { mode: videoMode, topic: cleanCoachText(offer.topic).slice(0, 140), prompt: cleanCoachText(offer.prompt).slice(0, 180) },
  };
  if (!cleaned.reply || cleaned.followUp === "?" || cleaned.followUp.replace(/\?$/, "").trim().split(/\s+/).length < 3 || (cleaned.video.mode !== "none" && (!cleaned.video.topic || !cleaned.video.prompt))) {
    throw new ProductAIError("AI_INVALID_OUTPUT", "FightIQ returned an incomplete answer.", 502);
  }
  return cleaned;
}

async function responseRequest(apiKey: string, ownerId: string, body: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        reasoning: { effort: "low" },
        store: false,
        safety_identifier: await safetyIdentifier(ownerId),
        ...body,
      }),
    });
    if (!response.ok) {
      const requestId = response.headers.get("x-request-id") ?? response.headers.get("request-id");
      let providerCode = "unknown";
      let providerMessage = "OpenAI returned a non-success response.";
      try {
        const failure = await response.json() as { error?: { code?: unknown; message?: unknown } };
        if (typeof failure.error?.code === "string") providerCode = failure.error.code.slice(0, 120);
        if (typeof failure.error?.message === "string") providerMessage = failure.error.message.slice(0, 500);
      } catch { /* preserve the HTTP-level diagnostic */ }
      throw new ProductAIError("AI_UPSTREAM_ERROR", "FightIQ couldn’t answer right now.", response.status === 429 ? 429 : 503, {
        upstreamStatus: response.status,
        providerCode,
        providerMessage,
        ...(requestId ? { requestId } : {}),
      });
    }
    return await response.json() as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ProductAIError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new ProductAIError("AI_TIMEOUT", "FightIQ took too long to respond.", 504, { timeoutMs: 20000 });
    throw new ProductAIError("AI_NETWORK_ERROR", "FightIQ couldn’t answer right now.", 503, { cause: error instanceof Error ? error.message.slice(0, 500) : "Unknown network error" });
  } finally { clearTimeout(timeout); }
}

export async function answerCoach(args: {
  apiKey?: string; allowMockAi?: boolean; ownerId: string; question: string; memory: MemorySnapshot; profile: FighterProfile;
  workouts: unknown[]; nutrition: unknown; history: Array<{ role: string; content: string; followUp?: string | null; videoMode?: string | null; videoTopic?: string | null }>; activeExperiment?: unknown;
}) {
  if (!args.apiKey?.trim()) {
    if (args.allowMockAi) {
      return {
        reply: `I have your current focus as ${args.memory.currentFocus}. I want to understand where it is breaking down before I suggest a change.`,
        followUp: "What is the first thing you notice going wrong when you try it?",
        video: { mode: "none", topic: "", prompt: "" },
      } satisfies CoachReply;
    }
    throw new ProductAIError("AI_NOT_CONFIGURED", "FightIQ Coach is ready but its secure AI connection still needs to be activated.", 503, { cause: "OPENAI_API_KEY is missing from the server runtime." });
  }
  const payload = await responseRequest(args.apiKey, args.ownerId, {
    max_output_tokens: 420,
    text: { verbosity: "low", format: { type: "json_schema", name: "fightiq_coach_reply", strict: true, schema: coachReplySchema } },
    input: [
      { role: "system", content: `You are FightIQ Coach, a thoughtful MMA-first coach who remembers the athlete's training. Sound like a good coach in a real conversation: calm, curious, observant, and concise. Never sound like a report, therapist, motivational speaker, or content creator.

Use the response JSON exactly. reply is one or two short, plain-language sentences and must not contain a question. follow_up is exactly one short, direct question ending in a question mark. No Markdown, headings, bullets, slogans, or stock phrases. Avoid phrases such as "keep it simple", "the key is", "one clean rep", "see what breaks", "next step", and "under resistance" unless the athlete used those exact words.

First decide whether a missing detail would change your advice. For technique, training, recovery, or strategy questions with meaningful uncertainty, say only what is clear, then ask the one missing question. Do not guess the cause or prescribe a drill first. When enough context is already present, answer it directly, then ask one natural question that would help tailor what comes next. Never ask more than one question and never repeat an answer already in the supplied context. A direct safety response still needs a gentle, relevant question when it is safe to continue.

Conversation continuity matters more than sounding clever. If the latest assistant turn in recent_conversation included a follow_up and the athlete's new message answers it, acknowledge the reported detail and build from it. Do not reset to a generic baseline question or ask the same thing again. Make the next question the smallest uncertainty that would genuinely change what you recommend. Do not use vague prompts like "what do you think?" or "how did that feel?" when the context gives you a more specific thing to ask. Keep the athlete's own language where it helps them recognize the moment.

Treat coach or instructor details as high-value athlete reports; attribute them to the coach and do not replace or contradict them. Separate athlete reports from FightIQ inference. Do not diagnose injuries. For dangerous weight cuts, eating disorders, severe symptoms, or urgent medical issues, advise qualified professional help.

video.mode is "direct" only when the athlete explicitly asks for a video, a clip, or a fighter/technique to study. It is "offer" only when a visual technique study would genuinely help; otherwise "none". For "offer" or "direct", set video.topic to a specific searchable technique topic and video.prompt to a short natural invitation. Do not offer a video for nutrition, medical, safety, or simple factual questions. FightIQ supplies the actual video; never invent a link or title.` },
      { role: "user", content: JSON.stringify({
        question: args.question,
        fighter_memory: compactCoachMemory(args.memory),
        profile: { current_focus: args.profile.current_focus, focus_reason: args.profile.focus_reason, primary_goal: args.profile.primary_goal, style_influences: safeArray(args.profile.style_influences_json) },
        recent_workouts: compactWorkouts(args.workouts),
        nutrition_today: compactNutrition(args.nutrition),
        active_pre_training_experiment: args.activeExperiment ?? null,
        recent_conversation: args.history.slice(-8).map((message) => ({
          role: message.role,
          content: message.content.slice(0, 600),
          ...(message.followUp ? { follow_up: message.followUp.slice(0, 180) } : {}),
          ...(message.videoMode && message.videoMode !== "none" ? { video: { mode: message.videoMode, topic: message.videoTopic ?? "" } } : {}),
        })),
      }) },
    ],
  });
  const text = extractOutputText(payload);
  if (!text) throw new ProductAIError("AI_INVALID_OUTPUT", "FightIQ returned an incomplete answer.", 502);
  try { return coachReplyFrom(JSON.parse(text)); }
  catch (error) { if (error instanceof ProductAIError) throw error; throw new ProductAIError("AI_INVALID_OUTPUT", "FightIQ returned an incomplete answer.", 502); }
}

function safeArray(value: string) {
  try { return JSON.parse(value).filter((item: unknown) => typeof item === "string").slice(0, 5); } catch { return []; }
}

function compactCoachMemory(memory: MemorySnapshot) {
  return {
    current_focus: memory.currentFocus,
    focus_reason: memory.focusReason,
    recurring_problems: memory.recurringProblems.slice(0, 3),
    strongest_areas: memory.strongestAreas.slice(0, 3),
    recent_improvement: memory.recentImprovement,
    instructor_details: memory.instructorDetails.slice(0, 3),
    emerging_strengths: memory.emergingStrengths.slice(0, 3),
    working_observations: memory.oneTimeObservations.slice(0, 4),
    next_evolution: memory.nextEvolution,
    recent_training: memory.recentTraining.slice(0, 3).map((item) => ({
      discipline: item.discipline,
      session_type: item.sessionType,
      note: item.note.slice(0, 700),
      takeaway: item.takeaway?.slice(0, 250) ?? null,
      focus: item.focus?.slice(0, 180) ?? null,
    })),
  };
}

function compactWorkouts(value: unknown[]) {
  return value.slice(0, 3).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const workout = item as Record<string, unknown>;
    const discipline = typeof workout.discipline === "string" ? workout.discipline.slice(0, 80) : "Training";
    const goal = typeof workout.goal === "string" ? workout.goal.slice(0, 140) : "";
    const fatigue = typeof workout.fatigue === "string" ? workout.fatigue.slice(0, 60) : "";
    const duration = typeof workout.duration_minutes === "number" ? workout.duration_minutes : null;
    const status = typeof workout.status === "string" ? workout.status.slice(0, 32) : "planned";
    return [{ discipline, goal, fatigue, duration_minutes: duration, status }];
  });
}

function compactNutrition(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const nutrition = value as Record<string, unknown>;
  return { totals: nutrition.totals ?? null, entry_count: Array.isArray(nutrition.entries) ? nutrition.entries.length : 0 };
}

export type MealEstimate = {
  description: string;
  foods: Array<{ name: string; portion: string }>;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: "low" | "medium" | "high";
  note: string;
};

const mealSchema = {
  type: "object",
  additionalProperties: false,
  required: ["description", "foods", "calories", "protein", "carbs", "fat", "confidence", "note"],
  properties: {
    description: { type: "string" },
    foods: { type: "array", minItems: 1, maxItems: 12, items: { type: "object", additionalProperties: false, required: ["name", "portion"], properties: { name: { type: "string" }, portion: { type: "string" } } } },
    calories: { type: "integer", minimum: 0, maximum: 10000 },
    protein: { type: "number", minimum: 0, maximum: 1000 },
    carbs: { type: "number", minimum: 0, maximum: 2000 },
    fat: { type: "number", minimum: 0, maximum: 1000 },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    note: { type: "string" },
  },
};

export async function analyzeMeal(args: { apiKey?: string; allowMockAi?: boolean; ownerId: string; description: string; image?: { dataUrl: string; mimeType: string } }) {
  if (!args.apiKey?.trim()) {
    if (args.allowMockAi) return mockMeal(args.description, Boolean(args.image));
    throw new ProductAIError("AI_NOT_CONFIGURED", "Food estimation is ready but its secure AI connection still needs to be activated.", 503, { cause: "OPENAI_API_KEY is missing from the server runtime." });
  }
  const content: Array<Record<string, unknown>> = [{
    type: "input_text",
    text: `Estimate this meal for editable food logging. User description: ${args.description || "No description supplied."}. Identify visible foods conservatively. Return realistic calories and grams of protein, carbohydrates, and fat. State uncertainty in note. This is an estimate, not medical advice.`,
  }];
  if (args.image) content.push({ type: "input_image", image_url: args.image.dataUrl, detail: "low" });
  const payload = await responseRequest(args.apiKey, args.ownerId, {
    max_output_tokens: 650,
    text: { verbosity: "low", format: { type: "json_schema", name: "fightiq_meal_estimate", strict: true, schema: mealSchema } },
    input: [{ role: "user", content }],
  });
  const text = extractOutputText(payload);
  if (!text) throw new ProductAIError("AI_INVALID_OUTPUT", "FightIQ couldn’t read that meal.", 502);
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new ProductAIError("AI_INVALID_OUTPUT", "FightIQ couldn’t read that meal.", 502); }
  return validateMeal(value);
}

function validateMeal(value: unknown): MealEstimate {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProductAIError("AI_INVALID_OUTPUT", "FightIQ returned an invalid meal estimate.", 502);
  const item = value as Record<string, unknown>;
  if (typeof item.description !== "string" || !Array.isArray(item.foods) || !["low", "medium", "high"].includes(String(item.confidence)) || typeof item.note !== "string") throw new ProductAIError("AI_INVALID_OUTPUT", "FightIQ returned an invalid meal estimate.", 502);
  for (const key of ["calories", "protein", "carbs", "fat"]) if (typeof item[key] !== "number" || Number(item[key]) < 0) throw new ProductAIError("AI_INVALID_OUTPUT", "FightIQ returned an invalid meal estimate.", 502);
  const foods = item.foods.filter((food): food is { name: string; portion: string } => Boolean(food) && typeof food === "object" && !Array.isArray(food) && typeof (food as Record<string, unknown>).name === "string" && typeof (food as Record<string, unknown>).portion === "string");
  if (!foods.length) throw new ProductAIError("AI_INVALID_OUTPUT", "FightIQ returned an invalid meal estimate.", 502);
  return { description: item.description, foods, calories: Math.round(item.calories as number), protein: item.protein as number, carbs: item.carbs as number, fat: item.fat as number, confidence: item.confidence as MealEstimate["confidence"], note: item.note };
}

function mockMeal(description: string, hasImage: boolean): MealEstimate {
  const lower = description.toLowerCase();
  const protein = lower.includes("chicken") ? 48 : lower.includes("eggs") ? 24 : 32;
  const carbs = lower.includes("rice") ? 62 : lower.includes("oat") ? 55 : 42;
  const fat = lower.includes("avocado") ? 24 : 16;
  return {
    description: description || (hasImage ? "Meal from photo" : "Logged meal"),
    foods: [{ name: description || "Visible meal", portion: "Estimate—edit before saving" }],
    calories: Math.round(protein * 4 + carbs * 4 + fat * 9), protein, carbs, fat,
    confidence: hasImage ? "medium" : "low", note: "Review the portions before saving; this is a visual/text estimate.",
  };
}
