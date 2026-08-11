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
import { readTranscript } from "../.claude/hooks/handoff.mjs";
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

test("this repository's own stylesheet has one :root and no duplicate token", () => {
  // Was a record of the known defect (four competing :root blocks, --nav-height
  // declared three times). The reconciliation landed, so this now asserts the
  // fixed state stays fixed rather than describing a problem that is over.
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.equal(rootDeclarations(css).blocks, 1);
  assert.deepEqual(duplicateTokens(css), []);
});

// The handoff. It exists because a context window running out currently loses
// every thread, and the recovery depends on a human retyping what they remember.

test("the handoff records what was left unfinished, not only what was achieved", () => {
  const dir = scratchRepo();
  writeFileSync(join(dir, "goals.md"), "# goals.md\n\n1. **The tagline.** Replace it.\n");
  spawnSync("git", ["init", "-q"], { cwd: dir });
  writeFileSync(join(dir, "half-done.ts"), "export const x = 1;\n");
  runHook("handoff.mjs", { hook_event_name: "PreCompact", trigger: "auto" }, { cwd: dir });
  const handoff = readFileSync(join(dir, ".claude", "HANDOFF.md"), "utf8");
  assert.match(handoff, /Uncommitted work/);
  assert.match(handoff, /half-done\.ts/);
  // The section that stops a handoff reading as a success report.
  assert.match(handoff, /What was NOT verified/);
  assert.match(handoff, /not evidence a screen looks right/);
  assert.match(handoff, /The next action/);
  rmSync(dir, { recursive: true, force: true });
});

test("a session with no test run is told so rather than left to assume", () => {
  const dir = scratchRepo();
  runHook("handoff.mjs", { hook_event_name: "PreCompact" }, { cwd: dir });
  const handoff = readFileSync(join(dir, ".claude", "HANDOFF.md"), "utf8");
  assert.match(handoff, /No test run was seen[\s\S]*Assume nothing has been verified/);
  assert.match(handoff, /Do not assume a pull request exists/);
  rmSync(dir, { recursive: true, force: true });
});

test("the handoff never writes conversation text, only structured signals", () => {
  // The privacy guarantee is structural rather than a promise to be careful:
  // nothing in the transcript reaches the file except numbers, paths and URLs.
  const secretish = [
    JSON.stringify({ type: "user", content: "my ANTHROPIC_API_KEY is sk-ant-verysecret and I work at a specific gym" }),
    JSON.stringify({ type: "assistant", content: "# tests 42\n# pass 41\n# fail 1", extra: "https://github.com/o/r/pull/99" }),
    JSON.stringify({ type: "tool", tool_input: { file_path: "/workspace/fightiq-training-intelligence/lib/thing.ts" } }),
  ].join("\n");
  const signals = readTranscript(secretish);
  assert.deepEqual(signals.tests, { total: 42, pass: 41, fail: 1 });
  assert.deepEqual(signals.pullRequests, [99]);
  assert.deepEqual(signals.filesTouched, ["lib/thing.ts"]);
  // Nothing else survives the parse at all.
  const rendered = JSON.stringify(signals);
  assert.doesNotMatch(rendered, /sk-ant/);
  assert.doesNotMatch(rendered, /ANTHROPIC_API_KEY/);
  assert.doesNotMatch(rendered, /gym/);
});

test("a failing transcript produces a thinner handoff, never a failed one", () => {
  const dir = scratchRepo();
  const result = runHook("handoff.mjs", { hook_event_name: "PreCompact", transcript_path: "/nowhere/at/all.jsonl" }, { cwd: dir });
  assert.equal(result.status, 0);
  assert.ok(existsSync(join(dir, ".claude", "HANDOFF.md")));
  rmSync(dir, { recursive: true, force: true });
});

test("garbage on stdin does not stop a session losing its context", () => {
  const dir = scratchRepo();
  const result = spawnSync("node", [join(HOOKS, "handoff.mjs")], { input: "not json", encoding: "utf8", cwd: dir });
  assert.equal(result.status, 0);
  rmSync(dir, { recursive: true, force: true });
});

test("a cold session is handed the handoff before it is handed the goals", () => {
  const dir = scratchRepo();
  writeFileSync(join(dir, "goals.md"), "# goals.md\n\nThe top item is the tagline.\n");
  writeFileSync(join(dir, ".claude", "HANDOFF.md"), "# HANDOFF\n\nBranch: claude/tagline, 2 files uncommitted.\n");
  const result = runHook("orient.mjs", { hook_event_name: "SessionStart" }, { cwd: dir });
  const context = result.json.hookSpecificOutput.additionalContext;
  assert.match(context, /claude\/tagline/);
  assert.ok(context.indexOf("HANDOFF") < context.indexOf("The top item is the tagline"),
    "where things stand comes before what the project is for");
  rmSync(dir, { recursive: true, force: true });
});

test("a branch with commits and no handoff fails the check", () => {
  // The gap this closes: an unattended run writes a handoff, pushes, opens a PR
  // and has the container reclaimed with the file still uncommitted.
  const dir = scratchRepo();
  const run = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  run("init", "-q", "-b", "main");
  run("config", "user.email", "t@example.com");
  run("config", "user.name", "Test");
  writeFileSync(join(dir, "a.txt"), "one\n");
  run("add", "-A"); run("commit", "-qm", "base");
  run("checkout", "-qb", "claude/thing");
  writeFileSync(join(dir, "b.txt"), "two\n");
  run("add", "-A"); run("commit", "-qm", "work with no handoff");

  const check = join(process.cwd(), "scripts", "handoff-check.mjs");
  const without = spawnSync("node", [check], { cwd: dir, encoding: "utf8" });
  assert.equal(without.status, 1, "a branch with no handoff must fail");
  assert.match(without.stderr, /no \.claude\/HANDOFF\.md in them/);
  assert.match(without.stderr, /handoff\.mjs/, "the failure says how to fix it");

  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, ".claude", "HANDOFF.md"), "# HANDOFF\n");
  run("add", "-A"); run("commit", "-qm", "add handoff");
  const withIt = spawnSync("node", [check], { cwd: dir, encoding: "utf8" });
  assert.equal(withIt.status, 0, "a branch carrying a handoff passes");
  rmSync(dir, { recursive: true, force: true });
});

test("the handoff check never blocks main or an empty branch", () => {
  // A gate that fires where it cannot be satisfied is a gate somebody disables.
  const dir = scratchRepo();
  const run = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  run("init", "-q", "-b", "main");
  run("config", "user.email", "t@example.com");
  run("config", "user.name", "Test");
  writeFileSync(join(dir, "a.txt"), "one\n");
  run("add", "-A"); run("commit", "-qm", "base");

  const check = join(process.cwd(), "scripts", "handoff-check.mjs");
  assert.equal(spawnSync("node", [check], { cwd: dir, encoding: "utf8" }).status, 0, "main is skipped");
  run("checkout", "-qb", "claude/empty");
  assert.equal(spawnSync("node", [check], { cwd: dir, encoding: "utf8" }).status, 0, "a branch with no commits is skipped");
  rmSync(dir, { recursive: true, force: true });
});

test("the handoff can be run by hand without hanging", () => {
  // readFileSync(0) blocks forever on a terminal, so the documented manual run
  // hung rather than working. A hook that hangs is worse than one that does
  // nothing, and this is the second time that has been true here.
  const dir = scratchRepo();
  const result = spawnSync("node", [join(HOOKS, "handoff.mjs")], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
  assert.equal(result.status, 0);
  assert.ok(existsSync(join(dir, ".claude", "HANDOFF.md")));
  rmSync(dir, { recursive: true, force: true });
});
