// Bump VERSION for every deployed shell change. No forced takeover during timing.
const VERSION = 'v0.4.0';
const PREFIX = `multi-stopwatch:${self.registration.scope}:`;
const CACHE = PREFIX + VERSION;
const ASSETS = ['./', './index.html', './style.css', './src/app.js', './src/ui.js', './src/model.js', './src/storage.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(event.request, { ignoreSearch: true });
    if (hit) return hit;
    // Any in-scope page request falls back to the app shell so a bookmarked sub-path still opens offline.
    if (event.request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return fetch(event.request);
  })());
});
