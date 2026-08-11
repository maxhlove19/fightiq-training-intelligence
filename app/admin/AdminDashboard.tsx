"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AthleteSummary, OwnerOverview } from "../../lib/owner-overview";
import { stateLabel } from "../../lib/owner-overview";

function since(value: string): string {
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return "";
  const days = Math.floor((Date.now() - at) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "a month ago" : `${months} months ago`;
}

function Metric({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return <div className="owner-metric"><span>{label}</span><strong>{value}</strong>{note ? <small>{note}</small> : null}</div>;
}

function AthleteRow({ athlete }: { athlete: AthleteSummary }) {
  return (
    <li className={`owner-athlete ${athlete.state}`}>
      <div className="owner-athlete-who">
        <strong>{athlete.name}</strong>
        <small>{athlete.email}</small>
      </div>
      <div className="owner-athlete-state"><span>{stateLabel(athlete.state)}</span></div>
      <div className="owner-athlete-stats">
        <span><b>{athlete.sessions}</b> {athlete.sessions === 1 ? "session" : "sessions"}</span>
        <span><b>{athlete.sessionsThisWeek}</b> this week</span>
        <span><b>{athlete.sparringShare}%</b> sparring</span>
      </div>
      <div className="owner-athlete-meta">
        <span>{athlete.disciplines.length ? athlete.disciplines.join(", ") : "No discipline logged"}</span>
        <span>
          Joined {since(athlete.joinedAt)}
          {athlete.daysSinceLastSession === null ? ", never trained" : `, last trained ${athlete.daysSinceLastSession === 0 ? "today" : `${athlete.daysSinceLastSession}d ago`}`}
        </span>
      </div>
    </li>
  );
}

export function AdminDashboard({ ownerName }: { ownerName: string }) {
  const [data, setData] = useState<OwnerOverview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch("/api/admin/overview")
      .then(async (response) => {
        if (!response.ok) throw new Error("That did not load.");
        return response.json() as Promise<OwnerOverview>;
      })
      .then(setData)
      .catch(() => setError("The dashboard could not load. Refresh and it will try again."));
  }, []);

  if (error) return <main className="owner-page"><p className="error-message" role="alert">{error}</p></main>;
  if (!data) return <main className="owner-page"><p className="owner-loading">Reading the roster.</p></main>;

  return (
    <main className="owner-page">
      <header className="owner-header">
        <p className="wordmark">FIGHT<span>IQ</span></p>
        <div>
          <p className="eyebrow">OWNER VIEW</p>
          <h1>Your athletes</h1>
        </div>
        <Link className="owner-exit" href="/">Open the app</Link>
      </header>

      <section className="owner-headlines" aria-label="Summary">
        {data.headlines.map((line) => <p key={line}>{line}</p>)}
      </section>

      <section className="owner-metrics" aria-label="Totals">
        <Metric label="ATHLETES" value={data.totals.athletes} note={`${data.totals.signedUpThisWeek} joined this week`} />
        <Metric label="TRAINING THIS WEEK" value={data.totals.activeThisWeek} note={`${data.totals.activeThisMonth} in the last month`} />
        <Metric label="SESSIONS LOGGED" value={data.totals.sessions} note={`${data.totals.sessionsThisWeek} this week`} />
        <Metric label="CAME BACK TWICE" value={data.retention.loggedTwice} note={`of ${data.retention.loggedOnce} who logged once`} />
        <Metric label="STUCK AT ONE" value={Math.max(0, data.retention.loggedOnce - data.retention.loggedTwice)} note="logged once, never returned" />
        <Metric label="ON HOLD" value={data.totals.holdsOpen} note="return to training" />
      </section>

      <section className="owner-roster" aria-label="Athletes">
        <div className="owner-roster-head">
          <h2>Everyone, most urgent first</h2>
          <p>On hold, then lapsed, then whoever has been away longest.</p>
        </div>
        {data.athletes.length
          ? <ul>{data.athletes.map((athlete) => <AthleteRow key={athlete.ownerId} athlete={athlete} />)}</ul>
          : <p className="owner-empty">Nobody has opened the app yet. The first person to sign in appears here.</p>}
      </section>

      <p className="owner-privacy">
        Signed in as {ownerName}. This page shows what people do, never what they write.
        Training notes stay with the athlete who wrote them, and the query behind this page does not read them.
      </p>
    </main>
  );
}
