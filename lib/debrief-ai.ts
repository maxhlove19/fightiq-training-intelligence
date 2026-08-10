// This is a safety ceiling, not a prescribed interview length. The model ends the
// conversation as soon as another answer would not materially change the next test.
const MAX_CLARIFYING_QUESTIONS = 4;

export type DebriefMemory = {
  techniques: string[]; positions: string[]; successes: string[]; problems: string[];
  concepts: string[]; sparring_observations: string[]; related_topics: string[]; instructor_details: string[];
  reported_facts: string[]; fightiq_hypotheses: string[]; what_worked: string[]; what_failed: string[]; experiments: string[];
};

export type TrainingIntelligence = {
  discipline: string; technique: string; goal: string; problem: string; suspected_cause: string;
  coach_instructor_cue: string; what_worked: string; what_failed: string; context: string;
  confidence: number; follow_up_needed: boolean; reported_facts: string[]; fightiq_hypotheses: string[];
  experiment_result: "unknown" | "helped" | "not_helped" | "mixed";
};

export type DebriefResult = {
  status: "question" | "complete";
  summary: string;
  takeaway: string;
  coach_detail: string;
  fightiq_explanation: string;
  next_session_focus: string;
  confidence: number;
  memory: DebriefMemory;
  intelligence: TrainingIntelligence;
  question: { prompt: string; choices: string[]; target_field: string; why_asked: string };
};

type Entry = { discipline: string; session_type: string; raw_entry: string };
type History = Array<{ sequence: number; question: string; answer: string | null; answer_source: string | null; status: string; target_field: string }>;

const resultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "summary", "takeaway", "coach_detail", "fightiq_explanation", "next_session_focus", "confidence", "memory", "intelligence", "question"],
  properties: {
    status: { type: "string", enum: ["question", "complete"] },
    summary: { type: "string" }, takeaway: { type: "string" }, coach_detail: { type: "string" },
    fightiq_explanation: { type: "string" }, next_session_focus: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    memory: {
      type: "object", additionalProperties: false,
      required: ["techniques", "positions", "successes", "problems", "concepts", "sparring_observations", "related_topics", "instructor_details", "reported_facts", "fightiq_hypotheses", "what_worked", "what_failed", "experiments"],
      properties: Object.fromEntries(["techniques", "positions", "successes", "problems", "concepts", "sparring_observations", "related_topics", "instructor_details", "reported_facts", "fightiq_hypotheses", "what_worked", "what_failed", "experiments"].map((key) => [key, { type: "array", items: { type: "string" } }])),
    },
    intelligence: {
      type: "object", additionalProperties: false,
      required: ["discipline", "technique", "goal", "problem", "suspected_cause", "coach_instructor_cue", "what_worked", "what_failed", "context", "confidence", "follow_up_needed", "reported_facts", "fightiq_hypotheses", "experiment_result"],
      properties: {
        discipline: { type: "string" }, technique: { type: "string" }, goal: { type: "string" }, problem: { type: "string" }, suspected_cause: { type: "string" }, coach_instructor_cue: { type: "string" }, what_worked: { type: "string" }, what_failed: { type: "string" }, context: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 }, follow_up_needed: { type: "boolean" }, reported_facts: { type: "array", items: { type: "string" } }, fightiq_hypotheses: { type: "array", items: { type: "string" } }, experiment_result: { type: "string", enum: ["unknown", "helped", "not_helped", "mixed"] },
      },
    },
    question: {
      type: "object", additionalProperties: false,
      required: ["prompt", "choices", "target_field", "why_asked"],
      properties: {
        prompt: { type: "string" },
        choices: { type: "array", minItems: 0, maxItems: 4, items: { type: "string" } },
        target_field: { type: "string" }, why_asked: { type: "string" },
      },
    },
  },
};

