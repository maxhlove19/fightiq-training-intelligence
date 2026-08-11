import { env } from "cloudflare:workers";
import { currentOwnerId } from "./current-athlete";
import { applySchema, type D1 } from "./debrief-db";
import { sessionCue as briefCue, startingFocus } from "./session-cue";
import { openingBrief, openingFromMemory } from "./first-session";
import { clip, clipLabel, sentence } from "./clip";
import { recordFocus, type FocusSource } from "./focus-history";
import { isUsableWeight, recordWeighIn } from "./weight-history";

/**
 * What a day-one brief records itself as built from.
 *
 * Keyed to "no training yet" rather than to the starting focus it happened to
 * sit alongside. The moment a first session lands this stops matching and the
 * brief is rebuilt from real training, instead of an athlete being told about
 * their first night for another eighteen hours.
 */
const FIRST_SESSION_SOURCE = "first-session";

export type FighterProfile = {
  owner_id: string;
  onboarding_completed_at: string | null;
  athlete_setup_json: string;
  current_focus: string | null;
  focus_reason: string | null;
  primary_goal: string;
  style_influences_json: string;
  calorie_target: number;
  protein_target: number;
  carb_target: number;
  fat_target: number;
};

export type AthleteSetup = {
  disciplines: string[];
  experienceLevel: string;
  sessionsPerWeek: number;
  sessionTypes: string[];
  competitionIntent: string;
  age: number | null;
  calculatorSex: "female" | "male" | "manual" | null;
  heightCm: number | null;
  weightKg: number | null;
  dietaryRestrictions: string[];
  foodPreferences: string;
  foodsToAvoid: string;
  mealsPerDay: number | null;
  trainingTime: string;
};

export const emptyAthleteSetup: AthleteSetup = {
  disciplines: [], experienceLevel: "", sessionsPerWeek: 0, sessionTypes: [], competitionIntent: "",
  age: null, calculatorSex: null, heightCm: null, weightKg: null, dietaryRestrictions: [],
  foodPreferences: "", foodsToAvoid: "", mealsPerDay: null, trainingTime: "",
};

