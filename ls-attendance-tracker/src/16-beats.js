/* =====================================================================
   Patrol beats: checkpoints at a site that guards visit in rounds.
   A checkpoint counts as visited by a QR scan on the phone (GPS-checked)
   or by a recorded shift position passing within its radius.
   site.beats = [{ id, name, shift: ALL|DAY|NIGHT, everyMin, assignees: [personId],
                   checkpoints: [{ id, name, lat, lng, radius }] }]
   ===================================================================== */
/** Pure: rounds of one beat in one shift. visits = [{ cp, ts, src }]. Also runs in the Ask Claude worker. */
function beatRoundsCore(beat, start, end, visits) {
  const every = Math.max(10, +beat.everyMin || 60) * 60000, dur = Math.max(0, end - start);
  const expected = Math.max(1, Math.floor(dur / every)), cps = beat.checkpoints || [];
  const missed = {}; let done = 0; const rounds = [];
  for (let r = 0; r < expected; r++) {
    const a = start + r * every, b = a + every;
    const seen = new Set(visits.filter(v => v.ts >= a && v.ts < b).map(v => v.cp));
    const miss = cps.filter(c => !seen.has(c.id));
    if (!miss.length && cps.length) done++;
    miss.forEach(c => { missed[c.id] = (missed[c.id] || 0) + 1; });
    rounds.push({ from: a, to: b, visited: cps.length - miss.length, of: cps.length });
  }
  return { expected, done, completion: Math.round(100 * done / expected), missed, rounds, scanned: visits.filter(v => v.src === 'scan').length, gps: visits.filter(v => v.src === 'gps').length };
}
const beatsOf = s => s?.beats || [];
const allBeats = () => S.sites.flatMap(s => beatsOf(s).map(b => ({ ...b, siteId: s.id, siteName: s.name })));
function beatAppliesTo(b, emp, shift) { return (b.shift === 'ALL' || !b.shift || b.shift === shift) && (!b.assignees?.length || b.assignees.includes(emp.id)); }
/** Visits of one checkpoint set by a person in [start, end): QR scans (ok) + positions within the radius */
function beatVisits(personId, beat, start, end, pings) {
  const out = [];
  for (const x of Object.values(S.scans || {})) if (x.personId === personId && x.beatId === beat.id && x.ok && x.ts >= start && x.ts < end) out.push({ cp: x.checkpointId, ts: x.ts, src: 'scan' });
  const pts = [...(pings?.[personId] || []).filter(p => p[0] >= start && p[0] < end).map(p => ({ ts: p[0], lat: p[1], lng: p[2], acc: p[3] || 0 })),
    ...Object.values(S.punches || {}).filter(p => p.wid === personId && p.ts >= start && p.ts < end).map(p => ({ ts: p.ts, lat: p.lat, lng: p.lng, acc: p.acc || 0 }))];
  for (const p of pts) for (const c of beat.checkpoints || []) if (LSAPI.distance(p, c) - Math.min(p.acc, 30) <= (+c.radius || 25)) out.push({ cp: c.id, ts: p.ts, src: 'gps' });
  return out.sort((a, b) => a.ts - b.ts);
}
/** Every shift (check-in → check-out) in the range at a site with a beat that applies → rounds */
async function beatReport(from, to, filter = () => true) {
  const pings = await PINGS.load(), hours = (+S.settings.shiftHours || 12) * 3600000, rows = [];
  const ins = Object.values(S.punches || {}).filter(p => p.type === 'in' && p.status !== 'rejected' && p.workDate >= from && p.workDate <= to).sort((a, b) => a.ts - b.ts);
  for (const p of ins) {
    const emp = IX.emp.get(p.wid), site = IX.site.get(p.siteId); if (!emp || !site || !beatsOf(site).length || !filter(emp, site)) continue;
    const out = Object.values(S.punches).find(o => o.type === 'out' && o.wid === p.wid && o.ts > p.ts && o.ts - p.ts < 18 * 3600000);
    const end = Math.min(out ? out.ts : p.ts + hours, Date.now()), shift = shiftOn(emp, p.workDate) || emp.shift || 'DAY';
    for (const b of beatsOf(site)) {
      if (!beatAppliesTo(b, emp, shift) || !(b.checkpoints || []).length) continue;
      const r = beatRoundsCore(b, p.ts, end, beatVisits(emp.id, b, p.ts, end, pings));
      rows.push({ emp, site, beat: b, date: p.workDate, start: p.ts, end, ...r });
    }
  }
  return rows;
}