const systemPrompt = `You are FightIQ, a warm, observant MMA training intelligence coach. You are having a short, natural clarification conversation after training.

Rules:
- Preserve the athlete's raw account. Never invent facts. Treat anything the athlete says a coach/instructor taught as high-value instructor_detail memory, quoted or closely paraphrased, never as your own instruction.
- Keep reported coach details separate from FightIQ explanations. coach_detail contains only the athlete's report of what their coach said. fightiq_explanation must use uncertainty language when causal reasoning is not certain.
- Speak like a concise human coach: natural sentences, no Markdown, no headings, no bullets, no report language. Keep each field short.
- Ask one short question at a time, only while the answer could materially improve the athlete's next experiment. Do not use a fixed question count. Do not repeat facts already stated. When a pre-training experiment exists, first ask how that specific test went.
- For vague notes, clarify the observed problem before naming a cause. Useful uncertainty includes what happened, what worked or failed, side/situation, mechanics versus timing/balance/mobility, resistance, an instructor cue, and what the athlete tried.
- Set intelligence.follow_up_needed true and status question only when a further answer is materially useful. Otherwise set it false and status complete. Never turn a single observation into a confirmed weakness.
- Keep athlete-reported facts in reported_facts. Put only qualified FightIQ reasoning in fightiq_hypotheses and suspected_cause. Instructor teaching belongs in coach_instructor_cue and memory.instructor_details, not as FightIQ advice.
- Suggested choices are optional, short answer starters only. A natural spoken/typed answer is always preferred.
- Questions are optional. Do not diagnose injuries or give dangerous weight-cut advice.
- If status is complete, return an empty question prompt, choices, target_field, and why_asked.
- Keep the takeaway and next-session focus concise and directly useful.`;

