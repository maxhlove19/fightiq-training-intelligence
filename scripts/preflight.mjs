// Ask a deployment whether it is actually configured, and say so in words.
//
//   npm run preflight -- https://your-deployment.example
//
// Exits 0 when the app is usable, 1 when it is not. That makes it safe to put
// in front of anything that should not run against a broken deploy.

const target = (process.argv[2] ?? process.env.FIGHTIQ_URL ?? "http://localhost:3000").replace(/\/+$/, "");

const LABELS = {
  database: "Session storage (D1 binding: DB)",
  schema: "Schema applied and readable",
  sessionAnalysis: "Session analysis (OPENAI_API_KEY)",
  photoUploads: "Meal photos (R2 binding: UPLOADS)",
  liveVideoSearch: "Live video search (YOUTUBE_API_KEY)",
};

const REQUIRED = new Set(["database", "schema"]);

function line(name, ok) {
  const mark = ok ? "  ok  " : REQUIRED.has(name) ? " FAIL " : " off  ";
  return `${mark} ${LABELS[name] ?? name}`;
}

let response;
try {
  response = await fetch(`${target}/api/health`, { headers: { "cache-control": "no-cache" } });
} catch (error) {
  console.error(`\nCould not reach ${target}/api/health`);
  console.error(`  ${error instanceof Error ? error.message : String(error)}`);
  console.error("\nIf the deploy is still building, wait for it to finish and run this again.\n");
  process.exit(1);
}

let report;
try {
  report = await response.json();
} catch {
  console.error(`\n${target}/api/health returned ${response.status} and something that was not JSON.`);
  console.error("That usually means the URL is right but the app did not boot.\n");
  process.exit(1);
}

console.log(`\nFightIQ preflight · ${target}`);
console.log(`Status: ${String(report.status).toUpperCase()} (HTTP ${response.status})\n`);
for (const [name, ok] of Object.entries(report.checks ?? {})) console.log(line(name, ok));
if (report.notes?.length) {
  console.log("");
  for (const note of report.notes) console.log(`  · ${note}`);
}

if (report.status === "down") {
  console.log("\nThis deployment cannot store a training session. Nobody can use it yet.\n");
  process.exit(1);
}
if (report.status === "degraded") {
  console.log("\nUsable: sessions save and are kept. Reading them back is switched off until the model key is set.\n");
  process.exit(0);
}
console.log("\nEverything is configured. Log a session to confirm end to end.\n");
process.exit(0);
