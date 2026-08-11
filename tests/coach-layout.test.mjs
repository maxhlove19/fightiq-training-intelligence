// Coach was the worst screen in the app and every fault was structural rather
// than cosmetic, so the guards are structural too.
//
// Measured in the live DOM before the fix: the thread computed to 290.5px tall
// while holding 5867px of conversation with overflow visible, so the composer
// was laid out after a 290px box and floated in the middle of the screen. The
// page opened at scrollTop 0 of a possible 5411, which put the newest question
// five thousand pixels below the fold and showed a returning athlete four of
// their own questions in a row with no answers between them.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const screens = readFileSync(new URL("../app/components/ProductScreens.tsx", import.meta.url), "utf8");

function rulesFor(selector) {
  const found = [];
  const pattern = new RegExp(`(^|[},])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "g");
  for (const match of css.matchAll(pattern)) found.push(match[2]);
  return found;
}

test("the thread is the scroll container, not the page", () => {
  const threadRules = rulesFor(".coach-thread");
  assert.ok(threadRules.length > 0, "expected .coach-thread to be styled");
  assert.ok(
    threadRules.some((body) => /overflow-y:\s*auto/.test(body)),
    "the thread must scroll itself, or its content paints outside its box",
  );
  // flex-basis 0 is what sized it to one viewport instead of its content.
  assert.ok(
    !threadRules.some((body) => /flex:\s*1\s*;/.test(body)),
    "`flex: 1` means basis zero, which is the bug this replaced",
  );
  assert.ok(
    threadRules.some((body) => /min-height:\s*0/.test(body)),
    "a flex child needs min-height 0 before it will ever scroll",
  );
});

test("the composer is laid out, not stuck", () => {
  // Sticky was pinning it to the bottom of the thread's wrong box rather than to
  // the viewport. Bumping z-index would have hidden that without fixing it.
  for (const body of rulesFor(".coach-compose")) {
    assert.ok(!/position:\s*sticky/.test(body), "the composer must not rely on sticky");
  }
});

test("a coaching answer is never clamped", () => {
  // Five lines, overflow hidden, and no expand control anywhere in the bubble.
  // Two to three lines of the answer the athlete came for were unreadable, and
  // one of them stopped mid-word.
  assert.ok(
    !/\.chat-message\.assistant[^{]*\.chat-bubble[^{]*\{[^}]*line-clamp/.test(css),
    "assistant answers must not be line-clamped",
  );
});

test("the thread opens at the newest message, without animating there", () => {
  assert.match(screens, /thread\.scrollTo\(\{\s*top:\s*thread\.scrollHeight/);
  // The first positioning of a loaded conversation must not animate, or it reads
  // as a jump. Later arrivals should animate, because then the movement means
  // something turned up.
  assert.match(screens, /behavior:\s*settled\.current\s*\?\s*"smooth"\s*:\s*"auto"/);
  // Before paint, so there is never a frame showing the top of the thread.
  assert.match(screens, /useIsomorphicLayoutEffect\(\(\) => \{[\s\S]{0,400}scrollTo/);
});
