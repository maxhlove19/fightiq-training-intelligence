import { summariseHealth } from "../../../lib/health";
import { ensureProductSchema, getProductRuntime } from "../../../lib/product-db";

export const dynamic = "force-dynamic";

// One URL to answer "is this deployment actually configured?". Reading it after
// a deploy is faster than finding out from an athlete.
//
// It returns booleans and nothing else. No keys, no values, no athlete data.
export async function GET() {
  const runtime = getProductRuntime();
  let schema = false;
  if (runtime.db) {
    try {
      // Applying the schema is idempotent and is what every request does anyway,
      // so this both checks and repairs a database that has never been written to.
      await ensureProductSchema(runtime.db);
      // `WHERE 1 = 0` proves the table and the column exist without this
      // unauthenticated endpoint ever touching a row that belongs to somebody.
      await runtime.db.prepare("SELECT id FROM training_entries WHERE 1 = 0").all();
      schema = true;
    } catch { schema = false; }
  }

  const report = summariseHealth({
    database: Boolean(runtime.db),
    schema,
    sessionAnalysis: Boolean(runtime.apiKey) || runtime.allowMockAi,
    photoUploads: Boolean(runtime.uploads),
    liveVideoSearch: Boolean(runtime.youtubeApiKey),
  });

  return Response.json(
    { status: report.status, checks: report.checks, notes: report.notes },
    { status: report.httpStatus, headers: { "cache-control": "no-store" } },
  );
}
