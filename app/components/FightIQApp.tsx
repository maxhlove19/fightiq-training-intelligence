"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, BookOpen, Bot, BrainCircuit, Check, ChevronRight, CircleUserRound,
  Dumbbell, Home, MessageCircle, Mic, Plus, Send, Sparkles, Utensils, X,
} from "lucide-react";

type Screen = "home" | "learn" | "coach" | "game" | "log";
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

function HomeScreen({ name, onLog }: { name: string; onLog: () => void }) {
  const date = useMemo(() => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date()), []);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return (
    <main className="page">
      <header className="app-header"><p className="wordmark">FIGHT<span>IQ</span></p><div className="avatar">{name.slice(0, 1).toUpperCase()}</div></header>
      <p className="date-line">{date}</p>
      <h1 className="greeting">{greeting}, {name}</h1>
      <p className="subgreeting">Let’s keep building your game.</p>

      <section className="insight-card">
        <p className="eyebrow">FIGHTIQ INSIGHT</p>
        <h2>Your game is showing a pattern.</h2>
        <p>You’ve mentioned being taken down during scrambles in several recent sessions. Improving your first layer of defense can help you stay in control and create more chances to attack.</p>
        <div className="focus-row"><div><span className="focus-label">CURRENT FOCUS</span><strong>Wrestling Defense</strong></div><button className="text-link">See why <ChevronRight size={14} /></button></div>
      </section>

      <button className="primary-button" onClick={onLog}><Mic size={20} strokeWidth={2.2} /> LOG TODAY’S TRAINING</button>
      <p className="primary-support">Talk or type. FightIQ learns your game.</p>

      <h2 className="section-heading">FOR YOUR GAME</h2>
      <article className="video-card">
        <div className="video-thumb" aria-label="Video thumbnail placeholder"><div className="play"><ChevronRight size={22} fill="currentColor" /></div><span className="duration">6:42</span></div>
        <div className="video-copy"><span className="video-type">VIDEO</span><h3>Defend the Double Leg</h3><p>Keep your stance, stop the shot, and return to offense.</p><button className="text-link">Why FightIQ picked this <ChevronRight size={14} /></button></div>
      </article>
    </main>
  );
}

function TrainingLog({ onBack }: { onBack: () => void }) {
  const [discipline, setDiscipline] = useState("MMA");
  const [sessionType, setSessionType] = useState("Class");
  const [transcript, setTranscript] = useState("");
  const [listening, setListening] = useState(false);
  const [speechAvailable, setSpeechAvailable] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => () => recognitionRef.current?.stop(), []);

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

  async function saveEntry() {
    if (!transcript.trim()) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/training-entries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ discipline, sessionType, rawEntry: transcript.trim() }) });
      if (!response.ok) throw new Error("save failed");
      setSaved(true);
    } catch {
      setError("Your note couldn’t be saved yet. Your text is still here—please try again.");
    } finally { setSaving(false); }
  }

  if (saved) return (
    <main className="page">
      <header className="page-header"><button className="icon-button" onClick={onBack} aria-label="Back home"><ArrowLeft size={19} /></button><h1 className="page-title">Training saved</h1></header>
      <div className="success-card"><div className="success-icon"><Check size={20} /></div><h2>Got it.</h2><p>Your raw training note has been safely added to your training memory. The intelligent debrief and follow-up question arrive in the next build phase.</p><button className="secondary-button" onClick={onBack}>Back to Home</button></div>
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

function ComingSoon({ screen }: { screen: Exclude<Screen, "home" | "log"> }) {
  const copy = {
    learn: { icon: BookOpen, title: "Learn", phase: "STEP 7", text: "Personalized videos and technical study will connect directly to your training patterns." },
    coach: { icon: MessageCircle, title: "Ask FightIQ", phase: "STEP 6", text: "Your personal MMA coach conversation will use your training memory to answer what matters now." },
    game: { icon: BrainCircuit, title: "My Game", phase: "STEP 8", text: "Your evolving identity, current focus, improvements, patterns, and style influences will live here." },
  }[screen];
  const Icon = copy.icon;
  return <main className="page coming-page"><div className="coming-icon"><Icon size={27} /></div><p className="phase-tag">PLANNED · {copy.phase}</p><h1>{copy.title}</h1><p>{copy.text}</p></main>;
}

function ActionSheet({ onClose, onAction }: { onClose: () => void; onAction: (action: string) => void }) {
  const actions = [
    { name: "Log Training", note: "Talk or type your session", icon: Mic },
    { name: "Ask FightIQ", note: "Get personal guidance", icon: Bot },
    { name: "Workout", note: "Train for your martial art", icon: Dumbbell },
    { name: "Food", note: "Support your performance", icon: Utensils },
  ];
  return <div className="sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className="action-sheet" role="dialog" aria-modal="true" aria-label="Quick actions"><div className="sheet-handle" /><h2>What do you want to do?</h2><div className="sheet-grid">{actions.map(({ name, note, icon: Icon }) => <button className="sheet-action" key={name} onClick={() => onAction(name)}><Icon size={21} /><strong>{name}</strong><span>{note}</span></button>)}</div></section></div>;
}

export function FightIQApp({ displayName }: { displayName: string }) {
  const [screen, setScreen] = useState<Screen>("home");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState("");
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(""), 2600); return () => clearTimeout(id); }, [toast]);
  function act(name: string) {
    setSheetOpen(false);
    if (name === "Log Training") setScreen("log");
    else if (name === "Ask FightIQ") setScreen("coach");
    else setToast(`${name} arrives in a later build phase.`);
  }
  return <div className="app-frame">
    {screen === "home" && <HomeScreen name={displayName} onLog={() => setScreen("log")} />}
    {screen === "log" && <TrainingLog onBack={() => setScreen("home")} />}
    {(screen === "learn" || screen === "coach" || screen === "game") && <ComingSoon screen={screen} />}
    {screen !== "log" && <nav className="bottom-nav" aria-label="Primary navigation">
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
