// The build has to hand Cloudflare exactly one of each binding.
//
// This exists because it did not. `.openai/hosting.json` declares "d1": "DB"
// and "r2": "UPLOADS", vite.config.ts turned those into placeholder bindings,
// and wrangler.jsonc declares the real ones under the same two names. The
// generated dist/server/wrangler.json ended up with both, placeholder first:
//
//   d1_databases: [
//     { binding: "DB", database_name: "site-creator-d1", database_id: "0000…" },
//     { binding: "DB", database_name: "fightiq",         database_id: "<real>" },
//   ]
//
// `wrangler deploy` refuses that with "DB assigned to multiple D1 Database
// bindings", which is the good outcome and the only reason it was found. Had
// the merge been first-wins instead, the deploy would have succeeded and the
// app would have written every session to an all-zeros database that is not
// anybody's. That is the failure this file is here to prevent coming back.
//
// It reads the build output rather than the config, because the config is not
// the artefact: `@vinext/cloudflare deploy` runs its own build and regenerates
// dist/server/wrangler.json, so editing that file by hand changes nothing and
// only the generated result is worth asserting on.

import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const generated = `${root}dist/server/wrangler.json`;
const hostingArtefact = `${root}dist/.openai/hosting.json`;

// `npm test` builds before it runs tests, so this is present in the gate. A
// single test file run by hand against no dist should say so rather than fail.
const built = existsSync(generated);
const read = (path) => JSON.parse(readFileSync(path, "utf8"));

test("no binding name is declared twice in the generated wrangler config", { skip: built ? false : "run `npm run build` first" }, () => {
  const config = read(generated);
  const named = [
    ...(config.d1_databases ?? []),
    ...(config.r2_buckets ?? []),
    ...(config.kv_namespaces ?? []),
    ...(config.durable_objects?.bindings ?? []),
  ].map((entry) => entry.binding);

  const seen = new Set();
  const duplicated = named.filter((name) => (seen.has(name) ? true : (seen.add(name), false)));
  assert.deepEqual(duplicated, [], `these binding names are declared more than once: ${duplicated.join(", ")}`);
});

// The same duplicate-supplier failure as the bindings, in its third disguise,
// and the one that actually stopped an upload: wrangler rejects the whole deploy
// with "Compatibility flag specified multiple times: nodejs_compat" [code:
// 10021]. It is supplied once, by localBindingConfig in vite.config.ts, and
// wrangler.jsonc ships an empty compatibility_flags on purpose. This fails if
// either side changes: two of them, or none.
test("nodejs_compat is supplied exactly once", { skip: built ? false : "run `npm run build` first" }, () => {
  const flags = read(generated).compatibility_flags ?? [];
  assert.deepEqual(
    flags.filter((flag) => flag === "nodejs_compat"),
    ["nodejs_compat"],
    `nodejs_compat must appear once, not ${flags.filter((f) => f === "nodejs_compat").length} times: ${JSON.stringify(flags)}`
  );
});

test("no site-creator placeholder reaches the deployed config", { skip: built ? false : "run `npm run build` first" }, () => {
  const config = read(generated);
  const blob = JSON.stringify({ d1: config.d1_databases, r2: config.r2_buckets });
  assert.doesNotMatch(blob, /site-creator-/, "a placeholder binding from .openai/hosting.json reached the build");
  assert.doesNotMatch(blob, /00000000-0000-4000-8000-000000000000/, "the placeholder database id reached the build");
});

test("all four bindings the worker reads are present exactly once", { skip: built ? false : "run `npm run build` first" }, () => {
  const config = read(generated);
  // The four are enumerated in wrangler.jsonc, each against the line that reads
  // it. ASSETS and IMAGES are the two .openai/hosting.json never knew about.
  assert.equal(config.assets?.binding, "ASSETS");
  assert.equal(config.images?.binding, "IMAGES");
  assert.deepEqual((config.d1_databases ?? []).map((entry) => entry.binding), ["DB"]);
  assert.deepEqual((config.r2_buckets ?? []).map((entry) => entry.binding), ["UPLOADS"]);
});

// The decision this locks in: the Cloudflare path stops CONSUMING the d1 and r2
// keys, and does not delete them. They still travel to the other platform in a
// separate artefact, copied by build/sites-vite-plugin.ts. A future change that
// "fixes" the collision by emptying .openai/hosting.json would pass every
// assertion above and silently take the other platform's bindings with it.
test("the other platform's binding manifest still ships intact", { skip: built ? false : "run `npm run build` first" }, () => {
  const hosting = read(hostingArtefact);
  assert.equal(hosting.d1, "DB", ".openai/hosting.json must keep its d1 key: the other platform reads it");
  assert.equal(hosting.r2, "UPLOADS", ".openai/hosting.json must keep its r2 key: the other platform reads it");
});
