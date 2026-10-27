// Offline support. The network is tried first, so a new deploy shows up on
// the next launch; the cache is only used when the phone is offline. Bump
// CACHE when the list of files changes.
const CACHE = 'scanify-v3';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/db.js',
  'js/imaging.js',
  'js/pdf.js',
  'js/version.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser's HTTP cache, which GitHub Pages lets
  // hold files for 10 minutes, so the shell is never filled with stale files.
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  e.respondWith(
    // 'no-cache' revalidates with the server instead of trusting the HTTP
    // cache. Fetch by URL: a navigation Request can't be re-issued with options.
    fetch(request.url, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() =>
        caches
          .match(request, { ignoreSearch: true })
          .then((cached) => cached || (request.mode === 'navigate' ? caches.match('index.html') : Response.error()))
      )
  );
});
