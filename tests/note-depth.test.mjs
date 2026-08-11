// Most people write four words. The app has to be worth paying for anyway.

import assert from "node:assert/strict";
import test from "node:test";
import { depthBriefing, readNoteDepth } from "../lib/note-depth.ts";

const depth = (note) => readNoteDepth(note).depth;

test("the notes real people actually write are read as thin, not as failures", () => {
  for (const note of ["bjj", "mt class", "trained legs today", "muay thai, tired", "sparring", "class tonight"]) {
    assert.ok(["empty", "thin"].includes(depth(note)), `${note} -> ${depth(note)}`);
  }
});

test("a short note carrying a coach cue is not thin, it is the most valuable kind", () => {
  // Seven words worth more than sixty about the drive home.
  const reading = readNoteDepth("Coach said my support foot is late");
  assert.notEqual(reading.depth, "thin");
  assert.equal(reading.signals.coachCue, true);
  assert.equal(reading.signals.technique, true);
});

test("a full session note is read as rich and does not get interrogated", () => {
  const note = "Muay Thai class. Worked switch kicks on the pads. Coach said my support foot is not turning so the kick lands flat. Sparred three rounds light and kept getting teeped because I stand too square.";
  const reading = readNoteDepth(note);
  assert.equal(reading.depth, "rich");
  assert.match(reading.guidance, /Do not ask for more/);
});

test("a long note about nothing is still thin", () => {
  const reading = readNoteDepth("Went to the gym tonight after work, traffic was terrible, parked round the back, saw a few of the usual people there and then drove home again");
  assert.equal(reading.depth, "thin");
});

test("nothing at all is handled without inventing a session", () => {
  for (const note of ["", "   ", undefined]) {
    const reading = readNoteDepth(note);
    assert.equal(reading.depth, "empty");
    assert.match(reading.guidance, /Do not invent a session/);
  }
});

test("one word is a session, not an empty note", () => {
  // "bjj" is the shortest thing a real person writes, and it still deserves an answer.
  for (const note of ["bjj", "ok", "mt"]) {
    assert.equal(readNoteDepth(note).depth, "thin", note);
  }
});

test("thin notes are told to spend the question, not the summary", () => {
  const guidance = readNoteDepth("bjj tired").guidance;
  assert.match(guidance, /Do not summarise it back/);
  assert.match(guidance, /tappable choices/);
  assert.match(guidance, /Do not invent detail/);
  // The tone matters. A coach who makes you feel bad for a short note gets no more notes.
  assert.match(guidance, /that is normal/);
  assert.doesNotMatch(guidance, /should have written|lazy|effort/i);
});

test("what is missing is listed in the order a coach would want it", () => {
  const reading = readNoteDepth("bjj");
  assert.equal(reading.missing[0], "what actually broke down");
  assert.ok(reading.missing.includes("anything the coach said"));
});

test("the briefing names the depth, the gaps, and what to do", () => {
  const briefing = depthBriefing(readNoteDepth("muay thai, tired"));
  assert.match(briefing, /NOTE DEPTH: thin/);
  assert.match(briefing, /The note does not say/);
  assert.match(briefing, /tappable choices/);
});

test("a rich note's briefing does not ask for more", () => {
  const briefing = depthBriefing(readNoteDepth("Muay Thai pads. Coach said the support foot is late on the switch kick so it lands flat. Drilled it fifty times and it got better by the end."));
  assert.doesNotMatch(briefing, /The note does not say: what actually broke down/);
});
