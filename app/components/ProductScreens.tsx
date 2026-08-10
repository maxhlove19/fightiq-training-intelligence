"use client";
/* eslint-disable @next/next/no-img-element -- external video thumbnails and user food previews cannot use the app image pipeline. */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Camera, Check, ChevronRight, Dumbbell, ExternalLink, ImagePlus,
  LoaderCircle, MessageCircle, Mic, Pencil, RefreshCw, Save, Send, Sparkles, Target, X,
} from "lucide-react";

type SpeechRecognitionLike = {
  continuous: boolean; interimResults: boolean; lang: string; start: () => void; stop: () => void;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null;
};

export type ProductData = {
  profile: { currentFocus: string | null; focusReason: string | null; primaryGoal: string; styleInfluences: string[]; targets: MacroValues };
  memory: { currentFocus: string; focusReason: string; strongestAreas: string[]; recurringProblems: string[]; recentImprovement: string; styleInfluences: string[]; nextEvolution: string; instructorDetails: string[]; emergingStrengths: string[]; oneTimeObservations: string[] };
  insight: { title: string; body: string; currentFocus: string };
  videos: Array<{ id: string; title: string; creator: string; discipline: string; duration: string; description: string; thumbnail: string; url: string; why: string; watchFor: string; source: "curated" | "youtube" }>;
  learn: { studyTopic: string; exploreUrl: string; liveDiscoveryAvailable: boolean; refreshed: boolean };
  preTrainingBrief: { mission: string; reason: string; cue: string };
  activeExperiment: { id: string; mission: string; cue: string; reason: string; startedAt: string | null } | null;
  nutrition: { entries: NutritionEntry[]; totals: MacroValues };
  recentWorkouts: unknown[];
};

type MacroValues = { calories: number; protein: number; carbs: number; fat: number };
type NutritionEntry = MacroValues & { id: string; description: string; photoUrl: string | null; created_at?: string; createdAt?: string };

function cleanAiDisplay(value: string) {
  return value.replace(/\*\*(.*?)\*\*/g, "$1").replace(/__(.*?)__/g, "$1").replace(/^\s*[-*]\s+/gm, "").replace(/^\s{0,3}#{1,6}\s*/gm, "").trim();
}

function useProductData(initialUrl = "/api/product") {
  const [data, setData] = useState<ProductData | null>(null);
  const [error, setError] = useState("");
  async function load(url = "/api/product") {
    try {
      const response = await fetch(url);
      const payload = await response.json() as ProductData & { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "FightIQ couldn’t load your game.");
      setError(""); setData(payload);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "FightIQ couldn’t load your game."); }
  }
  useEffect(() => {
    let active = true;
    void fetch(initialUrl).then(async (response) => {
      const payload = await response.json() as ProductData & { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "FightIQ couldn’t load your game.");
      if (active) { setError(""); setData(payload); }
    }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "FightIQ couldn’t load your game."); });
    return () => { active = false; };
  }, [initialUrl]);
  return { data, error, reload: load };
}

