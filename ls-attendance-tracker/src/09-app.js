/* =====================================================================
   Worker app (admin side): publish roster, sync punches and supervisor
   day marks, no-check-in decisions, review, punch details (coordinates, distance, photos, map),
   PINs and PIN slips, settings.
   ===================================================================== */
const APP_DEF = { api: '', workerUrl: '', radius: 100, maxAcc: 50, windowMin: 60, lateMin: 15, photo: true, bindDevice: true, starts: { DAY: '07:00', NIGHT: '19:00' }, arcgisKey: '', lastSync: 0, lastMarkSync: 0, lastPublish: 0 };
function appCfg() { S.app ||= {}; for (const k in APP_DEF) if (!(k in S.app)) S.app[k] = typeof APP_DEF[k] === 'object' ? { ...APP_DEF[k] } : APP_DEF[k]; return S.app; }   // defaults filled in place
const apiBase = () => appCfg().api || (location.protocol.startsWith('http') ? '/api' : '');   // hosted → same-site /api; opened as a file → demo
const appClient = () => LSClient.make({ base: apiBase(), role: 'admin' });
const appOn = e => !!e.app?.on;
const appCode = e => e.empCode || e.app?.appId || '';

/* ---------- punch index: `${empId}|${date}` → punches, rebuilt when data changes ---------- */
let PIX = { v: -1, m: new Map() };
function punchIx() {
  if (PIX.v === DATA_VER) return PIX.m;
  const m = new Map();
  for (const p of Object.values(S.punches || {})) { const k = p.wid + '|' + p.workDate; (m.get(k) || m.set(k, []).get(k)).push(p); }
  for (const l of m.values()) l.sort((a, b) => a.ts - b.ts);
  PIX = { v: DATA_VER, m }; return m;
}
const punchesFor = (empId, d) => punchIx().get(empId + '|' + d) || [];
const pendingPunches = () => Object.values(S.punches || {}).filter(p => p.status === 'pending').sort((a, b) => b.ts - a.ts);
/** App workers with no check-in, no supervisor mark and no code on a date: the admin decides what the day is */
function noCheckIn(d) {
  const out = [];
  for (const e of S.employees) {
    if (!appOn(e) || !employedOn(e, d) || !assignOn(e, d)?.site) continue;
    if (getCell(e.id, d) || punchesFor(e.id, d).some(p => p.type === 'in' && p.status !== 'rejected')) continue;
    out.push(e);
  }
  return out;
}
const noCheckInToday = () => { const y = addDays(todayISO(), -1); return noCheckIn(y).length; };   // yesterday: today's shift may still start

/* ---------- publish roster ---------- */
async function publishRoster(quiet) {
  const c = appCfg(), today = todayISO(), cur = ymOf(today), prev = addMonths(cur, -1);
  const ws = [];
  for (const e of S.employees) {
    if (!appOn(e)) continue;
    const a = assignOn(e, today);
    const months = {}; for (const ym of [prev, cur]) months[ym] = monthDates(ym).map(d => employedOn(e, d) ? (getCell(e.id, d)?.c || '') : '');
    ws.push({ id: e.id, code: appCode(e), name: e.name, trade: e.trade || '', shift: a?.shift || e.shift || 'DAY', siteId: a?.site || '', enabled: employedOn(e, today), pinHash: e.app.pinNew ? e.app.pinHash : '', pinSalt: e.app.pinNew ? e.app.pinSalt : '', resetDevice: !!e.app.resetDevice, months });
  }
  const used = new Set(ws.map(w => w.siteId));
  const sites = S.sites.filter(s => s.pins?.length || used.has(s.id)).map(s => ({ id: s.id, name: s.name, project: projOfSite(s.id)?.name || '', pins: s.pins || [] }));
  const settings = { radius: c.radius, maxAcc: c.maxAcc, windowMin: c.windowMin, lateMin: c.lateMin, photo: c.photo, bindDevice: c.bindDevice, starts: c.starts, shiftHours: +S.settings.shiftHours || 12 };
  const r = await appClient().call('PUT', 'admin/roster', { workers: ws, sites, settings, full: true });
  if (r.status !== 200) { toast('Publish failed: ' + (r.body?.error || r.status), 6000); return false; }
  for (const e of S.employees) if (e.app) { delete e.app.pinNew; delete e.app.resetDevice; }
  c.lastPublish = Date.now(); markDirty();
  if (!quiet) toast(`Published ${ws.length} worker(s), ${sites.length} site(s)`);
  return true;
}

