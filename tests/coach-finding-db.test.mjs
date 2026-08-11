// A finding written durably shapes every week after it, and the athlete has no
// reason to doubt it. So the rules about what can be written, by whom, and what
// can be taken back are tested against a real database rather than reasoned about.

import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { applySchema } from "../lib/debrief-db.ts";
import { getConfirmedFindings } from "../lib/product-db.ts";

function d1(db) {
  const bind = (args) => args.map((value) => (value === undefined ? null : value));
  const prepare = (sql) => {
    const base = { sql, args: [] };
    base.bind = (...args) => ({ ...base, bind: base.bind, args: bind(args), run: base.run, first: base.first, all: base.all });
    base.run = async function run() { const r = db.prepare(this.sql ?? sql).run(...(this.args ?? [])); return { success: true, meta: { changes: r.changes } }; };
    base.first = async function first() { return db.prepare(this.sql ?? sql).get(...(this.args ?? [])) ?? null; };
    base.all = async function all() { return { results: db.prepare(this.sql ?? sql).all(...(this.args ?? [])) }; };
    return base;
  };
  return { prepare, batch: async (statements) => { for (const statement of statements) await statement.run(); } };
}

async function withFinding(status = "proposed", ownerId = "owner") {
  const db = d1(new DatabaseSync(":memory:"));
  await applySchema(db);
  await db.prepare(`INSERT INTO coach_findings (id, owner_id, chat_id, assistant_message_id, problem, because, fix, basis_json, stated_confidence, status, canonical_key, created_at, decided_at)
    VALUES ('f1', ?, 'c1', 'm1', 'Your grip peels off', 'The elbow drifts off your ribs.', 'Pin the elbow on the first grip.', '["you said it peels"]', 'likely', ?, 'grip-off-peel', '2026-08-11T00:00:00Z', ?)`)
    .bind(ownerId, status, status === "proposed" ? null : "2026-08-11T01:00:00Z").run();
  return db;
}

/** The route's rule, kept in one place so the test exercises the real statement shape. */
async function decide(db, { ownerId = "owner", messageId = "m1", verdict }) {
  const allowedFrom = verdict === "confirmed" ? ["proposed"] : ["proposed", "confirmed"];
  const result = await db.prepare(
    `UPDATE coach_findings SET status = ?, decided_at = ?
     WHERE assistant_message_id = ? AND owner_id = ? AND status IN (${allowedFrom.map(() => "?").join(", ")})`
  ).bind(verdict, "2026-08-11T02:00:00Z", messageId, ownerId, ...allowedFrom).run();
  return result.meta.changes;
}

test("a proposed finding is not in My Game until the athlete says so", async () => {
  // This is the whole safety property. The model proposing something must never
  // be enough to put it in front of them as agreed.
  const db = await withFinding("proposed");
  assert.deepEqual(await getConfirmedFindings(db, "owner"), []);
});

test("confirming puts it in My Game with its evidence attached", async () => {
  const db = await withFinding("proposed");
  assert.equal(await decide(db, { verdict: "confirmed" }), 1);
  const [finding] = await getConfirmedFindings(db, "owner");
  assert.equal(finding.problem, "Your grip peels off");
  assert.equal(finding.fix, "Pin the elbow on the first grip.");
  assert.deepEqual(finding.basis, ["you said it peels"]);
  assert.equal(finding.confidence, "likely");
});

test("saying it is wrong keeps it out, and it cannot be confirmed afterwards", async () => {
  const db = await withFinding("proposed");
  assert.equal(await decide(db, { verdict: "rejected" }), 1);
  assert.deepEqual(await getConfirmedFindings(db, "owner"), []);
  // A rejected finding is settled. Nothing may quietly resurrect it.
  assert.equal(await decide(db, { verdict: "confirmed" }), 0);
  assert.deepEqual(await getConfirmedFindings(db, "owner"), []);
});

test("a confirmed finding can be taken back later", async () => {
  // Finding out you were wrong is a normal part of training, and a record that
  // cannot be corrected stops being trusted for everything else.
  const db = await withFinding("confirmed");
  assert.equal((await getConfirmedFindings(db, "owner")).length, 1);
  assert.equal(await decide(db, { verdict: "rejected" }), 1);
  assert.deepEqual(await getConfirmedFindings(db, "owner"), []);
});

test("a replayed tap cannot flip a verdict already given", async () => {
  const db = await withFinding("proposed");
  assert.equal(await decide(db, { verdict: "confirmed" }), 1);
  assert.equal(await decide(db, { verdict: "confirmed" }), 0, "confirming twice must change nothing");
});

test("somebody else's finding is untouchable and reports the same as a missing one", async () => {
  const db = await withFinding("proposed", "someone-else");
  assert.equal(await decide(db, { ownerId: "owner", verdict: "confirmed" }), 0);
  assert.deepEqual(await getConfirmedFindings(db, "owner"), []);
  assert.deepEqual(await getConfirmedFindings(db, "someone-else"), []);
});

test("only this athlete's confirmed findings come back", async () => {
  const db = await withFinding("confirmed", "owner");
  await db.prepare(`INSERT INTO coach_findings (id, owner_id, chat_id, assistant_message_id, problem, because, fix, basis_json, stated_confidence, status, canonical_key, created_at, decided_at)
    VALUES ('f2', 'someone-else', 'c9', 'm9', 'Their problem', 'Their mechanism.', 'Their fix.', '[]', 'likely', 'confirmed', 'k', '2026-08-11T00:00:00Z', '2026-08-11T01:00:00Z')`).run();
  const mine = await getConfirmedFindings(db, "owner");
  assert.equal(mine.length, 1);
  assert.equal(mine[0].problem, "Your grip peels off");
});
