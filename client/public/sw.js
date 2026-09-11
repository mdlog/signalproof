/*
 * Minimal service worker: an offline app shell, and nothing more.
 *
 * Deliberately network-first with no caching of API responses. This app's entire value is that the
 * numbers on screen are what the chains currently say — serving a cached measurement, coverage
 * total, or reward balance would be exactly the kind of quiet lie the product exists to avoid.
 *
 * So: cache the shell so the app opens on a bad connection, and let every /api/ request fail
 * honestly rather than answering from stale data.
 */
const SHELL = "signalproof-shell-v1";
const SHELL_ASSETS = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  // Never cache live data or the measurement probes — a stale probe would corrupt a measurement.
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(SHELL).then((c) => c.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((hit) => hit ?? caches.match("/"))),
  );
});
