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
const restrictionOptions = ["Vegetarian", "Vegan", "Dairy-free", "Gluten-free", "Halal", "Kosher"];

function toggle(values: string[], value: string) { return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]; }

export function AthleteOnboarding({ displayName, onComplete }: { displayName: string; onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const [setup, setSetup] = useState<Setup>(initial);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const update = <K extends keyof Setup>(key: K, value: Setup[K]) => setSetup((current) => ({ ...current, [key]: value }));
  const nextAllowed = step === 0 ? setup.disciplines.length > 0 : step === 1 ? Boolean(setup.experienceLevel && setup.sessionTypes.length) : step === 2 ? Boolean(setup.competitionIntent) : step === 3 ? Boolean(setup.calculatorSex && (setup.calculatorSex === "manual" || (setup.age && setup.heightCm && setup.weightKg))) : true;
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
    <div className="onboarding-progress" aria-label={`Setup step ${step + 1} of 6`}><i style={{ width: `${((step + 1) / 6) * 100}%` }} /></div>
    <section className="onboarding-card">
      {step === 0 && <><p className="eyebrow">YOUR FIGHTER PROFILE</p><h1>What do you train, {displayName}?</h1><p>Pick every discipline that matters to your game.</p><div className="setup-chip-grid">{disciplineOptions.map((item) => <button className={setup.disciplines.includes(item) ? "selected" : ""} onClick={() => update("disciplines", toggle(setup.disciplines, item))} key={item}>{setup.disciplines.includes(item) && <Check size={14} />}{item}</button>)}</div></>}
      {step === 1 && <><p className="eyebrow">YOUR TRAINING RHYTHM</p><h1>How do you usually train?</h1><p>This helps FightIQ keep the right load around your practices.</p><p className="setup-label">EXPERIENCE</p><div className="setup-choice-stack">{["New to martial arts", "Building fundamentals", "Experienced competitor", "Advanced / coaching"].map((item) => <button className={setup.experienceLevel === item ? "selected" : ""} onClick={() => update("experienceLevel", item)} key={item}>{item}<Check size={16} /></button>)}</div><p className="setup-label">SESSIONS PER WEEK · {setup.sessionsPerWeek}</p><input className="range-field" type="range" min="1" max="10" value={setup.sessionsPerWeek} onChange={(event) => update("sessionsPerWeek", Number(event.target.value))} /><p className="setup-label">USUAL SESSION TYPES</p><div className="setup-chip-grid compact">{sessionOptions.map((item) => <button className={setup.sessionTypes.includes(item) ? "selected" : ""} onClick={() => update("sessionTypes", toggle(setup.sessionTypes, item))} key={item}>{item}</button>)}</div></>}
      {step === 2 && <><p className="eyebrow">WHERE YOU’RE HEADED</p><h1>What are you building toward?</h1><p>FightIQ will refine this from training, but your intent comes first.</p><p className="setup-label">COMPETITION</p><div className="setup-choice-stack">{["Training for myself", "I may compete", "I compete regularly"].map((item) => <button className={setup.competitionIntent === item ? "selected" : ""} onClick={() => update("competitionIntent", item)} key={item}>{item}<Check size={16} /></button>)}</div><label className="setup-label" htmlFor="setup-focus">CURRENT PRIORITY <em>OPTIONAL</em></label><input id="setup-focus" className="setup-input" value={setup.currentFocus} onChange={(event) => update("currentFocus", event.target.value)} placeholder="e.g. sharper boxing entries" maxLength={240} /><label className="setup-label" htmlFor="setup-influences">FIGHTERS OR STYLES <em>OPTIONAL</em></label><input id="setup-influences" className="setup-input" value={setup.styleInfluences.join(", ")} onChange={(event) => update("styleInfluences", event.target.value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 8))} placeholder="e.g. Volkanovski, pressure boxing" /></>}
      {step === 3 && <><p className="eyebrow">FUEL YOUR TRAINING</p><h1>Set a useful starting point.</h1><p>Adults only. These give FightIQ an editable performance estimate—not medical advice.</p><p className="setup-label">NUTRITION GOAL</p><div className="setup-chip-grid compact">{[["performance", "Performance"], ["cut", "Cut"], ["maintain", "Maintain"], ["gain muscle", "Gain muscle"]].map(([value, label]) => <button className={setup.primaryGoal === value ? "selected" : ""} onClick={() => update("primaryGoal", value as Setup["primaryGoal"])} key={value}>{label}</button>)}</div><p className="setup-label">HOW SHOULD WE CALCULATE?</p><div className="setup-choice-stack">{[["female", "Use female equation"], ["male", "Use male equation"], ["manual", "Use editable starter targets"]].map(([value, label]) => <button className={setup.calculatorSex === value ? "selected" : ""} onClick={() => update("calculatorSex", value as Setup["calculatorSex"])} key={value}>{label}<Check size={16} /></button>)}</div>{setup.calculatorSex && setup.calculatorSex !== "manual" && <div className="setup-number-grid"><label>AGE<input inputMode="numeric" value={setup.age} onChange={(event) => update("age", event.target.value.replace(/\D/g, ""))} /></label><label>HEIGHT CM<input inputMode="numeric" value={setup.heightCm} onChange={(event) => update("heightCm", event.target.value.replace(/\D/g, ""))} /></label><label>WEIGHT KG<input inputMode="decimal" value={setup.weightKg} onChange={(event) => update("weightKg", event.target.value)} /></label></div>}</>}
      {step === 4 && <><p className="eyebrow">MAKE FOOD REALISTIC</p><h1>How do you prefer to eat?</h1><p>FightIQ will use this to make food guidance fit your actual life.</p><p className="setup-label">DIETARY RESTRICTIONS <em>OPTIONAL</em></p><div className="setup-chip-grid compact">{restrictionOptions.map((item) => <button className={setup.dietaryRestrictions.includes(item) ? "selected" : ""} onClick={() => update("dietaryRestrictions", toggle(setup.dietaryRestrictions, item))} key={item}>{item}</button>)}</div><label className="setup-label" htmlFor="setup-preferences">FOODS YOU LIKE TO PRIORITIZE <em>OPTIONAL</em></label><input id="setup-preferences" className="setup-input" value={setup.foodPreferences} onChange={(event) => update("foodPreferences", event.target.value)} placeholder="e.g. simple high-protein meals, rice, fruit" /><label className="setup-label" htmlFor="setup-avoid">FOODS TO AVOID <em>OPTIONAL</em></label><input id="setup-avoid" className="setup-input" value={setup.foodsToAvoid} onChange={(event) => update("foodsToAvoid", event.target.value)} placeholder="e.g. dairy before training" /><div className="setup-number-grid two"><label>MEALS PER DAY<input inputMode="numeric" value={setup.mealsPerDay} onChange={(event) => update("mealsPerDay", event.target.value.replace(/\D/g, ""))} /></label><label>USUAL TRAINING TIME<input value={setup.trainingTime} onChange={(event) => update("trainingTime", event.target.value)} placeholder="Evening" /></label></div></>}
      {step === 5 && <><p className="eyebrow">READY TO TRAIN WITH DIRECTION</p><h1>Your athlete profile is set.</h1><p>FightIQ will treat this as your starting point, then let your actual training lead the conversation.</p><div className="setup-review"><Target size={19} /><div><span>TRAINING</span><strong>{setup.disciplines.join(" · ")} · {setup.sessionsPerWeek} sessions/week</strong></div><div><span>FUEL</span><strong>{setup.primaryGoal} · {setup.mealsPerDay || "Flexible"} meals/day</strong></div><div><span>COACHING</span><strong>{setup.currentFocus || "FightIQ will find your first focus from training."}</strong></div></div>{error && <p className="error-message" role="alert">{error}</p>}</>}
      <footer className="onboarding-actions">{step > 0 ? <button className="setup-back" onClick={() => setStep((current) => current - 1)}><ChevronLeft size={17} /> Back</button> : <span />}{step < 5 ? <button className="primary-button setup-next" disabled={!nextAllowed} onClick={() => setStep((current) => current + 1)}>Continue <ChevronRight size={18} /></button> : <button className="primary-button setup-next" disabled={saving} onClick={() => void complete()}>{saving ? "SAVING YOUR PROFILE…" : "ENTER FIGHTIQ"}</button>}</footer>
    </section>
  </main>;
}
