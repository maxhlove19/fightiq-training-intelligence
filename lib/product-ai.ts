import type { FighterProfile, MemorySnapshot } from "./product-db";

export class ProductAIError extends Error {
  constructor(public code: string, message: string, public status: number, public development?: Record<string, unknown>) { super(message); }
}

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
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
  workouts: unknown[]; nutrition: unknown; history: Array<{ role: string; content: string }>;
}) {
  if (!args.apiKey?.trim()) {
    if (args.allowMockAi) {
      return `Based on your current focus—${args.memory.currentFocus}—keep the next session simple: notice the first moment the position starts to break, use one correction, and review whether it held up under resistance. Your coach’s instruction should take priority over FightIQ.`;
    }
    throw new ProductAIError("AI_NOT_CONFIGURED", "FightIQ Coach is ready but its secure AI connection still needs to be activated.", 503, { cause: "OPENAI_API_KEY is missing from the server runtime." });
  }
  const payload = await responseRequest(args.apiKey, args.ownerId, {
    max_output_tokens: 650,
    text: { verbosity: "low" },
    input: [
      { role: "system", content: `You are FightIQ Coach, an MMA-first training intelligence assistant. Answer the athlete directly and practically using only relevant provided context. Distinguish athlete reports, coach instructions, and your own inference. Never contradict an in-person coach. Do not diagnose injuries. For dangerous weight cuts, eating disorders, severe symptoms, or urgent medical issues, advise qualified professional help. Keep most answers under 220 words and end with one actionable next step.` },
      { role: "user", content: JSON.stringify({
        question: args.question,
        fighter_memory: args.memory,
        profile: args.profile,
        recent_workouts: args.workouts,
        nutrition_today: args.nutrition,
        recent_conversation: args.history.slice(-8),
      }) },
    ],
  });
  const text = extractOutputText(payload)?.trim();
  if (!text) throw new ProductAIError("AI_INVALID_OUTPUT", "FightIQ returned an incomplete answer.", 502);
  return cleanCoachText(text).slice(0, 5000);
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
