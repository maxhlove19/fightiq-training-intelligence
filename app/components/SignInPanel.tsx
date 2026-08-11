"use client";

import { useState } from "react";

type Mode = "signup" | "signin" | "reset";

const COPY: Record<Mode, { title: string; action: string; alternate: string; alternateMode: Mode }> = {
  signup: { title: "Start free", action: "CREATE MY ACCOUNT", alternate: "I already have an account", alternateMode: "signin" },
  signin: { title: "Welcome back", action: "SIGN IN", alternate: "Create an account", alternateMode: "signup" },
  reset: { title: "Reset your password", action: "SEND THE LINK", alternate: "Back to sign in", alternateMode: "signin" },
};

/**
 * Email sign up, so using FightIQ does not require a ChatGPT account.
 *
 * The form never touches a token. It posts to this app's own routes, which set
 * HttpOnly cookies, so nothing a script on this page could read is ever a
 * session.
 */
export function SignInPanel({ chatGptAvailable = true }: { chatGptAvailable?: boolean }) {
  const [mode, setMode] = useState<Mode>("signup");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const copy = COPY[mode];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const path = mode === "reset" ? "/api/auth/reset" : mode === "signin" ? "/api/auth/signin" : "/api/auth/signup";
      const response = await fetch(path, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "reset" ? { email } : { email, password, ...(mode === "signup" ? { fullName } : {}) }),
      });
      const payload = await response.json() as { ok?: boolean; pending?: boolean; message?: string; error?: { message?: string } };
      if (!response.ok) { setError(payload.error?.message || "That did not work. Try again."); return; }
      if (payload.pending || mode === "reset") { setNotice(payload.message || "Check your email."); return; }
      // The cookies are set. A full load picks up the signed in app.
      window.location.href = "/";
    } catch {
      setError("Could not reach FightIQ. Check your connection and try again.");
    } finally { setBusy(false); }
  }

  return (
    <section className="door-auth" aria-label="Create an account or sign in">
      <h2>{copy.title}</h2>
      <form onSubmit={submit}>
        {mode === "signup" && (
          <label>
            <span>YOUR NAME</span>
            <input value={fullName} onChange={(event) => setFullName(event.target.value)}
              autoComplete="name" placeholder="Max" maxLength={120} />
          </label>
        )}
        <label>
          <span>EMAIL</span>
          <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)}
            autoComplete="email" placeholder="you@example.com" maxLength={200} />
        </label>
        {mode !== "reset" && (
          <label>
            <span>PASSWORD</span>
            <input type="password" required value={password} onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              placeholder="At least 8 characters" minLength={8} maxLength={200} />
          </label>
        )}
        {error && <p className="error-message" role="alert">{error}</p>}
        {notice && <p className="door-notice" role="status">{notice}</p>}
        <button className="primary-button door-button" type="submit" disabled={busy}>
          {busy ? "ONE MOMENT" : copy.action}
        </button>
      </form>

      <div className="door-auth-links">
        <button type="button" onClick={() => { setMode(copy.alternateMode); setError(""); setNotice(""); }}>{copy.alternate}</button>
        {mode === "signin" && (
          <button type="button" onClick={() => { setMode("reset"); setError(""); setNotice(""); }}>Forgot your password?</button>
        )}
      </div>

      {chatGptAvailable && (
        <p className="door-alt-signin">
          Already using FightIQ through ChatGPT? <a href="/signin-with-chatgpt?return_to=%2F">Sign in that way instead</a>.
        </p>
      )}
    </section>
  );
}
