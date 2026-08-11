// A gate nobody tested is worse than no gate, because everyone believes it.
//
// These feed the hook scripts real fixture JSON on stdin and assert the decision
// they emit, including the two that matter most for an unattended run: that a
// hook which cannot run exits silently rather than stopping work, and that the
// Stop hook gives up blocking when it is no longer learning anything.

import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { duplicateTokens, rootDeclarations } from "../scripts/token-check.mjs";
import { fastChecks, houseStyleFaults } from "../.claude/hooks/observe.mjs";
import { meaningfulFailure, runGate } from "../.claude/hooks/gates.mjs";

const HOOKS = new URL("../.claude/hooks/", import.meta.url).pathname;

function runHook(script, input, { cwd = process.cwd(), env = {} } = {}) {
  const result = spawnSync("node", [join(HOOKS, script)], {
    input: JSON.stringify(input), encoding: "utf8", cwd, env: { ...process.env, ...env }, timeout: 120_000,
  });
  let json = null;
  try { json = result.stdout.trim() ? JSON.parse(result.stdout) : null; } catch { /* not JSON */ }
  return { status: result.status, stdout: result.stdout, json };
}

/** A throwaway repo shaped enough for a hook to find its root. */
function scratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), "fightiq-hook-"));
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "scratch", scripts: {} }));
  return dir;
}

test("a hook exits silently when there is nothing for it to say", () => {
  // orient with no goals.md. Exit 0 and no output, because a missing file must
  // never be the reason a session cannot start.
  const dir = scratchRepo();
  const result = runHook("orient.mjs", { hook_event_name: "SessionStart" }, { cwd: dir });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "");
  rmSync(dir, { recursive: true, force: true });
});

test("SessionStart puts goals.md in front of a session that has no human", () => {
  const dir = scratchRepo();
  writeFileSync(join(dir, "goals.md"), "# goals.md\n\nThe top item is the slop pass.\n");
  const result = runHook("orient.mjs", { hook_event_name: "SessionStart" }, { cwd: dir });
  assert.equal(result.status, 0);
  assert.equal(result.json.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(result.json.hookSpecificOutput.additionalContext, /The top item is the slop pass/);
  rmSync(dir, { recursive: true, force: true });
});

test("SessionStart surfaces a previous session's failure rather than hiding it", () => {
  const dir = scratchRepo();
  writeFileSync(join(dir, "goals.md"), "# goals.md\n");
  writeFileSync(join(dir, ".claude", "last-gate-report.md"), "# Gate report\n\ntests failed on clip.test.mjs");
  const result = runHook("orient.mjs", { hook_event_name: "SessionStart" }, { cwd: dir });
  assert.match(result.json.hookSpecificOutput.additionalContext, /clip\.test\.mjs/);
  rmSync(dir, { recursive: true, force: true });
});

test("the observer reports rather than blocks, so a mid-edit file is allowed to be wrong", () => {
  const dir = scratchRepo();
  const file = join(dir, "bad.ts");
  writeFileSync(file, 'export const note = "a pause — then a stop";\n');
  const result = runHook("observe.mjs", {
    hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: file }, session_id: "s1",
  }, { cwd: dir });
  assert.equal(result.status, 0);
  assert.equal(result.json.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.match(result.json.hookSpecificOutput.additionalContext, /em or en dash/);
  // Never a block. That is the Stop gate's job.
  assert.equal(result.json.decision, undefined);
  rmSync(dir, { recursive: true, force: true });
});

test("the observer keeps a record of what an unattended run touched", () => {
  const dir = scratchRepo();
  const file = join(dir, "fine.ts");
  writeFileSync(file, "export const note = \"clean\";\n");
  runHook("observe.mjs", { tool_name: "Write", tool_input: { file_path: file }, session_id: "s9" }, { cwd: dir });
  const log = readFileSync(join(dir, ".claude", "observer.log"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(log.at(-1).tool, "Write");
  assert.equal(log.at(-1).file, "fine.ts");
  assert.equal(log.at(-1).session, "s9");
  rmSync(dir, { recursive: true, force: true });
});

test("the observer survives input it cannot understand", () => {
  const dir = scratchRepo();
  const result = spawnSync("node", [join(HOOKS, "observe.mjs")], { input: "not json at all", encoding: "utf8", cwd: dir });
  assert.equal(result.status, 0);
  rmSync(dir, { recursive: true, force: true });
});

test("the fast checks catch what they are for and nothing else", () => {
  assert.deepEqual(houseStyleFaults('const a = "clean";'), []);
  assert.equal(houseStyleFaults('const a = "a — b";').length, 1);
  // A hyphen is not a dash and a compound word must survive.
  assert.deepEqual(houseStyleFaults('const a = "ankle-lock";'), []);
  assert.equal(fastChecks("x.json", "{ not json").length, 1);
  assert.deepEqual(fastChecks("x.json", '{"ok":true}'), []);
  assert.equal(fastChecks("x.ts", "<<<<<<< HEAD\na\n=======\nb\n>>>>>>> other").length, 1);
});

test("a failure reason says what is wrong rather than handing over a wall of npm noise", () => {
  const noise = ["npm warn deprecated foo", "> build", "not ok 12 - the composer is laid out", "  AssertionError: expected true", "npm notice update available"].join("\n");
  const summary = meaningfulFailure(noise);
  assert.match(summary, /not ok 12/);
  assert.match(summary, /AssertionError/);
  assert.doesNotMatch(summary, /npm warn/);
  assert.doesNotMatch(summary, /npm notice/);
});

test("a long failure is truncated rather than flooding the next turn", () => {
  const flood = Array.from({ length: 500 }, (_, i) => `error ${i}: something broke`).join("\n");
  const summary = meaningfulFailure(flood, 500);
  assert.ok(summary.length <= 520);
  assert.match(summary, /truncated/);
});

test("the Stop gate blocks on a broken tree and says what broke", () => {
  // A scratch repo whose only gate is one that fails.
  const dir = scratchRepo();
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "scratch", scripts: { typecheck: "node -e \"console.error('error TS1: broken on purpose'); process.exit(1)\"" } }));
  const result = runHook("stop-gate.mjs", { hook_event_name: "Stop", session_id: "block-1", stop_hook_active: false }, { cwd: dir });
  assert.equal(result.status, 0);
  assert.equal(result.json.decision, "block");
  assert.match(result.json.reason, /typecheck/);
  assert.match(result.json.reason, /broken on purpose/);
  rmSync(dir, { recursive: true, force: true });
});

