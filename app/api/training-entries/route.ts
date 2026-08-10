import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { ensureProductSchema, linkExperimentToEntry } from "../../../lib/product-db";
import { openHoldForNote } from "../../../lib/hold-db";
import { scanTrainingNote } from "../../../lib/safety-signals";
import { cleanText, readJsonObject } from "../../../lib/request-body";

export const dynamic = "force-dynamic";

const allowedDisciplines = new Set(["MMA", "BJJ", "Wrestling", "Boxing", "Muay Thai", "Kickboxing", "Judo", "Other"]);
const allowedSessionTypes = new Set(["Class", "Drilling", "Sparring", "Open mat", "Private"]);

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  const ownerId = user?.userId ?? (process.env.NODE_ENV !== "production" ? "preview-user" : null);
  if (!ownerId) return Response.json({ error: "Authentication required" }, { status: 401 });

  const body = await readJsonObject(request) as { discipline?: unknown; sessionType?: unknown; rawEntry?: unknown; experimentId?: unknown; clientKey?: unknown } | null;
  if (!body) return Response.json({ error: "Invalid JSON" }, { status: 400 });
  const discipline = typeof body.discipline === "string" ? body.discipline : "";
  const sessionType = typeof body.sessionType === "string" ? body.sessionType : "";
  const rawEntry = typeof body.rawEntry === "string" ? cleanText(body.rawEntry).trim() : "";
  const experimentId = typeof body.experimentId === "string" ? body.experimentId.trim() : "";
  const clientKey = typeof body.clientKey === "string" && body.clientKey.trim().length <= 64 ? body.clientKey.trim() : "";
  if (!allowedDisciplines.has(discipline) || !allowedSessionTypes.has(sessionType) || rawEntry.length < 3 || rawEntry.length > 12000) {
    return Response.json({ error: "Invalid training entry" }, { status: 422 });
  }
  if (!env.DB) return Response.json({ error: "Training storage is not configured" }, { status: 503 });

  // One place owns this schema now, and it runs on reads as well as writes.
  await ensureProductSchema(env.DB);

  // The same note, sent twice because a reply went missing, is one session.
  const existing = clientKey
    ? await env.DB.prepare("SELECT id FROM training_entries WHERE owner_id = ? AND client_key = ? LIMIT 1").bind(ownerId, clientKey).first<{ id: string }>()
    : null;
  if (existing) return Response.json({ id: existing.id, duplicate: true }, { status: 200 });

  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      "INSERT INTO training_entries (id, owner_id, discipline, session_type, raw_entry, input_method, created_at, client_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(id, ownerId, discipline, sessionType, rawEntry, "voice_or_text", new Date().toISOString(), clientKey || null).run();
  } catch (error) {
    // Two copies in flight at once: the unique index settles it, and the loser
    // returns the winner's entry rather than an error the athlete cannot act on.
    const won = clientKey
      ? await env.DB.prepare("SELECT id FROM training_entries WHERE owner_id = ? AND client_key = ? LIMIT 1").bind(ownerId, clientKey).first<{ id: string }>()
      : null;
    if (!won) throw error;
    return Response.json({ id: won.id, duplicate: true }, { status: 200 });
  }
  // A log only belongs to the pre-training experiment the athlete explicitly
  // started. A later, unrelated log must never consume an old plan.
  await linkExperimentToEntry(env.DB, ownerId, id, experimentId || undefined);

  // A note that describes a head knock opens a hold here, at the moment the note
  // is saved, rather than in the debrief. The debrief needs a model and a
  // network; this must not. Failing to open a hold cannot cost the athlete the
  // note they just wrote, so it is allowed to fail on its own.
  const safety = scanTrainingNote(rawEntry);
  if (safety.holdTraining && safety.level !== "illness_or_load") {
    try {
      await openHoldForNote(env.DB, ownerId, { reason: safety.level === "head_impact" ? "head_impact" : "acute_injury", entryId: id, matched: safety.matched });
    } catch { /* the note is saved; the hold is re-opened by the next read of it */ }
  }
  return Response.json({ id }, { status: 201 });
}
