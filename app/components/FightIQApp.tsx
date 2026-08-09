"use client";
/* eslint-disable @next/next/no-img-element -- FightIQ displays source-owned video thumbnails, not decorative assets. */

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft, BookOpen, Bot, Check, ChevronRight, CircleUserRound,
  Dumbbell, Home, Mic, Plus, RefreshCw, Send, Sparkles, Utensils, X,
} from "lucide-react";
import { CoachScreen, FoodScreen, GameScreen, LearnScreen, type ProductData, WorkoutScreen } from "./ProductScreens";

type Screen = "home" | "learn" | "coach" | "game" | "log" | "workout" | "food";
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

type DebriefState = {
  entryId: string;
  status: "not_started" | "preparing" | "question" | "complete" | "error";
  summary?: string | null;
  takeaway?: string;
  fightiqExplanation?: string | null;
  nextSessionFocus?: string | null;
  answeredCount?: number;
  questionCount?: number;
  maxQuestions?: number;
  question?: { id: string; sequence: number; prompt: string; choices: string[]; targetField: string };
};

function HomeScreen({ name, onLog, onLearn, onGame }: { name: string; onLog: () => void; onLearn: () => void; onGame: () => void }) {
  const [localTime, setLocalTime] = useState({ date: "Today", greeting: "Welcome back" });
  const [product, setProduct] = useState<ProductData | null>(null);
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
  useEffect(() => { void fetch("/api/product").then((response) => response.ok ? response.json() : null).then((data) => setProduct(data as ProductData | null)).catch(() => undefined); }, []);
  const insight = product?.insight ?? { title: "FightIQ is learning your game.", body: "Log today’s training and FightIQ will turn it into a useful pattern, one insight, and a clear next focus.", currentFocus: "Build your fighter memory" };
  const firstVideo = product?.videos[0];
  const brief = product?.preTrainingBrief;
  return (
    <main className="page">
      <header className="app-header"><p className="wordmark">FIGHT<span>IQ</span></p><a className="avatar" href="/signout-with-chatgpt?return_to=%2F" aria-label="Sign out" title="Sign out">{name.slice(0, 1).toUpperCase()}</a></header>
      <p className="date-line">{localTime.date}</p>
      <h1 className="greeting">{localTime.greeting}, {name}</h1>
      <p className="subgreeting">Let’s keep building your game.</p>

      <section className="insight-card">
        <p className="eyebrow">FIGHTIQ INSIGHT</p>
        <h2>{insight.title}</h2>
        <p>{insight.body}</p>
        <div className="focus-row"><div><span className="focus-label">CURRENT FOCUS</span><strong>{insight.currentFocus}</strong></div><button className="text-link" onClick={onGame}>See why <ChevronRight size={14} /></button></div>
      </section>

      {brief && <section className="pre-training-brief" aria-label="Pre-training brief"><p className="eyebrow">YOUR MISSION TODAY</p><h2>{brief.mission}</h2><p>{brief.reason}</p><div><span>ONE CUE</span><strong>{brief.cue}</strong><button className="text-link" onClick={onLog}>Got it <ChevronRight size={14} /></button></div></section>}

      <button className="primary-button" onClick={onLog}><Mic size={20} strokeWidth={2.2} /> LOG TODAY’S TRAINING</button>
      <p className="primary-support">Talk or type. FightIQ learns your game.</p>

      <h2 className="section-heading">FOR YOUR GAME</h2>
      {firstVideo ? <article className="video-card"><a className="video-thumb real-video-thumb" href={firstVideo.url} target="_blank" rel="noreferrer"><img src={firstVideo.thumbnail} alt={`Video thumbnail for ${firstVideo.title}`} /><div className="play"><ChevronRight size={22} fill="currentColor" /></div><span className="duration">{firstVideo.duration}</span></a><div className="video-copy"><span className="video-type">{firstVideo.discipline}</span><h3>{firstVideo.title}</h3><p>{firstVideo.description}</p><button className="text-link" onClick={onLearn}>Why FightIQ picked this <ChevronRight size={14} /></button></div></article> : <button className="memory-prompt" onClick={onLog}><Sparkles size={18} /><span><strong>Your feed starts with your training.</strong> Log a session to personalize what FightIQ picks.</span><ChevronRight size={17} /></button>}
    </main>
  );
}

