// very small offline shell (do not cache the API)
const CACHE = 'fortuny-v1';
const ASSETS = ['/', '/index.html', '/style.css', '/main.js', '/manifest.webmanifest'];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>k!==CACHE && caches.delete(k)))));
});
self.addEventListener('fetch', e=>{
  const { request } = e;
  if (request.url.includes('/api/fortune')) return; // never cache API
  e.respondWith(caches.match(request).then(r=> r || fetch(request)));
});
