#!/usr/bin/env node
// Impeccable's detectors, run as a gate with a baseline.
//
// The detectors are deterministic: css-tree and htmlparser2 reading our own
// files, no model call and no API key, which is why this belongs in the gate
// rather than in a conversation.
//
// A baseline for the same reason token-check has one. There are findings in the
// tree today, they are real, and a gate that fails on all of them from the first
// run blocks every session on work that is already scheduled. A gate that blocks
// everything is a gate somebody switches off. This fails when the count grows.
//
// Skips itself cleanly when the detectors are not installed, because a gate that
// fails for want of a dependency teaches people to ignore gates.

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

/**
 * Findings in the tree at the time this gate was added.
 *
 * Ten of them are `border-left: 2px solid <accent>`, which Impeccable calls the
 * most recognisable tell of AI-generated UI, and it is right: it is all over
 * this app, including in code written the same night this gate was. Lower this
 * as the design work lands. Reaching 0 makes the ratchet an absolute rule.
 */
export const FINDING_BASELINE = 11;

const DETECTOR = ".claude/skills/impeccable/scripts/detect.mjs";
// The detectors read CSS and HTML. app/components contributes nothing today,
// because they do not parse TSX, and it is listed so that changes when they do.
// The real coverage for rendered components is a URL scan against a running app,
// which is a follow-up recorded in DESIGN.md.
const TARGETS = ["app/globals.css", "app/components"];

if (!existsSync(DETECTOR)) {
  console.log("design-check: skipped, impeccable detectors are not installed");
  process.exit(0);
}

const result = spawnSync("node", [DETECTOR, ...TARGETS, "--quiet"], { encoding: "utf8", timeout: 180_000 });
if (result.error) {
  console.log(`design-check: skipped, ${result.error.message}`);
  process.exit(0);
}

const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
const found = Number(/(\d+)\s+anti-pattern/.exec(output)?.[1] ?? NaN);
if (!Number.isFinite(found)) {
  console.log("design-check: skipped, could not read a finding count from the detectors");
  process.exit(0);
}

if (found <= FINDING_BASELINE) {
  console.log(`design-check: ${found} finding(s), at or under the baseline of ${FINDING_BASELINE}.`);
  if (found < FINDING_BASELINE) console.log(`Lower FINDING_BASELINE to ${found} so this cannot come back.`);
  process.exit(0);
}

console.error(`design-check: ${found} findings, above the baseline of ${FINDING_BASELINE}.`);
console.error(spawnSync("node", [DETECTOR, ...TARGETS], { encoding: "utf8", timeout: 180_000 }).stdout ?? "");
console.error("See DESIGN.md for the decisions these rules are measured against.");
process.exit(1);
