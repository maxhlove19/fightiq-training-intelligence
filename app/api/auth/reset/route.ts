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
  // The link has to land somewhere that can finish the job. Sending it to the
  // site root meant the email arrived, the athlete clicked it, and there was no
  // screen to set a password on. This URL must also be in the project's
  // Redirect URLs list, or Supabase refuses to redirect at all.
  const outcome = await requestPasswordReset(config, email, `${new URL(request.url).origin}/reset-password`);
  return Response.json({ ok: true, message: outcome.message }, { headers: { "cache-control": "no-store" } });
}
