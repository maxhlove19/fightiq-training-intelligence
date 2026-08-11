// Most people do not write training notes. They write "bjj, tired" and put the
// phone away.
//
// An app built on the assumption of a careful diary is an app that works for
// about four people. This reads how much is actually in a note, so the coach can
// behave differently instead of summarising four words back at somebody and
// calling it intelligence.
//
// The principle: a thin note is not a failure to be corrected. It is the normal
// case. What makes it valuable is the one question asked afterwards, answered
// with a tap, and the memory that carries the thread between sessions. Over a
// month, ten four-word notes plus ten tapped answers beat one essay.

export type NoteDepth = "empty" | "thin" | "partial" | "rich";

export type NoteSignals = {
  /** Names a technique, position or movement. */
  technique: boolean;
  /** Says something went wrong, or was hard. */
  problem: boolean;
  /** Says something worked. */
  outcome: boolean;
  /** Reports what a coach or instructor said. The highest value thing in any note. */
  coachCue: boolean;
  /** Mentions a partner or opponent, so there was resistance. */
  partner: boolean;
  /** How it felt, physically or mentally. */
  feeling: boolean;
};

export type DepthReading = {
  depth: NoteDepth;
  words: number;
  signals: NoteSignals;
  /** What is worth asking about, most useful first. */
  missing: string[];
  /** Handed to the model, so behaviour on a thin note is decided here rather than hoped for. */
  guidance: string;
};

const TECHNIQUE = /\b(kick|teep|knee|elbow|punch|jab|cross|hook|uppercut|clinch|guard|mount|armbar|triangle|choke|kimura|sweep|pass|takedown|single|double|sprawl|escape|drag|underhook|overhook|frame|shot|combination|combo|footwork|angle|stance|pivot|slip|roll|parry|counter|feint|block|check|drill|round ?kick|switch kick|body kick|head kick|back ?take|half guard|side control|north south|butterfly|de la riva|kesa|support foot|lead (foot|hand|leg)|rear (foot|hand|leg)|plant foot|base|posture|grip|head position|hips?|shoulders?|elbows? in|hands? up|chin|weight (forward|back)|balance)\b/i;
const PROBLEM = /\b(kept|keep|couldn'?t|can'?t|lost|losing|got (caught|stuck|passed|taken|swept|dominated)|struggl|wrong|bad|sloppy|late|slow|flat|square|stiff|forgot|missed|failed|leak|gassed|tired out|problem|issue|need to|should have|too (slow|late|wide|square|high|low|much|little))\b/i;
const OUTCOME = /\b(worked|landed|better|improved|finally|clean|sharp|good|nailed|hit it|got it|sorted|clicked|felt right|first time)\b/i;
const COACH_CUE = /\b(coach|professor|instructor|sensei|kru|told me|said to|was told|showed me|corrected)\b/i;
const PARTNER = /\b(he|she|they|him|her|them|partner|opponent|sparr?ing|rolling|live|drilling with|guy|girl|training partner)\b/i;
const FEELING = /\b(felt|feeling|tired|exhausted|fresh|sharp|flat|heavy|light|sore|stiff|strong|weak|nervous|calm|relaxed|panicked|rushed)\b/i;

function countWords(note: string): number {
  return note.trim().split(/\s+/).filter(Boolean).length;
}

const ASK_FOR: Array<{ key: keyof NoteSignals; label: string }> = [
  // Ordered by how much a coach could do with the answer.
  { key: "problem", label: "what actually broke down" },
  { key: "coachCue", label: "anything the coach said" },
  { key: "technique", label: "which technique or position it was" },
  { key: "partner", label: "whether there was live resistance" },
  { key: "outcome", label: "what did work" },
  { key: "feeling", label: "how the body felt" },
];

const GUIDANCE: Record<NoteDepth, string> = {
  empty: "There is effectively nothing here. Do not invent a session. Acknowledge it in one short line, then ask the single most useful question with three tappable choices drawn from what this athlete usually trains.",
  thin: [
    "This note is thin, and that is normal. Most athletes write four words and put the phone away.",
    "Do not summarise it back at them. Repeating four words is worthless and reads as though nothing was understood.",
    "Do not invent detail, and never suggest the note was too short. That is the fastest way to stop getting notes at all.",
    "Instead, lean on what you already know about this athlete from their history, and spend your one question well.",
    "Ask the smallest question whose answer would genuinely change what they work on next, and give three tappable choices so answering costs one thumb press.",
    "A thin note plus one tapped answer is a complete session for this athlete. Treat it as a win, not a gap.",
  ].join(" "),
  partial: "There is real content here but a gap that matters. Say what is clear from their own words, then ask the one question that closes the most useful gap. Offer tappable choices.",
  rich: "There is plenty here. Do not ask for more unless a genuine ambiguity would change your advice. Give them the read and the one thing to work on.",
};

/** How much a note actually contains, and what to do about it. */
export function readNoteDepth(note: string): DepthReading {
  const text = (note ?? "").trim();
  const words = countWords(text);
  const signals: NoteSignals = {
    technique: TECHNIQUE.test(text),
    problem: PROBLEM.test(text),
    outcome: OUTCOME.test(text),
    coachCue: COACH_CUE.test(text),
    partner: PARTNER.test(text),
    feeling: FEELING.test(text),
  };
  const present = Object.values(signals).filter(Boolean).length;

  // Word count alone is a poor judge. "Coach said my support foot is late" is
  // seven words and worth more than sixty words about the drive home.
  // "bjj" is one word and a real session. Only genuinely blank input is empty,
  // and the route rejects that before it gets here, so that branch is a guard
  // rather than a case anybody meets.
  const depth: NoteDepth = words === 0 ? "empty"
    : present <= 1 ? "thin"
      : signals.technique && present >= 3 && words >= 22 ? "rich"
        : "partial";

  const missing = ASK_FOR.filter((item) => !signals[item.key]).map((item) => item.label);
  return { depth, words, signals, missing, guidance: GUIDANCE[depth] };
}

/**
 * The block handed to the model alongside the note. Kept here so the same
 * wording reaches the debrief and the Coach, and so it can be read without
 * opening a prompt string.
 */
export function depthBriefing(reading: DepthReading): string {
  const missing = reading.missing.length ? ` The note does not say: ${reading.missing.slice(0, 3).join(", ")}.` : "";
  return `NOTE DEPTH: ${reading.depth} (${reading.words} words).${missing} ${reading.guidance}`;
}
