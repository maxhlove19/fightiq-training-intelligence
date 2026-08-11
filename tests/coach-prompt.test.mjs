// A prompt is the most load-bearing text in this app and the easiest thing to
// quietly water down. These are the properties that make the coach worth paying
// for, asserted so they cannot be edited away by accident.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const debrief = readFileSync("lib/debrief-ai.ts", "utf8");
const coach = readFileSync("lib/product-ai.ts", "utf8");
const both = [["the debrief", debrief], ["Coach", coach]];

test("both prompts diagnose causes rather than repeat symptoms", () => {
  for (const [name, source] of both) {
    assert.match(source, /[Ss]ymptoms are not causes/, `${name} does not separate symptom from cause`);
    assert.match(source, /mechanics|timing|position|physical/, `${name} gives no way to classify a problem`);
  }
});

test("both prompts give one correction, not a list", () => {
  for (const [name, source] of both) {
    assert.match(source, /A list is the same as nothing/, `${name} does not limit itself to one thing`);
  }
});

test("both prompts pitch to the athlete's level", () => {
  for (const [name, source] of both) {
    assert.match(source, /building fundamentals/i, `${name} treats a beginner and a competitor the same`);
  }
});

test("what the athlete's own coach said outranks the model", () => {
  for (const [name, source] of both) {
    assert.match(source, /coach (said|told them|instructor)|their coach/i, `${name} ignores the real coach`);
    assert.match(source, /never (quietly )?replace|never contradict/i, `${name} may overwrite a real coach's instruction`);
  }
});

test("both prompts handle the athlete who writes four words", () => {
  for (const [name, source] of both) {
    assert.match(source, /four words/, `${name} assumes a careful diary`);
    assert.match(source, /normal case, not a failure|not a failure, and this app/, `${name} treats a short note as a fault`);
    assert.match(source, /tappable choices/, `${name} makes answering cost more than a thumb press`);
  }
  assert.match(coach, /[Nn]ever tell them to log more/, "Coach nags the athlete for more input");
  assert.match(debrief, /[Nn]ever imply the note was too short/, "the debrief shames a short note");
});

test("day one is a different job, not a smaller one", () => {
  // An athlete on their first session is the whole business. They have nothing
  // logged, and the app has to be worth keeping anyway.
  for (const [name, source] of both) {
    assert.match(source, /sessions_logged/, `${name} cannot tell a first session from a hundredth`);
    assert.match(source, /never refer to sessions that (do not exist|are not in front of you)/, `${name} may invent a history it never saw`);
    assert.match(source, /needs? more data|need more data/i, `${name} does not rule out stalling for more data`);
  }
});

test("a vague question still gets a specific answer", () => {
  assert.match(coach, /Vague question, specific answer/);
  assert.match(coach, /Lean on their history/);
});

test("confidence stays honest, so one session is never a weakness", () => {
  assert.match(debrief, /One session is an observation/);
  assert.match(debrief, /[Nn]ever turn a single observation into a confirmed weakness/);
});

test("both prompts carry the house style", () => {
  for (const [name, source] of both) {
    assert.match(source, /Never use em dashes/, `${name} will write dashes`);
    assert.match(source, /the key is|keep it simple/, `${name} does not ban stock coaching filler`);
  }
});

test("both prompts hold a length, because this model writes long by default", () => {
  for (const [name, source] of both) {
    assert.match(source, /Length is a hard rule, not a preference/, `${name} lets the model decide how long to be`);
    assert.match(source, /fewest words, and stop/, `${name} has no stopping rule`);
  }
});

test("both prompts stay inside the thing they were asked about", () => {
  assert.match(debrief, /Stay inside the session you were given/, "the debrief may wander into their whole training history");
  assert.match(coach, /Answer what they asked and nothing else/, "Coach may answer a question nobody asked");
});

test("the depth reading is actually sent, not just described", () => {
  for (const [name, source] of both) {
    assert.match(source, /depthBriefing\(readNoteDepth\(/, `${name} never tells the model how thin the input was`);
  }
});

test("safety survives the rewrite in both prompts", () => {
  for (const [name, source] of both) {
    assert.match(source, /[Dd]o not diagnose injuries/, `${name} lost the injury rule`);
    assert.match(source, /weight cut/i, `${name} lost the weight cutting rule`);
    assert.match(source, /qualified professional/i, `${name} no longer points at a human`);
  }
});
