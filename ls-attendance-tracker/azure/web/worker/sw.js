// Keeps the worker page and map library available offline; punches themselves queue in IndexedDB.
const C = 'ls-worker-v1', PRE = ['./', 'manifest.webmanifest', 'icon.svg', 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js', 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css'];
self.addEventListener('install', e => e.waitUntil(caches.open(C).then(c => c.addAll(PRE)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api/') || u.pathname.startsWith('/.auth/')) return;
  if (e.request.mode === 'navigate') { e.respondWith(fetch(e.request).then(r => { caches.open(C).then(c => c.put('./', r.clone())); return r; }).catch(() => caches.match('./'))); return; }
  if (PRE.some(p => e.request.url.endsWith(p.replace('./', '')))) e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
