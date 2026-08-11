// The single place a request becomes a person.
//
// Every route used to reach for the ChatGPT headers itself. Now they all come
// through here, so adding email sign in did not mean editing twenty routes and
// hoping none of them were missed.

import { headers } from "next/headers";
import { env } from "cloudflare:workers";
import { type Athlete, type IdentityConfig, resolveAthlete } from "./identity";
import { jwksSourceFor, jwksUrlForIssuer } from "./jwks";

type AuthEnv = { SUPABASE_URL?: string; SUPABASE_JWT_SECRET?: string };

/**
 * What this deployment can verify a token with.
 *
 * SUPABASE_URL alone is enough, and that is the change: the project's verifying
 * keys are published at a path derived from it, so sign in no longer depends on
 * a shared secret being set. SUPABASE_JWT_SECRET is still read, and still
 * works, for a project that has not migrated to asymmetric keys.
 */
export function identityConfig(): IdentityConfig {
  const runtime = env as unknown as AuthEnv;
  const url = (runtime.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const issuer = url ? `${url}/auth/v1` : undefined;
  return {
    jwtSecret: runtime.SUPABASE_JWT_SECRET,
    issuer,
    jwks: issuer ? jwksSourceFor(jwksUrlForIssuer(issuer)) : undefined,
  };
}

/** Whoever is signed in, by either door, or null. */
export async function currentAthlete(): Promise<Athlete | null> {
  return resolveAthlete(await headers(), identityConfig());
}

/** Just their id, which is what every table is keyed to. */
export async function currentOwnerId(): Promise<string | null> {
  return (await currentAthlete())?.id ?? null;
}
