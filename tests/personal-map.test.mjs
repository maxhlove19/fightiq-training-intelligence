// The personal map is built only from what an athlete has actually logged.
// See goals.md, "The map constraint, in full": no canonical position list,
// no node the athlete has not personally earned, and the edges rather than
// the nodes are the product. These tests are the difference between that
// being a description in a comment and being true of what the code does.

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPersonalMap, layoutPersonalMap, mapCaption, mapForShare, normalisePositionKey,
} from "../lib/personal-map.ts";

test("no sessions makes no map, honestly", () => {
  const map = buildPersonalMap([]);
  assert.deepEqual(map.nodes, []);
  assert.deepEqual(map.edges, []);
  assert.equal(map.sessionCount, 0);
  assert.equal(map.firstSessionAt, null);
  assert.equal(map.lastSessionAt, null);
});

test("a session with no positions logged still counts as a session, with an empty graph", () => {
  const map = buildPersonalMap([{ positions: [], createdAt: "2026-08-01T08:00:00.000Z" }]);
  assert.deepEqual(map.nodes, []);
  assert.deepEqual(map.edges, []);
  assert.equal(map.sessionCount, 1);
  assert.equal(map.firstSessionAt, "2026-08-01T08:00:00.000Z");
  assert.equal(map.lastSessionAt, "2026-08-01T08:00:00.000Z");
});

test("one session, one position: a node, and no edge is possible from a single position", () => {
  const map = buildPersonalMap([{ positions: ["half guard"], createdAt: "2026-08-01T08:00:00.000Z" }]);
  assert.deepEqual(map.nodes, [{ label: "half guard", count: 1 }]);
  assert.deepEqual(map.edges, []);
});

test("one session, two positions: exactly one edge, counted once", () => {
  const map = buildPersonalMap([{ positions: ["half guard", "back mount"], createdAt: "2026-08-01T08:00:00.000Z" }]);
  assert.equal(map.nodes.length, 2);
  assert.equal(map.edges.length, 1);
  assert.equal(map.edges[0].count, 1);
  assert.deepEqual([map.edges[0].a, map.edges[0].b].sort(), ["back mount", "half guard"]);
});

test("a position repeated within one session's own note counts once for that session", () => {
  const map = buildPersonalMap([{ positions: ["half guard", "Half Guard", "half   guard"], createdAt: "2026-08-01T08:00:00.000Z" }]);
  assert.equal(map.nodes.length, 1);
  assert.equal(map.nodes[0].count, 1);
});

test("two sessions sharing a position: that node's count goes to two", () => {
  const map = buildPersonalMap([
    { positions: ["half guard"], createdAt: "2026-08-01T08:00:00.000Z" },
    { positions: ["half guard"], createdAt: "2026-08-04T08:00:00.000Z" },
  ]);
  assert.equal(map.nodes.length, 1);
  assert.equal(map.nodes[0].count, 2);
  // Still no edge: neither session ever named a second position.
  assert.deepEqual(map.edges, []);
});

test("two sessions naming the same pair: the edge count goes to two", () => {
  const map = buildPersonalMap([
    { positions: ["half guard", "back take"], createdAt: "2026-08-01T08:00:00.000Z" },
    { positions: ["half guard", "back take"], createdAt: "2026-08-04T08:00:00.000Z" },
  ]);
  assert.equal(map.edges.length, 1);
  assert.equal(map.edges[0].count, 2);
});

test("a session with three co-occurring positions forms all three pairs", () => {
  const map = buildPersonalMap([{ positions: ["mount", "back take", "armbar"], createdAt: "2026-08-01T08:00:00.000Z" }]);
  assert.equal(map.nodes.length, 3);
  assert.equal(map.edges.length, 3);
  assert.ok(map.edges.every((edge) => edge.count === 1));
});

test("whitespace and case are normalised, but the athlete's own wording is kept", () => {
  const map = buildPersonalMap([
    { positions: ["Half Guard"], createdAt: "2026-08-01T08:00:00.000Z" },
    { positions: ["  half   guard  "], createdAt: "2026-08-03T08:00:00.000Z" },
  ]);
  assert.equal(map.nodes.length, 1);
  assert.equal(map.nodes[0].count, 2);
  // First occurrence wins, and nothing is title-cased or rewritten.
  assert.equal(map.nodes[0].label, "Half Guard");
});

test("normalisePositionKey collapses spacing and case without touching the label itself", () => {
  assert.equal(normalisePositionKey("  Half   Guard "), "half guard");
});

test("nothing is fabricated beyond what was actually logged", () => {
  const map = buildPersonalMap([
    { positions: ["closed guard"], createdAt: "2026-08-01T08:00:00.000Z" },
    { positions: ["side control"], createdAt: "2026-08-02T08:00:00.000Z" },
  ]);
  // No canonical position, and no position that was never in a session's own
  // note, appears anywhere on the map.
  const labels = map.nodes.map((node) => node.label).sort();
  assert.deepEqual(labels, ["closed guard", "side control"]);
  // Two positions logged on different days never co-occurred, so no edge
  // connects them, however tempting it would be to imply a pattern.
  assert.deepEqual(map.edges, []);
});

