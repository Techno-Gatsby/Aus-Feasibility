/* =====================================================================
   Worker Attendance – sign in (remembered Emp ID + PIN), check in / out
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
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>', inbox: '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1.5 2.5h5L16 13h5"/>'
};
const ic = (k, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[k] || ''}</svg>`;
const haptic = p => { try { navigator.vibrate?.(p); } catch (e) { } };
const initials = n => esc(String(n || '?').split(/\s+/).filter(Boolean).map(x => x[0]).slice(0, 2).join(''));
function applyTheme() { const th = ls.get('ls.theme') || 'auto'; if (th === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = th; const dark = th === 'dark' || (th === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches); document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#0C1422' : '#12305E'); }
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
      const r = x.sup ? await W.api.call('POST', 'supervisor/punch', x.body) : await W.api.call('POST', 'worker/punch', x.body, { token: W.token });
      if (r.status === 401) break;
      await qDel(x.clientId); sent++;
    } catch (e) { break; }                      // still offline
  }
  if (sent) { toast(`☁ → ✓ ${sent}`); await refresh(); } else updateQueueBar();
}
window.addEventListener('online', flushQueue);
setInterval(flushQueue, 60000);

/* ---------- GPS ---------- */
function startGps() {
  if (W.watch != null || !navigator.geolocation) { if (!navigator.geolocation) W.gpsErr = t('noGps'); return; }
  W.watch = navigator.geolocation.watchPosition(p => { W.gps = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy), at: Date.now() }; W.gpsErr = ''; paintGps(); },
    e => { W.gpsErr = t('noGps'); paintGps(); }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
}
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
  const g = W.gps, z = zoneInfo();
  if (!g) el.innerHTML = W.gpsErr ? `<span class="pill neg"><span class="dot"></span>${esc(W.gpsErr)}</span>` : `<span class="pill"><span class="dot"></span>${t('locating')}</span>`;
  else if (z?.inZone && g.acc > (W.prof?.settings?.maxAcc || 50)) el.innerHTML = `<span class="pill warn"><span class="dot"></span>${t('inZone')} · ${esc(z.site.name)} · ${t('poorGps')} ±${g.acc} m</span>`;
  else if (z?.inZone) el.innerHTML = `<span class="pill pos"><span class="dot"></span>${t('inZone')} · ${z.d} m ${t('from')} ${esc(z.site.name)} · ±${g.acc} m</span>${z.own ? '' : ` <span class="pill warn">${t('reliever')} ${esc(z.site.name)}</span>`}`;
  else el.innerHTML = `<span class="pill warn"><span class="dot"></span>${t('outZone')}${z ? ` · ${z.d} m ${t('from')} ${esc(z.site.name)}` : ''} · ±${g.acc} m</span>`;
  const cap = $('#cap'); if (cap) cap.textContent = !g ? (W.gpsErr || t('locating')) : z?.inZone && g.acc <= (W.prof?.settings?.maxAcc || 50) ? t('inZoneHint') : t('outZoneHint');
  if (W.map && W.layers && g) {
    const L = window.L; W.layers.me?.remove(); W.layers.acc?.remove();
    W.layers.acc = L.circle([g.lat, g.lng], { radius: g.acc, color: '#16202F', weight: 1, fillOpacity: .08, dashArray: '3 3' }).addTo(W.map);
    W.layers.me = L.circleMarker([g.lat, g.lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#E0762F', fillOpacity: 1 }).addTo(W.map);
    if (!W.layers.fitted) { W.layers.fitted = true; const b = L.latLngBounds([[g.lat, g.lng]]); (W.prof.site?.pins || []).forEach(p => b.extend([p.lat, p.lng])); W.map.fitBounds(b.pad(0.6), { maxZoom: 17 }); }
  }
}
async function freshFix(maxWait = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxWait) { if (W.gps && Date.now() - W.gps.at < 30000) return W.gps; await new Promise(r => setTimeout(r, 400)); }
  return W.gps;
}

