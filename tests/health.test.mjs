import assert from "node:assert/strict";
import test from "node:test";
import { summariseHealth } from "../lib/health.ts";

const all = (value) => ({ database: value, schema: value, sessionAnalysis: value, photoUploads: value, liveVideoSearch: value });

test("a fully configured deployment is ok", () => {
  const report = summariseHealth(all(true));
  assert.equal(report.status, "ok");
  assert.equal(report.httpStatus, 200);
  assert.deepEqual(report.notes, []);
});

test("no database is down, with a status code a monitor can act on", () => {
  const report = summariseHealth({ ...all(true), database: false, schema: false });
  assert.equal(report.status, "down");
  assert.equal(report.httpStatus, 503);
  assert.ok(report.notes.some((note) => /No D1 binding/.test(note)));
});

test("a bound database with no schema is still down, and says which of the two failed", () => {
  const report = summariseHealth({ ...all(true), schema: false });
  assert.equal(report.status, "down");
  assert.ok(report.notes.some((note) => /schema could not be applied/.test(note)));
  assert.ok(!report.notes.some((note) => /No D1 binding/.test(note)));
});

test("a missing model key is degraded, not down — notes still save", () => {
  const report = summariseHealth({ ...all(true), sessionAnalysis: false });
  assert.equal(report.status, "degraded");
  assert.equal(report.httpStatus, 200);
  assert.ok(report.notes.some((note) => /Sessions still save/.test(note)));
});

test("no YouTube key is a supported way to run, and the note says so", () => {
  const report = summariseHealth({ ...all(true), liveVideoSearch: false });
  assert.equal(report.status, "ok");
  assert.ok(report.notes.some((note) => /curated studies only/.test(note)));
});

test("missing photo storage is called out without taking the app down", () => {
  const report = summariseHealth({ ...all(true), photoUploads: false });
  assert.equal(report.status, "ok");
  assert.ok(report.notes.some((note) => /Meal photos/.test(note)));
});

test("every check is a boolean, so no configuration value can leak", () => {
  const report = summariseHealth(all(false));
  for (const [name, value] of Object.entries(report.checks)) {
    assert.equal(typeof value, "boolean", `${name} should be a boolean`);
  }
  assert.doesNotMatch(JSON.stringify(report), /sk-[A-Za-z0-9]/);
});
