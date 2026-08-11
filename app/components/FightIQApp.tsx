"use client";
/* eslint-disable @next/next/no-img-element -- this is a third-party YouTube thumbnail, not an app-owned image asset. */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ArrowLeft, BookOpen, Bot, Check, ChevronRight, CircleUserRound,
  Dumbbell, Home, Mic, RefreshCw, Send, Sparkles, Utensils, X,
} from "lucide-react";
import { CoachScreen, FoodScreen, GameScreen, LearnScreen, type ProductData, WorkoutScreen } from "./ProductScreens";
import { AthleteOnboarding } from "./AthleteOnboarding";
import { clearDraft, draftAge, newClientKey, readDraft, writeDraft } from "../../lib/training-draft";
import { openingGreeting } from "../../lib/first-session";
import { disciplineFromSetup, notePlaceholder, sessionTypeFromSetup } from "../../lib/log-defaults";
import { SafetyNotice, type SafetySignal } from "./SafetyNotice";
import { ReturnToTraining, type HoldView } from "./ReturnToTraining";

/** Which door the athlete signed in through. Only sign out cares. */
type AuthProvider = "email" | "chatgpt";

type Screen = "home" | "learn" | "coach" | "game" | "log" | "workout" | "food" | "onboarding";
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

const disciplines = ["MMA", "BJJ", "Wrestling", "Boxing", "Muay Thai", "Kickboxing", "Judo", "Other"];
const sessionTypes = ["Class", "Drilling", "Sparring", "Open mat", "Private"];
const homePosterImages = [
  "/fighter-posters/blue-corner.jpg",
  "/fighter-posters/grappling-room.jpg",
  "/fighter-posters/kick-room.jpg",
  "/fighter-posters/mat-room.jpg",
  "/fighter-posters/cage-room.jpg",
];
const homePosterStorageKey = "fightiq-last-home-poster";

type DebriefState = {
  entryId: string;
  status: "not_started" | "preparing" | "question" | "complete" | "error";
  summary?: string | null;
  takeaway?: string;
  fightiqExplanation?: string | null;
  coachDetail?: string | null;
  nextSessionFocus?: string | null;
  memoryUpdated?: boolean;
  answeredCount?: number;
  questionCount?: number;
  maxQuestions?: number;
  question?: { id: string; sequence: number; prompt: string; choices: string[]; targetField: string };
  safety?: SafetySignal;
  hold?: HoldView | null;
};

/** What /api/pre-training/start says back: the plan was accepted, or here is why not. */
type StartTrainingOutcome = { safety: SafetySignal | null; hold: HoldView | null; conflict: string };

type PreTrainingBrief = { mission: string; reason: string; cue: string };

function trainingDomain(value: string) {
  const lower = value.toLowerCase();
  if (/muay thai|kickbox|boxing|strik|round kick|teep|jab|cross|hook/.test(lower)) return "striking";
  if (/wrestl|single leg|double leg|takedown/.test(lower)) return "wrestling";
  if (/bjj|jiu.?jitsu|grappl|arm drag|guard|mount|back take|frame/.test(lower)) return "grappling";
  if (/\bmma\b/.test(lower)) return "mma";
  return "";
}

function briefForSession(brief: PreTrainingBrief, sessionPlan: string): PreTrainingBrief {
  const sessionDomain = trainingDomain(sessionPlan);
  const briefDomain = trainingDomain(`${brief.mission} ${brief.reason}`);
  const compatible = !sessionDomain || sessionDomain === "mma" || !briefDomain || briefDomain === "mma" || sessionDomain === briefDomain || (sessionDomain === "grappling" && briefDomain === "wrestling") || (sessionDomain === "wrestling" && briefDomain === "grappling");
  if (compatible) return brief;
  return {
    mission: `Choose one detail to test in ${sessionPlan}`,
    reason: `Your current focus is better saved for a matching session. Today, take one useful detail from ${sessionPlan} and notice how it feels.`,
    cue: "Notice the first moment it changes.",
  };
}

function useDialogDismiss(onClose: () => void) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onCloseRef.current(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return closeRef;
}

