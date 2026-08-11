#!/usr/bin/env node
// A custom property defined twice at :root is a lie with a syntax.
//
// This stylesheet accumulated four separate :root blocks, appended over time
// rather than reconciled, so --blue is declared three times and the last one
// wins. Components read the token correctly and get whatever the bottom of the
// file happened to say. That is how the app ended up rendering pure blue and
// cyan on the same screen at the same time.
//
// --nav-height is the one that should worry a reviewer most: declared three
// times as three different heights, with ten consumers laying out the bottom
// navigation against it. Colour drift looks cheap. Geometry drift moves things.
//
// Trivially detectable, so it is a gate rather than a matter of taste.

import { readFileSync } from "node:fs";

const ALLOW_REDEFINITION = new Set([
  // Nothing yet. Add a name here only with a comment saying which media query
  // or theme legitimately needs its own value, and why one value will not do.
]);

export function rootDeclarations(css) {
  // Only bare `:root {` blocks at the top level. A :root inside a media query is
  // a deliberate override, and this is about the ones that silently stack.
  const blocks = [...css.matchAll(/(^|\n)\s*:root\s*\{([^}]*)\}/g)].map((match) => match[2]);
  const seen = new Map();
  blocks.forEach((body, blockIndex) => {
    for (const declaration of body.split(";")) {
      const match = /^\s*(--[\w-]+)\s*:\s*(.+?)\s*$/.exec(declaration);
      if (!match) continue;
      const [, name, value] = match;
      if (!seen.has(name)) seen.set(name, []);
      seen.get(name).push({ value, block: blockIndex });
    }
  });
  return { blocks: blocks.length, declarations: seen };
}

export function duplicateTokens(css) {
  const { declarations } = rootDeclarations(css);
  return [...declarations.entries()]
    .filter(([name, values]) => values.length > 1 && !ALLOW_REDEFINITION.has(name))
    .map(([name, values]) => ({ name, values: values.map((item) => item.value), count: values.length }));
}

/**
 * A ratchet, not a cliff.
 *
 * The defect already exists: twelve properties are declared more than once
 * today. A gate that simply failed would block every session on a problem that
 * is already scheduled, and a gate that blocks everything gets switched off. So
 * the current count is the baseline and the gate fails only when it grows.
 *
 * Lower this number as the reconciliation lands. It reaching 0 is the goal, and
 * at 0 the ratchet becomes an absolute rule for free.
 */
export const DUPLICATE_BASELINE = 12;

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2] ?? "app/globals.css";
  const css = readFileSync(path, "utf8");
  const { blocks } = rootDeclarations(css);
  const duplicates = duplicateTokens(css);
  if (!duplicates.length) {
    console.log(`token-check: ${blocks} :root block(s), no property defined more than once.`);
    if (DUPLICATE_BASELINE > 0) {
      console.error(`token-check: the reconciliation has landed. Set DUPLICATE_BASELINE to 0 so this can never come back.`);
      process.exit(1);
    }
    process.exit(0);
  }
  if (duplicates.length <= DUPLICATE_BASELINE) {
    console.log(`token-check: ${duplicates.length} duplicated propert(ies) across ${blocks} :root blocks, at or under the baseline of ${DUPLICATE_BASELINE}.`);
    console.log("Known defect, see goals.md. This gate fails if it grows.");
    for (const item of duplicates.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))) {
      console.log(`  ${item.name.padEnd(16)} x${item.count}  ${item.values.join("  then  ")}`);
    }
    process.exit(0);
  }
  console.error(`token-check: ${blocks} competing :root blocks, ${duplicates.length} propert(ies) defined more than once, above the baseline of ${DUPLICATE_BASELINE}.`);
  console.error("Components read these tokens and get whichever declaration is last in the file.\n");
  for (const item of duplicates.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))) {
    console.error(`  ${item.name.padEnd(16)} x${item.count}  ${item.values.join("  then  ")}`);
  }
  console.error("\nCollapse them into one :root. See goals.md, known defects.");
  process.exit(1);
}
