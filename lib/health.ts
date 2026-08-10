// What "configured correctly" means for a FightIQ deployment, as a pure
// function so it can be tested without a worker runtime.
//
// Every case here has been a real failure: a database with no schema, a missing
// model key that silently turned every debrief into a retry screen, a storage
// bucket nobody bound.

export type HealthChecks = {
  /** A D1 binding named DB is present. */
  database: boolean;
  /** The schema applied and the session log is queryable. */
  schema: boolean;
  /** A model key, or the explicit mock flag. Without it, notes save but nothing is read back. */
  sessionAnalysis: boolean;
  /** An R2 binding named UPLOADS, for meal photos. */
  photoUploads: boolean;
  /** A YouTube key. Optional — Learn falls back to the curated studies. */
  liveVideoSearch: boolean;
};

export type HealthReport = {
  status: "ok" | "degraded" | "down";
  httpStatus: 200 | 503;
  checks: HealthChecks;
  notes: string[];
};

export function summariseHealth(checks: HealthChecks): HealthReport {
  // Storage is the only thing an athlete cannot work around. Without the model
  // key their notes still save; without the database nothing does.
  const usable = checks.database && checks.schema;
  const notes: string[] = [];
  if (!checks.database) notes.push("No D1 binding named DB. Nothing can be saved or read.");
  else if (!checks.schema) notes.push("The database is bound but the schema could not be applied.");
  if (!checks.sessionAnalysis) notes.push("No OPENAI_API_KEY. Sessions still save and are kept in full; the debrief and Coach say the reading half is not switched on. Adding the key makes past sessions readable — nothing is lost in the meantime.");
  if (!checks.photoUploads) notes.push("No R2 binding named UPLOADS. Meal photos cannot be stored.");
  if (!checks.liveVideoSearch) notes.push("No YOUTUBE_API_KEY. Learn serves the curated studies only, which is a supported way to run.");

  const status = !usable ? "down" : checks.sessionAnalysis ? "ok" : "degraded";
  return { status, httpStatus: usable ? 200 : 503, checks, notes };
}
