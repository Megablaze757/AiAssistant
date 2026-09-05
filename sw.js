/**
 * Service worker.
 *
 * The repository shipped a web manifest with no service worker behind it, so
 * the app advertised itself as installable and then needed the network to open.
 * On a phone — the device this is actually used on — that meant the home-screen
 * icon opened a blank page on a bad train connection.
 *
 * CACHE-FIRST FOR THE SHELL, NETWORK-FIRST FOR DATA. The shell is a handful of
 * static files that only change when the app is deployed, so serving them from
 * the cache is both faster and what makes offline work. Everything else — the
 * Apps Script backend, the PocketAthlete Worker — is live data, and a cached
 * copy of your training programme or your inbox is worse than an honest
 * failure, so those are never cached.
 */

const VERSION = 'jarvis-v1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './enhancements.css',
  './app.js',
  './src/api.js',
  './src/planner.js',
  './src/pocketathlete.js',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  // addAll is atomic: one missing file would leave a half-populated cache that
  // serves some pages and 404s others, so failures are swallowed per-file.
  event.waitUntil(caches.open(VERSION)
    .then((cache) => Promise.all(SHELL.map((path) => cache.add(path).catch(() => null))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Same-origin only. The backend and the PocketAthlete Worker are data, and a
  // stale answer from either would be read as current.
  if (url.origin !== self.location.origin) return;

  event.respondWith(caches.match(request).then((cached) => {
    // Served from cache, then refreshed in the background, so a deploy is
    // picked up on the next open rather than requiring a hard reload.
    const network = fetch(request).then((response) => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
      }
      return response;
    }).catch(() => cached);
    return cached || network;
  }));
});
