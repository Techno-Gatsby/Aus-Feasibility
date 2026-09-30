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
  else if (z?.inZone) el.innerHTML = `<span class="pill pos"><span class="dot"></span>${t('inZone')} · ${z.d} m ${t('from')} ${esc(z.site.name)} · ±${g.acc} m</span>${z.own ? '' : ` <span class="pill warn">${t('reliever')} ${esc(z.site.name)}</span>`}`;
  else el.innerHTML = `<span class="pill warn"><span class="dot"></span>${t('outZone')}${z ? ` · ${z.d} m ${t('from')} ${esc(z.site.name)}` : ''} · ±${g.acc} m</span>`;
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
    box.innerHTML = `<div class="hint">${t('takePhoto')}</div><video playsinline autoplay muted></video><div class="ctl"><button class="btn" data-x>${t('cancel')}</button><button class="shoot" data-s aria-label="shoot"></button><span style="flex:1"></span></div>`;
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
      box.innerHTML = `<img src="${url}" alt=""><div class="ctl"><button class="btn" data-r>${t('retake')}</button><button class="btn pri" data-u>${t('use')}</button></div>`;
      $('[data-r]', box).onclick = () => { box.remove(); takePhoto(caption).then(resolve); };
      $('[data-u]', box).onclick = () => { box.remove(); resolve(url); };
    }
  });
}

/* ---------- screens ---------- */
function shell(body) {
  try { W.map?.remove(); } catch (e) { } W.map = null; W.layers = null;                 // the old map's element is about to go
  $('#app').innerHTML = `<div class="bar"><span class="mark">LS</span><span class="t">${t('title')}<small>Latinem Securities</small></span><span class="sp"></span>
    <button id="b-lang" aria-label="${t('lang')}">${esc(LANGS.find(l => l[0] === LANG)[1])}</button>${W.prof || W.sup ? '<button id="b-menu" aria-label="menu">☰</button>' : ''}</div>
    ${W.api.demo ? `<div class="demo">${t('demo')}</div>` : ''}<main>${body}</main>`;
  $('#b-lang').onclick = () => menu(LANGS.map(([k, n]) => [n, () => { setLang(k); render(); }]));
  if ($('#b-menu')) $('#b-menu').onclick = () => menu([
    ...(W.prof ? [['🏠 ' + t('today'), () => go('home')], ['📅 ' + t('month'), () => go('month')]] : []),
    ['👷 ' + t('supervisor'), openSupervisor], ['⎋ ' + t('signout'), signOut]]);
}
function menu(items) {
  const m = document.createElement('div'); m.className = 'sheet-menu';
  m.innerHTML = `<div class="in">${items.map(([l], i) => `<button data-i="${i}">${esc(l)}</button>`).join('')}</div>`;
  m.onclick = e => { const b = e.target.closest('[data-i]'); m.remove(); if (b) items[+b.dataset.i][1](); };
  document.body.appendChild(m);
}
let SCREEN = 'login';
const go = s => { SCREEN = s; render(); };
function render() {
  if (W.sup) return renderSup();
  if (!W.token || !W.prof) return renderLogin();
  ({ home: renderHome, month: renderMonth }[SCREEN] || renderHome)();
}

