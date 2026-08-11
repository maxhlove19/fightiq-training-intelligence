import { authNotConfigured, supabaseConfig, withSession } from "../../../../lib/auth-routes";
import { readJsonObject } from "../../../../lib/request-body";
import { signIn, validateCredentials } from "../../../../lib/supabase-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const config = supabaseConfig();
  if (!config) return authNotConfigured();
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: { code: "INVALID_REQUEST", message: "That did not come through. Try again." } }, { status: 400 });

  const check = validateCredentials(body.email, body.password);
  // The same wording either way, so a wrong password and an unknown email are
  // indistinguishable and this cannot be used to find out who has an account.
  if (!check.ok) return Response.json({ error: { code: "BAD_CREDENTIALS", message: "That email and password do not match an account." } }, { status: 401 });

  const outcome = await signIn(config, String(body.email).trim(), String(body.password));
  if (!outcome.ok) return Response.json({ error: { code: outcome.code, message: outcome.message } }, { status: outcome.status });
  if (!outcome.session) return Response.json({ error: { code: "EMAIL_UNCONFIRMED", message: outcome.message } }, { status: 401 });
  return withSession({ ok: true }, outcome.session);
}
