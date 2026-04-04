/* ====================================================
   Reader — Service Worker
   Caches the app shell for fully offline use.
   Book text content is cached in IndexedDB by app.js.
   ==================================================== */

const CACHE = 'reader-v1';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './js/books.js',
  './js/app.js',
  './manifest.json',
  './icons/icon.svg',
];

// Install: cache the app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(SHELL))
  );
  self.skipWaiting();
});

// Activate: remove old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: cache-first for shell assets, network-first for Gutenberg
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always use cache for same-origin shell assets
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then(cached =>
        cached || fetch(event.request).then(resp => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE).then(cache => cache.put(event.request, clone));
          }
          return resp;
        }).catch(() => caches.match('./index.html'))
      )
    );
    return;
  }

  // For Gutenberg fetches: network with no cache (app.js uses IndexedDB)
  // Just let them pass through
});
