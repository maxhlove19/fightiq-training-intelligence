// Resolves the extensionless relative imports that lib/ uses, so a test can
// import the app's real modules instead of restating what they do.
//
// The bundler resolves "./schema" to "./schema.ts" without being asked. Node
// does not, which meant anything importing another lib module was untestable —
// and the only schema test we had therefore re-stated the ordering rather than
// running it, which is exactly how an ordering bug shipped.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const WORKERS_SHIM = new URL("./cloudflare-workers-shim.mjs", import.meta.url).href;

export async function resolve(specifier, context, next) {
  // The built worker imports a module its runtime provides and Node does not.
  if (specifier === "cloudflare:workers") return { url: WORKERS_SHIM, shortCircuit: true };

  if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/i.test(specifier)) {
    for (const suffix of [".ts", ".tsx", "/index.ts"]) {
      try {
        const candidate = new URL(specifier + suffix, context.parentURL);
        if (existsSync(fileURLToPath(candidate))) return next(specifier + suffix, context);
      } catch { /* not a file URL; fall through to the default resolver */ }
    }
  }
  return next(specifier, context);
}
