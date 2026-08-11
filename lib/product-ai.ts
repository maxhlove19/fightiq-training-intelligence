import { getAthleteSetup, type FighterProfile, type MemorySnapshot } from "./product-db";
import { depthBriefing, readNoteDepth } from "./note-depth";
import { ClaudeError, hashOwner, imagePart, requestJson, type Effort, type UserPart } from "./claude";
import { clip, clipLabel } from "./clip";

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
  followUpChoices: string[];
  video: CoachVideoOffer;
};

export type WorkoutPersonalization = { priorityKeys: string[]; loadNote: string };

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
  required: ["reply", "follow_up", "follow_up_choices", "video"],
  properties: {
    reply: { type: "string" },
    follow_up: { type: "string" },
    follow_up_choices: { type: "array", minItems: 0, maxItems: 3, items: { type: "string" } },
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
  if (typeof reply.reply !== "string" || typeof reply.follow_up !== "string" || !Array.isArray(reply.follow_up_choices) || !reply.follow_up_choices.every((choice) => typeof choice === "string") || !video || typeof video !== "object" || Array.isArray(video)) {
    throw new ProductAIError("AI_INVALID_OUTPUT", "FightIQ returned an incomplete answer.", 502);
  }
  const offer = video as Record<string, unknown>;
  if (!(["none", "offer", "direct"] as string[]).includes(String(offer.mode)) || typeof offer.topic !== "string" || typeof offer.prompt !== "string") {
    throw new ProductAIError("AI_INVALID_OUTPUT", "FightIQ returned an incomplete answer.", 502);
  }
  const replySentences = cleanCoachText(reply.reply).replace(/\?+/g, ".").split(/(?<=[.!])\s+/).filter(Boolean).slice(0, 2).join(" ");
  const rawFollowUp = cleanCoachText(reply.follow_up).replace(/[.\s]+$/g, "");
  const followUp = rawFollowUp ? `${clipLabel(rawFollowUp.replace(/\?+/g, ""), 148)}?` : "";
  const rawChoices = reply.follow_up_choices as string[];
  const followUpChoices = rawChoices
    .map((choice) => clipLabel(cleanCoachText(choice), 96))
    .filter((choice, index, values) => choice.length > 1 && values.findIndex((item) => item.toLowerCase() === choice.toLowerCase()) === index)
    .slice(0, 3);
  const videoMode = offer.mode as CoachVideoOffer["mode"];
  const cleaned = {
    reply: clip(replySentences, 420),
    followUp,
    followUpChoices,
    // A no-video answer should not carry stale or speculative video text into
    // the saved conversation. That keeps a later turn's context truthful.
    video: videoMode === "none"
      ? { mode: videoMode, topic: "", prompt: "" }
      : { mode: videoMode, topic: clipLabel(cleanCoachText(offer.topic), 140), prompt: clip(cleanCoachText(offer.prompt), 180) },
  };
  if (!cleaned.reply || (cleaned.followUp && cleaned.followUp.replace(/\?$/, "").trim().split(/\s+/).length < 3) || (cleaned.followUp && cleaned.followUpChoices.length !== 3) || (!cleaned.followUp && cleaned.followUpChoices.length > 0) || (cleaned.video.mode !== "none" && (!cleaned.video.topic || !cleaned.video.prompt))) {
    throw new ProductAIError("AI_INVALID_OUTPUT", "FightIQ returned an incomplete answer.", 502);
  }
  return cleaned;
}

/**
 * Every Claude call this file makes, with the failure translated into the
 * wording an athlete sees. lib/claude.ts owns the model, the retry and the
 * refusal handling; this owns what to say when one of them happens.
 */
