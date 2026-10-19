/* =====================================================================
   Ask Claude – an assistant that analyses the tracker's data: security
   personnel and HR details, attendance, check-ins / check-outs, shift
   positions (routes), sites and zones.
   - For now runs through the Claude CLI on this PC: tools/claude-bridge.mjs
     passes the question to `claude -p` (the user's own Claude sign-in, no
     API key in the page). An Azure server-side key can replace it later.
   - Claude never reads the data set: it writes small read-only JavaScript
     analyses, run over a snapshot with the helpers below; only the
     results go back to Claude.
   ===================================================================== */
const AI = {
  MODELS: [['', 'Default'], ['claude-opus-5-5', 'Most capable'], ['claude-sonnet-5-5', 'Balanced'], ['claude-haiku-5-5', 'Fastest']],
  chat: '', asked: 0, busy: false, worker: null, ready: null, open: false,
  get bridge() { try { return localStorage.getItem('ls.claudeBridge') || 'http://localhost:8787'; } catch (e) { return 'http://localhost:8787'; } },
  set bridge(v) { try { v ? localStorage.setItem('ls.claudeBridge', v) : localStorage.removeItem('ls.claudeBridge'); } catch (e) { } },
  get model() { try { return localStorage.getItem('ls.claudeModel') || ''; } catch (e) { return ''; } },
  set model(v) { try { localStorage.setItem('ls.claudeModel', v); } catch (e) { } },
  get personal() { try { return localStorage.getItem('ls.claudePersonal') === '1'; } catch (e) { return false; } },
  set personal(v) { try { localStorage.setItem('ls.claudePersonal', v ? '1' : '0'); } catch (e) { } this.ready = null; }
};

