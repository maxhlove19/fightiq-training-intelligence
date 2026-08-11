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
// It supports two algorithms, HS256 and ES256, and the way it does that is the
// most important thing in this file.
//
// Accepting a list of algorithms is how algorithm confusion attacks work: a
// token arrives saying alg "none", or asking to be checked against a public key
// as though that key were a shared secret. So the token's header still never
// decides anything. Each verify function accepts exactly one algorithm, decided
// before the token was read, and checks the header only to confirm it matches.
// Which function runs is chosen by what the deployment is configured with, in
// lib/identity.ts, never by what the token asks for.
//
// The practical consequence, and one of the tests: on a deployment configured
// with JWKS and no legacy secret, an HS256 token is rejected no matter how it
// is signed, because nothing ever calls the HS256 path.

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

/** Everything checked after a signature is confirmed, whichever algorithm confirmed it. */
export type ClaimOptions = {
  /** Required issuer, when the caller knows it. */
  issuer?: string;
  /** Required audience. Supabase signs user tokens with "authenticated". */
  audience?: string;
  /** Seconds of clock skew allowed. Small on purpose. */
  leewaySeconds?: number;
  now?: Date;
};

export type VerifyEs256Options = ClaimOptions & {
  /** Resolves a key id to a verifying key. See lib/jwks.ts. */
  keys: { get(kid: string): Promise<CryptoKey | null> };
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

  return checkClaims(payloadPart, options);
}

/**
 * Everything that must be true of a token once its signature has been proved.
 *
 * Shared by both algorithms on purpose. Expiry, issuer, audience and the
 * presence of a subject are properties of the token, not of how it was signed,
 * and a second copy of these rules is how one path quietly ends up more
 * permissive than the other.
 */
function checkClaims(payloadPart: string, options: ClaimOptions): VerifiedToken | null {
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

/**
 * Verifies an ES256 token against a project's published keys.
 *
 * The key is chosen by the token's `kid`, which is the one thing the header is
 * allowed to influence, and it influences only *which* public key is tried, not
 * whether a signature is required or which algorithm is accepted. An unknown
 * kid resolves to no key and the token is rejected.
 *
 * A JWT's ECDSA signature is the raw r||s pair, 64 bytes for P-256, which is
 * exactly what WebCrypto expects. No DER unwrapping, and a signature of any
 * other length is rejected before any cryptography happens.
 */
export async function verifyEs256(token: string, options: VerifyEs256Options): Promise<VerifiedToken | null> {
  if (typeof token !== "string" || !options?.keys) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts;
  if (!headerPart || !payloadPart || !signaturePart) return null;

  const header = decodeJson(headerPart);
  if (!header || header.alg !== "ES256") return null;
  const kid = typeof header.kid === "string" ? header.kid : "";
  if (!kid) return null;

  let signature: Uint8Array;
  try { signature = base64UrlToBytes(signaturePart); } catch { return null; }
  if (signature.length !== 64) return null;

  const key = await options.keys.get(kid);
  if (!key) return null;

  // Copied into a plain ArrayBuffer rather than cast. WebCrypto wants a
  // BufferSource and a Uint8Array can be backed by a SharedArrayBuffer, which
  // is not one. Sixty-four bytes, so the copy costs nothing worth measuring.
  const signatureBytes = new ArrayBuffer(signature.length);
  new Uint8Array(signatureBytes).set(signature);

  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      signatureBytes,
      new TextEncoder().encode(`${headerPart}.${payloadPart}`),
    );
  } catch { return null; }
  if (!ok) return null;

  return checkClaims(payloadPart, options);
}