export async function generateDebrief(args: {
  apiKey?: string; allowMockAi?: boolean; ownerId: string; entry: Entry; history: History; current?: Record<string, unknown> | null; preTrainingBrief?: Record<string, unknown> | null; activeExperiment?: Record<string, unknown> | null;
}): Promise<DebriefResult> {
  const nextSequence = args.history.length + 1;
  const allowQuestion = nextSequence <= MAX_CLARIFYING_QUESTIONS;
  if (!args.apiKey?.trim()) {
    if (args.allowMockAi) {
      const result = mockDebrief(args.entry, args.history);
      if (!allowQuestion && result.status === "question") throw new DebriefAIError("AI_INVALID_OUTPUT", "FightIQ exceeded the question limit.", 502);
      return result;
    }
    throw new DebriefAIError("AI_NOT_CONFIGURED", "FightIQ AI is not configured yet.", 503, { cause: "OPENAI_API_KEY is missing from the server runtime." });
  }
  const safetyIdentifier = await hashIdentifier(args.ownerId);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: { "authorization": `Bearer ${args.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        store: false,
        safety_identifier: safetyIdentifier,
        reasoning: { effort: "low" },
        max_output_tokens: 900,
        text: { verbosity: "low", format: { type: "json_schema", name: "fightiq_debrief", strict: true, schema: resultSchema } },
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify({
            task: args.history.length === 0 ? "Create the initial takeaway and first clarification question." : "Use the answer to update training intelligence. Ask another question only if it materially changes the next experiment; otherwise complete the debrief.",
            must_ask_question: args.history.length === 0,
            allow_another_question: allowQuestion,
            next_question_sequence: nextSequence,
            discipline: args.entry.discipline,
            session_type: args.entry.session_type,
            raw_training_note: args.entry.raw_entry,
            previous_questions_and_answers: args.history,
            current_debrief: args.current ?? null,
            pre_training_brief_for_this_session: args.preTrainingBrief ?? null,
            active_experiment_for_this_session: args.activeExperiment ?? null,
          }) },
        ],
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new DebriefAIError("AI_TIMEOUT", "FightIQ took too long to respond.", 504, { timeoutMs: 15000 });
    throw new DebriefAIError("AI_NETWORK_ERROR", "FightIQ could not prepare the debrief.", 503, { cause: error instanceof Error ? error.message.slice(0, 500) : "Unknown network error" });
  } finally { clearTimeout(timeout); }
  if (!response.ok) {
    const requestId = response.headers.get("x-request-id") ?? response.headers.get("request-id");
    let providerCode = "unknown";
    let providerMessage = "OpenAI returned a non-success response.";
    try {
      const failure = await response.json() as { error?: { code?: unknown; message?: unknown } };
      if (typeof failure.error?.code === "string") providerCode = failure.error.code.slice(0, 120);
      if (typeof failure.error?.message === "string") providerMessage = failure.error.message.slice(0, 500);
    } catch { /* preserve the HTTP-level diagnostic */ }
    throw new DebriefAIError("AI_UPSTREAM_ERROR", "FightIQ could not prepare the debrief.", response.status === 429 ? 429 : 503, {
      upstreamStatus: response.status, providerCode, providerMessage, ...(requestId ? { requestId } : {}),
    });
  }
  let payload: Record<string, unknown>;
  try { payload = await response.json() as Record<string, unknown>; }
  catch { throw new DebriefAIError("AI_INVALID_OUTPUT", "FightIQ returned an unreadable debrief response.", 502); }
  const text = extractOutputText(payload);
  if (!text) throw new DebriefAIError("AI_INVALID_OUTPUT", "FightIQ returned an incomplete debrief.", 502);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return resilientDebrief(args.entry, args.history, args.activeExperiment); }
  // A model response can be useful while still missing a nonessential structured field.
  // Never make a saved training note unrecoverable because a strict schema is imperfect.
  let result: DebriefResult;
  try { result = validateDebriefResult(parsed); }
  catch { result = resilientDebrief(args.entry, args.history, args.activeExperiment); }
  if (args.history.length === 0 && result.status !== "question") throw new DebriefAIError("AI_INVALID_OUTPUT", "FightIQ did not return the first question.", 502);
  if (!allowQuestion && result.status === "question") throw new DebriefAIError("AI_INVALID_OUTPUT", "FightIQ exceeded the question limit.", 502);
  return result;
}

function extractOutputText(payload: Record<string, unknown>): string | null {
  if (typeof payload.output_text === "string") return payload.output_text;
  if (!Array.isArray(payload.output)) return null;
  for (const item of payload.output) {
    if (!isRecord(item) || item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content) if (isRecord(content) && content.type === "output_text" && typeof content.text === "string") return content.text;
  }
  return null;
}

export function validateDebriefResult(value: unknown): DebriefResult {
  if (!isRecord(value) || (value.status !== "question" && value.status !== "complete")) throw invalid();
  const strings = ["summary", "takeaway", "coach_detail", "fightiq_explanation", "next_session_focus"] as const;
  if (strings.some((key) => typeof value[key] !== "string")) throw invalid();
  if (typeof value.confidence !== "number" || value.confidence < 0 || value.confidence > 1) throw invalid();
  if (!isRecord(value.memory) || !isRecord(value.question)) throw invalid();
  const memoryKeys = ["techniques", "positions", "successes", "problems", "concepts", "sparring_observations", "related_topics", "instructor_details", "reported_facts", "fightiq_hypotheses", "what_worked", "what_failed", "experiments"] as const;
  for (const key of memoryKeys) if (!stringArray(value.memory[key])) throw invalid();
  if (typeof value.question.prompt !== "string" || !stringArray(value.question.choices) || value.question.choices.length > 3 || typeof value.question.target_field !== "string" || typeof value.question.why_asked !== "string") throw invalid();
  if (!isRecord(value.intelligence)) throw invalid();
  const intelligenceStrings = ["discipline", "technique", "goal", "problem", "suspected_cause", "coach_instructor_cue", "what_worked", "what_failed", "context"] as const;
  if (intelligenceStrings.some((key) => typeof value.intelligence[key] !== "string") || typeof value.intelligence.confidence !== "number" || value.intelligence.confidence < 0 || value.intelligence.confidence > 1 || typeof value.intelligence.follow_up_needed !== "boolean" || !stringArray(value.intelligence.reported_facts) || !stringArray(value.intelligence.fightiq_hypotheses) || !["unknown", "helped", "not_helped", "mixed"].includes(String(value.intelligence.experiment_result))) throw invalid();
  if (value.status === "question" && (!value.question.prompt.trim() || value.intelligence.follow_up_needed !== true)) throw invalid();
  if (value.status === "complete" && value.intelligence.follow_up_needed !== false) throw invalid();
  const result = value as DebriefResult;
  const clean = (text: string) => text.replace(/\*\*(.*?)\*\*/g, "$1").replace(/__(.*?)__/g, "$1").replace(/^\s{0,3}#{1,6}\s*/gm, "").replace(/^\s*[-*]\s+/gm, "").trim();
  result.summary = clean(result.summary); result.takeaway = clean(result.takeaway); result.coach_detail = clean(result.coach_detail);
  result.fightiq_explanation = clean(result.fightiq_explanation); result.next_session_focus = clean(result.next_session_focus);
  result.question.prompt = clean(result.question.prompt); result.question.choices = result.question.choices.map(clean);
  result.memory.instructor_details = result.memory.instructor_details.map(clean);
  result.memory.reported_facts = result.memory.reported_facts.map(clean); result.memory.fightiq_hypotheses = result.memory.fightiq_hypotheses.map(clean);
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function stringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === "string"); }
function invalid() { return new DebriefAIError("AI_INVALID_OUTPUT", "FightIQ returned an invalid debrief.", 502); }

async function hashIdentifier(value: string) {
  const bytes = new TextEncoder().encode(`fightiq:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 48);
}

