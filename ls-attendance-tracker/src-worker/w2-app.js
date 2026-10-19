/* =====================================================================
   Security Personnel Attendance – sign in (remembered Emp ID + PIN), check in / out
   with GPS and an on-site photo, offline queue, my month, supervisor
   board (marks days for workers who did not check in). Talks to the Azure API, or to the demo store.
   ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const ls = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { } } };
const ss = { get: k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) { } } };
const hhmm = ts => { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
/* inline icons (Lucide-style strokes) */
const ICON = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
  cal: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  in: '<path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5"/>',
  out: '<path d="M14 17l5-5-5-5"/><path d="M19 12H7"/><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', hour: '<path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4 4 0 0 1-.5 9.5z"/>', wifi: '<path d="M2 2l20 20"/><path d="M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.7M19 13a10 10 0 0 0-2.1-1.6M2 9.5a15 15 0 0 1 4.6-2.9M22 9.5A15 15 0 0 0 11 5.1"/><circle cx="12" cy="20" r=".6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>', logout: '<path d="M15 17l5-5-5-5M20 12H9"/><path d="M12 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7"/>',
  locate: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7.5"/>', expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', back: '<path d="M15 18l-6-6 6-6"/>', shift: '<path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/><circle cx="12" cy="12" r="4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>', arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>', inbox: '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1.5 2.5h5L16 13h5"/>'
};
const ic = (k, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[k] || ''}</svg>`;
const haptic = p => { try { navigator.vibrate?.(p); } catch (e) { } };
const tc = n => String(n || '').toLowerCase().replace(/(^|[\s'.-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
const initials = n => esc(String(n || '?').split(/\s+/).filter(Boolean).map(x => x[0]).slice(0, 2).join(''));
function applyTheme() { const th = ls.get('ls.theme') || 'auto'; if (th === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = th; document.querySelector('meta[name=theme-color]')?.setAttribute('content', isDark() ? '#050606' : '#ECE9E3'); }
function isDark() { const th = ls.get('ls.theme') || 'auto'; return th === 'dark' || (th === 'auto' && !matchMedia('(prefers-color-scheme: light)').matches); }
const cssv = k => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
function toast(m, ms = 2800) { const el = $('#toast'); el.textContent = m; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), ms); }

// API address: ?api=… (saved), else same-origin /api when served over http(s), else demo
const Q = new URLSearchParams(location.search);
if (Q.has('api')) ls.set('ls.api', Q.get('api'));
const API_BASE = ls.get('ls.api') ?? (location.protocol.startsWith('http') ? '/api' : '');
const W = { api: LSClient.make({ base: API_BASE }), token: ss.get('ls.tok'), prof: null, code: ls.get('ls.code') || '', pin: '', dev: ls.get('ls.dev') || (() => { const d = uuid(); ls.set('ls.dev', d); return d; })(), gps: null, gpsErr: '', watch: null, map: null, layers: null, busy: false, sup: false };

/* ---------- offline queue (IndexedDB) ---------- */
const QDB = () => new Promise((res, rej) => { const r = indexedDB.open('ls-worker-queue', 1); r.onupgradeneeded = () => r.result.createObjectStore('q', { keyPath: 'clientId' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const qAll = async () => { const db = await QDB(); return new Promise(res => { const r = db.transaction('q').objectStore('q').getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => res([]); }); };
const qPut = async x => { const db = await QDB(); return new Promise(res => { const tx = db.transaction('q', 'readwrite'); tx.objectStore('q').put(x); tx.oncomplete = res; }); };
const qDel = async id => { const db = await QDB(); return new Promise(res => { const tx = db.transaction('q', 'readwrite'); tx.objectStore('q').delete(id); tx.oncomplete = res; }); };
async function flushQueue() {
  if (!W.token) return; const items = await qAll(); let sent = 0;
  for (const x of items) {
    try {
      const r = x.scan ? await W.api.call('POST', 'worker/scan', x.body, { token: W.token }) : x.sup ? await W.api.call('POST', 'supervisor/punch', x.body) : await W.api.call('POST', 'worker/punch', x.body, { token: W.token });
      if (r.status === 401) break;
      await qDel(x.clientId); sent++;
    } catch (e) { break; }                      // still offline
  }
  if (sent) { toast(`☁ → ✓ ${sent}`); await refresh(); } else updateQueueBar();
}
window.addEventListener('online', flushQueue);
setInterval(flushQueue, 60000);

/* ---------- GPS ---------- */
function setGps(p) { W.gps = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy), at: Date.now() }; W.gpsErr = ''; paintGps(); }
function startGps() {
  if (W.watch != null || !navigator.geolocation) { if (!navigator.geolocation) W.gpsErr = t('noGps'); return; }
  W.watch = navigator.geolocation.watchPosition(setGps,
    e => { W.gpsErr = t('noGps'); paintGps(); }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
}
/* ---------- positions during a shift (routes and hotspots in the tracker) ----------
   Android app: a built-in recorder (LsTracker) keeps going with the screen off, the app closed and after a restart,
   until check-out; it stores points on the phone and sends them itself.
   Web page / home-screen app (iPhone): every 10 minutes or after ~50 m while the page is open; the screen can be
   kept awake during the shift. Points are kept on the phone until they are sent. */
const PING_MS = 10 * 60000;
// the app's built-in recorder (Android and iPhone); also found when the native bridge exposes registerPlugin only
let NT_P = null;
const NT = () => window.Capacitor?.Plugins?.LsTracker || (window.Capacitor?.isNativePlatform?.() && window.Capacitor.registerPlugin ? (NT_P ||= window.Capacitor.registerPlugin('LsTracker')) : null);
const STANDALONE = (() => { try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (e) { return false; } })();
let wake = null, sending = false;
const pingBuf = () => { try { return JSON.parse(ls.get('ls.pings') || '[]'); } catch (e) { return []; } };
function queuePoint(pt) {
  const buf = pingBuf(), last = buf[buf.length - 1] || JSON.parse(ls.get('ls.pingLast') || 'null');
  if (last && pt.ts - last.ts < PING_MS - 15000 && LSAPI.distance(last, pt) < 50) return;
  buf.push(pt); ls.set('ls.pings', JSON.stringify(buf.slice(-2000))); ls.set('ls.pingLast', JSON.stringify(pt));
}
async function sendPoints() {
  if (sending || !W.token) return; const buf = pingBuf(); if (!buf.length) return; sending = true;
  try { const part = buf.slice(0, 100), r = await W.api.call('POST', 'worker/ping', { pts: part }, { token: W.token }); if (r.status === 200) ls.set('ls.pings', buf.length > part.length ? JSON.stringify(buf.slice(part.length)) : null); }
  catch (e) { } finally { sending = false; }                                       // offline: kept, sent later
}
async function pingTick() {
  const on = !!(W.token && W.prof?.open && !W.sup);
  await syncBackground(on);
  if (on && !NT() && !document.hidden && W.gps && Date.now() - W.gps.at < 5 * 60000) queuePoint({ ts: Date.now(), lat: W.gps.lat, lng: W.gps.lng, acc: W.gps.acc });
  sendPoints();
}
const apiAbs = () => new URL(API_BASE || '/api', location.href).href.replace(/\/+$/, '');
/** Start / stop recording to match the shift */
async function syncBackground(on) {
  const nt = NT();
  if (nt) {
    try {
      let st = await nt.status();
      if (on && !st.running) {
        await nt.requestPermissions({ permissions: ['location', 'notifications'] }).catch(() => { });
        st = await nt.start({ api: apiAbs(), token: W.token, until: (W.prof.open?.ts || Date.now()) + 16 * 3600000, msg: t('bgMsg') });
        if (!st.background && !ls.get('ls.bgAsked')) { ls.set('ls.bgAsked', '1'); toast(t('bgPerm'), 8000); await nt.requestBackground().catch(() => { }); }
      } else if (on) st = await nt.setToken({ token: W.token, api: apiAbs() });
      else if (st.running && W.token) st = await nt.stop();
      else if (W.token && st.tokenExpired) st = await nt.setToken({ token: W.token, api: apiAbs() });        // send what waited for a sign-in
      W.nt = st; const el = $('#recst'); if (el) el.textContent = recLine();
    } catch (e) { }
    return;
  }
  // web page: keep the screen awake during the shift (default on when opened from the home screen)
  const pref = ls.get('ls.awake'), want = on && (pref === '1' || (pref == null && STANDALONE)) && !document.hidden;
  if (want && !wake && navigator.wakeLock) { try { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } catch (e) { } }
  if (!want && wake) { wake.release().catch(() => { }); wake = null; }
}
const recLine = () => W.nt?.running ? `● ${t('recOn')}${W.nt.queued ? ` · ${W.nt.queued} ${t('waiting')}` : ''}` : '';
/* ---------- getting the app: Android → APK from this site; iPhone → Add to Home Screen; others → install prompt ---------- */
const UA = navigator.userAgent, IOS = /iPhone|iPad|iPod/i.test(UA), ANDROID = /Android/i.test(UA);
let apkOk = null, installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
async function apkAvailable() {
  if (apkOk != null || !ANDROID || NT() || !location.protocol.startsWith('http')) return apkOk = apkOk || false;
  try { apkOk = (await fetch('ls-attendance.apk', { method: 'HEAD' })).ok; } catch (e) { apkOk = false; } return apkOk;
}
function installCard() {
  if (NT()) return '';
  if (ANDROID && apkOk) return `<a class="getapp" href="ls-attendance.apk" download>${ic('arrow')}<span>${t('getApp')}</span></a>`;
  if (IOS && !STANDALONE) return `<div class="getapp ios">${ic('more')}<span>${t('iosAdd')}</span></div>`;
  return '';
}
setInterval(pingTick, 60000); document.addEventListener('visibilitychange', pingTick); window.addEventListener('online', sendPoints);
apkAvailable().then(ok => { if (ok && !W.token) render(); });
function zoneInfo() {
  const g = W.gps, P = W.prof; if (!g || !P) return null;
  const own = P.site ? LSAPI.nearestPin(P.site, g, g.acc) : null;
  if (own?.inZone) return { ...own, site: P.site, own: true };
  const other = (P.sites || []).filter(s => s.id !== P.site?.id).map(s => ({ s, m: LSAPI.nearestPin(s, g, g.acc) })).filter(x => x.m?.inZone).sort((a, b) => a.m.d - b.m.d)[0];
  if (other) return { ...other.m, site: other.s, own: false };
  return own ? { ...own, site: P.site, own: true } : null;
}
function paintGps() {
  const el = $('#gps'); if (!el) return;
  const g = W.gps, z = zoneInfo(), max = W.prof?.settings?.maxAcc || 50;
  const conf = (cls, txt, tag) => `<div class="conf ${cls}"><span class="d"></span><span class="grow">${txt}</span>${tag ? `<span class="chip ${cls === 'ok' ? 'pos' : 'warn'} tag">${tag}</span>` : ''}</div>`;
  if (!g) el.innerHTML = W.gpsErr ? conf('bad', esc(W.gpsErr)) : conf('wait', t('locating'));
  else if (z?.inZone && g.acc > max) el.innerHTML = conf('warn', `${t('inZone')} · ${esc(z.site.name)} · ${t('poorGps')} ±${g.acc} m`, t('willReview'));
  else if (z?.inZone) el.innerHTML = conf('ok', `${t('inZone')} · ${z.d} m ${t('from')} ${esc(z.site.name)} · ±${g.acc} m${z.own ? '' : ` · ${t('reliever')} ${esc(z.site.name)}`}`, t('auto'));
  else el.innerHTML = conf('warn', `${t('outZone')}${z ? ` · ${z.d} m ${t('from')} ${esc(z.site.name)}` : ''} · ±${g.acc} m`, t('willReview'));
  const set = (id, v) => { const x = $('#' + id); if (x) x.innerHTML = v; };
  set('r-d', g && z ? `${z.d}` : '—'); set('r-a', g ? `${g.acc}` : '—');
  if (W.map && W.layers && g) {
    const L = window.L; W.layers.me?.remove(); W.layers.acc?.remove();
    W.layers.acc = L.circle([g.lat, g.lng], { radius: g.acc, color: cssv('--cyan'), weight: 1, fillOpacity: .08, dashArray: '3 4' }).addTo(W.map);
    W.layers.me = L.circleMarker([g.lat, g.lng], { radius: 7, color: cssv('--bg') || '#050606', weight: 2.5, fillColor: cssv('--cyan'), fillOpacity: 1 }).addTo(W.map);
    if (!W.layers.fitted) { W.layers.fitted = true; const b = L.latLngBounds([[g.lat, g.lng]]); (W.prof.site?.pins || []).forEach(p => b.extend([p.lat, p.lng])); W.map.fitBounds(b.pad(0.6), { maxZoom: 17 }); }
  }
}
// The position watch only reports when the phone moves, so a phone standing still keeps an older reading: one under
// 2 minutes is used at once. Otherwise ask for a reading now and take whichever comes first (at most maxWait).
async function freshFix(maxWait = 10000) {
  const recent = () => W.gps && Date.now() - W.gps.at < 120000 ? W.gps : null;
  if (recent()) return W.gps;
  const now = new Promise(res => { if (!navigator.geolocation) return res(null); navigator.geolocation.getCurrentPosition(p => { setGps(p); res(W.gps); }, () => res(null), { enableHighAccuracy: true, maximumAge: 10000, timeout: maxWait }); });
  const watched = (async () => { const t0 = Date.now(); while (Date.now() - t0 < maxWait) { if (recent()) return W.gps; await new Promise(r => setTimeout(r, 300)); } return null; })();
  return (await Promise.race([now, watched])) || (await watched) || W.gps;
}

/* ---------- camera + watermark ---------- */
// Start the front camera. Called first thing in the tap handler so the camera warms up while the screen is built
// (and stays inside the user gesture on iOS). No width/height: the phone uses its normal, uncropped selfie mode.
function openCam() {
  if (!navigator.mediaDevices?.getUserMedia) return Promise.reject(new Error('no camera'));
  return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
}
/** caption(): lines for the watermark, read when the shutter is pressed; may be async and return null to cancel */
function takePhoto(caption, cam = openCam()) {
  return new Promise(resolve => {
    const box = document.createElement('div'); box.className = 'cam';
    box.innerHTML = `<div class="hint">${t('takePhoto')}</div><video playsinline autoplay muted></video><div class="ctl"><button class="btn" data-x>${t('cancel')}</button><button class="shoot" data-s aria-label="shoot" disabled></button><span style="flex:1"></span></div>`;
    document.body.appendChild(box);
    const video = $('video', box), shoot = $('[data-s]', box); let stream = null, done = false;
    const stop = () => stream?.getTracks().forEach(x => x.stop());
    const close = v => { done = true; stop(); box.remove(); resolve(v); };
    $('[data-x]', box).onclick = () => close(null);
    const fromFile = () => {        // fallback: the phone's camera app (capture=user)
      if (done) return;
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'user';
      inp.onchange = async () => { const f = inp.files[0]; if (!f) return close(null); const img = new Image(); img.onload = () => review(img, img.naturalWidth, img.naturalHeight); img.src = URL.createObjectURL(f); };
      $('.hint', box).textContent = t('camOff'); shoot.disabled = false; shoot.onclick = () => inp.click(); inp.click();
    };
    cam.then(s => {
      if (done) return s.getTracks().forEach(x => x.stop());
      stream = s; video.srcObject = s;
      const ready = () => { shoot.disabled = false; };
      if (video.readyState >= 2) ready(); else video.addEventListener('loadeddata', ready, { once: true });
      shoot.onclick = () => review(video, video.videoWidth, video.videoHeight);
    }).catch(fromFile);
    async function review(src, w, h) {
      if (!w || !h) return;
      const k = Math.min(1, 720 / Math.max(w, h)); const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
      const g = c.getContext('2d'); g.drawImage(src, 0, 0, c.width, c.height);      // saved unmirrored, so the stamped text reads correctly
      stop(); shoot.disabled = true;
      $('.hint', box).textContent = t('locating');
      const lines = await caption(); if (!lines) return close(null);
      if (done) return;
      // watermark: name · ID, date-time, coordinates, site
      const fs = Math.max(13, Math.round(c.width / 34)); g.font = `600 ${fs}px Inter, Arial, sans-serif`;
      const bh = lines.length * (fs + 6) + 12; g.fillStyle = 'rgba(11,27,54,.72)'; g.fillRect(0, c.height - bh, c.width, bh);
      g.fillStyle = '#fff'; lines.forEach((l, i) => g.fillText(l, 10, c.height - bh + 8 + (i + 1) * (fs + 6) - 6));
      let q = .72, url = c.toDataURL('image/jpeg', q); while (url.length > 260000 && q > .35) { q -= .08; url = c.toDataURL('image/jpeg', q); }
      haptic(15); box.innerHTML = `<img src="${url}" alt=""><div class="ctl"><button class="btn" data-r>${t('retake')}</button><button class="btn pri" data-u>${ic('check')} ${t('use')}</button></div>`;
      $('[data-r]', box).onclick = () => { done = true; box.remove(); takePhoto(caption).then(resolve); };
      $('[data-u]', box).onclick = () => { done = true; box.remove(); resolve(url); };
    }
  });
}

/* ---------- patrol beats: rounds of checkpoints, scanned with the QR stickers ---------- */
const myScans = () => { try { return JSON.parse(ls.get('ls.scans') || '[]'); } catch (e) { return []; } };
function myBeats() {
  const P = W.prof; if (!P?.site || !P.open) return [];
  return (P.site.beats || []).filter(b => (b.shift === 'ALL' || !b.shift || b.shift === P.worker.shift) && (!b.assignees?.length || b.assignees.includes(P.worker.id)) && b.checkpoints?.length);
}
function beatProgress(b) {
  const start = W.prof.open.ts, every = Math.max(10, +b.everyMin || 60) * 60000, r = Math.max(0, Math.floor((Date.now() - start) / every));
  const total = Math.max(1, Math.floor((+(W.prof.settings?.shiftHours) || 12) * 3600000 / every)), a = start + r * every;
  const seen = new Set(myScans().filter(x => x.beat === b.id && x.ok && x.ts >= a && x.ts < a + every).map(x => x.cp));
  const next = b.checkpoints.find(c => !seen.has(c.id));
  return { round: Math.min(r + 1, total), total, done: seen.size, of: b.checkpoints.length, next, due: a + every };
}
function patrolCard() {
  const bs = myBeats(); if (!bs.length) return '';
  return `<section class="patrol"><div class="k">${t('patrol')}</div>${bs.map(b => { const p = beatProgress(b); return `<div class="pb"><div><b>${esc(b.name)}</b><span>${t('roundOf').replace('{r}', p.round).replace('{n}', p.total)} · ${p.done} / ${p.of} ${t('cpsDone')}</span>
    <small>${p.next ? `${t('nextCp')}: <b>${esc(p.next.name)}</b> · ${t('dueBy')} ${hhmm(p.due)}` : t('roundDone')}</small></div><div class="bar"><i style="width:${Math.round(100 * p.done / p.of)}%"></i></div></div>`; }).join('')}
    <button class="btn wide" id="b-scan">${ic('locate')} ${t('scanCp')}</button></section>`;
}
/** Read a checkpoint QR with the back camera (BarcodeDetector, else jsQR), then record it with the location */
function readQR() {
  return new Promise(resolve => {
    const box = document.createElement('div'); box.className = 'cam qr';
    box.innerHTML = `<div class="hint">${t('pointCam')}</div><video playsinline autoplay muted></video><div class="qrframe"></div><div class="ctl"><button class="btn" data-x>${t('cancel')}</button></div>`;
    document.body.appendChild(box);
    const video = $('video', box); let stream = null, done = false, timer = null;
    const close = v => { if (done) return; done = true; clearTimeout(timer); stream?.getTracks().forEach(x => x.stop()); box.remove(); resolve(v); };
    $('[data-x]', box).onclick = () => close(null);
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(async s => {
      stream = s; video.srcObject = s; await video.play().catch(() => { });
      let detect;
      if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats?.().catch(() => []))?.includes('qr_code')) { const bd = new BarcodeDetector({ formats: ['qr_code'] }); detect = async () => (await bd.detect(video))[0]?.rawValue; }
      else {
        await new Promise((ok, no) => { if (window.jsQR) return ok(); const sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'; sc.onload = ok; sc.onerror = no; document.head.appendChild(sc); });
        const c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true });
        detect = async () => { const w = video.videoWidth, h = video.videoHeight; if (!w) return null; const k = Math.min(1, 640 / Math.max(w, h)); c.width = w * k; c.height = h * k; g.drawImage(video, 0, 0, c.width, c.height); return window.jsQR(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height)?.data; };
      }
      const loop = async () => { if (done) return; const v = await detect().catch(() => null); if (v) { haptic(20); return close(v); } timer = setTimeout(loop, 220); };
      loop();
    }).catch(() => { $('.hint', box).textContent = t('camOff'); });
  });
}
async function scanCheckpoint() {
  const code = await readQR(); if (!code) return;
  const m = String(code).match(/^LSCP\|([^|]+)\|([^|]+)$/), b = m && myBeats().find(x => x.checkpoints.some(c => c.id === m[2]));
  if (!b) { haptic([80, 50, 80]); return toast(t('scanBad'), 5000); }
  const cp = b.checkpoints.find(c => c.id === m[2]), g = await freshFix(8000);
  const body = { code, ts: Date.now(), lat: g?.lat, lng: g?.lng, acc: g?.acc, clientId: uuid() };
  const keep = ok => { const l = myScans().filter(x => Date.now() - x.ts < 24 * 3600000); l.push({ beat: b.id, cp: cp.id, ts: body.ts, ok }); ls.set('ls.scans', JSON.stringify(l)); };
  let ok = g ? LSAPI.distance(g, cp) - Math.min(g.acc, 50) <= (+cp.radius || 25) + 30 : false;
  try { const r = await W.api.call('POST', 'worker/scan', body, { token: W.token }); if (r.status === 200) ok = r.body.scan.ok; else if (r.status === 401) { await qPut({ clientId: body.clientId, body, scan: true }); return signOut(true); } else { toast(r.body?.error || t('scanBad'), 5000); return; } }
  catch (e) { await qPut({ clientId: body.clientId, body, scan: true }); keep(ok); updateQueueBar(); haptic(40); toast(`${cp.name} · ${t('scanQueued')}`, 4000); return render(); }
  keep(ok); haptic(ok ? [30, 50, 30] : [80, 50, 80]);
  toast(ok ? `✓ ${cp.name} · ${hhmm(body.ts)}` : `${cp.name} · ${t('scanFar')}`, 5000); render();
}

/* ---------- tour of the Today screen (only when ? is tapped) ---------- */
function tour() {
  const steps = [['.place', 'tour1'], ['.clockw', 'tour2'], ['#mapcard', 'tour3'], ['.patrol', 'tour6'], ['#b-punch', 'tour4'], ['.tabs-b', 'tour5']].filter(([q]) => { const e = $(q); return e && e.getBoundingClientRect().height > 4; });
  let i = 0; const hole = document.createElement('div'), tip = document.createElement('div'); hole.className = 'tour-hole'; tip.className = 'tour-tip';
  document.body.append(hole, tip);
  const end = () => { hole.remove(); tip.remove(); removeEventListener('resize', place); };
  function place() {
    const el = $(steps[i][0]); if (!el) return end(); const r = el.getBoundingClientRect(), p = 6, vh = innerHeight;
    Object.assign(hole.style, { top: r.top - p + 'px', left: r.left - p + 'px', width: r.width + p * 2 + 'px', height: r.height + p * 2 + 'px' });
    // bubble docked at the bottom (thumb stays put); moves to the top only when the highlighted part is down there
    const th = tip.offsetHeight, low = r.bottom > vh - th - 40;
    tip.style.top = (low ? 64 : vh - th - 24) + 'px';
  }
  function show(n) {
    i = n; const [q, k] = steps[i], [ti, d] = t(k).split(' | ');
    $(q).scrollIntoView({ block: 'center', behavior: 'smooth' });
    tip.innerHTML = `<div class="tour-n" dir="ltr">${i + 1} / ${steps.length}</div><b>${esc(ti)}</b><p>${esc(d)}</p><div class="tour-b">${i ? `<button class="btn" data-tb>${ic('back')}</button>` : ''}<span style="flex:1"></span><button class="btn pri" data-tn>${i < steps.length - 1 ? ic('arrow') : ic('check')}</button></div>`;
    tip.querySelector('[data-tn]').onclick = () => i < steps.length - 1 ? show(i + 1) : end();
    if (tip.querySelector('[data-tb]')) tip.querySelector('[data-tb]').onclick = () => show(i - 1);
    place(); setTimeout(place, 400);
  }
  hole.onclick = end; addEventListener('resize', place); haptic(10); show(0);
}

/* ---------- screens ---------- */
function shell(body, { tabs = !!(W.prof && !W.sup), tab = SCREEN, crumb = '', dock = '' } = {}) {
  try { W.map?.remove(); } catch (e) { } W.map = null; W.layers = null;                 // the old map's element is about to go
  clearInterval(W.tick); W.tick = null;
  document.body.classList.toggle('notabs', !tabs); document.body.classList.toggle('nodock', !dock);
  $('#app').innerHTML = `<header class="top"><span class="mark">LS</span><p class="crumb"><span>Latinem</span><b>${esc(crumb || t('title'))}</b></p><span class="sp"></span>
    <button id="b-lang" class="ib" aria-label="${t('lang')}">${ic('globe')}<span>${esc(LANG.toUpperCase())}</span></button>${tab === 'home' && W.prof && !W.sup ? `<button id="b-tour" class="ib" aria-label="${t('tourT')}" title="${t('tourT')}"><b style="font-size:15px">?</b></button>` : ''}${W.prof || W.sup ? `<button id="b-menu" class="ib" aria-label="${t('more')}">${ic('more')}</button>` : ''}</header>
    ${W.api.demo ? `<div class="synthetic"><span class="d"></span><span>${t('demo')}</span></div>` : ''}<main>${body}</main>
    ${dock ? `<div class="dock"><div class="in">${dock}</div></div>` : ''}
    ${tabs ? `<nav class="tabs-b"><div class="in">${[['home', 'home', t('today')], ['month', 'cal', t('month')], ['more', 'more', t('more')]].map(([k, i, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${ic(i)}<span>${esc(l)}</span></button>`).join('')}</div></nav>` : ''}`;
  $('#b-lang').onclick = () => menu(LANGS.map(([k, n]) => [n, () => { setLang(k); render(); }, k === LANG]));
  if ($('#b-menu')) $('#b-menu').onclick = () => menu([
    ...(W.prof ? [[t('today'), () => go('home'), SCREEN === 'home'], [t('month'), () => go('month'), SCREEN === 'month']] : []),
    [t('supervisor'), openSupervisor], [t('signout'), signOut]]);
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { haptic(8); go(b.dataset.tab); });
}
function menu(items) {
  const m = document.createElement('div'); m.className = 'sheet-menu';
  m.innerHTML = `<div class="in">${items.map(([l, , on], i) => `<button data-i="${i}" class="${on ? 'on' : ''}">${esc(l)}${on ? ' ✓' : ''}</button>`).join('')}</div>`;
  m.onclick = e => { const b = e.target.closest('[data-i]'); m.remove(); if (b) items[+b.dataset.i][1](); };
  document.body.appendChild(m);
}
let SCREEN = 'login';
const go = s => { SCREEN = s; render(); };
function render() {
  if (W.sup) return renderSup();
  if (!W.token || !W.prof) return renderLogin();
  ({ home: renderHome, month: renderMonth, more: renderMore }[SCREEN] || renderHome)();
}
function renderLogin() {
  const known = W.code, hr = new Date().getHours(), greet = hr < 12 ? t('gm') : hr < 17 ? t('ga') : t('ge');
  if (!known || W.editCode) {
    shell(`<div class="hero"><p class="kick">LS · ${t('kicker')}</p><h1>Latinem <em>Securities</em></h1><p>${t('welcome')}</p></div>
      <div class="card"><label class="fl" for="code">${t('empId')}</label>
      <input class="f mono" id="code" placeholder="${t('empIdPh')}" value="${esc(known)}" autocapitalize="characters" autocomplete="username" inputmode="text">
      <button class="btn pri wide" id="b-next" style="margin-top:14px">${t('next')} ${ic('arrow')}</button>
      ${W.api.demo ? `<button class="btn ghost wide" id="b-demo" style="margin-top:6px">${t('loadDemo')}</button>` : ''}</div>
      ${installCard()}<p class="note">${t(NT() ? 'locNoteApp' : 'locNote')}</p>`, { crumb: t('signin') });
    $('#code').focus();
    const nx = () => { const c = $('#code').value.trim().toUpperCase(); if (!c) return; W.code = c; ls.set('ls.code', c); W.editCode = false; W.pin = ''; render(); };
    $('#b-next').onclick = nx; $('#code').onkeydown = e => e.key === 'Enter' && nx();
    if ($('#b-demo')) $('#b-demo').onclick = loadDemo;
    return;
  }
  shell(`<div class="hero" style="padding-bottom:6px"><p class="kick">LS · ${t('kicker')}</p><h1>${esc(greet)}</h1><p style="margin-top:14px"><span class="idchip">${esc(known)}<button id="b-not">${t('notYou')}</button></span></p></div>
    <p class="k" style="text-align:center;margin:18px 0 0">${t('enterPin')}</p><div class="dots ${W.shake ? 'shake' : ''}">${[0, 1, 2, 3].map(i => `<i class="${i < W.pin.length ? 'on' : ''}"></i>`).join('')}</div>
    <div class="err" id="err">${esc(W.err || '')}</div>
    <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join('')}<button class="fn" data-k="c" aria-label="clear">${ic('x')}</button><button data-k="0">0</button><button class="fn" data-k="b" aria-label="backspace">⌫</button></div>`, { crumb: t('signin') });
  W.shake = false;
  $('#b-not').onclick = () => { W.editCode = true; W.err = ''; ls.set('ls.code', null); W.code = ''; render(); };
  $$('.pad button').forEach(b => b.onclick = () => key(b.dataset.k));
  document.onkeydown = e => { if (SCREEN === 'login' && /^[0-9]$/.test(e.key)) key(e.key); if (e.key === 'Backspace') key('b'); };
  async function key(k) {
    if (W.busy) return;
    haptic(6); if (k === 'c') W.pin = ''; else if (k === 'b') W.pin = W.pin.slice(0, -1); else if (W.pin.length < 4) W.pin += k;
    W.err = ''; render();
    if (W.pin.length === 4) {
      W.busy = true;
      try {
        const r = await W.api.call('POST', 'worker/login', { code: W.code, pin: W.pin, deviceId: W.dev });
        W.pin = '';
        if (r.status !== 200) { W.err = r.body?.code === 'BAD_PIN' ? t('wrongPin') : r.body?.error || t('failed'); W.shake = true; haptic([60, 40, 60]); }
        else { W.token = r.body.token; ss.set('ls.tok', W.token); W.prof = r.body; SCREEN = 'home'; document.onkeydown = null; startGps(); flushQueue(); }
      } catch (e) { W.pin = ''; W.err = 'No connection'; }
      W.busy = false; render();
    }
  }
}
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

