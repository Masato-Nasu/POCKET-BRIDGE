/* PocketBridge service worker */
const CACHE_NAME = "pocketbridge-v0.1.5";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // App shell
  if (url.origin === location.origin) {
    // Navigation（共有で ?url=... 等が付くと caches.match(req) が当たらないため、常に index.html を返す）
    if (req.mode === "navigate") {
      event.respondWith(
        caches.match("./index.html").then((cached) =>
          cached || fetch("./index.html").catch(() => cached)
        )
      );
      return;
    }

    // Asset: cache-first
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).catch(() => cached))
    );
    return;
  }

  // External content: network-first (do not cache)
  event.respondWith(
    fetch(req).catch(() => new Response("", { status: 503, statusText: "Offline" }))
  );
});