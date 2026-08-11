#!/usr/bin/env node
// Write down where things stand, at the moment that knowledge is about to be
// lost rather than at the moment somebody remembers to write it.
//
// Fires on PreCompact, and can be run by hand: `node .claude/hooks/handoff.mjs`.
//
// WHAT IT REFUSES TO WRITE, and this is a rule rather than an oversight. No free
// text from the transcript, ever. No environment variable values, no secrets, and
// nothing about any person. The file is assembled from structured signals only:
// git state, file paths, test counts, and pull request URLs that came back from
// an API. That makes the privacy guarantee structural rather than a promise to
// be careful, in the same way the cost table records counts and never content.
//
// It also records what was NOT done. A handoff that reads like a success report
// is worse than no handoff, because the reader trusts it and inherits a blind
// spot.

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./gates.mjs";

const root = repoRoot(process.cwd());
const handoffPath = join(root, ".claude", "HANDOFF.md");

function git(...args) {
  // stdio silenced: several of these calls are expected to fail (no upstream, an
  // untracked file), and a hook that prints git errors during compaction looks
  // like a broken hook.
  try { return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; }
}

function readStdin() {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

/**
 * Structured signals only. Nothing here returns prose from the conversation.
 *
 * The transcript is JSONL and its shape is not ours, so every field is optional
 * and every read is defensive. A transcript we cannot parse produces a thinner
 * handoff, never a failed one.
 */
export function readTranscript(text) {
  const signals = { tests: null, pullRequests: [], filesTouched: new Set() };
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const blob = JSON.stringify(entry);

    // Pull request numbers that came back from the API, never inferred.
    for (const match of blob.matchAll(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/g)) {
      if (!signals.pullRequests.includes(Number(match[1]))) signals.pullRequests.push(Number(match[1]));
    }
    // The most recent test result wins, because it is the current one.
    const tests = /# tests (\d+)[\s\S]{0,80}?# pass (\d+)[\s\S]{0,40}?# fail (\d+)/.exec(blob);
    if (tests) signals.tests = { total: Number(tests[1]), pass: Number(tests[2]), fail: Number(tests[3]) };
    // File paths only. Not their contents.
    for (const match of blob.matchAll(/"file_path":"([^"]+)"/g)) {
      const path = match[1].replace(/^.*?\/fightiq-training-intelligence\//, "");
      if (!path.startsWith("/tmp")) signals.filesTouched.add(path);
    }

  }
  return { ...signals, filesTouched: [...signals.filesTouched] };
}