async function refresh(redraw = true) {
  if (!W.token) return;
  try { const r = await W.api.call('GET', 'worker/me', null, { token: W.token }); if (r.status === 401) return signOut(true); if (r.status === 200) { W.prof = r.body; ss.set('ls.prof', JSON.stringify(r.body)); setTimeout(pingTick, 0); if (redraw && !W.sup && !$('.cam') && !W.busy) render(); } } catch (e) { }
}
async function updateQueueBar() { const el = $('#qbar'); if (!el) return; const n = (await qAll()).length; el.hidden = !n; el.innerHTML = `${ic('wifi')}<span>${n} ${t('waiting')}</span>`; }

function renderHome() {
  const P = W.prof, w = P.worker, open = P.open, S0 = P.settings || {};
  const today = P.punches.filter(p => p.workDate === P.today || (open && p.id === open.id) || (open && p.inId === open.id)).sort((a, b) => a.ts - b.ts);
  const done = !open && today.some(p => p.type === 'out');
  const st = p => p.status === 'accepted' ? `<span class="chip pos">${t('statusAccepted')}</span>` : p.status === 'pending' ? `<span class="chip warn">${t('statusPending')}</span>` : `<span class="chip neg">${t('statusRejected')}</span>`;
  const start = S0.starts?.[w.shift] || '', hrsLen = +S0.shiftHours || 12;
  const [first, ...rest] = tc(w.name).split(/\s+/);
  const dur = ms => { const x = Math.max(0, Math.floor(ms / 1000)); return `${pad(Math.floor(x / 3600))}:${pad(Math.floor(x / 60) % 60)}:${pad(x % 60)}`; };
  // shift window for the progress rule (night shifts run past midnight)
  const win = () => { if (!start) return null; const [h, m] = start.split(':').map(Number), n = new Date(), a = new Date(n); a.setHours(h, m, 0, 0); if (a - n > 6 * 3600e3) a.setDate(a.getDate() - 1); const e = new Date(+a + hrsLen * 3600e3); return { a, e, p: Math.min(1, Math.max(0, (n - a) / (e - a))) }; };
  const W0 = win(), endT = W0 ? `${pad(W0.e.getHours())}:${pad(W0.e.getMinutes())}` : '';
  const hoursToday = today.reduce((x, p) => x + (+p.hours || 0), 0) + (open ? (Date.now() - open.ts) / 3600e3 : 0);
  const radius = P.site?.pins?.[0]?.radius || S0.radius || 100;
  shell(`<section class="place"><div class="n">${esc(first)} <em>${esc(rest.join(' '))}</em></div><div class="z"><b>${esc(P.site?.name || '—')}</b> · ${esc(w.shift)}${start ? ' ' + start : ''} · ${esc(w.code)}</div></section>
    <section class="clockw"><div class="k-stack" aria-hidden="true"><span class="k-day" id="k-day"></span><span id="k-am">AM</span><span id="k-pm">PM</span></div><div class="k-time" id="k-time"></div>
      <div class="k-side"><span class="k">${open ? t('elapsed') : t('status')}</span><b id="timer" class="${open ? 'on' : ''}">${open ? dur(Date.now() - open.ts) : esc(done ? t('finished') : t('notStarted'))}</b></div>
      ${W0 ? `<div class="k-rule"><div class="k-bar"><i id="k-fill" style="transform:scaleX(${W0.p.toFixed(3)})"></i><u id="k-now" style="left:calc(${(W0.p * 100).toFixed(1)}% - 1px)"></u></div><div class="k-ends"><span class="k">${start}</span><span class="k">${esc(w.shift)} · ${hrsLen} h</span><span class="k">${endT}</span></div></div>` : ''}</section>
    <div class="liverow"><div><b id="r-d">—</b><span class="k">${t('toPin')}</span></div><div class="opt"><b id="r-a">—</b><span class="k">${t('gpsAcc')}</span></div><div><b>${radius}</b><span class="k">${t('zoneR')}</span></div><div><b id="r-h">${hoursToday.toFixed(1)}</b><span class="k">${t('hToday')}</span></div></div>
    <div id="gps"></div>
    ${patrolCard()}
    <div id="qbar" class="q" hidden></div>
    <div class="mapcard" id="mapcard"><div id="map"></div>
      <div class="modechip" id="basechip"><button data-b="map">${t('mapL')}</button><button data-b="sat">${t('satL')}</button></div>
      <div class="tools"><button id="b-exp" aria-label="${t('expand')}" hidden>${ic('expand')}</button><button id="b-loc" aria-label="my location" hidden>${ic('locate')}</button></div>
      <div class="cap"><span class="d"></span><span>${t('live')} · ${radius} m ${t('zoneR').replace(/^m\s*/, '')}</span></div>
      <button class="ib x" id="b-mapx">${ic('x')} ${t('close')}</button></div>
    <div class="card"><div class="lbl"><span>${t('timeline')}</span><span>${new Date().toLocaleDateString(LANG === 'en' ? 'en-GB' : LANG, { weekday: 'short', day: 'numeric', month: 'short' })}</span></div>
      ${today.length ? `<ul class="list">${today.map(p => `<li><span class="ev">${ic(p.type === 'in' ? 'in' : 'out')}</span><span class="tm">${hhmm(p.ts)}</span><span class="grow"><span class="what">${p.type === 'in' ? t('in') : t('out')}${p.hours ? ` · ${p.hours} ${t('hours')}` : ''}</span><span class="sub">${esc(p.siteName || '')}</span></span>${st(p)}</li>`).join('')}</ul>`
        : `<div class="empty">${ic('clock')}<span>${t('noPunch')}</span></div>`}</div>
    <p class="note"><b id="recst" style="color:var(--sage)">${recLine()}</b> ${t(NT() ? 'locNoteApp' : 'locNote')}</p>${installCard()}`, {
    tab: 'home', crumb: P.site?.name || t('today'),
    dock: `<button class="big ${open ? 'out' : 'in'}" id="b-punch"><span class="bi">${ic(open ? 'out' : 'in')}</span><span class="grow"><span class="lab">${open ? t('checkOut') : t('checkIn')}</span><small>${open ? `${t('onShift')} · ${t('since')} ${hhmm(open.ts)}` : t('recNote')}</small></span>${ic('arrow')}</button>` });
  $('#b-punch').onclick = () => { haptic(12); punch(open ? 'out' : 'in'); };
  const tick = () => {
    const n = new Date(), h = n.getHours(), el = $('#k-time'); if (!el) return clearInterval(W.tick);
    el.textContent = `${h % 12 || 12}:${pad(n.getMinutes())}`;
    $('#k-day').textContent = n.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase();
    $('#k-am').className = h < 12 ? 'on' : ''; $('#k-pm').className = h >= 12 ? 'on' : '';
    if (open) { $('#timer').textContent = dur(Date.now() - open.ts); $('#r-h').textContent = (today.reduce((x, p) => x + (+p.hours || 0), 0) + (Date.now() - open.ts) / 3600e3).toFixed(1); }
    const w2 = win(); if (w2 && $('#k-fill')) { $('#k-fill').style.transform = `scaleX(${w2.p.toFixed(3)})`; $('#k-now').style.left = `calc(${(w2.p * 100).toFixed(1)}% - 1px)`; }
  };
  tick(); W.tick = setInterval(tick, 1000);
  const card = $('#mapcard');
  $('#b-exp').onclick = () => { card.classList.add('full'); setTimeout(() => W.map?.invalidateSize(), 60); };
  $('#b-mapx').onclick = () => { card.classList.remove('full'); setTimeout(() => W.map?.invalidateSize(), 60); };
  if ($('#b-tour')) $('#b-tour').onclick = tour;
  if ($('#b-scan')) $('#b-scan').onclick = scanCheckpoint;
  $$('#basechip [data-b]').forEach(b => b.onclick = () => { if (!W.map) return; LSMap.setBase(W.map, b.dataset.b); $$('#basechip [data-b]').forEach(x => x.classList.toggle('on', x === b)); });
  paintGps(); updateQueueBar(); drawMap();
}
async function drawMap() {
  const el = $('#map'); if (!el) return;
  try {
    const map = await LSMap.create(el, { zoom: 15, center: W.prof.site?.pins?.[0] ? [W.prof.site.pins[0].lat, W.prof.site.pins[0].lng] : undefined, zoomControl: false, animate: false, control: false, dark: isDark() });
    if (!el.isConnected) { map.remove(); return; }                       // screen changed while the map loaded
    W.map = map;
    $$('#basechip [data-b]').forEach(x => x.classList.toggle('on', x.dataset.b === LSMap.base(map)));
    if ($('#b-exp')) $('#b-exp').hidden = false;
    const loc = $('#b-loc'); if (loc) { loc.hidden = false; loc.onclick = () => { if (W.gps) map.setView([W.gps.lat, W.gps.lng], Math.max(map.getZoom(), 17)); else toast(W.gpsErr || t('locating')); }; }
    W.layers = {};
    const own = cssv('--bronze') || '#B08D57', oth = cssv('--mute') || '#8C908A';
    for (const s of W.prof.sites || []) for (const p of s.pins) LSMap.zone(W.map, p, { color: s.id === W.prof.site?.id ? own : oth, label: s.name, fill: s.id === W.prof.site?.id ? .14 : .05 });
    paintGps();
  } catch (e) { el.closest('.mapcard').hidden = true; }
}
async function punch(type, forWorker) {
  if (W.busy) return; W.busy = true;
  try {
    // the camera opens at once; GPS keeps updating meanwhile and is read when the photo is taken
    const cam = openCam(); cam.catch(() => { });
    const P = W.prof, who = forWorker || P.worker; let g = null;
    const photo = await takePhoto(async () => {
      g = await freshFix();
      if (!g) { toast(W.gpsErr || t('noGps'), 4000); return null; }
      const z = zoneInfo();
      return [`${who.name} · ${who.code}`, `${new Date().toLocaleString('en-GB')} · ${type === 'in' ? 'CHECK IN' : 'CHECK OUT'}`, `${g.lat.toFixed(6)}, ${g.lng.toFixed(6)} ±${g.acc} m`, z ? `${z.site.name} · ${z.d} m` : (P?.site?.name || '')];
    }, cam);
    if (!photo || !g) return;
    const body = { type, ts: Date.now(), lat: g.lat, lng: g.lng, acc: g.acc, photo, clientId: uuid(), deviceId: W.dev, ...(forWorker ? { code: forWorker.code } : {}) };
    showResult('send', null, photo);
    let r;
    const send = forWorker ? W.api.call('POST', 'supervisor/punch', body) : W.api.call('POST', 'worker/punch', body, { token: W.token });
    try { r = await Promise.race([send, new Promise(res => setTimeout(() => res('slow'), 6000))]); }
    catch (e) { await qPut({ clientId: body.clientId, body, sup: !!forWorker }); return showResult('queued', null, photo); }
    if (r === 'slow') {
      // weak signal or a server waking up: keep the punch on the phone and let the worker go; the request carries on,
      // and the same clientId means a resend from the queue is never counted twice
      await qPut({ clientId: body.clientId, body, sup: !!forWorker });
      send.then(async x => { if (x.status !== 401) await qDel(body.clientId); updateQueueBar(); if (!forWorker) refresh(false); }).catch(() => { });
      return showResult('queued', null, photo);
    }
    if (r.status === 401) { await qPut({ clientId: body.clientId, body }); return signOut(true); }
    if (r.status !== 200) return showResult('bad', r.body?.error, photo);
    showResult(r.body.punch.status === 'accepted' ? 'ok' : 'pend', r.body.punch.status === 'pending' ? r.body.punch.reasons.join(' · ') : (r.body.punch.reliever ? `${t('reliever')} ${r.body.punch.siteName}` : ''), photo);
    forWorker ? loadBoard(false) : refresh(false);
  } finally { W.busy = false; }
}
function showResult(kind, msg, photo) {
  const M = { send: ['send', t('stSend'), t('sending'), ''], ok: ['ok', t('stOk'), t('accepted'), ''], pend: ['pend', t('stPend'), t('pending'), t('pendingWhy')], queued: ['off', t('stQ'), t('queued'), t('queuedWhy')], bad: ['bad', t('stBad'), t('failed'), ''] }[kind];
  if (kind === 'ok') haptic([30, 50, 30]); else if (kind === 'bad') haptic([80, 50, 80]); else if (kind !== 'send') haptic(40);
  shell(`<div class="res ${M[0]}">${kind === 'send' ? '<div class="spin"></div>' : `<span class="stamp">${esc(M[1])}</span>`}
    <div class="when">${hhmm(Date.now())}</div><h2>${M[2]}</h2><p class="note">${esc(msg || M[3])}</p>${photo ? `<img src="${photo}" alt="">` : ''}
    ${kind === 'send' ? '' : `<button class="btn pri wide" id="b-done" style="margin-top:22px">${t('done')}</button>`}</div>`, { tabs: false, crumb: M[1] });
  if ($('#b-done')) $('#b-done').onclick = () => W.sup ? renderSup() : go('home');
}
function renderMonth() {
  const P = W.prof, now = new Date(), cur = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const months = [...new Set([...Object.keys(P.months || {}), cur])].sort().reverse();
  const ym = W.ym && months.includes(W.ym) ? W.ym : months[0];
  const codes = (P.months || {})[ym] || [], [y, m] = ym.split('-').map(Number), N = new Date(y, m, 0).getDate(), first = new Date(y, m - 1, 1).getDay();
  const todayISO = `${cur}-${pad(now.getDate())}`;
  const live = new Map(P.punches.filter(p => p.type === 'in' && p.status !== 'rejected' && p.workDate.startsWith(ym)).map(p => [+p.workDate.slice(8), p.status === 'accepted' ? 'P' : '…']));
  const day = d => codes[d - 1] || live.get(d) || '';
  const all = [...Array(N)].map((_, i) => day(i + 1)), cnt = re => all.filter(c => re.test(c)).length;
  const mName = x => new Date(+x.slice(0, 4), +x.slice(5) - 1, 1).toLocaleDateString(LANG === 'en' ? 'en-GB' : LANG, { month: 'short', year: 'numeric' });
  const cell = d => { const c = day(d); return `<div class="d ${esc(c)} ${`${ym}-${pad(d)}` === todayISO ? 'today' : ''}"><b>${d}</b>${esc(c)}</div>`; };
  shell(`<section class="place"><div class="n">${esc(t('month'))}</div><div class="z"><b>${esc(mName(ym))}</b> · ${esc(P.worker.code)}</div></section>
    <div class="seg">${months.slice(0, 3).map(x => `<button data-m="${x}" class="${x === ym ? 'on' : ''}">${esc(mName(x))}</button>`).join('')}</div>
    <div class="tiles"><div class="tile P"><b>${cnt(/^(P|R)$/)}</b><span>${t('worked')}</span></div><div class="tile"><b>${cnt(/^(OFF|O)$/)}</b><span>${t('off')}</span></div><div class="tile A"><b>${cnt(/^A$/)}</b><span>${t('absent')}</span></div><div class="tile L"><b>${cnt(/^(AL|SL|EL|UL)$/)}</b><span>${t('leave')}</span></div></div>
    <div class="card"><div class="cal">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => `<div class="h">${d}</div>`).join('')}${'<div></div>'.repeat(first)}${[...Array(N)].map((_, i) => cell(i + 1)).join('')}</div>
      <div class="legend"><span><i style="background:var(--sage)"></i>${t('worked')}</span><span><i style="background:var(--faint)"></i>${t('off')}</span><span><i style="background:var(--red)"></i>${t('absent')}</span><span><i style="background:var(--gold)"></i>${t('leave')}</span></div></div>`, { tab: 'month', crumb: t('month') });
  $$('[data-m]').forEach(b => b.onclick = () => { W.ym = b.dataset.m; renderMonth(); });
}
function renderMore() {
  const P = W.prof, th = ls.get('ls.theme') || 'auto', [first, ...rest] = tc(P.worker.name).split(/\s+/);
  const thL = th === 'dark' ? t('themeDarkS') : th === 'light' ? t('themeLightS') : t('themeAuto');
  shell(`<section class="place"><div class="n">${esc(first)} <em>${esc(rest.join(' '))}</em></div><div class="z"><b>${esc(P.worker.code)}</b> · ${esc(P.site?.name || '')}</div></section>
    <div class="card" style="padding:4px 16px"><ul class="menu-list">
      <li><button id="m-lang">${ic('globe')}<span>${t('lang')}</span><span class="val">${esc(LANGS.find(l => l[0] === LANG)[1])}</span></button></li>
      ${installEvt && !STANDALONE ? `<li><button id="m-inst">${ic('arrow')}<span>${t('install')}</span></button></li>` : ''}
      ${NT() ? '' : `<li><button id="m-awake">${ic('locate')}<span>${t('awake')}</span><span class="val">${(ls.get('ls.awake') ?? (STANDALONE ? '1' : '0')) === '1' ? '✓' : '—'}</span></button></li>`}
      <li><button id="m-theme">${ic('moon')}<span>${t('theme')}</span><span class="val">${esc(thL)}</span></button></li>
      <li><button id="m-sup">${ic('users')}<span>${t('supervisor')}</span><span class="val">${ic('arrow')}</span></button></li>
      <li><button id="m-out" class="danger">${ic('logout')}<span>${t('signout')}</span></button></li></ul></div>
 ${installCard()}<p class="note">${t(NT() ? 'locNoteApp' : 'locNote')}</p><p class="k" style="text-align:center;margin-top:18px">LS · ${t('appVer')} 3.0</p>`, { tab: 'more', crumb: t('more') });
  $('#m-lang').onclick = () => $('#b-lang').click();
  if ($('#m-inst')) $('#m-inst').onclick = async () => { installEvt.prompt(); await installEvt.userChoice.catch(() => { }); installEvt = null; renderMore(); };
  if ($('#m-awake')) $('#m-awake').onclick = () => { ls.set('ls.awake', (ls.get('ls.awake') ?? (STANDALONE ? '1' : '0')) === '1' ? '0' : '1'); toast(t('awakeS'), 5000); pingTick(); renderMore(); };
  $('#m-theme').onclick = () => menu([['auto', t('themeAuto')], ['dark', t('themeDarkS')], ['light', t('themeLightS')]].map(([k, l]) => [l, () => { ls.set('ls.theme', k === 'auto' ? null : k); applyTheme(); renderMore(); }, k === th]));
  $('#m-sup').onclick = openSupervisor; $('#m-out').onclick = () => signOut();
}
/* ---------- supervisor: site board + punch on behalf ---------- */
async function openSupervisor() {
  if (!W.api.demo) {
    const me = await fetch('/.auth/me').then(r => r.json()).catch(() => null);
    const roles = me?.clientPrincipal?.userRoles || [];
    if (!roles.includes('supervisor') && !roles.includes('admin')) { location.href = '/.auth/login/aad?post_login_redirect_uri=' + encodeURIComponent(location.pathname + '#sup'); return; }
  } else W.api = LSClient.make({ base: API_BASE, role: 'supervisor' });
  W.sup = true; startGps(); await loadBoard();
}
async function loadBoard(redraw = true) {
  const r = await W.api.call('GET', 'supervisor/board', null, { query: { site: W.supSite || '', date: W.supDate || '' } }).catch(() => null);
  if (r?.status !== 200) { toast(r?.body?.error || 'No connection'); W.sup = false; return render(); }
  W.board = r.body; W.prof ||= { sites: r.body.sites, site: null, punches: [] }; if (redraw) renderSup();
}
function renderSup() {
  const B = W.board || { workers: [], sites: [], codes: [] }, isToday = B.date === B.today;
  const state = w => { const ins = w.punches.filter(p => p.type === 'in'), outs = w.punches.filter(p => p.type === 'out'); return ins.length > outs.length ? 'in' : ins.length ? 'done' : w.mark?.mark ? 'marked' : 'none'; };
  const base = B.workers.filter(w => !W.supSite || w.siteId === W.supSite);
  const n = k => base.filter(w => state(w) === k).length;
  const f = W.supF || 'all', q = (W.supQ || '').trim().toUpperCase();
  const rows = base.filter(w => (f === 'all' || state(w) === f || (f === 'none' && state(w) === 'marked')) && (!q || w.name.toUpperCase().includes(q) || w.code.toUpperCase().includes(q)));
  const ord = { none: 0, marked: 1, in: 2, done: 3 };
  shell(`<section class="place"><div class="n">${t('supervisor')}</div><div class="z"><b>${esc(B.sites.find(x => x.id === W.supSite)?.name || t('all'))}</b> · ${esc(B.date || '')}</div></section>
    <div class="card"><div class="row"><div class="grow"><label class="fl" for="sp-site">${t('site')}</label><select class="f" id="sp-site"><option value="">${t('all')}</option>${B.sites.map(s => `<option value="${esc(s.id)}" ${s.id === W.supSite ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      <div><label class="fl" for="sp-date">${t('date')}</label><input class="f" type="date" id="sp-date" value="${esc(B.date)}" max="${esc(B.today)}"></div></div>
    <div class="chips">${[['all', t('all'), base.length], ['none', t('notIn'), n('none') + n('marked')], ['in', t('inNow'), n('in')], ['done', t('doneLbl'), n('done')]].map(([k, l, c]) => `<button data-f="${k}" class="${f === k ? 'on' : ''}">${l} <b>${c}</b></button>`).join('')}</div>
    <p class="note" style="margin:10px 2px 0">${n('in')} in · ${n('done')} ${t('doneLbl').toLowerCase()} · ${n('none')} ${t('noCheckIn')}${n('marked') ? ` · ${n('marked')} ${t('marked')}` : ''}</p>
    <div class="srch">${ic('search')}<input class="f" id="sp-q" placeholder="${t('search')}" value="${esc(W.supQ || '')}" autocomplete="off"></div></div>
    ${n('none') ? `<div class="q">${ic('info')}<span>${t('markHint')}</span></div>` : ''}
    <div class="card" style="padding:4px 16px"><ul class="list sup">${rows.sort((a, b) => ord[state(a)] - ord[state(b)]).map(w => { const s = state(w); return `<li><span class="av">${initials(w.name)}<i class="${s}"></i></span><span class="grow"><span class="what">${esc(tc(w.name))}</span><span class="sub mono">${esc(w.code)} · ${esc(w.shift)}${w.punches.length ? ' · ' + w.punches.map(p => (p.type === 'in' ? '↘' : '↗') + hhmm(p.ts)).join(' ') : ''}</span></span>
      ${(s === 'none' || s === 'marked') || (isToday && s !== 'done') ? `<div class="acts">${s === 'none' || s === 'marked' ? `<select class="f" data-mk="${esc(w.code)}"><option value="">${s === 'marked' ? '✕ ' + t('clear') : t('markAs')}</option>${B.codes.map(([c, l]) => `<option value="${c}" ${w.mark?.mark === c ? 'selected' : ''}>${c} – ${esc(l)}</option>`).join('')}</select>` : ''}
      ${isToday && s !== 'done' ? `<button class="btn ${s === 'in' ? '' : 'pri'}" data-pw="${esc(w.code)}" data-t="${s === 'in' ? 'out' : 'in'}">${ic(s === 'in' ? 'out' : 'in')} ${s === 'in' ? t('checkOut') : t('checkIn')}</button>` : ''}</div>` : ''}</li>`; }).join('') || `<li><div class="empty grow">${ic('inbox')}<span>—</span></div></li>`}</ul></div>
    <div id="gps"></div><button class="btn wide" id="b-exit" style="margin-top:10px">${ic('back')} ${t('back')}</button>`, { tabs: false, crumb: t('supervisor') });
  $('#sp-site').onchange = e => { W.supSite = e.target.value; loadBoard(); };
  $('#sp-date').onchange = e => { W.supDate = e.target.value; loadBoard(); };
  $$('[data-f]').forEach(b => b.onclick = () => { W.supF = b.dataset.f; renderSup(); });
  $('#sp-q').oninput = e => { W.supQ = e.target.value; const pos = e.target.selectionStart; renderSup(); const i = $('#sp-q'); i.focus(); try { i.setSelectionRange(pos, pos); } catch (x) { } };
  $$('[data-pw]').forEach(b => b.onclick = () => { const w = B.workers.find(x => x.code === b.dataset.pw); punch(b.dataset.t, w); });
  $$('[data-mk]').forEach(sel => sel.onchange = async () => {
    const r = await W.api.call('POST', 'supervisor/mark', { code: sel.dataset.mk, date: B.date, mark: sel.value }).catch(() => null);
    if (r?.status === 200) { haptic(15); toast(sel.value ? `${sel.dataset.mk} → ${sel.value}` : t('clear')); loadBoard(); } else toast(r?.body?.error || 'No connection');
  });
  $('#b-exit').onclick = () => { W.sup = false; W.api = LSClient.make({ base: API_BASE }); render(); };
  paintGps();
}
function signOut(expired) { syncBackground(false); W.token = null; W.prof = null; ss.set('ls.tok', null); ss.set('ls.prof', null); W.sup = false; SCREEN = 'login'; if (expired === true) W.err = ''; render(); }

/* ---------- demo roster (demo mode only): three workers, zones around where you are ---------- */
async function loadDemo() {
  toast(t('locating')); startGps(); const g = await freshFix(8000) || { lat: 25.0, lng: 55.5, acc: 20 };
  const admin = LSClient.make({ base: '', role: 'admin' }), pin = await LSAPI.hashPin('1234');
  const off = m => m / 111320;
  const sites = [{ id: 'demo-s1', name: 'INFRA OFFICE', project: 'SCL - ELWOOD - INFRA', pins: [{ lat: g.lat, lng: g.lng, radius: 100 }] }, { id: 'demo-s2', name: 'GATE NO 1 (MAIN ENTRANCE)', project: 'SCL - ELWOOD - INFRA', pins: [{ lat: g.lat + off(300), lng: g.lng, radius: 80 }] }];
  const workers = [['C52392', 'ANEESH DOMINIC', 'DAY', 'demo-s1'], ['C80453', 'HARIKUMAR', 'NIGHT', 'demo-s1'], ['C66585', 'PRATHEEK JAGADEESH', 'DAY', 'demo-s2']].map(([code, name, shift, siteId]) => ({ id: 'demo-' + code, code, name, shift, siteId, enabled: true, pinHash: pin.hash, pinSalt: pin.salt, resetDevice: true }));
  await admin.call('PUT', 'admin/roster', { workers, sites, settings: { starts: { DAY: '07:00', NIGHT: '19:00' } } });
  W.code = 'C52392'; ls.set('ls.code', W.code); W.editCode = false; toast('Demo: C52392 · PIN 1234', 5000); render();
}

/* ---------- start ---------- */
if (window.isSecureContext && location.protocol.startsWith('http') && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
setLang(LANG); applyTheme();
try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme); } catch (e) { }
LSMap.load().catch(() => { });                 // fetch the map library while the profile loads
(async () => {
  // signed in before: draw Today from the last profile at once, then bring it up to date in the background
  const cached = W.token && (() => { try { return JSON.parse(ss.get('ls.prof')); } catch (e) { return null; } })();
  if (cached && location.hash !== '#sup') { W.prof = cached; SCREEN = 'home'; startGps(); render(); document.body.dataset.ready = '1'; refresh(); flushQueue(); return; }
  if (W.token) { await refresh(); if (W.prof) { SCREEN = 'home'; startGps(); flushQueue(); } else { W.token = null; } }
  if (location.hash === '#sup') { history.replaceState(null, '', location.pathname + location.search); await openSupervisor(); return; }
  render(); document.body.dataset.ready = '1';
})();
setInterval(() => { if (W.prof && !W.sup && SCREEN === 'home' && !$('.cam') && !W.busy && !$('.mapcard.full')) refresh(); }, 120000);
