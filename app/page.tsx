import type { Metadata } from "next";
import { getChatGPTUser } from "./chatgpt-auth";
import { FightIQApp } from "./components/FightIQApp";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "FightIQ — Train with direction",
  description: "FightIQ learns your game and tells you what to work on next.",
};

export default async function Home({ searchParams }: { searchParams: Promise<{ debrief?: string | string[] }> }) {
  const user = await getChatGPTUser();
  const isPreview = process.env.NODE_ENV !== "production";

  if (!user && !isPreview) {
    return (
      <main className="signin-page">
        <div className="brand-mark" aria-hidden="true"><span>F</span></div>
        <p className="eyebrow">FIGHTIQ</p>
        <h1>Your game.<br />Understood.</h1>
        <p>Training intelligence built around the athlete you’re becoming.</p>
        <a className="primary-button signin-button" href="/signin-with-chatgpt?return_to=%2F">
          Sign in to FightIQ
        </a>
      </main>
    );
  }

  const displayName = user?.fullName?.split(" ")[0] ?? "Max";
  const requestedEntry = (await searchParams).debrief;
  const initialEntryId = typeof requestedEntry === "string" && requestedEntry.length <= 100 ? requestedEntry : null;
  return <FightIQApp displayName={displayName} initialEntryId={initialEntryId} />;
}