function useVoiceField(value: string, setValue: (value: string) => void) {
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  useEffect(() => () => recognitionRef.current?.stop(), []);
  function toggle() {
    if (listening) { recognitionRef.current?.stop(); setListening(false); return; }
    const recognitionClass = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
    if (!recognitionClass) { setVoiceError("Voice isn’t available here. You can type instead."); return; }
    const recognition = new recognitionClass();
    const initial = value;
    recognition.continuous = true; recognition.interimResults = true; recognition.lang = "en-US";
    recognition.onresult = (event) => {
      let spoken = "";
      for (let index = 0; index < event.results.length; index += 1) spoken += `${event.results[index][0].transcript} `;
      setValue(`${initial}${initial ? " " : ""}${spoken.trim()}`);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => { setListening(false); setVoiceError("I couldn’t access the microphone. You can keep typing."); };
    recognitionRef.current = recognition; recognition.start(); setListening(true); setVoiceError("");
  }
  return { listening, voiceError, toggle };
}

function ScreenHeader({ title, onBack, kicker }: { title: string; onBack?: () => void; kicker?: string }) {
  return <header className="page-header">{onBack && <button className="icon-button" onClick={onBack} aria-label="Back home"><ArrowLeft size={19} /></button>}<div>{kicker && <p className="question-progress">{kicker}</p>}<h1 className="page-title">{title}</h1></div></header>;
}

function LoadingState({ label = "Reading your FightIQ memory…" }: { label?: string }) {
  return <div className="inline-loading" role="status"><LoaderCircle size={22} className="spin" /><span>{label}</span></div>;
}

export function LearnScreen({ studyTopic, onReturnToFeed, onReturnToCoach }: { studyTopic?: string | null; onReturnToFeed?: () => void; onReturnToCoach?: () => void }) {
  const topicQuery = studyTopic?.trim() ?? "";
  const baseUrl = topicQuery ? `/api/product?topic=${encodeURIComponent(topicQuery)}` : "/api/product";
  const { data, error, reload } = useProductData(baseUrl);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshCursor, setRefreshCursor] = useState(0);
  async function refreshRecommendations() {
    setRefreshing(true);
    const nextCursor = refreshCursor + 1;
    const params = new URLSearchParams({ recommendations: "next", cursor: String(nextCursor) });
    if (topicQuery) params.set("topic", topicQuery);
    await reload(`/api/product?${params.toString()}`);
    setRefreshCursor(nextCursor);
    setRefreshing(false);
  }
  return <main className="page product-page"><ScreenHeader title="Learn" kicker="PERSONALIZED FOR YOUR GAME" />
    {!data && !error && <LoadingState />}
    {error && <div className="compact-error" role="alert"><p>{error}</p><button onClick={() => void reload()}><RefreshCw size={15} /> Retry</button></div>}
    {data && <>
      <section className="focus-banner"><span>{topicQuery ? "FROM YOUR COACH CHAT" : "CURRENT STUDY FOCUS"}</span><h2>{topicQuery || data.memory.currentFocus}</h2><p>{topicQuery ? "FightIQ narrowed this feed to the exact technique you were discussing." : data.memory.focusReason}</p>{topicQuery && (onReturnToCoach || onReturnToFeed) && <button className="text-link" onClick={onReturnToCoach ?? onReturnToFeed}>{onReturnToCoach ? "Back to Coach" : "Back to my feed"} <ChevronRight size={14} /></button>}</section>
      <div className="feed-heading"><div><p className="eyebrow">YOUR TECHNIQUE FEED</p><h2>Study what your training is asking for.</h2>{data.learn.refreshed && <p className="refresh-note" role="status">{data.learn.liveDiscoveryAvailable ? "New relevant studies" : "A rotated set of relevant studies"}: {data.learn.studyTopic}</p>}</div><button className="text-link" onClick={() => void refreshRecommendations()} disabled={refreshing}><RefreshCw size={14} className={refreshing ? "spin" : ""} /> {refreshing ? "Finding videos…" : data.learn.liveDiscoveryAvailable ? "Refresh recommendations" : "Rotate relevant studies"}</button></div>
      <div className="video-feed">{data.videos.map((video) => <article className="learn-video" key={video.id}>
        <a className="real-video-thumb" href={video.url} target="_blank" rel="noreferrer" aria-label={`Watch ${video.title} on YouTube`}><img src={video.thumbnail} alt={`Video thumbnail for ${video.title}`} /><span className="video-source">{video.duration}</span><span className="play"><ChevronRight size={22} fill="currentColor" /></span></a>
        <div className="video-copy"><span className="video-type">{video.discipline}{video.source === "youtube" ? " · FRESH ON YOUTUBE" : ""}</span><h3>{video.title}</h3><p className="creator-line">{video.creator}</p><p>{video.description}</p><details className="why-detail"><summary>Why FightIQ picked this <ChevronRight size={14} /></summary><p>{video.why}</p><p><b>Watch for:</b> {video.watchFor}</p></details><a className="watch-link" href={video.url} target="_blank" rel="noreferrer">Watch video <ExternalLink size={14} /></a></div>
      </article>)}</div>
      <p className="content-note">FightIQ prioritizes study topics from your training—not generic popularity. Technique videos support, but never replace, your coach.</p>
      <a className="watch-link explore-link" href={data.learn.exploreUrl} target="_blank" rel="noreferrer">Explore this exact topic on YouTube <ExternalLink size={14} /></a>
    </>}
  </main>;
}

