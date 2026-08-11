// The single place a request becomes a person.
//
// Every route used to reach for the ChatGPT headers itself. Now they all come
// through here, so adding email sign in did not mean editing twenty routes and
// hoping none of them were missed.

import { headers } from "next/headers";
import { env } from "cloudflare:workers";
import { type Athlete, resolveAthlete } from "./identity";

type AuthEnv = { SUPABASE_URL?: string; SUPABASE_JWT_SECRET?: string };

export function identityConfig() {
  const runtime = env as unknown as AuthEnv;
  const url = (runtime.SUPABASE_URL ?? "").replace(/\/+$/, "");
  return { jwtSecret: runtime.SUPABASE_JWT_SECRET, issuer: url ? `${url}/auth/v1` : undefined };
}

/** Whoever is signed in, by either door, or null. */
export async function currentAthlete(): Promise<Athlete | null> {
  return resolveAthlete(await headers(), identityConfig());
}

/** Just their id, which is what every table is keyed to. */
export async function currentOwnerId(): Promise<string | null> {
  return (await currentAthlete())?.id ?? null;
}
