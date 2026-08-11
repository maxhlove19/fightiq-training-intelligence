import type { D1 } from "./debrief-db";
import type { MemorySnapshot } from "./product-db";

export type LearnVideo = {
  id: string;
  title: string;
  creator: string;
  discipline: string;
  duration: string;
  description: string;
  thumbnail: string;
  url: string;
  why: string;
  watchFor: string;
  source: "curated" | "youtube";
};

export type LearnFeed = {
  videos: LearnVideo[];
  studyTopic: string;
  exploreUrl: string;
  liveDiscoveryAvailable: boolean;
  refreshed: boolean;
};

type CuratedVideo = Omit<LearnVideo, "thumbnail" | "url" | "why" | "watchFor" | "source"> & { topics: string[] };

// These are deliberate baseline studies, not scraped search results. The live
// search layer below broadens the feed only when its server-side credential is
// configured. Keeping this small and vetted means a missing upstream service
// never turns Learn into a blank or random feed.
const curatedCatalog: CuratedVideo[] = [
  { id: "JYzGfyg-cig", title: "How to Escape Back Mount like a Black Belt", creator: "Chewjitsu", discipline: "MMA / BJJ", duration: "Deep dive", topics: ["back", "mount", "grappling", "escape", "mma"], description: "Build a safer first response when an opponent settles back control." },
  { id: "LXrXe9JUKsE", title: "8 Reasons Your Guard Retention Breaks Down", creator: "Chewjitsu", discipline: "MMA / BJJ", duration: "Technique", topics: ["guard", "retention", "hip", "frame", "grappling"], description: "Find the structural mistake that is letting opponents pass your legs." },
  { id: "L8ulYlpzWNc", title: "Basic Muay Thai Teep Tutorial", creator: "Muay Thai PROS", discipline: "Muay Thai / MMA", duration: "Tutorial", topics: ["teep", "distance", "striking", "balance", "kick"], description: "Use balance and the teep to manage distance before an opponent enters." },
  { id: "8kq7qd7QpwE", title: "Advanced Boxing Footwork Drill", creator: "Tony Jeffries", discipline: "Boxing / MMA", duration: "Quick drill", topics: ["boxing", "footwork", "exit", "balance", "striking"], description: "Keep your feet available to punch, defend, and exit after exchanges." },
  { id: "WZnT87UqcDA", title: "A Technical Mount Escape", creator: "Chewjitsu", discipline: "BJJ / MMA", duration: "Technique", topics: ["mount", "escape", "bridge", "grappling"], description: "Combine sound position with deliberate effort instead of wasting energy." },
  { id: "dLUhx1f8H6o", title: "Masters of the Teep", creator: "Muay Thai Scholar", discipline: "Muay Thai / MMA", duration: "Study", topics: ["teep", "distance", "timing", "striking"], description: "Study how elite strikers use the teep to control pace and center line." },
  { id: "yXj9IPvxftw", title: "How to Arm Drag and Take the Back in Jiu-Jitsu", creator: "YouTube technique study", discipline: "BJJ / MMA", duration: "Technique", topics: ["arm drag", "back take", "angle", "shoulder", "grappling"], description: "Turn a clean arm drag into control before they can square back up." },
  { id: "iPB3axhgSis", title: "Arm Drag to Back Take", creator: "REALIZE BJJ LIFE", discipline: "BJJ / MMA", duration: "Technique", topics: ["arm drag", "back", "control", "grappling"], description: "Study the moment after the drag: angle, shoulder control, and back exposure." },
  { id: "osimrhg-n3U", title: "Arm Drag to Back Take", creator: "JiuJitsu FLO", discipline: "BJJ / MMA", duration: "Quick study", topics: ["arm drag", "back take", "angle", "grappling"], description: "A concise look at turning an arm drag into back exposure." },
  { id: "FypzZG6xTtc", title: "Master the Roundhouse Kick with This Drill", creator: "Namsaknoi Muay Thai", discipline: "Muay Thai / MMA", duration: "Drill", topics: ["kick", "round kick", "hip", "hip rotation", "pivot", "support foot", "balance"], description: "A focused drill for connecting the standing-foot pivot to hip rotation." },
  { id: "Hl4xhjTzT08", title: "How to Switch Kick: Lead-Leg Roundhouse", creator: "Muay Thai Scholar", discipline: "Muay Thai / MMA", duration: "Technique", topics: ["kick", "round kick", "pivot", "support foot", "balance", "hip rotation"], description: "Study how the support foot and tall posture make the hip turn through." },
];