/* ---------- camera + watermark ---------- */
function takePhoto(caption) {
  return new Promise(resolve => {
    const box = document.createElement('div'); box.className = 'cam';
    box.innerHTML = `<div class="hint">${t('takePhoto')}<br><small style="opacity:.8">${t('faceHint')}</small></div><video playsinline autoplay muted></video><div class="oval"></div><div class="ctl"><button class="btn" data-x>${t('cancel')}</button><button class="shoot" data-s aria-label="shoot"></button><span style="flex:1"></span></div>`;
    document.body.appendChild(box);
    const video = $('video', box); let stream = null;
    const close = v => { stream?.getTracks().forEach(x => x.stop()); box.remove(); resolve(v); };
    $('[data-x]', box).onclick = () => close(null);
    const fromFile = () => {        // fallback: the phone's camera app (capture=user)
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'user';
      inp.onchange = async () => { const f = inp.files[0]; if (!f) return close(null); const img = new Image(); img.onload = () => review(img, img.naturalWidth, img.naturalHeight); img.src = URL.createObjectURL(f); };
      $('.hint', box).textContent = t('camOff'); $('[data-s]', box).onclick = () => inp.click(); inp.click();
    };
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 1280 } }, audio: false })
      .then(s => { stream = s; video.srcObject = s; $('[data-s]', box).onclick = () => review(video, video.videoWidth, video.videoHeight); })
      .catch(fromFile) ?? fromFile();
    function review(src, w, h) {
      const k = Math.min(1, 720 / Math.max(w, h)); const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
      const g = c.getContext('2d'); g.drawImage(src, 0, 0, c.width, c.height);
      // watermark: name · ID, date-time, coordinates, site
      const lines = caption(); const fs = Math.max(13, Math.round(c.width / 34)); g.font = `600 ${fs}px Inter, Arial, sans-serif`;
      const bh = lines.length * (fs + 6) + 12; g.fillStyle = 'rgba(11,27,54,.72)'; g.fillRect(0, c.height - bh, c.width, bh);
      g.fillStyle = '#fff'; lines.forEach((l, i) => g.fillText(l, 10, c.height - bh + 8 + (i + 1) * (fs + 6) - 6));
      let q = .72, url = c.toDataURL('image/jpeg', q); while (url.length > 260000 && q > .35) { q -= .08; url = c.toDataURL('image/jpeg', q); }
      stream?.getTracks().forEach(x => x.stop());
      haptic(15); box.innerHTML = `<img src="${url}" alt=""><div class="ctl"><button class="btn" data-r>${t('retake')}</button><button class="btn pri" data-u>${ic('check')} ${t('use')}</button></div>`;
      $('[data-r]', box).onclick = () => { box.remove(); takePhoto(caption).then(resolve); };
      $('[data-u]', box).onclick = () => { box.remove(); resolve(url); };
    }
  });
}

