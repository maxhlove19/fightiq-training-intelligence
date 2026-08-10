// The bindings this app runs on, declared once so `env` is checked rather than
// assumed.
//
// Without this the D1 handle was `any`, and so was every row that came back
// from it: a renamed column, a wrong bind order, or a query result used as the
// wrong shape all compiled cleanly. The names here must match the bindings in
// .openai/hosting.json.
//
// No import or export belongs in this file: that would make it a module and the
// declaration would stop merging with the one in @cloudflare/workers-types.

declare namespace Cloudflare {
  interface Env {
    /** D1. Every table in lib/schema.ts lives here. Required — without it the app is down. */
    DB: D1Database;
    /** R2, for meal photos. Optional: everything else works without it. */
    UPLOADS?: R2Bucket;
    /** Without this, notes still save; nothing reads them back. */
    OPENAI_API_KEY?: string;
    /** Optional. Learn falls back to the curated studies. */
    YOUTUBE_API_KEY?: string;
    /** Local development only. Never set in production. */
    FIGHTIQ_ALLOW_MOCK_AI?: string;
  }
}