function tokens(value: string) {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2));
}

function compact(value: string, fallback: string, max = 86) {
  const clean = value.replace(/\s+/g, " ").replace(/[.!?]+$/g, "").trim();
  return (clean || fallback).slice(0, max);
}

function topicScore(topic: string, context: string, contextTokens: Set<string>) {
  const clean = topic.toLowerCase();
  if (context.includes(clean)) return clean.includes(" ") ? 12 : 7;
  return clean.split(" ").reduce((score, word) => score + (word.length > 2 && contextTokens.has(word) ? 2 : 0), 0);
}

function contextFor(memory: MemorySnapshot) {
  // A fresh session should lead the feed. Older training is useful context, but
  // it should not dilute a problem the athlete reported today.
  const latestEntry = memory.recentTraining[0];
  const current = latestEntry ? `${latestEntry.discipline} ${latestEntry.note} ${latestEntry.takeaway ?? ""}` : "";
  const latest = memory.recentTraining.slice(1, 4).map((entry) => `${entry.discipline} ${entry.note} ${entry.takeaway ?? ""}`).join(" ");
  const focus = [memory.currentFocus, memory.focusReason, ...memory.instructorDetails, ...memory.oneTimeObservations].join(" ");
  return {
    current: current.toLowerCase(),
    latest: latest.toLowerCase(),
    focus: focus.toLowerCase(),
    currentTokens: tokens(current),
    latestTokens: tokens(latest),
    focusTokens: tokens(focus),
  };
}

function disciplineFromContext(value: string) {
  const lower = value.toLowerCase();
  if (/muay thai|round kick|teep|support foot|hip rotation/.test(lower)) return "Muay Thai / MMA";
  if (/boxing|jab|cross|hook|footwork/.test(lower)) return "Boxing / MMA";
  if (/wrestl|single leg|double leg|takedown|penetration/.test(lower)) return "Wrestling / MMA";
  if (/bjj|jiu-jitsu|jiujitsu|guard|arm drag|back take|mount/.test(lower)) return "BJJ / MMA";
  return "MMA";
}

// What the athlete has actually written outranks what they ticked in setup —
// but on day one there is nothing written, and the disciplines are the only
// thing standing between a Muay Thai athlete and a boxing footwork drill.
function signalText(memory: MemorySnapshot) {
  const written = `${memory.recentTraining[0]?.note ?? ""} ${memory.currentFocus} ${memory.instructorDetails[0] ?? ""}`.trim();
  return `${written} ${memory.recentTraining.length ? "" : memory.disciplines.join(" ")}`.toLowerCase();
}

/** Maps a declared discipline onto the family its curated studies live in. */
function familyForDisciplines(disciplines: string[]) {
  const text = disciplines.join(" ").toLowerCase();
  if (/muay thai|kickbox/.test(text)) return "muay-thai-kick";
  if (/bjj|jiu|grappl/.test(text)) return "guard-retention";
  if (/wrestl/.test(text)) return "wrestling-takedown";
  if (/boxing/.test(text)) return "boxing-footwork";
  return "";
}

function queryVariants(memory: MemorySnapshot, topicOverride?: string) {
  const requestedTopic = topicOverride?.replace(/\s+/g, " ").trim().slice(0, 140) ?? "";
  if (requestedTopic) return [
    requestedTopic,
    `${requestedTopic} drill under pressure`,
    `${requestedTopic} common mistakes and corrections`,
    `${requestedTopic} live application`,
  ];
  const raw = signalText(memory);
  return /kick|hip|pivot|bag|roundhouse|muay thai/.test(raw)
    ? ["Muay Thai round kick support foot pivot", "Muay Thai hip rotation round kick balance", "Muay Thai round kick timing and return to stance", "Muay Thai round kick mechanics drill"]
    : /arm drag/.test(raw)
      ? ["BJJ arm drag take back control", "BJJ arm drag opponent squares back", "MMA arm drag back take drill", "BJJ arm drag shoulder control under resistance"]
      : /guard|pass/.test(raw)
        ? ["BJJ guard retention frames hip movement", "BJJ guard retention drill under pressure", "MMA guard retention technique", "BJJ guard retention recovering inside position"]
        : /wrestl|single leg|double leg|takedown/.test(raw)
          ? ["wrestling takedown finish in live rounds", "wrestling penetration step timing drill", "MMA wrestling chain takedown", "wrestling finish takedown when opponent defends"]
          : /box|jab|cross|hook|footwork/.test(raw)
            ? ["boxing footwork exit drill technique", "boxing balance after combination", "boxing defensive footwork drill", "boxing footwork after punching combination"]
            : [`MMA ${compact(memory.currentFocus, "fundamentals", 70)}`, `MMA ${compact(memory.focusReason, "technique drill", 70)}`, "MMA technique drilling in live rounds", "MMA technique under controlled resistance"];
}

