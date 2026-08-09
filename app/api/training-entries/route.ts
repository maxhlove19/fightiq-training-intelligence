import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { consumePreTrainingBrief, ensureProductSchema } from "../../../lib/product-db";

export const dynamic = "force-dynamic";

const allowedDisciplines = new Set(["MMA", "BJJ", "Wrestling", "Boxing", "Muay Thai", "Kickboxing", "Judo", "Other"]);
const allowedSessionTypes = new Set(["Class", "Drilling", "Sparring", "Open mat", "Private"]);

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  const ownerId = user?.userId ?? (process.env.NODE_ENV !== "production" ? "preview-user" : null);
  if (!ownerId) return Response.json({ error: "Authentication required" }, { status: 401 });

  let body: { discipline?: unknown; sessionType?: unknown; rawEntry?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const discipline = typeof body.discipline === "string" ? body.discipline : "";
  const sessionType = typeof body.sessionType === "string" ? body.sessionType : "";
  const rawEntry = typeof body.rawEntry === "string" ? body.rawEntry.trim() : "";
  if (!allowedDisciplines.has(discipline) || !allowedSessionTypes.has(sessionType) || rawEntry.length < 3 || rawEntry.length > 12000) {
    return Response.json({ error: "Invalid training entry" }, { status: 422 });
  }
  if (!env.DB) return Response.json({ error: "Training storage is not configured" }, { status: 503 });

  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS training_entries (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      discipline TEXT NOT NULL,
      session_type TEXT NOT NULL,
      raw_entry TEXT NOT NULL,
      input_method TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_training_entries_owner_created ON training_entries (owner_id, created_at)"),
  ]);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO training_entries (id, owner_id, discipline, session_type, raw_entry, input_method, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, ownerId, discipline, sessionType, rawEntry, "voice_or_text", new Date().toISOString()).run();
  await ensureProductSchema(env.DB);
  await consumePreTrainingBrief(env.DB, ownerId);
  return Response.json({ id }, { status: 201 });
}
