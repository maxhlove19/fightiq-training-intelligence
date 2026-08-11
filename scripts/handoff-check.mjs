#!/usr/bin/env node
// A pull request without a handoff in it is a pull request whose context dies
// with the container that produced it.
//
// The handoff hook writes a tracked file, and a human commits it. That works
// while a human is there. At four in the morning nobody is, so the run writes
// its handoff, pushes a branch, opens a pull request, and the container is
// reclaimed with the file still uncommitted: the one scenario the feature exists
// for is the one where it silently does nothing.
//
// So the run includes the handoff in the commit it is already making. That
// commit is not mid-work, races nothing, and lands the state attached to the
// pull request a person reads anyway. This check is what makes that true rather
// than remembered.

import { execFileSync } from "node:child_process";

const HANDOFF = ".claude/HANDOFF.md";

function git(...args) {
  try { return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; }
}

const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (!branch || branch === "main" || branch === "HEAD") {
  console.log("handoff-check: skipped, not on a working branch.");
  process.exit(0);
}

// The base to compare against. Without it there is nothing to say.
const base = git("rev-parse", "--verify", "origin/main") ? "origin/main" : git("rev-parse", "--verify", "main") ? "main" : "";
if (!base) {
  console.log("handoff-check: skipped, no main to compare against.");
  process.exit(0);
}

const commits = git("rev-list", "--count", `${base}..HEAD`);
if (!commits || commits === "0") {
  console.log("handoff-check: skipped, this branch has no commits of its own yet.");
  process.exit(0);
}

const changed = git("diff", "--name-only", `${base}...HEAD`).split("\n").filter(Boolean);
if (changed.includes(HANDOFF)) {
  console.log(`handoff-check: ${HANDOFF} is committed on this branch.`);
  process.exit(0);
}

console.error(`handoff-check: this branch has ${commits} commit(s) and no ${HANDOFF} in them.`);
console.error("");
console.error("A pull request without a handoff loses its context when the container is");
console.error("reclaimed, which is exactly what happens to an unattended run.");
console.error("");
console.error("Fix it with:");
console.error("  node .claude/hooks/handoff.mjs");
console.error(`  git add ${HANDOFF} && git commit --amend --no-edit`);
process.exit(1);
