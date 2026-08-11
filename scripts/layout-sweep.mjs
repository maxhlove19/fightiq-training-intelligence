#!/usr/bin/env node
// Faults that no unit test can see, measured in a real browser.
//
// This exists because two of the worst bugs this codebase has shipped were
// invisible to every test that passed: a composer pinned to the bottom of a
// 290px box while holding 5867px of conversation, and a mic and send button that
// escaped the phone frame entirely and rendered 200px outside it. Both looked
// fine on a phone. Both were obvious the moment anything measured a bounding box.
//
// It also counts distinct saturated colours per screen, because "this looks
// cheap" is otherwise a matter of taste and therefore unarguable. Nine blues that
// differ by two points is not taste, it is a number.
//
// Skips itself cleanly when Playwright or a browser is missing, because a gate
// that fails for want of a binary teaches people to ignore gates.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CSS_DIR = "dist/client/_next/static/css";
const BROWSER = "/opt/pw-browsers/chromium";

function skip(reason) {
  console.log(`layout-sweep: skipped, ${reason}`);
  process.exit(0);
}

function compiledCss() {
  if (!existsSync(CSS_DIR)) return null;
  const file = readdirSync(CSS_DIR).find((name) => name.endsWith(".css"));
  return file ? readFileSync(join(CSS_DIR, file), "utf8") : null;
}

const css = compiledCss();
if (!css) skip("no compiled stylesheet, run npm run build first");

let chromium;
try { ({ chromium } = await import("playwright")); } catch { skip("playwright is not installed"); }
if (!existsSync(BROWSER)) skip("no chromium binary at the expected path");

/** Representative markup per screen, using the app's own class names. */
const SCREENS = {
  home: `<main class="page home-page native-page">
    <header class="app-header home-header"><div><p class="wordmark">FIGHT<span>IQ</span></p></div>
      <div class="home-header-tools"><button class="home-focus-meter"><span>4/5</span><small>FOCUS</small></button></div></header>
    <section class="home-reference-insight"><div class="home-insight-copy"><p class="eyebrow">FIGHTIQ INSIGHT</p>
      <h2>The ankle lock worked.</h2><p class="home-insight-body">You kept finding the position.</p>
      <p class="home-insight-from">From Sunday night, BJJ</p></div><div class="home-insight-media"></div></section>
    <button class="home-brief-rail"><span>TRAIN NEXT</span><strong>Turn the support foot before the shin arrives</strong><em>START BRIEF</em></button>
  </main>`,
  coach: `<main class="page product-page native-page coach-page">
    <header class="page-header coach-header"><div><p class="question-progress">YOUR COACH</p><h1 class="page-title">Ask FightIQ</h1></div></header>
    <section class="coach-thread">
      <div class="chat-message user"><span>YOU</span><div class="chat-bubble"><p>What should I drill?</p></div></div>
      <div class="chat-message assistant"><span>FIGHTIQ</span><div class="chat-bubble"><p>Turn the support foot first.</p></div>
        <section class="coach-follow-up"><p>Which side broke down?</p><span>CHOOSE THE CLOSEST ANSWER</span>
          <div class="coach-quick-replies"><button>The left</button><button>The right</button><button class="not-sure">Not sure</button></div></section></div>
    </section>
    <div class="coach-compose"><textarea aria-label="Ask FightIQ"></textarea><button class="answer-mic">m</button><button class="compose-send">s</button></div>
  </main>`,
  game: `<main class="page product-page native-page game-page">
    <header class="page-header"><div><p class="question-progress">YOUR FIGHTER BRAIN</p><h1 class="page-title">My Game</h1></div></header>
    <section class="game-hero"><div><p class="eyebrow">CURRENT FOCUS</p><h2>Win the grip first</h2><p>Because the grip decides the exchange.</p></div></section>
    <div class="game-cards"><section class="game-card"><span>STRENGTHS</span><strong>Arm drags</strong></section>
      <section class="game-card problem"><span>RECURRING PROBLEMS</span><strong>Head position</strong></section></div>
    <section class="build-next"><div><span>NEXT EVOLUTION</span><h3>Build ankle locks</h3></div></section>
  </main>`,
  learn: `<main class="page product-page native-page learn-page">
    <header class="page-header"><div><p class="question-progress">STUDY</p><h1 class="page-title">Learn</h1></div></header>
    <article class="learn-video"><div class="real-video-thumb"></div><div class="video-copy"><h3>Support foot mechanics</h3>
      <p class="watch-for"><b>Watch for</b> the foot turning before the hip.</p>
      <details class="why-detail"><summary>Why this</summary><p>Your latest session mentioned the support foot.</p></details></div></article>
  </main>`,
};

const browser = await chromium.launch({ executablePath: BROWSER });
const failures = [];
const census = {};

for (const [name, markup] of Object.entries(SCREENS)) {
  const page = await browser.newPage({ viewport: { width: 1058, height: 900 } });
  await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body>
    <div class="app-frame">${markup}<nav class="bottom-nav"><button class="nav-button">HOME</button></nav></div>
  </body></html>`, { waitUntil: "load" });

  const result = await page.evaluate(() => {
    const frame = document.querySelector(".app-frame").getBoundingClientRect();
    const escapees = [];
    const saturated = new Map();
    // Scoped inside the frame: html and body are the page the frame sits on, not
    // content that has escaped it.
    for (const element of document.querySelectorAll(".app-frame, .app-frame *")) {
      const box = element.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) continue;
      // Horizontal escape from the phone frame. Vertical overflow is normal.
      if (box.left < frame.left - 1 || box.right > frame.right + 1) {
        escapees.push(`${element.tagName.toLowerCase()}.${String(element.className || "").split(" ")[0]} at x ${Math.round(box.left)}..${Math.round(box.right)} outside ${Math.round(frame.left)}..${Math.round(frame.right)}`);
      }
      const style = getComputedStyle(element);
      for (const property of ["color", "backgroundColor", "borderTopColor", "borderLeftColor"]) {
        const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(style[property] ?? "");
        if (!match) continue;
        const [r, g, b, a] = [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])];
        if (a < 0.35) continue;
        // Saturated means it is a chosen colour rather than a grey.
        if (Math.max(r, g, b) - Math.min(r, g, b) < 40) continue;
        saturated.set(`${r},${g},${b}`, (saturated.get(`${r},${g},${b}`) ?? 0) + 1);
      }
    }
    return { escapees, saturated: [...saturated.entries()].sort((a, b) => b[1] - a[1]) };
  });

  census[name] = result.saturated;
  if (result.escapees.length) failures.push(`${name}: ${result.escapees.length} element(s) outside the app frame\n    ${result.escapees.join("\n    ")}`);
  await page.close();
}
await browser.close();

console.log("layout-sweep: distinct saturated colours per screen");
for (const [name, colours] of Object.entries(census)) {
  console.log(`  ${name.padEnd(6)} ${String(colours.length).padStart(3)}  ${colours.slice(0, 6).map(([rgb, n]) => `rgb(${rgb})x${n}`).join(" ")}`);
}
const union = new Set(Object.values(census).flat().map(([rgb]) => rgb));
console.log(`  union  ${union.size}`);

if (failures.length) {
  console.error(`\nlayout-sweep FAILED\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("layout-sweep: nothing escaped the app frame.");
