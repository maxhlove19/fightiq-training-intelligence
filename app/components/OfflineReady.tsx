"use client";

import { useEffect } from "react";

/**
 * Registers the service worker that lets FightIQ open in a gym basement.
 *
 * Deliberately silent. It never blocks a render, never asks permission, and a
 * failure here costs the athlete nothing they would notice: the app works
 * exactly as it did before, it just needs a network to start.
 *
 * Registration waits for load so it never competes with the first paint, which
 * on a phone on gym wifi is the thing that actually matters.
 */
export function OfflineReady() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const register = () => { void navigator.serviceWorker.register("/sw.js").catch(() => undefined); };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);
  return null;
}

/**
 * Empties the shell cache when somebody signs out.
 *
 * Two people share a phone more often than product people assume, and a cached
 * shell outliving a session is the kind of thing nobody notices until it
 * matters. Cheap insurance, and it costs one message.
 */
export function clearOfflineCache() {
  try { navigator.serviceWorker?.controller?.postMessage("fightiq-clear-cache"); } catch { /* nothing worth failing a sign out over */ }
}
