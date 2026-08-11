import { authNotConfigured, supabaseConfig } from "../../../../lib/auth-routes";
import { readJsonObject } from "../../../../lib/request-body";
import { requestPasswordReset } from "../../../../lib/supabase-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const config = supabaseConfig();
  if (!config) return authNotConfigured();
  const body = await readJsonObject(request);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  // Always the same answer, so this cannot be used to discover which addresses
  // have accounts.
  const outcome = await requestPasswordReset(config, email, new URL(request.url).origin);
  return Response.json({ ok: true, message: outcome.message }, { headers: { "cache-control": "no-store" } });
}