/** Which goals.md item a branch is plausibly against. A hint, labelled as one. */
export function goalsHint(branch, goals) {
  const words = branch.replace(/^claude\//, "").split(/[-_/]/).filter((w) => w.length > 3);
  const lines = goals.split("\n").filter((line) => /^\s*\d+\.\s/.test(line));
  const scored = lines
    .map((line) => ({ line: line.trim(), score: words.filter((w) => line.toLowerCase().includes(w.toLowerCase())).length }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.line ?? "";
}

function build(input) {
  const branch = git("rev-parse", "--abbrev-ref", "HEAD") || "unknown";
  const head = git("rev-parse", "--short", "HEAD");
  const subject = git("log", "-1", "--format=%s");
  const status = git("status", "--porcelain");
  const uncommitted = status.split("\n").filter(Boolean);
  const upstream = git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}");
  const ahead = upstream ? git("rev-list", "--count", `${upstream}..HEAD`) : "";
  const goals = existsSync(join(root, "goals.md")) ? readFileSync(join(root, "goals.md"), "utf8") : "";

  let signals = { tests: null, pullRequests: [], filesTouched: [] };
  if (input.transcript_path && existsSync(input.transcript_path)) {
    try { signals = readTranscript(readFileSync(input.transcript_path, "utf8")); } catch { /* thinner handoff, not a failed one */ }
  }

  const hint = goalsHint(branch, goals);
  const committed = git("ls-files", "--error-unmatch", ".claude/HANDOFF.md") ? "tracked" : "untracked";

  return [
    "# HANDOFF",
    "",
    `Written automatically at ${new Date().toISOString()}${input.trigger ? ` (PreCompact, ${input.trigger})` : " (run by hand)"}.`,
    "",
    "Read this before doing anything else. It is generated from git state and",
    "structured signals, never from conversation text, so it can be thin but it",
    "cannot be wrong about what it does say.",
    "",
    "## Where the work is",
    "",
    `- Branch: \`${branch}\``,
    `- HEAD: \`${head}\` ${subject ? `"${subject}"` : ""}`,
    upstream ? `- Tracking \`${upstream}\`${ahead && ahead !== "0" ? `, ${ahead} commit(s) not pushed` : ", pushed"}` : "- No upstream. Nothing has been pushed from this branch.",
    "",
    uncommitted.length
      ? `## Uncommitted work, ${uncommitted.length} file(s)\n\nThis is the part that disappears if the container is reclaimed.\n\n${uncommitted.map((line) => `- \`${line}\``).join("\n")}`
      : "## Uncommitted work\n\nNone. The working tree is clean.",
    "",
    "## What this branch is probably against",
    "",
    hint ? `Inferred from the branch name, so treat it as a hint rather than a fact:\n\n> ${hint}` : "Could not infer a goals.md item from the branch name. Read goals.md and pick the top unblocked item.",
    "",
    "## What was verified",
    "",
    signals.tests
      ? `- Last test run seen in this session: **${signals.tests.pass}/${signals.tests.total} passing, ${signals.tests.fail} failing.**${signals.tests.fail ? " The tree was failing." : ""}`
      : "- No test run was seen in this session. Assume nothing has been verified.",
    "",
    "## What was NOT verified",
    "",
    "State this honestly rather than leaving it blank.",
    "",
    "- **A passing test suite is not evidence a screen looks right.** Unless a",
    "  browser measurement appears in the PR body for this branch, assume no",
    "  visual check was done.",
    "- Nothing here confirms anything is deployed. Merged is not live: see the",
    "  known defect in goals.md about the live build being behind main.",
    "",
    "## Pull requests seen in this session",
    "",
    signals.pullRequests.length
      ? `The most recent, in the order they appeared, numbers returned by the API rather than inferred: ${signals.pullRequests.slice(-5).map((n) => `#${n}`).join(", ")}.\n\nRe-read the list before relying on their state. A number appearing here means it existed, not that it is still open.`
      : "None seen. Do not assume a pull request exists for this branch; read the list.",
    "",
    "## Files touched in this session",
    "",
    signals.filesTouched.length
      ? signals.filesTouched.slice(0, 40).map((path) => `- \`${path}\``).join("\n")
      : "- None recorded.",
    "",
    "## The next action",
    "",
    uncommitted.length
      ? "Commit or discard the uncommitted work above before starting anything new."
      : upstream && ahead && ahead !== "0"
        ? "Push this branch, then read the pull request list to see whether one exists."
        : "Read goals.md, take the top unblocked item, and start one branch for it.",
    "",
    "---",
    "",
    `This file is **${committed}** in git. If it is untracked it does not reach a`,
    "cloud session or a phone, because those clone the repository and nothing else.",
    "It is written by a hook and committed by a human, deliberately: see the PR that",
    "introduced it.",
    "",
  ].join("\n");
}

function main() {
  const input = (() => {
    try { return JSON.parse(readStdin() || "{}"); } catch { return {}; }
  })();
  writeFileSync(handoffPath, build(input));
  // PreCompact ignores stdout, so this is for a human running it by hand.
  if (!input.hook_event_name) process.stdout.write(`handoff: wrote ${handoffPath}\n`);
  process.exit(0);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    // Never block a session and never lose work. A handoff that fails is a
    // missing file; a handoff that throws during compaction is lost work.
    try { appendFileSync(join(root, ".claude", "hook-errors.log"), `${new Date().toISOString()} handoff ${String(error)}\n`); } catch { /* nothing left */ }
    process.exit(0);
  }
}
