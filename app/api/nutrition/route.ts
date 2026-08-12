import { ensureProductSchema, getOrCreateProfile, getProductOwnerId, getProductRuntime, getTodayNutrition, productError } from "../../../lib/product-db";

export const dynamic = "force-dynamic";
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

export async function GET() {
  const ownerId = await getProductOwnerId();
  if (!ownerId) return productError("AUTH_REQUIRED", "Authentication required.", 401);
  const { db, uploads } = getProductRuntime();
  if (!db) return productError("STORAGE_UNAVAILABLE", "Nutrition logging is unavailable.", 503);
  await ensureProductSchema(db);
  const [profile, nutrition] = await Promise.all([getOrCreateProfile(db, ownerId), getTodayNutrition(db, ownerId)]);
  // Whether a photo can be kept once the meal is saved, which is a different
  // question from whether one can be read. /api/nutrition/analyze sends the
  // image straight to the model and stores nothing, so estimating from a photo
  // works on a deployment with no bucket. Only keeping it needs R2. The screen
  // uses this to say which of the two it is doing, rather than offering a
  // camera and failing on save.
  return Response.json({ ...nutrition, goal: profile.primary_goal, photoStorage: Boolean(uploads), targets: { calories: profile.calorie_target, protein: profile.protein_target, carbs: profile.carb_target, fat: profile.fat_target } });
}

export async function POST(request: Request) {
  const ownerId = await getProductOwnerId();
  if (!ownerId) return productError("AUTH_REQUIRED", "Authentication required.", 401);
  const { db, uploads } = getProductRuntime();
  if (!db) return productError("STORAGE_UNAVAILABLE", "Nutrition logging is unavailable.", 503);
  let form: FormData;
  try { form = await request.formData(); } catch { return productError("INVALID_REQUEST", "Invalid meal.", 400); }
  const description = String(form.get("description") ?? "").trim().slice(0, 500);
  const foods = String(form.get("foods") ?? "[]");
  const number = (key: string) => Number(form.get(key));
  const calories = number("calories"); const protein = number("protein"); const carbs = number("carbs"); const fat = number("fat");
  if (!description || ![calories, protein, carbs, fat].every((value) => Number.isFinite(value) && value >= 0) || calories > 10000 || Math.max(protein, carbs, fat) > 2000) return productError("INVALID_MEAL", "Review the meal and macro values before saving.", 422);
  let parsedFoods: unknown;
  try { parsedFoods = JSON.parse(foods); } catch { parsedFoods = []; }
  const safeFoods = Array.isArray(parsedFoods) ? parsedFoods.slice(0, 12) : [];
  const photo = form.get("photo");
  let photoKey: string | null = null;
  const id = crypto.randomUUID();
  if (photo instanceof File && photo.size > 0) {
    if (!uploads) return productError("UPLOADS_UNAVAILABLE", "Photo storage is unavailable.", 503);
    if (!imageTypes.has(photo.type) || photo.size > 8 * 1024 * 1024) return productError("INVALID_PHOTO", "Use a JPG, PNG, WebP, or HEIC image under 8 MB.", 422);
    photoKey = `${ownerId}/nutrition/${id}`;
    await uploads.put(photoKey, await photo.arrayBuffer(), { httpMetadata: { contentType: photo.type || "image/jpeg", cacheControl: "private, max-age=3600" } });
  }
  await ensureProductSchema(db);
  const createdAt = new Date().toISOString();
  await db.prepare(`INSERT INTO nutrition_entries (id, owner_id, description, foods_json, calories, protein, carbs, fat, input_method, photo_key, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, ownerId, description, JSON.stringify(safeFoods), Math.round(calories), protein, carbs, fat, photoKey ? "photo" : String(form.get("inputMethod") ?? "text"), photoKey, createdAt).run();
  return Response.json({ id, description, calories: Math.round(calories), protein, carbs, fat, photoUrl: photoKey ? `/api/nutrition/photos/${id}` : null, createdAt }, { status: 201 });
}
