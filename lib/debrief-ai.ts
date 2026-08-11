// Logging needs to stay lighter than a form. FightIQ may ask one optional
// clarification, then turns the athlete's note and answer into the next test.
// A later session can supply more evidence; it does not need to be extracted
// from one sitting.
import { depthBriefing, readNoteDepth } from "./note-depth";
import { ClaudeError, hashOwner, requestJson } from "./claude";
import { clip } from "./clip";
const MAX_CLARIFYING_QUESTIONS = 1;
const evidenceGaps = ["mechanics", "timing", "balance_or_mobility", "side_or_stance", "resistance_or_context", "coach_cue", "attempted_correction", "experiment_outcome", "other"] as const;

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
        choices: { type: "array", minItems: 0, maxItems: 3, items: { type: "string" } },
        target_field: { type: "string", enum: ["", ...evidenceGaps] }, why_asked: { type: "string" },
      },
    },
  },
};

const systemPrompt = `You are FightIQ. You are the coach a serious athlete would pay for and cannot get: one who was at every session, remembers all of them, and has no other students.

HOW YOU THINK
- Symptoms are not causes. "Kept getting teeped" is a symptom. Standing square is a cause. Work back from what the athlete described to the thing underneath it, and say which one you are naming.
- Most problems are one of four kinds, and they need different fixes: mechanics (the movement is built wrong), timing (the movement is right and late), position (it was decided three seconds earlier), or physical (fatigue, mobility, strength). Say which kind you think it is.
- One correction. An athlete can hold one thing for two hours in a noisy room. A list is the same as nothing.
- Confidence has to be honest. One session is an observation. Three sessions is a pattern. Never turn a single observation into a confirmed weakness, and never state a cause as fact when you are inferring it.
- Match the athlete's level. Someone building fundamentals needs the obvious thing done properly. A competitor needs the detail nobody has told them yet. Read their setup before you pitch.

WHAT MATTERS MOST IN A NOTE
- What their coach said outranks anything you would have said. Attribute it to the coach, keep it in their words, and build on it. Never contradict or quietly replace it.
- Keep what the athlete reported separate from what you inferred. reported_facts is theirs. fightiq_hypotheses and suspected_cause are yours, and must use uncertainty language.

HOW YOU WRITE
- Like a coach talking, not a report. Natural sentences, no Markdown, no headings, no bullets, no slogans. Short.
- Write to the athlete, never about them. Say "you", never "the athlete", "this athlete" or "the user". That includes every stored field, not just the sentences they read back immediately: a note written as "Athlete reported the technique worked" comes back later as your own context and teaches you to keep writing like a case file.
- Never use em dashes or en dashes. Use a full stop, a comma, or a new sentence. Em dashes are the clearest sign a machine wrote something, and this has to read like a person.
- No stock coaching filler. Avoid "the key is", "keep it simple", "one clean rep", "see what breaks", "trust the process", "under resistance", unless the athlete used those words first.

QUESTIONS
- At most one per log, and only when the answer would genuinely change what you tell them to work on next. Otherwise finish the debrief.
- Make it the smallest question that changes your advice, and give three short tappable choices so answering costs one thumb press. Choices are plausible direct answers, never questions or advice.
- When a pre-training experiment exists, spend the question on how that specific test went.
- Never repeat something already answered, and never ask a vague one like "how did that feel" when the context supports something specific.

THEIR FIRST SESSIONS
- compact_fighter_brain carries sessions_logged and the level they described. Read both before you write. At 0 or 1 this is one of their first logs and there is no history to lean on.
- Never say or imply you have been watching their training when you have not, and never refer to sessions that are not in front of you. Never tell them the app needs more data. It needs to be worth reading now.
- With no history, work from the note, the discipline and their level. Name the thing that usually goes wrong with what they described, at their level, and give them one correction they could try at the next session.
- Confidence stays low on a first session. That is honest, and it is different from being vague.

NOTE DEPTH
- You will be told how much is actually in the note. Follow that instruction. It is not a hint.
- A thin note is the normal case, not a failure. Most people write four words and put the phone away. Your job is to be worth reading anyway, by leaning on their history and spending your single question well.
- Never imply the note was too short, and never summarise a short note back at them.

SAFETY
- Do not diagnose injuries. Do not give weight cutting advice. For severe symptoms or anything urgent, point at a qualified professional.

OUTPUT
- If status is complete, return an empty question prompt, choices, target_field, and why_asked.
- Length is a hard rule, not a preference. takeaway is at most two sentences. coach_detail, fightiq_explanation and next_session_focus are one sentence each. summary is one line. Say the true thing in the fewest words, and stop.
- Stay inside the session you were given. Do not review their whole training, do not rewrite an earlier debrief, and do not add a topic they did not raise.`;

