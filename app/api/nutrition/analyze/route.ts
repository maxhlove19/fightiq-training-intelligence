import { analyzeMeal, ProductAIError } from "../../../../lib/product-ai";
import { getProductOwnerId, getProductRuntime, productError } from "../../../../lib/product-db";

export const dynamic = "force-dynamic";
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

function base64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export async function POST(request: Request) {
  const ownerId = await getProductOwnerId();
  if (!ownerId) return productError("AUTH_REQUIRED", "Authentication required.", 401);
  const { apiKey } = getProductRuntime();
  let form: FormData;
  try { form = await request.formData(); } catch { return productError("INVALID_REQUEST", "Invalid meal.", 400); }
  const description = String(form.get("description") ?? "").trim().slice(0, 500);
  const photo = form.get("photo");
  let image: { dataUrl: string; mimeType: string } | undefined;
  if (photo instanceof File && photo.size > 0) {
    if (!imageTypes.has(photo.type) || photo.size > 8 * 1024 * 1024) return productError("INVALID_PHOTO", "Use a JPG, PNG, WebP, or HEIC image under 8 MB.", 422);
    image = { dataUrl: `data:${photo.type};base64,${base64(await photo.arrayBuffer())}`, mimeType: photo.type };
  }
  if (!description && !image) return productError("EMPTY_MEAL", "Describe the meal or add a photo.", 422);
  try { return Response.json(await analyzeMeal({ apiKey, ownerId, description, image })); }
  catch (error) {
    if (error instanceof ProductAIError) return productError(error.code, error.message, error.status);
    return productError("AI_UNAVAILABLE", "FightIQ couldn’t estimate that meal.", 503);
  }
}
