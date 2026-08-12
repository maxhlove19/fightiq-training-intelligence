// The build has to hand Cloudflare exactly one of each binding.
//
// This exists because it did not, and because the failure was reproduced on
// this repository rather than reasoned about. `.openai/hosting.json` declares
// "d1": "DB" and "r2": "UPLOADS", vite.config.ts turned those into placeholder
// bindings, and wrangler.jsonc declares the real ones under the same two names.
// The generated dist/server/wrangler.json ended up carrying both, placeholder
// first:
//
//   d1_databases: [
//     { binding: "DB", database_name: "site-creator-d1", database_id: "0000…" },
//     { binding: "DB", database_name: "fightiq",         database_id: "<real>" },
//   ]
//
// `wrangler deploy --dry-run` refuses that with "DB assigned to multiple D1
// Database bindings", which is the good outcome and the only reason it was
// found. Had the merge been first-wins instead, the deploy would have
// succeeded, the app would have looked completely fine, and every session an
// athlete logged would have gone to an all-zeros database that is not
// anybody's.
//
// These read the build output rather than the config, because the config is not
// the artefact: every deploy runs its own build and regenerates
// dist/server/wrangler.json, so editing that file by hand changes nothing and
// only the generated result is worth asserting on.

import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { applyDatabaseId, applyR2Bucket, checkDeployConfig } from "../scripts/prepare-deploy-config.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const generated = `${root}dist/server/wrangler.json`;
const hostingArtefact = `${root}dist/.openai/hosting.json`;

// `npm test` builds before it runs tests, so this is present in the gate. A
// single file run by hand against no dist should say so rather than fail.
const skip = existsSync(generated) ? false : "run `npm run build` first";
const read = (path) => JSON.parse(readFileSync(path, "utf8"));

/** A stand-in for the id the deploy environment supplies. Never a real one. */
const STAND_IN_ID = "11111111-2222-4333-8444-555555555555";

test("the built config passes every deploy check once an id is supplied", { skip }, () => {
  assert.deepEqual(checkDeployConfig(applyDatabaseId(read(generated), STAND_IN_ID)), []);
});

test("no binding name is declared twice in the generated config", { skip }, () => {
  const config = read(generated);
  const named = [
    ...(config.d1_databases ?? []),
    ...(config.r2_buckets ?? []),
    ...(config.kv_namespaces ?? []),
    ...(config.durable_objects?.bindings ?? []),
  ].map((entry) => entry.binding);

  const seen = new Set();
  const duplicated = named.filter((name) => (seen.has(name) ? true : (seen.add(name), false)));
  assert.deepEqual(duplicated, [], `declared more than once: ${duplicated.join(", ")}`);
});

// The same duplicate-supplier failure in a third disguise, and the one that
// stopped an upload outright: wrangler rejects the whole deploy with
// "Compatibility flag specified multiple times: nodejs_compat" [code: 10021].
// It is supplied once, by localBindingConfig in vite.config.ts, and
// wrangler.jsonc ships an empty compatibility_flags on purpose. This fails if
// either side changes: two of them, or none.
test("nodejs_compat is supplied exactly once", { skip }, () => {
  const flags = read(generated).compatibility_flags ?? [];
  assert.deepEqual(flags.filter((flag) => flag === "nodejs_compat"), ["nodejs_compat"], JSON.stringify(flags));
});

test("no site-creator placeholder reaches the deployed config", { skip }, () => {
  const config = read(generated);
  const blob = JSON.stringify({ d1: config.d1_databases, r2: config.r2_buckets });
  assert.doesNotMatch(blob, /site-creator-/, "a placeholder binding from .openai/hosting.json reached the build");
  assert.doesNotMatch(blob, /00000000-0000-4000-8000-000000000000/, "the placeholder database id reached the build");
});

test("all four bindings the worker reads are present exactly once", { skip }, () => {
  const config = read(generated);
  // Enumerated in wrangler.jsonc, each against the line that reads it. ASSETS
  // and IMAGES are the two .openai/hosting.json never knew about.
  assert.equal(config.assets?.binding, "ASSETS");
  assert.equal(config.images?.binding, "IMAGES");
  assert.deepEqual((config.d1_databases ?? []).map((entry) => entry.binding), ["DB"]);
  // R2 is the exception, and it is absent on purpose. Declaring a bucket that
  // does not exist stops the deploy, and R2 cannot be enabled at all without
  // attaching a billing subscription to a payment method. An account that has
  // not done that could otherwise not deploy the app at all, over one optional
  // screen. It is added by R2_BUCKET_NAME, covered below.
  assert.deepEqual(config.r2_buckets ?? [], []);
  // The worker is deployed by name. A wrong one creates a second worker beside
  // the live one and leaves the live one untouched, which reads as a deploy
  // that silently did nothing.
  assert.equal(config.name, "fightiq");
});

// The decision this locks in: the Cloudflare path stops CONSUMING the d1 and r2
// keys, and does not delete them. They still travel to the other platform in a
// separate artefact, copied by build/sites-vite-plugin.ts. A future change that
// "fixed" the collision by emptying .openai/hosting.json would pass every
// assertion above and silently take the other platform's bindings with it.
test("the other platform's binding manifest still ships intact", { skip }, () => {
  const hosting = read(hostingArtefact);
  assert.equal(hosting.d1, "DB", ".openai/hosting.json must keep its d1 key: the other platform reads it");
  assert.equal(hosting.r2, "UPLOADS", ".openai/hosting.json must keep its r2 key: the other platform reads it");
});

