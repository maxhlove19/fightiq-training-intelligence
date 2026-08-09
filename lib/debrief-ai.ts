const MAX_QUESTIONS = 1;

export type DebriefMemory = {
  techniques: string[]; positions: string[]; successes: string[]; problems: string[];
  concepts: string[]; sparring_observations: string[]; related_topics: string[]; instructor_details: string[];
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
  question: { prompt: string; choices: string[]; target_field: string; why_asked: string };
};

type Entry = { discipline: string; session_type: string; raw_entry: string };
type History = Array<{ sequence: number; question: string; answer: string | null; answer_source: string | null; status: string; target_field: string }>;

const resultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "summary", "takeaway", "coach_detail", "fightiq_explanation", "next_session_focus", "confidence", "memory", "question"],
  properties: {
    status: { type: "string", enum: ["question", "complete"] },
    summary: { type: "string" }, takeaway: { type: "string" }, coach_detail: { type: "string" },
    fightiq_explanation: { type: "string" }, next_session_focus: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    memory: {
      type: "object", additionalProperties: false,
      required: ["techniques", "positions", "successes", "problems", "concepts", "sparring_observations", "related_topics", "instructor_details"],
      properties: Object.fromEntries(["techniques", "positions", "successes", "problems", "concepts", "sparring_observations", "related_topics", "instructor_details"].map((key) => [key, { type: "array", items: { type: "string" } }])),
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

const systemPrompt = `You are FightIQ, a warm, observant MMA training intelligence coach. Analyze one athlete's training note and ask only one high-value follow-up question.

Rules:
- Preserve the athlete's raw account. Never invent facts. Treat anything the athlete says a coach/instructor taught as high-value instructor_detail memory, quoted or closely paraphrased, never as your own instruction.
- Keep reported coach details separate from FightIQ explanations. coach_detail contains only the athlete's report of what their coach said. fightiq_explanation must use uncertainty language when causal reasoning is not certain.
- Speak like a concise human coach: natural sentences, no Markdown, no headings, no bullets, no report language. Keep each field short.
- Ask one short question at a time. Prefer concrete answer choices that fit the exact session. Do not repeat facts already stated. When a pre-training brief exists, ask how its mission went rather than asking a generic question.
- Prioritize the first technical breakdown, live-training context, attempted correction, coach detail, or next-session intent.
- Ask exactly one high-value follow-up question, then complete the debrief using that answer. Never ask a second question.
- Questions are optional. Do not diagnose injuries or give dangerous weight-cut advice.
- If status is complete, return an empty question prompt, choices, target_field, and why_asked.
- Keep the takeaway and next-session focus concise and directly useful.`;

export async function generateDebrief(args: {
  apiKey?: string; allowMockAi?: boolean; ownerId: string; entry: Entry; history: History; current?: Record<string, unknown> | null; preTrainingBrief?: Record<string, unknown> | null;
}): Promise<DebriefResult> {
  const nextSequence = args.history.length + 1;
  const allowQuestion = nextSequence <= MAX_QUESTIONS;
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
            task: args.history.length === 0 ? "Create the initial takeaway and first question." : "Update the session from the answers and either ask the next useful question or complete the debrief.",
            must_ask_question: args.history.length === 0,
            allow_another_question: allowQuestion,
            next_question_sequence: nextSequence,
            discipline: args.entry.discipline,
            session_type: args.entry.session_type,
            raw_training_note: args.entry.raw_entry,
            previous_questions_and_answers: args.history,
            current_debrief: args.current ?? null,
            pre_training_brief_for_this_session: args.preTrainingBrief ?? null,
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
  try { parsed = JSON.parse(text); } catch { throw new DebriefAIError("AI_INVALID_OUTPUT", "FightIQ returned an invalid debrief.", 502); }
  const result = validateDebriefResult(parsed);
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
  const memoryKeys = ["techniques", "positions", "successes", "problems", "concepts", "sparring_observations", "related_topics", "instructor_details"] as const;
  for (const key of memoryKeys) if (!stringArray(value.memory[key])) throw invalid();
  if (typeof value.question.prompt !== "string" || !stringArray(value.question.choices) || value.question.choices.length > 4 || typeof value.question.target_field !== "string" || typeof value.question.why_asked !== "string") throw invalid();
  if (value.status === "question" && (!value.question.prompt.trim() || value.question.choices.length < 2)) throw invalid();
  const result = value as DebriefResult;
  const clean = (text: string) => text.replace(/\*\*(.*?)\*\*/g, "$1").replace(/__(.*?)__/g, "$1").replace(/^\s{0,3}#{1,6}\s*/gm, "").replace(/^\s*[-*]\s+/gm, "").trim();
  result.summary = clean(result.summary); result.takeaway = clean(result.takeaway); result.coach_detail = clean(result.coach_detail);
  result.fightiq_explanation = clean(result.fightiq_explanation); result.next_session_focus = clean(result.next_session_focus);
  result.question.prompt = clean(result.question.prompt); result.question.choices = result.question.choices.map(clean);
  result.memory.instructor_details = result.memory.instructor_details.map(clean);
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
  const memory: DebriefMemory = { techniques: [], positions: [], successes: [], problems: [], concepts: [], sparring_observations: [], related_topics: [], instructor_details: [] };
  if (history.length >= 1) return {
    status: "complete", summary: entry.raw_entry.slice(0, 180), takeaway: "You understood the session detail, and the next step is making it reliable against live resistance.",
    coach_detail: "", fightiq_explanation: "One likely reason is that the sequence is breaking down before you can apply the detail consistently.",
    next_session_focus: "Identify the first breakdown and test one correction during live rounds.", confidence: .82, memory,
    question: { prompt: "", choices: [], target_field: "", why_asked: "" },
  };
  const first: Record<string, [string, string[], string]> = {
    MMA: ["Where was the first breakdown happening?", ["At the entry", "Against the fence", "During the transition", "After I defended"], "first_breakdown"],
    BJJ: ["What control did you lose first?", ["Frames", "Inside position", "Hip position", "Grip control"], "first_control_lost"],
    Wrestling: ["When were you getting beaten?", ["On the entry", "During the finish", "After my first defense", "In the scramble"], "breakdown_phase"],
    Boxing: ["When was the opening showing up?", ["On entry", "During the exchange", "On exit", "After I attacked"], "striking_phase"],
    "Muay Thai": ["When was the opening showing up?", ["On entry", "In the pocket", "On exit", "In the clinch"], "striking_phase"],
    Kickboxing: ["When was the opening showing up?", ["On entry", "During the exchange", "On exit", "After I kicked"], "striking_phase"],
  };
  const prompt = first[entry.discipline] ?? first.MMA;
  return { status: "question", summary: entry.raw_entry.slice(0, 180), takeaway: "There’s a useful gap between understanding the detail and applying it under live pressure.", coach_detail: "", fightiq_explanation: "This may help because finding the first breakdown makes the next correction more specific.", next_session_focus: "", confidence: history.length ? .68 : .48, memory, question: { prompt: prompt[0] as string, choices: prompt[1] as string[], target_field: prompt[2] as string, why_asked: "This answer can identify the most useful next-session focus." } };
}

export class DebriefAIError extends Error {
  constructor(public code: string, message: string, public status: number, public development?: Record<string, unknown>) { super(message); }
}