/* ---------- sync punches + supervisor day marks ---------- */
function applyPunch(p, stats) {
  if (p.type !== 'in') return;
  const e = IX.emp.get(p.wid); if (!e) { stats.unknown++; return; }
  const d = p.workDate, cur = getCell(e.id, d);
  if (isLocked(d)) { stats.locked++; return; }
  if (p.status === 'accepted') {
    const code = p.reliever ? 'R' : 'P';
    if (cur && !['P', 'R'].includes(cur.c) && !p.applied) { stats.conflicts.push(`${e.name} ${fmtDMY(d)}: ${cur.c} kept (app says ${code})`); return; }
    const a = assignOn(e, d);
    putCell(e.id, d, { c: code, s: p.siteId && p.siteId !== a?.site && IX.site.has(p.siteId) ? p.siteId : cur?.s, sh: cur?.sh || (p.shift && p.shift !== (a?.shift || e.shift) ? p.shift : undefined), n: cur?.n });
    p.applied = true; stats.applied++;
  } else if (p.status === 'rejected' && p.applied) {
    if (cur && ['P', 'R'].includes(cur.c)) putCell(e.id, d, null);
    p.applied = false; stats.removed++;
  }
}
let SYNCING = false;
async function syncApp(quiet) {
  if (SYNCING) return; SYNCING = true;
  const c = appCfg(), cl = appClient(), stats = { new: 0, applied: 0, removed: 0, locked: 0, unknown: 0, marks: 0, conflicts: [] };
  try {
    const r = await cl.call('GET', 'admin/punches', null, { query: { since: c.lastSync || 0 } });
    if (r.status !== 200) { if (!quiet) toast('Sync failed: ' + (r.body?.error || r.status), 6000); return; }
    S.punches ||= {};
    for (const p of r.body.punches) { const old = S.punches[p.id]; if (!old) stats.new++; S.punches[p.id] = { ...p, applied: old?.applied || false }; applyPunch(S.punches[p.id], stats); }
    c.lastSync = r.body.now;
    const mk = await cl.call('GET', 'admin/marks', null, { query: { since: c.lastMarkSync || 0 } });
    if (mk.status === 200) { S.marks ||= {}; for (const x of mk.body.marks) { S.marks[x.id] = x; applyMark(x, stats); } c.lastMarkSync = mk.body.now; }
    reindex(); markDirty();
    if (!quiet || stats.new) { renderAll(); if (!quiet) toast(`Synced · ${stats.new} new punch(es) · ${stats.applied} day(s) marked${stats.marks ? ` · ${stats.marks} supervisor mark(s)` : ''}${stats.conflicts.length ? ` · ${stats.conflicts.length} kept (leave/other code)` : ''}${stats.locked ? ` · ${stats.locked} in locked month` : ''}`, 5000); }
    S.issues ||= {}; if (stats.conflicts.length) S.issues.app = stats.conflicts.slice(0, 500);
  } catch (e) { if (!quiet) toast('Sync failed – ' + e.message, 6000); }
  finally { SYNCING = false; }
}
setInterval(() => { if (S && Object.values(S.employees || []).some(appOn)) syncApp(true); }, 5 * 60000);

