/* Cache only public static assets. Authenticated pages and APIs are never cached. */
const CACHE = "sift-static-v2";
const SHELL = ["/offline.html", "/icons/icon-192.png", "/icons/icon-512.png"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL))));
self.addEventListener("activate", (event) => event.waitUntil(Promise.all([
  caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("sift-static-") && key !== CACHE).map((key) => caches.delete(key)))),
  self.clients.claim(),
])));
self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE") self.skipWaiting();
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/offline.html")));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      // Only content-addressed production chunks are immutable. Development
      // chunks reuse URLs and must never enter a cache-first service worker.
      const immutable = /\bimmutable\b/i.test(response.headers.get("Cache-Control") || "");
      if (response.ok && response.type === "basic" && (url.pathname.startsWith("/icons/") || immutable)) await cache.put(event.request, response.clone());
      return response;
    }));
  }
});