/* ---------- data snapshot for the analyses ---------- */
async function aiSnapshot() {
  const today = todayISO(), pings = await PINGS.load(), personal = AI.personal;
  const P = S.employees.map(e => {
    const a = assignOn(e, today) || e.assign?.[e.assign.length - 1], hr = e.hr || {};
    const o = {
      id: e.id, code: e.empCode || '', name: e.name, agency: e.agency || '', trade: e.trade || '', designation: hr.designation || e.trade || '', group: hr.group || '',
      category: hr.category || '', gender: hr.gender || '', doj: e.doj || '', end: e.end || '', endReason: e.endReason || '', status: hrStatus(e), left: !!hasLeft(e),
      shift: a?.shift || e.shift || '', siteId: a?.site || '', site: siteName(a?.site), project: projOfSite(a?.site)?.name || '',
      assign: (e.assign || []).map(x => ({ from: x.from, siteId: x.site, shift: x.shift })),
      dob: hr.dob || '', age: ageOf(e) === '' ? null : ageOf(e), serviceYears: serviceYears(e) === '' ? null : serviceYears(e),
      nationality: hr.nationality || '', languages: hr.languages || '', state: hr.state || '', blood: hr.blood || '', licence: hr.licence || '', degree: hr.degree || '', activities: hr.activities || '',
      siraExpiry: hr.siraExpiry || '', visaExpiry: hr.visaExpiry || '', promotedOn: hr.promotedOn || '', promotedTo: hr.promotedTo || '',
      warnings: hr.warnings || '', fines: hr.fines || '', remarks: hr.remarks || '', onApp: !!e.app?.on, hasPhoto: !!e.photo, faceRefs: faceRefs(e).length
    };
    if (personal) Object.assign(o, { passport: hr.passport || '', eid: hr.eid || '', phone: hr.phone || '', phone2: hr.phone2 || '', altContact: hr.altContact || '', homeAddress: hr.homeAddress || '', health: hr.health || '' });
    return o;
  });
  const att = {};
  for (const id in S.att) { const m = att[id] = {}; for (const d in S.att[id]) { const c = getCell(id, d); m[d] = c?.s ? [c.c, c.s] : [c?.c]; } }
  return {
    today, personal,
    personnel: P,
    sites: S.sites.map(s => ({ id: s.id, name: s.name, projectId: s.projectId || '', project: IX.proj.get(s.projectId)?.name || '', pins: sitePins(s).map(p => ({ lat: p.lat, lng: p.lng, radius: +p.radius || 100 })) })),
    projects: S.projects.map(p => ({ id: p.id, name: p.name, code: p.code || '', client: IX.client?.get?.(p.clientId)?.name || '', active: p.active !== false })),
    codes: S.codes.map(c => ({ code: c.code, label: c.label, billable: !!c.billable })),
    attendance: att,
    punches: Object.values(S.punches || {}).map(p => ({ id: p.id, personId: p.wid, type: p.type, ts: p.ts, workDate: p.workDate, lat: p.lat, lng: p.lng, acc: p.acc, siteId: p.siteId, dist: p.dist, inZone: !!p.inZone, status: p.status, reasons: p.reasons || [], flags: p.flags || [], reliever: !!p.reliever, by: p.by || '', face: p.face ? (p.face.d != null ? FACE.verdict(p.face.d) : p.face.none ? 'no face' : 'unclear') : null })),
    pings,
    beats: S.sites.flatMap(st => beatsOf(st).map(b => ({ id: b.id, siteId: st.id, site: st.name, name: b.name, shift: b.shift || 'ALL', everyMin: +b.everyMin || 60, assignees: b.assignees || [], checkpoints: (b.checkpoints || []).map(c => ({ id: c.id, name: c.name, lat: c.lat, lng: c.lng, radius: +c.radius || 25 })) }))),
    scans: Object.values(S.scans || {}).map(x => ({ personId: x.personId, siteId: x.siteId, beatId: x.beatId, checkpointId: x.checkpointId, checkpoint: x.checkpoint, ts: x.ts, dist: x.dist, ok: !!x.ok })),
    shiftHours: +S.settings.shiftHours || 12
  };
}
/** Analysis runner (run by the bridge in an isolated Node context): holds the snapshot, runs Claude's read-only analysis code with helpers H; no network */
const AI_WORKER = `
for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel']) { try { Object.defineProperty(self, k, { value: undefined, configurable: false }); } catch (e) { } }
let D = null;
const rad = x => x * Math.PI / 180;
const H = {
  distance(a, b) { const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng), s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2; return Math.round(12742000 * Math.asin(Math.sqrt(s))); },
  addDays(d, n) { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); },
  daysBetween(a, b) { return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000); },
  addMonths(d, n) { const t = new Date(d.slice(0, 7) + '-01T12:00:00Z'); t.setUTCMonth(t.getUTCMonth() + n); return t.toISOString().slice(0, d.length >= 10 ? 10 : 7); },
  monthOf(d) { return String(d || '').slice(0, 7); },
  dubaiDate(ts) { return new Date(ts + 4 * 3600000).toISOString().slice(0, 10); },
  person(codeOrId) { const q = String(codeOrId).toUpperCase(); return D.personnel.find(p => p.id === codeOrId || p.code === q) || D.personnel.find(p => p.name.includes(q)) || null; },
  site(id) { return D.sites.find(s => s.id === id) || null; },
  siteOn(personId, date) { const a = D.attendance[personId]?.[date]; if (a && a[1]) return a[1]; const p = D.personnel.find(x => x.id === personId); let s = null; for (const x of p?.assign || []) if (x.from <= date) s = x.siteId; return s; },
  codeOn(personId, date) { return D.attendance[personId]?.[date]?.[0] || null; },
  zoneCheck(pt, siteId) { const s = H.site(siteId); if (!s || !s.pins.length) return null; let best = null; for (const p of s.pins) { const d = H.distance(pt, p); if (!best || d < best.d) best = { d, radius: p.radius, inside: d - (pt.acc || 0) <= p.radius }; } return best; },
  positions(personId, from, to) { const t0 = new Date(from + 'T00:00:00+04:00').getTime(), t1 = new Date(to + 'T23:59:59+04:00').getTime() + 12 * 3600000; const out = D.punches.filter(p => p.personId === personId && p.status !== 'rejected' && p.ts >= t0 && p.ts <= t1).map(p => ({ ts: p.ts, lat: p.lat, lng: p.lng, acc: p.acc, kind: p.type })); for (const x of D.pings[personId] || []) if (x[0] >= t0 && x[0] <= t1) out.push({ ts: x[0], lat: x[1], lng: x[2], acc: x[3], kind: 'position' }); return out.sort((a, b) => a.ts - b.ts); },
  beatRounds(personId, from, to) {
    const out = [], person = D.personnel.find(p => p.id === personId); if (!person) return out;
    const ins = D.punches.filter(p => p.personId === personId && p.type === 'in' && p.status !== 'rejected' && p.workDate >= from && p.workDate <= to);
    for (const p of ins) {
      const o = D.punches.find(x => x.personId === personId && x.type === 'out' && x.ts > p.ts && x.ts - p.ts < 18 * 3600000), end = Math.min(o ? o.ts : p.ts + D.shiftHours * 3600000, Date.now());
      for (const b of D.beats.filter(b => b.siteId === p.siteId && (b.shift === 'ALL' || b.shift === person.shift) && (!b.assignees.length || b.assignees.includes(personId)))) {
        const v = D.scans.filter(x => x.personId === personId && x.beatId === b.id && x.ok && x.ts >= p.ts && x.ts < end).map(x => ({ cp: x.checkpointId, ts: x.ts, src: 'scan' }));
        for (const q of H.positions(personId, p.workDate, p.workDate)) if (q.ts >= p.ts && q.ts < end) for (const c of b.checkpoints) if (H.distance(q, c) - Math.min(q.acc || 0, 30) <= c.radius) v.push({ cp: c.id, ts: q.ts, src: 'gps' });
        const r = beatRoundsCore(b, p.ts, end, v);
        out.push({ date: p.workDate, beat: b.name, site: b.site, expected: r.expected, done: r.done, completion: r.completion, scanned: r.scanned, gps: r.gps, missed: Object.entries(r.missed).map(([id, n]) => ({ checkpoint: (b.checkpoints.find(c => c.id === id) || {}).name || id, rounds: n })) });
      }
    }
    return out;
  },
  beatCompliance(personId, from, to) { let n = 0, out = 0; const where = []; for (const x of H.positions(personId, from, to)) { const site = H.siteOn(personId, H.dubaiDate(x.ts)); const z = site && H.zoneCheck(x, site); if (!z) continue; n++; if (!z.inside) { out++; if (where.length < 5) where.push({ at: new Date(x.ts).toISOString(), metresFromPin: z.d }); } } return { positions: n, outside: out, shareOutside: n ? Math.round(1000 * out / n) / 10 : null, examples: where }; }
};
self.onmessage = e => {
  const m = e.data;
  if (m.snapshot) { D = m.snapshot; return; }
  try {
    const fn = new Function('D', 'H', '"use strict";\\n' + m.code);
    let r = fn(D, H); if (r === undefined) r = null;
    let s = JSON.stringify(r); if (s === undefined) s = 'null';
    postMessage({ id: m.id, ok: true, result: s.length > 30000 ? s.slice(0, 30000) + ' …[truncated – return less data, e.g. counts or the first 50 rows]' : s });
  } catch (err) { postMessage({ id: m.id, ok: false, result: String(err && err.stack || err).split('\\n').slice(0, 4).join('\\n') }); }
};`;
/* ---------- Claude ---------- */
const AI_SYSTEM = () => `You are "the LS assistant", the analysis assistant inside the Latinem Securities (LS) Attendance Tracker, a Dubai security-guarding company. The user is an LS manager. Answer questions about security personnel, HR details, attendance, check-ins / check-outs, shift routes, sites and zones by computing from the data – never guess numbers.

Today is ${todayISO()} (Dubai time, UTC+4). Dates are ISO strings YYYY-MM-DD; timestamps (ts) are epoch milliseconds.

HOW TO WORK
- Compute with the Bash tool, always exactly in this form (set the Bash description to one short line shown to the user, e.g. "Visas expiring in November"):
  node analyse.mjs <<'EOF'
  <JavaScript function body that receives D (data) and H (helpers) and returns a small JSON-serialisable result>
  EOF
  It prints the JSON result. Return counts, short lists or top-N – never the whole data set. Several small analyses are better than one huge one. Do not read or list files; everything is reachable through D and H.
- State the assumption behind any interpretation (for example "next month = ${(() => { const d = new Date(todayISO() + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 7); })()}").
- Never mention Claude, Anthropic, models, tools, Bash, files or analyse.mjs to the user – just say what you checked (e.g. "I checked the visa dates").
- Answer in short, plain sentences, then a compact Markdown table when listing people (Emp code, name, site/project, the relevant value). Mention how many rows you left out.
- "Beats" = patrol beats (D.beats): checkpoints at a site visited in rounds every everyMin minutes, by QR scan (D.scans) or by a recorded position within the checkpoint radius. Use H.beatRounds for who completed their rounds / missed checkpoints. Where a site has no beat, "following the beat" means staying inside the allocated site's zone – use H.beatCompliance. Positions exist only for people using the phone app.
- Personnel who have left (left = true) are excluded unless the question is about them.${AI.personal ? '' : '\n- Passport, Emirates ID, phone numbers, home address and health details are not shared with you; say so if asked.'}

DATA (D)
- D.today
- D.personnel[]: id, code (Emp ID, e.g. C14521), name, agency ('' = LS staff), trade, designation, group (list section), category, gender (M/F), doj, end (last working day or ''), endReason, status (ACTIVE / RESIGNED / …), left (bool), shift (DAY/NIGHT), siteId, site, project (current allocation), assign[{from, siteId, shift}] (allocation history), dob, age, serviceYears, nationality, languages, state, blood, licence (YES/NO), degree, activities, siraExpiry, visaExpiry, promotedOn, promotedTo, warnings, fines, remarks, onApp (bool), hasPhoto, faceRefs${AI.personal ? ', passport, eid, phone, phone2, altContact, homeAddress, health' : ''}
- D.sites[]: id, name, projectId, project, pins[{lat, lng, radius metres}]
- D.projects[]: id, name, code, client, active
- D.codes[]: code, label, billable – attendance codes: P present, R reliever (present at another site), A absent, OFF day off, SL/AL/EL/UL leave types, SIRA training…
- D.attendance[personId][date] = [code] or [code, siteIdWhenRelieving]
- D.punches[]: id, personId, type ('in'/'out'), ts, workDate, lat, lng, acc (GPS ± metres), siteId, dist (m from pin), inZone, status (accepted / pending / rejected), reasons[], flags[] (e.g. 'late 12 min', 'offline', 'early leave'), reliever, by, face ('match' / 'unsure' / 'different' / 'no face' / null)
- D.pings[personId] = [[ts, lat, lng, acc], …] – positions recorded during shifts (every ~5–10 min)
- D.beats[]: id, siteId, site, name, shift (ALL/DAY/NIGHT), everyMin, assignees[personId] (empty = everyone at the site), checkpoints[{id, name, lat, lng, radius}]
- D.scans[]: personId, siteId, beatId, checkpointId, checkpoint, ts, dist (m from checkpoint), ok (false = scanned far away)

HELPERS (H)
distance(a,b) metres · addDays(d,n) · addMonths(d,n) · daysBetween(a,b) · monthOf(d) · dubaiDate(ts) · person(codeOrIdOrName) · site(id) · siteOn(personId,date) · codeOn(personId,date) · zoneCheck({lat,lng,acc}, siteId) → {d, radius, inside} · positions(personId, from, to) → [{ts,lat,lng,acc,kind}] · beatRounds(personId, from, to) → [{date, beat, site, expected, done, completion %, scanned, gps, missed[{checkpoint, rounds}]}] · beatCompliance(personId, from, to) → {positions, outside, shareOutside %, examples}

Example: const next = H.addMonths(D.today, 1).slice(0, 7); return D.personnel.filter(p => !p.left && p.visaExpiry.startsWith(next)).map(p => [p.code, p.name, p.visaExpiry]);`;
/** worker code + snapshot go to the bridge, which runs the same analyses with the claude CLI */
async function aiAsk(text) {
  if (AI.busy || !text.trim()) return;
  AI.busy = true; aiPaint();
  const box = $('#ai-log'), turn = document.createElement('div'); turn.className = 'ai-turn';
  turn.innerHTML = `<div class="ai-q">${esc(text)}</div><div class="ai-a"><div class="ai-steps"></div><div class="ai-text"><span class="ai-dots">Thinking…</span></div></div>`;
  box.appendChild(turn); box.scrollTop = box.scrollHeight;
  const steps = $('.ai-steps', turn), out = $('.ai-text', turn), st = {}; let shown = '';
  const show = () => { out.innerHTML = aiMarkdown(shown) || '<span class="ai-dots">Thinking…</span>'; box.scrollTop = box.scrollHeight; };
  AI.chat ||= Math.random().toString(36).slice(2);
  try {
    const r = await fetch(AI.bridge.replace(/\/+$/, '') + '/ask', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat: AI.chat, question: text, model: AI.model, system: AI_SYSTEM(), worker: AI_WORKER + '\n' + beatRoundsCore.toString(), snapshot: await aiSnapshot() }) })
      .catch(() => { throw new Error(`The assistant is offline – it could not reach ${AI.bridge}. On this PC start tools/Start Assistant.cmd (or node tools/claude-bridge.mjs) and keep it open.`); });
    if (!r.ok) throw new Error(`Bridge: ${r.status} ${await r.text()}`);
    const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '', end = null;
    for (;;) {
      const { value, done } = await rd.read(); if (done) break;
      buf += dec.decode(value, { stream: true }); let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
        if (m.t === 'text') { shown += m.d; show(); }
        else if (m.t === 'turn') { if (shown && !shown.endsWith('\n\n')) shown += '\n\n'; }
        else if (m.t === 'step') { const d = st[m.id] = document.createElement('details'); d.className = 'ai-step'; d.innerHTML = `<summary>${esc(m.purpose || 'Analysing')}…</summary><pre>${esc(m.code)}</pre>`; steps.appendChild(d); }
        else if (m.t === 'result' && st[m.id]) { const d = st[m.id]; d.querySelector('summary').textContent = `${m.ok ? '✓' : '✕'} ${d.querySelector('summary').textContent.replace(/…$/, '')}`; d.insertAdjacentHTML('beforeend', `<pre class="res">${esc(m.result.slice(0, 2000))}</pre>`); }
        else if (m.t === 'done') end = m;
      }
    }
    if (!end) throw new Error('The assistant stopped before finishing – try again.');
    if (!end.ok) throw new Error(/login|auth|sign/i.test(end.error) ? 'The assistant engine on this PC is not signed in – run `claude` once in a terminal and sign in.' : end.error || 'The assistant could not answer – try again.');
    if (!shown.trim()) shown = end.text;
    AI.asked++;
  } catch (e) {
    shown += (shown ? '\n\n' : '') + '**' + (e?.message || String(e)) + '**';
  } finally { AI.busy = false; show(); aiPaint(); }
}
/** Small Markdown: headings, bold, italics, inline code, lists, tables, code blocks */
function aiMarkdown(md) {
  const lines = esc(md).split('\n'), out = []; let i = 0;
  const inl = s => s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>').replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, '$1<i>$2</i>');
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) { const b = []; i++; while (i < lines.length && !/^```/.test(lines[i])) b.push(lines[i++]); i++; out.push(`<pre>${b.join('\n')}</pre>`); continue; }
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      const row = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const h = row(l); i += 2; const rows = []; while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(row(lines[i++]));
      out.push(`<div class="ai-tw"><table><thead><tr>${h.map(c => `<th>${inl(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inl(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`); continue;
    }
    if (/^#{1,4}\s/.test(l)) { out.push(`<h4>${inl(l.replace(/^#+\s*/, ''))}</h4>`); i++; continue; }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) { const ol = /^\s*\d+\./.test(l), it = []; while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) it.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, '')); out.push(`<${ol ? 'ol' : 'ul'}>${it.map(x => `<li>${inl(x)}</li>`).join('')}</${ol ? 'ol' : 'ul'}>`); continue; }
    if (!l.trim()) { i++; continue; }
    const p = []; while (i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|\s*([-*]|\d+\.)\s|\s*\|)/.test(lines[i])) p.push(lines[i++]); out.push(`<p>${inl(p.join('<br>'))}</p>`);
  }
  return out.join('');
}

