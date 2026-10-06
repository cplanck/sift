/* Cache only public static assets. Authenticated pages and APIs are never cached. */
const CACHE = "sift-static-v4";
// Icons use their full versioned request URL in the asset cache below.
const SHELL = ["/offline.html", "/offline.js", "/offline.css"];
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
  if (SHELL.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(async (cache) => (await cache.match(url.pathname)) ?? fetch(event.request)));
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
