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
  const latest = memory.recentTraining.slice(0, 3).map((entry) => `${entry.discipline} ${entry.note} ${entry.takeaway ?? ""}`).join(" ");
  const focus = [memory.currentFocus, memory.focusReason, ...memory.instructorDetails, ...memory.oneTimeObservations].join(" ");
  return { latest: latest.toLowerCase(), focus: focus.toLowerCase(), latestTokens: tokens(latest), focusTokens: tokens(focus) };
}

function disciplineFromContext(value: string) {
  const lower = value.toLowerCase();
  if (/muay thai|round kick|teep|support foot|hip rotation/.test(lower)) return "Muay Thai / MMA";
  if (/boxing|jab|cross|hook|footwork/.test(lower)) return "Boxing / MMA";
  if (/wrestl|single leg|double leg|takedown|penetration/.test(lower)) return "Wrestling / MMA";
  if (/bjj|jiu-jitsu|jiujitsu|guard|arm drag|back take|mount/.test(lower)) return "BJJ / MMA";
  return "MMA";
}

function queryFor(memory: MemorySnapshot, refreshCursor: number, topicOverride?: string) {
  const requestedTopic = topicOverride?.replace(/\s+/g, " ").trim().slice(0, 140) ?? "";
  if (requestedTopic) return requestedTopic;
  const raw = `${memory.recentTraining[0]?.note ?? ""} ${memory.currentFocus} ${memory.instructorDetails[0] ?? ""}`.toLowerCase();
  const rotations = /kick|hip|pivot|bag|roundhouse/.test(raw)
    ? ["Muay Thai round kick support foot pivot", "Muay Thai hip rotation round kick balance", "Muay Thai round kick mechanics drill"]
    : /arm drag/.test(raw)
      ? ["BJJ arm drag take back control", "BJJ arm drag opponent squares back", "MMA arm drag back take drill"]
      : /guard|pass/.test(raw)
        ? ["BJJ guard retention frames hip movement", "BJJ guard retention drill under pressure", "MMA guard retention technique"]
        : /wrestl|single leg|double leg|takedown/.test(raw)
          ? ["wrestling takedown finish in live rounds", "wrestling penetration step timing drill", "MMA wrestling chain takedown"]
          : /box|jab|cross|hook|footwork/.test(raw)
            ? ["boxing footwork exit drill technique", "boxing balance after combination", "boxing defensive footwork drill"]
            : [`MMA ${compact(memory.currentFocus, "fundamentals", 70)}`, `MMA ${compact(memory.focusReason, "technique drill", 70)}`, "MMA technique drilling in live rounds"];
  return rotations[Math.abs(refreshCursor) % rotations.length];
}

