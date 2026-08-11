// The point where Coach stops asking and says what it thinks.
//
// Before this, a conversation could narrow beautifully for seven exchanges and
// produce nothing: no verdict, no fix, and nothing written down. My Game would
// still say "No recurring problem confirmed yet" while the coach had just spent
// seven questions confirming one in detail. That is the app doing the hard part
// and dropping it on the floor.
//
// Two rules govern this file, and they are the two ways it goes wrong.
//
// WHEN TO STOP ASKING. Not a counter. The test is whether the next answer would
// change what the athlete is told to do. If it would not, the question is
// costing them and buying nothing, so the coach commits instead. A ceiling
// exists as a backstop, but it is a ceiling and not a target: every individual
// question in a seven question thread was reasonable, which is exactly how you
// end up seven questions deep.
//
// WHAT GETS WRITTEN DOWN. A wrong finding recorded durably is worse than no
// finding, because it shapes every week after it and the athlete trusts it. So
// the model never writes anything. It proposes, the athlete confirms in one
// tap, and only then is it recorded. Anything they do not confirm stays a thing
// that was said out loud and then forgotten, which is the correct fate for a
// guess. And a confirmed finding can be taken back later, because the athlete
// finding out they were wrong is a normal part of training.

/** How sure the coach is before the athlete has said anything about it. */
export type StatedConfidence = "hunch" | "likely";

export type CoachFinding = {
  /** What is going wrong, short enough to be a label in My Game. */
  problem: string;
  /** The mechanism underneath it. One sentence. */
  because: string;
  /** The one thing to do about it. */
  fix: string;
  /** What this was built from: their words, their sessions. Never invented. */
  basis: string[];
  confidence: StatedConfidence;
};

export type FindingStatus = "proposed" | "confirmed" | "rejected";

/**
 * How many exchanges a single thread gets before the coach has to commit.
 *
 * The prompt asks it to commit far earlier than this, on the value of the next
 * answer rather than on a count. This exists because a loop that never lands
 * costs an athlete more than a call that is roughly right and says so.
 */
export const COMMIT_BY_EXCHANGE = 4;

/** The JSON schema fragment the model is constrained to. Kept beside the rules it enforces. */
export const findingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["state", "problem", "because", "fix", "basis", "confidence"],
  properties: {
    state: { type: "string", enum: ["probing", "proposed"] },
    problem: { type: "string" },
    because: { type: "string" },
    fix: { type: "string" },
    basis: { type: "array", minItems: 0, maxItems: 4, items: { type: "string" } },
    confidence: { type: "string", enum: ["", "hunch", "likely"] },
  },
};

/** The three taps under a proposed finding. Statements, so answering costs one thumb. */
export const FINDING_CHOICES = ["That is it", "Not quite", "Not sure yet"] as const;

function tidy(value: unknown, limit: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

/**
 * A finding worth showing, or null.
 *
 * Returning null is the common and correct case: most turns are still probing,
 * and a half filled finding is worse than none because it puts a card on screen
 * that says nothing.
 */
export function readFinding(value: unknown): CoachFinding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.state !== "proposed") return null;

  const problem = tidy(raw.problem, 90);
  const because = tidy(raw.because, 240);
  const fix = tidy(raw.fix, 200);
  // All three or nothing. A finding with no fix is a diagnosis an athlete
  // cannot act on, which is the thing this whole feature exists to stop.
  if (problem.length < 4 || because.length < 8 || fix.length < 8) return null;

  const confidence: StatedConfidence = raw.confidence === "likely" ? "likely" : "hunch";
  const basis = Array.isArray(raw.basis)
    ? raw.basis.map((item) => tidy(item, 140)).filter((item) => item.length > 3).slice(0, 4)
    : [];
  return { problem, because, fix, basis, confidence };
}

/**
 * A stable key for the same problem said two different ways.
 *
 * Without it, "grip peeling off" on Tuesday and "my grip keeps peeling" on
 * Friday are two findings, and My Game fills with the same problem in slightly
 * different words.
 */
export function findingKey(problem: string): string {
  const stopWords = new Set(["the", "my", "a", "an", "is", "are", "was", "were", "it", "of", "to", "and", "on", "in", "keeps", "kept", "keep", "getting", "get"]);
  // "peeling" on Tuesday and "peeled" on Friday are the same problem. Crude
  // stemming is enough here and beats a dependency.
  const stem = (word: string) => word.replace(/(ing|ed|es|s)$/, (suffix: string) => (word.length - suffix.length >= 3 ? "" : suffix));
  return problem
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word))
    .map(stem)
    .filter(Boolean)
    .sort()
    .join("-")
    .slice(0, 120) || problem.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 120);
}

/** How a confirmed finding reads in My Game, where it has to stand alone. */
export function findingHeadline(finding: { problem: string; confidence?: StatedConfidence }): string {
  const problem = finding.problem.replace(/\.$/, "");
  return problem.charAt(0).toUpperCase() + problem.slice(1);
}
