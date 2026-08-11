// Stands in for `next/headers` so a test can import lib modules that sit
// downstream of the auth boundary.
//
// The framework supplies this module at runtime and it is not a package on
// disk, which made lib/product-db.ts and everything importing it untestable.
// Nothing here needs a real request: these tests exercise the database, and the
// owner id is passed in explicitly.
export async function headers() {
  return new Headers();
}
export async function cookies() {
  return { get: () => undefined, getAll: () => [] };
}