type CoachMessage = { id: string; role: "user" | "assistant"; content: string; created_at?: string; follow_up?: string | null; video_mode?: "none" | "offer" | "direct" | null; video_topic?: string | null; video_prompt?: string | null };
type CoachFailure = { messageId: string; question: string; code: string; message: string; development?: Record<string, unknown> };

function messageParagraphs(value: string) {
  return cleanAiDisplay(value).split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
}

export function CoachScreen({ onStudyVideo }: { onStudyVideo: (topic: string) => void }) {
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [currentFocus, setCurrentFocus] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [failure, setFailure] = useState<CoachFailure | null>(null);
  const voice = useVoiceField(question, setQuestion);
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { void (async () => { try { const response = await fetch("/api/coach"); const data = await response.json() as { messages?: CoachMessage[]; currentFocus?: string; suggestions?: string[]; error?: { message?: string } }; if (!response.ok) throw new Error(data.error?.message); setMessages(data.messages ?? []); setCurrentFocus(data.currentFocus ?? ""); setSuggestions(data.suggestions ?? []); } catch (caught) { setError(caught instanceof Error ? caught.message : "Coach history couldn’t load."); } finally { setLoading(false); } })(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);
  async function send(explicitQuestion?: string, retryMessageId?: string) {
    const pending = (explicitQuestion ?? question).trim();
    if (!pending || sending) return;
    const messageId = retryMessageId ?? crypto.randomUUID();
    setQuestion(""); setSending(true); setError(""); setFailure(null);
    const optimistic: CoachMessage = { id: messageId, role: "user", content: pending };
    if (!retryMessageId) setMessages((current) => [...current, optimistic]);
    try {
      const response = await fetch("/api/coach", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: pending, messageId }) });
      const data = await response.json() as { user?: CoachMessage; assistant?: CoachMessage; suggestions?: string[]; error?: { code?: string; message?: string; development?: Record<string, unknown> } };
      if (!response.ok || !data.assistant) {
        setQuestion(pending);
        setFailure({ messageId, question: pending, code: data.error?.code ?? "AI_UNAVAILABLE", message: data.error?.message ?? "FightIQ Coach couldn’t answer.", development: data.error?.development });
        return;
      }
      setMessages((current) => [...current.filter((item) => item.id !== messageId && item.id !== data.assistant?.id), data.user ?? optimistic, data.assistant as CoachMessage]);
      if (data.suggestions) setSuggestions(data.suggestions);
    } catch (caught) {
      setQuestion(pending);
      setFailure({ messageId, question: pending, code: "NETWORK_ERROR", message: "FightIQ Coach couldn’t answer. Your message is still here.", development: { cause: caught instanceof Error ? caught.message : "Request failed" } });
    }
    finally { setSending(false); }
  }
  return <main className="page product-page coach-page"><ScreenHeader title="Ask FightIQ" kicker="YOUR TRAINING-AWARE COACH" />
    {currentFocus && <div className="context-pill"><Target size={14} /><span>Current focus: {currentFocus}</span></div>}
    <section className="coach-thread">
      {loading && <LoadingState label="Loading your conversation…" />}
      {!loading && messages.length === 0 && <div className="coach-empty"><div className="coming-icon"><MessageCircle size={25} /></div><h2>Ask about your game.</h2><p>FightIQ can use your training, current focus, workouts, and nutrition when they matter to the answer.</p></div>}
      {messages.map((message) => <div className={`chat-message ${message.role}`} key={message.id}><span>{message.role === "assistant" ? "FIGHTIQ" : "YOU"}</span><div className="chat-bubble">{(message.role === "assistant" ? messageParagraphs(message.content) : [message.content]).map((paragraph, index) => <p key={`${message.id}-${index}`}>{paragraph}</p>)}</div>{message.role === "assistant" && message.follow_up && <button className="coach-follow-up" onClick={() => requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".coach-compose textarea")?.focus())}>{cleanAiDisplay(message.follow_up)}<span>Answer this</span></button>}{message.role === "assistant" && message.video_mode && message.video_mode !== "none" && message.video_topic && <div className="coach-video-offer"><span>{message.video_mode === "direct" ? "VIDEO PICKS" : "WANT TO SEE IT?"}</span><p>{message.video_prompt || `Want a video on ${message.video_topic}?`}</p><button onClick={() => onStudyVideo(message.video_topic ?? "")}>{message.video_mode === "direct" ? "Open video picks" : "Show me a video"}<ChevronRight size={14} /></button></div>}</div>)}
      {sending && <div className="chat-message assistant thinking"><span>FIGHTIQ</span><div className="chat-bubble"><p><LoaderCircle size={15} className="spin" /> Thinking with your training context…</p></div></div>}
      <div ref={endRef} />
    </section>
    {suggestions.length > 0 && <section className="coach-suggestions" aria-label="Suggested questions"><span>SUGGESTED FROM YOUR FIGHTER BRAIN</span><div className="prompt-list">{suggestions.map((prompt) => <button key={prompt} onClick={() => void send(prompt)} disabled={sending}>{prompt}<ChevronRight size={15} /></button>)}</div></section>}
    {(error || voice.voiceError) && <p className="error-message" role="alert">{error || voice.voiceError}</p>}
    {failure && <div className="coach-error" role="alert"><p>{failure.message} Your message was preserved.</p><button onClick={() => void send(failure.question, failure.messageId)} disabled={sending}><RefreshCw size={15} /> Retry</button></div>}
    <div className="coach-compose"><textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about training, technique, recovery, workouts, or food…" aria-label="Ask FightIQ" /><button className={`answer-mic ${voice.listening ? "listening" : ""}`} onClick={voice.toggle} aria-label={voice.listening ? "Stop listening" : "Ask by voice"}>{voice.listening ? <X size={19} /> : <Mic size={19} />}</button><button className="compose-send" onClick={() => void send()} disabled={!question.trim() || sending} aria-label="Send question"><Send size={18} /></button></div>
    <p className="sr-status" aria-live="polite">{sending ? "FightIQ is thinking with your training context." : messages.at(-1)?.role === "assistant" ? "FightIQ replied." : ""}</p>
  </main>;
}

