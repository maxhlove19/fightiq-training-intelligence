import { withoutSession } from "../../../../lib/auth-routes";

export const dynamic = "force-dynamic";

/** Clearing the cookies is the whole job. Nothing server side to forget. */
export async function POST() {
  return withoutSession({ ok: true });
}
