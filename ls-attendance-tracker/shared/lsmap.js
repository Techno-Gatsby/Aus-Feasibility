/* =====================================================================
   Maps for both pages: Leaflet with OpenStreetMap (Map) and Esri World
   Imagery (Satellite + place labels), location search with type-ahead
   (Photon, Nominatim on Enter, ArcGIS when a key is set), zone circles.
   ===================================================================== */
const LSMap = (() => {
  const V = '1.9.4', CDN = `https://cdn.jsdelivr.net/npm/leaflet@${V}/dist/`;
  let loading = null;
  function load() {
    if (window.L?.map) return Promise.resolve(window.L);
    return loading ||= new Promise((res, rej) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = CDN + 'leaflet.css'; document.head.appendChild(css);
      const s = document.createElement('script'); s.src = CDN + 'leaflet.js'; s.onload = () => res(window.L); s.onerror = () => { loading = null; rej(new Error('Map could not load – internet connection needed')); }; document.head.appendChild(s);
    });
  }
  const UAE = [25.2, 55.3];
  /** A map with a Map / Satellite switch. opts: { center, zoom, satellite, zoomControl } */
  async function create(el, opts = {}) {
    const L = await load();
    const map = L.map(el, { zoomControl: opts.zoomControl !== false, attributionControl: true, ...(opts.animate === false ? { zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false } : {}) }).setView(opts.center || UAE, opts.zoom || 11);
    // Esri street basemap: same provider as the satellite view, works from a local file (OSM's public tiles refuse pages with no referrer)
    const osm = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: '© Esri, HERE, Garmin, OpenStreetMap contributors' });
    const sat = L.layerGroup([
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }),
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 })
    ]);
    (opts.satellite ? sat : osm).addTo(map);
    L.control.layers({ Map: osm, Satellite: sat }, null, { position: 'topright', collapsed: false }).addTo(map);
    setTimeout(() => { try { if (el.isConnected) map.invalidateSize(); } catch (e) { } }, 60);   // map may be gone by then
    return map;
  }
  /** Circle + pin for a zone */
  function zone(map, pin, o = {}) {
    const L = window.L;
    const c = L.circle([pin.lat, pin.lng], { radius: +pin.radius || 100, color: o.color || '#1766CB', weight: 2, fillOpacity: o.fill ?? .12 }).addTo(map);
    const m = o.marker === false ? null : L.circleMarker([pin.lat, pin.lng], { radius: 4, color: o.color || '#1766CB', fillOpacity: 1 }).addTo(map);
    if (o.label) (m || c).bindTooltip(o.label, { permanent: !!o.permanent, direction: 'top' });
    return { c, m, remove() { c.remove(); m?.remove(); } };
  }
  /** "25.1, 55.2", "25.1 N 55.2 E", Google Maps links (@lat,lng · q=lat,lng · !3dlat!4dlng) → {lat,lng} */
  function parseCoords(t) {
    const s = String(t || '').trim(); let m;
    if ((m = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/))) return ok(m[1], m[2]);
    if ((m = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/))) return ok(m[1], m[2]);
    if ((m = s.match(/[?&](?:q|query|ll|center)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/i))) return ok(m[1], m[2]);
    if ((m = s.match(/^(-?\d{1,2}\.\d+)\s*°?\s*([NS])?[,\s]+(-?\d{1,3}\.\d+)\s*°?\s*([EW])?$/i))) return ok((m[2] || '').toUpperCase() === 'S' ? -m[1] : m[1], (m[4] || '').toUpperCase() === 'W' ? -m[3] : m[3]);
    return null;
    function ok(a, b) { a = +a; b = +b; return Math.abs(a) <= 90 && Math.abs(b) <= 180 ? { lat: a, lng: b } : null; }
  }
  /* ---------- search ---------- */
  const BOX = '51.5,22.6,56.5,26.2';                  // UAE
  async function suggest(q, key) {
    if (key) {
      const r = await fetch(`https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/suggest?f=json&countryCode=ARE&maxSuggestions=6&text=${encodeURIComponent(q)}&token=${encodeURIComponent(key)}`).then(r => r.json());
      return (r.suggestions || []).map(x => ({ label: x.text, magicKey: x.magicKey }));
    }
    const r = await fetch(`https://photon.komoot.io/api/?limit=6&lang=en&lat=25.2&lon=55.3&bbox=${BOX}&q=${encodeURIComponent(q)}`).then(r => r.json());
    return (r.features || []).map(f => { const p = f.properties || {}; return { label: [p.name, p.street, p.district || p.locality, p.city || p.county, p.state].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', '), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] }; });
  }
  async function resolve(x, key) {
    if (x.lat != null) return x;
    const r = await fetch(`https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&maxLocations=1&magicKey=${encodeURIComponent(x.magicKey)}&SingleLine=${encodeURIComponent(x.label)}&token=${encodeURIComponent(key)}`).then(r => r.json());
    const c = r.candidates?.[0]; return c ? { label: x.label, lat: c.location.y, lng: c.location.x } : null;
  }
  async function nominatim(q) {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=6&countrycodes=ae&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'en' } }).then(r => r.json());
    return r.map(x => ({ label: x.display_name, lat: +x.lat, lng: +x.lon }));
  }
  /** Attach type-ahead to an input. onPick({label, lat, lng}) */
  function search(input, onPick, { key = '' } = {}) {
    const box = document.createElement('div'); box.className = 'lsm-sug'; box.hidden = true;
    input.parentElement.style.position ||= 'relative'; input.after(box); input.setAttribute('autocomplete', 'off');
    let items = [], hi = -1, t = null, seq = 0;
    const show = list => {
      items = list; hi = -1;
      box.innerHTML = list.length ? list.map((x, i) => `<button type="button" data-i="${i}">${x.label.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))}</button>`).join('') : '<div class="none">No places found – try another name, or paste coordinates</div>';
      box.hidden = false;
      box.querySelectorAll('[data-i]').forEach(b => b.onmousedown = e => { e.preventDefault(); pick(items[+b.dataset.i]); });
    };
    const pick = async x => { box.hidden = true; const r = await resolve(x, key).catch(() => null); if (r) { input.value = r.label; onPick(r); } };
    input.addEventListener('input', () => {
      clearTimeout(t); const q = input.value.trim();
      const c = parseCoords(q); if (c) { box.hidden = true; return; }
      if (q.length < 3) { box.hidden = true; return; }
      t = setTimeout(async () => { const my = ++seq; box.hidden = false; box.innerHTML = '<div class="none">Searching…</div>'; try { const r = await suggest(q, key); if (my === seq) show(r); } catch (e) { if (my === seq) box.innerHTML = '<div class="none">Search unavailable – paste coordinates instead</div>'; } }, 350);
    });
    input.addEventListener('keydown', async e => {
      const bs = box.querySelectorAll('[data-i]');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!bs.length) return; hi = (hi + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length; bs.forEach((b, i) => b.classList.toggle('on', i === hi)); return; }
      if (e.key === 'Escape') { box.hidden = true; return; }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const c = parseCoords(input.value); if (c) { box.hidden = true; onPick({ label: `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`, ...c }); return; }
      if (hi >= 0 && items[hi]) return pick(items[hi]);
      try { const r = await nominatim(input.value.trim()); r.length === 1 ? pick(r[0]) : show(r); } catch (err) { show([]); }
    });
    input.addEventListener('blur', () => setTimeout(() => box.hidden = true, 150));
    return { close: () => box.hidden = true };
  }
  const CSS = `.lsm-sug{position:absolute;left:0;right:0;top:100%;z-index:1200;background:#fff;border:1px solid #C9D2E1;border-radius:5px;box-shadow:0 4px 14px rgba(15,30,61,.12);max-height:260px;overflow:auto;margin-top:2px}
.lsm-sug button{display:block;width:100%;text-align:left;border:0;background:none;padding:7px 10px;font:inherit;font-size:12.5px;cursor:pointer;color:#16202F;border-bottom:1px solid #EEF1F6}
.lsm-sug button:hover,.lsm-sug button.on{background:#EAF2FD}.lsm-sug .none{padding:8px 10px;color:#6B7A94;font-size:12px}
.leaflet-control-layers{font:12px Inter,Segoe UI,sans-serif;border-radius:5px!important}.leaflet-container{font-family:Inter,Segoe UI,sans-serif}`;
  if (typeof document !== 'undefined') { const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); }
  return { load, create, zone, parseCoords, search };
})();