test("the Stop gate stops blocking once it is not learning anything", () => {
  // The loop protection. Claude Code caps continuations at eight, so a hook that
  // blocks forever on one failing test burns all eight and stops anyway.
  const dir = scratchRepo();
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "scratch", scripts: { typecheck: "node -e \"console.error('error TS1: same failure every time'); process.exit(1)\"" } }));
  const input = { hook_event_name: "Stop", session_id: "repeat-1", stop_hook_active: true };

  const first = runHook("stop-gate.mjs", input, { cwd: dir });
  assert.equal(first.json.decision, "block", "the first identical failure still blocks");

  const second = runHook("stop-gate.mjs", input, { cwd: dir });
  assert.equal(second.json.decision, undefined, "the second identical failure gives up rather than thrashing");
  assert.match(second.json.hookSpecificOutput.additionalContext, /not learning anything/);
  assert.match(second.json.hookSpecificOutput.additionalContext, /Do not claim this work is finished/);

  // And it leaves the failure written down rather than losing it.
  assert.ok(existsSync(join(dir, ".claude", "last-gate-report.md")));
  assert.match(readFileSync(join(dir, ".claude", "last-gate-report.md"), "utf8"), /same failure every time/);
  rmSync(dir, { recursive: true, force: true });
});

test("a gate whose binary is missing is skipped, not failed", () => {
  // "The binary is missing" and "the code is broken" are different facts, and
  // only one of them should stop a session. A missing npm *script* is a real
  // failure and does block, which is why this uses a command that does not
  // exist at all rather than an absent script.
  const missing = runGate({ name: "ghost", argv: ["definitely-not-a-real-binary-9f3", "--version"] });
  assert.equal(missing.status, "skipped");
  assert.match(missing.detail, /could not run/);

  const broken = runGate({ name: "real", argv: ["node", "-e", "process.exit(3)"] });
  assert.equal(broken.status, "failed");
});

test("the token check finds a property defined more than once", () => {
  const css = ":root { --blue: #087cff; --ink: #fff; }\n.a { color: red }\n:root { --blue: #08c8df; }\n";
  const duplicates = duplicateTokens(css);
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].name, "--blue");
  assert.deepEqual(duplicates[0].values, ["#087cff", "#08c8df"]);
  assert.equal(rootDeclarations(css).blocks, 2);
});

test("a :root inside a media query is a deliberate override, not a collision", () => {
  const css = ":root { --blue: #087cff; }\n@media (min-width: 900px) { :root { --blue: #006dff; } }\n";
  assert.deepEqual(duplicateTokens(css), []);
});

test("this repository's own stylesheet is the reason the token gate exists", () => {
  // Not a hypothetical. Recorded here so that fixing it is visible as a change
  // in this test rather than as a number nobody was watching.
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const duplicates = duplicateTokens(css);
  const navHeight = duplicates.find((item) => item.name === "--nav-height");
  assert.ok(duplicates.length > 0, "if this now passes, the reconciliation landed: tighten this test");
  assert.ok(navHeight, "--nav-height is load-bearing geometry declared more than once");
});
