"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Check, Target } from "lucide-react";

type Setup = {
  disciplines: string[]; experienceLevel: string; sessionsPerWeek: number; sessionTypes: string[]; competitionIntent: string;
  primaryGoal: "cut" | "maintain" | "gain muscle" | "performance"; currentFocus: string; styleInfluences: string[];
  age: string; calculatorSex: "female" | "male" | "manual" | ""; heightCm: string; weightKg: string;
  dietaryRestrictions: string[]; foodPreferences: string; foodsToAvoid: string; mealsPerDay: string; trainingTime: string;
};

const initial: Setup = {
  disciplines: [], experienceLevel: "", sessionsPerWeek: 3, sessionTypes: [], competitionIntent: "",
  primaryGoal: "performance", currentFocus: "", styleInfluences: [], age: "", calculatorSex: "", heightCm: "", weightKg: "",
  dietaryRestrictions: [], foodPreferences: "", foodsToAvoid: "", mealsPerDay: "3", trainingTime: "",
};
const disciplineOptions = ["MMA", "BJJ", "Wrestling", "Boxing", "Muay Thai", "Kickboxing", "Judo"];
const sessionOptions = ["Class", "Drilling", "Sparring", "Open mat", "Private"];

function toggle(values: string[], value: string) { return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]; }

export function AthleteOnboarding({ displayName, onComplete }: { displayName: string; onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const [setup, setSetup] = useState<Setup>(initial);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const update = <K extends keyof Setup>(key: K, value: Setup[K]) => setSetup((current) => ({ ...current, [key]: value }));
  const nextAllowed = step === 0 ? setup.disciplines.length > 0 : step === 1 ? Boolean(setup.experienceLevel && setup.sessionTypes.length) : step === 2 ? Boolean(setup.competitionIntent) : true;
  async function complete() {
    if (saving) return;
    setSaving(true); setError("");
    const body = {
      ...setup, age: Number(setup.age), heightCm: Number(setup.heightCm), weightKg: Number(setup.weightKg), mealsPerDay: Number(setup.mealsPerDay),
      styleInfluences: setup.styleInfluences,
    };
    try {
      const response = await fetch("/api/onboarding", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "FightIQ couldn’t save your athlete setup.");
      onComplete();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "FightIQ couldn’t save your athlete setup."); }
    finally { setSaving(false); }
  }
  return <main className="onboarding-shell">
    <header className="onboarding-top"><p className="wordmark">FIGHT<span>IQ</span></p><span>SETUP {step + 1} / 6</span></header>
    <div className="onboarding-progress" aria-label={`Setup step ${step + 1} of 4`}><i style={{ width: `${((step + 1) / 4) * 100}%` }} /></div>
    <section className="onboarding-card">
      {step === 0 && <><p className="eyebrow">YOUR FIGHTER PROFILE</p><h1>{displayName ? `What do you train, ${displayName}?` : "What do you train?"}</h1><p>Pick every discipline that matters to your game.</p><div className="setup-chip-grid">{disciplineOptions.map((item) => <button className={setup.disciplines.includes(item) ? "selected" : ""} onClick={() => update("disciplines", toggle(setup.disciplines, item))} key={item}>{setup.disciplines.includes(item) && <Check size={14} />}{item}</button>)}</div></>}
      {step === 1 && <><p className="eyebrow">YOUR TRAINING RHYTHM</p><h1>How do you usually train?</h1><p>This helps FightIQ keep the right load around your practices.</p><p className="setup-label">EXPERIENCE</p><div className="setup-choice-stack">{["New to martial arts", "Building fundamentals", "Experienced competitor", "Advanced / coaching"].map((item) => <button className={setup.experienceLevel === item ? "selected" : ""} onClick={() => update("experienceLevel", item)} key={item}>{item}<Check size={16} /></button>)}</div><p className="setup-label">SESSIONS PER WEEK · {setup.sessionsPerWeek}</p><input className="range-field" type="range" min="1" max="10" value={setup.sessionsPerWeek} onChange={(event) => update("sessionsPerWeek", Number(event.target.value))} /><p className="setup-label">USUAL SESSION TYPES</p><div className="setup-chip-grid compact">{sessionOptions.map((item) => <button className={setup.sessionTypes.includes(item) ? "selected" : ""} onClick={() => update("sessionTypes", toggle(setup.sessionTypes, item))} key={item}>{item}</button>)}</div></>}
      {step === 2 && <><p className="eyebrow">WHERE YOU’RE HEADED</p><h1>What are you building toward?</h1><p>FightIQ will refine this from training, but your intent comes first.</p><p className="setup-label">COMPETITION</p><div className="setup-choice-stack">{["Training for myself", "I may compete", "I compete regularly"].map((item) => <button className={setup.competitionIntent === item ? "selected" : ""} onClick={() => update("competitionIntent", item)} key={item}>{item}<Check size={16} /></button>)}</div><label className="setup-label" htmlFor="setup-focus">CURRENT PRIORITY <em>OPTIONAL</em></label><input id="setup-focus" className="setup-input" value={setup.currentFocus} onChange={(event) => update("currentFocus", event.target.value)} placeholder="e.g. sharper boxing entries" maxLength={240} /><label className="setup-label" htmlFor="setup-influences">FIGHTERS OR STYLES <em>OPTIONAL</em></label><input id="setup-influences" className="setup-input" value={setup.styleInfluences.join(", ")} onChange={(event) => update("styleInfluences", event.target.value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 8))} placeholder="e.g. Volkanovski, pressure boxing" /></>}
      {step === 3 && <><p className="eyebrow">READY TO TRAIN WITH DIRECTION</p><h1>Your athlete profile is set.</h1><p>FightIQ will treat this as your starting point, then let your actual training lead the conversation.</p><div className="setup-review"><Target size={19} /><div><span>TRAINING</span><strong>{setup.disciplines.join(" · ")} · {setup.sessionsPerWeek} sessions/week</strong></div><div><span>COACHING</span><strong>{setup.currentFocus || "FightIQ will find your first focus from training."}</strong></div></div>{error && <p className="error-message" role="alert">{error}</p>}</>}
      <footer className="onboarding-actions">{step > 0 ? <button className="setup-back" onClick={() => setStep((current) => current - 1)}><ChevronLeft size={17} /> Back</button> : <span />}{step < 3 ? <button className="primary-button setup-next" disabled={!nextAllowed} onClick={() => setStep((current) => current + 1)}>Continue <ChevronRight size={18} /></button> : <button className="primary-button setup-next" disabled={saving} onClick={() => void complete()}>{saving ? "SAVING YOUR PROFILE…" : "ENTER FIGHTIQ"}</button>}</footer>
    </section>
  </main>;
}