function PreTrainingCheckIn({ brief, onClose, onStart, safety, hold, conflict }: { brief: PreTrainingBrief; onClose: () => void; onStart: (sessionPlan: string) => Promise<void>; safety: SafetySignal | null; hold: HoldView | null; conflict: string }) {
  const [sessionPlan, setSessionPlan] = useState("");
  const [showBrief, setShowBrief] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const closeRef = useDialogDismiss(onClose);
  const suggestedSessions = ["MMA class", "BJJ class", "Muay Thai class", "Sparring", "Open mat"];
  const sessionBrief = briefForSession(brief, sessionPlan);
  // A hold or a fresh head-knock replaces the brief entirely. Showing a mission
  // underneath one would be FightIQ hedging about the only thing that matters.
  const blocked = Boolean(safety) || Boolean(hold);
  async function beginTraining() {
    if (!sessionPlan.trim() || starting) return;
    setStarting(true); setError("");
    try { await onStart(sessionPlan.trim()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "FightIQ couldn’t start that training brief."); }
    finally { setStarting(false); }
  }
  return <div className="sheet-backdrop"><section className="pre-training-checkin" role="dialog" aria-modal="true" aria-labelledby="pre-training-title">
    <button ref={closeRef} className="sheet-close" onClick={onClose} aria-label="Close pre-training brief"><X size={18} /></button>
    {!showBrief ? <>
      <p className="eyebrow">BEFORE TRAINING</p><h2 id="pre-training-title">What are you training today?</h2><p>One line is enough. FightIQ will pull forward the one thing worth remembering.</p>
      <div className="session-options">{suggestedSessions.map((session) => <button key={session} className={sessionPlan === session ? "selected" : ""} onClick={() => setSessionPlan(session)}>{session}</button>)}</div>
      <label className="field-label" htmlFor="session-plan">OR TELL FIGHTIQ YOUR PLAN</label>
      <input id="session-plan" className="session-plan-input" value={sessionPlan} onChange={(event) => setSessionPlan(event.target.value)} placeholder="e.g. Muay Thai class, then light sparring" maxLength={240} />
      <button className="primary-button" onClick={() => setShowBrief(true)} disabled={!sessionPlan.trim()}>SHOW MY BRIEF <ChevronRight size={18} /></button>
    </> : <>
      <button className="back-to-plan" onClick={() => setShowBrief(false)}><ArrowLeft size={15} /> Change session</button>
      <p className="eyebrow">YOUR QUICK RECAP</p><h2 id="pre-training-title">For {sessionPlan}</h2><p className="brief-intro">This is the one thread to carry in from your recent training.</p>
      {safety && <SafetyNotice signal={safety} storageKey={`fightiq-safety-plan-${safety.matched.join("-")}`} />}
      {hold && <>
        {conflict && <p className="rtt-conflict" role="alert">{conflict}</p>}
        <ReturnToTraining hold={hold} compact />
      </>}
      {!blocked && <><div className="brief-detail"><span>MISSION</span><strong>{sessionBrief.mission}</strong><p>{sessionBrief.reason}</p></div>
      <div className="brief-cue"><span>ONE CUE</span><strong>{sessionBrief.cue}</strong></div></>}
      {error && <p className="error-message" role="alert">{error}</p>}
      {!blocked && <><button className="primary-button" onClick={() => void beginTraining()} disabled={starting}>{starting ? "SETTING YOUR BRIEF…" : "I’M TRAINING NOW"}</button>
      <p className="checkin-note">FightIQ will ask how this went when you log afterward.</p></>}
    </>}
  </section></div>;
}

/**
 * Signing out has to match the door somebody came in through. An email account
 * sent to the ChatGPT sign out route stays signed in and looks broken.
 */
function SignOutButton({ name, provider }: { name: string; provider: AuthProvider }) {
  const [busy, setBusy] = useState(false);
  const initial = name.slice(0, 1).toUpperCase();
  if (provider === "chatgpt") {
    return <a className="avatar home-profile" href="/signout-with-chatgpt?return_to=%2F" aria-label="Sign out" title="Sign out">{initial}</a>;
  }
  return <button className="avatar home-profile" aria-label="Sign out" title="Sign out" disabled={busy} onClick={async () => {
    setBusy(true);
    try { await fetch("/api/auth/signout", { method: "POST" }); } catch { /* the cookie may already be gone */ }
    window.location.href = "/";
  }}>{initial}</button>;
}

