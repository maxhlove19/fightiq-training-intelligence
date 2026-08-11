// Verifying a signed token, carefully.
//
// This is the piece that decides whether somebody is who they say they are, so
// it is written to fail closed on everything: a bad signature, an expired
// token, a token signed with a different algorithm than the one we accept, a
// token for a different project, or anything malformed.
//
// It uses WebCrypto, which exists on Cloudflare Workers, on Vercel's edge and
// in Node, so the same verification runs everywhere this app might live.
//
// Deliberately supports exactly one algorithm: HS256. Accepting a list is how
// algorithm confusion attacks work, where a token arrives saying alg "none" or
// asking to be checked against a public key as though it were a shared secret.
// The header's algorithm is not consulted for what to do; it is only checked
// for whether it matches what we already decided to accept.

export type VerifiedToken = {
  /** The subject: a stable user id. */
  sub: string;
  email: string;
  /** Whatever the provider knows about their name. Optional everywhere. */
  name: string | null;
  /** Seconds since the epoch. */
  exp: number;
  raw: Record<string, unknown>;
};

export type VerifyOptions = {
  secret: string;
  /** Required issuer, when the caller knows it. */
  issuer?: string;
  /** Required audience. Supabase signs user tokens with "authenticated". */
  audience?: string;
  /** Seconds of clock skew allowed. Small on purpose. */
  leewaySeconds?: number;
  now?: Date;
};

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function decodeJson(part: string): Record<string, unknown> | null {
  try {
    const text = new TextDecoder().decode(base64UrlToBytes(part));
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch { return null; }
}

/** Constant time comparison, so a wrong signature cannot be found a byte at a time. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function readString(claims: Record<string, unknown>, key: string): string {
  const value = claims[key];
  return typeof value === "string" ? value : "";
}

/**
 * Returns the token's claims, or null. Never throws, and never returns a
 * partially checked token: every reason to reject produces the same null, so a
 * caller cannot accidentally treat "expired" as "fine".
 */
export async function verifyHs256(token: string, options: VerifyOptions): Promise<VerifiedToken | null> {
  if (typeof token !== "string" || !options?.secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts;
  if (!headerPart || !payloadPart || !signaturePart) return null;

  const header = decodeJson(headerPart);
  // The only algorithm this app accepts. A token asking for anything else,
  // including "none", is rejected before any cryptography happens.
  if (!header || header.alg !== "HS256") return null;

  let signature: Uint8Array;
  try { signature = base64UrlToBytes(signaturePart); } catch { return null; }

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(options.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const expected = new Uint8Array(await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  ));
  if (!sameBytes(signature, expected)) return null;

  const claims = decodeJson(payloadPart);
  if (!claims) return null;

  const nowSeconds = Math.floor((options.now?.getTime() ?? Date.now()) / 1000);
  const leeway = Math.max(0, options.leewaySeconds ?? 5);
  const exp = typeof claims.exp === "number" ? claims.exp : 0;
  if (!exp || nowSeconds > exp + leeway) return null;
  const nbf = typeof claims.nbf === "number" ? claims.nbf : 0;
  if (nbf && nowSeconds + leeway < nbf) return null;

  if (options.issuer && readString(claims, "iss") !== options.issuer) return null;
  if (options.audience) {
    const aud = claims.aud;
    const matches = Array.isArray(aud) ? aud.includes(options.audience) : aud === options.audience;
    if (!matches) return null;
  }

  const sub = readString(claims, "sub");
  if (!sub) return null;

  const metadata = claims.user_metadata && typeof claims.user_metadata === "object" && !Array.isArray(claims.user_metadata)
    ? claims.user_metadata as Record<string, unknown>
    : {};
  const name = typeof metadata.full_name === "string" && metadata.full_name.trim()
    ? metadata.full_name.trim()
    : typeof metadata.name === "string" && metadata.name.trim() ? metadata.name.trim() : null;

  return { sub, email: readString(claims, "email"), name, exp, raw: claims };
}