function topicFamily(memory: MemorySnapshot) {
  const raw = `${memory.recentTraining[0]?.note ?? ""} ${memory.currentFocus} ${memory.instructorDetails[0] ?? ""}`.toLowerCase();
  if (/kick|hip|pivot|bag|roundhouse/.test(raw)) return "muay-thai-kick";
  if (/arm drag/.test(raw)) return "arm-drag";
  if (/guard|pass/.test(raw)) return "guard-retention";
  if (/wrestl|single leg|double leg|takedown/.test(raw)) return "wrestling-takedown";
  if (/box|jab|cross|hook|footwork/.test(raw)) return "boxing-footwork";
  return "mma-foundations";
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

function whyAndWatchFor(video: Pick<CuratedVideo, "topics">, memory: MemorySnapshot, index: number) {
  const { latest, focus, latestTokens, focusTokens } = contextFor(memory);
  const recentMatches = video.topics.filter((topic) => topicScore(topic, latest, latestTokens) > 0);
  const focusMatches = video.topics.filter((topic) => topicScore(topic, focus, focusTokens) > 0);
  const first = recentMatches[0] ?? focusMatches[0] ?? video.topics[0] ?? "the first key detail";
  const why = recentMatches.length
    ? `Your newest training note points to ${recentMatches.slice(0, 2).join(" and ")}.`
    : focusMatches.length
      ? `It supports your current study focus through ${focusMatches.slice(0, 2).join(" and ")}.`
      : index === 0
        ? "It is the closest supporting study for the next layer of your MMA game."
        : "It builds a related skill without pulling you away from the work you logged.";
  return { why, watchFor: `Watch how the ${first} detail is set before the movement starts.` };
}

function rankedCurated(memory: MemorySnapshot, refreshCursor: number, excludeIds: Set<string>) {
  const { latest, focus, latestTokens, focusTokens } = contextFor(memory);
  const family = topicFamily(memory);
  const ranked = curatedCatalog
    .filter((video) => !excludeIds.has(video.id))
    .map((video) => ({
      ...video,
      domainBoost: familyBoost(family, video.topics),
      score: familyBoost(family, video.topics) + video.topics.reduce((score, topic) => score + topicScore(topic, latest, latestTokens) * 4 + topicScore(topic, focus, focusTokens) * 2, 0) + (video.discipline.includes("MMA") ? 1 : 0),
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

async function youtubeJson(url: URL, timeoutMs = 6500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json() as Record<string, unknown>;
  } catch { return null; } finally { clearTimeout(timeout); }
}

async function searchYouTube(apiKey: string, memory: MemorySnapshot, refreshCursor: number, excludeIds: Set<string>, topicOverride?: string): Promise<LearnVideo[]> {
  const query = queryFor(memory, refreshCursor, topicOverride);
  const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  searchUrl.search = new URLSearchParams({ part: "snippet", type: "video", maxResults: "18", q: query, order: refreshCursor % 2 ? "date" : "relevance", videoEmbeddable: "true", videoSyndicated: "true", safeSearch: "strict", relevanceLanguage: "en", key: apiKey }).toString();
  const search = await youtubeJson(searchUrl);
  const items = Array.isArray(search?.items) ? search.items as YouTubeSearchItem[] : [];
  const candidates = items.map((item) => ({ id: item.id?.videoId, snippet: item.snippet })).filter((item): item is { id: string; snippet: NonNullable<YouTubeSearchItem["snippet"]> } => isVideoId(item.id) && !excludeIds.has(item.id) && typeof item.snippet?.title === "string" && typeof item.snippet?.channelTitle === "string").slice(0, 12);
  if (!candidates.length) return [];

  const detailUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  detailUrl.search = new URLSearchParams({ part: "contentDetails,status", id: candidates.map((item) => item.id).join(","), key: apiKey }).toString();
  const details = await youtubeJson(detailUrl);
  const allowed = new Map((Array.isArray(details?.items) ? details.items as YouTubeVideoItem[] : []).filter((item) => isVideoId(item.id) && item.status?.embeddable === true && item.status?.privacyStatus === "public").map((item) => [item.id as string, isoDuration(item.contentDetails?.duration)]));
  const discipline = disciplineFromContext(`${memory.currentFocus} ${memory.recentTraining[0]?.note ?? ""}`);
  const topicWords = query.toLowerCase().split(/\s+/).filter((word) => word.length > 2);
  return candidates.filter((item) => allowed.has(item.id)).slice(0, 8).map((item, index) => {
    const title = String(item.snippet.title).replace(/\s+/g, " ").trim().slice(0, 150);
    const creator = String(item.snippet.channelTitle).replace(/\s+/g, " ").trim().slice(0, 90);
    const detail = typeof item.snippet.description === "string" ? compact(item.snippet.description, `A study selected for ${query}.`, 180) : `A study selected for ${query}.`;
    const firstTopic = topicWords[index % topicWords.length] ?? "first technical";
    return { id: item.id, title, creator, discipline, duration: allowed.get(item.id) ?? "YouTube", description: detail, thumbnail: thumbnail(item.id), url: videoUrl(item.id), source: "youtube" as const, why: `Fresh YouTube result for ${compact(query, "your latest training", 72)}.`, watchFor: `Watch how the ${firstTopic} detail is set up, then compare it to your last session.` };
  });
}

export async function getRecentVideoIds(db: D1, ownerId: string, family: string) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await db.prepare("SELECT video_id FROM video_recommendation_history WHERE owner_id = ? AND study_topic = ? AND served_at >= ? ORDER BY served_at DESC LIMIT 80").bind(ownerId, family, since).all<{ video_id: string }>();
  return new Set((rows.results ?? []).map((row) => row.video_id));
}

export async function rememberVideoRefresh(db: D1, ownerId: string, videos: LearnVideo[], studyTopic: string) {
  if (!videos.length) return;
  const now = new Date().toISOString();
  await db.batch(videos.map((video) => db.prepare(`INSERT INTO video_recommendation_history (owner_id, video_id, study_topic, served_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(owner_id, video_id) DO UPDATE SET study_topic = excluded.study_topic, served_at = excluded.served_at`)
    .bind(ownerId, video.id, studyTopic.slice(0, 180), now)));
}

export async function buildLearnFeed(args: { db: D1; ownerId: string; memory: MemorySnapshot; youtubeApiKey?: string; refreshCursor: number; topicOverride?: string }) : Promise<LearnFeed> {
  const refresh = args.refreshCursor > 0;
  const studyTopic = queryFor(args.memory, args.refreshCursor, args.topicOverride);
  const rankingMemory = args.topicOverride?.trim()
    ? { ...args.memory, currentFocus: studyTopic, focusReason: "A specific technique from your Coach conversation.", recentTraining: [] }
    : args.memory;
  const family = topicFamily(rankingMemory);
  const recentIds = refresh ? await getRecentVideoIds(args.db, args.ownerId, family) : new Set<string>();
  const liveVideos = refresh && args.youtubeApiKey?.trim() ? await searchYouTube(args.youtubeApiKey, args.memory, args.refreshCursor, recentIds, args.topicOverride) : [];
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
  const videos = [...liveVideos, ...curated].slice(0, 12);
  if (refresh) await rememberVideoRefresh(args.db, args.ownerId, videos, family);
  return { videos, studyTopic, exploreUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(studyTopic)}`, liveDiscoveryAvailable: Boolean(args.youtubeApiKey?.trim()), refreshed: refresh };
}
