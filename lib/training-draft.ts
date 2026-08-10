// An athlete writes their session note once, in a changing room, minutes after
// training, while the detail is still there. It is the one thing in this app
// that cannot be regenerated — and the place they write it is a gym basement
// with no signal.
//
// So the note is written to the device as it is typed, survives a failed save,
// a backgrounded tab, a dead battery and a reload, and is only cleared once the
// server has actually taken it.

export type TrainingDraft = {
  text: string;
  discipline: string;
  sessionType: string;
  savedAt: string;
};

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const DRAFT_KEY = "fightiq-training-draft-v1";

export function readDraft(storage: StorageLike | null | undefined): TrainingDraft | null {
  if (!storage) return null;
  let raw: string | null = null;
  try { raw = storage.getItem(DRAFT_KEY); } catch { return null; }
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  const draft = parsed as Partial<TrainingDraft>;
  const text = typeof draft.text === "string" ? draft.text : "";
  if (!text.trim()) return null;
  return {
    text,
    discipline: typeof draft.discipline === "string" && draft.discipline ? draft.discipline : "MMA",
    sessionType: typeof draft.sessionType === "string" && draft.sessionType ? draft.sessionType : "Class",
    savedAt: typeof draft.savedAt === "string" && draft.savedAt ? draft.savedAt : new Date(0).toISOString(),
  };
}

// Storage can be full, disabled, or blocked in private mode. Losing the backup
// is survivable; throwing while an athlete types is not.
export function writeDraft(storage: StorageLike | null | undefined, draft: TrainingDraft) {
  if (!storage) return;
  if (!draft.text.trim()) { clearDraft(storage); return; }
  try { storage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* nothing worth breaking typing over */ }
}

export function clearDraft(storage: StorageLike | null | undefined) {
  if (!storage) return;
  try { storage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}

/** How long ago the athlete wrote it, in the words they would use. */
export function draftAge(savedAt: string, now: Date = new Date()) {
  const written = new Date(savedAt).getTime();
  if (!Number.isFinite(written) || written <= 0) return "earlier";
  const minutes = Math.floor((now.getTime() - written) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}
