import { ensureProductSchema, getProductOwnerId, getProductRuntime, productError } from "../../../../../lib/product-db";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const ownerId = await getProductOwnerId();
  if (!ownerId) return productError("AUTH_REQUIRED", "Authentication required.", 401);
  const { id } = await context.params;
  const { db, uploads } = getProductRuntime();
  if (!db || !uploads) return productError("STORAGE_UNAVAILABLE", "Photo storage is unavailable.", 503);
  await ensureProductSchema(db);
  const entry = await db.prepare("SELECT photo_key FROM nutrition_entries WHERE id = ? AND owner_id = ? LIMIT 1").bind(id, ownerId).first<{ photo_key: string | null }>();
  if (!entry?.photo_key) return productError("NOT_FOUND", "Photo not found.", 404);
  const object = await uploads.get(entry.photo_key);
  if (!object) return productError("NOT_FOUND", "Photo not found.", 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("cache-control", "private, max-age=3600");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}
