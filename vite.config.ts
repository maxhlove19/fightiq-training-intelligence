// Import order is load-bearing. See build/wrangler-log-path.ts: it must be
// evaluated before @cloudflare/vite-plugin, which snapshots the log path when
// it is imported. Keep this line first.
import "./build/wrangler-log-path";

import { existsSync } from "node:fs";
import { cloudflare } from "@cloudflare/vite-plugin";
import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

/**
 * Whether this project carries its own Wrangler config.
 *
 * When it does, `@cloudflare/vite-plugin` reads it and it is the authority on
 * bindings, so the placeholders below must not be synthesised as well. Two
 * declarations of one binding name is not a merge: `wrangler deploy` refuses
 * with "DB assigned to multiple D1 Database bindings", and the generated
 * dist/server/wrangler.json shows why that refusal is the good outcome. The
 * placeholder sorts FIRST in both arrays:
 *
 *   d1_databases: [
 *     { binding: "DB", database_name: "site-creator-d1", database_id: "0000…" },
 *     { binding: "DB", database_name: "fightiq",         database_id: "<real>" },
 *   ]
 *
 * A first-wins merge would have deployed green against an all-zeros database
 * and saved nothing. The error is the only reason anyone found out.
 *
 * Checked at config load rather than passed in, because it has to hold for
 * every entry point: `vinext dev`, `vinext build`, and `@vinext/cloudflare
 * deploy`, which runs its own build and regenerates dist/server/wrangler.json,
 * so editing that file by hand cannot fix anything.
 */
const hasWranglerConfig =
  existsSync(new URL("wrangler.jsonc", import.meta.url)) ||
  existsSync(new URL("wrangler.json", import.meta.url));

/**
 * Bindings for local development only.
 *
 * The d1 and r2 entries come from `.openai/hosting.json` and exist so that
 * `vinext dev` has a Miniflare database and bucket to work against. Their
 * identifiers are placeholders and always were: an all-zeros id and a bucket
 * named site-creator-r2 cannot address anything real, on any platform.
 *
 * `.openai/hosting.json` itself is untouched by this. Its d1 and r2 keys still
 * reach the other deployment platform, because build/sites-vite-plugin.ts
 * copies the whole file to dist/.openai/hosting.json, which is a separate
 * artefact from dist/server/wrangler.json and is not affected by anything here.
 */
const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases:
    d1 && !hasWranglerConfig
      ? [
          {
            binding: d1,
            database_name: "site-creator-d1",
            database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
          },
        ]
      : [],
  r2_buckets:
    r2 && !hasWranglerConfig
      ? [
          {
            binding: r2,
            bucket_name: "site-creator-r2",
          },
        ]
      : [],
};

export default defineConfig(() => {
  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