/* ---------- screens ---------- */
function shell(body, { tabs = !!(W.prof && !W.sup), tab = SCREEN } = {}) {
  try { W.map?.remove(); } catch (e) { } W.map = null; W.layers = null;                 // the old map's element is about to go
  clearInterval(W.tick); W.tick = null;
  document.body.classList.toggle('notabs', !tabs);
  $('#app').innerHTML = `<div class="bar"><span class="mark">LS</span><span class="t">${t('title')}<small>Latinem Securities</small></span><span class="sp"></span>
    <button id="b-lang" aria-label="${t('lang')}">${ic('globe')}${esc(LANGS.find(l => l[0] === LANG)[1])}</button>${W.prof || W.sup ? `<button id="b-menu" aria-label="${t('more')}">${ic('more')}</button>` : ''}</div>
    ${W.api.demo ? `<div class="demo">${t('demo')}</div>` : ''}<main>${body}</main>
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
    shell(`<div class="hero"><div class="logo">LS</div><h1>${greet}</h1><p>${t('signin')}</p></div>
      <div class="card"><label class="fl" for="code">${t('empId')}</label>
      <input class="f mono" id="code" placeholder="${t('empIdPh')}" value="${esc(known)}" autocapitalize="characters" autocomplete="username" inputmode="text">
      <button class="btn pri wide" id="b-next" style="margin-top:14px">${t('next')}</button>
      ${W.api.demo ? `<button class="btn ghost wide" id="b-demo" style="margin-top:8px">${t('loadDemo')}</button>` : ''}</div>`);
    $('#code').focus();
    const nx = () => { const c = $('#code').value.trim().toUpperCase(); if (!c) return; W.code = c; ls.set('ls.code', c); W.editCode = false; W.pin = ''; render(); };
    $('#b-next').onclick = nx; $('#code').onkeydown = e => e.key === 'Enter' && nx();
    if ($('#b-demo')) $('#b-demo').onclick = loadDemo;
    return;
  }
  shell(`<div class="hero"><div class="logo">LS</div><h1>${greet}</h1><p style="margin:10px 0 0"><span class="idchip">${esc(known)}<button id="b-not">${t('notYou')}</button></span></p></div>
    <p class="muted" style="text-align:center;margin:14px 0 0">${t('enterPin')}</p><div class="dots ${W.shake ? 'shake' : ''}">${[0, 1, 2, 3].map(i => `<i class="${i < W.pin.length ? 'on' : ''}"></i>`).join('')}</div>
    <div class="err" id="err">${esc(W.err || '')}</div>
    <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join('')}<button class="fn" data-k="c" aria-label="clear">${ic('x')}</button><button data-k="0">0</button><button class="fn" data-k="b" aria-label="backspace">⌫</button></div>`);
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
  try { const r = await W.api.call('GET', 'worker/me', null, { token: W.token }); if (r.status === 401) return signOut(true); if (r.status === 200) { W.prof = r.body; if (redraw && !W.sup) render(); } } catch (e) { }
}
async function updateQueueBar() { const el = $('#qbar'); if (!el) return; const n = (await qAll()).length; el.hidden = !n; el.innerHTML = `${ic('wifi')}<span>${n} ${t('waiting')}</span>`; }

function renderHome() {
  const P = W.prof, w = P.worker, open = P.open;
  const today = P.punches.filter(p => p.workDate === P.today || (open && p.id === open.id) || (open && p.inId === open.id)).sort((a, b) => a.ts - b.ts);
  const done = !open && today.some(p => p.type === 'out');
  const hr = new Date().getHours(), greet = hr < 12 ? t('gm') : hr < 17 ? t('ga') : t('ge');
  const st = p => p.status === 'accepted' ? `<span class="pill pos">${t('statusAccepted')}</span>` : p.status === 'pending' ? `<span class="pill warn">${t('statusPending')}</span>` : `<span class="pill neg">${t('statusRejected')}</span>`;
  const start = P.settings?.starts?.[w.shift];
  const dur = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; };
  shell(`<div class="card"><div class="who"><span class="av">${initials(w.name)}</span><div class="grow"><span class="hi">${greet}</span><b>${esc(w.name)}</b><span class="mono muted small">${esc(w.code)}</span></div></div>
      <div class="meta"><span class="chip"><span class="state ${open ? 'on' : ''}">${open ? t('onShift') : done ? t('finished') : t('notStarted')}</span></span><span class="chip">${ic('pin')}<span class="muted small">${t('site')}</span><b>${esc(P.site?.name || '—')}</b></span><span class="chip">${ic('shift')}<span class="muted small">${t('shift')}</span><b>${esc(w.shift)}${start ? ' · ' + start : ''}</b></span></div></div>
    <div class="punch"><button class="big ${open ? 'out' : 'in pulse'}" id="b-punch">${ic(open ? 'out' : 'in')}${open ? t('checkOut') : t('checkIn')}
        ${open ? `<span class="tm" id="timer">${dur(Date.now() - open.ts)}</span><small>${t('since')} ${hhmm(open.ts)}</small>` : `<small>${new Date().toLocaleDateString(LANG === 'en' ? 'en-GB' : LANG, { weekday: 'short', day: 'numeric', month: 'short' })}</small>`}</button>
      <div class="cap" id="cap"></div></div>
    <div class="mapcard" id="mapcard"><div id="map"></div><button id="b-exp" class="exp" aria-label="${t('expand')}" hidden>${ic('expand')}</button><button id="b-loc" class="loc" aria-label="my location" hidden>${ic('locate')}</button><button class="btn x" id="b-mapx">${ic('back')} ${t('close')}</button></div>
    <div id="gps"></div>
    <div id="qbar" class="q" hidden></div>
    <div class="card"><div class="lbl">${t('timeline')}</div>
      ${today.length ? `<ul class="list tl">${today.map(p => `<li class="${p.type}"><span class="tm">${hhmm(p.ts)}</span><span class="grow"><span class="what">${p.type === 'in' ? t('in') : t('out')}${p.hours ? ` · ${p.hours} ${t('hours')}` : ''}</span><span class="sub">${esc(p.siteName || '')}</span></span>${st(p)}</li>`).join('')}</ul>`
        : `<div class="empty">${ic('clock')}<span>${t('noPunch')}</span></div>`}</div>`, { tab: 'home' });
  $('#b-punch').onclick = () => { haptic(12); punch(open ? 'out' : 'in'); };
  if (open) W.tick = setInterval(() => { const el = $('#timer'); if (!el) return clearInterval(W.tick); el.textContent = dur(Date.now() - open.ts); }, 1000);
  const card = $('#mapcard');
  $('#b-exp').onclick = () => { card.classList.add('full'); setTimeout(() => W.map?.invalidateSize(), 60); };
  $('#b-mapx').onclick = () => { card.classList.remove('full'); setTimeout(() => W.map?.invalidateSize(), 60); };
  paintGps(); updateQueueBar(); drawMap();
}
async function drawMap() {
  const el = $('#map'); if (!el) return;
  try {
    const map = await LSMap.create(el, { zoom: 15, center: W.prof.site?.pins?.[0] ? [W.prof.site.pins[0].lat, W.prof.site.pins[0].lng] : undefined, zoomControl: false, animate: false, collapsed: true });
    if (!el.isConnected) { map.remove(); return; }                       // screen changed while the map loaded
    W.map = map;
    if ($('#b-exp')) $('#b-exp').hidden = false;
    const loc = $('#b-loc'); if (loc) { loc.hidden = false; loc.onclick = () => { if (W.gps) map.setView([W.gps.lat, W.gps.lng], Math.max(map.getZoom(), 17)); else toast(W.gpsErr || t('locating')); }; }
    W.layers = {};
    for (const s of W.prof.sites || []) for (const p of s.pins) LSMap.zone(W.map, p, { color: s.id === W.prof.site?.id ? '#1766CB' : '#93A0B5', label: s.name, fill: s.id === W.prof.site?.id ? .14 : .06 });
    paintGps();
  } catch (e) { el.closest('.mapcard').hidden = true; }
}

async function punch(type, forWorker) {
  if (W.busy) return; W.busy = true;
  try {
    const g = await freshFix();
    if (!g) { toast(W.gpsErr || t('noGps'), 4000); return; }
    const P = W.prof, who = forWorker || P.worker, z = zoneInfo();
    const photo = await takePhoto(() => [`${who.name} · ${who.code}`, `${new Date().toLocaleString('en-GB')} · ${type === 'in' ? 'CHECK IN' : 'CHECK OUT'}`, `${g.lat.toFixed(6)}, ${g.lng.toFixed(6)} ±${g.acc} m`, z ? `${z.site.name} · ${z.d} m` : (P?.site?.name || '')]);
    if (!photo) return;
    const body = { type, ts: Date.now(), lat: g.lat, lng: g.lng, acc: g.acc, photo, clientId: uuid(), deviceId: W.dev, ...(forWorker ? { code: forWorker.code } : {}) };
    showResult('send', null, photo);
    let r;
    try { r = forWorker ? await W.api.call('POST', 'supervisor/punch', body) : await W.api.call('POST', 'worker/punch', body, { token: W.token }); }
    catch (e) { await qPut({ clientId: body.clientId, body, sup: !!forWorker }); return showResult('queued', null, photo); }
    if (r.status === 401) { await qPut({ clientId: body.clientId, body }); return signOut(true); }
    if (r.status !== 200) return showResult('bad', r.body?.error, photo);
    showResult(r.body.punch.status === 'accepted' ? 'ok' : 'pend', r.body.punch.status === 'pending' ? r.body.punch.reasons.join(' · ') : (r.body.punch.reliever ? `${t('reliever')} ${r.body.punch.siteName}` : ''), photo);
    forWorker ? loadBoard(false) : refresh(false);
  } finally { W.busy = false; }
}
function showResult(kind, msg, photo) {
  const M = { send: ['q', '', t('sending'), ''], ok: ['ok', 'check', t('accepted'), ''], pend: ['pend', 'hour', t('pending'), t('pendingWhy')], queued: ['q', 'cloud', t('queued'), t('queuedWhy')], bad: ['bad', 'x', t('failed'), ''] }[kind];
  if (kind === 'ok') haptic([30, 50, 30]); else if (kind === 'bad') haptic([80, 50, 80]); else if (kind !== 'send') haptic(40);
  shell(`<div class="card res"><div class="ic ${M[0]}">${kind === 'send' ? '<div class="spin"></div>' : ic(M[1])}</div><h2>${M[2]}</h2><div class="when">${hhmm(Date.now())}</div><p class="muted">${esc(msg || M[3])}</p>${photo ? `<img src="${photo}" alt="">` : ''}
    ${kind === 'send' ? '' : `<button class="btn pri wide" id="b-done" style="margin-top:18px">${t('done')}</button>`}</div>`, { tabs: false });
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
  const all = [...Array(N)].map((_, i) => day(i + 1));
  const cnt = re => all.filter(c => re.test(c)).length;
  const cell = d => { const c = day(d); return `<div class="d ${esc(c)} ${`${ym}-${pad(d)}` === todayISO ? 'today' : ''}"><b>${d}</b>${esc(c)}</div>`; };
  shell(`<div class="seg">${months.slice(0, 3).map(x => `<button data-m="${x}" class="${x === ym ? 'on' : ''}">${new Date(+x.slice(0, 4), +x.slice(5) - 1, 1).toLocaleDateString(LANG === 'en' ? 'en-GB' : LANG, { month: 'short', year: 'numeric' })}</button>`).join('')}</div>
    <div class="tiles"><div class="tile P"><b>${cnt(/^(P|R)$/)}</b><span>${t('worked')}</span></div><div class="tile"><b>${cnt(/^(OFF|O)$/)}</b><span>${t('off')}</span></div><div class="tile A"><b>${cnt(/^A$/)}</b><span>${t('absent')}</span></div><div class="tile L"><b>${cnt(/^(AL|SL|EL|UL)$/)}</b><span>${t('leave')}</span></div></div>
    <div class="card"><div class="cal">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => `<div class="h">${d}</div>`).join('')}${'<div></div>'.repeat(first)}${[...Array(N)].map((_, i) => cell(i + 1)).join('')}</div>
      <div class="legend"><span><i style="background:var(--pos-bg);border:1px solid var(--pos-line)"></i>${t('worked')}</span><span><i style="background:var(--surface3)"></i>${t('off')}</span><span><i style="background:var(--neg-bg);border:1px solid var(--neg-line)"></i>${t('absent')}</span><span><i style="background:var(--warn-bg);border:1px solid var(--warn-line)"></i>${t('leave')}</span></div></div>
    <button class="btn wide" id="b-back">${ic('back')} ${t('back')}</button>`, { tab: 'month' });
  $$('[data-m]').forEach(b => b.onclick = () => { W.ym = b.dataset.m; renderMonth(); });
  $('#b-back').onclick = () => go('home');
}
function renderMore() {
  const P = W.prof, th = ls.get('ls.theme') || 'auto';
  shell(`<div class="card"><div class="who"><span class="av">${initials(P.worker.name)}</span><div class="grow"><b>${esc(P.worker.name)}</b><span class="mono muted small">${esc(P.worker.code)}</span></div></div></div>
    <div class="card" style="padding:4px 14px"><ul class="menu-list">
      <li><button id="m-lang">${ic('globe')}<span>${t('lang')}</span><span class="val">${esc(LANGS.find(l => l[0] === LANG)[1])}</span></button></li>
      <li><button id="m-theme">${ic('moon')}<span>${t('theme')}</span><span class="val">${t(th === 'dark' ? 'themeDark' : th === 'light' ? 'themeLight' : 'themeAuto')}</span></button></li>
      <li><button id="m-sup">${ic('users')}<span>${t('supervisor')}</span></button></li>
      <li><button id="m-out" class="danger">${ic('logout')}<span>${t('signout')}</span></button></li></ul></div>
    <p class="muted small" style="text-align:center">${t('appVer')} 2.0 · Latinem Securities</p>`, { tab: 'more' });
  $('#m-lang').onclick = () => $('#b-lang').click();
  $('#m-theme').onclick = () => menu([['auto', 'themeAuto'], ['light', 'themeLight'], ['dark', 'themeDark']].map(([k, l]) => [t(l), () => { ls.set('ls.theme', k === 'auto' ? null : k); applyTheme(); renderMore(); }, k === th]));
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
  shell(`<div class="card"><div class="row" style="margin-bottom:2px">${ic('users')}<h2 style="margin:0">${t('supervisor')}</h2></div>
    <div class="row"><div class="grow"><label class="fl" for="sp-site">${t('site')}</label><select class="f" id="sp-site"><option value="">${t('all')}</option>${B.sites.map(s => `<option value="${esc(s.id)}" ${s.id === W.supSite ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      <div><label class="fl" for="sp-date">${t('date')}</label><input class="f" type="date" id="sp-date" value="${esc(B.date)}" max="${esc(B.today)}"></div></div>
    <div class="chips">${[['all', t('all'), base.length], ['none', t('notIn'), n('none') + n('marked')], ['in', t('inNow'), n('in')], ['done', t('doneLbl'), n('done')]].map(([k, l, c]) => `<button data-f="${k}" class="${f === k ? 'on' : ''}">${l} <b>${c}</b></button>`).join('')}</div>
    <p class="muted small" style="margin:8px 2px 0">${n('in')} in · ${n('done')} ${t('doneLbl').toLowerCase()} · ${n('none')} ${t('noCheckIn')}${n('marked') ? ` · ${n('marked')} ${t('marked')}` : ''}</p>
    <div class="srch">${ic('search')}<input class="f" id="sp-q" placeholder="${t('search')}" value="${esc(W.supQ || '')}" autocomplete="off"></div></div>
    ${n('none') ? `<div class="q">${ic('info')}<span>${t('markHint')}</span></div>` : ''}
    <div class="card" style="padding:4px 14px"><ul class="list sup">${rows.sort((a, b) => ord[state(a)] - ord[state(b)]).map(w => { const s = state(w); return `<li><span class="av">${initials(w.name)}<i class="${s}"></i></span><span class="grow"><span class="what">${esc(w.name)}</span><span class="sub mono">${esc(w.code)} · ${esc(w.shift)}${w.punches.length ? ' · ' + w.punches.map(p => (p.type === 'in' ? '↘' : '↗') + hhmm(p.ts)).join(' ') : ''}</span></span>
      ${(s === 'none' || s === 'marked') || (isToday && s !== 'done') ? `<div class="acts">${s === 'none' || s === 'marked' ? `<select class="f" data-mk="${esc(w.code)}"><option value="">${s === 'marked' ? '✕ ' + t('clear') : t('markAs')}</option>${B.codes.map(([c, l]) => `<option value="${c}" ${w.mark?.mark === c ? 'selected' : ''}>${c} – ${esc(l)}</option>`).join('')}</select>` : ''}
      ${isToday && s !== 'done' ? `<button class="btn ${s === 'in' ? '' : 'pri'}" data-pw="${esc(w.code)}" data-t="${s === 'in' ? 'out' : 'in'}">${ic(s === 'in' ? 'out' : 'in')} ${s === 'in' ? t('checkOut') : t('checkIn')}</button>` : ''}</div>` : ''}</li>`; }).join('') || `<li><div class="empty grow">${ic('inbox')}<span>—</span></div></li>`}</ul></div>
    <div id="gps"></div><button class="btn wide" id="b-exit" style="margin-top:10px">${ic('back')} ${t('back')}</button>`, { tabs: false });
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
function signOut(expired) { W.token = null; W.prof = null; ss.set('ls.tok', null); W.sup = false; SCREEN = 'login'; if (expired === true) W.err = ''; render(); }

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
if (location.protocol === 'https:' && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
setLang(LANG); applyTheme();
try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme); } catch (e) { }
(async () => {
  if (W.token) { await refresh(); if (W.prof) { SCREEN = 'home'; startGps(); flushQueue(); } else { W.token = null; } }
  if (location.hash === '#sup') { history.replaceState(null, '', location.pathname + location.search); await openSupervisor(); return; }
  render(); document.body.dataset.ready = '1';
})();
setInterval(() => { if (W.prof && !W.sup && SCREEN === 'home' && !$('.cam') && !W.busy && !$('.mapcard.full')) refresh(); }, 120000);
