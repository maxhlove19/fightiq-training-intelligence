"use client";
/* eslint-disable @next/next/no-img-element -- external video thumbnails and user food previews cannot use the app image pipeline. */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowLeft, Camera, Check, ChevronRight, Dumbbell, ExternalLink, ImagePlus,
  LoaderCircle, MessageCircle, Mic, Pencil, Play, Plus, RefreshCw, Save, Send, Sparkles, Target, X,
} from "lucide-react";
import { SafetyNotice, type SafetySignal } from "./SafetyNotice";
import { buildWeeklyReview, restTile, themeStatusLabel } from "../../lib/weekly-review";
import { firstWeekPlan, isPlaceholderMemory, unlockCards } from "../../lib/first-session";
import { toAthleteVoice } from "../../lib/athlete-voice";
import { toHouseStyle } from "../../lib/house-style";

type SpeechRecognitionLike = {
  continuous: boolean; interimResults: boolean; lang: string; start: () => void; stop: () => void;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null;
};

export type ProductData = {
  profile: { currentFocus: string | null; focusReason: string | null; primaryGoal: string; styleInfluences: string[]; targets: MacroValues; athleteSetup: AthleteSetup };
  onboarding: { status: "required" | "legacy" | "complete" };
  memory: { currentFocus: string; focusReason: string; strongestAreas: string[]; recurringProblems: string[]; recentImprovement: string; styleInfluences: string[]; nextEvolution: string; instructorDetails: string[]; emergingStrengths: string[]; oneTimeObservations: string[]; recentTraining: Array<{ discipline: string; sessionType: string; note: string; takeaway: string | null; focus: string | null; createdAt: string }> };
  insight: { title: string; body: string; currentFocus: string };
  /** Present only until the first session is logged. See lib/first-session.ts. */
  opening: { title: string; body: string; watchFor: string; cue: string; promise: string } | null;
  sessionsLogged: number;
  videos: Array<{ id: string; title: string; creator: string; discipline: string; duration: string; description: string; thumbnail: string; url: string; why: string; watchFor: string; source: "curated" | "youtube" }>;
  learn: { studyTopic: string; exploreUrl: string; liveDiscoveryAvailable: boolean; refreshed: boolean };
  preTrainingBrief: { mission: string; reason: string; cue: string };
  activeExperiment: { id: string; mission: string; cue: string; reason: string; startedAt: string | null } | null;
  nutrition: { entries: NutritionEntry[]; totals: MacroValues };
  recentWorkouts: unknown[];
};

type MacroValues = { calories: number; protein: number; carbs: number; fat: number };
export type AthleteSetup = { disciplines: string[]; experienceLevel: string; sessionsPerWeek: number; sessionTypes: string[]; competitionIntent: string; age: number | null; calculatorSex: "female" | "male" | "manual" | null; heightCm: number | null; weightKg: number | null; dietaryRestrictions: string[]; foodPreferences: string; foodsToAvoid: string; mealsPerDay: number | null; trainingTime: string };
type NutritionEntry = MacroValues & { id: string; description: string; photoUrl: string | null; created_at?: string; createdAt?: string };

