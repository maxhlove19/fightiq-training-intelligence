// Em dashes are the clearest tell that a machine wrote something. A reader who
// spots one stops reading the sentence and starts reading the tool, and this
// app only works if an athlete believes a coach is talking to them.
//
// So this is a rule with a test, not a preference in somebody's head.

import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (!/node_modules|\.next|dist|\.wrangler/.test(path)) out.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

// public/offline.html is the screen an athlete reads with no signal, and it is
// hand written HTML rather than a component, so it sat outside this scan while
// being one of the few screens somebody reads slowly.
function staticPages() {
  return readdirSync("public").filter((entry) => entry.endsWith(".html")).map((entry) => join("public", entry));
}

/** Lines that a reader could end up seeing, so comments are excluded. */
function readerFacingLines() {
  const found = [];
  for (const file of [...sourceFiles("app"), ...sourceFiles("lib"), ...staticPages()]) {
    readFileSync(file, "utf8").split("\n").forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
      found.push({ file, line: index + 1, text: line });
    });
  }
  return found;
}

test("no em dash or en dash reaches a reader", () => {
  const offenders = readerFacingLines()
    .filter((entry) => /[—–]/.test(entry.text))
    .map((entry) => `${entry.file}:${entry.line}  ${entry.text.trim().slice(0, 110)}`);
  assert.deepEqual(offenders, [], `dashes found in copy:\n  ${offenders.join("\n  ")}`);
});

test("the model is told the same rule, in every prompt that writes prose", () => {
  // Copy the app ships is only half of it. Most of what an athlete reads is
  // written by the model at runtime.
  for (const file of ["lib/debrief-ai.ts", "lib/product-ai.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /Never use em dashes/, `${file} does not tell the model to avoid dashes`);
    assert.match(source, /British English/, `${file} does not tell the model to write in British English`);
  }
});

// A small, curated set of words that are American spellings in this codebase
// with no other job: no CSS keyword, no DOM API option, no function or route
// name, no proper noun collides with any of them. A wider list would also flag
// "center" (a CSS class name), "behavior" (a DOM scrollTo option), "analyze"
// (a function and a route path) and "realize" (part of a YouTube channel
// name), so it stays narrow rather than fragile.
const AMERICAN_SPELLING_DENYLIST = /\b(defense|offense|organize[sd]?|organizing|personalize[sd]?|personalizing)\b/i;

test("no reader-facing line uses an American spelling from the denylist", () => {
  const offenders = readerFacingLines()
    .filter((entry) => AMERICAN_SPELLING_DENYLIST.test(entry.text))
    .map((entry) => `${entry.file}:${entry.line}  ${entry.text.trim().slice(0, 110)}`);
  assert.deepEqual(offenders, [], `American spelling found in copy:\n  ${offenders.join("\n  ")}`);
});

// The seven day card used "×" for a discipline count and the focus history and
// lifetime lines used "x", so the same idea carried two different glyphs on
// one screen. Scoped to the screens that render to the DOM: lib/product-ai.ts
// builds the same shape as JSON context for a model call, which nobody reads.
test("a discipline count on screen uses one glyph, not two", () => {
  const offenders = readerFacingLines()
    .filter((entry) => entry.file.startsWith(join("app", "components")))
    .filter((entry) => /\bx\$\{[^}]*\.sessions\}/.test(entry.text))
    .map((entry) => `${entry.file}:${entry.line}  ${entry.text.trim().slice(0, 110)}`);
  assert.deepEqual(offenders, [], `letter "x" used where "×" is the house glyph:\n  ${offenders.join("\n  ")}`);
});
