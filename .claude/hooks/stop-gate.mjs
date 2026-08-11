#!/usr/bin/env node
// The Stop hook. A session may not end on a broken tree.
//
// It runs the real gates and, when one fails, returns decision "block" with the
// actual failure output as the reason, so the next turn starts knowing exactly
// what is wrong rather than being told to try again.
//
// THE LOOP PROTECTIONS, which are the whole difficulty here.
//
// Claude Code caps consecutive Stop-hook continuations at eight, and sets
// stop_hook_active on the input once it is already continuing because of us. A
// naive hook that blocks on every failure burns all eight attempts on the same
// failing test and then stops anyway, having achieved nothing except eight
// wasted turns. So this fingerprints the failure. If the same gate fails twice
// running with byte-identical output, nothing is being learned: it stops
// blocking, writes a report, and lets the turn end honestly.
//
// Being wrong in the safe direction matters more than being clever here. Every
// failure path exits 0 and stays silent, because a hook that crashes must never
// be the reason work stops.

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { GATES, repoRoot, runGate } from "./gates.mjs";

/** Claude Code's own ceiling. Ours has to be lower or it never gets a say. */
const HARD_CAP = 8;
/** Two identical failures in a row is not progress. */
const REPEAT_LIMIT = 2;

const root = repoRoot(process.cwd());
const statePath = join(root, ".claude", ".gate-state.json");
const reportPath = join(root, ".claude", "last-gate-report.md");

function readStdin() {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

function readState() {
  try { return JSON.parse(readFileSync(statePath, "utf8")); } catch { return {}; }
}

function writeState(state) {
  try {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify(state, null, 2));
  } catch { /* a state file we cannot write is not worth failing a turn over */ }
}

/**
 * A stable identity for "the same thing is still broken".
 *
 * npm prints a timestamped log path on every failure, so comparing raw output
 * would have made every failure look new and the repeat protection would never
 * have fired. Timestamps, absolute paths and durations are stripped, which is
 * exactly the information that changes between two runs of the same failure.
 */
function fingerprint(failures) {
  return failures
    .map((item) => `${item.name}:${item.detail}`)
    .join("\n")
    .replace(/\d{4}-\d{2}-\d{2}T[\d_.:-]+Z?/g, "<time>")
    .replace(/\/[\w./-]*_logs\/[\w.-]+/g, "<log>")
    .replace(/\b\d+(\.\d+)?\s?ms\b/g, "<ms>")
    .replace(/\/tmp\/[\w.-]+/g, "<tmp>");
}

function emit(payload) {
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

function main() {
  const input = (() => {
    try { return JSON.parse(readStdin() || "{}"); } catch { return {}; }
  })();
  const sessionId = String(input.session_id ?? "unknown");
  const alreadyContinuing = input.stop_hook_active === true;
  const state = readState();
  const previous = state.sessionId === sessionId ? state : { sessionId, attempts: 0, lastFingerprint: "", repeats: 0 };

  const results = GATES.map((gate) => runGate(gate, { cwd: root }));
  const failures = results.filter((item) => item.status === "failed");
  const skipped = results.filter((item) => item.status === "skipped");

  if (failures.length === 0) {
    writeState({ sessionId, attempts: 0, lastFingerprint: "", repeats: 0 });
    // Not a failure, so this is guidance rather than a block. additionalContext
    // is what that is for.
    const note = skipped.length
      ? `All gates passed. Skipped, because they could not run here: ${skipped.map((item) => item.name).join(", ")}.`
      : "All gates passed: typecheck, lint, build, tests, house style, layout sweep.";
    emit({ hookSpecificOutput: { hookEventName: "Stop", additionalContext: note } });
  }

  const current = fingerprint(failures);
  const repeats = current === previous.lastFingerprint ? previous.repeats + 1 : 1;
  const attempts = alreadyContinuing ? previous.attempts + 1 : 1;
  writeState({ sessionId, attempts, lastFingerprint: current, repeats });

  const summary = failures.map((item) => `### ${item.name}\n\n${item.detail}`).join("\n\n");

  // Stop blocking when the loop is not learning anything, or when we are about
  // to run into Claude Code's own ceiling. Either way the turn ends honestly
  // with the failure written down rather than thrashing to the cap.
  const stuck = repeats >= REPEAT_LIMIT;
  const nearCap = attempts >= HARD_CAP - 1;
  if (stuck || nearCap) {
    const why = stuck
      ? `The same gate failed ${repeats} times running with identical output, so continuing is not learning anything.`
      : `Reached ${attempts} of the ${HARD_CAP} allowed continuations.`;
    try {
      writeFileSync(reportPath, [
        `# Gate report`,
        ``,
        `Session ${sessionId}. Stopped blocking after ${attempts} attempt(s).`,
        ``,
        why,
        ``,
        `## Failing gates`,
        ``,
        summary,
        ``,
      ].join("\n"));
    } catch { /* the report is a courtesy, not a gate */ }
    emit({
      hookSpecificOutput: {
        hookEventName: "Stop",
        additionalContext: `${why} The tree is still failing: ${failures.map((item) => item.name).join(", ")}. Written to .claude/last-gate-report.md. Do not claim this work is finished.`,
      },
    });
  }

  emit({
    decision: "block",
    reason: [
      `The tree is not in a state that can be left. ${failures.length} gate(s) failing: ${failures.map((item) => item.name).join(", ")}.`,
      ``,
      summary,
      ``,
      `Fix these before finishing. If a fix is genuinely not possible, say so plainly and stop rather than working around the gate.`,
    ].join("\n"),
  });
}

try {
  main();
} catch (error) {
  // Silent and successful. A broken hook must never be the reason work stops.
  try {
    appendFileSync(join(root, ".claude", "hook-errors.log"), `${new Date().toISOString()} stop-gate ${String(error)}\n`);
  } catch { /* nothing left to do */ }
  process.exit(0);
}
