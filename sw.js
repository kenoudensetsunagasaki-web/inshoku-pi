// 飲食.Pi — service worker for offline / low-bandwidth support.
// Strategy: cache-first for the app shell (HTML/CSS/JS — these rarely
// change and are what let the app *open* at all with no connection),
// network-first-with-cache-fallback for API calls (so a stale list of
// restaurants beats a blank screen when offline, but fresh data is used
// whenever the network is actually available).
const CACHE_VERSION = "inshoku-pi-v2";
const APP_SHELL = [
  "/",
  "/index.html",
  "/register.html",
  "/submit.html",
  "/mystore.html",
  "/assets/style.css",
  "/assets/i18n.js",
  "/assets/currencies.js",
  "/assets/app.js",
  "/assets/register.js",
  "/assets/submit.js",
  "/assets/mystore.js",
  "/assets/sw-register.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // reviews/payments/etc. always go to the network

  const url = new URL(req.url);

  // API calls: try the network first (data should be fresh), fall back to
  // whatever we last cached for that exact request when offline.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // App shell / static assets: cache-first, refresh the cache in the
  // background when the network is available (stale-while-revalidate).
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const networkFetch = fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
            return res;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    );
  }
});