export function GameScreen() {
  const { data, error, reload } = useProductData();
  const [editing, setEditing] = useState(false);
  const [focus, setFocus] = useState("");
  const [influences, setInfluences] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  async function save() {
    if (!data) return;
    setSaving(true); setSaved(false);
    const response = await fetch("/api/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentFocus: focus, focusReason: data.memory.focusReason, primaryGoal: data.profile.primaryGoal, styleInfluences: influences.split(",").map((item) => item.trim()).filter(Boolean), targets: data.profile.targets }) });
    setSaving(false);
    if (response.ok) { setEditing(false); setSaved(true); await reload(); }
  }
  return <main className="page product-page"><ScreenHeader title="My Game" kicker="YOUR FIGHTER BRAIN" />
    {!data && !error && <LoadingState />}{error && <div className="compact-error"><p>{error}</p><button onClick={() => void reload()}>Retry</button></div>}
    {data && <>
      <section className="game-hero"><div><p className="eyebrow">CURRENT FOCUS</p>{editing ? <input value={focus} onChange={(event) => setFocus(event.target.value)} aria-label="Current focus" /> : <h2>{data.memory.currentFocus}</h2>}<p>{data.memory.focusReason}</p></div><button className="round-action" onClick={() => { if (!editing) { setFocus(data.memory.currentFocus); setInfluences(data.memory.styleInfluences.join(", ")); } setEditing((value) => !value); }} aria-label="Edit My Game"><Pencil size={16} /></button></section>
      <div className="game-grid">
        <section className="game-card"><span>STRENGTHS</span>{data.memory.strongestAreas.map((item) => <strong key={item}>{item}</strong>)}</section>
        <section className="game-card problem"><span>RECURRING PROBLEMS</span>{data.memory.recurringProblems.map((item) => <strong key={item}>{item}</strong>)}</section>
        <section className="game-card wide"><span>RECENT IMPROVEMENT</span><p>{data.memory.recentImprovement}</p></section>
        <section className="game-card wide"><span>STYLE / FIGHTER INFLUENCES</span>{editing ? <input value={influences} onChange={(event) => setInfluences(event.target.value)} placeholder="e.g. Volkanovski, pressure boxing" aria-label="Style and fighter influences" /> : <p>{data.memory.styleInfluences.length ? data.memory.styleInfluences.join(" · ") : "Add fighters or styles that influence the game you want to build."}</p>}</section>
      </div>
      <section className="build-next"><Sparkles size={20} /><div><span>NEXT EVOLUTION</span><h3>{data.memory.nextEvolution}</h3></div></section>
      {editing && <button className="primary-button" onClick={save} disabled={saving || !focus.trim()}>{saving ? "SAVING…" : <><Save size={17} /> SAVE MY GAME</>}</button>}
      {saved && <p className="saved-note" role="status"><Check size={14} /> My Game updated.</p>}
    </>}
  </main>;
}

type GeneratedWorkout = { id: string; discipline: string; goal: string; fatigue: string; duration: number; plan: { title: string; loadNote: string; warmup: string; exercises: Array<{ name: string; dose: string; why: string; helps: string; intensity: string }>; finish: string } };

export function WorkoutScreen({ onBack }: { onBack: () => void }) {
  const [discipline, setDiscipline] = useState("MMA");
  const [goal, setGoal] = useState("Fight performance");
  const [fatigue, setFatigue] = useState("medium");
  const [duration, setDuration] = useState(35);
  const [workout, setWorkout] = useState<GeneratedWorkout | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function generate() {
    setLoading(true); setError(""); setWorkout(null);
    try { const response = await fetch("/api/workouts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ discipline, goal, fatigue, duration }) }); const data = await response.json() as GeneratedWorkout & { error?: { message?: string } }; if (!response.ok) throw new Error(data.error?.message); setWorkout(data); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "FightIQ couldn’t build this workout."); }
    finally { setLoading(false); }
  }
  return <main className="page product-page"><ScreenHeader title="Workout" kicker="MARTIAL-ART-SPECIFIC" onBack={onBack} />
    {!workout && <>
      <section className="focus-banner workout-intro"><Dumbbell size={22} /><h2>Support your skill training.</h2><p>Build strength and conditioning around your martial art—and around the fatigue you already carry from practice.</p></section>
      <span className="field-label">MARTIAL ART</span><div className="chip-row">{["MMA", "BJJ", "Wrestling", "Boxing", "Muay Thai"].map((item) => <button className={`chip ${discipline === item ? "selected" : ""}`} key={item} onClick={() => setDiscipline(item)}>{item}</button>)}</div>
      <label className="field-label" htmlFor="workout-goal">GOAL</label><select id="workout-goal" className="select-field" value={goal} onChange={(event) => setGoal(event.target.value)}><option>Fight performance</option><option>Strength</option><option>Power</option><option>Conditioning</option><option>Recovery support</option></select>
      <span className="field-label">MARTIAL ARTS FATIGUE</span><div className="choice-stack">{[["low", "Fresh", "No hard session in the last 24 hours"], ["medium", "Some fatigue", "Normal soreness or trained yesterday"], ["high", "Heavy", "Hard rounds, heavy legs, or several recent sessions"]].map(([value, title, note]) => <button className={fatigue === value ? "selected" : ""} key={value} onClick={() => setFatigue(value)}><span>{title}</span><small>{note}</small><Check size={16} /></button>)}</div>
      <label className="field-label" htmlFor="duration">TIME: {duration} MIN</label><input id="duration" className="range-field" type="range" min="20" max="60" step="5" value={duration} onChange={(event) => setDuration(Number(event.target.value))} />
      {error && <p className="error-message">{error}</p>}<button className="primary-button" onClick={generate} disabled={loading}>{loading ? "BUILDING AROUND YOUR LOAD…" : <><Sparkles size={18} /> BUILD MY WORKOUT</>}</button>
    </>}
    {workout && <section className="workout-plan"><p className="eyebrow">SAVED TO YOUR TRAINING CONTEXT</p><h2>{workout.plan.title}</h2><p className="load-note">{workout.plan.loadNote}</p><div className="plan-step warmup"><span>WARM-UP</span><p>{workout.plan.warmup}</p></div>{workout.plan.exercises.map((exercise, index) => <article className="exercise-card" key={exercise.name}><span className="exercise-number">{String(index + 1).padStart(2, "0")}</span><div><h3>{exercise.name}</h3><strong>{exercise.dose}</strong><p><b>Why:</b> {exercise.why}</p><p><b>Helps with:</b> {exercise.helps}</p></div></article>)}<div className="plan-step"><span>FINISH</span><p>{workout.plan.finish}</p></div><button className="secondary-button" onClick={() => setWorkout(null)}>BUILD A DIFFERENT PLAN</button></section>}
  </main>;
}

export function FoodScreen({ onBack }: { onBack: () => void }) {
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [foods, setFoods] = useState<Array<{ name: string; portion: string }>>([]);
  const [macros, setMacros] = useState<MacroValues>({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  const [confidence, setConfidence] = useState("");
  const [note, setNote] = useState("");
  const [nutrition, setNutrition] = useState<{ entries: NutritionEntry[]; totals: MacroValues; targets: MacroValues; goal: string } | null>(null);
  const [goal, setGoal] = useState("performance");
  const [targets, setTargets] = useState<MacroValues>({ calories: 2400, protein: 180, carbs: 260, fat: 70 });
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [analyzing, setAnalyzing] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [saved, setSaved] = useState(false);
  const voice = useVoiceField(description, setDescription);
  async function applyNutritionResponse(response: Response) { if (response.ok) { const data = await response.json() as { entries: NutritionEntry[]; totals: MacroValues; targets: MacroValues; goal: string }; setNutrition(data); setGoal(data.goal); setTargets(data.targets); } }
  async function load() { await applyNutritionResponse(await fetch("/api/nutrition")); }
  useEffect(() => { void fetch("/api/nutrition").then(applyNutritionResponse); }, []);
  const preview = useMemo(() => photo ? URL.createObjectURL(photo) : "", [photo]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  async function analyze() {
    if (!description.trim() && !photo) return;
    setAnalyzing(true); setError(""); setSaved(false);
    const form = new FormData(); form.set("description", description); if (photo) form.set("photo", photo);
    try { const response = await fetch("/api/nutrition/analyze", { method: "POST", body: form }); const data = await response.json() as MacroValues & { description?: string; foods?: Array<{ name: string; portion: string }>; confidence?: string; note?: string; error?: { message?: string } }; if (!response.ok) throw new Error(data.error?.message); setDescription(data.description ?? description); setFoods(data.foods ?? []); setMacros({ calories: data.calories, protein: data.protein, carbs: data.carbs, fat: data.fat }); setConfidence(data.confidence ?? ""); setNote(data.note ?? ""); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "FightIQ couldn’t estimate this meal."); }
    finally { setAnalyzing(false); }
  }
  async function save() {
    if (!description.trim()) return;
    setSaving(true); setError("");
    const form = new FormData(); form.set("description", description); form.set("foods", JSON.stringify(foods)); form.set("inputMethod", photo ? "photo" : "text"); for (const [key, value] of Object.entries(macros)) form.set(key, String(value)); if (photo) form.set("photo", photo);
    try { const response = await fetch("/api/nutrition", { method: "POST", body: form }); const data = await response.json() as { error?: { message?: string } }; if (!response.ok) throw new Error(data.error?.message); setDescription(""); setPhoto(null); setFoods([]); setMacros({ calories: 0, protein: 0, carbs: 0, fat: 0 }); setNote(""); setConfidence(""); setSaved(true); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Your meal couldn’t be saved."); }
    finally { setSaving(false); }
  }
  async function saveTargets() {
    setSettingsSaved(false); setError("");
    const response = await fetch("/api/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ primaryGoal: goal, targets }) });
    if (response.ok) { setSettingsSaved(true); await load(); } else { const data = await response.json() as { error?: { message?: string } }; setError(data.error?.message ?? "Your nutrition targets couldn’t be saved."); }
  }
  return <main className="page product-page"><ScreenHeader title="Food" kicker="SIMPLE FUEL TRACKING" onBack={onBack} />
    {nutrition && <section className="macro-summary"><div><span>TODAY · {nutrition.goal.toUpperCase()}</span><strong>{nutrition.totals.calories}<small> / {nutrition.targets.calories} kcal</small></strong></div><div className="macro-mini"><span>P <b>{Math.round(nutrition.totals.protein)}g</b></span><span>C <b>{Math.round(nutrition.totals.carbs)}g</b></span><span>F <b>{Math.round(nutrition.totals.fat)}g</b></span></div></section>}
    <details className="macro-settings"><summary><span><Target size={15} /> Goal & macro targets</span><ChevronRight size={15} /></summary><div className="settings-body"><label htmlFor="nutrition-goal">GOAL</label><select id="nutrition-goal" value={goal} onChange={(event) => { setGoal(event.target.value); setSettingsSaved(false); }}><option value="cut">Cut</option><option value="maintain">Maintain</option><option value="gain muscle">Gain muscle</option><option value="performance">Performance</option></select><div className="macro-edit-grid">{(["calories", "protein", "carbs", "fat"] as const).map((key) => <label key={key}><span>{key === "calories" ? "KCAL" : key.toUpperCase()}</span><input type="number" min="0" value={targets[key]} onChange={(event) => { setTargets((current) => ({ ...current, [key]: Number(event.target.value) })); setSettingsSaved(false); }} /><small>{key === "calories" ? "" : "g"}</small></label>)}</div><button className="secondary-button" onClick={saveTargets}><Save size={15} /> SAVE TARGETS</button>{settingsSaved && <p className="saved-note"><Check size={13} /> Targets updated.</p>}</div></details>
    <section className="food-log-card"><p className="eyebrow">LOG A MEAL</p><h2>Talk, type, or add a photo.</h2><div className="answer-compose food-compose"><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Chicken, rice, avocado, and salsa…" aria-label="Describe your meal" /><button className={`answer-mic ${voice.listening ? "listening" : ""}`} onClick={voice.toggle} aria-label="Describe meal by voice">{voice.listening ? <X size={19} /> : <Mic size={19} />}</button></div>
      <label className="photo-picker"><input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} /><ImagePlus size={18} /><span>{photo ? "Change food photo" : "Add food photo"}</span></label>
      {preview && <div className="food-preview"><img src={preview} alt="Your selected food" /><button onClick={() => setPhoto(null)} aria-label="Remove food photo"><X size={17} /></button><span><Camera size={13} /> Photo ready to estimate</span></div>}
      {(voice.voiceError || error) && <p className="error-message" role="alert">{voice.voiceError || error}</p>}
      <button className="secondary-button estimate-button" onClick={analyze} disabled={analyzing || (!description.trim() && !photo)}>{analyzing ? "ESTIMATING…" : <><Sparkles size={17} /> ESTIMATE FOODS & MACROS</>}</button>
    </section>
    {(foods.length > 0 || macros.calories > 0) && <section className="estimate-card"><div className="estimate-heading"><div><p className="eyebrow">EDIT BEFORE SAVING</p><h2>FightIQ’s estimate</h2></div>{confidence && <span className={`confidence ${confidence}`}>{confidence} confidence</span>}</div>{foods.length > 0 && <div className="food-list">{foods.map((food, index) => <div key={`${food.name}-${index}`}><input value={food.name} aria-label={`Food ${index + 1}`} onChange={(event) => setFoods((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} /><input value={food.portion} aria-label={`Portion ${index + 1}`} onChange={(event) => setFoods((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, portion: event.target.value } : item))} /></div>)}</div>}<div className="macro-edit-grid">{(["calories", "protein", "carbs", "fat"] as const).map((key) => <label key={key}><span>{key === "calories" ? "KCAL" : key.toUpperCase()}</span><input type="number" min="0" value={macros[key]} onChange={(event) => setMacros((current) => ({ ...current, [key]: Number(event.target.value) }))} /><small>{key === "calories" ? "" : "g"}</small></label>)}</div>{note && <p className="estimate-note">{note}</p>}<button className="primary-button" onClick={save} disabled={saving}>{saving ? "SAVING…" : <><Save size={17} /> SAVE MEAL</>}</button></section>}
    {saved && <p className="saved-note"><Check size={14} /> Meal added to today.</p>}
    {nutrition && nutrition.entries.length > 0 && <section className="today-food"><p className="eyebrow">TODAY</p>{nutrition.entries.map((entry) => <article key={entry.id}>{entry.photoUrl && <img src={entry.photoUrl} alt="Your logged meal" />}<div><strong>{entry.description}</strong><span>{entry.calories} kcal · P {Math.round(entry.protein)} · C {Math.round(entry.carbs)} · F {Math.round(entry.fat)}</span></div></article>)}</section>}
  </main>;
}
