import type { Metadata } from "next";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Set a new password. FightIQ",
  description: "Choose a new password for your FightIQ account.",
  // A recovery link is a working session for as long as it lives. It has no
  // business in a search index or a referrer header.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Its own route rather than a mode on the front door.
 *
 * The door only renders for signed out visitors, so a reset link opened by
 * somebody who still has a session would have landed on the app and shown them
 * nothing. This page does not care either way.
 */
export default function ResetPassword() {
  return (
    <main className="door door-single">
      <section className="door-close">
        <p className="wordmark door-wordmark">FIGHT<span>IQ</span></p>
        <section className="door-auth" aria-label="Set a new password">
          <h2>Set a new password</h2>
          <ResetPasswordForm />
        </section>
      </section>
    </main>
  );
}
