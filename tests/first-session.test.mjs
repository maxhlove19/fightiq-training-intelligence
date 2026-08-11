// Day one is the whole business. An athlete has just spent six screens telling
// this app what they train, and the screen they land on decides whether they
// ever come back. These tests hold the properties that make it worth landing on.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { FIRST_WEEK_CARDS, firstWeekPlan, isPlaceholderMemory, openingBrief, openingGreeting, unlockCards } from "../lib/first-session.ts";

const brief = (over = {}) => openingBrief({ disciplines: ["Muay Thai"], experienceLevel: "Building fundamentals", ...over });

test("the brief names the sport they actually train", () => {
  // A Muay Thai athlete reading about guard retention learns one thing: this app
  // was not built for them.
  assert.match(brief({ disciplines: ["Muay Thai"] }).title, /Muay Thai/);
  assert.match(brief({ disciplines: ["BJJ"] }).body.toLowerCase(), /frame/);
  assert.match(brief({ disciplines: ["Boxing"] }).body.toLowerCase(), /punch|combination/);
  assert.match(brief({ disciplines: ["Wrestling"] }).body.toLowerCase(), /shot|level change|entr/);
  assert.match(brief({ disciplines: ["Judo"] }).body.toLowerCase(), /grip/);
});

test("a beginner and a competitor are not given the same note", () => {
  for (const discipline of ["Muay Thai", "Boxing", "BJJ", "Wrestling", "Judo", "MMA"]) {
    const new_ = brief({ disciplines: [discipline], experienceLevel: "New to martial arts" });
    const competitor = brief({ disciplines: [discipline], experienceLevel: "Experienced competitor" });
    assert.notEqual(new_.title, competitor.title, `${discipline} pitches a beginner and a competitor the same`);
    assert.notEqual(new_.watchFor, competitor.watchFor, `${discipline} asks them both the same question`);
  }
  // "Advanced / coaching" is not a beginner either.
  assert.equal(
    brief({ disciplines: ["Boxing"], experienceLevel: "Advanced / coaching" }).title,
    brief({ disciplines: ["Boxing"], experienceLevel: "Experienced competitor" }).title,
  );
});

test("what they typed during setup outranks anything FightIQ would have said", () => {
  const stated = brief({ currentFocus: "Sharper boxing entries" });
  assert.match(stated.title, /sharper boxing entries/i);
  assert.ok(stated.cue.length > 3, "a stated focus still gets a cue for the gym");
  // Ignoring what somebody just typed is the clearest possible sign nobody read it.
  assert.notEqual(stated.title, brief().title);
});

test("a typed focus too short to mean anything falls back rather than echoing it", () => {
  assert.equal(brief({ currentFocus: "hi" }).title, brief().title);
  assert.equal(brief({ currentFocus: "   " }).title, brief().title);
  assert.equal(brief({ currentFocus: null }).title, brief().title);
});

test("every brief admits it is a hypothesis, not a read on their game", () => {
  // FightIQ has seen nothing. Claiming otherwise on day one is the fastest way
  // to be caught out on day two.
  for (const discipline of ["Muay Thai", "Boxing", "BJJ", "Wrestling", "Judo", "MMA", "Something else"]) {
    for (const level of ["New to martial arts", "Experienced competitor"]) {
      const result = brief({ disciplines: [discipline], experienceLevel: level });
      assert.match(result.promise, /not a read on you|nothing from your training/i, `${discipline}/${level} claims to know them`);
    }
  }
});

test("every brief ends in one answerable question", () => {
  for (const discipline of ["Muay Thai", "Boxing", "BJJ", "Wrestling", "Judo", "MMA", "Krav Maga"]) {
    const result = brief({ disciplines: [discipline] });
    assert.match(result.watchFor, /\?$/, `${discipline} gives them nothing to answer`);
    assert.ok(result.watchFor.length < 120, `${discipline} asks a question nobody remembers through a round`);
  }
});

test("a sport nobody planned for still gets something usable", () => {
  const result = brief({ disciplines: ["Sambo"] });
  assert.ok(result.title && result.body && result.watchFor);
  assert.doesNotMatch(result.body, /log (more|training)|come back/i, "the fallback is an empty state in disguise");
});

test("no brief tells a new athlete the app cannot help yet", () => {
  for (const discipline of ["Muay Thai", "Boxing", "BJJ", "Wrestling", "Judo", "MMA", "Other"]) {
    const result = brief({ disciplines: [discipline] });
    const all = `${result.title} ${result.body} ${result.watchFor}`;
    assert.doesNotMatch(all, /build your baseline|not enough|need more|once you have logged/i, `${discipline} stalls instead of coaching`);
  }
});