// The checks themselves, against configs built to be wrong. Asserting only on
// the real build proves the build is fine today and proves nothing about
// whether these would catch it going wrong.

test("a duplicated binding is refused, and the message says where it comes from", () => {
  const problems = checkDeployConfig({
    name: "fightiq", compatibility_flags: ["nodejs_compat"],
    assets: { binding: "ASSETS" }, images: { binding: "IMAGES" },
    d1_databases: [
      { binding: "DB", database_name: "site-creator-d1", database_id: "00000000-0000-4000-8000-000000000000" },
      { binding: "DB", database_name: "fightiq", database_id: STAND_IN_ID },
    ],
  });
  assert.ok(problems.some((problem) => /declared more than once/.test(problem)));
  assert.ok(problems.some((problem) => /hosting\.json/.test(problem)), "the message must name the cause, not just the symptom");
  assert.ok(problems.some((problem) => /all-zeros/.test(problem)));
});

test("a doubled compatibility flag is refused", () => {
  const problems = checkDeployConfig({
    name: "fightiq", compatibility_flags: ["nodejs_compat", "nodejs_compat"],
    assets: { binding: "ASSETS" }, images: { binding: "IMAGES" },
    d1_databases: [{ binding: "DB", database_name: "fightiq", database_id: STAND_IN_ID }],
  });
  assert.ok(problems.some((problem) => /exactly once, not 2/.test(problem)));
});

test("an unsubstituted database id is refused rather than uploaded", () => {
  const config = {
    name: "fightiq", compatibility_flags: ["nodejs_compat"],
    assets: { binding: "ASSETS" }, images: { binding: "IMAGES" },
    d1_databases: [{ binding: "DB", database_name: "fightiq", database_id: "REPLACE_ME_D1_DATABASE_ID" }],
  };
  assert.ok(checkDeployConfig(config).some((problem) => /REPLACE_ME_D1_DATABASE_ID/.test(problem)));
  // And substituting fixes exactly that, without touching anything else.
  assert.deepEqual(checkDeployConfig(applyDatabaseId(config, STAND_IN_ID)), []);
});

test("a missing ASSETS binding is refused, because the app would serve no pages", () => {
  const problems = checkDeployConfig({
    name: "fightiq", compatibility_flags: ["nodejs_compat"], images: { binding: "IMAGES" },
    d1_databases: [{ binding: "DB", database_name: "fightiq", database_id: STAND_IN_ID }],
  });
  assert.ok(problems.some((problem) => /ASSETS/.test(problem)));
});

// Meal photos are optional, and the two ways of running are both supported.
// The one that must never happen is a config declaring a bucket the account
// does not have, because that does not degrade, it stops the deploy.

test("a build with no bucket passes every check, because that is a supported deployment", { skip }, () => {
  const config = applyDatabaseId(read(generated), STAND_IN_ID);
  assert.deepEqual(config.r2_buckets ?? [], []);
  assert.deepEqual(checkDeployConfig(config), []);
});

test("setting R2_BUCKET_NAME adds the binding under the name the code reads", { skip }, () => {
  const config = applyR2Bucket(applyDatabaseId(read(generated), STAND_IN_ID), "fightiq-uploads");
  assert.deepEqual(config.r2_buckets, [{ binding: "UPLOADS", bucket_name: "fightiq-uploads" }]);
  assert.deepEqual(checkDeployConfig(config), []);
  // getProductRuntime reads env.UPLOADS. A binding under any other name is a
  // bucket that exists, costs money, and is never written to.
  assert.equal(config.r2_buckets[0].binding, "UPLOADS");
});

test("an unset R2_BUCKET_NAME leaves the config alone rather than adding an empty bucket", () => {
  const base = { name: "fightiq", compatibility_flags: ["nodejs_compat"], assets: { binding: "ASSETS" }, images: { binding: "IMAGES" }, d1_databases: [{ binding: "DB", database_name: "fightiq", database_id: STAND_IN_ID }] };
  for (const value of ["", undefined]) {
    const config = applyR2Bucket(base, value);
    assert.deepEqual(config.r2_buckets ?? [], [], `${JSON.stringify(value)} must not produce a binding`);
    assert.deepEqual(checkDeployConfig(config), []);
  }
});

test("a malformed bucket name is refused rather than deployed", () => {
  // This one is worth catching here rather than at upload: wrangler's message
  // names the bucket and not the variable it came from.
  const base = { name: "fightiq", compatibility_flags: ["nodejs_compat"], assets: { binding: "ASSETS" }, images: { binding: "IMAGES" }, d1_databases: [{ binding: "DB", database_name: "fightiq", database_id: STAND_IN_ID }] };
  const problems = checkDeployConfig(applyR2Bucket(base, "Not A Valid Bucket"));
  assert.ok(problems.some((problem) => /not a valid R2 bucket name/.test(problem)));
  assert.ok(problems.some((problem) => /R2_BUCKET_NAME/.test(problem)), "the message must name the variable to fix");
});

test("an R2 binding under the wrong name is refused", () => {
  const problems = checkDeployConfig({
    name: "fightiq", compatibility_flags: ["nodejs_compat"],
    assets: { binding: "ASSETS" }, images: { binding: "IMAGES" },
    d1_databases: [{ binding: "DB", database_name: "fightiq", database_id: STAND_IN_ID }],
    r2_buckets: [{ binding: "PHOTOS", bucket_name: "fightiq-uploads" }],
  });
  assert.ok(problems.some((problem) => /must be named UPLOADS/.test(problem)));
});
