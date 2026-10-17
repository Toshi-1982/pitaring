// ぴたリング Service Worker（仕様書8.2）
// ★どのファイルを変えて公開するときも、ここの版番号を上げる（v2, v3 …）
const VERSION = 'v9';
const CACHE_NAME = `pitaring-${VERSION}`;
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'game.js',
  'logic.js',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // ブラウザのHTTPキャッシュに残った古いファイルを入れないよう cache:'reload' で取り直す
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('pitaring-') && key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// キャッシュ優先：キャッシュにあれば返し、無ければネットワーク
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
