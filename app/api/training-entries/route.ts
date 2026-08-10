import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { ensureProductSchema, linkExperimentToEntry } from "../../../lib/product-db";

export const dynamic = "force-dynamic";

const allowedDisciplines = new Set(["MMA", "BJJ", "Wrestling", "Boxing", "Muay Thai", "Kickboxing", "Judo", "Other"]);
const allowedSessionTypes = new Set(["Class", "Drilling", "Sparring", "Open mat", "Private"]);

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  const ownerId = user?.userId ?? (process.env.NODE_ENV !== "production" ? "preview-user" : null);
  if (!ownerId) return Response.json({ error: "Authentication required" }, { status: 401 });

  let body: { discipline?: unknown; sessionType?: unknown; rawEntry?: unknown; experimentId?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const discipline = typeof body.discipline === "string" ? body.discipline : "";
  const sessionType = typeof body.sessionType === "string" ? body.sessionType : "";
  const rawEntry = typeof body.rawEntry === "string" ? body.rawEntry.trim() : "";
  const experimentId = typeof body.experimentId === "string" ? body.experimentId.trim() : "";
  if (!allowedDisciplines.has(discipline) || !allowedSessionTypes.has(sessionType) || rawEntry.length < 3 || rawEntry.length > 12000) {
    return Response.json({ error: "Invalid training entry" }, { status: 422 });
  }
  if (!env.DB) return Response.json({ error: "Training storage is not configured" }, { status: 503 });

  // One place owns this schema now, and it runs on reads as well as writes.
  await ensureProductSchema(env.DB);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO training_entries (id, owner_id, discipline, session_type, raw_entry, input_method, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, ownerId, discipline, sessionType, rawEntry, "voice_or_text", new Date().toISOString()).run();
  // A log only belongs to the pre-training experiment the athlete explicitly
  // started. A later, unrelated log must never consume an old plan.
  await linkExperimentToEntry(env.DB, ownerId, id, experimentId || undefined);
  return Response.json({ id }, { status: 201 });
}
