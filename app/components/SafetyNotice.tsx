"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";

export type SafetySignal = {
  level: "head_impact" | "acute_injury" | "illness_or_load" | "none";
  matched: string[];
  title: string;
  body: string;
  advice: string[];
  redFlags: string[];
  holdTraining: boolean;
};

const EYEBROW: Record<SafetySignal["level"], string> = {
  head_impact: "STOP — READ THIS FIRST",
  acute_injury: "INJURY REPORTED",
  illness_or_load: "LOAD WARNING",
  none: "",
};

/**
 * Shown wherever an athlete has just described a head knock or an injury — the
 * training log, the Coach thread, the pre-training brief. It sits above
 * whatever else the screen wanted to say, because a fighter who has written
 * "got rocked" should read this before they read anything about technique.
 *
 * It never diagnoses. It shows which of the athlete's own words triggered it,
 * so a wrong call is obvious and can be dismissed.
 */
export function SafetyNotice({ signal, storageKey }: { signal: SafetySignal; storageKey: string }) {
  // Only rendered after a fetch resolves on the client, so reading storage in
  // the initialiser cannot mismatch a server render.
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    try { return window.localStorage.getItem(storageKey) === "1"; } catch { return false; }
  });
  if (signal.level === "none" || dismissed) return null;
  const urgent = signal.level === "head_impact";
  return <section className={`safety-notice ${signal.level}`} role={urgent ? "alert" : "status"}>
    <p className="eyebrow"><AlertTriangle size={13} /> {EYEBROW[signal.level]}</p>
    <h2>{signal.title}</h2>
    <p className="safety-body">{signal.body}</p>
    <ul className="safety-advice">{signal.advice.map((line) => <li key={line}>{line}</li>)}</ul>
    {signal.redFlags.length > 0 && <div className="safety-redflags">
      <span>GO TO EMERGENCY CARE NOW IF ANY OF THIS HAPPENS</span>
      <ul>{signal.redFlags.map((flag) => <li key={flag}>{flag}</li>)}</ul>
    </div>}
    <p className="safety-source">FightIQ is not a medical service and cannot assess you. This is general safety guidance, triggered by your own words: {signal.matched.join(", ")}.</p>
    <button className="safety-dismiss" onClick={() => {
      try { window.localStorage.setItem(storageKey, "1"); } catch { /* private mode */ }
      setDismissed(true);
    }}>That is not what I meant — hide this</button>
  </section>;
}