function mockDebrief(entry: Entry, history: History): DebriefResult {
  const memory: DebriefMemory = { techniques: [], positions: [], successes: [], problems: [], concepts: [], sparring_observations: [], related_topics: [], instructor_details: [], reported_facts: [], fightiq_hypotheses: [], what_worked: [], what_failed: [], experiments: [] };
  const intelligence: TrainingIntelligence = { discipline: entry.discipline, technique: "", goal: "", problem: "", suspected_cause: "", coach_instructor_cue: "", what_worked: "", what_failed: "", context: entry.session_type, confidence: .35, follow_up_needed: history.length < 1, reported_facts: [entry.raw_entry], fightiq_hypotheses: [], experiment_result: "unknown" };
  if (history.length >= 1) return {
    status: "complete", summary: entry.raw_entry.slice(0, 180), takeaway: "You understood the session detail, and the next step is making it reliable against live resistance.",
    coach_detail: "", fightiq_explanation: "Before we settle on a cause, it helps to know where the detail first starts to slip.",
    next_session_focus: "Notice the moment the detail stops working, then test one small change.", confidence: .82, memory,
    intelligence: { ...intelligence, follow_up_needed: false, confidence: .72 }, question: { prompt: "", choices: [], target_field: "", why_asked: "" },
  };
  const first: Record<string, [string, string[], string]> = {
    MMA: ["Where did it first start to fall apart?", ["At the entry", "Against the fence", "During the transition", "After I defended"], "first_breakdown"],
    BJJ: ["What control did you lose first?", ["Frames", "Inside position", "Hip position", "Grip control"], "first_control_lost"],
    Wrestling: ["When were you getting beaten?", ["On the entry", "During the finish", "After my first defense", "In the scramble"], "breakdown_phase"],
    Boxing: ["When was the opening showing up?", ["On entry", "During the exchange", "On exit", "After I attacked"], "striking_phase"],
    "Muay Thai": ["When was the opening showing up?", ["On entry", "In the pocket", "On exit", "In the clinch"], "striking_phase"],
    Kickboxing: ["When was the opening showing up?", ["On entry", "During the exchange", "On exit", "After I kicked"], "striking_phase"],
  };
  const prompt = first[entry.discipline] ?? first.MMA;
  return { status: "question", summary: entry.raw_entry.slice(0, 180), takeaway: "You have the detail. Now we need to see what changes once the round gets live.", coach_detail: "", fightiq_explanation: "That tells us what to test instead of guessing.", next_session_focus: "", confidence: history.length ? .68 : .48, memory, intelligence, question: { prompt: prompt[0] as string, choices: prompt[1] as string[], target_field: prompt[2] as string, why_asked: "This answer decides what FightIQ should help you test." } };
}