export async function generateDebrief(args: {
  apiKey?: string; allowMockAi?: boolean; ownerId: string; entry: Entry; history: History; current?: Record<string, unknown> | null; preTrainingBrief?: Record<string, unknown> | null; activeExperiment?: Record<string, unknown> | null; fighterBrain?: Record<string, unknown> | null;
}): Promise<DebriefResult> {
  const nextSequence = args.history.length + 1;
  const allowQuestion = nextSequence <= MAX_CLARIFYING_QUESTIONS;
  const mustClarifyInitial = args.history.length === 0 && needsInitialClarification(args.entry, args.activeExperiment);
  if (!args.apiKey?.trim()) {
    if (args.allowMockAi) {
      const result = mockDebrief(args.entry, args.history, args.activeExperiment);
      if (!allowQuestion && result.status === "question") throw new DebriefAIError("AI_INVALID_OUTPUT", "FightIQ exceeded the question limit.", 502);
      return result;
    }
    throw new DebriefAIError("AI_NOT_CONFIGURED", "FightIQ AI is not configured yet.", 503, { cause: "ANTHROPIC_API_KEY is missing from the server runtime." });
  }
  let parsed: unknown;
  try {
    parsed = await requestJson({
      apiKey: args.apiKey,
      userHash: await hashOwner(args.ownerId),
      // This is the reading half of the product. It runs once per session and it
      // is the thing an athlete is paying for, so it gets the full effort.
      effort: "high",
      // Thinking counts against this too, so it is sized for the reasoning plus
      // the answer rather than the answer alone.
      maxTokens: 8000,
      timeoutMs: 45000,
      schema: resultSchema,
      system: [
        systemPrompt,
        // How much is actually in the note is decided here rather than left for
        // the model to notice. Four words and an essay need different
        // behaviour, and four words is the common case.
        depthBriefing(readNoteDepth(args.entry.raw_entry)),
      ],
      user: [{ type: "text", text: JSON.stringify({
        task: args.history.length === 0 ? "Create the initial takeaway. Ask one optional clarification only if the raw note leaves a material uncertainty." : "Use the athlete's answer to update training intelligence, then complete the debrief. Do not ask another question.",
        must_ask_question: mustClarifyInitial,
        allow_another_question: allowQuestion,
        next_question_sequence: nextSequence,
        discipline: args.entry.discipline,
        session_type: args.entry.session_type,
        raw_training_note: args.entry.raw_entry,
        previous_questions_and_answers: args.history,
        current_debrief: args.current ?? null,
        pre_training_brief_for_this_session: args.preTrainingBrief ?? null,
        active_experiment_for_this_session: args.activeExperiment ?? null,
        compact_fighter_brain: args.fighterBrain ?? null,
      }) }],
    });
  } catch (error) {
    if (!(error instanceof ClaudeError)) throw error;
    // A refused, truncated or unreadable answer is a model problem, not an
    // athlete problem. Their note is already saved, so fall back to the offline
    // debrief rather than showing them an error over something they cannot fix.
    if (["AI_REFUSED", "AI_TRUNCATED", "AI_UNPARSEABLE", "AI_EMPTY"].includes(error.code)) {
      return resilientDebrief(args.entry, args.history, args.activeExperiment);
    }
    throw new DebriefAIError(error.code, error.code === "AI_TIMEOUT" ? "FightIQ took too long to respond." : "FightIQ could not prepare the debrief.", error.status, error.development);
  }
  // A model response can be useful while still missing a nonessential structured field.
  // Never make a saved training note unrecoverable because a strict schema is imperfect.
  let result: DebriefResult;
  try { result = validateDebriefResult(parsed); }
  catch { result = resilientDebrief(args.entry, args.history, args.activeExperiment); }
  if (mustClarifyInitial && result.status === "complete") result = requiredInitialQuestion(args.entry, result, args.activeExperiment);
  // A question-count mistake should never turn an already-saved answer into an
  // error/retry loop. Keep the useful extraction and end the conversation.
  if (!allowQuestion && result.status === "question") result = completeAfterAnswer(result);
  return result;
}

