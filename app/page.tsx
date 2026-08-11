import type { Metadata } from "next";
import { getChatGPTUser } from "./chatgpt-auth";
import { FightIQApp } from "./components/FightIQApp";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "FightIQ. You train hard. You forget most of it.",
  description: "FightIQ remembers every session and tells you the one thing to work on next.",
};

export default async function Home({ searchParams }: { searchParams: Promise<{ debrief?: string | string[] }> }) {
  const user = await getChatGPTUser();
  const isPreview = process.env.NODE_ENV !== "production";

  if (!user && !isPreview) {
    return (
      <main className="door">
        <section className="door-hero">
          {/* The hero is a fixed local asset and the LCP element. A loader would add a hop, not remove one. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- fixed local asset, and the LCP element: an optimizer would add a hop rather than remove one. */}
          <img className="door-image" src="/fighter-posters/kick-room.jpg" alt="" decoding="async" fetchPriority="high" />
          <div className="door-hero-copy">
            <p className="wordmark door-wordmark">FIGHT<span>IQ</span></p>
            <h1>You train hard.<br />You forget most of it.</h1>
            <p className="door-lede">
              Every session teaches you something. By Thursday it is gone, and you are working
              on whatever the class happened to cover. FightIQ remembers, and gives you one
              thing to fix.
            </p>
            <a className="primary-button door-button" href="/signin-with-chatgpt?return_to=%2F">Start free</a>
            <p className="door-note">Sign in with ChatGPT. Nothing to set up.</p>
          </div>
        </section>

        <section className="door-banners" aria-label="What FightIQ does">
          <article>
            <p className="eyebrow">TALK, DO NOT TYPE</p>
            <h2>Two minutes in the changing room</h2>
            <p>Say what happened. FightIQ pulls out the detail worth keeping and asks one question if it needs to.</p>
          </article>
          <article>
            <p className="eyebrow">IT REMEMBERS</p>
            <h2>Your coach said it three weeks ago</h2>
            <p>The same problem keeps showing up in your notes. FightIQ is the one thing in the gym that never forgets it did.</p>
          </article>
          <article>
            <p className="eyebrow">ONE THING TONIGHT</p>
            <h2>Turn the support foot, then commit</h2>
            <p>Not a training plan. One cue, built from your own sessions, short enough to hold onto for two hours.</p>
          </article>
          <article className="door-safety">
            <p className="eyebrow">AND IT KNOWS WHEN TO STOP</p>
            <h2>Write &ldquo;got rocked&rdquo; and it stops coaching</h2>
            <p>A head knock puts you on a stepwise return to training. No app clears you for contact. This one will not pretend to.</p>
          </article>
        </section>

        <section className="door-close">
          <h2>Built for the people who actually turn up</h2>
          <p>Three nights a week, a job, and a coach who is teaching thirty other people at the same time.</p>
          <a className="primary-button door-button" href="/signin-with-chatgpt?return_to=%2F">Start free</a>
        </section>
      </main>
    );
  }

  const displayName = user?.fullName?.split(" ")[0] ?? "Max";
  const requestedEntry = (await searchParams).debrief;
  const initialEntryId = typeof requestedEntry === "string" && requestedEntry.length <= 100 ? requestedEntry : null;
  return <FightIQApp displayName={displayName} initialEntryId={initialEntryId} />;
}