export type MemorySnapshot = {
  /** What the athlete trains, logged sessions first and anything they named at setup after. */
  disciplines: string[];
  /**
   * Every discipline with a logged session, most trained first.
   *
   * Evidence rather than intent, and kept separate from `disciplines` because
   * "he has actually trained BJJ seven times" is a different claim from "he once
   * ticked BJJ on a form", and Coach should be able to tell them apart.
   */
  trains: Array<{ name: string; sessions: number }>;
  /** Their own words for where they are. A beginner and a competitor need different answers to the same question. */
  experienceLevel: string;
  /** Whether a fight is coming. It changes what is worth working on. */
  competitionIntent: string;
  /**
   * Sessions in here, counted up to forty.
   *
   * Zero and one are the numbers that matter: they are the moment somebody
   * decides whether this app is worth keeping, and the moment it has the least
   * to work with. Everything above three reads the same.
   */
  sessionsLogged: number;
  currentFocus: string;
  /** What the athlete typed themselves, if anything. Distinct from the focus FightIQ derived. */
  statedFocus: string | null;
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
export type TrainingExperiment = { id: string; mission: string; cue: string; reason: string; status: string; startedAt: string | null; outcome: string | null };

export async function getProductOwnerId() {
  // Email sign in and ChatGPT sign in both land here. See lib/identity.ts.
  return (await currentOwnerId()) ?? (process.env.NODE_ENV !== "production" ? "preview-user" : null);
}

export function getProductRuntime() {
  const runtime = env as unknown as { DB?: D1; UPLOADS?: R2Bucket; ANTHROPIC_API_KEY?: string; YOUTUBE_API_KEY?: string; FIGHTIQ_ALLOW_MOCK_AI?: string; FIGHTIQ_OWNER_EMAILS?: string; SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string; SUPABASE_JWT_SECRET?: string };
  return {
    db: runtime.DB, uploads: runtime.UPLOADS, apiKey: runtime.ANTHROPIC_API_KEY, youtubeApiKey: runtime.YOUTUBE_API_KEY,
    allowMockAi: runtime.FIGHTIQ_ALLOW_MOCK_AI === "true", ownerEmails: runtime.FIGHTIQ_OWNER_EMAILS,
    supabaseUrl: runtime.SUPABASE_URL, supabaseAnonKey: runtime.SUPABASE_ANON_KEY, supabaseJwtSecret: runtime.SUPABASE_JWT_SECRET,
  };
}

export async function ensureProductSchema(db: D1) {
  // One list owns the schema. Every entry point applies all of it, so no route
  // can be the only reason a table exists.
  await applySchema(db);
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

export function getAthleteSetup(profile: FighterProfile): AthleteSetup {
  try {
    const parsed = JSON.parse(profile.athlete_setup_json || "{}") as Partial<AthleteSetup>;
    return {
      disciplines: Array.isArray(parsed.disciplines) ? parsed.disciplines.filter((item): item is string => typeof item === "string").slice(0, 8) : [],
      experienceLevel: typeof parsed.experienceLevel === "string" ? parsed.experienceLevel : "",
      sessionsPerWeek: typeof parsed.sessionsPerWeek === "number" ? parsed.sessionsPerWeek : 0,
      sessionTypes: Array.isArray(parsed.sessionTypes) ? parsed.sessionTypes.filter((item): item is string => typeof item === "string").slice(0, 6) : [],
      competitionIntent: typeof parsed.competitionIntent === "string" ? parsed.competitionIntent : "",
      age: typeof parsed.age === "number" ? parsed.age : null,
      calculatorSex: parsed.calculatorSex === "female" || parsed.calculatorSex === "male" || parsed.calculatorSex === "manual" ? parsed.calculatorSex : null,
      heightCm: typeof parsed.heightCm === "number" ? parsed.heightCm : null,
      weightKg: typeof parsed.weightKg === "number" ? parsed.weightKg : null,
      dietaryRestrictions: Array.isArray(parsed.dietaryRestrictions) ? parsed.dietaryRestrictions.filter((item): item is string => typeof item === "string").slice(0, 8) : [],
      foodPreferences: typeof parsed.foodPreferences === "string" ? parsed.foodPreferences : "",
      foodsToAvoid: typeof parsed.foodsToAvoid === "string" ? parsed.foodsToAvoid : "",
      mealsPerDay: typeof parsed.mealsPerDay === "number" ? parsed.mealsPerDay : null,
      trainingTime: typeof parsed.trainingTime === "string" ? parsed.trainingTime : "",
    };
  } catch { return { ...emptyAthleteSetup }; }
}

// Short labels read better in title case: "Support Foot", "Arm Drag". A whole
// sentence does not — "Your Session Is Saved With The Detail You Logged" looks
// like a machine wrote it, because a machine did.
function titleCase(value: string) {
  const clean = value.replace(/[_-]+/g, " ").trim();
  const isSentence = clean.split(/\s+/).length > 4 || /[.!?]$/.test(clean);
  if (isSentence) return clean.charAt(0).toUpperCase() + clean.slice(1);
  return clean.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function topValues(values: string[], limit: number) {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = raw.trim();
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([value]) => titleCase(value));
}

/**
 * What the athlete actually trains, counted from what they logged.
 *
 * Onboarding used to be the only source, so an athlete who skipped that step
 * carried `disciplines: []` in the Fighter Brain with eleven sessions on the
 * board, and Coach reasoned about him without knowing he was mainly a grappler.
 * A form records an intention once. A log records what happened every time, so
 * the log leads and onboarding fills the gaps.
 *
 * Ordered by how often each one appears, because "mainly a grappler" is the part
 * that should change an answer.
 */
export function disciplinesFromSessions(rows: Array<{ discipline?: string | null }>) {
  const counts = new Map<string, { label: string; count: number }>();
  for (const row of rows) {
    const label = (row.discipline ?? "").replace(/\s+/g, " ").trim();
    if (!label) continue;
    const key = label.toLowerCase();
    const entry = counts.get(key) ?? { label: titleCase(label), count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .map((item) => ({ name: item.label, sessions: item.count }));
}

/** Logged disciplines lead. Anything named at setup but never trained still counts. */
export function mergeDisciplines(stated: string[], logged: Array<{ name: string }>) {
  const seen = new Set(logged.map((item) => item.name.toLowerCase()));
  return [...logged.map((item) => item.name), ...stated.filter((item) => item.trim() && !seen.has(item.trim().toLowerCase()))].slice(0, 8);
}

/**
 * An observation has to say something happened or changed.
 *
 * Without a bar, "Arm Drag" and "Did Ankle Locks" were being stored as
 * observations. The first is a technique name and the second is the athlete's
 * own note read back to him, and neither is something a retrospective can be
 * built on. Three months of that and the history is rubbish, which is the
 * expensive kind of wrong because it cannot be reconstructed later.
 *
 * Deliberately permissive about what counts and strict about what obviously does
 * not. Throwing away real signal to keep the list tidy would be the worse error.
 */
const RESTATED_NOTE = /^(did|drilled|trained|practi[cs]ed|worked on|learn[et]d?|tried|studied|reviewed)\b/i;
const HAPPENED_OR_CHANGED = /\b(was|were|is|are|felt|feels|kept|keeps|stopped|stops|started|starts|worked|works|failed|fails|broke|breaks|lost|loses|held|holds|got|gets|came|comes|went|goes|improved|improves|struggled|struggles|noticed|notices|landed|lands|missed|misses|able|unable|after|before|when|under|because|until|instead|still|again)\b/i;

export function isObservation(value: string) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.split(" ").length < 4) return false;
  if (RESTATED_NOTE.test(clean)) return false;
  return HAPPENED_OR_CHANGED.test(clean);
}

/**
 * A label written for a chip, put back into a sentence.
 *
 * Technique names are stored title cased because that is how they read on a
 * button. Dropped into prose they have to come back down, or the sentence looks
 * like it was assembled rather than written. Names that are actually somebody's
 * name keep their capital.
 */
const PROPER_TECHNIQUE = /^(kimura|ezekiel|americana|peruvian|marcelotine|darce|d'arce|estima|gogoplata|omoplata|berimbolo|granby|turkish|russian|greco|thai|brazilian|japanese|imanari)\b/i;

function inSentence(label: string) {
  return PROPER_TECHNIQUE.test(label.trim()) ? label.trim() : label.trim().toLowerCase();
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

/**
 * A short label for a chip or a suggestion. Terminal punctuation goes, because
 * "Arm drags." reads wrong on a button.
 *
 * The ceiling used to be a hard 72-character slice with no ellipsis and no word
 * boundary, which is what cut a mission mid-word inside "consistent".
 */
function shortTopic(value: string, fallback: string, limit = 96) {
  return clipLabel(value.trim() || fallback, limit);
}

function compactTopic(value: string, fallback: string) {
  const words = shortTopic(value, fallback).split(/\s+/);
  return words.length > 8 ? `${words.slice(0, 8).join(" ")}…` : words.join(" ");
}

type BrainEvidence = {
  owner_id: string;
  entry_id: string;
  category: string;
  canonical_key: string;
  label: string;
  source: string;
  confidence: number;
  observed_at: string;
};

type StructuredMemory = Record<string, unknown> & { intelligence?: Record<string, unknown> };

function safeStructuredMemory(value: string | null | undefined): StructuredMemory | null {
  try {
    const parsed = JSON.parse(value ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as StructuredMemory : null;
  } catch { return null; }
}

function stringsFrom(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 1).map((item) => item.replace(/\s+/g, " ").trim()).slice(0, 8)
    : [];
}

function claimLabel(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 240) : "";
}

// Canonical keys deliberately cover common ways athletes describe the same
// learning problem without pretending every phrase means the same thing.
function canonicalClaimKey(discipline: string, category: string, label: string, technique = "") {
  const lower = `${technique} ${label}`.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const disciplineKey = trainingDomain(discipline) || normalizeInsight(discipline).split(" ")[0] || "mma";
  const aliases: Array<[RegExp, string]> = [
    [/arm drag/, "arm-drag"],
    [/(support foot|pivot)/, "support-foot-pivot"],
    [/(hip turn|turning.*hip|hip rotation|open.*hip)/, "hip-rotation"],
    [/(round kick|roundhouse)/, "round-kick"],
    [/(square back|squaring)/, "opponent-squares"],
    [/(take.*back|back take)/, "back-take"],
    [/(head position|head drops?)/, "head-position"],
    [/(double leg|double-leg)/, "double-leg"],
    [/(single leg|single-leg)/, "single-leg"],
    [/(balance|off balance)/, "balance"],
    [/(timing|late|early)/, "timing"],
    [/(frame|framing)/, "frames"],
  ];
  const subject = aliases.find(([pattern]) => pattern.test(lower))?.[1] ?? (normalizeInsight(technique || label).split(" ").slice(0, 7).join(" ") || "session-detail");
  return `${disciplineKey}:${category}:${subject}`;
}

type EvidenceInput = { category: "observation" | "problem" | "strength" | "improvement" | "instructor_cue"; label: string; source: "athlete" | "coach" };

function evidenceInputs(memory: StructuredMemory) {
  const intelligence = memory.intelligence && typeof memory.intelligence === "object" && !Array.isArray(memory.intelligence) ? memory.intelligence : {};
  const collect = (category: EvidenceInput["category"], source: EvidenceInput["source"], ...values: unknown[]): EvidenceInput[] => values.flatMap((value) => {
    const candidates = Array.isArray(value) ? stringsFrom(value) : [claimLabel(value)].filter(Boolean);
    return candidates.map((label) => ({ category, label, source }));
  });
  return [
    ...collect("observation", "athlete", memory.techniques, intelligence.technique),
    ...collect("observation", "athlete", memory.reported_facts, intelligence.reported_facts),
    ...collect("problem", "athlete", memory.problems, memory.what_failed, intelligence.problem, intelligence.what_failed),
    ...collect("strength", "athlete", memory.successes),
    ...collect("improvement", "athlete", memory.what_worked, intelligence.what_worked),
    ...collect("instructor_cue", "coach", memory.instructor_details, intelligence.coach_instructor_cue),
  ].filter((item) => item.label.length > 1);
}

/**
 * Build evidence writes separately so callers can include them in the same D1
 * batch as the completed debrief. That keeps a completed conversation from
 * becoming visible before its durable Fighter Brain evidence is written.
 */
export function fighterBrainEvidenceStatements(
  db: D1,
  ownerId: string,
  entry: { id: string; discipline: string; created_at: string },
  structuredMemoryJson: string | null | undefined,
  confidence: number,
) {
  const memory = safeStructuredMemory(structuredMemoryJson);
  if (!memory) return [];
  const technique = claimLabel(memory.intelligence && typeof memory.intelligence === "object" && !Array.isArray(memory.intelligence) ? memory.intelligence.technique : "") || stringsFrom(memory.techniques)[0] || "";
  const unique = new Map<string, EvidenceInput>();
  for (const input of evidenceInputs(memory)) {
    // Raw session-wide notes are still retained in training_entries. Avoid turning
    // a whole paragraph into one fuzzy Fighter Brain observation.
    if (input.category === "observation" && input.label.length > 180) continue;
    const key = canonicalClaimKey(entry.discipline, input.category, input.label, technique);
    if (!unique.has(`${input.category}:${key}`)) unique.set(`${input.category}:${key}`, input);
  }
  const now = new Date().toISOString();
  const boundedConfidence = Math.max(0.15, Math.min(1, Number.isFinite(confidence) ? confidence : 0.35));
  return [...unique.values()].map((input) => {
    const key = canonicalClaimKey(entry.discipline, input.category, input.label, technique);
    return db.prepare(`INSERT INTO fighter_brain_evidence (
      id, owner_id, entry_id, category, canonical_key, label, source, confidence, observed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_id, entry_id, category, canonical_key) DO UPDATE SET
      label = excluded.label, source = excluded.source, confidence = MAX(fighter_brain_evidence.confidence, excluded.confidence)`)
      .bind(crypto.randomUUID(), ownerId, entry.id, input.category, key, input.label, input.source, boundedConfidence, entry.created_at, now);
  });
}

/** Persist reported training evidence without treating FightIQ hypotheses as facts. */
export async function persistFighterBrainEvidence(
  db: D1,
  ownerId: string,
  entry: { id: string; discipline: string; created_at: string },
  structuredMemoryJson: string | null | undefined,
  confidence: number,
) {
  const statements = fighterBrainEvidenceStatements(db, ownerId, entry, structuredMemoryJson, confidence);
  if (statements.length) await db.batch(statements);
}

type EvidenceGroup = { label: string; count: number; latest: string };

function groupedEvidence(rows: BrainEvidence[], category: string) {
  const groups = new Map<string, { label: string; entries: Set<string>; latest: string }>();
  for (const row of rows.filter((item) => item.category === category)) {
    const existing = groups.get(row.canonical_key);
    if (!existing) groups.set(row.canonical_key, { label: row.label, entries: new Set([row.entry_id]), latest: row.observed_at });
    else {
      existing.entries.add(row.entry_id);
      if (row.observed_at > existing.latest) { existing.label = row.label; existing.latest = row.observed_at; }
    }
  }
  return [...groups.values()]
    .map((group) => ({ label: group.label, count: group.entries.size, latest: group.latest }))
    .sort((a, b) => b.count - a.count || b.latest.localeCompare(a.latest));
}

function evidenceLabels(groups: EvidenceGroup[], predicate: (group: EvidenceGroup) => boolean, used: string[], limit: number) {
  return takeDistinct(groups.filter(predicate).map((group) => group.label), used, limit);
}

export function getCoachSuggestions(
  memory: MemorySnapshot,
  experiment?: { mission: string; cue: string } | null,
  conversation?: { followUp?: string; videoTopic?: string } | null,
) {
  const focus = compactTopic(memory.currentFocus, "your current focus");
  const confirmedProblem = memory.recurringProblems.find((item) => !item.toLowerCase().includes("no recurring"));
  const strength = memory.strongestAreas.find((item) => !item.toLowerCase().includes("still learning"));
  const latestDiscipline = memory.recentTraining[0]?.discipline;
  const instructor = memory.instructorDetails[0];
  const latestNote = memory.recentTraining[0]?.note.toLowerCase() ?? "";
  const armDrag = latestNote.includes("arm drag") || memory.currentFocus.toLowerCase().includes("arm drag");
  const kickIssue = /kick|hip|pivot|bag/.test(`${latestNote} ${memory.currentFocus.toLowerCase()}`);
  const candidates = conversation?.followUp ? [
    conversation.videoTopic ? `How should I drill ${compactTopic(conversation.videoTopic, "that")} next class?` : "What should I test next session?",
    conversation.videoTopic ? `What should I watch for in a ${compactTopic(conversation.videoTopic, "technique")} video?` : "What should I notice once I have that answer?",
    instructor ? "How does my coach’s detail fit into that?" : `What would make this useful in ${latestDiscipline ?? "training"}?`,
  ] : [
    kickIssue ? "What should I watch for in my support-foot pivot?" : experiment ? `What should I notice while I test “${compactTopic(experiment.mission, "this experiment")}”?` : instructor ? `Why does that coach detail work better?` : `How should I test “${focus}” next session?`,
    kickIssue ? "How can I tell timing from a balance problem?" : armDrag ? "How do I stop them squaring after the arm drag?" : confirmedProblem ? `Why does ${shortTopic(confirmedProblem, "this problem")} keep breaking down?` : `What pattern should I watch for in my next live round?`,
    kickIssue ? "Who should I study for clean round-kick mechanics?" : strength ? `How can I build offence from ${shortTopic(strength, "my strongest area")}?` : latestDiscipline ? `What should I notice earlier in ${latestDiscipline} rounds?` : `What should I review after my next session?`,
  ];
  const unique: string[] = [];
  for (const candidate of candidates) if (isDistinct(candidate, unique)) unique.push(candidate);
  const fallbacks = ["What is the smallest correction I can test next?", "What should I ask my coach to watch for?"];
  for (const fallback of fallbacks) if (unique.length < 3 && isDistinct(fallback, unique)) unique.push(fallback);
  return unique.slice(0, 3);
}

export async function getMemorySnapshot(db: D1, ownerId: string): Promise<MemorySnapshot> {
  const profile = await getOrCreateProfile(db, ownerId);
  const [result, evidenceResult, recommendedFocus] = await Promise.all([
    db.prepare(`SELECT e.discipline, e.session_type, e.raw_entry, e.created_at,
      d.takeaway, d.next_session_focus, d.structured_memory_json, d.status AS debrief_status
    FROM training_entries e LEFT JOIN training_debriefs d ON d.entry_id = e.id AND d.owner_id = e.owner_id
    WHERE e.owner_id = ? ORDER BY e.created_at DESC LIMIT 40`).bind(ownerId).all<{
      discipline: string; session_type: string; raw_entry: string; created_at: string;
      takeaway: string | null; next_session_focus: string | null; structured_memory_json: string | null; debrief_status: string | null;
    }>(),
    db.prepare(`SELECT owner_id, entry_id, category, canonical_key, label, source, confidence, observed_at
      FROM fighter_brain_evidence WHERE owner_id = ? ORDER BY observed_at DESC LIMIT 240`).bind(ownerId).all<BrainEvidence>(),
    db.prepare("SELECT focus, reason, confidence, entry_id, updated_at FROM fighter_focus_recommendations WHERE owner_id = ? LIMIT 1")
      .bind(ownerId).first<{ focus: string; reason: string; confidence: number; entry_id: string; updated_at: string }>(),
  ]);
  const rows = result.results ?? [];
  const evidence = evidenceResult.results ?? [];
  // A question-stage debrief is private working context, not Fighter Brain
  // evidence. It is intentionally invisible to Home, Learn, and Coach until
  // the athlete completes or meaningfully finishes the conversation.
  const completedRows = rows.filter((row) => row.debrief_status === "complete" && Boolean(row.structured_memory_json));
  const successes: string[] = [];
  const problems: string[] = [];
  const techniques: string[] = [];
  const concepts: string[] = [];
  const relatedTopics: string[] = [];
  const instructorDetails: string[] = [];
  const reportedFacts: string[] = [];
  const hypotheses: string[] = [];
  for (const row of completedRows) {
    try {
      const memory = JSON.parse(row.structured_memory_json ?? "{}") as Record<string, unknown>;
      if (Array.isArray(memory.successes)) successes.push(...memory.successes.filter((v): v is string => typeof v === "string"));
      if (Array.isArray(memory.problems)) problems.push(...memory.problems.filter((v): v is string => typeof v === "string"));
      if (Array.isArray(memory.techniques)) techniques.push(...memory.techniques.filter((v): v is string => typeof v === "string"));
      if (Array.isArray(memory.concepts)) concepts.push(...memory.concepts.filter((v): v is string => typeof v === "string"));
      if (Array.isArray(memory.related_topics)) relatedTopics.push(...memory.related_topics.filter((v): v is string => typeof v === "string"));
      if (Array.isArray(memory.instructor_details)) instructorDetails.push(...memory.instructor_details.filter((v): v is string => typeof v === "string"));
      if (Array.isArray(memory.reported_facts)) reportedFacts.push(...memory.reported_facts.filter((v): v is string => typeof v === "string"));
      if (Array.isArray(memory.fightiq_hypotheses)) hypotheses.push(...memory.fightiq_hypotheses.filter((v): v is string => typeof v === "string"));
      if (memory.intelligence && typeof memory.intelligence === "object" && !Array.isArray(memory.intelligence)) {
        const intelligence = memory.intelligence as Record<string, unknown>;
        for (const key of ["technique", "problem", "suspected_cause", "goal", "context"]) if (typeof intelligence[key] === "string" && intelligence[key].trim()) relatedTopics.push(intelligence[key]);
      }
    } catch { /* malformed historical memory is ignored */ }
  }
  const latestFocus = completedRows.find((row) => row.next_session_focus)?.next_session_focus;
  // A manually saved focus is the athlete's intent. FightIQ's recommendation is
  // deliberately separate and can evolve from evidence without overwriting it.
  const setup = getAthleteSetup(profile);
  // Before there is any training, the focus is the opening one, so My Game, the
  // home card and the rail into the gym all name the same thing. They used to
  // disagree, which is the cheapest possible way to lose somebody's trust.
  const opening = rows.length === 0
    ? openingBrief({ disciplines: setup.disciplines, experienceLevel: setup.experienceLevel, competitionIntent: setup.competitionIntent, currentFocus: profile.current_focus })
    : null;
  const currentFocus = profile.current_focus || recommendedFocus?.focus || latestFocus || opening?.mission || startingFocus(setup.disciplines);
  // This line is the only place the app decides what the athlete is working on,
  // and until now that decision was made fresh on every read and then forgotten.
  // Recorded here rather than at the three places a focus can be written,
  // because two of those write a candidate rather than the answer, and the
  // answer is what an athlete would recognise as "what I was working on".
  //
  // Deliberately not awaited into the response: a history write must never be
  // the reason somebody's home screen fails to load. If it throws, the next read
  // records the same change, because the change is derived rather than an event.
  const focusSource: FocusSource = profile.current_focus ? "stated" : opening ? "opening" : "fightiq";
  const focusReasonForHistory = profile.focus_reason || recommendedFocus?.reason || opening?.promise || "";
  // The same treatment for bodyweight. Onboarding overwrites the setup blob, so
  // without this an athlete who updates their weight destroys the old one, and
  // the curve that matters most in this sport never exists.
  if (isUsableWeight(setup.weightKg)) {
    void recordWeighIn(db, ownerId, { weightKg: setup.weightKg, source: "onboarding", now: new Date().toISOString() }).catch(() => undefined);
  }
  void recordFocus(db, ownerId, {
    focus: currentFocus,
    reason: focusReasonForHistory,
    source: focusSource,
    now: new Date().toISOString(),
    // Oldest first, so an athlete who already had training when this shipped gets
    // a record that starts where their training started rather than one that
    // opens by claiming they have logged nothing.
    firstSessionAt: rows.at(-1)?.created_at ?? null,
  }).catch(() => undefined);
  const used = [currentFocus];
  // A skill needs repeated evidence before it becomes a "strength" or "recurring problem".
  const counts = (items: string[]) => new Map(items.map((item) => [normalizeInsight(item), (items.filter((other) => normalizeInsight(other) === normalizeInsight(item)).length)]));
  const successCounts = counts(successes);
  const problemCounts = counts(problems);
  const strengthEvidence = groupedEvidence(evidence, "strength");
  const problemEvidence = groupedEvidence(evidence, "problem");
  const improvementEvidence = groupedEvidence(evidence, "improvement");
  const observationEvidence = groupedEvidence(evidence, "observation");
  const instructorEvidence = groupedEvidence(evidence, "instructor_cue");
  const confirmedEvidenceStrengths = evidenceLabels(strengthEvidence, (item) => item.count >= 3, used, 3);
  const strongestAreas = confirmedEvidenceStrengths.length
    ? confirmedEvidenceStrengths
    : takeDistinct(topValues(successes.filter((item) => (successCounts.get(normalizeInsight(item)) ?? 0) >= 3), 8), used, 3);
  const confirmedEvidenceProblems = evidenceLabels(problemEvidence, (item) => item.count >= 2, used, 3);
  const recurringProblems = confirmedEvidenceProblems.length
    ? confirmedEvidenceProblems
    : takeDistinct(topValues(problems.filter((item) => (problemCounts.get(normalizeInsight(item)) ?? 0) >= 2), 8), used, 3);
  const evidenceEmergingStrengths = evidenceLabels(strengthEvidence, (item) => item.count === 2, used, 3);
  const emergingStrengths = evidenceEmergingStrengths.length
    ? evidenceEmergingStrengths
    : takeDistinct(topValues(successes.filter((item) => (successCounts.get(normalizeInsight(item)) ?? 0) === 2), 8), used, 3);
  // Evidence tagged "improvement" only, never a bare success or a takeaway
  // quote: both are true things that happened, not evidence anything changed,
  // and the label above this text says "RECENT IMPROVEMENT".
  const evidenceImprovement = improvementEvidence[0]?.label;
  const improvement = evidenceImprovement && isDistinct(evidenceImprovement, used)
    ? titleCase(evidenceImprovement)
    : "FightIQ needs another completed debrief to confirm a distinct improvement.";
  used.push(improvement);
  const styleInfluences = takeDistinct(safeStringArray(profile.style_influences_json), used, 8);
  // A session type, a discipline name or a bare word is not a layer to build.
  // "Build Class as the layer that connects your current focus" is what happens
  // without this, and it reads exactly as carelessly as it sounds.
  const notASkill = /^(class|drilling|sparring|open mat|private|training|session|mma|bjj|boxing|judo|wrestling|muay thai|kickboxing|round|rounds|gym|coach)$/i;
  const evolutionCandidates = topValues([...relatedTopics, ...concepts, ...techniques], 12)
    .filter((topic) => topic.trim().length > 3 && !notASkill.test(topic.trim()));
  const evolutionTopic = takeDistinct(evolutionCandidates, used, 1)[0];
  // "Build Ankle Locks as the layer..." reads as a machine pasting a chip label
  // into a sentence, because that is what it was. Inside a sentence a technique
  // name is lowercase, unless it is a proper name like Kimura or Ezekiel.
  const nextEvolution = evolutionTopic
    ? `Build ${inSentence(evolutionTopic)} as the layer that connects your current focus to reliable offence.`
    : "After your current focus becomes reliable, connect it to one repeatable offensive response.";
  // Sessions are better evidence of what somebody trains than a form they filled
  // in once, so they lead. Experience and competition intent are deliberately
  // NOT inferred: eleven logged sessions tell you nothing about whether the
  // person writing them is a white belt or a black belt, and guessing "beginner"
  // at a competitor is worse than admitting the gap.
  const trains = disciplinesFromSessions(rows);
  return {
    disciplines: mergeDisciplines(setup.disciplines, trains),
    trains,
    experienceLevel: setup.experienceLevel,
    competitionIntent: setup.competitionIntent,
    sessionsLogged: rows.length,
    currentFocus,
    statedFocus: profile.current_focus?.trim() || null,
    focusReason: profile.focus_reason || recommendedFocus?.reason || opening?.promise || (latestFocus ? "This is the clearest thing to carry forward from your recent training." : "This gives your next sessions one clear direction."),
    strongestAreas: strongestAreas.length ? strongestAreas : ["Still learning your strongest areas"],
    recurringProblems: recurringProblems.length ? recurringProblems : ["No recurring problem confirmed yet"],
    recentImprovement: improvement,
    styleInfluences,
    nextEvolution,
    instructorDetails: instructorEvidence.length
      ? takeDistinct(instructorEvidence.map((item) => item.label), [], 3)
      : takeDistinct(topValues(instructorDetails, 8), [], 3),
    emergingStrengths,
    // The fallback path is where the noise came from: `techniques` is a list of
    // bare technique names, so with no observation evidence yet the brain filled
    // up with "Arm Drag". Both paths go through the same bar now, and an empty
    // list is a better answer than a full list of nothing.
    oneTimeObservations: observationEvidence.length
      ? takeDistinct(observationEvidence.filter((item) => item.count === 1).map((item) => item.label).filter(isObservation), [], 4)
      : takeDistinct(topValues([...reportedFacts, ...problems, ...successes].filter(isObservation), 12), [], 4),
    // Recent notes are useful as near-term Learn/Coach context, but unfinished
    // debriefs deliberately carry no inferred takeaway or focus.
    // Sixteen, not six: the weekly review decides whether a theme is new by
    // looking at what came before this week, and with six sessions an athlete
    // training three times a week has barely two weeks of history to judge from.
    // Notes are capped rather than sent whole. Sixteen unbounded notes is up to
    // 190KB of JSON on every home screen load, over a phone connection, to show
    // a weekly summary — and no real note comes close to this limit anyway.
    recentTraining: rows.slice(0, 16).map((row) => ({ discipline: row.discipline, sessionType: row.session_type, note: row.raw_entry.slice(0, 900), takeaway: row.debrief_status === "complete" ? row.takeaway : null, focus: row.debrief_status === "complete" ? row.next_session_focus : null, createdAt: row.created_at })),
  };
}



export async function getOrCreatePreTrainingBrief(db: D1, ownerId: string, memory?: MemorySnapshot): Promise<PreTrainingBrief> {
  const now = new Date();
  const since = new Date(now.getTime() - 18 * 60 * 60 * 1000).toISOString();
  const fighterMemory = memory ?? await getMemorySnapshot(db, ownerId);
  const opening = openingFromMemory(fighterMemory);
  // What this brief was built from, and therefore what makes it stale. Before
  // any training that is the fact of there being none, not the starting focus.
  const focus = opening ? FIRST_SESSION_SOURCE : fighterMemory.currentFocus;
  const existing = await db.prepare(`SELECT mission, reason, cue, source_focus, created_at FROM pre_training_briefs
    WHERE owner_id = ? AND consumed_at IS NULL AND created_at >= ? ORDER BY created_at DESC LIMIT 1`).bind(ownerId, since).first<{ mission: string; reason: string; cue: string; source_focus: string; created_at: string }>();
  // A brief is only worth reusing while the focus it was built from is still the
  // athlete's focus. The first request an app makes lands before onboarding has
  // finished, so without this a new athlete's first brief was built from an
  // empty profile — and then cached for eighteen hours, telling a Muay Thai
  // athlete about something from a sport they do not train.
  if (existing && existing.source_focus === focus) {
    const refreshedCue = briefCue(existing.mission);
    if (refreshedCue !== existing.cue) await db.prepare("UPDATE pre_training_briefs SET cue = ? WHERE owner_id = ? AND created_at = ?").bind(refreshedCue, ownerId, existing.created_at).run();
    return { mission: existing.mission, reason: existing.reason, cue: refreshedCue, sourceFocus: existing.source_focus, createdAt: existing.created_at };
  }
  if (existing) {
    // The stale one is retired rather than left to be picked up by the next read.
    await db.prepare("UPDATE pre_training_briefs SET consumed_at = ? WHERE owner_id = ? AND consumed_at IS NULL")
      .bind(now.toISOString(), ownerId).run();
  }
  const latest = fighterMemory.recentTraining[0];
  // Before the first session there is nothing to carry forward, so the brief is
  // the opening one. Built here rather than only in the response, because
  // pressing "start brief" reads this back and the two must not disagree.
  const mission = opening?.mission || latest?.focus || fighterMemory.currentFocus;
  const reason = opening?.body || latest?.takeaway || fighterMemory.focusReason;
  // Generous ceilings, deliberately. A focus is stored at 240 characters, so a
  // mission built from one now arrives whole instead of losing its last word.
  // The reason is a sentence and keeps its full stop; the mission is an
  // instruction and does not need one.
  const brief: PreTrainingBrief = { mission: clipLabel(mission || "Test your current focus", 240), reason: sentence(clip(reason || "Carry one clear detail from your last session into live work.", 240)), cue: briefCue(mission), sourceFocus: focus, createdAt: now.toISOString() };
  await db.prepare(`INSERT INTO pre_training_briefs (id, owner_id, mission, reason, cue, source_focus, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), ownerId, brief.mission, brief.reason, brief.cue, brief.sourceFocus, brief.createdAt).run();
  return brief;
}

export async function startPreTrainingExperiment(db: D1, ownerId: string, sessionPlan?: string) {
  const brief = await getOrCreatePreTrainingBrief(db, ownerId);
  const now = new Date().toISOString();
  const plan = sessionPlan?.replace(/\s+/g, " ").trim().slice(0, 240) ?? "";
  // Pressing “I’m training now” starts a distinct experiment. Never mutate a
  // previous open plan into a new session: that would make later evidence land
  // on the wrong class.
  await db.prepare(`UPDATE training_experiments SET status = 'complete', outcome = 'inconclusive', completed_at = ?
    WHERE owner_id = ? AND status = 'active'`).bind(now, ownerId).run();
  const planDomain = trainingDomain(plan);
  const briefDomain = trainingDomain(`${brief.mission} ${brief.reason}`);
  const compatible = !planDomain || planDomain === "mma" || !briefDomain || briefDomain === "mma" || planDomain === briefDomain || (planDomain === "grappling" && briefDomain === "wrestling") || (planDomain === "wrestling" && briefDomain === "grappling");
  const mission = compatible ? brief.mission : `Choose one detail to test in ${plan}`;
  const cue = compatible ? brief.cue : "Notice the first moment it changes.";
  // "For BJJ class: Ankle-lock execution felt successful in this session" is a
  // label glued to a sentence. Two sentences read like a person wrote them.
  const reason = compatible
    ? (plan ? `${sentence(brief.reason)} You are carrying it into ${plan}.` : sentence(brief.reason))
    : `Your ${briefDomain === "grappling" ? "grappling" : "current"} focus is better saved for a matching session. Today, carry one useful detail from ${plan}.`;
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO training_experiments (id, owner_id, mission, cue, reason, status, started_at, created_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`)
    .bind(id, ownerId, mission, cue, reason, now, now).run();
  await db.prepare("UPDATE pre_training_briefs SET consumed_at = ? WHERE owner_id = ? AND created_at = ? AND consumed_at IS NULL")
    .bind(now, ownerId, brief.createdAt).run();
  return { id, mission, cue, reason, status: "active", startedAt: now, outcome: null };
}

function trainingDomain(value: string) {
  const lower = value.toLowerCase();
  if (/muay thai|kickbox|boxing|strik|round kick|teep|jab|cross|hook/.test(lower)) return "striking";
  if (/wrestl|single leg|double leg|takedown/.test(lower)) return "wrestling";
  if (/bjj|jiu.?jitsu|grappl|arm drag|guard|mount|back take|frame/.test(lower)) return "grappling";
  if (/\bmma\b/.test(lower)) return "mma";
  return "";
}

export async function getActiveTrainingExperiment(db: D1, ownerId: string) {
  // An experiment is a single near-term test, not a permanent state. Quietly
  // close abandoned plans so an old “I'm training now” cannot attach itself to
  // a later, unrelated class.
  const staleBefore = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  await db.prepare(`UPDATE training_experiments SET status = 'complete', outcome = 'inconclusive', completed_at = ?
    WHERE owner_id = ? AND status = 'active' AND (started_at IS NULL OR started_at < ?)`)
    .bind(new Date().toISOString(), ownerId, staleBefore).run();
  return db.prepare(`SELECT id, mission, cue, reason, status, started_at, outcome FROM training_experiments
    WHERE owner_id = ? AND status = 'active' AND started_at >= ? ORDER BY created_at DESC LIMIT 1`).bind(ownerId, staleBefore).first<{ id: string; mission: string; cue: string; reason: string; status: string; started_at: string | null; outcome: string | null }>();
}

export async function linkExperimentToEntry(db: D1, ownerId: string, entryId: string, experimentId?: string) {
  if (!experimentId) return null;
  const experiment = await db.prepare(`SELECT id, mission, cue, reason, status, started_at, outcome FROM training_experiments
    WHERE id = ? AND owner_id = ? AND status = 'active' LIMIT 1`).bind(experimentId, ownerId).first<{ id: string; mission: string; cue: string; reason: string; status: string; started_at: string | null; outcome: string | null }>();
  if (!experiment) return null;
  // One tap on the pre-session brief represents one training experiment. If a
  // duplicate log is created, it remains saved but cannot overwrite the
  // outcome of the original experiment.
  const alreadyLinked = await db.prepare(`SELECT entry_id FROM training_experiment_sessions
    WHERE owner_id = ? AND experiment_id = ? LIMIT 1`).bind(ownerId, experiment.id).first<{ entry_id: string }>();
  if (alreadyLinked && alreadyLinked.entry_id !== entryId) return null;
  await db.prepare(`INSERT OR IGNORE INTO training_experiment_sessions (entry_id, owner_id, experiment_id, created_at)
    VALUES (?, ?, ?, ?)`)
    .bind(entryId, ownerId, experiment.id, new Date().toISOString()).run();
  return experiment;
}

export async function getExperimentForEntry(db: D1, ownerId: string, entryId: string) {
  return db.prepare(`SELECT e.id, e.mission, e.cue, e.reason, e.status, e.started_at, e.outcome
    FROM training_experiment_sessions s
    INNER JOIN training_experiments e ON e.id = s.experiment_id AND e.owner_id = s.owner_id
    WHERE s.entry_id = ? AND s.owner_id = ? LIMIT 1`)
    .bind(entryId, ownerId).first<{ id: string; mission: string; cue: string; reason: string; status: string; started_at: string | null; outcome: string | null }>();
}

export async function updateExperimentForEntry(db: D1, ownerId: string, entryId: string, outcome: string, evidence: string) {
  const resolvedOutcome = outcome === "unknown" ? "inconclusive" : outcome;
  await db.prepare(`UPDATE training_experiments SET status = 'complete', outcome = ?, evidence = ?, completed_at = ?
    WHERE id = (SELECT experiment_id FROM training_experiment_sessions WHERE entry_id = ? AND owner_id = ?)
      AND owner_id = ? AND status = 'active'`)
    .bind(resolvedOutcome, evidence.slice(0, 2000), new Date().toISOString(), entryId, ownerId, ownerId).run();
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
