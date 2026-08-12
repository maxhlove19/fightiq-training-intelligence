// Why this exists: an athlete taps the icon in a gym basement with no signal.
//
// Without a service worker that is the browser's "you are not connected" page,
// and the one thing this app exists for cannot happen. The note was never the
// fragile part; it has been written to the device as it is typed for a long
// time. Reaching the screen to write it was the fragile part.
//
// Deliberately conservative. Nothing personal is ever cached: no /api response,
// no page HTML. Only the shell, which is the same bytes for everybody, plus a
// static page to land on when the network is gone.
//
// That static page is now where a note gets written, not just where the athlete
// is told bad news. It is plain HTML with no build output behind it precisely
// so that this cache entry is the only thing standing between a basement and a
// saved session. Caching the real log screen instead would mean caching a
// server rendered page belonging to one athlete, on a phone people share, which
// is the trade this file has always refused to make.
//
// Bump the version whenever offline.html changes. The byte change in this file
// is what tells a phone to install the new one.
const SHELL = "fightiq-shell-v2";
// Everything the app needs to boot, cached as it is fetched rather than listed
// up front, because the build hashes these names and a hand written list would
// go stale on the next deploy.
const CACHEABLE = /\/_next\/static\/|\/fighter-posters\/|\.(?:css|js|woff2?|png|svg|jpg|jpeg|webp)$/;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.add("/offline.html")).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Signing out must not leave the previous session's shell on a shared phone.
self.addEventListener("message", (event) => {
  if (event.data === "fightiq-clear-cache") event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // A personal answer must never come from a cache. Better a visible failure
  // the app already handles than yesterday's training shown as today's.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline.html").then((cached) => cached ?? Response.error())),
    );
    return;
  }

  if (!CACHEABLE.test(url.pathname)) return;
  event.respondWith(
    caches.match(request).then((cached) => {
      // Build assets are content hashed, so a hit is always correct and there is
      // no reason to go to the network for one.
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.status === 200) {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      });
    }),
  );
});