test("blank and whitespace-only positions are dropped rather than becoming an empty node", () => {
  const map = buildPersonalMap([{ positions: ["", "   ", "mount"], createdAt: "2026-08-01T08:00:00.000Z" }]);
  assert.equal(map.nodes.length, 1);
  assert.equal(map.nodes[0].label, "mount");
});

test("nodes and edges are ordered by count, busiest first", () => {
  const map = buildPersonalMap([
    { positions: ["mount", "back take"], createdAt: "2026-08-01T08:00:00.000Z" },
    { positions: ["mount", "back take"], createdAt: "2026-08-02T08:00:00.000Z" },
    { positions: ["mount"], createdAt: "2026-08-03T08:00:00.000Z" },
  ]);
  assert.equal(map.nodes[0].label, "mount");
  assert.equal(map.nodes[0].count, 3);
  assert.equal(map.nodes[1].label, "back take");
  assert.equal(map.nodes[1].count, 2);
});

test("the date range spans the earliest and latest session, in whatever order they arrive", () => {
  const map = buildPersonalMap([
    { positions: [], createdAt: "2026-08-05T08:00:00.000Z" },
    { positions: [], createdAt: "2026-08-01T08:00:00.000Z" },
    { positions: [], createdAt: "2026-08-09T08:00:00.000Z" },
  ]);
  assert.equal(map.firstSessionAt, "2026-08-01T08:00:00.000Z");
  assert.equal(map.lastSessionAt, "2026-08-09T08:00:00.000Z");
});

test("mapForShare leaves a small map untouched", () => {
  const map = buildPersonalMap([{ positions: ["mount", "back take"], createdAt: "2026-08-01T08:00:00.000Z" }]);
  const shared = mapForShare(map, 8);
  assert.deepEqual(shared, map);
});

test("mapForShare trims to the busiest positions and drops edges that touch a trimmed one", () => {
  const sessions = [
    { positions: ["mount", "back take"], createdAt: "2026-08-01T08:00:00.000Z" },
    { positions: ["mount", "back take"], createdAt: "2026-08-02T08:00:00.000Z" },
    { positions: ["mount", "quiet corner"], createdAt: "2026-08-03T08:00:00.000Z" },
  ];
  const map = buildPersonalMap(sessions);
  const shared = mapForShare(map, 2);
  assert.deepEqual(shared.nodes.map((node) => node.label), ["mount", "back take"]);
  // The edge to "quiet corner" cannot appear: that node was cut.
  assert.equal(shared.edges.length, 1);
  assert.deepEqual([shared.edges[0].a, shared.edges[0].b].sort(), ["back take", "mount"]);
});

test("an empty map lays out to nothing, not a division by zero", () => {
  const layout = layoutPersonalMap(buildPersonalMap([]));
  assert.deepEqual(layout.nodes, []);
  assert.deepEqual(layout.edges, []);
});

test("a single position is placed in the middle of the frame", () => {
  const map = buildPersonalMap([{ positions: ["mount"], createdAt: "2026-08-01T08:00:00.000Z" }]);
  const layout = layoutPersonalMap(map, { width: 300, height: 300 });
  assert.equal(layout.nodes.length, 1);
  assert.equal(layout.nodes[0].x, 150);
  assert.equal(layout.nodes[0].y, 150);
});

test("edge endpoints match where their two nodes were actually placed", () => {
  const map = buildPersonalMap([{ positions: ["mount", "back take"], createdAt: "2026-08-01T08:00:00.000Z" }]);
  const layout = layoutPersonalMap(map, { width: 300, height: 300 });
  const [nodeA, nodeB] = layout.nodes;
  const edge = layout.edges[0];
  const matchesA = edge.x1 === nodeA.x && edge.y1 === nodeA.y;
  const matchesB = edge.x2 === nodeB.x && edge.y2 === nodeB.y;
  assert.ok(matchesA || (edge.x1 === nodeB.x && edge.y1 === nodeB.y));
  assert.ok(matchesB || (edge.x2 === nodeA.x && edge.y2 === nodeA.y));
});

test("a busier position is drawn larger than a once-logged one", () => {
  const map = buildPersonalMap([
    { positions: ["mount", "guard"], createdAt: "2026-08-01T08:00:00.000Z" },
    { positions: ["mount"], createdAt: "2026-08-02T08:00:00.000Z" },
  ]);
  const layout = layoutPersonalMap(map, { width: 300, height: 300 });
  const mount = layout.nodes.find((node) => node.label === "mount");
  const guard = layout.nodes.find((node) => node.label === "guard");
  assert.ok(mount.radius > guard.radius);
});

test("mapCaption states counts, never an adjective", () => {
  const one = buildPersonalMap([{ positions: ["mount"], createdAt: "2026-08-01T08:00:00.000Z" }]);
  assert.deepEqual(mapCaption(one), { sessions: "1 session logged", range: "1 Aug" });

  const many = buildPersonalMap([
    { positions: ["mount"], createdAt: "2026-08-01T08:00:00.000Z" },
    { positions: ["guard"], createdAt: "2026-08-09T08:00:00.000Z" },
  ]);
  assert.deepEqual(mapCaption(many), { sessions: "2 sessions logged", range: "1 Aug to 9 Aug" });

  const none = buildPersonalMap([]);
  assert.deepEqual(mapCaption(none), { sessions: "0 sessions logged", range: "" });
});