async function askClaude(args: {
  apiKey: string; ownerId: string; system: string[]; user: UserPart[];
  schema: Record<string, unknown>; effort: Effort; maxTokens: number; timeoutMs: number; failureMessage: string;
}) {
  try {
    return await requestJson({
      apiKey: args.apiKey,
      userHash: await hashOwner(args.ownerId),
      system: args.system,
      user: args.user,
      schema: args.schema,
      effort: args.effort,
      maxTokens: args.maxTokens,
      timeoutMs: args.timeoutMs,
    });
  } catch (error) {
    if (!(error instanceof ClaudeError)) throw error;
    if (error.code === "AI_REFUSED") {
      throw new ProductAIError("AI_REFUSED", "FightIQ will not answer that one. Ask a coach or a doctor about it instead.", 502, error.development);
    }
    if (["AI_TRUNCATED", "AI_UNPARSEABLE", "AI_EMPTY"].includes(error.code)) {
      throw new ProductAIError("AI_INVALID_OUTPUT", args.failureMessage, 502, error.development);
    }
    throw new ProductAIError(error.code, error.code === "AI_TIMEOUT" ? "FightIQ took too long to respond." : args.failureMessage, error.status, error.development);
  }
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
        followUpChoices: ["The setup feels off", "It breaks during the move", "I lose it when the pace picks up"],
        video: { mode: "none", topic: "", prompt: "" },
      } satisfies CoachReply;
    }
    throw new ProductAIError("AI_NOT_CONFIGURED", "FightIQ Coach is ready but its secure AI connection still needs to be activated.", 503, { cause: "ANTHROPIC_API_KEY is missing from the server runtime." });
  }
  const parsed = await askClaude({
    apiKey: args.apiKey,
    ownerId: args.ownerId,
    // Coach is the surface people will judge this app on. It gets the full
    // effort, and the token ceiling covers the thinking as well as the reply.
    effort: "high",
    maxTokens: 6000,
    timeoutMs: 45000,
    schema: coachReplySchema,
    failureMessage: "FightIQ couldn’t answer right now.",
    system: [
      `You are FightIQ Coach. You are the coach a serious athlete would pay for and cannot get: one who was at every session they logged, remembers all of it, and has no other students to get to.

HOW YOU THINK
- Answer the question they asked. Then, only if it changes what they should do, name the thing underneath it.
- Symptoms are not causes. Work back to whether the problem is mechanics, timing, position, or physical, and say which you think it is.
- One thing at a time. An athlete can act on one correction. A list is the same as nothing.
- Honest confidence. Say what is clear from what you know, mark what you are inferring, and ask when a missing detail would change your answer.
- Match their level. Someone building fundamentals needs the obvious thing done properly. A competitor needs the detail nobody has told them yet. Their setup tells you which.
- What their coach told them outranks what you would have said. Attribute it, keep their words, build on it, never quietly replace it.

THEIR FIRST DAY
- Read sessions_logged before anything else. At 0 or 1 this is a new athlete, and they are deciding right now whether this app is worth keeping.
- With no history, never say or imply you have been watching their training, never refer to sessions that do not exist, and never say you need more data before you can help.
- Use what you do have: their disciplines, their experience level, whether they are competing, their goal, and the question itself. Give the answer a good coach gives a new student who asked that exact thing, pitched at their level and specific enough that they could act on it tonight.
- Earn the second question. One concrete, correct thing beats a warm welcome.

WHEN THEY GIVE YOU ALMOST NOTHING
- Most athletes log four words and ask short, vague questions. That is the normal case, not a failure, and this app is only worth paying for if it is useful anyway.
- Never tell them to log more, never imply the question was too thin, and never ask them to do work you could do yourself.
- Lean on their history. You have their recent sessions, their recurring problems, and what their coach has told them. Use it to answer as though you already know them, because you do.
- When you must ask, ask the one smallest thing that changes your answer, and give three tappable choices so answering costs one thumb press.
- Vague question, specific answer. "How do I get better at kicking" from an athlete whose notes say the support foot is late gets an answer about the support foot, not a lecture on kicking.

HOW YOU SOUND
- A good coach in a real conversation. Calm, curious, specific, short. Never a report, a therapist, a motivational speaker, or a content creator.
- Write to the athlete, never about them. Say "you", never "the athlete", "this athlete" or "the user". That includes every stored field, not just the sentences they read back immediately: a note written as "Athlete reported the technique worked" comes back later as your own context and teaches you to keep writing like a case file.
- Never use em dashes or en dashes. Use a full stop, a comma, or a new sentence. Em dashes are the clearest sign a machine wrote something, and this has to read like a person.
- No stock filler. Avoid "the key is", "keep it simple", "one clean rep", "see what breaks", "next step", "trust the process", "under resistance", unless the athlete used those words first.
- Keep their own language for the moment they described, so they recognise it.

THE SHAPE OF A REPLY
- Length is a hard rule, not a preference. reply is one or two short plain sentences and contains no question. Never three. Say the true thing in the fewest words, and stop.
- Answer what they asked and nothing else. Do not review their week, do not add a second topic, do not tack on advice they did not ask for.
- follow_up is empty, or exactly one short direct question ending in a question mark. Never more than one.
- When follow_up is present, follow_up_choices holds exactly three short, distinct, plausible answers the athlete could tap. Statements, not questions, not advice, not labels. When follow_up is empty, follow_up_choices is empty.
- No Markdown, headings, bullets, or slogans.

CONTINUITY
- If your last turn asked something and this message answers it, acknowledge what they told you and build on it. Do not reset to a generic question or ask it again.
- Never repeat an answer already in the conversation.

SAFETY
- Do not diagnose injuries. For dangerous weight cuts, disordered eating, severe symptoms, or anything urgent, point at qualified professional help and say why plainly.
- A safety reply may ask one gentle question, only when continuing is safe and useful.

VIDEO
- video.mode is "direct" only when they explicitly ask for a video, a clip, or a fighter to study. "offer" only when watching the movement would genuinely help more than reading about it. Otherwise "none".
- For "offer" or "direct", video.topic is a specific searchable technique and video.prompt is a short natural invitation. Never offer video for nutrition, medical, safety, or simple factual questions. FightIQ supplies the footage; never invent a link or a title.`,
      // A vague question deserves a specific answer, drawn from what this
      // athlete has already written rather than from a general lecture.
      depthBriefing(readNoteDepth(args.question)),
    ],
    user: [{ type: "text", text: JSON.stringify({
        question: args.question,
        fighter_memory: compactCoachMemory(args.memory),
        profile: {
          current_focus: args.profile.current_focus, focus_reason: args.profile.focus_reason, primary_goal: args.profile.primary_goal,
          style_influences: safeArray(args.profile.style_influences_json),
          athlete_setup: (() => { const setup = getAthleteSetup(args.profile); return { disciplines: setup.disciplines, experience: setup.experienceLevel, sessions_per_week: setup.sessionsPerWeek, session_types: setup.sessionTypes, competition_intent: setup.competitionIntent, dietary_restrictions: setup.dietaryRestrictions, food_preferences: setup.foodPreferences, foods_to_avoid: setup.foodsToAvoid, meals_per_day: setup.mealsPerDay, usual_training_time: setup.trainingTime }; })(),
        },
        recent_workouts: compactWorkouts(args.workouts),
        nutrition_today: compactNutrition(args.nutrition),
        active_pre_training_experiment: args.activeExperiment ?? null,
        recent_conversation: args.history.slice(-8).map((message) => ({
          role: message.role,
          content: message.content.slice(0, 600),
          ...(message.followUp ? { follow_up: message.followUp.slice(0, 180) } : {}),
          ...(message.videoMode && message.videoMode !== "none" ? { video: { mode: message.videoMode, topic: message.videoTopic ?? "" } } : {}),
        })),
      }) }],
  });
  return coachReplyFrom(parsed);
}