// The generation-time sanitiser in lib/claude.ts only reaches text written from
// now on. Every answer already stored in somebody's conversation was written
// before it existed, so the same rule runs again on the way to the screen.
function cleanAiDisplay(value: string) {
  return toHouseStyle(toAthleteVoice(value)).replace(/\*\*(.*?)\*\*/g, "$1").replace(/__(.*?)__/g, "$1").replace(/^\s*[-*]\s+/gm, "").replace(/^\s{0,3}#{1,6}\s*/gm, "").trim();
}

/** Positioning a scroll container has to happen before paint, and there is no paint on the server. */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function useProductData(initialUrl = "/api/product") {
  const [data, setData] = useState<ProductData | null>(null);
  const [error, setError] = useState("");
  async function load(url = "/api/product") {
    try {
      const response = await fetch(url);
      const payload = await response.json() as ProductData & { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "FightIQ couldn’t load your game.");
      setError(""); setData(payload); return true;
    } catch (caught) { setError(caught instanceof Error ? caught.message : "FightIQ couldn’t load your game."); return false; }
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

type StudyVideo = ProductData["videos"][number];

// The study plays here rather than on YouTube. Sending an athlete out to a
// recommendation feed to watch one detail is how a study session ends up
// somewhere else entirely, so the video and the thing to look for stay in the
// same frame. Nothing is requested from YouTube until the athlete hits play.
function StudyCard({ video, playing, onPlay, onClose }: { video: StudyVideo; playing: boolean; onPlay: () => void; onClose: () => void }) {
  const embed = `https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0&modestbranding=1&playsinline=1`;
  return <article className={playing ? "learn-video studying" : "learn-video"}>
    {playing
      ? <div className="study-frame">
          <iframe
            src={embed}
            title={video.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
          <button type="button" className="study-close" onClick={onClose} aria-label="Close this study"><X size={16} /></button>
        </div>
      : <button type="button" className="real-video-thumb" onClick={onPlay} aria-label={`Play ${video.title}`}>
          <img src={video.thumbnail} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />
          <span className="video-source">{video.duration}</span>
          <span className="play"><Play size={20} fill="currentColor" /></span>
        </button>}
    <div className="video-copy">
      <span className="video-type">{video.discipline}{video.source === "youtube" ? " · FRESH" : ""}</span>
      <h3>{video.title}</h3>
      <p className="creator-line">{video.creator}</p>
      {/* the detail to look for stays on screen while the footage runs */}
      <p className="watch-for"><b>Watch for</b> {video.watchFor}</p>
      <details className="why-detail"><summary>Why this <ChevronRight size={14} /></summary><p>{video.why}</p></details>
      <a className="watch-link" href={video.url} target="_blank" rel="noreferrer">Open on YouTube <ExternalLink size={14} /></a>
    </div>
  </article>;
}

export function LearnScreen({ studyTopic, onReturnToFeed, onReturnToCoach }: { studyTopic?: string | null; onReturnToFeed?: () => void; onReturnToCoach?: () => void }) {
  const topicQuery = studyTopic?.trim() ?? "";
  const baseUrl = topicQuery ? `/api/product?topic=${encodeURIComponent(topicQuery)}` : "/api/product";
  const { data, error, reload } = useProductData(baseUrl);
  const [refreshing, setRefreshing] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [refreshState, setRefreshState] = useState({ topic: "", cursor: 0, notice: "" });
  const refreshCursor = refreshState.topic === topicQuery ? refreshState.cursor : 0;
  const refreshNotice = refreshState.topic === topicQuery ? refreshState.notice : "";
  async function refreshRecommendations() {
    if (refreshing) return;
    setRefreshing(true);
    const nextCursor = refreshCursor + 1;
    const params = new URLSearchParams({ recommendations: "next", cursor: String(nextCursor) });
    if (topicQuery) params.set("topic", topicQuery);
    const loaded = await reload(`/api/product?${params.toString()}`);
    if (loaded) {
      setRefreshState({ topic: topicQuery, cursor: nextCursor, notice: "Updated with a new set of studies." });
    } else {
      setRefreshState({ topic: topicQuery, cursor: refreshCursor, notice: "Couldn’t refresh right now. Your current studies are still here. Try again when you’re ready." });
    }
    setRefreshing(false);
  }
  return <main className="page product-page native-page learn-page"><ScreenHeader title="Learn" kicker="PERSONALIZED FOR YOUR GAME" />
    {!data && !error && <LoadingState />}
    {error && <div className="compact-error" role="alert"><p>{error}</p><button onClick={() => void reload()}><RefreshCw size={15} /> Retry</button></div>}
    {data && <>
      {topicQuery && <div className="coach-topic-return"><button className="text-link" onClick={onReturnToCoach ?? onReturnToFeed}>{onReturnToCoach ? "Back to Coach" : "Back to my feed"} <ChevronRight size={14} /></button></div>}
      <div className="feed-heading"><div><p className="eyebrow">{topicQuery ? "COACH VIDEO PICKS" : "FOR YOUR NEXT STUDY"}</p>{(data.learn.refreshed || refreshNotice) && <p className="refresh-note" role="status">{refreshNotice || "Fresh studies ready."}</p>}</div><button className="text-link" onClick={() => void refreshRecommendations()} disabled={refreshing}><RefreshCw size={14} className={refreshing ? "spin" : ""} /> {refreshing ? "Finding…" : "Refresh"}</button></div>
      <div className="video-feed">{data.videos.map((video) => <StudyCard key={video.id} video={video} playing={playingId === video.id} onPlay={() => setPlayingId(video.id)} onClose={() => setPlayingId(null)} />)}</div>
      <a className="watch-link explore-link" href={data.learn.exploreUrl} target="_blank" rel="noreferrer">More on YouTube <ExternalLink size={14} /></a>
    </>}
  </main>;
}

type CoachMessage = { id: string; role: "user" | "assistant"; content: string; created_at?: string; follow_up?: string | null; follow_up_choices?: string[]; video_mode?: "none" | "offer" | "direct" | null; video_topic?: string | null; video_prompt?: string | null };
type CoachFailure = { messageId: string; question: string; code: string; message: string };
type CoachChat = { id: string; title: string; created_at: string; updated_at: string };

function messageParagraphs(value: string) {
  return cleanAiDisplay(value).split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
}

export function CoachScreen({ onStudyVideo }: { onStudyVideo: (topic: string) => void }) {
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [chats, setChats] = useState<CoachChat[]>([]);
  const [activeChatId, setActiveChatId] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [failure, setFailure] = useState<CoachFailure | null>(null);
  const [safety, setSafety] = useState<{ signal: SafetySignal; messageId: string } | null>(null);
  const voice = useVoiceField(question, setQuestion);
  const endRef = useRef<HTMLDivElement | null>(null);
  const threadRef = useRef<HTMLElement | null>(null);
  const composeRef = useRef<HTMLTextAreaElement | null>(null);
  async function loadChat(chatId?: string) { setLoading(true); setError(""); try { const response = await fetch(chatId ? `/api/coach?chatId=${encodeURIComponent(chatId)}` : "/api/coach"); const data = await response.json() as { messages?: CoachMessage[]; chats?: CoachChat[]; activeChatId?: string; suggestions?: string[]; error?: { message?: string } }; if (!response.ok) throw new Error(data.error?.message); setMessages(data.messages ?? []); setChats(data.chats ?? []); setActiveChatId(data.activeChatId ?? ""); setSuggestions(data.suggestions ?? []); setFailure(null); } catch (caught) { setError(caught instanceof Error ? caught.message : "Coach history couldn’t load."); } finally { setLoading(false); } }
  useEffect(() => { let active = true; void fetch("/api/coach").then(async (response) => { const data = await response.json() as { messages?: CoachMessage[]; chats?: CoachChat[]; activeChatId?: string; suggestions?: string[]; error?: { message?: string } }; if (!response.ok) throw new Error(data.error?.message); if (active) { setMessages(data.messages ?? []); setChats(data.chats ?? []); setActiveChatId(data.activeChatId ?? ""); setSuggestions(data.suggestions ?? []); } }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "Coach history couldn’t load."); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  // Arriving at a conversation means arriving at the end of it. This used to be a
  // smooth scrollIntoView, which animated from the top of a container whose height
  // was wrong, so a returning athlete landed on their oldest question with the
  // newest one thousands of pixels below the fold.
  //
  // The first scroll of a loaded thread is instant and happens before paint, so
  // there is no visible travel. Everything after it animates, because then the
  // movement is telling you something arrived.
  const settled = useRef(false);
  useIsomorphicLayoutEffect(() => {
    const thread = threadRef.current;
    if (!thread || (!messages.length && !sending)) return;
    thread.scrollTo({ top: thread.scrollHeight, behavior: settled.current ? "smooth" : "auto" });
    settled.current = true;
  }, [messages.length, sending]);
  async function send(explicitQuestion?: string, retryMessageId?: string) {
    const pending = (explicitQuestion ?? question).trim();
    if (!pending || sending) return;
    const messageId = retryMessageId ?? crypto.randomUUID();
    setQuestion(""); setSending(true); setError(""); setFailure(null);
    const optimistic: CoachMessage = { id: messageId, role: "user", content: pending };
    if (!retryMessageId) setMessages((current) => [...current, optimistic]);
    try {
      const response = await fetch("/api/coach", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: pending, messageId, chatId: activeChatId }) });
      const data = await response.json() as { user?: CoachMessage; assistant?: CoachMessage; suggestions?: string[]; safety?: SafetySignal; error?: { code?: string; message?: string } };
      // The scan runs on the server for every outcome, so an athlete who asks
      // Coach whether they can train after a head knock gets the same answer
      // whether or not the model replied at all.
      if (data.safety) setSafety(data.safety.level === "none" ? null : { signal: data.safety, messageId });
      if (!response.ok || !data.assistant) {
        const code = data.error?.code ?? "AI_UNAVAILABLE";
        // The saved turn is still processing elsewhere. Keeping it in the
        // thread avoids inviting the athlete to send a second copy of it.
        if (code !== "COACH_RESPONSE_PENDING") setQuestion(pending);
        setFailure({ messageId, question: pending, code, message: data.error?.message ?? "FightIQ Coach couldn’t answer." });
        return;
      }
      setMessages((current) => [...current.filter((item) => item.id !== messageId && item.id !== data.assistant?.id), data.user ?? optimistic, data.assistant as CoachMessage]);
      setChats((current) => current.map((chat) => chat.id === activeChatId && (chat.title === "New chat" || chat.title === "General") ? { ...chat, title: pending.replace(/[?!.,]+$/g, "").slice(0, 42) } : chat));
      if (data.suggestions) setSuggestions(data.suggestions);
    } catch {
      setQuestion(pending);
      setFailure({ messageId, question: pending, code: "NETWORK_ERROR", message: "FightIQ Coach couldn’t answer. Your message is still here." });
    }
    finally { setSending(false); }
  }
  function focusCompose() {
    requestAnimationFrame(() => composeRef.current?.focus());
  }
  async function newChat() { if (sending) return; setError(""); try { const response = await fetch("/api/coach/chats", { method: "POST" }); const data = await response.json() as { chat?: CoachChat; error?: { message?: string } }; if (!response.ok || !data.chat) throw new Error(data.error?.message); setQuestion(""); await loadChat(data.chat.id); requestAnimationFrame(() => composeRef.current?.focus()); } catch (caught) { setError(caught instanceof Error ? caught.message : "FightIQ couldn’t start a new chat."); } }
  function sendWithKeyboard(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void send();
    }
  }
  const latestMessage = messages.at(-1);
  const activeFollowUp = latestMessage?.role === "assistant" && latestMessage.follow_up?.trim() ? latestMessage : null;
  const showSuggestions = suggestions.length > 0 && !activeFollowUp && !sending && !failure;
  const failureText = failure?.message.toLowerCase().includes("preserved")
    ? failure.message
    : failure ? `${failure.message} Your message was preserved.` : "";
  return <main className="page product-page native-page coach-page"><header className="page-header coach-header"><div><p className="question-progress">YOUR COACH</p><h1 className="page-title">Ask FightIQ</h1></div><button className="new-chat-button" onClick={() => void newChat()} disabled={sending}><Plus size={15} /> New chat</button></header>
    {chats.length > 1 && <label className="coach-chat-picker"><span>CHAT</span><select value={activeChatId} onChange={(event) => void loadChat(event.target.value)}>{chats.map((chat) => <option value={chat.id} key={chat.id}>{chat.title}</option>)}</select></label>}
    <section className="coach-thread" ref={threadRef}>
      {loading && <LoadingState label="Loading your conversation…" />}
      {!loading && messages.length === 0 && <div className="coach-empty"><div className="coming-icon"><MessageCircle size={25} /></div><h2>What do you want to sharpen?</h2></div>}
      {messages.map((message) => {
        const isActiveFollowUp = activeFollowUp?.id === message.id;
        const quickReplies = isActiveFollowUp ? (message.follow_up_choices ?? []).slice(0, 3) : [];
        return <div className={`chat-message ${message.role}`} key={message.id}><span>{message.role === "assistant" ? "FIGHTIQ" : "YOU"}</span><div className="chat-bubble">{(message.role === "assistant" ? messageParagraphs(message.content) : [message.content]).map((paragraph, index) => <p key={`${message.id}-${index}`}>{paragraph}</p>)}</div>{message.role === "assistant" && message.follow_up && (isActiveFollowUp ? <section className="coach-follow-up" aria-label={`FightIQ asks: ${cleanAiDisplay(message.follow_up)}`}><p>{cleanAiDisplay(message.follow_up)}</p>{quickReplies.length === 3 && <><span>CHOOSE THE CLOSEST ANSWER</span><div className="coach-quick-replies">{quickReplies.map((choice) => <button key={choice} onClick={() => void send(choice)} disabled={sending}>{cleanAiDisplay(choice)}<ChevronRight size={15} /></button>)}<button className="not-sure" onClick={() => void send("Not sure")} disabled={sending}>Not sure<ChevronRight size={15} /></button></div></>}<button className="coach-type-answer" onClick={focusCompose}>Type or talk instead</button></section> : <div className="coach-follow-up resolved"><p>{cleanAiDisplay(message.follow_up)}</p></div>)}{message.role === "assistant" && message.video_mode && message.video_mode !== "none" && message.video_topic && <div className="coach-video-offer"><span>{message.video_mode === "direct" ? "VIDEO PICKS" : "SEE THE DETAIL"}</span><p>{message.video_prompt || `Want a video on ${message.video_topic}?`}</p><button onClick={() => onStudyVideo(message.video_topic ?? "")}>{message.video_mode === "direct" ? "Open video picks" : "Show me a video"}<ChevronRight size={14} /></button></div>}</div>;
      })}
      {sending && <div className="chat-message assistant thinking"><span>FIGHTIQ</span><div className="chat-bubble"><p><LoaderCircle size={15} className="spin" /> Thinking with your training context…</p></div></div>}
      <div ref={endRef} />
    </section>
    {showSuggestions && <section className="coach-suggestions" aria-label="Suggested questions"><span>ASK NEXT</span><div className="prompt-list">{suggestions.map((prompt) => <button key={prompt} onClick={() => void send(prompt)} disabled={sending}>{prompt}<ChevronRight size={15} /></button>)}</div></section>}
    {(error || voice.voiceError) && <p className="error-message" role="alert">{error || voice.voiceError}</p>}
    {safety && <div className="coach-safety"><SafetyNotice signal={safety.signal} storageKey={`fightiq-safety-coach-${safety.messageId}`} /></div>}
    {failure && <div className="coach-error" role="alert"><p>{failureText}</p><button onClick={() => void send(failure.question, failure.messageId)} disabled={sending}><RefreshCw size={15} /> {failure.code === "COACH_RESPONSE_PENDING" ? "Check for reply" : "Retry"}</button></div>}
    <div className="coach-compose"><textarea ref={composeRef} value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={sendWithKeyboard} placeholder={activeFollowUp ? "Type or talk a different answer…" : "Ask about training, technique, recovery, workouts, or food…"} aria-label="Ask FightIQ" aria-keyshortcuts="Control+Enter Meta+Enter" /><button className={`answer-mic ${voice.listening ? "listening" : ""}`} onClick={voice.toggle} aria-label={voice.listening ? "Stop listening" : "Ask by voice"}>{voice.listening ? <X size={19} /> : <Mic size={19} />}</button><button className="compose-send" onClick={() => void send()} disabled={!question.trim() || sending} aria-label="Send question"><Send size={18} /></button></div>
    <p className="sr-status" aria-live="polite">{sending ? "FightIQ is thinking with your training context." : messages.at(-1)?.role === "assistant" ? "FightIQ replied." : ""}</p>
  </main>;
}

// The payoff for logging. Improvement in this sport does not happen inside one
// session, so this is the first screen that zooms out far enough to show it —
// computed from sessions already in memory, with no model call and no wait.
function WeeklyReview({ sessions, target }: { sessions: ProductData["memory"]["recentTraining"]; target: number }) {
  const review = useMemo(() => buildWeeklyReview(sessions, target), [sessions, target]);
  return <section className="week-review">
    <div className="week-head">
      <p className="eyebrow">YOUR LAST SEVEN DAYS</p>
      <h2>{review.headline}</h2>
      <p className="week-sub">{review.subline}</p>
    </div>
    {review.hasData && <>
      <div className="week-stats">
        <div><strong>{review.sessions}</strong><small>{review.sessions === 1 ? "session" : "sessions"}</small></div>
        <div><strong>{review.days}</strong><small>{review.days === 1 ? "day trained" : "days trained"}</small></div>
        {(() => { const rest = restTile(review.days, review.hardestGapDays); return rest ? <div><strong>{rest.value}</strong><small>{rest.label}</small></div> : null; })()}
      </div>
      {review.disciplines.length > 1 && <p className="week-split">{review.disciplines.map((item) => `${item.name} ×${item.sessions}`).join(" · ")}</p>}
      {review.themes.length > 0 && <div className="week-themes">
        <span className="field-label">WHAT KEPT COMING UP</span>
        {review.themes.map((theme) => <div className={`week-theme ${theme.status}`} key={theme.label}>
          <strong>{theme.label}</strong>
          <span>{theme.sessions === 1 ? "1 session" : `${theme.sessions} sessions`}</span>
          <em>{themeStatusLabel(theme.status)}</em>
        </div>)}
        <p className="week-note">FightIQ can see what you stopped writing down. It cannot see what you fixed. That part is still your call.</p>
      </div>}
    </>}
  </section>;
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
  return <main className="page product-page native-page game-page"><ScreenHeader title="My Game" kicker="YOUR FIGHTER BRAIN" />
    {!data && !error && <LoadingState />}{error && <div className="compact-error"><p>{error}</p><button onClick={() => void reload()}>Retry</button></div>}
    {data && (() => {
      // A card with only a placeholder in it has nothing, whether that is day
      // one or session eleven. It says what it is waiting for either way.
      const unlocks = unlockCards(data.sessionsLogged);
      const strengths = data.memory.strongestAreas.filter((item) => !isPlaceholderMemory(item));
      const problems = data.memory.recurringProblems.filter((item) => !isPlaceholderMemory(item));
      return <>
      {/* Day one, this screen was five cards each saying nothing is here yet.
          The rules behind them are real, so it says what they are and what the
          next few sessions unlock instead of asking for patience. */}
      {data.opening
        ? <section className="game-plan"><p className="eyebrow">WHAT HAPPENS NEXT</p>
          <ol>{firstWeekPlan(data.profile.athleteSetup.sessionsPerWeek).map((step) => <li key={step.after}><strong>{step.after}</strong><span>{step.gets}</span></li>)}</ol>
        </section>
        : <WeeklyReview sessions={data.memory.recentTraining} target={data.profile.athleteSetup.sessionsPerWeek} />}
      <section className="game-hero"><div><p className="eyebrow">CURRENT FOCUS</p>{editing ? <input value={focus} onChange={(event) => setFocus(event.target.value)} aria-label="Current focus" /> : <h2>{data.memory.currentFocus}</h2>}<p>{data.memory.focusReason}</p></div><button className="round-action" onClick={() => { if (!editing) { setFocus(data.memory.currentFocus); setInfluences(data.memory.styleInfluences.join(", ")); } setEditing((value) => !value); }} aria-label="Edit My Game"><Pencil size={16} /></button></section>
      <div className="game-grid">
        <section className="game-card"><span>STRENGTHS</span>{strengths.length ? strengths.map((item) => <strong key={item}>{cleanAiDisplay(item)}</strong>) : <p>{unlocks.strengths}</p>}</section>
        <section className="game-card problem"><span>RECURRING PROBLEMS</span>{problems.length ? problems.map((item) => <strong key={item}>{cleanAiDisplay(item)}</strong>) : <p>{unlocks.problems}</p>}</section>
        <section className="game-card wide"><span>RECENT IMPROVEMENT</span><p>{isPlaceholderMemory(data.memory.recentImprovement) ? unlocks.improvement : cleanAiDisplay(data.memory.recentImprovement)}</p></section>
        <section className="game-card wide"><span>STYLE / FIGHTER INFLUENCES</span>{editing ? <input value={influences} onChange={(event) => setInfluences(event.target.value)} placeholder="e.g. Volkanovski, pressure boxing" aria-label="Style and fighter influences" /> : <p>{data.memory.styleInfluences.length ? data.memory.styleInfluences.join(" · ") : "Add fighters or styles that influence the game you want to build."}</p>}</section>
      </div>
      <section className="build-next"><Sparkles size={20} /><div><span>NEXT EVOLUTION</span><h3>{data.memory.nextEvolution}</h3></div></section>
      {editing && <button className="primary-button" onClick={save} disabled={saving || !focus.trim()}>{saving ? "SAVING…" : <><Save size={17} /> SAVE MY GAME</>}</button>}
      {saved && <p className="saved-note" role="status"><Check size={14} /> My Game updated.</p>}
      </>;
    })()}
  </main>;
}

type WorkoutSetup = { equipment: string[]; location: string; defaultDuration: number; unit: "lb" | "kg"; limitations: string };
type WorkoutExercise = { key: string; name: string; substitute: string; sets: number; reps: string; rest: string; target: string; why: string; helps: string; loadInstruction: string; keyLift?: boolean };
type GeneratedWorkout = { id: string; discipline: string; goal: string; fatigue: string; duration: number; setup: WorkoutSetup; plan: { title: string; loadNote: string; warmup: string; exercises: WorkoutExercise[]; finish: string } };

export function WorkoutScreen({ onBack }: { onBack: () => void }) {
  const [discipline, setDiscipline] = useState("MMA");
  const [goal, setGoal] = useState("Fight performance");
  const [fatigue, setFatigue] = useState("medium");
  const [duration, setDuration] = useState(35);
  const [workout, setWorkout] = useState<GeneratedWorkout | null>(null);
  const [setup, setSetup] = useState<WorkoutSetup | null>(null);
  const [draft, setDraft] = useState<WorkoutSetup>({ equipment: [], location: "Home", defaultDuration: 35, unit: "lb", limitations: "" });
  const [editingSetup, setEditingSetup] = useState(false);
  const [results, setResults] = useState<Record<string, { load: string; reps: string; effort: string }>>({});
  const [completion, setCompletion] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { void fetch("/api/product").then(async (response) => response.ok ? response.json() as Promise<ProductData> : null).then((data) => {
    const preferred = data?.profile.athleteSetup.disciplines.find((item) => ["MMA", "BJJ", "Wrestling", "Boxing", "Muay Thai"].includes(item));
    if (preferred) setDiscipline(preferred);
    if (data?.profile.primaryGoal === "gain muscle") setGoal("Strength");
    if (data?.profile.primaryGoal === "performance") setGoal("Fight performance");
  }).catch(() => undefined); void fetch("/api/workouts").then(async (response) => response.ok ? response.json() as Promise<{ setup: WorkoutSetup | null }> : null).then((data) => { if (data?.setup) { setSetup(data.setup); setDraft(data.setup); setDuration(data.setup.defaultDuration); } }).catch(() => undefined); }, []);
  const equipmentOptions = [["bodyweight", "Bodyweight"], ["bands", "Bands"], ["dumbbells", "Dumbbells"], ["kettlebells", "Kettlebells"], ["barbell rack", "Barbell + rack"], ["bench", "Bench"], ["cables machines", "Cables / machines"], ["cardio", "Cardio"], ["sled med ball", "Sled / med ball"], ["full gym", "Full gym"]] as const;
  function toggleEquipment(value: string) { setDraft((current) => ({ ...current, equipment: current.equipment.includes(value) ? current.equipment.filter((item) => item !== value) : [...current.equipment, value] })); }
  async function saveSetup() { setLoading(true); setError(""); try { const response = await fetch("/api/workouts", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) }); const data = await response.json() as { setup?: WorkoutSetup; error?: { message?: string } }; if (!response.ok || !data.setup) throw new Error(data.error?.message ?? "FightIQ couldn’t save your gym setup."); setSetup(data.setup); setDraft(data.setup); setDuration(data.setup.defaultDuration); setEditingSetup(false); } catch (caught) { setError(caught instanceof Error ? caught.message : "FightIQ couldn’t save your gym setup."); } finally { setLoading(false); } }
  async function generate() {
    setLoading(true); setError(""); setWorkout(null);
    try { const response = await fetch("/api/workouts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ discipline, goal, fatigue, duration }) }); const data = await response.json() as GeneratedWorkout & { error?: { message?: string } }; if (!response.ok) throw new Error(data.error?.message); setWorkout(data); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "FightIQ couldn’t build this workout."); }
    finally { setLoading(false); }
  }
  async function completeWorkout() { if (!workout) return; setLoading(true); setError(""); const payload = workout.plan.exercises.filter((exercise) => exercise.keyLift).flatMap((exercise) => { const result = results[exercise.key]; return result?.load || result?.reps || result?.effort ? [{ exerciseKey: exercise.key, completedSets: exercise.sets, load: Number(result.load), reps: Number(result.reps), unit: workout.setup.unit, effort: result.effort || "not_logged" }] : []; }); try { const response = await fetch(`/api/workouts/${workout.id}/complete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ results: payload }) }); const data = await response.json() as { guidance?: Array<{ nextAction: string }>; error?: { message?: string } }; if (!response.ok) throw new Error(data.error?.message); setCompletion((data.guidance ?? []).map((item) => item.nextAction)); } catch (caught) { setError(caught instanceof Error ? caught.message : "FightIQ couldn’t save that workout."); } finally { setLoading(false); } }
  return <main className="page product-page native-page workout-page"><ScreenHeader title="Workout" kicker="MARTIAL-ART-SPECIFIC" onBack={onBack} />
    {(!setup || editingSetup) && <section className="workout-setup"><p className="eyebrow">YOUR WORKOUT SETUP</p><h2>What can you train with?</h2><p>FightIQ will only choose movements you can actually do.</p><div className="setup-chip-grid">{equipmentOptions.map(([value, label]) => <button key={value} className={draft.equipment.includes(value) ? "selected" : ""} onClick={() => toggleEquipment(value)}>{draft.equipment.includes(value) && <Check size={13} />}{label}</button>)}</div><div className="setup-number-grid two"><label>USUAL LOCATION<select value={draft.location} onChange={(event) => setDraft((current) => ({ ...current, location: event.target.value }))}><option>Home</option><option>Commercial gym</option><option>Fight gym</option><option>Outdoors</option></select></label><label>WEIGHT UNIT<select value={draft.unit} onChange={(event) => setDraft((current) => ({ ...current, unit: event.target.value as "lb" | "kg" }))}><option value="lb">Pounds</option><option value="kg">Kilograms</option></select></label></div><label className="field-label" htmlFor="setup-duration">USUAL TIME: {draft.defaultDuration} MIN</label><input id="setup-duration" className="range-field" type="range" min="20" max="60" step="5" value={draft.defaultDuration} onChange={(event) => setDraft((current) => ({ ...current, defaultDuration: Number(event.target.value) }))} /><label className="field-label" htmlFor="limitations">PAIN OR LIMITATIONS <em>OPTIONAL</em></label><textarea id="limitations" className="setup-input workout-limitations" value={draft.limitations} onChange={(event) => setDraft((current) => ({ ...current, limitations: event.target.value }))} placeholder="e.g. sore shoulder, avoid jumping" maxLength={300} />{error && <p className="error-message">{error}</p>}<button className="primary-button" onClick={() => void saveSetup()} disabled={loading}>{loading ? "SAVING…" : "SAVE WORKOUT SETUP"}</button></section>}
    {setup && !editingSetup && !workout && <>
      <button className="workout-gear" onClick={() => setEditingSetup(true)}><span>YOUR SETUP</span><strong>{setup.equipment.slice(0, 3).join(" · ")}{setup.equipment.length > 3 ? " +" : ""}</strong><Pencil size={15} /></button>
      <section className="focus-banner workout-intro"><Dumbbell size={22} /><h2>Build around training.</h2></section>
      <span className="field-label">MARTIAL ART</span><div className="chip-row">{["MMA", "BJJ", "Wrestling", "Boxing", "Muay Thai"].map((item) => <button className={`chip ${discipline === item ? "selected" : ""}`} key={item} onClick={() => setDiscipline(item)}>{item}</button>)}</div>
      <label className="field-label" htmlFor="workout-goal">GOAL</label><select id="workout-goal" className="select-field" value={goal} onChange={(event) => setGoal(event.target.value)}><option>Fight performance</option><option>Strength</option><option>Power</option><option>Conditioning</option><option>Recovery support</option></select>
      <span className="field-label">MARTIAL ARTS FATIGUE</span><div className="choice-stack">{[["low", "Fresh", "No hard session in the last 24 hours"], ["medium", "Some fatigue", "Normal soreness or trained yesterday"], ["high", "Heavy", "Hard rounds, heavy legs, or several recent sessions"]].map(([value, title, note]) => <button className={fatigue === value ? "selected" : ""} key={value} onClick={() => setFatigue(value)}><span>{title}</span><small>{note}</small><Check size={16} /></button>)}</div>
      <label className="field-label" htmlFor="duration">TIME: {duration} MIN</label><input id="duration" className="range-field" type="range" min="20" max="60" step="5" value={duration} onChange={(event) => setDuration(Number(event.target.value))} />
      {error && <p className="error-message">{error}</p>}<button className="primary-button" onClick={generate} disabled={loading}>{loading ? "BUILDING AROUND YOUR LOAD…" : <><Sparkles size={18} /> BUILD MY WORKOUT</>}</button>
    </>}
    {workout && <section className="workout-plan"><p className="eyebrow">SAVED TO YOUR TRAINING CONTEXT</p><h2>{workout.plan.title}</h2><p className="load-note">{workout.plan.loadNote}</p><div className="plan-step warmup"><span>WARM-UP</span><p>{workout.plan.warmup}</p></div>{workout.plan.exercises.map((exercise, index) => <article className="exercise-card detailed" key={exercise.key}><span className="exercise-number">{String(index + 1).padStart(2, "0")}</span><div><h3>{exercise.name}</h3><strong>{exercise.sets} sets · {exercise.reps}</strong><div className="exercise-meta"><span>REST {exercise.rest}</span><span>{exercise.target.toUpperCase()}</span></div><p>{exercise.loadInstruction}</p><p><b>Why:</b> {exercise.why}</p><p><b>Helps:</b> {exercise.helps}</p><details><summary>Swap if needed <ChevronRight size={13} /></summary><p>{exercise.substitute}</p></details></div></article>)}<div className="plan-step"><span>FINISH</span><p>{workout.plan.finish}</p></div>{!completion.length && <section className="workout-complete"><p className="eyebrow">AFTER TRAINING <em>OPTIONAL</em></p><h3>Give FightIQ one useful final set.</h3><p>That’s enough to set a real next weight. Or just mark the workout complete.</p>{workout.plan.exercises.filter((exercise) => exercise.keyLift).map((exercise) => { const result = results[exercise.key] ?? { load: "", reps: "", effort: "" }; return <div className="lift-result" key={exercise.key}><strong>{exercise.name}</strong><div><input inputMode="decimal" value={result.load} placeholder={`Load ${workout.setup.unit}`} onChange={(event) => setResults((current) => ({ ...current, [exercise.key]: { ...result, load: event.target.value } }))} /><input inputMode="numeric" value={result.reps} placeholder="Final reps" onChange={(event) => setResults((current) => ({ ...current, [exercise.key]: { ...result, reps: event.target.value } }))} /></div><select value={result.effort} onChange={(event) => setResults((current) => ({ ...current, [exercise.key]: { ...result, effort: event.target.value } }))}><option value="">How did it feel?</option><option value="easy">Had 2+ reps left</option><option value="right">Right effort</option><option value="hard">Too hard</option><option value="missed">Missed reps</option><option value="pain">Pain</option></select></div>; })}{error && <p className="error-message">{error}</p>}<button className="primary-button" onClick={() => void completeWorkout()} disabled={loading}>{loading ? "SAVING…" : "SAVE & SET MY NEXT MOVE"}</button></section>}{completion.length > 0 && <section className="success-card"><Check size={20} /><div><p className="eyebrow">WORKOUT SAVED</p>{completion.map((item) => <p key={item}>{item}</p>)}</div></section>}<button className="secondary-button" onClick={() => { setWorkout(null); setResults({}); setCompletion([]); }}>BUILD A DIFFERENT PLAN</button></section>}
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
  return <main className="page product-page native-page food-page"><ScreenHeader title="Food" kicker="SIMPLE FUEL TRACKING" onBack={onBack} />
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
    {nutrition && nutrition.entries.length > 0 && <section className="today-food"><p className="eyebrow">TODAY</p>{nutrition.entries.map((entry) => <article key={entry.id}>{entry.photoUrl && <img src={entry.photoUrl} alt="Your logged meal" onError={(event) => { event.currentTarget.style.display = "none"; }} />}<div><strong>{entry.description}</strong><span>{entry.calories} kcal · P {Math.round(entry.protein)} · C {Math.round(entry.carbs)} · F {Math.round(entry.fat)}</span></div></article>)}</section>}
  </main>;
}
