// Stands in for the `cloudflare:workers` module when the built worker is
// imported by plain Node in tests/rendered-html.test.mjs.
//
// The bundle is built for a runtime that provides this module. Node does not,
// so the harness supplies it rather than the app bending its imports around a
// test. Bindings come from process.env, which is what a test can control.
export const env = new Proxy({}, {
  get: (_target, key) => (typeof key === "string" ? process.env[key] : undefined),
  has: (_target, key) => typeof key === "string" && key in process.env,
});
export default { env };