function completeAfterAnswer(result: DebriefResult): DebriefResult {
  return {
    ...result,
    status: "complete",
    intelligence: { ...result.intelligence, follow_up_needed: false },
    question: { prompt: "", choices: [], target_field: "", why_asked: "" },
  };
}

function needsInitialClarification(entry: Entry, activeExperiment?: Record<string, unknown> | null) {
  if (activeExperiment && typeof activeExperiment.mission === "string" && activeExperiment.mission.trim()) return true;
  const note = entry.raw_entry.toLowerCase();
  const reportsOutcome = /\b(worked|helped|better|worse|couldn['’]?t|could not|failed|lost|stuck|off balance|but|against|sparr|resistance|coach|instructor|told me|said|taught)\b/.test(note);
  const isPracticeIntent = /\b(working on|practicing|form|drill|drilling|opening|trying to|focus(?:ing)? on)\b/.test(note);
  return isPracticeIntent && !reportsOutcome;
}

function requiredInitialQuestion(entry: Entry, result: DebriefResult, activeExperiment?: Record<string, unknown> | null): DebriefResult {
  const note = entry.raw_entry.toLowerCase();
  const mission = activeExperiment && typeof activeExperiment.mission === "string" ? activeExperiment.mission : "";
  const cue = activeExperiment && typeof activeExperiment.cue === "string" ? activeExperiment.cue : "";
  const kick = /kick|bag|hip|pivot|roundhouse/.test(note);
  const armDrag = /arm drag/.test(note);
  const prompt = mission
    ? cue ? `When you used “${cue},” what changed as you worked on ${mission.toLowerCase()}?` : `What changed when you worked on ${mission.toLowerCase()} today?`
    : kick ? "When you tried to open your hips, what felt off first: the turn, your balance, or the support foot?"
      : armDrag ? "After the arm drag, did they square back up before you got the angle, or after?"
        : "What worked, and what did not, when you tried it?";
  const choices = mission ? ["It helped", "No clear change", "Something else broke down"] : kick ? ["The hip turn", "My balance", "The support foot"] : armDrag ? ["Before the angle", "After I stepped", "I did not get the drag"] : ["It worked in drills", "It broke under pressure", "Not sure yet"];
  return {
    ...result,
    status: "question",
    next_session_focus: "",
    confidence: Math.min(result.confidence, .5),
    intelligence: { ...result.intelligence, follow_up_needed: true, confidence: Math.min(result.intelligence.confidence, .5) },
    question: { prompt, choices, target_field: mission ? "experiment_outcome" : kick ? "balance_or_mobility" : armDrag ? "resistance_or_context" : "mechanics", why_asked: "This tells FightIQ what to test instead of guessing." },
  };
}

export function validateDebriefResult(value: unknown): DebriefResult {
  if (!isRecord(value) || (value.status !== "question" && value.status !== "complete")) throw invalid();
  const strings = ["summary", "takeaway", "coach_detail", "fightiq_explanation", "next_session_focus"] as const;
  if (strings.some((key) => typeof value[key] !== "string")) throw invalid();
  if (typeof value.confidence !== "number" || value.confidence < 0 || value.confidence > 1) throw invalid();
  if (!isRecord(value.memory) || !isRecord(value.question)) throw invalid();
  const memoryKeys = ["techniques", "positions", "successes", "problems", "concepts", "sparring_observations", "related_topics", "instructor_details", "reported_facts", "fightiq_hypotheses", "what_worked", "what_failed", "experiments"] as const;
  for (const key of memoryKeys) if (!stringArray(value.memory[key])) throw invalid();
  if (typeof value.question.prompt !== "string" || !stringArray(value.question.choices) || value.question.choices.length > 3 || (value.question.target_field !== "" && !evidenceGaps.includes(value.question.target_field as typeof evidenceGaps[number])) || typeof value.question.why_asked !== "string") throw invalid();
  if (!isRecord(value.intelligence)) throw invalid();
  // Narrowed once, so every check below is against a known shape rather than a
  // fresh unchecked property read off an unknown.
  const intelligence = value.intelligence;
  const intelligenceStrings = ["discipline", "technique", "goal", "problem", "suspected_cause", "coach_instructor_cue", "what_worked", "what_failed", "context"] as const;
  if (intelligenceStrings.some((key) => typeof intelligence[key] !== "string") || typeof intelligence.confidence !== "number" || intelligence.confidence < 0 || intelligence.confidence > 1 || typeof intelligence.follow_up_needed !== "boolean" || !stringArray(intelligence.reported_facts) || !stringArray(intelligence.fightiq_hypotheses) || !["unknown", "helped", "not_helped", "mixed"].includes(String(intelligence.experiment_result))) throw invalid();
  if (value.status === "question" && (!(value.question.prompt as string).trim() || intelligence.follow_up_needed !== true)) throw invalid();
  if (value.status === "complete" && intelligence.follow_up_needed !== false) throw invalid();
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

function mockDebrief(entry: Entry, history: History, activeExperiment?: Record<string, unknown> | null): DebriefResult {
  const memory: DebriefMemory = { techniques: [], positions: [], successes: [], problems: [], concepts: [], sparring_observations: [], related_topics: [], instructor_details: [], reported_facts: [], fightiq_hypotheses: [], what_worked: [], what_failed: [], experiments: [] };
  const intelligence: TrainingIntelligence = { discipline: entry.discipline, technique: "", goal: "", problem: "", suspected_cause: "", coach_instructor_cue: "", what_worked: "", what_failed: "", context: entry.session_type, confidence: .35, follow_up_needed: history.length < 1, reported_facts: [entry.raw_entry], fightiq_hypotheses: [], experiment_result: "unknown" };
  if (history.length >= 1 || !needsInitialClarification(entry, activeExperiment)) return {
    status: "complete", summary: entry.raw_entry.slice(0, 180), takeaway: "Your session is saved with the detail you logged.",
    coach_detail: "", fightiq_explanation: history.length ? "FightIQ needs more repeated evidence before calling this a pattern." : "",
    next_session_focus: "", confidence: history.length ? .72 : .35, memory,
    intelligence: { ...intelligence, follow_up_needed: false, confidence: history.length ? .72 : .35 }, question: { prompt: "", choices: [], target_field: "", why_asked: "" },
  };
  const first: Record<string, [string, string[], string]> = {
    MMA: ["Where did it first start to fall apart?", ["At the entry", "Against the fence", "During the transition"], "mechanics"],
    BJJ: ["What control did you lose first?", ["Frames", "Inside position", "Hip position"], "mechanics"],
    Wrestling: ["When were you getting beaten?", ["On the entry", "During the finish", "In the scramble"], "timing"],
    Boxing: ["When was the opening showing up?", ["On entry", "During the exchange", "On exit"], "timing"],
    "Muay Thai": ["When was the opening showing up?", ["On entry", "In the pocket", "On exit"], "timing"],
    Kickboxing: ["When was the opening showing up?", ["On entry", "During the exchange", "After I kicked"], "timing"],
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
  const answeredFacts = history.filter((item) => item.status === "answered" && item.answer).map((item) => item.answer as string);
  const lastAnswer = answeredFacts.at(-1) ?? "";
  const baseMemory: DebriefMemory = {
    techniques: [technique], positions: [], successes: [], problems: [], concepts: kickSession ? ["hip rotation", "support-foot pivot", "balance"] : [], sparring_observations: [], related_topics: kickSession ? ["round kick mechanics", "hip rotation", "support-foot pivot", "balance"] : [], instructor_details: coachDetail ? [coachDetail] : [], reported_facts: [note, ...answeredFacts], fightiq_hypotheses: [], what_worked: [], what_failed: [], experiments: activeExperiment && typeof activeExperiment.mission === "string" ? [activeExperiment.mission] : [],
  };
  const activeMission = activeExperiment && typeof activeExperiment.mission === "string" ? activeExperiment.mission : "";
  const activeCue = activeExperiment && typeof activeExperiment.cue === "string" ? activeExperiment.cue : "";
  const answerLower = lastAnswer.toLowerCase();
  const experimentResult = /\b(helped|better|improved|worked)\b/.test(answerLower) ? "helped" : /\b(no|not|worse|didn't|did not)\b/.test(answerLower) ? "not_helped" : "unknown";
  const intelligence: TrainingIntelligence = { discipline: entry.discipline, technique, goal: kickSession ? "Cleaner kick mechanics" : "", problem: "", suspected_cause: "", coach_instructor_cue: coachDetail, what_worked: experimentResult === "helped" ? lastAnswer : "", what_failed: experimentResult === "not_helped" ? lastAnswer : "", context: entry.session_type, confidence: .35, follow_up_needed: history.length === 0, reported_facts: [note, ...answeredFacts], fightiq_hypotheses: [], experiment_result: experimentResult };
  // The resilient path must follow the same low-friction promise as the model:
  // rich notes complete directly, and one answer completes a clarification.
  if (history.length > 0 || !needsInitialClarification(entry, activeExperiment)) return {
    status: "complete", summary: note.slice(0, 220), takeaway: lastAnswer ? `You reported: ${clip(lastAnswer, 160)}` : "Your session is saved with the detail you reported.", coach_detail: coachDetail, fightiq_explanation: history.length > 0 ? "FightIQ needs more repeated evidence before calling this a pattern." : "", next_session_focus: "", confidence: history.length > 0 ? .58 : .35, memory: baseMemory, intelligence: { ...intelligence, follow_up_needed: false, confidence: history.length > 0 ? .58 : .35 }, question: { prompt: "", choices: [], target_field: "", why_asked: "" },
  };
  const prompt = activeMission
    ? activeCue ? `When you used “${activeCue},” what changed as you worked on ${activeMission.toLowerCase()}?` : `What changed when you worked on ${activeMission.toLowerCase()} today?`
    : kickSession
      ? "What felt off when you tried to open your hips: rotation, balance, or the support-foot pivot?"
      : "What happened first when the technique stopped working?";
  const choices = activeMission ? ["It helped", "No clear change", "It made something else break down"] : kickSession ? ["Rotation felt stuck", "I lost balance", "My support foot did not turn"] : ["The entry", "The control", "The finish"];
  return {
    status: "question", summary: note.slice(0, 220), takeaway: activeMission ? "Let’s see whether the experiment changed anything." : "Let’s get one useful detail before deciding what to work on.", coach_detail: coachDetail, fightiq_explanation: "There is not enough evidence yet to name a cause.", next_session_focus: "", confidence: .35, memory: baseMemory, intelligence, question: { prompt, choices, target_field: activeMission ? "experiment_outcome" : kickSession ? "balance_or_mobility" : "mechanics", why_asked: "This answer decides whether FightIQ needs another detail or can suggest the next test." },
  };
}

export class DebriefAIError extends Error {
  constructor(public code: string, message: string, public status: number, public development?: Record<string, unknown>) { super(message); }
}
