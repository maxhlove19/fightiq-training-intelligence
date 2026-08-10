"use client";

import { useState } from "react";
import { Check, Lock, ShieldAlert, Stethoscope, Undo2 } from "lucide-react";

export type HoldStage = {
  key: string;
  step: number;
  title: string;
  goal: string;
  allowed: string[];
  notAllowed: string[];
  minHours: number;
  requiresMedicalClearance: boolean;
  isContact: boolean;
  allowsSkillWork: boolean;
};

export type HoldView = {
  open: boolean;
  reason: "head_impact" | "acute_injury";
  stage: HoldStage;
  nextStage: HoldStage | null;
  totalSteps: number;
  daysHeld: number;
  hoursRemaining: number;
  canAdvance: boolean;
  blockers: string[];
  needsMedicalClearance: boolean;
  allowsTraining: boolean;
  allowsSkillWork: boolean;
  allowsContact: boolean;
  eyebrow: string;
  title: string;
  body: string;
  advanceLabel: string;
  setbackLabel: string;
  escalation: string;
  footnote: string;
};

type Action = { action: "advance"; symptomFree: true } | { action: "setback" | "record_medical_clearance" | "close" };

/**
 * The hold, as the athlete sees it: which step they are on, what that step
 * permits, and the single thing standing between them and the next one.
 *
 * The buttons here are a convenience, not the rule. Every action goes back to
 * the server, which decides for itself whether the step opens — so a stale
 * screen, a double tap or a hand-made request all get the same answer.
 */
export function ReturnToTraining({ hold, onChange, compact = false }: { hold: HoldView; onChange?: (hold: HoldView | null) => void; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<"clearance" | null>(null);

  async function send(body: Action) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/safety/hold", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { hold?: HoldView | null; error?: string | { message?: string } };
      if (!response.ok) throw new Error(typeof payload.error === "object" ? payload.error?.message ?? "" : payload.error ?? "");
      if (typeof payload.error === "string" && payload.error) setError(payload.error);
      onChange?.(payload.hold ?? null);
      setConfirming(null);
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : "FightIQ couldn’t update your return-to-training step.");
    } finally { setBusy(false); }
  }

  if (!hold.open) return null;
  const urgent = hold.reason === "head_impact";
  const steps = Array.from({ length: hold.totalSteps }, (_, index) => index + 1);

  return <section className={`return-to-training ${hold.reason} ${compact ? "compact" : ""}`} role={urgent ? "alert" : "status"}>
    <p className="eyebrow"><ShieldAlert size={13} /> {hold.eyebrow}</p>
    <h2>{hold.title}</h2>
    <p className="rtt-goal">{hold.body}</p>

    <ol className="rtt-ladder" aria-label={`Step ${hold.stage.step} of ${hold.totalSteps}`}>
      {steps.map((step) => <li key={step} className={step < hold.stage.step ? "done" : step === hold.stage.step ? "current" : "locked"}>
        <span aria-hidden="true">{step < hold.stage.step ? <Check size={12} /> : step === hold.stage.step ? step : <Lock size={11} />}</span>
      </li>)}
    </ol>

    {!compact && <div className="rtt-columns">
      <div><span>YOU CAN</span><ul>{hold.stage.allowed.map((line) => <li key={line}>{line}</li>)}</ul></div>
      {hold.stage.notAllowed.length > 0 && <div className="not"><span>NOT YET</span><ul>{hold.stage.notAllowed.map((line) => <li key={line}>{line}</li>)}</ul></div>}
    </div>}

    {hold.blockers.length > 0 && <ul className="rtt-blockers">{hold.blockers.map((line) => <li key={line}>{line}</li>)}</ul>}
    {hold.escalation && <p className="rtt-escalation" role="alert">{hold.escalation}</p>}
    {error && <p className="error-message" role="alert">{error}</p>}

    {onChange && <div className="rtt-actions">
      {hold.needsMedicalClearance && (confirming === "clearance"
        ? <div className="rtt-confirm">
            <p>Only tap this if a doctor or physio has actually assessed you and said you can go back. FightIQ takes your word for it — nobody else checks.</p>
            <button className="primary-button" onClick={() => void send({ action: "record_medical_clearance" })} disabled={busy}>YES, I WAS CLEARED IN PERSON</button>
            <button className="quiet-button" onClick={() => setConfirming(null)}>Not yet</button>
          </div>
        : <button className="rtt-clearance" onClick={() => setConfirming("clearance")} disabled={busy}><Stethoscope size={16} /> A PROFESSIONAL CLEARED ME</button>)}

      {hold.canAdvance && confirming !== "clearance" && <button className="primary-button" onClick={() => void send({ action: "advance", symptomFree: true })} disabled={busy}>{busy ? "SAVING…" : hold.advanceLabel}</button>}
      {!hold.nextStage && confirming !== "clearance" && <button className="primary-button" onClick={() => void send({ action: "close" })} disabled={busy}>I’M BACK TO NORMAL — CLOSE THIS</button>}
      {confirming !== "clearance" && <button className="quiet-button rtt-setback" onClick={() => void send({ action: "setback" })} disabled={busy}><Undo2 size={15} /> {hold.setbackLabel}</button>}
    </div>}

    <p className="rtt-footnote">{hold.footnote}</p>
  </section>;
}
