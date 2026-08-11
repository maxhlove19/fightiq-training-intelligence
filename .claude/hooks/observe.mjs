#!/usr/bin/env node
// The observer. Two jobs, both cheap enough to run after every file write.
//
// One: catch a broken file within seconds rather than at the end of a turn. Only
// the fast checks, and only on what actually changed, because a PostToolUse hook
// that takes two minutes turns a session into a slideshow.
//
// Two: append one structured line per tool call to a log in the repo, so an
// unattended run leaves a record of what it did. That log is the difference
// between "the routine ran overnight" and "here is what the routine changed".
//
// Never blocks. A file being briefly wrong mid-edit is normal, and the Stop gate
// is where wrongness becomes a refusal to finish. This only tells.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { repoRoot } from "./gates.mjs";

const root = repoRoot(process.cwd());
const logPath = join(root, ".claude", "observer.log");

function readStdin() {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

function record(line) {
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${JSON.stringify(line)}\n`);
  } catch { /* the log is a courtesy */ }
}

/** The em dash rule, checked on the file that just changed rather than the tree. */
export function houseStyleFaults(source) {
  const faults = [];
  const lines = source.split("\n");
  lines.forEach((line, index) => {
    if (/[—–―]/.test(line) && !/\\u201[45]|\\u2013/.test(line)) {
      faults.push(`line ${index + 1}: em or en dash in source, which the house style forbids`);
    }
  });
  return faults;
}

/** The fast checks, chosen so the whole hook stays under a couple of seconds. */
export function fastChecks(filePath, source) {
  const faults = [];
  if (/\.(ts|tsx)$/.test(filePath)) faults.push(...houseStyleFaults(source));
  if (/\.(ts|tsx|mjs|js|jsx)$/.test(filePath)) {
    if (/^(<<<<<<<|>>>>>>>|=======)$/m.test(source)) faults.push("unresolved merge conflict markers");
  }
  if (/\.json$/.test(filePath)) {
    try { JSON.parse(source); } catch (error) { faults.push(`invalid JSON: ${String(error).slice(0, 200)}`); }
  }
  return faults;
}

function main() {
  const input = (() => {
    try { return JSON.parse(readStdin() || "{}"); } catch { return {}; }
  })();
  const tool = String(input.tool_name ?? "");
  const filePath = String(input.tool_input?.file_path ?? "");
  const entry = {
    at: new Date().toISOString(),
    session: String(input.session_id ?? "unknown"),
    tool,
    file: filePath ? relative(root, filePath) : "",
  };

  if (!filePath || !/^(Write|Edit|NotebookEdit)$/.test(tool)) {
    record(entry);
    process.exit(0);
  }

  let source = "";
  try { source = readFileSync(filePath, "utf8"); } catch { /* deleted or unreadable */ }
  const faults = source ? fastChecks(filePath, source) : [];

  // Typecheck only the file that changed, and only when tsc is already installed
  // here. Shelling out to `npx tsc` would try to download TypeScript on a machine
  // that does not have it, which turns a two-second check into a hang. A hook
  // that hangs is worse than a hook that does nothing.
  const localTsc = join(root, "node_modules", ".bin", "tsc");
  if (!faults.length && /\.(ts|tsx)$/.test(filePath) && existsSync(localTsc) && existsSync(join(root, "tsconfig.json"))) {
    const result = spawnSync(localTsc, ["--noEmit", "-p", "tsconfig.json"], { cwd: root, encoding: "utf8", timeout: 90_000 });
    if (!result.error && result.status !== 0) {
      const mine = `${result.stdout ?? ""}`.split("\n").filter((line) => line.includes(relative(root, filePath)));
      if (mine.length) faults.push(...mine.slice(0, 6));
    }
  }

  record({ ...entry, faults: faults.length });
  if (!faults.length) process.exit(0);

  // additionalContext, never a block. Mid-edit a file is allowed to be wrong;
  // the Stop gate is where it stops being allowed.
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: `Observer on ${relative(root, filePath)}:\n${faults.map((item) => `- ${item}`).join("\n")}`,
    },
  }));
  process.exit(0);
}

// Only when run as a hook. Importing this module for its helpers must not read
// stdin, or a test that imports it blocks forever waiting for input that is
// never coming, which looks exactly like the agent freezing.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  try { main(); } catch { process.exit(0); }
}