function TrainingLog({ onBack, initialEntryId }: { onBack: () => void; initialEntryId: string | null }) {
  const [discipline, setDiscipline] = useState("MMA");
  const [sessionType, setSessionType] = useState("Class");
  const [transcript, setTranscript] = useState("");
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
  const [error, setError] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const questionHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const restoredRef = useRef(false);

  useEffect(() => () => recognitionRef.current?.stop(), []);
  useEffect(() => {
    if (!initialEntryId || restoredRef.current) return;
    restoredRef.current = true;
    void restoreDebrief(initialEntryId);
    // Restore is deliberately keyed only to the entry in the URL; its request helpers do not
    // represent reactive inputs and including them would restart an in-flight debrief.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEntryId]);
  useEffect(() => { if (debriefPhase === "question") questionHeadingRef.current?.focus(); }, [debriefPhase, debrief?.question?.id]);

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
    if (!transcript.trim()) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/training-entries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ discipline, sessionType, rawEntry: transcript.trim() }) });
      if (!response.ok) throw new Error("save failed");
      const data = await response.json() as { id: string };
      setEntryId(data.id);
      window.history.replaceState({}, "", `/?debrief=${encodeURIComponent(data.id)}`);
      await startDebrief(data.id);
    } catch {
      setError("Your note couldn’t be saved yet. Your text is still here—please try again.");
    } finally { setSaving(false); }
  }

  async function parseResponse(response: Response) {
    const data = await response.json() as DebriefState & { error?: { message?: string } };
    if (!response.ok) throw new Error(data.error?.message ?? "FightIQ couldn’t continue the debrief.");
    setDebrief(data);
    setError("");
    if (data.status === "question") setDebriefPhase("question");
    else if (data.status === "complete") setDebriefPhase("complete");
    else if (data.status === "error") setDebriefPhase("error");
    else setDebriefPhase("loading");
    return data;
  }

  async function startDebrief(id: string) {
    setDebriefPhase("loading"); setError("");
    try { await parseResponse(await fetch(`/api/training-entries/${encodeURIComponent(id)}/debrief`, { method: "POST" })); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "FightIQ couldn’t prepare your debrief."); setDebriefPhase("error"); }
  }

  async function restoreDebrief(id: string) {
    setDebriefPhase("loading");
    try {
      const data = await parseResponse(await fetch(`/api/training-entries/${encodeURIComponent(id)}/debrief`));
      if (data.status === "not_started" || data.status === "preparing") await startDebrief(id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "FightIQ couldn’t restore your debrief."); setDebriefPhase("error"); }
  }

  async function respond(action: "answer" | "skip" | "finish", value = answer, method: "chip" | "text" | "voice" = answerMethod) {
    if (!entryId || submitting) return;
    if (action === "answer" && !value.trim()) return;
    setSubmitting(true); setError(""); recognitionRef.current?.stop();
    try {
      const response = await fetch(`/api/training-entries/${encodeURIComponent(entryId)}/debrief/respond`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, questionId: debrief?.question?.id, answer: value.trim(), inputMethod: method }),
      });
      setDebriefPhase("loading");
      await parseResponse(response);
      setAnswer(""); setAnswerMethod("text");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Your answer was saved, but FightIQ couldn’t continue."); setDebriefPhase("error"); }
    finally { setSubmitting(false); setAnswerListening(false); }
  }

  if (debriefPhase === "loading") return (
    <main className="page">
      <header className="page-header"><button className="icon-button" onClick={onBack} aria-label="Back home"><ArrowLeft size={19} /></button><h1 className="page-title">Training debrief</h1></header>
      <section className="debrief-loading" aria-live="polite"><span className="thinking-mark"><Sparkles size={25} /></span><p className="eyebrow">YOUR NOTE IS SAFE</p><h2>FightIQ is finding the useful detail.</h2><p>You can leave at any time. Your training entry is already saved.</p></section>
    </main>
  );

  if (debriefPhase === "error") return (
    <main className="page">
      <header className="page-header"><button className="icon-button" onClick={onBack} aria-label="Back home"><ArrowLeft size={19} /></button><h1 className="page-title">Training saved</h1></header>
      <div className="debrief-error" role="alert"><p className="eyebrow">YOUR NOTE IS SAFE</p><h2>FightIQ needs another try.</h2><p>{error || "The debrief couldn’t be prepared right now."}</p><button className="primary-button" onClick={() => entryId && startDebrief(entryId)}><RefreshCw size={18} /> RETRY DEBRIEF</button><button className="quiet-button" onClick={() => respond("finish")}>Finish for now</button></div>
    </main>
  );

  if (debriefPhase === "question" && debrief?.question) return (
    <main className="page">
      <header className="page-header"><button className="icon-button" onClick={onBack} aria-label="Back home"><ArrowLeft size={19} /></button><div><p className="question-progress">QUESTION {debrief.question.sequence} OF {debrief.maxQuestions ?? 1}</p><h1 className="page-title">Training debrief</h1></div></header>
      <section className="takeaway-card"><p className="eyebrow">KEY TAKEAWAY</p><p>{debrief.takeaway}</p></section>
      <section className="question-card">
        <p className="eyebrow">QUICK QUESTION</p>
        <h2 ref={questionHeadingRef} tabIndex={-1}>{debrief.question.prompt}</h2>
        <div className="answer-choices">{debrief.question.choices.map((choice) => <button key={choice} onClick={() => respond("answer", choice, "chip")} disabled={submitting}>{choice}<ChevronRight size={16} /></button>)}<button onClick={() => respond("answer", "Not sure", "chip")} disabled={submitting}>Not sure<ChevronRight size={16} /></button></div>
        <div className="answer-compose"><textarea value={answer} onChange={(event) => { setAnswer(event.target.value); setAnswerMethod("text"); }} placeholder="Talk or type a different answer…" aria-label="Your answer" /><button className={`answer-mic ${answerListening ? "listening" : ""}`} onClick={toggleAnswerListening} aria-label={answerListening ? "Stop listening" : "Answer by voice"}>{answerListening ? <X size={20} /> : <Mic size={20} />}</button></div>
        {error && <p className="error-message" role="alert">{error}</p>}
        <button className="primary-button" onClick={() => respond("answer")} disabled={!answer.trim() || submitting}>{submitting ? "UPDATING…" : <><Send size={18} /> SEND ANSWER</>}</button>
        <div className="debrief-secondary-actions"><button onClick={() => respond("skip")} disabled={submitting}>Skip this question</button><span aria-hidden="true">·</span><button onClick={() => respond("finish")} disabled={submitting}>Finish for now</button></div>
      </section>
      <p className="sr-status" aria-live="polite">{submitting ? "Saving your answer and preparing the next step." : ""}</p>
    </main>
  );

  if (debriefPhase === "complete") return (
    <main className="page">
      <header className="page-header"><button className="icon-button" onClick={onBack} aria-label="Back home"><ArrowLeft size={19} /></button><h1 className="page-title">Debrief complete</h1></header>
      <div className="success-card"><div className="success-icon"><Check size={20} /></div><p className="eyebrow">MEMORY UPDATED</p><h2>Got it.</h2>{debrief?.summary && <div className="result-block"><span>SUMMARY</span><p>{debrief.summary}</p></div>}<div className="result-block"><span>KEY INSIGHT</span><p>{debrief?.takeaway ?? "Your training note has been saved."}</p></div>{debrief?.nextSessionFocus && <div className="next-focus"><span>NEXT SESSION</span><strong>{debrief.nextSessionFocus}</strong></div>}<button className="primary-button" onClick={onBack}>BACK TO HOME</button></div>
    </main>
  );

  return (
    <main className="page">
      <header className="page-header"><button className="icon-button" onClick={onBack} aria-label="Back home"><ArrowLeft size={19} /></button><h1 className="page-title">Tell FightIQ about training</h1></header>
      <div className="record-intro"><p className="eyebrow">VOICE-FIRST TRAINING LOG</p><p>Just talk naturally. I’ll organize it for you.</p></div>
      <div className="mic-stage"><button className={`mic-button ${listening ? "listening" : ""}`} onClick={toggleListening} aria-label={listening ? "Stop listening" : "Start voice entry"}>{listening ? <X size={34} /> : <Mic size={38} />}</button><span className="record-status">{listening ? "Listening… tap to stop" : speechAvailable ? "Tap to start talking" : "Voice isn’t available in this browser"}</span></div>
      <button className="type-toggle" onClick={() => document.getElementById("transcript")?.focus()}>Type instead</button>

      <span className="field-label">DISCIPLINE</span><div className="chip-row">{disciplines.map((item) => <button key={item} className={`chip ${discipline === item ? "selected" : ""}`} onClick={() => setDiscipline(item)}>{item}</button>)}</div>
      <span className="field-label">SESSION TYPE <span style={{fontWeight: 500}}>(OPTIONAL)</span></span><div className="chip-row">{sessionTypes.map((item) => <button key={item} className={`chip ${sessionType === item ? "selected" : ""}`} onClick={() => setSessionType(item)}>{item}</button>)}</div>
      <label className="field-label" htmlFor="transcript">WHAT HAPPENED?</label>
      <textarea id="transcript" className="transcript" value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder="We worked double-leg defense and wall wrestling. Coach told me to keep my head position…" />
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
  return <div className="sheet-backdrop"><section className="action-sheet" role="dialog" aria-modal="true" aria-label="Quick actions"><div className="sheet-handle" /><button className="sheet-close" onClick={onClose} aria-label="Close quick actions"><X size={18} /></button><h2>What do you want to do?</h2><div className="sheet-grid">{actions.map(({ name, note, icon: Icon }) => <button className="sheet-action" key={name} onClick={() => onAction(name)}><Icon size={21} /><strong>{name}</strong><span>{note}</span></button>)}</div></section></div>;
}

