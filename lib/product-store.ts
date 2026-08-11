// One copy of the athlete's app state, shared by every screen.
//
// Measured on the live site: a cold load fired /api/product twice before the
// athlete touched anything, at 613ms and 1947ms into the load, taking 1321ms and
// 1129ms. Every screen change after that fired another. Five components each
// fetched the whole twelve section payload on mount, and screens unmount when
// you navigate away, so going Home, Learn, Coach, My Game and back cost five
// full round trips for data that had not changed.
//
// The payload is not the problem. 15KB of JSON is 4.8KB on the wire, and the
// second-plus latency is server time rather than transfer. So this dedupes and
// caches rather than splitting the endpoint: with one shared copy, a screen
// change costs nothing at all, which no amount of splitting could beat.
//
// Two rules matter more than the mechanism, and both come from what a gym is
// actually like:
//
//   1. Nothing may ever be staler than what the athlete just did. A mutation
//      writes through to every screen immediately, never "after revalidation".
//   2. A failed refetch must never blank a screen that already had good data.
//      The failure mode on gym wifi is not a clean error, it is a request that
//      hangs, so there is a timeout and the last good data survives it.

export type StoreState<T> = {
  data: T | null;
  /** Set when the most recent attempt failed. Never clears `data`. */
  error: string;
  /** True only while a request the screen is waiting on is in flight. */
  loading: boolean;
  /** When `data` last arrived. 0 means never. */
  fetchedAt: number;
};

export type ProductStore<T> = {
  subscribe: (listener: () => void) => () => void;
  getState: () => StoreState<T>;
  /**
   * Fetch, unless a good enough copy is already here.
   *
   * Concurrent callers for the same url share one request rather than racing,
   * which is what turned an arrival into two identical round trips.
   */
  load: (options?: { url?: string; force?: boolean }) => Promise<boolean>;
  /** Write through after a mutation, so every screen sees it on the next paint. */
  set: (data: T) => void;
  /** Drop everything. Used on sign out, so the next athlete never sees a trace. */
  clear: () => void;
};

export type StoreOptions = {
  url?: string;
  /** How long a copy is worth reusing without asking again. */
  staleMs?: number;
  /** A hung request has to end, or the screen spins forever behind it. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

const DEFAULT_URL = "/api/product";
// Long enough that a lap around the app costs nothing, short enough that a
// change made in another tab or on a phone shows up without a reload.
const DEFAULT_STALE_MS = 30_000;
// Longer than the slowest real response measured (1321ms) by a wide margin, so
// this only ever fires on a request that is genuinely not coming back.
const DEFAULT_TIMEOUT_MS = 12_000;

const FAILURE_MESSAGE = "FightIQ couldn’t load your game.";

export function createProductStore<T>(options: StoreOptions = {}): ProductStore<T> {
  const url = options.url ?? DEFAULT_URL;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? (() => Date.now());
  const doFetch: typeof fetch = options.fetchImpl ?? ((...args) => fetch(...args));

  let state: StoreState<T> = { data: null, error: "", loading: false, fetchedAt: 0 };
  const listeners = new Set<() => void>();
  // Keyed by url: the Learn screen asks for a different topic, and that is a
  // genuinely different request rather than the same one twice.
  const inFlight = new Map<string, Promise<boolean>>();

  function emit(next: Partial<StoreState<T>>) {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  }

  async function run(target: string): Promise<boolean> {
    // Only show a spinner to somebody who has nothing to look at. With data on
    // screen a refresh happens quietly underneath it.
    if (!state.data) emit({ loading: true });
    const controller = typeof AbortController === "undefined" ? null : new AbortController();
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await doFetch(target, controller ? { signal: controller.signal } : undefined);
      const payload = await response.json() as T & { error?: { message?: string } };
      if (!response.ok) throw new Error(payload?.error?.message ?? FAILURE_MESSAGE);
      emit({ data: payload as T, error: "", loading: false, fetchedAt: now() });
      return true;
    } catch (caught) {
      // The last good data stays exactly where it is. A fighter halfway through
      // reading their brief on gym wifi does not lose the screen because a
      // background refresh timed out.
      emit({ error: caught instanceof Error ? caught.message : FAILURE_MESSAGE, loading: false });
      return false;
    } finally {
      if (timer) clearTimeout(timer);
      inFlight.delete(target);
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getState: () => state,
    load(loadOptions = {}) {
      const target = loadOptions.url ?? url;
      const existing = inFlight.get(target);
      if (existing) return existing;
      const fresh = target === url && state.data !== null && now() - state.fetchedAt < staleMs;
      if (fresh && !loadOptions.force) return Promise.resolve(true);
      const request = run(target);
      inFlight.set(target, request);
      return request;
    },
    set(data) {
      emit({ data, error: "", loading: false, fetchedAt: now() });
    },
    clear() {
      inFlight.clear();
      emit({ data: null, error: "", loading: false, fetchedAt: 0 });
    },
  };
}
