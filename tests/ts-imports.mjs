// Registered with `node --import ./tests/ts-imports.mjs` so every test file can
// import lib/ modules the way the bundler does.
import { register } from "node:module";
register("./ts-resolver.mjs", import.meta.url);
