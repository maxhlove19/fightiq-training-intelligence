#!/usr/bin/env node
// SessionStart. Every session begins by reading the goals, including the ones
// nobody is watching.
//
// A routine firing at three in the morning has no conversation history and no
// human to ask. goals.md is the only thing standing between that session and
// inventing its own priorities, so it is put in front of it before it does
// anything else.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./gates.mjs";

const root = repoRoot(process.cwd());

function main() {
  let goals = "";
  try { goals = readFileSync(join(root, "goals.md"), "utf8"); } catch { /* nothing to say */ }
  if (!goals.trim()) process.exit(0);

  let report = "";
  try { report = readFileSync(join(root, ".claude", "last-gate-report.md"), "utf8"); } catch { /* usually absent, which is good */ }

  const context = [
    "goals.md is the definition of done for this repository. Read it before choosing what to work on.",
    "",
    goals.trim(),
    report.trim() ? `\n\nA previous session left the tree failing. This is its report:\n\n${report.trim()}` : "",
  ].join("\n");

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context },
  }));
  process.exit(0);
}

try { main(); } catch { process.exit(0); }