function safeArray(value: string) {
  try { return JSON.parse(value).filter((item: unknown) => typeof item === "string").slice(0, 5); } catch { return []; }
}

function compactCoachMemory(memory: MemorySnapshot) {
  return {
    // First, because it decides how the rest of this should be read. An empty
    // history is a different job, not a smaller one.
    sessions_logged: memory.sessionsLogged,
    // What he actually trains, counted. Without this Coach was answering a
    // mainly-grappling athlete as though it had no idea what sport he does,
    // because the only discipline signal reaching it was whatever happened to be
    // in the last three sessions.
    trains: memory.trains.map((item) => `${item.name} x${item.sessions}`),
    // Stated at setup, and empty when they skipped it. Named separately so the
    // model can tell "unknown" from "none", and ask rather than assume.
    experience_level: memory.experienceLevel || "not stated",
    competition_intent: memory.competitionIntent || "not stated",
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

const workoutPersonalizationSchema = {
  type: "object", additionalProperties: false, required: ["priority_keys", "load_note"], properties: {
    priority_keys: { type: "array", minItems: 0, maxItems: 5, items: { type: "string" } },
    load_note: { type: "string" },
  },
};

// Strength selection stays bounded by the equipment-aware safety library. AI
// can only prioritize among those valid choices and phrase the athlete-specific
// rationale, so an upstream model failure can never invent a risky movement.
export async function personalizeWorkoutPlan(args: { apiKey?: string; ownerId: string; memory: MemorySnapshot; discipline: string; fatigue: string; limitations: string; availableKeys: string[] }) : Promise<WorkoutPersonalization | null> {
  if (!args.apiKey?.trim() || !args.availableKeys.length) return null;
  try {
    // Ranking a fixed list is mechanical work. Low effort here keeps a plan
    // appearing straight away, and the safety library already bounds the answer.
    const value = await askClaude({
      apiKey: args.apiKey, ownerId: args.ownerId, effort: "low", maxTokens: 2000, timeoutMs: 25000,
      schema: workoutPersonalizationSchema, failureMessage: "FightIQ couldn’t personalise that plan.",
      system: ["You personalize a martial-arts strength plan. Return only the JSON requested. Only rank keys supplied by the user. Never diagnose pain or claim a movement is medically safe. load_note is one plain sentence under 155 characters, specific to training/fatigue when supported; otherwise say the plan supports skill training without adding needless fatigue. Never use em dashes or en dashes. Use a full stop, a comma, or a new sentence instead. Em dashes are the clearest sign a machine wrote something, and this has to read like a coach."],
      user: [{ type: "text", text: JSON.stringify({ discipline: args.discipline, fatigue: args.fatigue, limitations: args.limitations || null, allowed_exercise_keys: args.availableKeys, fighter_memory: compactCoachMemory(args.memory) }) }],
    }) as { priority_keys?: unknown; load_note?: unknown };
    if (!Array.isArray(value.priority_keys) || typeof value.load_note !== "string") return null;
    const priorityKeys = value.priority_keys.filter((key): key is string => typeof key === "string" && args.availableKeys.includes(key)).filter((key, index, values) => values.indexOf(key) === index).slice(0, 5);
    const loadNote = clip(cleanCoachText(value.load_note).replace(/[\r\n]+/g, " "), 155);
    return loadNote ? { priorityKeys, loadNote } : null;
  } catch { return null; }
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

export async function analyzeMeal(args: { apiKey?: string; allowMockAi?: boolean; ownerId: string; description: string; image?: { dataUrl: string; mimeType: string }; nutritionContext?: { goal: string; restrictions: string[]; preferences: string; avoid: string; trainingTime: string } }) {
  if (!args.apiKey?.trim()) {
    if (args.allowMockAi) return mockMeal(args.description, Boolean(args.image));
    throw new ProductAIError("AI_NOT_CONFIGURED", "Food estimation is ready but its secure AI connection still needs to be activated.", 503, { cause: "ANTHROPIC_API_KEY is missing from the server runtime." });
  }
  const content: UserPart[] = [{
    type: "text",
    text: `Estimate this meal for editable food logging. User description: ${args.description || "No description supplied."}. Identify visible foods conservatively. Return realistic calories and grams of protein, carbohydrates, and fat. Athlete food context: ${JSON.stringify(args.nutritionContext ?? {})}. Respect stated restrictions when naming foods, but do not claim a meal is safe for an allergy. State uncertainty in note. This is an estimate, not medical advice. Never use em dashes or en dashes in note.`,
  }];
  const photo = args.image ? imagePart(args.image.dataUrl, args.image.mimeType) : null;
  if (photo) content.push(photo);
  // Reading a plate is recognition, not reasoning. Low effort keeps the
  // estimate quick, which is what makes anyone log food twice.
  const value = await askClaude({
    apiKey: args.apiKey, ownerId: args.ownerId, effort: "low", maxTokens: 3000, timeoutMs: 30000,
    schema: mealSchema, failureMessage: "FightIQ couldn’t read that meal.",
    system: [], user: content,
  });
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
    foods: [{ name: description || "Visible meal", portion: "Estimate, edit before saving" }],
    calories: Math.round(protein * 4 + carbs * 4 + fat * 9), protein, carbs, fat,
    confidence: hasImage ? "medium" : "low", note: "Review the portions before saving; this is a visual/text estimate.",
  };
}