async function reviewPunch(id, status, note) {
  const r = await appClient().call('POST', 'admin/review', { id, status, note: note || '' });
  if (r.status !== 200) return toast('Review failed: ' + (r.body?.error || r.status), 5000);
  const p = S.punches[id]; Object.assign(p, r.body.punch, { applied: p.applied });
  const st = { applied: 0, removed: 0, locked: 0, unknown: 0, conflicts: [] }; applyPunch(p, st);
  if (st.locked) toast('Month is locked – attendance not changed', 5000);
  reindex(); markDirty();
}
/** A supervisor's decision for a day with no check-in. An app check-in or a code typed in the tracker wins. */
function applyMark(m, stats) {
  const e = IX.emp.get(m.wid); if (!e) { stats.unknown++; return; }
  if (isLocked(m.date)) { stats.locked++; return; }
  if (punchesFor(e.id, m.date).some(p => p.type === 'in' && p.status === 'accepted')) return;
  const cur = getCell(e.id, m.date);
  if (cur && !cur.mk) { if (cur.c !== m.mark) stats.conflicts.push(`${e.name} ${fmtDMY(m.date)}: ${cur.c} kept (supervisor said ${m.mark || 'clear'})`); return; }
  if (!m.mark) { if (cur?.mk) putCell(e.id, m.date, null); return; }
  ensureCode(m.mark); putCell(e.id, m.date, { c: m.mark, s: cur?.s, sh: cur?.sh, mk: m.by || 'supervisor' }); stats.marks++;
}
/** Admin decides a no-check-in day in the tracker (same effect as a supervisor mark) */
function decideDay(emps, d, code) {
  let n = 0, lock = 0;
  for (const e of emps) { if (isLocked(d)) { lock++; continue; } if (!code) { putCell(e.id, d, null); continue; } ensureCode(code); putCell(e.id, d, { c: code, mk: 'admin' }); n++; }
  reindex(); markDirty(); if (lock) toast('Month is locked – nothing changed', 5000); else toast(`${n} day(s) marked ${code}`);
}

