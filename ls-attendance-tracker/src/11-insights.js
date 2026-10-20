/* =====================================================================
   Field operations: Live (today on a map) and Insights (trends over a
   date range): coverage, punctuality, zone compliance, pin check, routes,
   hotspots (where personnel spend most time), face check, unusual activity.
   Positions come from check-in / check-out punches plus the positions the
   phone records every 10 minutes while a shift is open.
   ===================================================================== */
/* ---------- shift positions, kept apart from the main data (can be large) ---------- */
const PINGS = {
  data: null,                                                // { wid: [[ts, lat, lng, acc], …] }
  async load() { if (this.data) return this.data; try { this.data = JSON.parse(await IDB.get('pings') || '{}'); } catch (e) { this.data = {}; } return this.data; },
  async add(list) {
    if (!list?.length) return; const d = await this.load(), keep = Date.now() - 62 * 86400000;
    for (const x of list) { const a = d[x.wid] ||= []; if (!a.some(y => y[0] === x.ts)) a.push([x.ts, x.lat, x.lng, x.acc]); }
    for (const k in d) { d[k] = d[k].filter(y => y[0] >= keep).sort((a, b) => a[0] - b[0]); if (!d[k].length) delete d[k]; }
    await IDB.set('pings', JSON.stringify(d));
  }
};
const geo = (a, b) => LSAPI.distance(a, b);
const hm = ms => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} m` : `${m} m`; };
const tm = ts => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const pct = (a, b) => b ? Math.round(100 * a / b) : null;
const pbar = (v, cls = '') => v == null ? '—' : `<span class="bar ${cls}" style="width:${Math.max(2, v * .6)}px"></span> ${v}%`;
function pickFiles(accept, multiple, fn) { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.multiple = multiple; i.onchange = () => i.files.length && fn([...i.files]); i.click(); }

/** Points of one person in time order: punches + shift positions, each { ts, lat, lng, kind: 'in' | 'out' | 'ping' } */
function trackOf(wid, from, to, pings) {
  const t0 = new Date(from + 'T00:00:00+04:00').getTime(), t1 = new Date(to + 'T23:59:59+04:00').getTime() + 12 * 3600000;
  const pts = Object.values(S.punches || {}).filter(p => p.wid === wid && p.status !== 'rejected' && p.ts >= t0 && p.ts <= t1).map(p => ({ ts: p.ts, lat: p.lat, lng: p.lng, kind: p.type, p }));
  for (const x of pings?.[wid] || []) if (x[0] >= t0 && x[0] <= t1) pts.push({ ts: x[0], lat: x[1], lng: x[2], acc: x[3], kind: 'ping' });
  return pts.sort((a, b) => a.ts - b.ts);
}
/** Time spent per ~35 m square while on shift → hotspots [{ lat, lng, ms, who:Set, n }] */
function hotspots(tracks) {
  const G = 0.0003, cells = new Map();
  for (const [wid, pts] of tracks) {
    let on = false;
    pts.forEach((x, i) => {
      if (x.kind === 'in') on = true;
      if (!on && x.kind === 'ping') on = true;                    // positions are only sent during a shift
      const nx = pts[i + 1]; let ms = 0;
      if (on && x.kind !== 'out') ms = nx ? Math.min(nx.ts - x.ts, 2 * 3600000) : 10 * 60000;   // the Android app records on movement: a long gap = stayed put
      if (x.kind === 'out') on = false;
      const k = Math.round(x.lat / G) + ':' + Math.round(x.lng / G);
      const c = cells.get(k) || cells.set(k, { la: 0, lo: 0, n: 0, ms: 0, who: new Set() }).get(k);
      c.la += x.lat; c.lo += x.lng; c.n++; c.ms += ms; c.who.add(wid);
    });
  }
  return [...cells.values()].map(c => ({ lat: c.la / c.n, lng: c.lo / c.n, ms: c.ms, n: c.n, who: c.who })).filter(c => c.ms > 0).sort((a, b) => b.ms - a.ms);
}
const nearSite = pt => { let best = null; for (const s of S.sites) for (const p of sitePins(s)) { const d = geo(pt, p); if (!best || d < best.d) best = { s, d, inZone: d <= (+p.radius || 100) }; } return best; };

/* ====================== Live ====================== */
const LV = { site: '' };
async function renderLive() {
  const v = $('#v-live'), today = todayISO(), pings = await PINGS.load();
  const ps = Object.values(S.punches || {}).filter(p => p.status !== 'rejected' && (p.workDate === today || (p.type === 'in' && Date.now() - p.ts < 16 * 3600000)));
  const people = new Map();
  for (const e of S.employees) { if (!employedOn(e, today)) continue; const site = siteOn(e, today); const c = getCell(e.id, today); if (appOn(e) && site && c?.c !== 'OFF') people.set(e.id, { e, site, code: c?.c || '' }); }
  for (const p of ps) { const e = IX.emp.get(p.wid); if (e && !people.has(e.id)) people.set(e.id, { e, site: p.siteId, code: '' }); }
  const rows = [...people.values()].map(x => {
    const mine = ps.filter(p => p.wid === x.e.id).sort((a, b) => a.ts - b.ts), last = mine[mine.length - 1];
    const ping = (pings[x.e.id] || []).filter(y => last && y[0] > last.ts).pop();
    const st = !last ? (x.code && x.code !== 'P' ? 'code' : 'no') : last.type === 'out' ? 'done' : last.status === 'pending' ? 'pe' : 'on';
    const pos = ping ? { lat: ping[1], lng: ping[2], ts: ping[0], ping: true } : last ? { lat: last.lat, lng: last.lng, ts: last.ts } : null;
    return { ...x, last, pos, st, site: last?.siteId || x.site };
  }).filter(r => !LV.site || r.site === LV.site).sort((a, b) => 'onpedonecodeno'.indexOf(a.st) - 'onpedonecodeno'.indexOf(b.st) || a.e.name.localeCompare(b.e.name));
  const n = k => rows.filter(r => r.st === k).length, out = rows.filter(r => r.st !== 'done' && r.last && !r.last.inZone).length;
  const lbl = { on: 'On duty', pe: 'On duty · review', done: 'Checked out', no: 'Not checked in', code: 'Day marked' };
  const sitesWith = [...new Set([...people.values()].map(x => x.site).filter(Boolean))].map(id => [id, siteName(id)]).sort((a, b) => a[1].localeCompare(b[1]));
  // site filter in line with the Live map / Review tabs; the figures sit beside the map and open the list of who is behind them
  $('#subtabs').querySelector('#lv-site')?.remove();
  $('#subtabs').insertAdjacentHTML('beforeend', `<select id="lv-site" class="lv-site">${opts(sitesWith, LV.site, 'All sites')}</select>`);
  const starts = appCfg().starts || {}, nowHM = new Date().toTimeString().slice(0, 5), shiftOf = r => assignOn(r.e, today)?.shift || r.e.shift || 'DAY';
  const groups = { on: rows.filter(r => r.st === 'on' || r.st === 'pe'), done: rows.filter(r => r.st === 'done'), no: rows.filter(r => r.st === 'no'), out: rows.filter(r => r.st !== 'done' && r.last && !r.last.inZone) };
  const lateNo = groups.no.filter(r => starts[shiftOf(r)] && nowHM >= starts[shiftOf(r)]).length;
  const K = [['on', 'On duty now', groups.on.length, 'var(--pos)'], ['done', 'Checked out', groups.done.length, ''], ['no', 'Not checked in', groups.no.length, groups.no.length ? 'var(--neg)' : '', lateNo ? `${lateNo} past shift start` : ''], ['out', 'Outside zone', groups.out.length, groups.out.length ? 'var(--warn)' : '']];
  const sel = LV.k && groups[LV.k] ? LV.k : null, list = sel ? groups[sel] : [];
  const personRow = r => { const sh = shiftOf(r), st0 = starts[sh], due = r.st === 'no' && st0 ? (nowHM >= st0 ? `<span class="pill neg">due ${st0}</span>` : `<span class="pill">starts ${st0}</span>`) : '';
    return `<div class="pr" data-lv="${rows.indexOf(r)}"><span class="dot ${r.st === 'on' ? 'on' : r.st === 'pe' ? 'pe' : r.st === 'no' ? 'no' : ''}"></span><span class="avatar" data-av="${r.e.id}">${esc(initials(r.e.name))}</span>
      <div style="min-width:0;flex:1"><div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.e.name)}</div><div class="muted small">${esc(siteName(r.site) || '—')} · ${esc(sh)}${r.pos ? ` · ${r.pos.ping ? 'seen' : r.last.type === 'in' ? 'in' : 'out'} ${tm(r.pos.ts)}` : ''}${r.last && !r.last.inZone && r.st !== 'done' ? ' · outside zone' : ''}</div></div>${due}${r.last?.face ? FACE.badge(r.last.face) : ''}</div>`; };
  const byShift = sel === 'no' ? Object.entries(list.reduce((a, r) => ((a[shiftOf(r)] ||= []).push(r), a), {})).sort((a, b) => (starts[a[0]] || '').localeCompare(starts[b[0]] || '')) : null;
  v.innerHTML = `<div class="dc">
    ${guideHTML()}
    <div class="live"><div class="mapbox" id="lv-map"></div>
    <div class="lv-side"><div class="lv-k">${K.map(([k, l, n, col, sub]) => `<button class="kpi${sel === k ? ' on' : ''}" data-k="${k}" ${col ? `style="--c:${col}"` : ''}><span class="l">${l}</span><span class="v">${n}</span>${sub ? `<span class="s">${sub}</span>` : ''}</button>`).join('')}
      <button class="kpi sync" id="lv-sync" title="Sync now"><span class="l">Last sync</span><span class="v">${appCfg().lastSync ? tm(appCfg().lastSync) : 'never'}</span></button></div>
    <div class="ppl">${sel ? `<div class="lv-h"><b>${K.find(x => x[0] === sel)[1]}</b><span class="muted small">${list.length}</span><span class="spacer"></span><button class="btn sm" id="lv-all">✕</button></div>`
      + (byShift ? byShift.map(([sh, rs]) => `<div class="lv-sh">${esc(sh)} shift${starts[sh] ? ' · starts ' + starts[sh] : ''} · ${rs.length}</div>${rs.map(personRow).join('')}`).join('') : list.map(personRow).join('')) + (list.length ? '' : '<p class="muted small" style="padding:8px">Nobody.</p>')
      : `<p class="muted small" style="padding:8px 4px">Click a figure to see who is behind it – e.g. <b>Not checked in</b> lists who has not started, by shift.</p>${rows.length ? '' : '<p class="muted">Nobody on the app is rostered today.</p>'}`}</div></div></div></div>`;
  v.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { LV.k = LV.k === b.dataset.k ? null : b.dataset.k; renderLive(); });
  $('#lv-all', v)?.addEventListener('click', () => { LV.k = null; renderLive(); });
  $('#lv-sync', v).onclick = () => syncApp();
  bindGuide(v);
  bindSecs(v); $('#lv-site').onchange = e => { LV.site = e.target.value; renderLive(); };
  for (const el of v.querySelectorAll('[data-av]')) { const e = IX.emp.get(el.dataset.av); if (e?.photo) photoURL(e).then(u => { if (u) el.innerHTML = `<img src="${u}" alt="">`; }); }
  v.querySelectorAll('[data-lv]').forEach(el => el.ondblclick = () => { const r = rows[+el.dataset.lv]; INS.person = r.e.id; showView('insights'); });
  let map; try { map = await LSMap.create($('#lv-map'), { zoom: 12 }); } catch (e) { $('#lv-map').innerHTML = `<p class="muted" style="padding:12px">${esc(e.message)}</p>`; return; }
  const L = window.L, b = [], mk = [];
  for (const s of S.sites) for (const p of sitePins(s)) if (!LV.site || s.id === LV.site) { LSMap.zone(map, p, { label: s.name, fill: .06, marker: false }); b.push([p.lat, p.lng]); }
  // patrol checkpoints with the last visit today
  const t0 = new Date(today + 'T00:00:00+04:00').getTime();
  for (const s of S.sites) if (!LV.site || s.id === LV.site) for (const bt of beatsOf(s)) for (const [i, c] of (bt.checkpoints || []).entries()) {
    const last = Object.values(S.scans || {}).filter(x => x.checkpointId === c.id && x.ts >= t0).sort((a, b) => b.ts - a.ts)[0];
    L.marker([c.lat, c.lng], { icon: L.divIcon({ className: 'cp-pin' + (last ? ' seen' : ''), html: `<span>${i + 1}</span>`, iconSize: [24, 24] }) }).addTo(map).bindTooltip(`${esc(c.name)} · ${esc(bt.name)}${last ? ` · scanned ${tm(last.ts)} by ${esc(last.name)}` : ' · not scanned today'}`);
  }
  const col = { on: '#1F8A5B', pe: '#B7791F', done: '#8A94A6' };
  rows.forEach((r, i) => {
    if (!r.pos || !col[r.st]) return;
    mk[i] = L.circleMarker([r.pos.lat, r.pos.lng], { radius: 7, color: '#fff', weight: 2, fillColor: col[r.st], fillOpacity: 1 }).addTo(map)
      .bindPopup(`<b>${esc(r.e.name)}</b> <span class="mono">${esc(empCodeLabel(r.e))}</span><br>${lbl[r.st]} · ${r.pos.ping ? 'last seen' : r.last.type === 'in' ? 'checked in' : 'checked out'} ${tm(r.pos.ts)}<br>${esc(r.last.siteName || '')}${r.last.dist != null ? ` · ${r.last.dist} m from pin` : ''}`);
    b.push([r.pos.lat, r.pos.lng]);
  });
  if (b.length) map.fitBounds(b, { padding: [30, 30], maxZoom: 17 });
  v.querySelectorAll('[data-lv]').forEach(el => el.onclick = () => { const m = mk[+el.dataset.lv]; if (m) { map.setView(m.getLatLng(), 17); m.openPopup(); } });
}

/* ====================== Insights ====================== */
const INS = { from: '', to: '', project: '', site: '', person: '', shift: '', day: '' };
for (const k of ['in-zone', 'in-pin', 'in-beats']) SEC_CLOSED.add(k);   // details – opened when needed
async function renderInsights() {
  const v = $('#v-insights'), today = todayISO();
  INS.to ||= today; INS.from ||= addDays(today, -29);
  const pings = await PINGS.load();
  const inRange = d => d >= INS.from && d <= INS.to;
  const siteOk = id => (!INS.site || id === INS.site) && (!INS.project || IX.site.get(id)?.projectId === INS.project);
  const empOk = e => e && (!INS.person || e.id === INS.person) && (!INS.shift || (e.shift || 'DAY') === INS.shift);
  const P = Object.values(S.punches || {}).filter(p => inRange(p.workDate) && p.status !== 'rejected' && siteOk(p.siteId) && empOk(IX.emp.get(p.wid)));
  const ins = P.filter(p => p.type === 'in');
  const lateMin = p => +((p.flags || []).find(f => /^late \d+/.test(f)) || '').replace(/\D+/g, '') || 0;
  const late = ins.filter(p => lateMin(p) > 0), faced = P.filter(p => p.face?.d != null), fOk = faced.filter(p => FACE.verdict(p.face.d) === 'match');
  // coverage from the attendance grid: planned = allocated and not OFF; present = billable code
  const days = []; for (let d = INS.from; d <= INS.to; d = addDays(d, 1)) days.push(d);
  const cov = new Map();
  for (const e of S.employees) {
    if (!empOk(e)) continue;
    for (const d of days) {
      if (!employedOn(e, d)) continue; const s = siteOn(e, d); if (!s || !siteOk(s)) continue; const c = getCell(e.id, d);
      if (c?.c === 'OFF') continue;
      const x = cov.get(s) || cov.set(s, { plan: 0, pres: 0, byDay: {} }).get(s); x.plan++; const bd = x.byDay[d] ||= [0, 0]; bd[0]++;
      if (c && codeDef(c.c).billable) { x.pres++; bd[1]++; }
    }
  }
  const covRows = [...cov].map(([s, x]) => ({ s, ...x, pc: pct(x.pres, x.plan), short: Object.values(x.byDay).filter(([a, b]) => b < a).length })).sort((a, b) => a.pc - b.pc);
  // punctuality and zone per site
  const bySite = new Map(); for (const p of ins) { const x = bySite.get(p.siteId) || bySite.set(p.siteId, { n: 0, late: 0, lm: 0, inZ: 0, dist: [], acc: [], pend: 0 }).get(p.siteId); x.n++; const l = lateMin(p); if (l) { x.late++; x.lm += l; } if (p.inZone) x.inZ++; if (p.dist != null) x.dist.push(p.dist); x.acc.push(p.acc); if (p.status === 'pending') x.pend++; }
  const med = a => a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : null;
  const byPerson = new Map(); for (const p of ins) { const x = byPerson.get(p.wid) || byPerson.set(p.wid, { n: 0, late: 0, lm: 0, out: 0 }).get(p.wid); x.n++; const l = lateMin(p); if (l) { x.late++; x.lm += l; } if (!p.inZone) x.out++; }
  // weekly on-time trend
  const wk = new Map(); for (const p of ins) { const k = addDays(p.workDate, -((new Date(p.workDate + 'T12:00:00Z').getUTCDay() + 6) % 7)); const x = wk.get(k) || wk.set(k, [0, 0]).get(k); x[0]++; if (!lateMin(p)) x[1]++; }
  const weeks = [...wk].sort((a, b) => a[0] < b[0] ? -1 : 1).slice(-12);
  // pin check: where check-ins actually happen vs the pin
  const pinFix = [];
  for (const s of S.sites) {
    if (!siteOk(s.id)) continue; const pins = sitePins(s); if (!pins.length) continue;
    const pts = ins.filter(p => p.siteId === s.id && p.acc <= 30); if (pts.length < 5) continue;
    const c = { lat: pts.reduce((a, p) => a + p.lat, 0) / pts.length, lng: pts.reduce((a, p) => a + p.lng, 0) / pts.length };
    const pin = pins.reduce((a, p) => geo(c, p) < geo(c, a) ? p : a), d = Math.round(geo(c, pin));
    if (d > Math.max(25, (+pin.radius || 100) * .4)) pinFix.push({ s, pin, c, d, n: pts.length });
  }
  // routes and hotspots
  const wids = [...new Set([...P.map(p => p.wid), ...Object.keys(pings).filter(w => empOk(IX.emp.get(w)) && (!INS.site && !INS.project || P.some(p => p.wid === w)))])];
  const tracks = new Map(wids.map(w => [w, trackOf(w, INS.from, INS.to, pings)]).filter(([, t]) => t.length));
  const hs = hotspots(tracks).slice(0, 15);
  const nPings = [...tracks.values()].reduce((a, t) => a + t.filter(x => x.kind === 'ping').length, 0);
  // unusual activity
  const odd = [];
  const dev = new Map(); for (const p of P) if (p.deviceId) (dev.get(p.deviceId) || dev.set(p.deviceId, new Set()).get(p.deviceId)).add(p.wid);
  for (const [, w] of dev) if (w.size > 1) odd.push(['One phone, several people', [...w].map(id => IX.emp.get(id)?.name || id).join(', '), '']);
  for (const p of faced) if (FACE.verdict(p.face.d) === 'different') odd.push(['Different face', `${p.name} · ${fmtDMY(p.workDate)} ${tm(p.ts)} ${p.type}`, p.id]);
  for (const [w, t] of tracks) for (let i = 1; i < t.length; i++) { const a = t[i - 1], b = t[i], km = geo(a, b) / 1000, h = (b.ts - a.ts) / 3600000; if (km > 2 && h > 0 && km / h > 120) { odd.push(['Impossible travel', `${IX.emp.get(w)?.name || w} · ${km.toFixed(1)} km in ${hm(b.ts - a.ts)} · ${fmtDMY(new Date(b.ts).toISOString().slice(0, 10))}`, b.p?.id || '']); break; } }
  for (const p of P) { if ((p.flags || []).includes('clock')) odd.push(['Phone clock wrong', `${p.name} · ${fmtDMY(p.workDate)}`, p.id]); }
  const offl = P.filter(p => (p.flags || []).includes('offline')).length;
  // patrol beats: rounds per shift, then per beat and per person
  const BR = await beatReport(INS.from, INS.to, (emp, site) => empOk(emp) && siteOk(site.id));
  const byBeat = new Map(), byGuard = new Map();
  for (const r of BR) {
    const k = r.site.id + '|' + r.beat.id, x = byBeat.get(k) || byBeat.set(k, { site: r.site, beat: r.beat, shifts: 0, exp: 0, done: 0, missed: {} }).get(k);
    x.shifts++; x.exp += r.expected; x.done += r.done; for (const c in r.missed) x.missed[c] = (x.missed[c] || 0) + r.missed[c];
    const g = byGuard.get(r.emp.id) || byGuard.set(r.emp.id, { emp: r.emp, beats: new Set(), shifts: 0, exp: 0, done: 0, miss: 0, scans: 0, gps: 0 }).get(r.emp.id);
    g.beats.add(r.beat.name); g.shifts++; g.exp += r.expected; g.done += r.done; g.miss += Object.values(r.missed).reduce((a, b) => a + b, 0); g.scans += r.scanned; g.gps += r.gps;
    if (r.expected >= 2 && r.done === 0) odd.push(['Missed every patrol round', `${r.emp.name} · ${r.beat.name} at ${r.site.name} · ${fmtDMY(r.date)}`, '']);
  }
  const far = Object.values(S.scans || {}).filter(x => !x.ok && x.ts >= new Date(INS.from + 'T00:00:00+04:00').getTime() && empOk(IX.emp.get(x.personId)) && siteOk(x.siteId));
  for (const x of far) odd.push(['Scan far from checkpoint', `${x.name} · ${x.checkpoint} (${x.beat}) · ${x.dist == null ? 'no GPS' : x.dist + ' m away'} · ${fmtDMY(new Date(x.ts + 4 * 3600000).toISOString().slice(0, 10))} ${tm(x.ts)}`, '']);
  const cpName = (b, id) => b.checkpoints.find(c => c.id === id)?.name || id;
  // person profile
  const pe = INS.person ? IX.emp.get(INS.person) : null, track = pe ? tracks.get(pe.id) || [] : [];
  const pDays = [...new Set(track.map(x => new Date(x.ts + 4 * 3600000).toISOString().slice(0, 10)))].sort();
  if (pe && !pDays.includes(INS.day)) INS.day = pDays[pDays.length - 1] || '';
  INS.last = { covRows, bySite, byPerson, hs, odd, pinFix, byBeat, byGuard, cpName };

  const projs = S.projects.filter(p => p.active !== false).map(p => [p.id, p.name]).sort((a, b) => a[1].localeCompare(b[1]));
  const sites = S.sites.filter(s => !INS.project || s.projectId === INS.project).map(s => [s.id, s.name]).sort((a, b) => a[1].localeCompare(b[1]));
  const ppl = S.employees.filter(e => appOn(e) || Object.values(S.punches || {}).some(p => p.wid === e.id)).map(e => [e.id, `${e.name} ${empCodeLabel(e)}`]).sort((a, b) => a[1].localeCompare(b[1]));
  const kpi = (k, x, col) => `<div class="kpi" ${col ? `style="--c:${col}"` : ''}><div class="l">${k}</div><div class="v">${x}</div></div>`;
  const covAll = covRows.reduce((a, r) => [a[0] + r.pres, a[1] + r.plan], [0, 0]);
  v.innerHTML = docHead('Insights', `${fmtDMY(INS.from)} – ${fmtDMY(INS.to)} · ${P.length} punches · ${nPings} shift positions`) + `<div class="dc">
    <div class="ins-f">
      <label class="f">From<input type="date" data-i="from" value="${INS.from}"></label><label class="f">To<input type="date" data-i="to" value="${INS.to}" max="${today}"></label>
      <label class="f">Site<select data-i="site">${siteOptions(INS.site, 'All sites')}</select></label>
      <label class="f">Security personnel<select data-i="person">${opts(ppl, INS.person, 'Everyone')}</select></label>
      <button class="btn sm" data-q="7">7 days</button><button class="btn sm" data-q="30">30 days</button><button class="btn sm" data-q="90">90 days</button></div>
    <div class="kpis ins-k">${kpi('Coverage', covAll[1] ? pct(...covAll) + '%' : '—', 'var(--pos)')}${kpi('On time', ins.length ? pct(ins.length - late.length, ins.length) + '%' : '—')}${kpi('Inside zone', ins.length ? pct(ins.filter(p => p.inZone).length, ins.length) + '%' : '—')}${kpi('Unusual activity', odd.length, odd.length ? 'var(--neg)' : '')}</div>
    ${pe ? `<div class="sec"><div class="sh"><b>${esc(pe.name)}</b> <span class="mono muted">${esc(empCodeLabel(pe))}</span></div><div class="sb"><div class="row" style="gap:14px;align-items:flex-start">
      <span class="avatar lg" data-av="${pe.id}">${esc(initials(pe.name))}</span>
      <table class="kvt"><tbody><tr><td>Check-ins</td><td>${ins.length}</td></tr><tr><td>On time</td><td>${ins.length ? pct(ins.length - late.length, ins.length) + '%' : '—'}</td></tr><tr><td>Inside zone</td><td>${ins.length ? pct(ins.filter(p => p.inZone).length, ins.length) + '%' : '—'}</td></tr>
      <tr><td>Sites</td><td>${[...new Set(ins.map(p => p.siteName))].map(esc).join(', ') || '—'}</td></tr><tr><td>Relieved</td><td>${ins.filter(p => p.reliever).length} day(s)</td></tr><tr><td>Face</td><td>${faceRefs(pe).length ? (faced.length ? `${fOk.length}/${faced.length} matched` : 'reference photo set') : 'no reference photo – add one in Security Personnel'}</td></tr></tbody></table>
      <div style="flex:1"><label class="f" style="max-width:220px">Route on<select id="in-day">${opts(pDays.map(d => [d, fmtDMY(d)]), INS.day)}</select></label><div class="muted small" id="in-routeinfo"></div></div></div></div></div>` : ''}
    <div class="ins-g">
      ${sec('in-odd', `Unusual activity <span class="pill ${odd.length ? 'neg' : ''}">${odd.length}</span>`, odd.length ? `<div class="tw" style="max-height:330px"><table><thead><tr><th>What</th><th>Details</th><th></th></tr></thead><tbody>${odd.map(([a, b, id]) => `<tr><td><b>${esc(a)}</b></td><td style="white-space:normal">${esc(b)}</td><td>${id ? `<button class="btn sm" data-pd="${id}">Details</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted" style="margin:0">Nothing unusual: no shared phones, face mismatches, impossible travel or wrong phone clocks.</p>')}
      ${sec('in-map', pe ? 'Route and hotspots' : 'Hotspots – where personnel spend most time', `<div class="mapbox" id="in-map" style="height:420px"></div><p class="muted small" style="margin:6px 0 0">${pe ? 'Line = route that day (check-in → positions every 10 min → check-out). ' : ''}Circles = time spent on shift in each ~35 m square${pe ? '' : '; pick a person to see their route'}. Positions are recorded only while the app is open on shift.</p>`)}
      ${sec('in-cov', 'Coverage by site <span class="cnt">present ÷ planned (allocated, not OFF)</span>', covRows.length ? `<div class="tw" style="max-height:360px"><table><thead><tr><th>Site</th><th class="num">Planned</th><th class="num">Present</th><th>Coverage</th><th class="num" title="days with fewer present than planned">Short days</th></tr></thead><tbody>${covRows.map(r => `<tr><td>${esc(siteName(r.s))}</td><td class="num">${r.plan}</td><td class="num">${r.pres}</td><td>${pbar(r.pc, r.pc < 85 ? 'n' : r.pc < 95 ? 'w' : 'p')}</td><td class="num">${r.short || ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted" style="margin:0">No allocations in this range.</p>')}
      ${sec('in-pun', 'Punctuality', `${weeks.length ? `<div class="muted small">On-time check-ins per week</div><div class="spark" style="margin:6px 0 22px">${weeks.map(([k, [a, b]]) => `<i style="height:${Math.max(3, pct(b, a))}%" title="Week of ${fmtDMY(k)}: ${pct(b, a)}% on time (${a})"><b>${k.slice(8)}/${k.slice(5, 7)}</b></i>`).join('')}</div>` : ''}
        <div class="tw" style="max-height:250px"><table><thead><tr><th>Most often late</th><th class="num">Check-ins</th><th class="num">Late</th><th class="num">Avg min</th></tr></thead><tbody>${[...byPerson].filter(([, x]) => x.late).sort((a, b) => b[1].late - a[1].late).slice(0, 12).map(([w, x]) => `<tr data-pp="${w}" style="cursor:pointer"><td>${esc(IX.emp.get(w)?.name || w)}</td><td class="num">${x.n}</td><td class="num">${x.late}</td><td class="num">${Math.round(x.lm / x.late)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nobody late.</td></tr>'}</tbody></table></div>`)}
      ${sec('in-zone', 'Zone compliance by site', bySite.size ? `<div class="tw" style="max-height:330px"><table><thead><tr><th>Site</th><th class="num">Check-ins</th><th>Inside zone</th><th class="num">Median distance</th><th class="num">Median GPS ±</th><th class="num">To review</th></tr></thead><tbody>${[...bySite].map(([s, x]) => `<tr><td>${esc(siteName(s) || '—')}</td><td class="num">${x.n}</td><td>${pbar(pct(x.inZ, x.n), pct(x.inZ, x.n) < 80 ? 'w' : 'p')}</td><td class="num">${med(x.dist) ?? '—'} m</td><td class="num">${med(x.acc)} m</td><td class="num">${x.pend || ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted" style="margin:0">No check-ins in this range.</p>')}
      ${sec('in-pin', `Pin check <span class="cnt">${pinFix.length}</span>`, pinFix.length ? `<p class="muted small" style="margin-top:0">At these sites accurate check-ins (GPS ±30 m or better) cluster away from the pin – the pin is probably misplaced.</p><div class="tw"><table><thead><tr><th>Site</th><th class="num">Check-ins</th><th class="num">Off by</th><th></th></tr></thead><tbody>${pinFix.map((f, i) => `<tr><td>${esc(f.s.name)}</td><td class="num">${f.n}</td><td class="num">${f.d} m</td><td><button class="btn sm" data-pin="${i}">Move pin there</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted" style="margin:0">All pins match where people check in (needs 5+ accurate check-ins per site).</p>')}
      ${sec('in-beats', `Beat compliance <span class="cnt">${allBeats().length} beat(s)</span>`, BR.length ? `<div class="tw" style="max-height:200px"><table><thead><tr><th>Beat</th><th>Site</th><th class="num">Shifts</th><th class="num">Rounds done</th><th>Completion</th><th>Most missed</th></tr></thead><tbody>${[...byBeat.values()].map(x => { const pc = pct(x.done, x.exp), mm = Object.entries(x.missed).sort((a, b) => b[1] - a[1])[0]; return `<tr><td><b>${esc(x.beat.name)}</b></td><td>${esc(x.site.name)}</td><td class="num">${x.shifts}</td><td class="num">${x.done} / ${x.exp}</td><td>${pbar(pc, pc < 60 ? 'n' : pc < 90 ? 'w' : 'p')}</td><td class="small">${mm ? `${esc(cpName(x.beat, mm[0]))} (${mm[1]}×)` : '—'}</td></tr>`; }).join('')}</tbody></table></div>
        <div class="tw" style="max-height:260px;margin-top:8px"><table><thead><tr><th>Security personnel</th><th>Beat</th><th class="num">Shifts</th><th>Rounds completed</th><th class="num">Checkpoints missed</th><th class="num">Scans / GPS</th></tr></thead><tbody>${[...byGuard.values()].sort((a, b) => pct(a.done, a.exp) - pct(b.done, b.exp)).map(g => { const pc = pct(g.done, g.exp); return `<tr data-pp="${g.emp.id}" style="cursor:pointer"><td>${esc(g.emp.name)} <span class="mono muted">${esc(g.emp.empCode || '')}</span></td><td class="small">${esc([...g.beats].join(', '))}</td><td class="num">${g.shifts}</td><td>${pbar(pc, pc < 60 ? 'n' : pc < 90 ? 'w' : 'p')}</td><td class="num">${g.miss || ''}</td><td class="num">${g.scans} / ${g.gps}</td></tr>`; }).join('')}</tbody></table></div>`
        : `<p class="muted" style="margin:0">${allBeats().length ? 'No shifts at sites with a patrol beat in this range.' : 'No patrol beats yet – add them in Projects &amp; sites → Patrol beats.'}</p>`)}

    </div></div>`;
  // events
  bindSecs(v);
  v.querySelectorAll('[data-i]').forEach(i => i.onchange = () => { INS[i.dataset.i] = i.value; if (i.dataset.i === 'project') INS.site = ''; renderInsights(); });
  v.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { INS.to = today; INS.from = addDays(today, 1 - +b.dataset.q); renderInsights(); });
  v.querySelectorAll('[data-pp]').forEach(r => r.onclick = () => { INS.person = r.dataset.pp; renderInsights(); });
  v.querySelectorAll('[data-pd]').forEach(b => b.onclick = () => { const p = S.punches[b.dataset.pd]; const e = p && IX.emp.get(p.wid); if (e) punchDetails(e, p.workDate); });
  v.querySelectorAll('[data-pin]').forEach(b => b.onclick = async () => {
    const f = pinFix[+b.dataset.pin];
    if (!await confirmBox(`Move the pin of ${f.s.name} ${f.d} m to where ${f.n} check-ins happened?\n\nThen Publish roster (App & review) so phones get the new pin.`, 'Move pin')) return;
    f.pin.lat = +f.c.lat.toFixed(6); f.pin.lng = +f.c.lng.toFixed(6); markDirty(); toast('Pin moved – publish the roster to send it to phones'); renderInsights();
  });
  if ($('#in-day')) $('#in-day').onchange = e => { INS.day = e.target.value; renderInsights(); };
  for (const el of v.querySelectorAll('[data-av]')) photoURL(IX.emp.get(el.dataset.av)).then(u => { if (u) el.innerHTML = `<img src="${u}" alt="">`; });
  // map: zones, hotspot circles, route
  let map; try { map = await LSMap.create($('#in-map'), { zoom: 12 }); } catch (e) { $('#in-map').innerHTML = `<p class="muted" style="padding:12px">${esc(e.message)}</p>`; return; }
  const L = window.L, b = [];
  for (const s of S.sites) if (siteOk(s.id)) for (const p of sitePins(s)) { LSMap.zone(map, p, { label: s.name, fill: .05, marker: false }); b.push([p.lat, p.lng]); }
  const top = hs[0]?.ms || 1, hm2 = [];
  hs.forEach((h, i) => { hm2[i] = L.circle([h.lat, h.lng], { radius: 12 + 40 * Math.sqrt(h.ms / top), color: '#D0473A', weight: 1, fillColor: '#D0473A', fillOpacity: .15 + .45 * (h.ms / top) }).addTo(map).bindTooltip(`#${i + 1} · ${hm(h.ms)} · ${h.who.size} person(s)`); b.push([h.lat, h.lng]); });
  for (const s of S.sites) if (siteOk(s.id)) for (const b of beatsOf(s)) for (const [i, c] of (b.checkpoints || []).entries()) {
    const r = pe && INS.day ? BR.find(x => x.emp.id === pe.id && x.date === INS.day && x.beat.id === b.id) : null, miss = r ? (r.missed[c.id] || 0) : null;
    L.marker([c.lat, c.lng], { icon: L.divIcon({ className: 'cp-pin' + (miss == null ? '' : miss ? ' miss' : ' seen'), html: `<span>${i + 1}</span>`, iconSize: [24, 24] }) }).addTo(map).bindTooltip(`${c.name} · ${b.name}${miss == null ? '' : miss ? ` · missed in ${miss} of ${r.expected} round(s)` : ' · visited every round'}`);
  }
  if (pe && INS.day) {
    const day = track.filter(x => new Date(x.ts + 4 * 3600000).toISOString().slice(0, 10) === INS.day);
    if (day.length) {
      const line = day.map(x => [x.lat, x.lng]); L.polyline(line, { color: '#1766CB', weight: 3, opacity: .85 }).addTo(map);
      day.forEach((x, i) => L.circleMarker([x.lat, x.lng], { radius: x.kind === 'ping' ? 4 : 7, color: '#fff', weight: 1.5, fillColor: x.kind === 'in' ? '#1F8A5B' : x.kind === 'out' ? '#D0473A' : '#1766CB', fillOpacity: 1 }).addTo(map).bindTooltip(`${x.kind === 'ping' ? 'position' : x.kind === 'in' ? 'check-in' : 'check-out'} ${tm(x.ts)}`));
      let km = 0; for (let i = 1; i < day.length; i++) km += geo(day[i - 1], day[i]) / 1000;
      $('#in-routeinfo').textContent = `${fmtDMY(INS.day)}: ${tm(day[0].ts)} – ${tm(day[day.length - 1].ts)} · ${day.filter(x => x.kind === 'ping').length} positions · ${km.toFixed(2)} km moved`;
      b.length = 0; b.push(...line);
    }
  }
  if (b.length) map.fitBounds(b, { padding: [24, 24], maxZoom: 18 });
}

async function exportInsights() {
  const X = INS.last; if (!X) return toast('Open Insights first');
  await loadScript(LIB.xlsx);
  const wb = XLSX.utils.book_new(), add = (n, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), n);
  add('Coverage', [['Site', 'Planned', 'Present', 'Coverage %', 'Short days'], ...X.covRows.map(r => [siteName(r.s), r.plan, r.pres, r.pc, r.short])]);
  add('Punctuality', [['Security personnel', 'Emp ID', 'Check-ins', 'Late', 'Avg late min', 'Outside zone'], ...[...X.byPerson].map(([w, x]) => [IX.emp.get(w)?.name || w, empCodeLabel(IX.emp.get(w) || {}), x.n, x.late, x.late ? Math.round(x.lm / x.late) : 0, x.out])]);
  add('Zone', [['Site', 'Check-ins', 'Inside zone', 'To review'], ...[...X.bySite].map(([s, x]) => [siteName(s), x.n, x.inZ, x.pend])]);
  add('Hotspots', [['#', 'Latitude', 'Longitude', 'Hours', 'People', 'Nearest site', 'Distance m'], ...X.hs.map((h, i) => { const ns = nearSite(h); return [i + 1, +h.lat.toFixed(6), +h.lng.toFixed(6), +(h.ms / 3600000).toFixed(2), h.who.size, ns?.s.name || '', ns ? Math.round(ns.d) : '']; })]);
  add('Beats', [['Security personnel', 'Emp ID', 'Beats', 'Shifts', 'Rounds expected', 'Rounds done', 'Completion %', 'Checkpoints missed', 'QR scans', 'GPS visits'], ...[...X.byGuard.values()].map(g => [g.emp.name, g.emp.empCode || '', [...g.beats].join(', '), g.shifts, g.exp, g.done, pct(g.done, g.exp), g.miss, g.scans, g.gps])]);
  add('Unusual', [['What', 'Details'], ...X.odd.map(([a, b]) => [a, b])]);
  XLSX.writeFile(wb, `LS Insights ${INS.from} to ${INS.to}.xlsx`);
}