function HomeScreen({ name, provider, onLog, onLearn, onGame, onStartTraining, onFinishProfile }: { name: string; provider: AuthProvider; onLog: (activePlan?: string, experimentId?: string) => void; onLearn: () => void; onGame: () => void; onStartTraining: (sessionPlan: string) => Promise<StartTrainingOutcome>; onFinishProfile: () => void }) {
  const [localTime, setLocalTime] = useState({ date: "Today", greeting: "Welcome back" });
  const [product, setProduct] = useState<ProductData | null>(null);
  const [briefOpen, setBriefOpen] = useState(false);
  const [planSafety, setPlanSafety] = useState<SafetySignal | null>(null);
  const [planHold, setPlanHold] = useState<HoldView | null>(null);
  const [planConflict, setPlanConflict] = useState("");
  const [hold, setHold] = useState<HoldView | null>(null);
  const [posterIndex, setPosterIndex] = useState(0);
  useEffect(() => {
    const now = new Date();
    const hour = now.getHours();
    // This intentionally runs after hydration so the date reflects the athlete's device timezone.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalTime({
      date: new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(now),
      greeting: hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening",
    });
  }, []);
  useEffect(() => {
    let next = 0;
    try {
      const previous = Number(window.sessionStorage.getItem(homePosterStorageKey));
      const alternatives = homePosterImages.map((_, index) => index).filter((index) => index !== previous);
      next = alternatives[Math.floor(Math.random() * alternatives.length)] ?? 0;
      window.sessionStorage.setItem(homePosterStorageKey, String(next));
    } catch { next = Math.floor(Math.random() * homePosterImages.length); }
    // This runs after hydration, so a new app visit gets a fresh poster without an SSR mismatch.
    const frame = window.requestAnimationFrame(() => setPosterIndex(next));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  useEffect(() => { void fetch("/api/product").then((response) => response.ok ? response.json() : null).then((data) => setProduct(data as ProductData | null)).catch(() => undefined); }, []);
  // An open hold is the first thing on this screen and the last thing to be
  // dismissed by a refresh: it is read back from the server on every visit.
  useEffect(() => { void fetch("/api/safety/hold").then((response) => response.ok ? response.json() : null).then((data) => setHold((data as { hold?: HoldView | null } | null)?.hold ?? null)).catch(() => undefined); }, []);
  const insight = product?.insight ?? { title: "Build your baseline.", body: "Log today’s training and FightIQ will give you one clear thing to work on next.", currentFocus: "Build your fighter memory" };
  const firstVideo = product?.videos[0];
  const brief = product?.preTrainingBrief;
  const activeExperiment = product?.activeExperiment;
  const weeklyTarget = product?.profile.athleteSetup.sessionsPerWeek ?? 0;
  const startOfWeek = new Date();
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
  const weeklySessions = (product?.memory.recentTraining ?? []).filter((entry) => new Date(entry.createdAt) >= startOfWeek).length;
  const completedSessions = weeklyTarget ? Math.min(weeklySessions, weeklyTarget) : weeklySessions;
  const focusProgress = weeklyTarget ? Math.min(100, Math.round((weeklySessions / weeklyTarget) * 100)) : 0;
  const focusMeterStyle = { "--focus-progress": `${focusProgress}%` } as CSSProperties;
  const briefLabel = activeExperiment ? "TRAINING NOW" : "TRAIN NEXT";
  // Before the first session there is no brief built from training, so the rail
  // carries the opening cue rather than sitting empty on the busiest screen.
  const opening = product?.opening ?? null;
  const briefDetail = activeExperiment ? activeExperiment.cue : opening?.cue ?? brief?.cue;
  return (
    <main className="page home-page native-page">
      <header className="app-header home-header"><div><p className="wordmark">FIGHT<span>IQ</span></p></div><div className="home-header-tools"><SignOutButton name={name} provider={provider} />{opening
        // A 0/3 score before anybody has trained reads as a failing grade for
        // turning up. On day one the meter shows the target instead.
        ? <button className="home-focus-meter first-week" onClick={onGame} aria-label={weeklyTarget ? `Your target is ${weeklyTarget} sessions a week. Open My Game.` : "Open My Game."}><span>{weeklyTarget || "-"}</span><small>{weeklyTarget ? "TARGET" : "FOCUS"}</small></button>
        : <button className="home-focus-meter" style={focusMeterStyle} onClick={onGame} aria-label={weeklyTarget ? `${completedSessions} of ${weeklyTarget} planned training sessions completed this week. Open My Game.` : "Open My Game."}><span>{weeklyTarget ? `${completedSessions}/${weeklyTarget}` : "0"}</span><small>FOCUS</small></button>}</div></header>
      <p className="date-line home-date">{localTime.date}</p>
      <h1 className="greeting">{localTime.greeting}, {name}</h1>
      <p className="subgreeting">{openingGreeting(product ? product.sessionsLogged : 3)}</p>
      {hold?.open && <ReturnToTraining hold={hold} onChange={setHold} />}
      {product?.onboarding.status === "legacy" && <button className="finish-profile-banner" onClick={onFinishProfile}><span>ATHLETE PROFILE</span><strong>Finish your setup so FightIQ can tailor training, fuel, and recovery.</strong><ChevronRight size={18} /></button>}

      {opening ? (
        // Day one. Six setup screens have to buy something, and what they buy is
        // this: the fault that is usually there at their level, what to watch
        // for tonight, and a straight admission that it is not a read on them.
        <section className="home-opening" aria-label="Your first session">
          <p className="eyebrow">START HERE</p>
          <h2>{opening.title}</h2>
          <p className="home-opening-body">{opening.body}</p>
          <p className="home-opening-watch"><span>TONIGHT</span>{opening.watchFor}</p>
          <p className="home-opening-promise">{opening.promise}</p>
        </section>
      ) : (
        <section className="home-reference-insight" aria-label="FightIQ insight">
          <div className="home-insight-copy">
            <p className="eyebrow">FIGHTIQ INSIGHT</p>
            <h2>{insight.title}</h2>
            <p className="home-insight-body">{insight.body}</p>
            <button className="home-insight-link" onClick={onGame}>OPEN MY GAME <ChevronRight size={14} /></button>
          </div>
          <div className="home-insight-media" aria-hidden="true">
            <img src={homePosterImages[posterIndex]} alt="" decoding="async" onError={(event) => { event.currentTarget.style.display = "none"; }} />
          </div>
        </section>
      )}

      {(brief || opening) && <button className={`home-brief-rail ${activeExperiment ? "active" : ""}`} onClick={() => activeExperiment ? onLog(activeExperiment.reason, activeExperiment.id) : setBriefOpen(true)}><span>{briefLabel}</span><strong>{briefDetail}</strong><em>{activeExperiment ? "LOG THE RESULT" : "START BRIEF"}</em><ChevronRight size={15} /></button>}

      <button className="primary-button home-log-button" onClick={() => onLog(activeExperiment?.reason, activeExperiment?.id)}><Mic size={18} strokeWidth={2.2} /><span>{activeExperiment ? "LOG HOW IT WENT" : opening ? "LOG YOUR FIRST SESSION" : "LOG TODAY’S TRAINING"}</span><ChevronRight size={17} /></button>

      {firstVideo ? <section className="home-plan-section" aria-label="Your next video"><div className="home-plan-heading"><span>WATCH NEXT</span><button onClick={onLearn}>MORE</button></div><button className="home-study home-personal-plan" onClick={onLearn}>{firstVideo.thumbnail && <img src={firstVideo.thumbnail} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />}<div><strong>{firstVideo.title}</strong><small>{firstVideo.watchFor}</small></div><ChevronRight size={17} /></button></section> : <button className="memory-prompt" onClick={() => onLog()}><Sparkles size={18} /><span><strong>Log training to get your first video.</strong></span><ChevronRight size={17} /></button>}
      {briefOpen && brief && <PreTrainingCheckIn brief={brief} safety={planSafety} hold={planHold} conflict={planConflict} onClose={() => { setPlanSafety(null); setPlanHold(null); setPlanConflict(""); setBriefOpen(false); }} onStart={async (sessionPlan) => {
        const outcome = await onStartTraining(sessionPlan);
        if (outcome.hold) setHold(outcome.hold);
        // A held session keeps the sheet open on the notice rather than
        // confirming a brief the athlete should not be acting on.
        if (outcome.safety || outcome.conflict) {
          setPlanSafety(outcome.safety);
          setPlanHold(outcome.conflict ? outcome.hold : null);
          setPlanConflict(outcome.conflict);
          return;
        }
        setPlanSafety(null); setPlanHold(null); setPlanConflict("");
        const response = await fetch("/api/product");
        if (response.ok) setProduct(await response.json() as ProductData);
        setBriefOpen(false);
      }} />}
    </main>
  );
}

function sessionPlanLabel(plan?: string | null) {
  const match = plan?.match(/^For\s+(.+?):\s+/i);
  return match?.[1] ?? plan?.trim() ?? "";
}

function disciplineForPlan(plan: string | null | undefined, fallback: string) {
  const value = sessionPlanLabel(plan).toLowerCase();
  if (value.includes("muay thai")) return "Muay Thai";
  if (value.includes("kickbox")) return "Kickboxing";
  if (value.includes("boxing")) return "Boxing";
  if (value.includes("wrestl")) return "Wrestling";
  if (/bjj|jiu.?jitsu/.test(value)) return "BJJ";
  if (value.includes("judo")) return "Judo";
  // No plan, or a plan that named no sport. Their setup decides, not this file.
  return fallback;
}

function sessionTypeForPlan(plan: string | null | undefined, fallback: string) {
  const value = sessionPlanLabel(plan).toLowerCase();
  if (value.includes("sparring")) return "Sparring";
  if (value.includes("open mat")) return "Open mat";
  if (value.includes("drill")) return "Drilling";
  if (value.includes("private")) return "Private";
  return fallback;
}

type LogDefaults = { discipline: string; sessionType: string; firstSession: boolean; watchFor: string };

function TrainingLog({ onBack, initialEntryId, activePlan, activeExperimentId, defaults }: { onBack: () => void; initialEntryId: string | null; activePlan?: string | null; activeExperimentId?: string | null; defaults: LogDefaults }) {
  // The unsaved note is read back before the first render, so an athlete who
  // lost signal, backgrounded the app or ran the battery flat opens the log
  // screen and finds their own words already there.
  const restored = useState(() => (typeof window === "undefined" || initialEntryId ? null : readDraft(window.localStorage)))[0];
  const [discipline, setDiscipline] = useState(() => restored?.discipline ?? disciplineForPlan(activePlan, defaults.discipline));
  const [sessionType, setSessionType] = useState(() => restored?.sessionType ?? sessionTypeForPlan(activePlan, defaults.sessionType));
  const [transcript, setTranscript] = useState(() => restored?.text ?? "");
  const [draftNotice, setDraftNotice] = useState(() => (restored ? `Restored the note you didn’t get to save · ${draftAge(restored.savedAt)}` : ""));
  // One id for this note for as long as it exists unsaved. A retry after a lost
  // reply sends the same one, so the server can tell a retry from a new session.
  const clientKeyRef = useRef(restored?.clientKey ?? newClientKey());
  const [offlineHold, setOfflineHold] = useState(false);
  const [listening, setListening] = useState(false);
  const [answerListening, setAnswerListening] = useState(false);
  const [speechAvailable, setSpeechAvailable] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [entryId, setEntryId] = useState<string | null>(initialEntryId);
  const [debrief, setDebrief] = useState<DebriefState | null>(null);
  const [debriefPhase, setDebriefPhase] = useState<"log" | "loading" | "question" | "complete" | "error">(initialEntryId ? "loading" : "log");
  const [answer, setAnswer] = useState("");
  const [answerMethod, setAnswerMethod] = useState<"text" | "voice">("text");
  const [showCustomAnswer, setShowCustomAnswer] = useState(false);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const questionHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const restoredRef = useRef(false);
  const debriefPollRef = useRef<number | null>(null);
  const debriefPollAttemptsRef = useRef(0);

  useEffect(() => () => { recognitionRef.current?.stop(); if (debriefPollRef.current) window.clearTimeout(debriefPollRef.current); }, []);
  useEffect(() => {
    if (entryId) return;
    const timer = window.setTimeout(() => {
      writeDraft(window.localStorage, { text: transcript, discipline, sessionType, savedAt: new Date().toISOString(), clientKey: clientKeyRef.current });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [transcript, discipline, sessionType, entryId]);
  useEffect(() => { if (debriefPhase === "question") questionHeadingRef.current?.focus(); }, [debriefPhase, debrief?.question?.id]);

  function scheduleDebriefPoll(id: string) {
    if (debriefPollRef.current) window.clearTimeout(debriefPollRef.current);
    if (debriefPollAttemptsRef.current >= 40) {
      setError("Your note is still safe. FightIQ is taking longer than expected. Try again when you’re ready.");
      setDebriefPhase("error");
      return;
    }
    debriefPollAttemptsRef.current += 1;
    debriefPollRef.current = window.setTimeout(() => { void startDebrief(id); }, 1200);
  }

  function toggleListening() {
    if (listening) { recognitionRef.current?.stop(); setListening(false); return; }
    const SpeechRecognition = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
    if (!SpeechRecognition) { setSpeechAvailable(false); return; }
    const recognition = new SpeechRecognition();
    recognition.continuous = true; recognition.interimResults = true; recognition.lang = "en-US";
    recognition.onresult = (event) => {
      let combined = "";
      for (let i = 0; i < event.results.length; i += 1) combined += `${event.results[i][0].transcript} `;
      setTranscript(combined.trim());
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => { setListening(false); setError("I couldn’t access the microphone. You can type your session instead."); };
    recognitionRef.current = recognition; recognition.start(); setListening(true); setError("");
  }

  function toggleAnswerListening() {
    if (answerListening) { recognitionRef.current?.stop(); setAnswerListening(false); return; }
    const SpeechRecognition = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
    if (!SpeechRecognition) { setSpeechAvailable(false); setError("Voice isn’t available here. You can type your answer instead."); return; }
    const recognition = new SpeechRecognition();
    recognition.continuous = true; recognition.interimResults = true; recognition.lang = "en-US";
    recognition.onresult = (event) => {
      let combined = "";
      for (let i = 0; i < event.results.length; i += 1) combined += `${event.results[i][0].transcript} `;
      setAnswer(combined.trim()); setAnswerMethod("voice");
    };
    recognition.onend = () => setAnswerListening(false);
    recognition.onerror = () => { setAnswerListening(false); setError("I couldn’t access the microphone. Your typed answer is still here."); };
    recognitionRef.current = recognition; recognition.start(); setAnswerListening(true); setError("");
  }

  async function saveEntry() {
    if (!transcript.trim() || saving) return;
    setSaving(true); setError(""); setDraftNotice("");
    try {
      const response = await fetch("/api/training-entries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ discipline, sessionType, rawEntry: transcript.trim(), clientKey: clientKeyRef.current, ...(activeExperimentId ? { experimentId: activeExperimentId } : {}) }) });
      if (!response.ok) throw new Error("save failed");
      const data = await response.json() as { id: string };
      setEntryId(data.id);
      setOfflineHold(false);
      // The note is on the server. The next one starts a new identity.
      clientKeyRef.current = newClientKey();
      clearDraft(window.localStorage);
      window.history.replaceState({}, "", `/?debrief=${encodeURIComponent(data.id)}`);
      await startDebrief(data.id);
    } catch {
      // Nothing is lost here: the note is already on the device, and it stays
      // there until the server has it.
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      setOfflineHold(true);
      setError(offline
        ? "No connection. Your note is safe on this phone, and FightIQ will send it the moment you are back online."
        : "FightIQ couldn’t reach the server. Your note is safe on this phone. Try again, or come back to it later.");
    } finally { setSaving(false); }
  }

  async function parseResponse(response: Response) {
    const data = await response.json() as DebriefState & { error?: { message?: string; code?: string } };
    if (!response.ok) {
      // The code decides whether "try again" is honest advice or a lie. A
      // deployment with no model key will fail this way for ever.
      setErrorCode(data.error?.code ?? "");
      // The safety card and the hold come back on the error too, because
      // neither of them ever depended on the model. Keep them on screen.
      if (data.safety || data.hold) setDebrief((current) => ({ ...(current ?? { entryId: entryId ?? "", status: "error" as const }), safety: data.safety, hold: data.hold }));
      throw new Error(data.error?.message ?? "FightIQ couldn’t continue the debrief.");
    }
    setDebrief(data);
    setError(""); setErrorCode("");
    if (data.status === "question") { debriefPollAttemptsRef.current = 0; setDebriefPhase("question"); }
    else if (data.status === "complete") { debriefPollAttemptsRef.current = 0; setDebriefPhase("complete"); }
    else if (data.status === "error") { debriefPollAttemptsRef.current = 0; setDebriefPhase("error"); }
    else { setDebriefPhase("loading"); }
    return data;
  }

  async function startDebrief(id: string) {
    setDebriefPhase("loading"); setError("");
    try {
      const data = await parseResponse(await fetch(`/api/training-entries/${encodeURIComponent(id)}/debrief`, { method: "POST" }));
      if (data.status === "not_started" || data.status === "preparing") scheduleDebriefPoll(id);
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : "FightIQ couldn’t prepare your debrief."); setDebriefPhase("error"); }
  }

  async function restoreDebrief(id: string) {
    setDebriefPhase("loading");
    try {
      const data = await parseResponse(await fetch(`/api/training-entries/${encodeURIComponent(id)}/debrief`));
      if (data.status === "not_started" || data.status === "preparing") await startDebrief(id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "FightIQ couldn’t restore your debrief."); setDebriefPhase("error"); }
  }

  useEffect(() => {
    if (!initialEntryId || restoredRef.current) return;
    restoredRef.current = true;
    void restoreDebrief(initialEntryId);
    // Restore is deliberately keyed only to the entry in the URL; its request helpers do not
    // represent reactive inputs and including them would restart an in-flight debrief.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEntryId]);

  async function respond(action: "answer" | "skip" | "finish", value = answer, method: "chip" | "text" | "voice" = answerMethod) {
    if (!entryId || submitting) return;
    if (action === "answer" && !value.trim()) return;
    setSubmitting(true); setError(""); recognitionRef.current?.stop();
    try {
      const response = await fetch(`/api/training-entries/${encodeURIComponent(entryId)}/debrief/respond`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, questionId: debrief?.question?.id, answer: value.trim(), inputMethod: method }),
      });
      if (!response.ok && action === "answer") {
        const payload = await response.clone().json() as { error?: { code?: string } };
        // A response can be lost after the server already saved the answer. Ask
        // the entry to resume rather than asking the athlete to repeat themself.
        if (payload.error?.code === "QUESTION_NOT_FOUND") { await startDebrief(entryId); return; }
      }
      setDebriefPhase("loading");
      const data = await parseResponse(response);
      if (data.status === "preparing" || data.status === "not_started") scheduleDebriefPoll(entryId);
      setAnswer(""); setAnswerMethod("text");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your answer was saved, but FightIQ couldn’t continue.");
      // Keep the exact question and typed/spoken wording on screen. The Retry
      // path will resume the saved turn without throwing the athlete into a
      // generic error screen.
      setDebriefPhase(action === "answer" && debrief?.question ? "question" : "error");
    }
    finally { setSubmitting(false); setAnswerListening(false); }
  }

  // Signal comes back in the car park. The note goes without being asked twice.
  useEffect(() => {
    if (!offlineHold) return;
    const retry = () => { void saveEntry(); };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  });

  if (debriefPhase === "loading") return (
    <main className="page analysis-page">
      <header className="page-header"><button className="icon-button" onClick={onBack} aria-label="Back home"><ArrowLeft size={19} /></button><h1 className="page-title">Training debrief</h1></header>
      {debrief?.safety && entryId && <SafetyNotice signal={debrief.safety} storageKey={`fightiq-safety-${entryId}`} />}
      {debrief?.hold?.open && <ReturnToTraining hold={debrief.hold} onChange={(next) => setDebrief((current) => current ? { ...current, hold: next } : current)} />}
      <section className="debrief-loading" aria-live="polite"><span className="thinking-mark"><Sparkles size={25} /></span><p className="eyebrow">YOUR NOTE IS SAFE</p><h2>FightIQ is finding the useful detail.</h2><p>You can leave at any time. Your training entry is already saved.</p></section>
    </main>
  );

  if (debriefPhase === "error") return (
    <main className="page analysis-page">
      <header className="page-header"><button className="icon-button" onClick={onBack} aria-label="Back home"><ArrowLeft size={19} /></button><h1 className="page-title">Training saved</h1></header>
      {debrief?.safety && entryId && <SafetyNotice signal={debrief.safety} storageKey={`fightiq-safety-${entryId}`} />}
      {debrief?.hold?.open && <ReturnToTraining hold={debrief.hold} onChange={(next) => setDebrief((current) => current ? { ...current, hold: next } : current)} />}
      {errorCode === "AI_NOT_CONFIGURED"
        // Retrying this cannot work, and saying "try again" to someone whose
        // deployment is missing a key wastes their evening. Say what it is.
        ? <div className="debrief-error" role="alert"><p className="eyebrow">YOUR NOTE IS SAVED</p><h2>The reading half isn’t switched on yet.</h2><p>Every session you log is being kept, in full. What is missing is the connection FightIQ uses to read them back to you. That is a setting on this deployment, not something you did. Once it is added, open any past session and the debrief will run on it.</p><button className="quiet-button" onClick={() => respond("finish")}>Back to home</button></div>
        : errorCode === "HOURLY_LIMIT_REACHED" || errorCode === "DAILY_LIMIT_REACHED"
        // A retry button that cannot succeed for ten minutes is worse than none.
        ? <div className="debrief-error" role="status"><p className="eyebrow">YOUR NOTE IS SAVED</p><h2>FightIQ will read this one shortly.</h2><p>{error}</p><button className="quiet-button" onClick={() => respond("finish")}>Back to home</button></div>
        : <div className="debrief-error" role="alert"><p className="eyebrow">YOUR NOTE IS SAFE</p><h2>FightIQ needs another try.</h2><p>{error || "The debrief couldn’t be prepared right now."}</p><button className="primary-button" onClick={() => entryId && startDebrief(entryId)}><RefreshCw size={18} /> RETRY DEBRIEF</button><button className="quiet-button" onClick={() => respond("finish")}>Finish for now</button></div>}
    </main>
  );

  if (debriefPhase === "question" && debrief?.question) return (
    <main className="page analysis-page">
      <header className="page-header"><button className="icon-button" onClick={onBack} aria-label="Back home"><ArrowLeft size={19} /></button><div><p className="question-progress">A QUICK FOLLOW-UP</p><h1 className="page-title">Training debrief</h1></div></header>
      {debrief.safety && entryId && <SafetyNotice signal={debrief.safety} storageKey={`fightiq-safety-${entryId}`} />}
      {debrief.hold?.open && <ReturnToTraining hold={debrief.hold} onChange={(next) => setDebrief((current) => current ? { ...current, hold: next } : current)} />}
      <section className="takeaway-card"><p className="eyebrow">KEY TAKEAWAY</p><p>{debrief.takeaway}</p>{debrief.coachDetail && <p className="logged-coach-cue"><span>COACH CUE YOU LOGGED</span>{debrief.coachDetail}</p>}</section>
      <section className="question-card">
        <p className="eyebrow">QUICK QUESTION</p>
        <h2 ref={questionHeadingRef} tabIndex={-1}>{debrief.question.prompt}</h2>
        {debrief.question.choices.length > 0 && <><p className="tap-answer-label">CHOOSE THE CLOSEST ANSWER</p><div className="answer-choices">{debrief.question.choices.map((choice) => <button key={choice} onClick={() => respond("answer", choice, "chip")} disabled={submitting}>{choice}<ChevronRight size={16} /></button>)}<button onClick={() => respond("answer", "Not sure", "chip")} disabled={submitting}>Not sure<ChevronRight size={16} /></button></div></>}
        {!showCustomAnswer && debrief.question.choices.length > 0 ? <button className="type-toggle debrief-custom-answer" onClick={() => setShowCustomAnswer(true)}>Give a different answer</button> : <><div className="answer-compose"><textarea value={answer} onChange={(event) => { setAnswer(event.target.value); setAnswerMethod("text"); }} placeholder="Talk or type your answer…" aria-label="Your answer" /><button className={`answer-mic ${answerListening ? "listening" : ""}`} onClick={toggleAnswerListening} aria-label={answerListening ? "Stop listening" : "Answer by voice"}>{answerListening ? <X size={20} /> : <Mic size={20} />}</button></div><button className="primary-button" onClick={() => respond("answer")} disabled={!answer.trim() || submitting}>{submitting ? "UPDATING…" : <><Send size={18} /> {error ? "RETRY ANSWER" : "SEND ANSWER"}</>}</button></>}
        {error && <p className="error-message" role="alert">{error}</p>}
        <div className="debrief-secondary-actions"><button onClick={() => respond("skip")} disabled={submitting}>Skip this question</button><span aria-hidden="true">·</span><button onClick={() => respond("finish")} disabled={submitting}>Finish for now</button></div>
      </section>
      <p className="sr-status" aria-live="polite">{submitting ? "Saving your answer and preparing the next step." : ""}</p>
    </main>
  );

  if (debriefPhase === "complete") return (
    <main className="page analysis-page">
      <header className="page-header"><button className="icon-button" onClick={onBack} aria-label="Back home"><ArrowLeft size={19} /></button><h1 className="page-title">Debrief complete</h1></header>
      {debrief?.safety && entryId && <SafetyNotice signal={debrief.safety} storageKey={`fightiq-safety-${entryId}`} />}
      {debrief?.hold?.open && <ReturnToTraining hold={debrief.hold} onChange={(next) => setDebrief((current) => current ? { ...current, hold: next } : current)} />}
      <div className="success-card"><div className="success-icon"><Check size={20} /></div><p className="eyebrow">{debrief?.memoryUpdated ? "MEMORY UPDATED" : "SESSION SAVED"}</p><h2>{debrief?.memoryUpdated ? "Got it." : "Your note is safe."}</h2>{debrief?.summary && <div className="result-block"><span>SUMMARY</span><p>{debrief.summary}</p></div>}<div className="result-block"><span>{debrief?.memoryUpdated ? "KEY INSIGHT" : "SAVED NOTE"}</span><p>{debrief?.takeaway ?? "Your training note has been saved."}</p></div>{debrief?.nextSessionFocus && (debrief.hold?.open && !debrief.hold.allowsSkillWork
        ? <div className="next-focus held"><span>NEXT SESSION</span><strong>On hold. Step {debrief.hold.stage.step} of {debrief.hold.totalSteps}.</strong><small>FightIQ keeps what it learned about your technique. It will not tell you what to go and train until you are further up the ladder.</small></div>
        : <div className="next-focus"><span>NEXT SESSION</span><strong>{debrief.nextSessionFocus}</strong></div>)}<button className="primary-button" onClick={onBack}>BACK TO HOME</button></div>
    </main>
  );

  return (
    <main className="page log-page native-page">
      <header className="page-header"><button className="icon-button" onClick={onBack} aria-label="Back home"><ArrowLeft size={19} /></button><h1 className="page-title">Tell FightIQ about training</h1></header>
      <div className="record-intro"><p className="eyebrow">VOICE-FIRST TRAINING LOG</p><p>{activePlan ? `You planned: ${sessionPlanLabel(activePlan)}` : "Just talk naturally. I’ll organize it for you."}</p></div>
      {defaults.firstSession && defaults.watchFor && !activePlan && <p className="log-watch-for"><span>FIGHTIQ ASKED</span>{defaults.watchFor}</p>}
      <div className="mic-stage"><button className={`mic-button ${listening ? "listening" : ""}`} onClick={toggleListening} aria-label={listening ? "Stop listening" : "Start voice entry"}>{listening ? <X size={34} /> : <Mic size={38} />}</button><span className="record-status">{listening ? "Listening… tap to stop" : speechAvailable ? "Tap to start talking" : "Voice isn’t available in this browser"}</span></div>
      <button className="type-toggle" onClick={() => document.getElementById("transcript")?.focus()}>Type instead</button>

      <details className="log-options"><summary>Training details <span>{discipline} · {sessionType}</span></summary><span className="field-label">DISCIPLINE</span><div className="chip-row">{disciplines.map((item) => <button key={item} className={`chip ${discipline === item ? "selected" : ""}`} onClick={() => setDiscipline(item)}>{item}</button>)}</div>
      <span className="field-label">SESSION TYPE</span><div className="chip-row">{sessionTypes.map((item) => <button key={item} className={`chip ${sessionType === item ? "selected" : ""}`} onClick={() => setSessionType(item)}>{item}</button>)}</div></details>
      {draftNotice && <div className="draft-notice" role="status"><span>{draftNotice}</span><button onClick={() => { setTranscript(""); clearDraft(window.localStorage); setDraftNotice(""); }}>Start fresh</button></div>}
      <label className="field-label" htmlFor="transcript">WHAT HAPPENED?</label>
      <textarea id="transcript" className="transcript" value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder={notePlaceholder(discipline)} />
      {error && <p className="error-message" role="alert">{error}</p>}
      <div className="save-row"><button className="primary-button" disabled={!transcript.trim() || saving} onClick={saveEntry}>{saving ? "SAVING…" : <><Send size={18} /> SAVE TRAINING</>}</button></div>
    </main>
  );
}

function ActionSheet({ onClose, onAction }: { onClose: () => void; onAction: (action: string) => void }) {
  const actions = [
    { name: "Log Training", note: "Talk or type your session", icon: Mic },
    { name: "Ask FightIQ", note: "Get personal guidance", icon: Bot },
    { name: "Workout", note: "Train for your martial art", icon: Dumbbell },
    { name: "Food", note: "Support your performance", icon: Utensils },
  ];
  const closeRef = useDialogDismiss(onClose);
  return <div className="sheet-backdrop"><section className="action-sheet" role="dialog" aria-modal="true" aria-label="Quick actions"><div className="sheet-handle" /><button ref={closeRef} className="sheet-close" onClick={onClose} aria-label="Close quick actions"><X size={18} /></button><h2>What do you want to do?</h2><div className="sheet-grid">{actions.map(({ name, note, icon: Icon }) => <button className="sheet-action" key={name} onClick={() => onAction(name)}><Icon size={21} /><strong>{name}</strong><span>{note}</span></button>)}</div></section></div>;
}

export function FightIQApp({ displayName, provider = "chatgpt", initialEntryId = null }: { displayName: string; provider?: AuthProvider; initialEntryId?: string | null }) {
  const [screen, setScreen] = useState<Screen>(initialEntryId ? "log" : "home");
  const [activeEntryId, setActiveEntryId] = useState<string | null>(initialEntryId);
  const [activePlan, setActivePlan] = useState<string | null>(null);
  const [activeExperimentId, setActiveExperimentId] = useState<string | null>(null);
  const [learnTopic, setLearnTopic] = useState<string | null>(null);
  const [learnOrigin, setLearnOrigin] = useState<"coach" | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [onboardingStatus, setOnboardingStatus] = useState<"loading" | "required" | "legacy" | "complete">("loading");
  // What the log screen should assume before it is touched. The discipline here
  // is stored on the session and read back by every model call, so a wrong
  // default is wrong evidence rather than a cosmetic slip.
  const [logDefaults, setLogDefaults] = useState<LogDefaults>({ discipline: "MMA", sessionType: "Class", firstSession: false, watchFor: "" });
  useEffect(() => { void fetch("/api/product").then(async (response) => response.ok ? response.json() as Promise<ProductData> : null).then((data) => {
    setOnboardingStatus(data?.onboarding.status ?? "complete");
    if (data) setLogDefaults({
      discipline: disciplineFromSetup(data.profile.athleteSetup.disciplines),
      sessionType: sessionTypeFromSetup(data.profile.athleteSetup.sessionTypes),
      firstSession: data.sessionsLogged === 0,
      watchFor: data.opening?.watchFor ?? "",
    });
  }).catch(() => setOnboardingStatus("complete")); }, []);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(""), 2600); return () => clearTimeout(id); }, [toast]);
  function goHome() { window.history.replaceState({}, "", "/"); setActiveEntryId(null); setScreen("home"); }
  function act(name: string) {
    setSheetOpen(false);
    if (name === "Log Training") { setActivePlan(null); setActiveExperimentId(null); setScreen("log"); }
    else if (name === "Ask FightIQ") setScreen("coach");
    else if (name === "Workout") setScreen("workout");
    else if (name === "Food") setScreen("food");
  }
  async function startTraining(sessionPlan: string): Promise<StartTrainingOutcome> {
    const response = await fetch("/api/pre-training/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionPlan }) });
    const payload = await response.json() as { experiment?: unknown; safety?: SafetySignal; hold?: HoldView | null; conflict?: string; error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message ?? "FightIQ couldn’t start that training brief.");
    // Setting a mission is FightIQ telling someone to go and train. Two things
    // stop it: a head knock in the plan itself, and a hold opened days ago that
    // this session would break.
    const conflict = payload.conflict ?? "";
    const outcome: StartTrainingOutcome = { safety: payload.safety?.holdTraining ? payload.safety : null, hold: payload.hold ?? null, conflict };
    if (!outcome.safety && !conflict) setToast("Brief set. Tell FightIQ how it went after training.");
    return outcome;
  }
  if (onboardingStatus === "loading") return <main className="setup-loading"><p className="wordmark">FIGHT<span>IQ</span></p><p>Welcome back, {displayName}.<br />Checking your athlete profile…</p></main>;
  if (onboardingStatus === "required" || screen === "onboarding") return <AthleteOnboarding displayName={displayName} onComplete={() => { setOnboardingStatus("complete"); setScreen("home"); }} />;
  return <div className={`app-frame ${screen === "home" ? "home-frame" : ""}`}>
    {screen === "home" && <HomeScreen name={displayName} provider={provider} onLog={(plan, experimentId) => { setActivePlan(plan ?? null); setActiveExperimentId(experimentId ?? null); setScreen("log"); }} onLearn={() => { setLearnTopic(null); setLearnOrigin(null); setScreen("learn"); }} onGame={() => setScreen("game")} onStartTraining={startTraining} onFinishProfile={() => setScreen("onboarding")} />}
    {screen === "log" && <TrainingLog onBack={goHome} initialEntryId={activeEntryId} activePlan={activePlan} activeExperimentId={activeExperimentId} defaults={logDefaults} />}
    {screen === "learn" && <LearnScreen studyTopic={learnTopic} onReturnToFeed={() => { setLearnTopic(null); setLearnOrigin(null); }} onReturnToCoach={learnOrigin === "coach" ? () => { setScreen("coach"); setLearnOrigin(null); } : undefined} />}
    {screen === "coach" && <CoachScreen onStudyVideo={(topic) => { setLearnTopic(topic); setLearnOrigin("coach"); setScreen("learn"); }} />}
    {screen === "game" && <GameScreen />}
    {screen === "workout" && <WorkoutScreen onBack={goHome} />}
    {screen === "food" && <FoodScreen onBack={goHome} />}
    {screen !== "log" && screen !== "workout" && screen !== "food" && <nav className="bottom-nav" aria-label="Primary navigation">
      <button className={`nav-button ${screen === "home" ? "active" : ""}`} onClick={() => setScreen("home")}><Home size={21} /><span>HOME</span></button>
      <button className={`nav-button ${screen === "learn" ? "active" : ""}`} onClick={() => { setLearnTopic(null); setLearnOrigin(null); setScreen("learn"); }}><BookOpen size={21} /><span>LEARN</span></button>
      <button className="nav-button center" onClick={() => setSheetOpen(true)} aria-label="Open FightIQ actions"><span className="nav-center-icon"><Mic size={20} /></span><span>FIGHTIQ</span></button>
      <button className={`nav-button ${screen === "coach" ? "active" : ""}`} onClick={() => setScreen("coach")}><Sparkles size={21} /><span>COACH</span></button>
      <button className={`nav-button ${screen === "game" ? "active" : ""}`} onClick={() => setScreen("game")}><CircleUserRound size={21} /><span>MY GAME</span></button>
    </nav>}
    {sheetOpen && <ActionSheet onClose={() => setSheetOpen(false)} onAction={act} />}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}
