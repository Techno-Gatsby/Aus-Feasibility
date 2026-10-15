// Opens the worker page instantly from the phone's cache and refreshes that copy in the background
// (the next open gets the new version). Map library and fonts are cached too; punches queue in IndexedDB.
const C = 'ls-worker-v3', PRE = ['./', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js', 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css'];
self.addEventListener('install', e => e.waitUntil(caches.open(C).then(c => c.addAll(PRE)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim())));
const put = (key, r) => { if (r && (r.ok || r.type === 'opaque')) { const copy = r.clone(); caches.open(C).then(c => c.put(key, copy)); } return r; };
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.endsWith('.apk') || u.pathname.startsWith('/api/') || u.pathname.startsWith('/.auth/')) return;
  // the page: cached copy now, fresh copy saved for next time
  if (e.request.mode === 'navigate') {
    const net = fetch(e.request).then(r => put('./', r));
    e.respondWith(caches.match('./').then(hit => hit || net).catch(() => net));
    e.waitUntil(net.catch(() => { }));
    return;
  }
  // map library, manifest, icon and fonts: cache first
  if (PRE.some(p => e.request.url.endsWith(p.replace('./', ''))) || /^fonts\.(googleapis|gstatic)\.com$/.test(u.hostname))
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => put(e.request, r))));
});
