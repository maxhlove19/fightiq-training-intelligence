// The gates, in one place, so the Stop hook and a human run the same checks.
//
// Every gate is a command plus a name. Nothing here knows about hooks, which is
// what makes it testable and what makes `node .claude/hooks/gates.mjs` a useful
// thing to type by hand.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const GATES = [
  { name: "typecheck", argv: ["npm", "run", "typecheck"], fast: false },
  { name: "lint", argv: ["npm", "run", "lint"], fast: true },
  { name: "build", argv: ["npm", "run", "build"], fast: false },
  { name: "tests", argv: ["node", "--test", "--import", "./tests/ts-imports.mjs", ...testFiles()], fast: false },
  // The house style is its own gate rather than one test among many, because it
  // is the rule most likely to be broken by something a model wrote and the one
  // most likely to be shrugged off in a list of two hundred passing tests.
  { name: "house-style", argv: ["node", "--test", "--import", "./tests/ts-imports.mjs", "tests/copy-voice.test.mjs", "tests/house-style.test.mjs"], fast: true },
  // A pull request without a handoff in it loses its context when the container
  // is reclaimed, which is what happens to every unattended run.
  { name: "handoff", argv: ["node", "scripts/handoff-check.mjs"], fast: true },
  // Impeccable's deterministic anti-pattern detectors. No model call, no API key,
  // no network: css-tree and htmlparser2 reading our own files. It owns the
  // question "does this look like a machine wrote it", which is exactly the
  // question we cannot answer about ourselves.
  //
  // Run through the gate rather than through its own Stop hook, so one place
  // decides whether a session may end. Its fast PostToolUse tier is left wired
  // in settings.json, because catching a fault seconds after it is written is
  // worth more than catching it at the end of a turn.
  { name: "design", argv: ["node", "scripts/design-check.mjs"], fast: false },
  // A custom property defined twice at :root is the defect that produced pure
  // blue and cyan on the same screen. Trivially detectable, so it is a gate.
  { name: "tokens", argv: ["node", "scripts/token-check.mjs"], fast: true },
  // Layout faults do not show up in a unit test. This is the sweep that caught
  // the composer escaping the phone frame, and it skips itself cleanly when
  // Playwright is not installed rather than failing the gate.
  { name: "layout", argv: ["node", "scripts/layout-sweep.mjs"], fast: false },
];

/** The test list lives in package.json, so the gate cannot drift away from `npm test`. */
function testFiles() {
  try {
    const pkg = JSON.parse(readFileSyncSafe("package.json") || "{}");
    return String(pkg.scripts?.test ?? "").match(/tests\/[\w.-]+\.mjs/g) ?? [];
  } catch { return []; }
}

function readFileSyncSafe(path) {
  try { return readFileSync(path, "utf8"); } catch { return ""; }
}

/**
 * Run one gate and return what happened.
 *
 * Never throws. A gate that cannot run at all is reported as skipped rather than
 * failed, because "the binary is missing" and "the code is broken" are different
 * facts and only one of them should stop a session.
 */
export function runGate(gate, { cwd = process.cwd(), timeoutMs = 600_000 } = {}) {
  const [command, ...args] = gate.argv;
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: timeoutMs, env: process.env });
  if (result.error) {
    return { name: gate.name, status: "skipped", detail: `could not run: ${result.error.message}` };
  }
  if (result.status === 0) return { name: gate.name, status: "passed", detail: "" };
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  return { name: gate.name, status: "failed", detail: meaningfulFailure(output) };
}

/**
 * The part of a wall of output that says what is actually wrong.
 *
 * A Stop hook reason gets read by a model deciding what to do next, so handing
 * it 4000 lines of npm noise is the same as handing it nothing.
 */
export function meaningfulFailure(output, limit = 2400) {
  const lines = output.split("\n");
  const interesting = lines.filter((line) =>
    /^not ok |error|Error|failed|FAIL|✖|error TS\d|AssertionError|expected|actual/.test(line)
    && !/^npm (warn|notice)/.test(line));
  const body = (interesting.length ? interesting : lines.filter(Boolean).slice(-40)).join("\n");
  return body.length > limit ? `${body.slice(0, limit)}\n… truncated` : body;
}

export function repoRoot(start = process.cwd()) {
  let dir = start;
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(dir, "package.json")) && existsSync(join(dir, ".claude"))) return dir;
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}
