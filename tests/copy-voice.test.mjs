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

/** Lines that a reader could end up seeing, so comments are excluded. */
function readerFacingLines() {
  const found = [];
  for (const file of [...sourceFiles("app"), ...sourceFiles("lib")]) {
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
  }
});