function queryFor(memory: MemorySnapshot, refreshCursor: number, topicOverride?: string) {
  const variants = queryVariants(memory, topicOverride);
  return variants[Math.abs(refreshCursor) % variants.length].replace(/\s+/g, " ").trim().slice(0, 180);
}

function topicFamily(memory: MemorySnapshot) {
  const raw = signalText(memory);
  if (/kick|hip|pivot|bag|roundhouse|muay thai/.test(raw)) return "muay-thai-kick";
  if (/arm drag/.test(raw)) return "arm-drag";
  if (/guard|pass/.test(raw)) return "guard-retention";
  if (/wrestl|single leg|double leg|takedown/.test(raw)) return "wrestling-takedown";
  if (/box|jab|cross|hook|footwork/.test(raw)) return "boxing-footwork";
  // Nothing written and nothing matched: fall back to what they train rather
  // than to generic MMA.
  return familyForDisciplines(memory.disciplines) || "mma-foundations";
}

function familyBoost(family: string, topics: string[]) {
  const has = (...values: string[]) => values.some((value) => topics.includes(value));
  if (family === "muay-thai-kick") return has("round kick", "hip rotation", "pivot", "support foot") ? 80 : has("kick") ? 45 : 0;
  if (family === "arm-drag") return has("arm drag", "back take", "angle", "shoulder") ? 80 : has("back", "control") ? 35 : 0;
  if (family === "guard-retention") return has("guard", "retention", "frame") ? 80 : has("hip", "grappling") ? 25 : 0;
  if (family === "wrestling-takedown") return has("takedown", "wrestling", "entry", "finish") ? 80 : 0;
  if (family === "boxing-footwork") return has("boxing", "footwork", "exit") ? 80 : has("balance", "striking") ? 25 : 0;
  return 0;
}

function thumbnail(videoId: string) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function videoUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function studyWatchFor(topic: string) {
  const lower = topic.toLowerCase();
  if (/support foot|pivot/.test(lower)) return "Watch whether the support foot turns before the hip starts to come through.";
  if (/hip|round kick|roundhouse/.test(lower)) return "Watch the order: foot turns, hip follows, then the kick returns balanced.";
  if (/arm drag/.test(lower)) return "Watch the step to the angle straight after the drag, before they can square back up.";
  if (/guard|frame/.test(lower)) return "Watch which frame stays connected while the hips make space.";
  if (/takedown|single leg|double leg/.test(lower)) return "Watch where the head and feet arrive before they try to finish.";
  return `Watch for the exact ${compact(topic, "technique", 54)} detail the athlete logged.`;
}

function currentTrainingSignal(memory: MemorySnapshot) {
  return compact(memory.oneTimeObservations[0] || memory.recentTraining[0]?.takeaway || memory.currentFocus, "your current training", 120);
}

