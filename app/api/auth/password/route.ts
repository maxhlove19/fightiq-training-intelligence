// Finishing a password reset.
//
// The recovery link Supabase emails lands on /reset-password with a short lived
// session in the URL fragment. A fragment never reaches a server, so the page
// reads it in the browser and posts it here. Everything after that is
// server side: this route sets the password and puts the athlete straight into
// the app with an HttpOnly cookie, so the token is never stored anywhere a
// script could read it later.
//
// Before that cookie is set the token is verified with this app's own verifier,
// exactly as an ordinary request would be. Supabase accepting it proves it is
// real, and this proves it is a token for this project rather than a valid
// token from somewhere else.

import { authNotConfigured, supabaseConfig, withSession } from "../../../../lib/auth-routes";
import { identityConfig } from "../../../../lib/current-athlete";
import { verifyHs256 } from "../../../../lib/jwt";
import { readJsonObject } from "../../../../lib/request-body";
import { updatePassword, validatePassword } from "../../../../lib/supabase-auth";

export const dynamic = "force-dynamic";

function failure(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const config = supabaseConfig();
  if (!config) return authNotConfigured();

  const body = await readJsonObject(request);
  if (!body) return failure("INVALID_REQUEST", "That did not come through. Try again.", 400);

  const accessToken = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
  const refreshToken = typeof body.refreshToken === "string" ? body.refreshToken.trim() : "";
  // A missing token means the link was opened without its fragment, usually
  // because it was copied out of an email client by hand.
  if (!accessToken || accessToken.length > 4000 || refreshToken.length > 4000) {
    return failure("LINK_INVALID", "That reset link is incomplete. Open it directly from the email, or ask for a new one.", 400);
  }

  const check = validatePassword(body.password);
  if (!check.ok) return failure(check.code, check.message, 422);

  const outcome = await updatePassword(config, accessToken, String(body.password));
  if (!outcome.ok) return failure(outcome.code, outcome.message, outcome.status);

  // The password is changed either way. Signing them in is a convenience, so a
  // token this app cannot verify costs them one sign in rather than the reset.
  const { jwtSecret, issuer } = identityConfig();
  const verified = jwtSecret
    ? await verifyHs256(accessToken, { secret: jwtSecret, issuer, audience: "authenticated" })
    : null;
  if (!verified || !refreshToken) {
    return Response.json(
      { ok: true, signedIn: false, message: "Your password is set. Sign in with it now." },
      { headers: { "cache-control": "no-store" } },
    );
  }
  return withSession({ ok: true, signedIn: true }, { accessToken, refreshToken, expiresIn: 3600 });
}
