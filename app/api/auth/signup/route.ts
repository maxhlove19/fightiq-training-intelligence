import { authNotConfigured, sessionIsUsable, sessionNotUsable, supabaseConfig, withSession } from "../../../../lib/auth-routes";
import { readJsonObject } from "../../../../lib/request-body";
import { signUp, validateCredentials } from "../../../../lib/supabase-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const config = supabaseConfig();
  if (!config) return authNotConfigured();
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: { code: "INVALID_REQUEST", message: "That did not come through. Try again." } }, { status: 400 });

  const check = validateCredentials(body.email, body.password);
  if (!check.ok) return Response.json({ error: { code: check.code, message: check.message } }, { status: 422 });

  const email = String(body.email).trim();
  const fullName = typeof body.fullName === "string" ? body.fullName : "";
  const outcome = await signUp(config, email, String(body.password), fullName);
  if (!outcome.ok) return Response.json({ error: { code: outcome.code, message: outcome.message } }, { status: outcome.status });
  // A project with email confirmation turned on returns no session yet.
  if (!outcome.session) return Response.json({ ok: true, pending: true, message: outcome.message }, { status: 200 });

  // The account exists either way, so the wording has to say so. Somebody who
  // has just handed over an email and a password needs to know it was not
  // wasted, and that signing in again is the thing to try, not signing up again.
  if (!(await sessionIsUsable(outcome.session))) {
    return sessionNotUsable("Your account is created. FightIQ could not sign you straight in, which is ours to fix rather than yours. Try signing in with those details in a few minutes.");
  }
  return withSession({ ok: true, pending: false }, outcome.session, 201);
}
