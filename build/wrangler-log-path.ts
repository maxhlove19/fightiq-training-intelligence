// Wrangler snapshots its log path at import time, so this has to run before
// `@cloudflare/vite-plugin` is loaded.
//
// It used to live inside the async config factory in vite.config.ts, which
// forced the Cloudflare plugin to be imported dynamically so that these
// assignments could run first. That dynamic import is invisible to anything
// reading vite.config.ts as text rather than evaluating it, and at least one
// tool in the deploy path does exactly that: `@vinext/cloudflare deploy`
// rejected this project with "Missing @cloudflare/vite-plugin in your Vite
// config" while the plugin was present and working.
//
// A separate module solves both. ES modules are evaluated in import order, so
// importing this file above the plugin gives the same guarantee the dynamic
// import gave, and vite.config.ts gets to import the plugin at the top level
// where a reader, human or otherwise, can see it.
//
// These are non-secret tool settings. Application environment belongs in
// ignored `.env*` files. `??=` throughout, so an explicitly set value always
// wins: package.json's scripts set WRANGLER_LOG_PATH before node starts.

process.env.WRANGLER_WRITE_LOGS ??= "false";
process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

export {};