function whyAndWatchFor(video: Pick<CuratedVideo, "topics">, memory: MemorySnapshot, index: number) {
  const { current, latest, focus, currentTokens, latestTokens, focusTokens } = contextFor(memory);
  const currentMatches = video.topics.filter((topic) => topicScore(topic, current, currentTokens) > 0);
  const recentMatches = video.topics.filter((topic) => topicScore(topic, latest, latestTokens) > 0);
  const focusMatches = video.topics.filter((topic) => topicScore(topic, focus, focusTokens) > 0);
  const first = currentMatches[0] ?? recentMatches[0] ?? focusMatches[0] ?? video.topics[0] ?? "the first key detail";
  const why = currentMatches.length
    ? `Your latest session mentioned ${currentMatches.slice(0, 2).join(" and ")}. This stays on that exact layer.`
    : recentMatches.length
      ? `A recent session points to ${recentMatches.slice(0, 2).join(" and ")}. This keeps building that detail.`
    : focusMatches.length
      ? `It supports your current study focus through ${focusMatches.slice(0, 2).join(" and ")}.`
      : index === 0
        ? "It is the closest supporting study for the next layer of the work you are building."
        : "It builds a related skill without pulling you away from the work you logged.";
  const watchFor = video.topics.includes("support foot") || video.topics.includes("pivot")
    ? "Watch whether the support foot turns before the hip comes through."
    : video.topics.includes("arm drag")
      ? "Watch the step to the angle right after the drag, before they can square up."
      : video.topics.includes("back take")
        ? "Watch how they keep shoulder control while they take the angle."
        : video.topics.includes("guard")
          ? "Watch which frame stays in place as the hips move."
          : video.topics.includes("footwork")
            ? "Watch what the lead foot does before the exit."
            : `Watch the ${first} detail and compare it to the moment you logged.`;
  return { why, watchFor };
}