function renderLogin() {
  const known = W.code;
  if (!known || W.editCode) {
    shell(`<div class="card"><h2>${t('signin')}</h2><label class="fl">${t('empId')}</label>
      <input class="f mono" id="code" placeholder="${t('empIdPh')}" value="${esc(known)}" autocapitalize="characters" autocomplete="username">
      <button class="btn pri wide" id="b-next" style="margin-top:12px">${t('next')}</button>
      ${W.api.demo ? `<button class="btn wide" id="b-demo" style="margin-top:10px">${t('loadDemo')}</button>` : ''}</div>`);
    $('#code').focus();
    const nx = () => { const c = $('#code').value.trim().toUpperCase(); if (!c) return; W.code = c; ls.set('ls.code', c); W.editCode = false; W.pin = ''; render(); };
    $('#b-next').onclick = nx; $('#code').onkeydown = e => e.key === 'Enter' && nx();
    if ($('#b-demo')) $('#b-demo').onclick = loadDemo;
    return;
  }
  shell(`<div class="card" style="text-align:center"><div class="lbl">${t('empId')}</div><div class="mono" style="font-size:22px;font-weight:700;color:var(--heading)">${esc(known)}</div>
    <button class="btn" id="b-not" style="margin-top:6px;padding:4px 10px;font-size:13px">${t('notYou')}</button>
    <p class="muted" style="margin:14px 0 0">${t('enterPin')}</p><div class="dots">${[0, 1, 2, 3].map(i => `<i class="${i < W.pin.length ? 'on' : ''}"></i>`).join('')}</div>
    <div class="err" id="err">${esc(W.err || '')}</div>
    <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join('')}<button class="fn" data-k="c">✕</button><button data-k="0">0</button><button class="fn" data-k="b">⌫</button></div></div>`);
  $('#b-not').onclick = () => { W.editCode = true; W.err = ''; ls.set('ls.code', null); W.code = ''; render(); };
  $$('.pad button').forEach(b => b.onclick = () => key(b.dataset.k));
  document.onkeydown = e => { if (SCREEN === 'login' && /^[0-9]$/.test(e.key)) key(e.key); if (e.key === 'Backspace') key('b'); };
  async function key(k) {
    if (W.busy) return;
    if (k === 'c') W.pin = ''; else if (k === 'b') W.pin = W.pin.slice(0, -1); else if (W.pin.length < 4) W.pin += k;
    W.err = ''; render();
    if (W.pin.length === 4) {
      W.busy = true;
      try {
        const r = await W.api.call('POST', 'worker/login', { code: W.code, pin: W.pin, deviceId: W.dev });
        W.pin = '';
        if (r.status !== 200) { W.err = r.body?.code === 'BAD_PIN' ? t('wrongPin') : r.body?.error || t('failed'); }
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
async function updateQueueBar() { const el = $('#qbar'); if (!el) return; const n = (await qAll()).length; el.hidden = !n; el.innerHTML = `☁ ${n} ${t('waiting')}`; }

function renderHome() {
  const P = W.prof, w = P.worker, open = P.open;
  const today = P.punches.filter(p => p.workDate === P.today || (open && p.id === open.id) || (open && p.inId === open.id));
  const hrs = open ? ((Date.now() - open.ts) / 3600000).toFixed(1) : null;
  const st = p => p.status === 'accepted' ? `<span class="pill pos">${t('statusAccepted')}</span>` : p.status === 'pending' ? `<span class="pill warn">${t('statusPending')}</span>` : `<span class="pill neg">${t('statusRejected')}</span>`;
  shell(`<div class="card"><div class="who"><span class="av">${esc(w.name.split(' ').map(x => x[0]).slice(0, 2).join(''))}</span><div class="grow"><b>${esc(w.name)}</b><span class="mono muted small">${esc(w.code)}</span></div></div>
      <div class="kv"><span>${t('site')}</span><b>${esc(P.site?.name || '—')}</b><span>${t('shift')}</span><b>${esc(w.shift)}${P.settings?.starts?.[w.shift] ? ' · ' + P.settings.starts[w.shift] : ''}</b></div>
      <div id="map"></div><div id="gps"></div></div>
    <div id="qbar" class="q" hidden></div>
    <button class="big ${open ? 'out' : 'in'}" id="b-punch">${open ? t('checkOut') : t('checkIn')}<small>${open ? `${t('since')} ${hhmm(open.ts)} · ${hrs} ${t('hours')}` : new Date().toLocaleDateString(LANG === 'en' ? 'en-GB' : LANG, { weekday: 'long', day: 'numeric', month: 'long' })}</small></button>
    <div class="card" style="margin-top:12px"><div class="lbl">${t('today')}</div>
      ${today.length ? `<ul class="list">${today.map(p => `<li><span class="tm">${hhmm(p.ts)}</span><span class="grow">${p.type === 'in' ? t('in') : t('out')} · ${esc(p.siteName || '')}${p.hours ? ` · ${p.hours} ${t('hours')}` : ''}</span>${st(p)}</li>`).join('')}</ul>` : `<p class="muted" style="margin:0">${t('noPunch')}</p>`}</div>`);
  $('#b-punch').onclick = () => punch(open ? 'out' : 'in');
  paintGps(); updateQueueBar(); drawMap();
}
async function drawMap() {
  const el = $('#map'); if (!el) return;
  try {
    const map = await LSMap.create(el, { zoom: 15, center: W.prof.site?.pins?.[0] ? [W.prof.site.pins[0].lat, W.prof.site.pins[0].lng] : undefined, zoomControl: false, animate: false });
    if (!el.isConnected) { map.remove(); return; }                       // screen changed while the map loaded
    W.map = map;
    W.layers = {};
    for (const s of W.prof.sites || []) for (const p of s.pins) LSMap.zone(W.map, p, { color: s.id === W.prof.site?.id ? '#1766CB' : '#93A0B5', label: s.name, fill: s.id === W.prof.site?.id ? .14 : .06 });
    paintGps();
  } catch (e) { el.hidden = true; }
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
  const M = { send: ['q', '…', t('sending'), ''], ok: ['ok', '✓', t('accepted'), ''], pend: ['pend', '⏳', t('pending'), t('pendingWhy')], queued: ['q', '☁', t('queued'), t('queuedWhy')], bad: ['bad', '✕', t('failed'), ''] }[kind];
  shell(`<div class="card res"><div class="ic ${M[0]}">${M[1]}</div><h2>${M[2]}</h2><p class="muted">${esc(msg || M[3])}</p><p class="mono muted">${hhmm(Date.now())}</p>${photo ? `<img src="${photo}" alt="">` : ''}
    ${kind === 'send' ? '' : `<button class="btn pri wide" id="b-done" style="margin-top:16px">${t('done')}</button>`}</div>`);
  if ($('#b-done')) $('#b-done').onclick = () => W.sup ? renderSup() : go('home');
}

function renderMonth() {
  const P = W.prof, now = new Date(), cur = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const months = [...new Set([...Object.keys(P.months || {}), cur])].sort().reverse();
  const ym = W.ym && months.includes(W.ym) ? W.ym : months[0];
  const codes = (P.months || {})[ym] || [], [y, m] = ym.split('-').map(Number), N = new Date(y, m, 0).getDate(), first = new Date(y, m - 1, 1).getDay();
  const todayISO = `${cur}-${pad(now.getDate())}`;
  const live = new Map(P.punches.filter(p => p.type === 'in' && p.status !== 'rejected' && p.workDate.startsWith(ym)).map(p => [+p.workDate.slice(8), p.status === 'accepted' ? 'P' : '…']));
  const cell = d => { const c = codes[d - 1] || live.get(d) || ''; return `<div class="d ${esc(c)} ${`${ym}-${pad(d)}` === todayISO ? 'today' : ''}"><b>${d}</b>${esc(c)}</div>`; };
  const worked = [...Array(N)].map((_, i) => codes[i] || live.get(i + 1)).filter(c => c === 'P' || c === 'R').length;
  shell(`<div class="card"><div class="tabs">${months.slice(0, 3).map(x => `<button data-m="${x}" class="${x === ym ? 'on' : ''}">${new Date(+x.slice(0, 4), +x.slice(5) - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</button>`).join('')}</div>
    <div class="row"><b style="font-size:26px;color:var(--heading)" class="mono">${worked}</b><span class="muted">${t('days')}</span></div>
    <div class="cal">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => `<div class="h">${d}</div>`).join('')}${'<div></div>'.repeat(first)}${[...Array(N)].map((_, i) => cell(i + 1)).join('')}</div></div>
    <button class="btn wide" id="b-back">${t('back')}</button>`);
  $$('[data-m]').forEach(b => b.onclick = () => { W.ym = b.dataset.m; renderMonth(); });
  $('#b-back').onclick = () => go('home');
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
  const rows = B.workers.filter(w => !W.supSite || w.siteId === W.supSite);
  const state = w => { const ins = w.punches.filter(p => p.type === 'in'), outs = w.punches.filter(p => p.type === 'out'); return ins.length > outs.length ? 'in' : ins.length ? 'done' : w.mark?.mark ? 'marked' : 'none'; };
  const n = k => rows.filter(w => state(w) === k).length;
  shell(`<div class="card"><h2>${t('supervisor')}</h2>
    <div class="row"><div class="grow"><label class="fl">${t('site')}</label><select class="f" id="sp-site"><option value="">All</option>${B.sites.map(s => `<option value="${esc(s.id)}" ${s.id === W.supSite ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      <div><label class="fl">${t('date')}</label><input class="f" type="date" id="sp-date" value="${esc(B.date)}" max="${esc(B.today)}"></div></div>
    <div class="row" style="margin-top:10px"><span class="pill pos">${n('in')} in</span><span class="pill">${n('done')} done</span><span class="pill warn">${n('none')} ${t('noCheckIn')}</span>${n('marked') ? `<span class="pill">${n('marked')} ${t('marked')}</span>` : ''}</div></div>
    ${n('none') ? `<div class="q">${t('markHint')}</div>` : ''}
    <div class="card"><ul class="list">${rows.sort((a, b) => ({ none: 0, marked: 1, in: 2, done: 3 }[state(a)] - { none: 0, marked: 1, in: 2, done: 3 }[state(b)])).map(w => { const s = state(w); return `<li style="flex-wrap:wrap"><span class="grow" style="min-width:150px"><b style="color:var(--heading)">${esc(w.name)}</b><br><span class="mono muted small">${esc(w.code)} · ${esc(w.shift)}${w.punches.length ? ' · ' + w.punches.map(p => (p.type === 'in' ? '↘' : '↗') + hhmm(p.ts)).join(' ') : ''}</span></span>
      ${s === 'none' || s === 'marked' ? `<select class="f" data-mk="${esc(w.code)}" style="width:auto;padding:6px 8px;font-size:14px"><option value="">${s === 'marked' ? '✕ ' + t('clear') : t('markAs')}</option>${B.codes.map(([c, l]) => `<option value="${c}" ${w.mark?.mark === c ? 'selected' : ''}>${c} – ${esc(l)}</option>`).join('')}</select>` : ''}
      ${isToday && s !== 'done' ? `<button class="btn" data-pw="${esc(w.code)}" data-t="${s === 'in' ? 'out' : 'in'}" style="padding:6px 10px">${s === 'in' ? t('checkOut') : t('checkIn')}</button>` : ''}</li>`; }).join('') || '<li class="muted">—</li>'}</ul></div>
    <div id="gps"></div><button class="btn wide" id="b-exit" style="margin-top:10px">${t('back')}</button>`);
  $('#sp-site').onchange = e => { W.supSite = e.target.value; loadBoard(); };
  $('#sp-date').onchange = e => { W.supDate = e.target.value; loadBoard(); };
  $$('[data-pw]').forEach(b => b.onclick = () => { const w = B.workers.find(x => x.code === b.dataset.pw); punch(b.dataset.t, w); });
  $$('[data-mk]').forEach(sel => sel.onchange = async () => {
    const r = await W.api.call('POST', 'supervisor/mark', { code: sel.dataset.mk, date: B.date, mark: sel.value }).catch(() => null);
    if (r?.status === 200) { toast(sel.value ? `${sel.dataset.mk} → ${sel.value}` : t('clear')); loadBoard(); } else toast(r?.body?.error || 'No connection');
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
setLang(LANG);
(async () => {
  if (W.token) { await refresh(); if (W.prof) { SCREEN = 'home'; startGps(); flushQueue(); } else { W.token = null; } }
  if (location.hash === '#sup') { history.replaceState(null, '', location.pathname + location.search); await openSupervisor(); return; }
  render(); document.body.dataset.ready = '1';
})();
setInterval(() => { if (W.prof && !W.sup && SCREEN === 'home' && !$('.cam') && !W.busy) refresh(); }, 120000);