export function FightIQApp({ displayName, initialEntryId = null }: { displayName: string; initialEntryId?: string | null }) {
  const [screen, setScreen] = useState<Screen>(initialEntryId ? "log" : "home");
  const [activeEntryId, setActiveEntryId] = useState<string | null>(initialEntryId);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState("");
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(""), 2600); return () => clearTimeout(id); }, [toast]);
  function goHome() { window.history.replaceState({}, "", "/"); setActiveEntryId(null); setScreen("home"); }
  function act(name: string) {
    setSheetOpen(false);
    if (name === "Log Training") setScreen("log");
    else if (name === "Ask FightIQ") setScreen("coach");
    else if (name === "Workout") setScreen("workout");
    else if (name === "Food") setScreen("food");
  }
  return <div className="app-frame">
    {screen === "home" && <HomeScreen name={displayName} onLog={() => setScreen("log")} onLearn={() => setScreen("learn")} onGame={() => setScreen("game")} />}
    {screen === "log" && <TrainingLog onBack={goHome} initialEntryId={activeEntryId} />}
    {screen === "learn" && <LearnScreen />}
    {screen === "coach" && <CoachScreen />}
    {screen === "game" && <GameScreen />}
    {screen === "workout" && <WorkoutScreen onBack={goHome} />}
    {screen === "food" && <FoodScreen onBack={goHome} />}
    {screen !== "log" && screen !== "workout" && screen !== "food" && <nav className="bottom-nav" aria-label="Primary navigation">
      <button className={`nav-button ${screen === "home" ? "active" : ""}`} onClick={() => setScreen("home")}><Home size={21} /><span>HOME</span></button>
      <button className={`nav-button ${screen === "learn" ? "active" : ""}`} onClick={() => setScreen("learn")}><BookOpen size={21} /><span>LEARN</span></button>
      <button className="nav-button center" onClick={() => setSheetOpen(true)} aria-label="Open quick actions"><span className="nav-center-icon"><Plus size={27} /></span><span>FIGHTIQ</span></button>
      <button className={`nav-button ${screen === "coach" ? "active" : ""}`} onClick={() => setScreen("coach")}><Sparkles size={21} /><span>COACH</span></button>
      <button className={`nav-button ${screen === "game" ? "active" : ""}`} onClick={() => setScreen("game")}><CircleUserRound size={21} /><span>MY GAME</span></button>
    </nav>}
    {sheetOpen && <ActionSheet onClose={() => setSheetOpen(false)} onAction={act} />}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}