test("the greeting stops claiming a history that does not exist", () => {
  // "Let's keep building your game" to somebody who has built nothing here is
  // the first sentence they read, and it is false.
  assert.doesNotMatch(openingGreeting(0), /keep building/i);
  assert.doesNotMatch(openingGreeting(1), /keep building/i);
  assert.notEqual(openingGreeting(0), openingGreeting(1));
  assert.match(openingGreeting(9), /keep building/i);
});

test("every brief carries a mission somebody could go and do", () => {
  // The card, the rail into the gym and the brief behind it are built from this
  // one string. It has to work as an instruction, not just as a headline.
  for (const discipline of ["Muay Thai", "Boxing", "BJJ", "Wrestling", "Judo", "MMA", "Other"]) {
    const result = brief({ disciplines: [discipline] });
    assert.ok(result.mission.length > 10, `${discipline} has no mission`);
    assert.doesNotMatch(result.mission, /[.?]$/, `${discipline} wrote a sentence where a mission goes`);
    assert.ok(result.cue.length > 3, `${discipline} reaches the gym with no cue`);
  }
});

test("the empty cards say what the rule is, not that nothing is there", () => {
  // Five cards reporting an absence is what makes an app feel thin. The
  // evidence rules behind them are real, so they are stated.
  for (const text of Object.values(FIRST_WEEK_CARDS)) {
    assert.doesNotMatch(text, /^no |nothing yet|not enough|log (a few|more)/i);
    // They sit in a card that clips. Accurate and cut off reads worse than short.
    assert.ok(text.length <= 66, `too long for the card it sits in: ${text}`);
  }
});

test("the plan puts a date on what the next sessions unlock", () => {
  const plan = firstWeekPlan(3);
  assert.equal(plan.length, 3);
  assert.match(plan[1].after, /this week/);
  assert.match(plan[2].after, /two weeks/);
  // Somebody training once a week is not told they will have a review this week.
  assert.match(firstWeekPlan(1)[1].after, /two weeks|a month/);
  assert.match(firstWeekPlan(6)[2].after, /this week/);
  // A missing or absurd setup value must not produce "in about NaN weeks".
  for (const perWeek of [0, -2, 99, Number.NaN]) {
    for (const step of firstWeekPlan(perWeek)) assert.doesNotMatch(step.after, /NaN|Infinity/);
  }
});

test("the house style survives here too", () => {
  const source = readFileSync("lib/first-session.ts", "utf8");
  const offenders = source.split("\n").filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*") && /[—–]/.test(line));
  assert.deepEqual(offenders, [], "dashes reached the copy an athlete reads first");
});

test("an empty card counts down instead of reporting a blank", () => {
  // "Still learning your strongest areas" tells an athlete nothing is there.
  // A countdown is the same fact and makes the wait feel like the product
  // working rather than the product empty.
  assert.match(unlockCards(0).strengths, /Three more sessions/);
  assert.match(unlockCards(1).strengths, /Two more sessions/);
  assert.match(unlockCards(2).strengths, /One more session/);
  assert.match(unlockCards(1).problems, /One more session/);
  for (const text of Object.values(unlockCards(1))) assert.doesNotMatch(text, /NaN|undefined/);
});

test("once the count is met, an empty card is a finding rather than a delay", () => {
  // Eleven sessions and still nothing confirmed does not mean "two more
  // sessions". It means nothing has repeated, which is worth saying plainly.
  const settled = unlockCards(11);
  assert.doesNotMatch(settled.strengths, /more session/);
  assert.doesNotMatch(settled.problems, /more session/);
  assert.match(settled.strengths, /three sessions running/);
});

test("the app's own placeholders are recognised wherever they appear", () => {
  // These decide whether a card has content, so a missed one puts a placeholder
  // on screen next to real findings.
  for (const placeholder of [
    "Still learning your strongest areas",
    "No recurring problem confirmed yet",
    "Log a few completed sessions and FightIQ will identify improvement.",
    "FightIQ needs another completed debrief to confirm a distinct improvement.",
  ]) assert.equal(isPlaceholderMemory(placeholder), true, placeholder);
  for (const real of ["Support foot turns late", "Guard retention under pressure", ""]) {
    assert.equal(isPlaceholderMemory(real), false, real);
  }
});
