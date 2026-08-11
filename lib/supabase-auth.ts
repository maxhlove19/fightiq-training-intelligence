// Talking to Supabase Auth over its REST API.
//
// No SDK, because all this needs is four calls and the SDK brings a browser
// oriented session manager we do not want: tokens live in HttpOnly cookies set
// by the server, not in storage a script could read.
//
// Nothing here rolls its own authentication. Password hashing, reset tokens,
// email verification and rate limiting are Supabase's job, and they are exactly
// the things that are quietly easy to get wrong.

export type SupabaseConfig = {
  url: string;
  anonKey: string;
  /** Injected so this can be tested without a network. */
  fetchImpl?: typeof fetch;
};

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
};

export type AuthOutcome =
  | { ok: true; session: AuthSession | null; message: string }
  | { ok: false; code: string; message: string; status: number };

/** Supabase's own wording is aimed at developers. These are aimed at athletes. */
function readableError(status: number, body: Record<string, unknown>): { code: string; message: string } {
  const raw = `${body.error_description ?? body.msg ?? body.message ?? body.error ?? ""}`.toLowerCase();
  if (raw.includes("invalid login") || raw.includes("invalid credentials")) {
    return { code: "BAD_CREDENTIALS", message: "That email and password do not match an account." };
  }
  if (raw.includes("already registered") || raw.includes("already been registered") || raw.includes("user already")) {
    return { code: "ALREADY_REGISTERED", message: "There is already an account with that email. Sign in instead." };
  }
  if (raw.includes("email not confirmed")) {
    return { code: "EMAIL_UNCONFIRMED", message: "Check your email and confirm the address, then sign in." };
  }
  if (raw.includes("password") && (raw.includes("short") || raw.includes("least"))) {
    return { code: "WEAK_PASSWORD", message: "Use at least 8 characters." };
  }
  if (status === 429) {
    return { code: "TOO_MANY", message: "Too many attempts. Wait a minute and try again." };
  }
  return { code: "AUTH_FAILED", message: "That did not work. Check the details and try again." };
}

function sessionFrom(body: Record<string, unknown>): AuthSession | null {
  const accessToken = typeof body.access_token === "string" ? body.access_token : "";
  const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : "";
  if (!accessToken || !refreshToken) return null;
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 3600;
  return { accessToken, refreshToken, expiresIn };
}

async function call(config: SupabaseConfig, path: string, body: unknown): Promise<AuthOutcome> {
  const send = config.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await send(`${config.url.replace(/\/+$/, "")}/auth/v1${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: config.anonKey, authorization: `Bearer ${config.anonKey}` },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, code: "AUTH_UNREACHABLE", message: "Could not reach the sign in service. Try again in a moment.", status: 503 };
  }
  let parsed: Record<string, unknown> = {};
  try { parsed = await response.json() as Record<string, unknown>; } catch { parsed = {}; }
  if (!response.ok) {
    const { code, message } = readableError(response.status, parsed);
    return { ok: false, code, message, status: response.status === 429 ? 429 : 401 };
  }
  const session = sessionFrom(parsed);
  return {
    ok: true,
    session,
    // A project with email confirmation on returns a user and no session.
    message: session ? "" : "Check your email to confirm the address, then sign in.",
  };
}

export function validateCredentials(email: unknown, password: unknown): { ok: true } | { ok: false; code: string; message: string } {
  const address = typeof email === "string" ? email.trim() : "";
  if (address.length < 5 || address.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    return { ok: false, code: "INVALID_EMAIL", message: "Enter a valid email address." };
  }
  const secret = typeof password === "string" ? password : "";
  if (secret.length < 8) return { ok: false, code: "WEAK_PASSWORD", message: "Use at least 8 characters." };
  if (secret.length > 200) return { ok: false, code: "WEAK_PASSWORD", message: "That password is too long." };
  return { ok: true };
}

export function signUp(config: SupabaseConfig, email: string, password: string, fullName?: string) {
  return call(config, "/signup", {
    email, password,
    ...(fullName?.trim() ? { data: { full_name: fullName.trim().slice(0, 120) } } : {}),
  });
}

export function signIn(config: SupabaseConfig, email: string, password: string) {
  return call(config, "/token?grant_type=password", { email, password });
}

export function refreshSession(config: SupabaseConfig, refreshToken: string) {
  return call(config, "/token?grant_type=refresh_token", { refresh_token: refreshToken });
}

/** Sends the reset email. Always reports success, so this cannot enumerate accounts. */
export async function requestPasswordReset(config: SupabaseConfig, email: string, redirectTo?: string): Promise<AuthOutcome> {
  await call(config, `/recover${redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : ""}`, { email });
  return { ok: true, session: null, message: "If there is an account with that email, a reset link is on its way." };
}