/* ---------- Projects & sites: list of beats ---------- */
function beatsSectionHTML() {
  const bs = allBeats();
  return sec('beats', `Patrol beats <span class="cnt">${bs.length} beat(s) · ${bs.reduce((a, b) => a + (b.checkpoints?.length || 0), 0)} checkpoints</span>`, `
    <div class="row" style="margin-bottom:8px"><select id="pb-site">${opts(S.sites.filter(s => sitePins(s).length).map(s => [s.id, `${s.name} · ${projOfSite(s.id)?.name || '—'}`]).sort((a, b) => a[1].localeCompare(b[1])), '', 'Pick a site with a location…')}</select>
      <button class="btn sm pri" id="pb-add">Add patrol beat</button><span class="muted small">Checkpoints are visited in rounds: by scanning the QR sticker on the phone, or automatically when the recorded route passes within the checkpoint radius.</span></div>
    ${bs.length ? `<div class="tw" style="max-height:260px"><table><thead><tr><th>Site</th><th>Beat</th><th>Shift</th><th class="num">Round every</th><th class="num">Checkpoints</th><th>Assigned</th><th></th></tr></thead><tbody>
    ${bs.map(b => `<tr><td>${esc(b.siteName)}</td><td><b>${esc(b.name)}</b></td><td>${esc(b.shift || 'ALL')}</td><td class="num">${b.everyMin || 60} min</td><td class="num">${b.checkpoints?.length || 0}</td>
      <td class="small">${b.assignees?.length ? b.assignees.map(id => esc(IX.emp.get(id)?.name || id)).slice(0, 3).join(', ') + (b.assignees.length > 3 ? ` +${b.assignees.length - 3}` : '') : '<span class="muted">everyone on the site</span>'}</td>
      <td style="white-space:nowrap"><button class="btn sm" data-pbe="${b.siteId}|${b.id}">Edit</button> <button class="btn sm" data-pbq="${b.siteId}|${b.id}">QR stickers</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small" style="margin:0">No patrol beats yet.</p>'}`);
}
function bindBeatsSection(v) {
  if ($('#pb-add', v)) $('#pb-add', v).onclick = () => { const s = $('#pb-site', v).value; if (!s) return toast('Pick a site first'); editBeat(s, null); };
  v.querySelectorAll('[data-pbe]').forEach(b => b.onclick = () => { const [s, id] = b.dataset.pbe.split('|'); editBeat(s, id); });
  v.querySelectorAll('[data-pbq]').forEach(b => b.onclick = () => { const [s, id] = b.dataset.pbq.split('|'); printBeatQR(s, id); });
}

/* ---------- edit a beat: checkpoints on the map, assignees ---------- */
function editBeat(siteId, beatId) {
  const site = IX.site.get(siteId); if (!site) return;
  const old = beatsOf(site).find(b => b.id === beatId);
  const b = old ? JSON.parse(JSON.stringify(old)) : { id: uid('b'), name: 'Beat ' + (beatsOf(site).length + 1), shift: 'ALL', everyMin: 60, assignees: [], checkpoints: [] };
  const today = todayISO(), people = S.employees.filter(e => employedOn(e, today) && (siteOn(e, today) === siteId || b.assignees.includes(e.id))).sort((a, c) => a.name.localeCompare(c.name));
  const m = openModal(`${old ? 'Edit' : 'Add'} patrol beat · ${site.name}`, `
    <div class="form"><label class="f">Beat name<input type="text" id="be-name" value="${esc(b.name)}"></label>
      <label class="f">Shift<select id="be-shift">${opts([['ALL', 'Day and night'], ['DAY', 'Day'], ['NIGHT', 'Night']], b.shift || 'ALL')}</select></label>
      <label class="f">One round every (minutes)<input type="number" id="be-every" min="10" step="5" value="${b.everyMin || 60}"></label></div>
    <div class="split" style="grid-template-columns:1fr 330px;gap:12px;margin-top:10px">
      <div><div class="mapbox tall" id="be-map"></div><p class="muted small" style="margin:6px 0 0">Click the map to add a checkpoint; drag a marker to move it. The dashed circle is the site zone.</p></div>
      <div><h3 style="margin:0 0 6px">Checkpoints <span class="muted small">in patrol order</span></h3><div id="be-cps"></div>
        <h3 style="margin:14px 0 6px">Assigned security personnel <span class="muted small">– none ticked = everyone on the site</span></h3>
        <input type="search" id="be-q" placeholder="Find" style="width:100%;margin-bottom:6px"><div id="be-ppl" style="max-height:220px;overflow:auto;border:1px solid var(--line);border-radius:6px;padding:4px 8px">
        ${people.map(e => `<label class="chk" data-n="${esc(norm(e.name + ' ' + e.empCode))}"><input type="checkbox" data-as="${e.id}" ${b.assignees.includes(e.id) ? 'checked' : ''}> ${esc(e.name)} <span class="mono muted">${esc(e.empCode || '')}</span></label>`).join('') || '<p class="muted small">No one allocated to this site today.</p>'}</div></div></div>`,
    [...(old ? [{ label: 'Delete beat', cls: 'bad', onClick: async () => { if (!await confirmBox(`Delete the patrol beat "${old.name}"?`, 'Delete', 'bad')) return false; site.beats = beatsOf(site).filter(x => x.id !== old.id); markDirty(); renderAll(); } }] : []),
     { label: 'Cancel' },
     { label: 'Save', cls: 'pri', onClick: m => {
        b.name = $('#be-name', m).value.trim() || b.name; b.shift = $('#be-shift', m).value; b.everyMin = Math.max(10, +$('#be-every', m).value || 60);
        b.assignees = [...m.querySelectorAll('[data-as]:checked')].map(c => c.dataset.as);
        if (!b.checkpoints.length) { toast('Add at least one checkpoint on the map'); return false; }
        site.beats = [...beatsOf(site).filter(x => x.id !== b.id), b]; markDirty(); renderAll();
        if (S.employees.some(e => e.app?.on)) toast('Beat saved – Publish roster (App & review) to send it to the phones', 5000);
      } }], { width: 'min(1300px,94vw)' });
  $('#be-q', m).oninput = e => { const q = norm(e.target.value); m.querySelectorAll('#be-ppl [data-n]').forEach(l => l.hidden = q && !l.dataset.n.includes(q)); };
  let map = null, layer = null; const L = () => window.L;
  const cpsTable = () => {
    $('#be-cps', m).innerHTML = b.checkpoints.length ? `<table><thead><tr><th>#</th><th>Name</th><th class="num">Radius m</th><th></th></tr></thead><tbody>${b.checkpoints.map((c, i) => `<tr><td>${i + 1}</td><td><input type="text" data-cn="${i}" value="${esc(c.name)}" style="width:100%"></td><td class="num"><input type="number" data-cr="${i}" value="${c.radius || 25}" min="5" max="200" style="width:60px"></td>
      <td style="white-space:nowrap">${i ? `<button class="btn sm" data-cu="${i}" title="Earlier">↑</button>` : ''}<button class="btn sm bad" data-cd="${i}" title="Remove">✕</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted small">No checkpoints yet – click the map.</p>';
    m.querySelectorAll('[data-cn]').forEach(i => i.oninput = () => { b.checkpoints[+i.dataset.cn].name = i.value; });
    m.querySelectorAll('[data-cr]').forEach(i => i.onchange = () => { b.checkpoints[+i.dataset.cr].radius = Math.max(5, +i.value || 25); draw(); });
    m.querySelectorAll('[data-cd]').forEach(x => x.onclick = () => { b.checkpoints.splice(+x.dataset.cd, 1); cpsTable(); draw(); });
    m.querySelectorAll('[data-cu]').forEach(x => x.onclick = () => { const i = +x.dataset.cu; [b.checkpoints[i - 1], b.checkpoints[i]] = [b.checkpoints[i], b.checkpoints[i - 1]]; cpsTable(); draw(); });
  };
  const draw = () => {
    if (!map) return; layer?.remove(); layer = L().layerGroup().addTo(map);
    b.checkpoints.forEach((c, i) => {
      L().circle([c.lat, c.lng], { radius: +c.radius || 25, color: '#1F8A5B', weight: 1.5, fillOpacity: .12 }).addTo(layer);
      const mk = L().marker([c.lat, c.lng], { draggable: true, icon: L().divIcon({ className: 'cp-pin', html: `<span>${i + 1}</span>`, iconSize: [24, 24] }) }).addTo(layer).bindTooltip(c.name);
      mk.on('dragend', () => { const p = mk.getLatLng(); c.lat = +p.lat.toFixed(6); c.lng = +p.lng.toFixed(6); draw(); });
    });
    if (b.checkpoints.length > 1) L().polyline(b.checkpoints.map(c => [c.lat, c.lng]), { color: '#1F8A5B', weight: 2, dashArray: '4 6' }).addTo(layer);
  };
  cpsTable();
  const pin = sitePins(site)[0];
  LSMap.create($('#be-map', m), { zoom: 18, center: pin ? [pin.lat, pin.lng] : undefined, satellite: true }).then(mp => {
    map = mp; for (const p of sitePins(site)) { const z = LSMap.zone(map, p, { label: site.name, fill: .04, marker: false }); z.c?.setStyle?.({ dashArray: '6 6' }); }
    map.on('click', e => { b.checkpoints.push({ id: uid('cp'), name: 'Checkpoint ' + (b.checkpoints.length + 1), lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6), radius: 25 }); cpsTable(); draw(); });
    draw(); if (b.checkpoints.length) map.fitBounds(b.checkpoints.map(c => [c.lat, c.lng]), { padding: [40, 40], maxZoom: 19 });
  }).catch(e => { $('#be-map', m).innerHTML = `<p class="muted" style="padding:12px">${esc(e.message)}</p>`; });
}

/* ---------- QR stickers ---------- */
const beatQRText = (siteId, cpId) => `LSCP|${siteId}|${cpId}`;
async function printBeatQR(siteId, beatId) {
  const site = IX.site.get(siteId), b = beatsOf(site).find(x => x.id === beatId); if (!b) return;
  await loadScript('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js');
  const qr = t => { const q = qrcode(0, 'M'); q.addData(t); q.make(); return q.createDataURL(6, 3); };
  printHTML(`<div class="sheet port cpsheet">${b.checkpoints.map((c, i) => `<div class="cpst"><img src="${qr(beatQRText(siteId, c.id))}" alt=""><div><b>${esc(c.name)}</b><span>${esc(site.name)} · ${esc(b.name)} · checkpoint ${i + 1} of ${b.checkpoints.length}</span><small>Latinem Securities – scan with “Scan checkpoint” in the LS Attendance app</small></div></div>`).join('')}</div>`);
}
