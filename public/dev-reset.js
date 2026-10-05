/* Development only: recover installations created before PWA registration was
   restricted to production. Runs before hydration, including when stale chunks
   prevent React from mounting. Never clears cookies or cookbook data. */
(async () => {
  if (!("serviceWorker" in navigator)) return;
  const isSift = (worker) => worker && new URL(worker.scriptURL).pathname === "/sw.js";
  const wasControlled = isSift(navigator.serviceWorker.controller);
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.filter((registration) =>
    isSift(registration.active) || isSift(registration.waiting) || isSift(registration.installing)
  ).map((registration) => registration.unregister()));
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("sift-static-")).map((key) => caches.delete(key)));
  }
  if (wasControlled) location.reload();
})().catch(() => { /* A restricted browser can still use the online app. */ });
