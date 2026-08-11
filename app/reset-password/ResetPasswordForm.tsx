"use client";

import { useEffect, useState } from "react";

/**
 * The screen a recovery link lands on.
 *
 * Supabase verifies the emailed token and then redirects here with a short
 * lived session in the URL fragment. A fragment is never sent to a server, so
 * it has to be read here, handed to this app's own route, and then dropped.
 *
 * Two things this deliberately does. It strips the token from the address bar
 * as soon as it has been read, so a shared screen or a back button does not
 * leave a working session in the URL. And it forgets the token the moment it
 * has been spent, rather than holding it for the life of the page.
 */
type Tokens = { accessToken: string; refreshToken: string };

/** null tokens means the link was missing or malformed. */
type LinkState = { tokens: Tokens | null; expired: boolean };

function readLink(): LinkState {
  const values = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const accessToken = values.get("access_token") ?? "";
  if (accessToken) {
    return { tokens: { accessToken, refreshToken: values.get("refresh_token") ?? "" }, expired: false };
  }
  // Supabase reports its own failures in the query string, and its wording is
  // aimed at developers. An expired link is the case an athlete actually hits.
  return { tokens: null, expired: Boolean(new URLSearchParams(window.location.search).get("error_description")) };
}

export function ResetPasswordForm() {
  const [link, setLink] = useState<LinkState | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [finished, setFinished] = useState("");

  useEffect(() => {
    const found = readLink();
    // Out of the address bar before anything else can read or share it.
    if (found.tokens) window.history.replaceState(null, "", window.location.pathname);
    // The fragment only exists in the browser, so this cannot be read while the
    // first render is still on the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLink(found);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving || !link?.tokens) return;
    if (password !== confirmation) { setError("Those two do not match."); return; }
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...link.tokens, password }),
      });
      const payload = await response.json() as { ok?: boolean; signedIn?: boolean; message?: string; error?: { message?: string } };
      if (!response.ok) { setError(payload.error?.message || "That did not work. Try again."); return; }
      if (payload.signedIn) { window.location.href = "/"; return; }
      // The token is spent. Holding on to it would only widen the window.
      setLink({ tokens: null, expired: false });
      setPassword(""); setConfirmation("");
      setFinished(payload.message || "Your password is set. Sign in with it now.");
    } catch {
      setError("Could not reach FightIQ. Check your connection and try again.");
    } finally { setSaving(false); }
  }

  if (!link) return <p className="door-notice" role="status">One moment.</p>;

  if (!link.tokens) {
    return (
      <>
        {finished && <p className="door-notice" role="status">{finished}</p>}
        {link.expired && <p className="error-message" role="alert">That reset link has expired or has already been used. Ask for a new one.</p>}
        {!finished && !link.expired && <p className="door-notice" role="status">Open the link from your reset email to set a new password.</p>}
        {/* A full load on purpose. The session cookie may have just changed, and
            the front door is server rendered from it, so a client transition
            would show a tree built before the change. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="primary-button door-button" href="/">GO TO SIGN IN</a>
      </>
    );
  }

  return (
    <form onSubmit={submit}>
      <label>
        <span>NEW PASSWORD</span>
        <input type="password" required value={password} onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password" placeholder="At least 8 characters" minLength={8} maxLength={200} />
      </label>
      <label>
        <span>TYPE IT AGAIN</span>
        <input type="password" required value={confirmation} onChange={(event) => setConfirmation(event.target.value)}
          autoComplete="new-password" placeholder="The same one" minLength={8} maxLength={200} />
      </label>
      {error && <p className="error-message" role="alert">{error}</p>}
      <button className="primary-button door-button" type="submit" disabled={saving}>
        {saving ? "ONE MOMENT" : "SET MY PASSWORD"}
      </button>
    </form>
  );
}