/* ---------- panel ---------- */
const AI_SUGGEST = ['Whose visa expires next month?', 'Who is not completing their patrol rounds this week?', 'Who is not staying within their assigned site zone during shifts this week?', 'Which sites had the most absences this month?', 'Who was late for check-in more than 3 times in the last 30 days?', 'Whose SIRA expires in the next 60 days?', 'Summarise today: on duty, not checked in, punches to review'];
function aiToggle(force) {
  AI.open = force ?? !AI.open; let p = $('#ai-panel');
  if (!AI.open) { p?.remove(); return; }
  if (!p) { p = document.createElement('aside'); p.id = 'ai-panel'; p.className = 'ai-panel'; document.body.appendChild(p); }
  p.innerHTML = `<div class="ai-h"><b>Assistant</b><span class="pill">beta</span><span class="spacer"></span>
      <button class="btn sm" id="ai-new" title="Start a new conversation">New chat</button><button class="btn sm" id="ai-set" title="Settings">⚙</button><button class="btn sm" id="ai-x" title="Close">✕</button></div>
    <div class="ai-settings" id="ai-settings" hidden>
      <label class="f">Assistant engine address <span class="muted">(on this PC run <code>tools/Start Assistant.cmd</code>)</span><input type="text" id="ai-bridge" value="${esc(AI.bridge)}" placeholder="http://localhost:8787" autocomplete="off"></label>
      <label class="f">Model<select id="ai-model">${opts(AI.MODELS, AI.model)}</select></label>
      <label class="chk"><input type="checkbox" id="ai-personal" ${AI.personal ? 'checked' : ''}> Let the assistant use passport, Emirates ID, phone numbers, home address and health details</label>
      <p class="muted small">Questions and the results of each analysis go to the assistant engine signed in on this PC. The data snapshot stays on this PC and is analysed there.</p>
      <button class="btn sm pri" id="ai-save">Save</button></div>
    <div class="ai-log" id="ai-log">${AI.asked ? '' : `<div class="ai-hello"><p>Ask about personnel, documents, attendance, check-ins, routes and zones. The assistant works out the answer from the data in this tracker.</p>
      <div class="ai-chips">${AI_SUGGEST.map(q => `<button class="chip" data-aq="${esc(q)}">${esc(q)}</button>`).join('')}</div></div>`}</div>
    <form class="ai-in" id="ai-form"><textarea id="ai-q" rows="2" placeholder="e.g. How many people have their visa expiring next month?"></textarea><button class="btn pri" id="ai-send">Ask</button></form>`;
  $('#ai-x').onclick = () => aiToggle(false);
  $('#ai-set').onclick = () => { $('#ai-settings').hidden = !$('#ai-settings').hidden; };
  $('#ai-save').onclick = () => { AI.bridge = $('#ai-bridge').value.trim(); AI.model = $('#ai-model').value; AI.personal = $('#ai-personal').checked; $('#ai-settings').hidden = true; toast('Saved'); };
  $('#ai-new').onclick = () => { AI.chat = ''; AI.asked = 0; aiToggle(true); };
  p.querySelectorAll('[data-aq]').forEach(b => b.onclick = () => { $('#ai-q').value = b.dataset.aq; $('#ai-form').requestSubmit(); });
  $('#ai-form').onsubmit = e => { e.preventDefault(); const q = $('#ai-q').value; if (!q.trim()) return; $('#ai-q').value = ''; p.querySelector('.ai-hello')?.remove(); aiAsk(q); };
  $('#ai-q').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#ai-form').requestSubmit(); } };
  aiPaint(); $('#ai-q').focus();
}
function aiPaint() { const b = $('#ai-send'); if (b) { b.disabled = AI.busy; b.textContent = AI.busy ? '…' : 'Ask'; } }
// data changed (sync, import, edits): the next analysis uses a fresh snapshot
function aiDataChanged() { AI.ready = null; }
