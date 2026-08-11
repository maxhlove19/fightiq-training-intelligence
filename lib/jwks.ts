// The public keys a Supabase project signs its access tokens with.
//
// Supabase moved from a shared HS256 secret to asymmetric signing keys. A
// project now publishes its public keys at
// <SUPABASE_URL>/auth/v1/.well-known/jwks.json and signs with ES256, and the
// old shared secret verifies nothing at all. The failure that caused is worth
// remembering, because nothing about it looked like an auth bug: sign up
// succeeded, the account really was created, and then the very next request
// could not verify the token it had just been handed, so the person landed back
// on the marketing page as though they had never signed up.
//
// Keys rotate. That is the point of publishing them, and it means this cannot
// be fetched once and trusted forever: a token signed with a key we have never
// seen is the normal, expected consequence of a rotation, not an attack. So an
// unknown key id triggers one refetch, rate limited so that a stream of junk
// tokens cannot turn into a stream of outbound requests.
//
// Everything here fails closed. No network, bad JSON, an unusable key: all of
// them produce null, and null means not signed in.

/** One key from the JWKS document. Every field optional: it is not our JSON. */
type Jwk = {
  kid?: unknown;
  kty?: unknown;
  crv?: unknown;
  alg?: unknown;
  use?: unknown;
  x?: unknown;
  y?: unknown;
};

export type JwksSource = {
  /** The verifying key for this key id, or null. Never throws. */
  get(kid: string): Promise<CryptoKey | null>;
};

export type JwksOptions = {
  /** Injected so tests never touch the network. */
  fetchImpl?: typeof fetch;
  /** How long a successful fetch is trusted before it is refreshed. */
  ttlMs?: number;
  /** Floor between fetches, so unknown key ids cannot be used to generate traffic. */
  minRefetchMs?: number;
  /** Injected so tests do not depend on the clock. */
  now?: () => number;
  timeoutMs?: number;
};

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MIN_REFETCH_MS = 30 * 1000;
const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Is this a key we are willing to verify with?
 *
 * Deliberately narrow. The app accepts exactly one signature algorithm from a
 * JWKS, so a document that grows an RSA key, or a key marked for encryption
 * rather than signing, contributes nothing rather than widening what is
 * accepted. `alg` and `use` are optional in the spec, so absent is allowed and
 * present-but-wrong is not.
 */
function isUsableEs256(key: Jwk): boolean {
  if (key.kty !== "EC" || key.crv !== "P-256") return false;
  if (typeof key.x !== "string" || typeof key.y !== "string") return false;
  if (key.alg !== undefined && key.alg !== "ES256") return false;
  if (key.use !== undefined && key.use !== "sig") return false;
  return typeof key.kid === "string" && key.kid.length > 0;
}

async function importEs256(key: Jwk): Promise<CryptoKey | null> {
  try {
    return await crypto.subtle.importKey(
      "jwk",
      { kty: "EC", crv: "P-256", x: key.x as string, y: key.y as string, ext: true },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
  } catch {
    return null;
  }
}

/**
 * A cache of one project's verifying keys.
 *
 * Module scope on Workers survives between requests in the same isolate, so the
 * common case costs no network at all. It is per-URL rather than global so that
 * two projects, or a test and the real thing, cannot see each other's keys.
 */
export function createJwksSource(url: string, options: JwksOptions = {}): JwksSource {
  const fetchImpl = options.fetchImpl ?? fetch;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const minRefetchMs = options.minRefetchMs ?? DEFAULT_MIN_REFETCH_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? Date.now;

  let keys = new Map<string, CryptoKey>();
  /** When a fetch last produced usable keys. Drives freshness. */
  let fetchedAt = 0;
  /**
   * When a fetch was last attempted, successful or not. Drives rate limiting.
   *
   * Separate from fetchedAt on purpose, and the reason is a deployment that is
   * easy to forget: a project still signing with HS256 serves a JWKS document
   * with no usable keys in it. If attempts were rate limited by success alone,
   * that project would fetch this document on every single request forever,
   * because it would never stop being stale.
   */
  let attemptedAt = 0;
  let inFlight: Promise<void> | null = null;

  async function refresh(): Promise<void> {
    // One request at a time. A cold isolate taking several requests at once
    // should make one call, not one per request.
    if (inFlight) return inFlight;
    const startedAt = now();
    attemptedAt = startedAt;
    inFlight = (async () => {
      try {
        const response = await fetchImpl(url, {
          headers: { accept: "application/json" },
          signal: typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined,
        });
        if (!response.ok) return;
        const document: unknown = await response.json();
        const list = (document as { keys?: unknown } | null)?.keys;
        if (!Array.isArray(list)) return;

        const next = new Map<string, CryptoKey>();
        for (const entry of list) {
          if (!entry || typeof entry !== "object") continue;
          const key = entry as Jwk;
          if (!isUsableEs256(key)) continue;
          const imported = await importEs256(key);
          if (imported) next.set(key.kid as string, imported);
        }
        // An empty result is not published over a working set. A project that
        // briefly serves an unreadable document should not sign everybody out.
        if (next.size > 0) {
          keys = next;
          fetchedAt = startedAt;
        }
      } catch {
        // Fail closed by leaving the previous keys in place. A network blip is
        // not a reason to reject a token we can already verify.
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  return {
    async get(kid: string): Promise<CryptoKey | null> {
      if (!kid) return null;

      const stale = !fetchedAt || now() - fetchedAt > ttlMs;
      if (stale && now() - attemptedAt >= minRefetchMs) await refresh();

      const hit = keys.get(kid);
      if (hit) return hit;

      // Not a key we know. Rotation looks exactly like this, so try once more,
      // but only if the last attempt is old enough that a flood of unknown key
      // ids cannot become a flood of requests.
      if (now() - attemptedAt >= minRefetchMs) {
        await refresh();
        return keys.get(kid) ?? null;
      }
      return null;
    },
  };
}

const sources = new Map<string, JwksSource>();

/** The shared per-URL cache. Options apply only when the source is first created. */
export function jwksSourceFor(url: string, options?: JwksOptions): JwksSource {
  const existing = sources.get(url);
  if (existing) return existing;
  const created = createJwksSource(url, options);
  sources.set(url, created);
  return created;
}

/** Where a Supabase project publishes its keys, derived from the issuer. */
export function jwksUrlForIssuer(issuer: string): string {
  return `${issuer.replace(/\/+$/, "")}/.well-known/jwks.json`;
}