function resilientDebrief(entry: Entry, history: History, activeExperiment?: Record<string, unknown> | null): DebriefResult {
  const note = entry.raw_entry;
  const lower = note.toLowerCase();
  const kickSession = /kick|bag|hip|pivot/.test(lower);
  const coachMatch = note.match(/(?:coach|instructor)(?: told me| said| taught me)?\s*(?:to )?(.+?)(?:[.!?]|$)/i);
  const technique = kickSession ? "kicks" : entry.discipline;
  const coachDetail = coachMatch?.[1]?.trim() ?? "";
  const baseMemory: DebriefMemory = {
    techniques: [technique], positions: [], successes: [], problems: [], concepts: kickSession ? ["hip rotation", "support-foot pivot", "balance"] : [], sparring_observations: [], related_topics: kickSession ? ["round kick mechanics", "hip rotation", "support-foot pivot", "balance"] : [], instructor_details: coachDetail ? [coachDetail] : [], reported_facts: [note], fightiq_hypotheses: [], what_worked: [], what_failed: [], experiments: activeExperiment && typeof activeExperiment.mission === "string" ? [activeExperiment.mission] : [],
  };
  const activeMission = activeExperiment && typeof activeExperiment.mission === "string" ? activeExperiment.mission : "";
  const activeCue = activeExperiment && typeof activeExperiment.cue === "string" ? activeExperiment.cue : "";
  const intelligence: TrainingIntelligence = { discipline: entry.discipline, technique, goal: kickSession ? "Cleaner kick mechanics" : "", problem: "", suspected_cause: "", coach_instructor_cue: coachDetail, what_worked: "", what_failed: "", context: entry.session_type, confidence: .35, follow_up_needed: history.length === 0, reported_facts: [note], fightiq_hypotheses: [], experiment_result: "unknown" };
  if (history.length > 0) return {
    status: "complete", summary: note.slice(0, 220), takeaway: "Your session is saved with the detail you reported.", coach_detail: coachDetail, fightiq_explanation: "FightIQ needs more repeated evidence before calling this a pattern.", next_session_focus: kickSession ? "Use controlled reps and notice whether the support-foot pivot changes your rotation and balance." : "Repeat one clear detail and notice what changes as the pace picks up.", confidence: .58, memory: baseMemory, intelligence: { ...intelligence, follow_up_needed: false, confidence: .58 }, question: { prompt: "", choices: [], target_field: "", why_asked: "" },
  };
  const prompt = activeMission
    ? `How did ${activeCue || "that cue"} affect ${activeMission.toLowerCase()} today?`
    : kickSession
      ? "What felt off when you tried to open your hips: rotation, balance, or the support-foot pivot?"
      : "What happened first when the technique stopped working?";
  const choices = activeMission ? ["It helped", "No clear change", "It made something else break down"] : kickSession ? ["Rotation felt stuck", "I lost balance", "My support foot did not turn"] : ["The entry", "The control", "The finish"];
  return {
    status: "question", summary: note.slice(0, 220), takeaway: activeMission ? "Let’s see whether the experiment changed anything." : "Let’s get one useful detail before deciding what to work on.", coach_detail: coachDetail, fightiq_explanation: "There is not enough evidence yet to name a cause.", next_session_focus: "", confidence: .35, memory: baseMemory, intelligence, question: { prompt, choices, target_field: "clarification", why_asked: "This answer decides whether FightIQ needs another detail or can suggest the next test." },
  };
}

export class DebriefAIError extends Error {
  constructor(public code: string, message: string, public status: number, public development?: Record<string, unknown>) { super(message); }
}