function rankedCurated(memory: MemorySnapshot, refreshCursor: number, excludeIds: Set<string>) {
  const { current, latest, focus, currentTokens, latestTokens, focusTokens } = contextFor(memory);
  const family = topicFamily(memory);
  const ranked = curatedCatalog
    .filter((video) => !excludeIds.has(video.id))
    .map((video) => ({
      ...video,
      domainBoost: familyBoost(family, video.topics),
      score: familyBoost(family, video.topics) + video.topics.reduce((score, topic) => score + topicScore(topic, current, currentTokens) * 9 + topicScore(topic, latest, latestTokens) * 3 + topicScore(topic, focus, focusTokens) * 2, 0) + (video.discipline.includes("MMA") ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  if (!refreshCursor || ranked.length < 2) return ranked;
  const priority = family === "mma-foundations" ? ranked.filter((video) => video.score > 1) : ranked.filter((video) => video.domainBoost > 0);
  const supporting = ranked.filter((video) => !priority.includes(video));
  if (priority.length < 2) return ranked;
  const offset = refreshCursor % priority.length;
  return [...priority.slice(offset), ...priority.slice(0, offset), ...supporting];
}

type YouTubeSearchItem = { id?: { videoId?: unknown }; snippet?: { title?: unknown; channelTitle?: unknown; description?: unknown; publishedAt?: unknown } };
type YouTubeVideoItem = { id?: unknown; contentDetails?: { duration?: unknown }; status?: { embeddable?: unknown; privacyStatus?: unknown } };
type YouTubeSearchResult = { videos: LearnVideo[]; upstreamUnavailable: boolean };

function isVideoId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{11}$/.test(value);
}

function isoDuration(value: unknown) {
  if (typeof value !== "string") return "YouTube";
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return "YouTube";
  const [, hours, minutes, seconds] = match;
  const parts = hours ? [hours, String(minutes ?? "0").padStart(2, "0"), String(seconds ?? "0").padStart(2, "0")] : [minutes ?? "0", String(seconds ?? "0").padStart(2, "0")];
  return parts.join(":");
}

async function youtubeJson(url: URL, timeoutMs = 6500): Promise<{ payload: Record<string, unknown> | null; upstreamUnavailable: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return { payload: null, upstreamUnavailable: true };
    return { payload: await response.json() as Record<string, unknown>, upstreamUnavailable: false };
  } catch { return { payload: null, upstreamUnavailable: true }; } finally { clearTimeout(timeout); }
}

function directTopicMatch(query: string, title: string, description: string) {
  const text = `${title} ${description}`.toLowerCase();
  const queryWords = [...tokens(query)];
  const genericWords = new Set(["mma", "muay", "thai", "bjj", "jiu", "jiujitsu", "boxing", "wrestling", "technique", "tutorial", "drill", "training", "live", "under", "pressure", "application", "common", "mistakes", "corrections", "with", "your", "from", "that"]);
  const intentWords = queryWords.filter((word) => !genericWords.has(word));
  if (!intentWords.length) return true;
  const phrase = intentWords.length > 1 ? intentWords.slice(0, Math.min(3, intentWords.length)).join(" ") : "";
  const matched = intentWords.filter((word) => text.includes(word) || (word === "round" && text.includes("roundhouse"))).length;
  return Boolean(phrase && text.includes(phrase)) || matched >= Math.min(intentWords.length, intentWords.length >= 4 ? 2 : 1);
}

async function searchYouTube(apiKey: string, memory: MemorySnapshot, refreshCursor: number, excludeIds: Set<string>, topicOverride?: string): Promise<YouTubeSearchResult> {
  const query = queryFor(memory, refreshCursor, topicOverride);
  const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  searchUrl.search = new URLSearchParams({ part: "snippet", type: "video", maxResults: "18", q: query, order: refreshCursor % 2 ? "date" : "relevance", videoEmbeddable: "true", videoSyndicated: "true", safeSearch: "strict", relevanceLanguage: "en", key: apiKey }).toString();
  const search = await youtubeJson(searchUrl);
  const items = Array.isArray(search.payload?.items) ? search.payload.items as YouTubeSearchItem[] : [];
  const candidates = items.map((item) => ({ id: item.id?.videoId, snippet: item.snippet })).filter((item): item is { id: string; snippet: NonNullable<YouTubeSearchItem["snippet"]> } => isVideoId(item.id) && !excludeIds.has(item.id) && typeof item.snippet?.title === "string" && typeof item.snippet?.channelTitle === "string").slice(0, 12);
  if (!candidates.length) return { videos: [], upstreamUnavailable: search.upstreamUnavailable };

  const detailUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  detailUrl.search = new URLSearchParams({ part: "contentDetails,status", id: candidates.map((item) => item.id).join(","), key: apiKey }).toString();
  const details = await youtubeJson(detailUrl);
  const allowed = new Map((Array.isArray(details.payload?.items) ? details.payload.items as YouTubeVideoItem[] : []).filter((item) => isVideoId(item.id) && item.status?.embeddable === true && item.status?.privacyStatus === "public").map((item) => [item.id as string, isoDuration(item.contentDetails?.duration)]));
  const discipline = disciplineFromContext(`${memory.currentFocus} ${memory.recentTraining[0]?.note ?? ""}`);
  const topicWords = query.toLowerCase().split(/\s+/).filter((word) => word.length > 2);
  const relevance = (title: string, description: string) => {
    const titleWords = tokens(title);
    const descriptionWords = tokens(description);
    return topicWords.reduce((score, word) => score + (titleWords.has(word) ? 8 : 0) + (descriptionWords.has(word) ? 2 : 0), 0)
      + (title.toLowerCase().includes(query.toLowerCase()) ? 16 : 0);
  };
  const ranked = candidates.filter((item) => allowed.has(item.id)).map((item) => {
    const title = String(item.snippet.title).replace(/\s+/g, " ").trim().slice(0, 150);
    const creator = String(item.snippet.channelTitle).replace(/\s+/g, " ").trim().slice(0, 90);
    const detail = typeof item.snippet.description === "string" ? compact(item.snippet.description, `A study selected for ${query}.`, 180) : `A study selected for ${query}.`;
    return { id: item.id, title, creator, discipline, duration: allowed.get(item.id) ?? "YouTube", description: detail, score: relevance(title, detail), direct: directTopicMatch(query, title, detail) };
  }).filter((item) => item.score > 0 && item.direct).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, 8);
  const signal = currentTrainingSignal(memory);
  return { videos: ranked.map(({ score, direct, ...item }) => {
    void score;
    void direct;
    return {
      ...item,
      thumbnail: thumbnail(item.id), url: videoUrl(item.id), source: "youtube" as const,
      why: `You logged ${signal}. This stays on ${compact(query, "that exact detail", 78)}.`,
      watchFor: studyWatchFor(query),
    };
  }), upstreamUnavailable: details.upstreamUnavailable };
}

export async function getRecentVideoIds(db: D1, ownerId: string, family: string) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await db.prepare("SELECT video_id FROM video_recommendation_history WHERE owner_id = ? AND study_topic = ? AND served_at >= ? ORDER BY served_at DESC LIMIT 80").bind(ownerId, family, since).all<{ video_id: string }>();
  return new Set((rows.results ?? []).map((row) => row.video_id));
}

