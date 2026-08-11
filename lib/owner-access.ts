// Who is allowed to see the owner dashboard.
//
// Signing in with ChatGPT proves who somebody is. It does not make them the
// person who runs this app, so the dashboard is gated on an explicit allowlist
// of email addresses set at deploy time and nowhere else.
//
// Closed by default on purpose. An unset variable grants nobody access, so a
// deployment that forgets to configure this exposes nothing rather than
// everything.

export type OwnerCheck = {
  allowed: boolean;
  /** True when nobody is configured, so the page can explain itself instead of 404ing silently. */
  unconfigured: boolean;
};

function parseAllowlist(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.includes("@"));
}

/** Whether this signed-in email runs the app. */
export function checkOwner(email: string | null | undefined, allowlistRaw: string | undefined | null): OwnerCheck {
  const allowlist = parseAllowlist(allowlistRaw);
  if (!allowlist.length) return { allowed: false, unconfigured: true };
  const normalised = (email ?? "").trim().toLowerCase();
  if (!normalised) return { allowed: false, unconfigured: false };
  return { allowed: allowlist.includes(normalised), unconfigured: false };
}

/** How many owners are configured, for the dashboard to report its own setup. */
export function ownerCount(allowlistRaw: string | undefined | null): number {
  return parseAllowlist(allowlistRaw).length;
}
