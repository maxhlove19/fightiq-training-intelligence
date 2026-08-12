// The half of "works in a basement" that was still missing.
//
// The service worker already gets the athlete to a screen with no signal, and
// lib/training-draft.ts already keeps the note they are typing on the device.
// What neither of them did was send it afterwards. The save path told the
// athlete "FightIQ will send it the moment you are back online" and then
// nothing did, because there was nowhere to put a finished note that the
// server had not taken yet.
//
// This is that place. A note moves out of the draft slot and into this queue
// the moment the athlete presses save and the network is not there, which frees
// the draft slot for the next note. Two sessions in one signal free evening was
// previously one session, because the second draft overwrote the first.
//
// Every note keeps the client key it was written under. The server has deduped
// on that key since the note API was written, so a flush that runs twice, or a
// reply that goes missing on gym wifi, cannot become two training sessions.

export type QueuedNote = {
  /** The same id lib/training-draft.ts generated while it was being typed. */
  clientKey: string;
  text: string;
  discipline: string;
  sessionType: string;
  queuedAt: string;
  experimentId?: string;
};

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const QUEUE_KEY = "fightiq-outbox-v1";

// A phone that has been offline for a fortnight should not be able to fill its
// own storage and start throwing while somebody is mid note. Oldest goes first,
// because the newest note is the one the athlete still remembers writing.
export const QUEUE_LIMIT = 50;

function isNote(value: unknown): value is QueuedNote {
  if (!value || typeof value !== "object") return false;
  const note = value as Partial<QueuedNote>;
  return typeof note.clientKey === "string" && Boolean(note.clientKey)
    && typeof note.text === "string" && Boolean(note.text.trim())
    && typeof note.discipline === "string" && Boolean(note.discipline)
    && typeof note.sessionType === "string" && Boolean(note.sessionType);
}

/**
 * Never throws and never returns a broken note.
 *
 * Storage can be full, disabled or wiped by the browser, and the one thing that
 * must not happen is an exception on the path that opens the log screen.
 */
export function readQueue(storage: StorageLike | null | undefined): QueuedNote[] {
  if (!storage) return [];
  let raw: string | null = null;
  try { raw = storage.getItem(QUEUE_KEY); } catch { return []; }
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isNote).map((note) => ({
    clientKey: note.clientKey,
    text: note.text,
    discipline: note.discipline,
    sessionType: note.sessionType,
    queuedAt: typeof note.queuedAt === "string" && note.queuedAt ? note.queuedAt : new Date(0).toISOString(),
    ...(typeof note.experimentId === "string" && note.experimentId ? { experimentId: note.experimentId } : {}),
  }));
}

function writeQueue(storage: StorageLike | null | undefined, notes: QueuedNote[]) {
  if (!storage) return;
  try {
    if (notes.length === 0) { storage.removeItem(QUEUE_KEY); return; }
    storage.setItem(QUEUE_KEY, JSON.stringify(notes.slice(-QUEUE_LIMIT)));
  } catch { /* losing the queue is bad, throwing while an athlete saves is worse */ }
}

/**
 * Adds a note, or replaces the one already queued under the same client key.
 *
 * Pressing save twice with no signal is the same note, not two, and it has to
 * stay that way on the device rather than being sorted out by the server later.
 */
export function enqueueNote(storage: StorageLike | null | undefined, note: QueuedNote): QueuedNote[] {
  if (!storage || !note.text.trim()) return readQueue(storage);
  const existing = readQueue(storage).filter((queued) => queued.clientKey !== note.clientKey);
  const next = [...existing, note].slice(-QUEUE_LIMIT);
  writeQueue(storage, next);
  return next;
}

export function removeQueued(storage: StorageLike | null | undefined, clientKey: string): QueuedNote[] {
  const next = readQueue(storage).filter((queued) => queued.clientKey !== clientKey);
  writeQueue(storage, next);
  return next;
}

/**
 * What happens to one note when the app tries to send it.
 *
 * "keep" is the important one. A note is only ever taken off this device when
 * the server has said it has it, so a flaky tunnel or an expired session leaves
 * the note exactly where it was.
 */
export type SendOutcome = "sent" | "keep" | "discard";

export function outcomeForStatus(status: number): SendOutcome {
  if (status >= 200 && status < 300) return "sent";
  // The note itself can never be accepted: wrong discipline, or a length the
  // API will not take. Retrying it every time the app opens would be a queue
  // that never empties and a spinner that never stops.
  if (status === 400 || status === 422) return "discard";
  // Everything else is worth another go, including 401, because the session
  // coming back is exactly the case this queue exists for.
  return "keep";
}

export type FlushResult = { sent: number; discarded: number; waiting: number };

export type FetchLike = (input: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>;

/**
 * Sends what is waiting, oldest first, and stops at the first note that could
 * not be delivered.
 *
 * Stopping matters. If the network is gone, the second note will fail for the
 * same reason as the first, and forty attempts is forty timeouts on a phone
 * that is already struggling. Order is kept for the same reason it exists at
 * all, so a training week reads in the order it was trained.
 */
export async function flushQueue(
  storage: StorageLike | null | undefined,
  fetchImpl: FetchLike,
): Promise<FlushResult> {
  let sent = 0;
  let discarded = 0;
  for (const note of readQueue(storage)) {
    let outcome: SendOutcome;
    try {
      const response = await fetchImpl("/api/training-entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          discipline: note.discipline,
          sessionType: note.sessionType,
          rawEntry: note.text.trim(),
          clientKey: note.clientKey,
          ...(note.experimentId ? { experimentId: note.experimentId } : {}),
        }),
      });
      outcome = outcomeForStatus(response.status);
    } catch {
      // No network, or the request never left the phone. Keep it and stop.
      outcome = "keep";
    }
    if (outcome === "keep") break;
    removeQueued(storage, note.clientKey);
    if (outcome === "sent") sent += 1; else discarded += 1;
  }
  return { sent, discarded, waiting: readQueue(storage).length };
}

/**
 * What the athlete is told while notes are still on the phone.
 *
 * It says saved, because it is saved, and it says waiting, because it has not
 * been sent. The old copy promised the app would send it and then had nothing
 * to do the sending, which is the one kind of message this app cannot afford.
 */
export function waitingMessage(count: number): string {
  if (count <= 0) return "";
  if (count === 1) return "1 session saved on this phone, waiting for signal.";
  return `${count} sessions saved on this phone, waiting for signal.`;
}