export async function rememberVideoRefresh(db: D1, ownerId: string, videos: LearnVideo[], studyTopicFamily: string) {
  if (!videos.length) return;
  const now = new Date().toISOString();
  await db.batch(videos.map((video) => db.prepare(`INSERT INTO video_recommendation_history (owner_id, video_id, study_topic, served_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(owner_id, video_id) DO UPDATE SET study_topic = excluded.study_topic, served_at = excluded.served_at`)
    .bind(ownerId, video.id, studyTopicFamily.slice(0, 180), now)));
}

export async function buildLearnFeed(args: { db: D1; ownerId: string; memory: MemorySnapshot; youtubeApiKey?: string; refreshCursor: number; topicOverride?: string }) : Promise<LearnFeed> {
  const refresh = args.refreshCursor > 0;
  const studyTopic = queryFor(args.memory, args.refreshCursor, args.topicOverride);
  const rankingMemory = args.topicOverride?.trim()
    ? { ...args.memory, currentFocus: studyTopic, focusReason: "A specific technique from your Coach conversation.", recentTraining: [] }
    : args.memory;
  const family = topicFamily(rankingMemory);
  const recentIds = refresh ? await getRecentVideoIds(args.db, args.ownerId, family) : new Set<string>();
  const liveSearch = refresh && args.youtubeApiKey?.trim()
    ? await searchYouTube(args.youtubeApiKey, args.memory, args.refreshCursor, recentIds, args.topicOverride)
    : { videos: [], upstreamUnavailable: false };
  const liveVideos = liveSearch.videos;
  const used = new Set([...recentIds, ...liveVideos.map((video) => video.id)]);
  const curatedLimit = liveVideos.length ? 12 - liveVideos.length : 10;
  // A small curated library should rotate before it repeats, but it must never
  // disappear merely because an athlete has refreshed through every item.
  const freshCurated = rankedCurated(rankingMemory, args.refreshCursor, used);
  const fallbackCurated = rankedCurated(rankingMemory, args.refreshCursor, new Set(liveVideos.map((video) => video.id)));
  // Relevance wins over novelty. Within the exact study cluster we prefer
  // unseen results, then rotate known good studies before unrelated material.
  const freshIds = new Set(freshCurated.map((video) => video.id));
  const fallbackOnly = fallbackCurated.filter((video) => !freshIds.has(video.id));
  const isPriority = (video: { domainBoost: number }) => video.domainBoost > 0;
  const curatedCandidates = [
    ...freshCurated.filter(isPriority),
    ...fallbackOnly.filter(isPriority),
    ...freshCurated.filter((video) => !isPriority(video)),
    ...fallbackOnly.filter((video) => !isPriority(video)),
  ];
  const curated = curatedCandidates.slice(0, curatedLimit).map((video, index) => {
    const rest = {
      id: video.id,
      title: video.title,
      creator: video.creator,
      discipline: video.discipline,
      duration: video.duration,
      description: video.description,
    };
    const { topics } = video;
    return { ...rest, thumbnail: thumbnail(video.id), url: videoUrl(video.id), source: "curated" as const, ...whyAndWatchFor({ topics }, rankingMemory, index) };
  });
  // Keep one vetted, exactly-ranked anchor first; fresh YouTube studies then
  // broaden the same topic instead of replacing the feed with search noise.
  const videos = liveVideos.length
    ? [curated[0], ...liveVideos.slice(0, 5), ...curated.slice(1)].filter((video): video is LearnVideo => Boolean(video)).slice(0, 12)
    : curated.slice(0, 12);
  if (refresh) await rememberVideoRefresh(args.db, args.ownerId, videos, family);
  // Only call a refresh "live" when fresh videos were actually returned. A
  // configured-but-unavailable upstream service must fall back honestly to the
  // curated rotation instead of making the UI imply a successful search.
  const liveDiscoveryAvailable = liveVideos.length > 0 && !liveSearch.upstreamUnavailable;
  return { videos, studyTopic, exploreUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(studyTopic)}`, liveDiscoveryAvailable, refreshed: refresh };
}
