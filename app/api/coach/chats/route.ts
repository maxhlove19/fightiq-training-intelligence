import { ensureProductSchema, getProductOwnerId, getProductRuntime, productError } from "../../../../lib/product-db";

export const dynamic = "force-dynamic";

export async function POST() {
  const ownerId = await getProductOwnerId();
  if (!ownerId) return productError("AUTH_REQUIRED", "Authentication required.", 401);
  const { db } = getProductRuntime();
  if (!db) return productError("STORAGE_UNAVAILABLE", "FightIQ Coach is unavailable.", 503);
  await ensureProductSchema(db);
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  await db.prepare("INSERT INTO coach_chats (id, owner_id, title, created_at, updated_at) VALUES (?, ?, 'New chat', ?, ?)").bind(id, ownerId, now, now).run();
  return Response.json({ chat: { id, title: "New chat", created_at: now, updated_at: now } }, { status: 201 });
}