/* ---------- PINs ---------- */
const newPin = () => { let p; do { p = String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0'); } while (/^(\d)\1{3}$|^(0123|1234|2345|3456|4567|5678|6789|9876|4321)$/.test(p)); return p; };
async function givePins(emps) {
  const slips = [];
  let next = Math.max(10000, ...S.employees.map(e => +String(e.app?.appId || '').replace(/\D/g, '') || 0)) + 1;
  for (const e of emps) {
    const pin = newPin(), h = await LSAPI.hashPin(pin);
    e.app = { ...(e.app || {}), on: true, pinHash: h.hash, pinSalt: h.salt, pinNew: true, pinAt: todayISO() };
    if (!e.empCode && !e.app.appId) e.app.appId = 'LS' + next++;
    slips.push({ e, pin });
  }
  markDirty(); return slips;
}
async function printSlips(slips) {
  const url = appCfg().workerUrl || (location.protocol.startsWith('http') ? location.origin + '/worker' : '');
  let qr = null; if (url) { try { await loadScript('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js'); const q = qrcode(0, 'M'); q.addData(url); q.make(); qr = q.createDataURL(3, 2); } catch (e) { } }
  printHTML(`<div class="sheet port slips">${slips.map(({ e, pin }) => `<div class="slip"><div class="sh"><img src="${LOGO}" alt=""><b>Worker Attendance</b></div>
    <table><tr><td>Name</td><td><b>${esc(e.name)}</b></td></tr><tr><td>Employee ID</td><td class="mono"><b>${esc(appCode(e))}</b></td></tr><tr><td>PIN</td><td class="mono pin">${pin}</td></tr><tr><td>Site</td><td>${esc(siteName(assignOn(e, todayISO())?.site))}</td></tr></table>
    ${url ? `<div class="u">${qr ? `<img src="${qr}" alt="">` : ''}<span>${esc(url)}</span></div>` : ''}<p>Keep your PIN private. Mark check-in and check-out at your site with a photo.</p></div>`).join('')}</div>`);
}
async function appAccessBulk(emps) {
  if (!emps.length) return toast('Tick workers first');
  openModal(`App access for ${emps.length} worker(s)`, `<p style="margin-top:0">Enable the worker app, generate a new 4-digit PIN for each and print PIN slips. Old PINs stop working after <b>Publish roster</b>.</p>
    <label class="chk"><input type="checkbox" id="aa-dev"> Also reset the registered phone</label>`,
    [{ label: 'Disable app', cls: 'bad', onClick: () => { emps.forEach(e => { e.app = { ...(e.app || {}), on: false }; }); markDirty(); renderAll(); toast('App disabled – publish roster to apply'); } },
    { label: 'Cancel' }, { label: 'Enable + PINs + print', cls: 'pri', onClick: async m => { const dev = $('#aa-dev', m).checked; const s = await givePins(emps); if (dev) emps.forEach(e => e.app.resetDevice = true); renderAll(); await printSlips(s); } }]);
}

/* ---------- punch details (right-click a day) ---------- */
async function punchDetails(emp, d) {
  const ps = punchesFor(emp.id, d); const c = getCell(emp.id, d);
  const statusPill = p => `<span class="pill ${p.status === 'accepted' ? 'pos' : p.status === 'pending' ? 'warn' : 'neg'}">${p.status}</span>`;
  const t = ts => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const m = openModal(`${emp.name} · ${fmtDMY(d)}`, `
    <div class="row" style="margin-bottom:8px"><span class="mono muted">${esc(empCodeLabel(emp))}</span><span class="pill">${c ? esc(c.c) : 'blank'}</span><span class="muted">${esc(siteName(siteOn(emp, d)))} · ${esc(shiftOn(emp, d))}</span></div>
    ${ps.length ? `<div class="split" style="grid-template-columns:1fr 1fr">
      <div>${ps.map(p => `<div class="comp"><div class="ch"><b>${p.type === 'in' ? 'Check-in' : 'Check-out'} ${t(p.ts)}</b>${statusPill(p)}${p.hours ? `<span class="muted">${p.hours} h</span>` : ''}</div>
        <div class="cb" style="padding:8px 10px"><div class="row" style="align-items:flex-start;gap:10px">
          <div data-ph="${p.id}" class="ph">${p.hasPhoto ? 'loading photo…' : 'no photo'}</div>
          <table class="kvt"><tbody>
            <tr><td>Location</td><td class="mono">${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}</td></tr>
            <tr><td>Accuracy</td><td>±${p.acc} m</td></tr>
            <tr><td>Site</td><td>${esc(p.siteName || '—')}${p.reliever ? ' <span class="pill warn">reliever</span>' : ''}</td></tr>
            <tr><td>Distance</td><td>${p.dist != null ? `${p.dist} m from pin · zone ${p.radius} m · ${p.inZone ? '<b style="color:var(--pos)">inside</b>' : '<b style="color:var(--neg)">outside</b>'}` : '—'}</td></tr>
            ${p.reasons?.length ? `<tr><td>Review</td><td style="color:var(--warn)">${esc(p.reasons.join(' · '))}</td></tr>` : ''}
            ${p.flags?.length ? `<tr><td>Flags</td><td>${esc(p.flags.join(' · '))}</td></tr>` : ''}
            <tr><td>By</td><td>${esc(p.by)}${p.reviewBy ? ` · reviewed by ${esc(p.reviewBy)}${p.reviewNote ? ': ' + esc(p.reviewNote) : ''}` : ''}</td></tr>
          </tbody></table></div>
          <div class="row" style="margin-top:6px"><a href="https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=18/${p.lat}/${p.lng}" target="_blank" rel="noopener">Open in map</a><span class="spacer"></span>
          ${p.status !== 'accepted' ? `<button class="btn sm pri" data-ok="${p.id}">Approve</button>` : ''}${p.status !== 'rejected' ? `<button class="btn sm bad" data-no="${p.id}">Reject</button>` : ''}</div></div></div>`).join('')}</div>
      <div><div id="pd-map" style="height:360px;border:1px solid var(--line2);border-radius:5px"></div></div></div>`
    : '<p class="muted">No app punches for this day. The code was entered in the tracker or imported from Excel.</p>'}`,
    [{ label: 'Close', cls: 'pri' }], { width: 'min(1000px,100%)' });
  const cl = appClient();
  for (const p of ps) if (p.hasPhoto) cl.call('GET', 'admin/photo', null, { query: { id: p.id } }).then(r => { const el = m.querySelector(`[data-ph="${p.id}"]`); if (!el) return; if (r.blob) { const u = URL.createObjectURL(r.blob); el.innerHTML = `<a href="${u}" target="_blank"><img src="${u}" alt="photo"></a>`; } else el.textContent = 'photo not available'; }).catch(() => { });
  m.querySelectorAll('[data-ok],[data-no]').forEach(b => b.onclick = async () => {
    const id = b.dataset.ok || b.dataset.no, ok = !!b.dataset.ok;
    const note = ok ? '' : (prompt('Reason for rejecting (shown to the admin team):') ?? null); if (note === null) return;
    await reviewPunch(id, ok ? 'accepted' : 'rejected', note); closeModal(); renderAll(); punchDetails(emp, d);
  });
  if (ps.length) try {
    const map = await LSMap.create($('#pd-map', m), { center: [ps[0].lat, ps[0].lng], zoom: 17, satellite: true });
    const b = window.L.latLngBounds([]);
    for (const s of new Set(ps.map(p => p.siteId).concat(siteOn(emp, d) || []))) for (const pin of IX.site.get(s)?.pins || []) { LSMap.zone(map, pin, { label: siteName(s) }); b.extend([pin.lat, pin.lng]); }
    for (const p of ps) { window.L.circle([p.lat, p.lng], { radius: p.acc, color: '#E0762F', weight: 1, fillOpacity: .1 }).addTo(map); window.L.circleMarker([p.lat, p.lng], { radius: 7, color: '#fff', weight: 2, fillColor: p.type === 'in' ? '#E0762F' : '#5B4AB8', fillOpacity: 1 }).bindTooltip(`${p.type === 'in' ? 'In' : 'Out'} ${t(p.ts)}`, { permanent: true, direction: 'right' }).addTo(map); b.extend([p.lat, p.lng]); }
    map.fitBounds(b.pad(0.4), { maxZoom: 18 });
  } catch (e) { $('#pd-map', m).innerHTML = `<div class="empty" style="height:100%">${esc(e.message)}</div>`; }
}

/* ---------- the Worker app document ---------- */
const AP = { date: '' };
function renderApp() {
  const v = $('#v-app'), c = appCfg(), cl = appClient();
  const on = S.employees.filter(appOn), pins = S.sites.filter(s => s.pins?.length), pend = pendingPunches();
  AP.date ||= addDays(todayISO(), -1); const miss = noCheckIn(AP.date);
  const today = todayISO(), todays = Object.values(S.punches || {}).filter(p => p.workDate === today);
  const t = ts => ts ? new Date(ts).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never';
  const bySite = new Map(); for (const p of todays) { const k = p.siteName || '—'; const x = bySite.get(k) || bySite.set(k, { in: new Set(), out: new Set() }).get(k); (p.type === 'in' ? x.in : x.out).add(p.wid); }
  v.innerHTML = docHead('Worker app', cl.demo ? '<span class="pill warn">demo – data in this browser only</span>' : `connected to <span class="mono">${esc(apiBase())}</span>`, `<a class="btn sm" href="${location.protocol.startsWith('http') ? '/worker/' : 'Worker Attendance.html'}" target="_blank">Open worker page ↗</a>`) + `<div class="dc">
    <div class="kpis">${[['Workers on the app', on.length], ['Sites with a location', `${pins.length}<small>/ ${S.sites.length}</small>`], ['Punches to review', pend.length, pend.length ? 'var(--warn)' : ''], ['No check-in ' + fmtDMY(AP.date).slice(0, 5), miss.length, miss.length ? 'var(--warn)' : ''], ['Last sync', `<span style="font-size:13px">${t(c.lastSync)}</span>`], ['Roster published', `<span style="font-size:13px">${t(c.lastPublish)}</span>`]].map(([k, x, col]) => `<div class="kpi" ${col ? `style="--c:${col}"` : ''}><div class="l">${k}</div><div class="v">${x}</div></div>`).join('')}</div>
    ${!on.length ? `<div class="note">Start here: <b>1</b> set each site's location in Projects &amp; sites → Edit site. <b>2</b> In Employees tick workers → toolbar <b>App access…</b> to give PINs and print slips. <b>3</b> <b>Publish roster</b>. Workers then check in on the worker page; <b>Sync</b> marks P in Attendance. Days without a check-in are decided here or by supervisors on their phone.</div>` : ''}
    ${sec('ap-rev', `Punches to review <span class="pill ${pend.length ? 'warn' : ''}">${pend.length}</span>`, pend.length ? `<div class="tw" style="max-height:420px"><table><thead><tr><th>Worker</th><th>Date</th><th>Time</th><th>Type</th><th>Site</th><th>Why</th><th></th></tr></thead><tbody>
      ${pend.map(p => `<tr><td><a href="#" data-pd="${p.id}">${esc(p.name)}</a> <span class="mono muted">${esc(p.code)}</span></td><td class="mono">${fmtDMY(p.workDate)}</td><td class="mono">${new Date(p.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td><td>${p.type}</td><td>${esc(p.siteName || '—')}</td><td style="white-space:normal;color:var(--warn)">${esc(p.reasons.join(' · '))}</td>
        <td style="white-space:nowrap"><button class="btn sm" data-pd="${p.id}">Details</button> <button class="btn sm pri" data-ok="${p.id}">Approve</button> <button class="btn sm bad" data-no="${p.id}">Reject</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted" style="margin:0">Nothing to review.</p>')}
    ${sec('ap-today', `Today on site <span class="cnt">${fmtDMY(today)}</span>`, bySite.size ? `<div class="tw"><table><thead><tr><th>Site</th><th class="num">Checked in</th><th class="num">Checked out</th><th class="num">On site now</th></tr></thead><tbody>${[...bySite].map(([k, x]) => `<tr><td>${esc(k)}</td><td class="num">${x.in.size}</td><td class="num">${x.out.size}</td><td class="num"><b>${[...x.in].filter(w => !x.out.has(w)).length}</b></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted" style="margin:0">No punches synced for today yet.</p>')}
    ${sec('ap-miss', `No check-in <span class="pill ${miss.length ? 'warn' : ''}">${miss.length}</span>`, `
      <div class="row" style="margin-bottom:8px"><label class="f" style="flex-direction:row;align-items:center;gap:6px">Date <input type="date" id="ap-date" value="${AP.date}" max="${todayISO()}"></label>
        <span class="muted small">App workers allocated to a site who did not check in and have no code yet. Decide what the day is; supervisors can do the same on their phone.</span></div>
      ${miss.length ? `<div class="row" style="margin-bottom:8px"><label class="chk"><input type="checkbox" id="ap-all"> all</label><span class="muted small">Mark ticked as</span><select id="ap-bulk"><option value="">— choose —</option>${S.codes.filter(x => !['R'].includes(x.code)).map(x => `<option value="${esc(x.code)}">${esc(x.code)} – ${esc(x.label)}</option>`).join('')}</select><button class="btn sm pri" id="ap-apply">Apply</button></div>
      <div class="tw" style="max-height:360px"><table><thead><tr><th></th><th>Worker</th><th>Emp ID</th><th>Site</th><th>Shift</th><th>Mark as</th></tr></thead><tbody>
      ${miss.map(e => { const a = assignOn(e, AP.date); return `<tr><td><input type="checkbox" data-mc="${e.id}"></td><td>${esc(e.name)}</td><td class="mono">${esc(appCode(e))}</td><td>${esc(siteName(a?.site))}</td><td>${esc(a?.shift || e.shift || '')}</td>
        <td><select data-m1="${e.id}"><option value="">—</option>${S.codes.filter(x => !['R'].includes(x.code)).map(x => `<option value="${esc(x.code)}">${esc(x.code)} – ${esc(x.label)}</option>`).join('')}</select></td></tr>`; }).join('')}</tbody></table></div>` : '<p class="muted" style="margin:0">Everyone on the app checked in or already has a code for this date.</p>'}`)}
    ${sec('ap-set', 'Settings', `<div class="form">
      <label class="f wide">Azure API address <span class="muted">(blank = demo in this browser; on Azure use /api)</span><input type="text" data-ap="api" value="${esc(c.api)}" placeholder="https://ls-attendance.azurestaticapps.net/api"></label>
      <label class="f wide">Worker page link (for PIN slips / QR)<input type="text" data-ap="workerUrl" value="${esc(c.workerUrl)}" placeholder="https://ls-attendance.azurestaticapps.net/worker"></label>
      <label class="f">Default zone radius (m)<input type="number" min="10" data-ap="radius" value="${c.radius}"></label>
      <label class="f">Max GPS accuracy (m)<input type="number" min="5" data-ap="maxAcc" value="${c.maxAcc}"></label>
      <label class="f">Check-in opens (min before start)<input type="number" min="0" data-ap="windowMin" value="${c.windowMin}"></label>
      <label class="f">Late after (min)<input type="number" min="0" data-ap="lateMin" value="${c.lateMin}"></label>
      <label class="f">Day shift starts<input type="text" data-st="DAY" value="${esc(c.starts.DAY)}"></label>
      <label class="f">Night shift starts<input type="text" data-st="NIGHT" value="${esc(c.starts.NIGHT)}"></label>
      <label class="f">Photo required<select data-ap="photo">${opts([['1', 'Yes'], ['0', 'No']], c.photo ? '1' : '0')}</select></label>
      <label class="f">One phone per worker<select data-ap="bindDevice">${opts([['1', 'Yes'], ['0', 'No']], c.bindDevice ? '1' : '0')}</select></label>
      <label class="f wide">ArcGIS API key <span class="muted">(optional – ArcGIS search; blank = free OpenStreetMap search)</span><input type="text" data-ap="arcgisKey" value="${esc(c.arcgisKey)}"></label>
    </div><p class="muted small" style="margin:8px 0 0">Zone rule: a punch is accepted when (distance to the pin − GPS accuracy) ≤ radius and accuracy ≤ the limit; otherwise it waits here for review. Changes apply to phones after <b>Publish roster</b>.</p>`)}
  </div>`;
  bindSecs(v);
  v.querySelectorAll('[data-pd]').forEach(b => b.onclick = e => { e.preventDefault(); const p = S.punches[b.dataset.pd]; const emp = IX.emp.get(p.wid); if (emp) punchDetails(emp, p.workDate); });
  v.querySelectorAll('[data-ok]').forEach(b => b.onclick = async () => { await reviewPunch(b.dataset.ok, 'accepted'); renderAll(); });
  v.querySelectorAll('[data-no]').forEach(b => b.onclick = async () => { const n = prompt('Reason for rejecting:'); if (n === null) return; await reviewPunch(b.dataset.no, 'rejected', n); renderAll(); });
  if ($('#ap-date')) $('#ap-date').onchange = e => { AP.date = e.target.value || AP.date; renderApp(); };
  if ($('#ap-all')) $('#ap-all').onchange = e => v.querySelectorAll('[data-mc]').forEach(c => c.checked = e.target.checked);
  if ($('#ap-apply')) $('#ap-apply').onclick = () => { const code = $('#ap-bulk').value, ids = [...v.querySelectorAll('[data-mc]:checked')].map(c => c.dataset.mc); if (!code || !ids.length) return toast('Tick workers and choose a code'); decideDay(ids.map(id => IX.emp.get(id)), AP.date, code); renderAll(); };
  v.querySelectorAll('[data-m1]').forEach(sel => sel.onchange = () => { if (sel.value) { decideDay([IX.emp.get(sel.dataset.m1)], AP.date, sel.value); renderAll(); } });
  v.querySelectorAll('[data-ap]').forEach(i => i.onchange = () => { const k = i.dataset.ap; c[k] = i.tagName === 'SELECT' ? i.value === '1' : i.type === 'number' ? +i.value : i.value.trim(); markDirty(); if (k === 'api') renderApp(); });
  v.querySelectorAll('[data-st]').forEach(i => i.onchange = () => { if (/^\d{1,2}:\d{2}$/.test(i.value)) { c.starts = { ...c.starts, [i.dataset.st]: i.value.padStart(5, '0') }; markDirty(); } else toast('Use HH:MM'); });
}
