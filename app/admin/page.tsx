import type { Metadata } from "next";
import Link from "next/link";
import { currentAthlete } from "../../lib/current-athlete";
import { checkOwner } from "../../lib/owner-access";
import { AdminDashboard } from "./AdminDashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "FightIQ owner view", robots: { index: false, follow: false } };

export default async function AdminPage() {
  const athlete = await currentAthlete();
  const owner = checkOwner(athlete?.email, process.env.FIGHTIQ_OWNER_EMAILS);

  if (!owner.allowed) {
    // Nothing here confirms that a dashboard exists, except for the one case
    // where the deployment has not been configured and the person seeing it is
    // almost certainly the one who needs to configure it.
    return (
      <main className="owner-page owner-closed">
        <p className="wordmark">FIGHT<span>IQ</span></p>
        {owner.unconfigured
          ? <>
              <h1>No owner is set for this deployment.</h1>
              <p>Set FIGHTIQ_OWNER_EMAILS to the email address you sign in with, then open this page again. Until it is set, nobody can see this.</p>
            </>
          : <>
              <h1>Nothing here.</h1>
              <p>This page is for whoever runs FightIQ.</p>
            </>}
        <Link className="primary-button" href="/">Go to the app</Link>
      </main>
    );
  }

  return <AdminDashboard ownerName={athlete?.displayName || athlete?.email || "the owner"} />;
}
