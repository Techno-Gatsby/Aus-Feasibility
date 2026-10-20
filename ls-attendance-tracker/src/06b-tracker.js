/* =====================================================================
   Billing → 3 Tracker: a copy of the "Tax Invoice Tracker" sheet of
   Trackers.xlsx – its groups (A SCL & Infra … H Factories) and rows in
   the workbook's order, and per month Timesheet (submitted / approved),
   Tax Invoice (submitted, processing, invoice no, SPC no, amount) and
   Payment received.
   - S.trkLayout keeps the groups and rows; a row linked to a project
     follows it (renamed in Projects & sites → new description, deleted →
     row gone). Projects on no row are added at the end of their client's
     group, marked new, so the list follows Projects & sites.
   - A month covered by a saved invoice reads and writes that invoice
     (no, amount, and its Track dates); other months keep their own
     entries in S.billTrack["projectId or rowId|YYYY-MM"].
   ===================================================================== */
const TRK_SECT = [['Timesheet', 2], ['Tax Invoice', 5], ['Payment', 1]];
const TRK_F = [['tsSent', 'Submission to Client - Date', 'date'], ['tsApproved', 'Approval From Client - Date', 'date'], ['invSent', 'Invoice Submission to Client - Date', 'date'], ['invProcessed', 'Invoice Processing - Date', 'date'],
  ['invNo', 'Invoice No', 'text'], ['spcNo', 'SPC No', 'text'], ['amount', 'Amount', 'number'], ['paidOn', 'Payment Received Date', 'date']];
/* the workbook's own header wording (row 3 and 4), written as-is into the Excel download */
const TRK_XL_SECT = ['Timesheet', 'Tax Invoice', 'Payment    '];
const TRK_XL_F = ['Submission to  Client -\nDate', 'Approval From Client - Date', 'Invoice Submission to Client - Date', 'Invoice Processing - Date ', 'Invoice No', 'SPC No', 'Amount', 'Payment \nReceived\nDate'];
const TR = { y: +todayISO().slice(0, 4), m0: 0, m1: 11, q: '', inact: false, hint: true, hidden: false };
/** dates as typed in the workbook: 01.10.2026 (anything that is not a date is shown as it was written) */
const trkDate = x => /^\d{4}-\d\d-\d\d$/.test(x || '') ? `${x.slice(8, 10)}.${x.slice(5, 7)}.${x.slice(0, 4)}` : String(x ?? '');
function trkParseDate(s) {
  s = String(s ?? '').trim(); if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/); if (m && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  return null;
}
const trkLetter = i => colL(i);
/** Tax Invoice Tracker sheet (rows as arrays, column A = 0) → { groups: [{ name, rows: [desc] }], vals: [{ g, r, ym, k, v }] } */
function trkParse(rows) {
  const p2 = n => String(n).padStart(2, '0');
  const iso = x => typeof x === 'number' ? new Date(Math.round((x - 25569) * 864e5)).toISOString().slice(0, 10) : x instanceof Date ? x.toISOString().slice(0, 10) : null;
  const h = rows.findIndex(r => String(r?.[1] ?? '').trim().toLowerCase() === 'sl.no'); if (h < 0) throw new Error('This is not the Tax Invoice Tracker sheet (no “Sl.No” header)');
  const months = []; for (let c = 4; c < (rows[h] || []).length; c += 9) { const d = iso(rows[h][c]) || (/^\d{4}-\d\d/.test(rows[h][c] || '') ? rows[h][c] : null); if (!d) break; months.push([c, d.slice(0, 7)]); }
  const F = ['tsSent', 'tsApproved', 'invSent', 'invProcessed', 'invNo', 'spcNo', 'amount', 'paidOn'], groups = [], vals = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] || [], sl = r[1], d = String(r[2] ?? '').replace(/\s+/g, ' ').trim(); if (!d) continue;
    if (typeof sl === 'string' && /^[A-Z]{1,2}$/.test(sl.trim())) { groups.push({ name: d, rows: [] }); continue; }
    if (!groups.length) continue;
    const g = groups.length - 1, ri = groups[g].rows.push(d) - 1;
    for (const [c, ym] of months) F.forEach((k, j) => {
      let x = r[c + j]; if (x == null || x === '') return;
      if (k === 'amount') x = typeof x === 'number' ? x : +String(x).replace(/,/g, '') || String(x);
      else if (k === 'invNo' || k === 'spcNo') x = String(x).trim();
      else { const t = iso(x); if (t) x = t; else { const m = String(x).trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/); x = m ? `${m[3]}-${p2(m[2])}-${p2(m[1])}` : String(x).trim(); } }
      vals.push({ g, r: ri, ym, k, v: x });
    });
  }
  return { groups, vals };
}
/** parsed sheet → st.trkLayout (rows keep their ids when the description is the same) + values into st.billTrack */
function trkBuild(st, parsed) {
  const old = new Map(); for (const g of st.trkLayout?.groups || []) for (const r of g.rows) old.set(norm(r.desc), r);
  const byTn = new Map(); for (const p of st.projects) if (p.trackerName) byTn.set(norm(p.trackerName), p.id);
  const used = new Set(), groups = parsed.groups.map((g, gi) => ({ id: st.trkLayout?.groups?.find(x => norm(x.name) === norm(g.name))?.id || uid('tg'), name: g.name, rows: g.rows.map(d => {
    const o = old.get(norm(d)); let pid = o?.projectId && st.projects.some(p => p.id === o.projectId) ? o.projectId : byTn.get(norm(d)) || null;
    if (pid && used.has(pid)) pid = null; if (pid) used.add(pid);
    return { id: o?.id || uid('tr'), desc: d, projectId: pid };
  }) }));
  st.trkLayout = { groups, hidden: st.trkLayout?.hidden || [] }; st.billTrack ||= {};
  for (const x of parsed.vals) { const r = groups[x.g].rows[x.r], key = `${r.projectId || r.id}|${x.ym}`; (st.billTrack[key] ||= {})[x.k] = x.v; }
  return st.trkLayout;
}
/** the saved invoice that bills this project for this month (latest saved wins) */
function invFor(pid, ym) {
  let best = null;
  for (const x of S.invoices) if (x.projectIds?.includes(pid) && x.from <= ym && ym <= x.to && (!best || (x.savedAt || '') > (best.savedAt || ''))) best = x;
  return best;
}
/** this project's share of the invoice for the month, incl. VAT */
function invShare(x, pid, ym) {
  let a = 0, hit = false;
  for (const l of x.lines || []) if (l.src?.pid === pid && l.src?.m === ym) { a += (+l.amount || 0) * (1 + (+l.vat || 0) / 100); hit = true; }
  if (!hit && x.projectIds.length === 1 && x.from === x.to) return round2(invTotals(x).inc);
  return hit ? round2(a) : null;
}
/** values of one project-month: { v: {field: value}, inv } */
function trackCell(pid, ym) {
  const inv = invFor(pid, ym), man = S.billTrack[`${pid}|${ym}`] || {}, v = {};
  for (const [k] of TRK_F) v[k] = man[k] ?? '';
  if (inv) {
    const t = inv.track || {};
    for (const k of ['tsSent', 'tsApproved', 'invSent', 'invProcessed', 'spcNo', 'paidOn']) if (t[k]) v[k] = t[k];
    if (inv.no) v.invNo = inv.no;
    const a = invShare(inv, pid, ym); if (a != null) v.amount = a;
  }
  return { v, inv };
}
function trackSet(pid, ym, k, val) {
  const inv = invFor(pid, ym);
  if (inv && !['invNo', 'amount'].includes(k)) {
    inv.track ||= {}; if (val === '') delete inv.track[k]; else inv.track[k] = val;
    if (IV.draft?.id === inv.id) { IV.draft.track ||= {}; IV.draft.track[k] = inv.track[k]; }
  } else {
    const key = `${pid}|${ym}`, r = S.billTrack[key] ||= {};
    if (val === '') delete r[k]; else r[k] = k === 'amount' ? round2(+val) : val;
    if (!Object.keys(r).length) delete S.billTrack[key];
  }
  markDirty();
}
const trkHasData = (key, y) => Array.from({ length: 12 }, (_, i) => `${y}-${pad(i + 1)}`).some(ym => { const { v, inv } = trackCell(key, ym); return inv || TRK_F.some(([k]) => v[k] !== ''); });
/** the workbook's groups and rows in its order; a row linked to a project follows that project (renamed → new description,
    deleted → gone). Projects that are on no row are added at the end of their client's group (or a new group), marked new. */
function trackerRows() {
  const L = S.trkLayout || { groups: [] }, q = TR.q.trim().toLowerCase(), linked = new Set(), hidden = new Set(L.hidden || []), groups = [];
  for (const [gi, g] of L.groups.entries()) {
    const rows = [], clients = new Set();
    for (const r of g.rows) {
      const p = r.projectId ? IX.proj.get(r.projectId) : null; if (r.projectId && !p) continue;     // project deleted in Projects & sites
      if (p) { linked.add(p.id); if (p.clientId) clients.add(p.clientId); }
      rows.push({ key: p?.id || r.id, desc: p ? p.trackerName || p.name : r.desc, p, row: r, g });
    }
    groups.push({ id: g.id, name: g.name, letter: trkLetter(gi), rows, clients, g });
  }
  const extra = S.projects.filter(p => !linked.has(p.id) && (TR.hidden || !hidden.has(p.id)) && (TR.inact || p.active !== false || trkHasData(p.id, TR.y))).sort((a, b) => (a.trackerName || a.name).localeCompare(b.trackerName || b.name));
  for (const p of extra) {
    let g = groups.find(x => x.clients.has(p.clientId));
    if (!g) { g = groups.find(x => x.byClient === (p.clientId || '-')); if (!g) groups.push(g = { id: 'c:' + (p.clientId || '-'), name: IX.client.get(p.clientId)?.name || 'Other (no client)', letter: trkLetter(groups.length), rows: [], clients: new Set(), byClient: p.clientId || '-' }); }
    g.rows.push({ key: p.id, desc: p.trackerName || p.name, p, isNew: true, hidden: hidden.has(p.id), g: g.g });
  }
  const oi = groups.findIndex(g => g.byClient === '-'); if (oi >= 0) groups.push(...groups.splice(oi, 1));      // "Other (no client)" last
  groups.forEach((g, i) => g.letter = trkLetter(i));
  const show = x => (!SEL.client || x.p?.clientId === SEL.client) && (!SEL.project || x.p?.id === SEL.project) && (!q || `${x.desc} ${x.p?.name || ''} ${x.p?.code || ''}`.toLowerCase().includes(q));
  return groups.map(g => ({ ...g, rows: g.rows.filter(show) })).filter(g => g.rows.length || !(SEL.client || SEL.project || q));
}
function renderTracker() {
  const v = $('#v-tracker'), groups = trackerRows(), months = Array.from({ length: TR.m1 - TR.m0 + 1 }, (_, i) => `${TR.y}-${pad(TR.m0 + i + 1)}`);
  let inv = 0, paid = 0, nR = 0, nNew = 0;
  for (const g of groups) for (const x of g.rows) { nR++; if (x.isNew) nNew++; for (let m = 1; m <= 12; m++) { const { v: c } = trackCell(x.key, `${TR.y}-${pad(m)}`); if (+c.amount) { inv += +c.amount; if (c.paidOn) paid += +c.amount; } } }
  const terms = parseInt(S.settings.payTerms) || 30, today = todayISO();
  const mOpt = sel => MON.map((m, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${m}</option>`).join('');
  const cells = x => months.map(ym => {
    const { v: c, inv: iv } = trackCell(x.key, ym), st = TR.hint ? c.paidOn ? ' pd' : c.invSent && /^\d{4}-/.test(c.invSent) && daysBetween(c.invSent, today) > terms ? ' od' : '' : '';
    return '<td class="tk-sp"></td>' + TRK_F.map(([k, , t]) => {
      const val = c[k], ro = iv && (k === 'invNo' || k === 'amount');
      return `<td class="tk-c${t === 'number' ? ' n' : ''}${st}${ro ? ' ro' : ''}" data-tk="${x.key}|${ym}|${k}"${iv ? ` title="${ro ? 'From saved invoice ' + esc(iv.no || '(no number)') + ' – click to open it' : 'Saved on invoice ' + esc(iv.no || '(no number)') + ' (shared by all its months and projects)'}"` : ''}>${val === '' || val == null ? '' : t === 'date' ? esc(trkDate(val)) : t === 'number' && typeof val === 'number' ? money(val) : esc(val)}</td>`;
    }).join('');
  }).join('');
  let n = 0;
  const rowHTML = x => `<tr class="${x.isNew ? 'tk-new' : ''}${x.hidden ? ' tk-hid' : ''}"><td class="tk-sl">${++n}</td><td class="tk-d" data-trow="${esc(x.key)}" title="${x.p ? esc(x.p.name) + (x.p.code ? ' · ' + esc(x.p.code) : '') : 'Not linked to a project'} – click for options">${esc(x.desc)}${x.isNew ? ' <span class="tk-tag">new</span>' : ''}${x.hidden ? ' <span class="tk-tag">hidden</span>' : ''}</td>${cells(x)}</tr>`;
  const g0 = groups[0];
  const body = groups.map((g, gi) => (gi ? `<tr class="tk-g"><td class="tk-sl">${g.letter}</td><td class="tk-d" data-tgrp="${g.id}">${esc(g.name)}</td>${months.map(() => `<td class="tk-sp"></td><td colspan="8"></td>`).join('')}</tr>` : '') + g.rows.map(rowHTML).join('')).join('');
  v.innerHTML = docHead('Tax Invoice Tracker', `${nR} rows${nNew ? ` · ${nNew} new project(s)` : ''} · ${TR.y} invoiced ${money(inv)} · paid ${money(paid)}`, `
      <span class="seg"><button id="tk-prev" title="Previous year">◀</button><button class="on" disabled>${TR.y}</button><button id="tk-next" title="Next year">▶</button></span>
      <label class="small">Months <select id="tk-m0">${mOpt(TR.m0)}</select> – <select id="tk-m1">${mOpt(TR.m1)}</select></label>
      <input type="search" id="tk-q" placeholder="Find" value="${esc(TR.q)}" style="width:130px">
      <label class="small"><input type="checkbox" id="tk-in"${TR.inact ? ' checked' : ''}> Inactive</label>
      <label class="small"><input type="checkbox" id="tk-hd"${TR.hidden ? ' checked' : ''}> Hidden</label>
      <label class="small" title="Green: payment received · amber: invoice sent more than ${terms} days ago and not paid"><input type="checkbox" id="tk-hint"${TR.hint ? ' checked' : ''}> Colours</label>
      <button class="btn sm" id="tk-imp" title="Load rows, groups and entries from a Trackers workbook (sheet “Tax Invoice Tracker”)">Import tracker Excel…</button>
      <button class="btn sm pri" id="tk-xl">Download Excel</button>`)
    + `<div class="dc tk-dc"><div class="tw tk-w"><table class="tk"><thead>
      <tr class="h1"><th class="tk-sl">Sl.No</th><th class="tk-d">Description</th>${months.map(ym => `<th class="tk-sp" rowspan="3"></th><th colspan="8">${fmtMonYY(ym)}</th>`).join('')}</tr>
      <tr class="h2"><th class="tk-sl tk-ga" rowspan="2">${g0 ? g0.letter : ''}</th><th class="tk-d tk-ga" rowspan="2"${g0 ? ` data-tgrp="${g0.id}"` : ''}>${g0 ? esc(g0.name) : ''}</th>${months.map(() => TRK_SECT.map(([l, c]) => `<th colspan="${c}">${l}</th>`).join('')).join('')}</tr>
      <tr class="h3">${months.map(() => TRK_F.map(([, l]) => `<th>${l}</th>`).join('')).join('')}</tr>
    </thead><tbody>${body || `<tr><td colspan="${2 + months.length * 9}" class="muted" style="padding:20px">Nothing matches.</td></tr>`}</tbody></table></div>
    <div class="muted small" style="margin-top:6px">Rows follow Projects &amp; sites: a new project is added at the end of its client's group (marked <i>new</i>), a deleted one is removed. Click a description for options (rename, link to a project, add or remove a row); click a cell to fill it in – dates as 01.10.2026.</div></div>`;
  $('#tk-prev', v).onclick = () => { TR.y--; renderTracker(); };
  $('#tk-next', v).onclick = () => { TR.y++; renderTracker(); };
  $('#tk-m0', v).onchange = e => { TR.m0 = +e.target.value; if (TR.m1 < TR.m0) TR.m1 = TR.m0; renderTracker(); };
  $('#tk-m1', v).onchange = e => { TR.m1 = +e.target.value; if (TR.m0 > TR.m1) TR.m0 = TR.m1; renderTracker(); };
  let qt; $('#tk-q', v).oninput = e => { clearTimeout(qt); qt = setTimeout(() => { TR.q = e.target.value; renderTracker(); const q = $('#tk-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 250); };
  $('#tk-in', v).onchange = e => { TR.inact = e.target.checked; renderTracker(); };
  $('#tk-hd', v).onchange = e => { TR.hidden = e.target.checked; renderTracker(); };
  $('#tk-hint', v).onchange = e => { TR.hint = e.target.checked; renderTracker(); };
  $('#tk-imp', v).onclick = () => pickFiles('.xlsx,.xls', false, fs => importTrackerXlsx(fs[0]).catch(e => toast(e.message, 6000)));
  $('#tk-xl', v).onclick = () => exportTrackerXlsx().catch(e => toast(e.message, 6000));
  $('.tk', v).onclick = e => {
    const td = e.target.closest('td[data-tk]'); if (td && !td.querySelector('input')) return trackEdit(td);
    const d = e.target.closest('[data-trow],[data-tgrp]'); if (d) trkMenu(d, groups);
  };
}
/** inline editor in one cell; Enter / Tab / leaving the cell saves, Esc cancels */
function trackEdit(td) {
  const [key, ym, k] = td.dataset.tk.split('|'), f = TRK_F.find(x => x[0] === k), { v, inv } = trackCell(key, ym);
  if (inv && (k === 'invNo' || k === 'amount')) { IV.draft = JSON.parse(JSON.stringify(inv)); showView('invoices'); return; }
  const inp = document.createElement('input'); inp.type = f[2] === 'number' ? 'number' : 'text'; inp.className = 'tk-in';
  inp.value = f[2] === 'date' ? trkDate(v[k]) : v[k] ?? ''; if (f[2] === 'number') inp.step = '0.01'; if (f[2] === 'date') inp.placeholder = 'dd.mm.yyyy';
  td.textContent = ''; td.appendChild(inp); inp.focus(); inp.select();
  let done = false;
  const finish = (save, move) => {
    if (done) return;
    let val = inp.value.trim();
    if (save && f[2] === 'date' && val) { const d = trkParseDate(val); if (!d) { toast('Type the date as 01.10.2026'); inp.focus(); return; } val = d; }
    done = true;
    if (save && String(val) !== String(v[k] ?? '')) trackSet(key, ym, k, val);
    const pos = td.dataset.tk; renderTracker();
    if (move) { const cells = [...document.querySelectorAll('#v-tracker td[data-tk]')], i = cells.findIndex(c => c.dataset.tk === pos), nx = cells[i + move]; if (nx && !nx.classList.contains('ro')) trackEdit(nx); }
  };
  inp.onkeydown = e => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') { done = true; renderTracker(); } else if (e.key === 'Tab') { e.preventDefault(); finish(true, e.shiftKey ? -1 : 1); } };
  inp.onblur = () => setTimeout(() => finish(true), 0);
}
/* ---------- row options: rename, link to a project, add / remove rows, hide a new project ---------- */
function trkFind(key) { for (const g of S.trkLayout.groups) { const i = g.rows.findIndex(r => r.id === key || r.projectId === key); if (i >= 0) return { g, i, r: g.rows[i] }; } return null; }
function trkMenu(el, groups) {
  const dd = $('#dropdown'), L = S.trkLayout, items = [];
  const save = () => { markDirty(); renderTracker(); };
  const ask = (title, label, val, fn) => openModal(title, `<label class="f">${label}<input type="text" id="tk-ask" value="${esc(val)}"></label>`, [{ label: 'Cancel' }, { label: 'Save', cls: 'pri', onClick: m => { const x = $('#tk-ask', m).value.trim(); if (!x) { toast('Type a name'); return false; } fn(x); save(); } }]);
  const addRow = (g, at) => ask('Add row', 'Description', '', d => g.rows.splice(at, 0, { id: uid('tr'), desc: d, projectId: null }));
  if (el.dataset.tgrp) {
    const g = L.groups.find(x => x.id === el.dataset.tgrp);
    if (!g) return toast('This group comes from a client that is not in the tracker list yet – link one of its projects to a row, or add rows to a group');
    items.push(['Rename group…', () => ask('Rename group', 'Group name', g.name, x => g.name = x)], ['+ Add row at the end', () => addRow(g, g.rows.length)]);
  } else {
    const key = el.dataset.trow, f = trkFind(key), p = IX.proj.get(key);
    if (f) {
      const linkable = S.projects.filter(x => !L.groups.some(g => g.rows.some(r => r.projectId === x.id))).sort((a, b) => a.name.localeCompare(b.name));
      items.push(['Rename…', () => p ? ask('Name in Tax Invoice Tracker', `Description for ${p.name}`, p.trackerName || p.name, x => p.trackerName = x) : ask('Rename row', 'Description', f.r.desc, x => f.r.desc = x)]);
      if (p) items.push(['Unlink from project', () => { if (S.billTrack) for (const k of Object.keys(S.billTrack)) if (k.startsWith(p.id + '|')) { S.billTrack[`${f.r.id}|${k.split('|')[1]}`] = S.billTrack[k]; delete S.billTrack[k]; } f.r.desc = p.trackerName || p.name; f.r.projectId = null; save(); }]);
      else items.push(['Link to project…', () => openModal('Link to project', `<p class="muted small" style="margin-top:0">“${esc(f.r.desc)}” will follow this project (its invoices, renames and deletion).</p><label class="f">Project<select id="tk-lp">${opts(linkable.map(x => [x.id, x.name]), '', '— choose —')}</select></label>`,
        [{ label: 'Cancel' }, { label: 'Link', cls: 'pri', onClick: m => { const pid = $('#tk-lp', m).value; if (!pid) return false; trkLink(f.r, IX.proj.get(pid)); save(); } }])]);
      items.push(['+ Add row below', () => addRow(f.g, f.i + 1)], ['Remove row', async () => { if (await confirmBox(`Remove “${f.r.desc}” from the tracker?${f.r.projectId ? ' The project stays in Projects & sites and comes back at the end of its group as new.' : ''}`, 'Remove', 'bad')) { f.g.rows.splice(f.i, 1); save(); } }]);
    } else if (p) {
      const g = groups.find(x => x.rows.some(r => r.key === key))?.g, free = (g ? [g] : L.groups).flatMap(x => x.rows.filter(r => !r.projectId || !IX.proj.get(r.projectId)).map(r => [r.id, (g ? '' : x.name + ' · ') + r.desc]));
      items.push(['Link to a tracker row…', () => openModal('Link to a tracker row', `<p class="muted small" style="margin-top:0">${esc(p.name)} will be shown on this row of the workbook list.</p><label class="f">Row<select id="tk-lr">${opts(free, '', '— choose —')}</select></label>`,
        [{ label: 'Cancel' }, { label: 'Link', cls: 'pri', onClick: m => { const id = $('#tk-lr', m).value; if (!id) return false; trkLink(trkFind(id).r, p); save(); } }])]);
      if (g) items.push(['Add as a row in this group', () => { g.rows.push({ id: uid('tr'), desc: p.trackerName || p.name, projectId: p.id }); save(); }]);
      const h = new Set(L.hidden || []); items.push([h.has(p.id) ? 'Show again' : 'Hide from tracker', () => { h.has(p.id) ? h.delete(p.id) : h.add(p.id); L.hidden = [...h]; save(); }]);
    }
  }
  dd.innerHTML = items.map(([l], i) => `<button data-tm="${i}"><span>${esc(l)}</span></button>`).join('');
  const r = el.getBoundingClientRect(); dd.style.left = r.left + 'px'; dd.style.top = r.bottom + 2 + 'px'; dd.style.width = '230px'; dd.hidden = false;
  dd.querySelectorAll('[data-tm]').forEach(b => b.onclick = () => { closeMenu(); dd.style.width = ''; items[+b.dataset.tm][1](); });
}
/** a workbook row now follows the project; entries typed on the row move to the project */
function trkLink(r, p) {
  for (const k of Object.keys(S.billTrack)) if (k.startsWith(r.id + '|')) { const nk = `${p.id}|${k.split('|')[1]}`; S.billTrack[nk] = { ...S.billTrack[k], ...(S.billTrack[nk] || {}) }; delete S.billTrack[k]; }
  for (const g of S.trkLayout.groups) for (const x of g.rows) if (x.projectId === p.id && x !== r) x.projectId = null;
  r.projectId = p.id; p.trackerName = r.desc; S.trkLayout.hidden = (S.trkLayout.hidden || []).filter(x => x !== p.id);
}
async function importTrackerXlsx(file) {
  const wb = await readWorkbook(file), name = wb.SheetNames.find(n => /tax\s*invoice\s*tracker/i.test(n)) || wb.SheetNames.find(n => /tracker/i.test(n));
  if (!name) throw new Error('No “Tax Invoice Tracker” sheet in ' + file.name);
  const parsed = trkParse(sheetRows(wb, name)), n = parsed.groups.reduce((a, g) => a + g.rows.length, 0);
  if (!await confirmBox(`Load ${n} rows in ${parsed.groups.length} groups and ${parsed.vals.length} entries from “${name}”? Rows linked to projects stay linked; entries in the file replace the same cells here.`, 'Import')) return;
  trkBuild(S, parsed); markDirty(); renderTracker(); toast(`Tracker loaded · ${n} rows · ${parsed.vals.length} entries`);
}
/** the workbook's sheet, cell for cell: B Sl.No, C Description, group A in rows 3–4, per month 8 columns after a narrow gap */
async function exportTrackerXlsx() {
  await loadScript(LIB.exceljs);
  const TR0 = { ...TR }; TR.q = ''; const sel = { ...SEL }; SEL.client = SEL.project = SEL.site = '';
  let groups; try { groups = trackerRows(); } finally { Object.assign(TR, TR0); Object.assign(SEL, sel); }
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Tax Invoice Tracker', { views: [{ state: 'frozen', xSplit: 3, ySplit: 2, showGridLines: true }] });
  const blue = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }, white = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
  const style = (c, head, h = 'center') => { c.fill = head ? blue : white; c.font = { name: 'Tahoma', size: 10, bold: !!head }; c.border = thin; c.alignment = { horizontal: h, vertical: 'middle', wrapText: head === 'wrap' }; };
  // column widths exactly as in the workbook
  for (const [a, b, w] of [[1, 1, 2.71], [2, 2, 7.86], [3, 3, 54.29], [4, 4, 1.29], [5, 5, 13.14], [6, 6, 17.57], [7, 7, 15], [8, 12, 13.14], [13, 13, 1.29], [14, 14, 12.43], [15, 15, 10.57], [16, 16, 12.43], [17, 21, 12.57], [22, 22, 1.43], [23, 26, 12], [27, 27, 10.57], [28, 28, 13.57], [29, 30, 12.14], [31, 31, 1.29], [32, 35, 12.86], [36, 36, 11.43], [37, 37, 13.14], [38, 38, 13.43], [39, 39, 12.14], [40, 40, 1.29], [41, 46, 13.29], [47, 47, 12.29], [48, 48, 12.14], [49, 49, 1.14], [50, 53, 13.14], [54, 54, 13.29], [55, 55, 12.57], [56, 56, 13], [57, 57, 12.14], [58, 58, 1.29], [59, 62, 12.57], [63, 63, 12.14], [64, 64, 13.57], [65, 65, 13.14], [66, 66, 14.14], [67, 67, 1.43], [68, 73, 12.14], [74, 74, 12.57], [75, 75, 12.14], [76, 76, 1.43], [77, 80, 12.29], [81, 81, 11.43], [82, 82, 13], [83, 83, 13.14], [84, 84, 12.14], [85, 85, 1.57], [86, 89, 13.14], [90, 90, 11.86], [91, 91, 13.14], [92, 92, 12.29], [93, 93, 12.14], [94, 94, 1.43], [95, 98, 12], [99, 99, 12.71], [100, 100, 13.14], [101, 101, 11.86], [102, 102, 12.14], [103, 103, 1.14], [104, 107, 12.71], [108, 108, 12.86], [109, 109, 13.14], [110, 111, 12.14]]) for (let c = a; c <= b; c++) ws.getColumn(c).width = w;
  const col0 = m => 5 + m * 9, lastCol = col0(11) + 7, nRows = groups.reduce((a, g, gi) => a + g.rows.length + (gi ? 1 : 0), 0), last = Math.max(4, 4 + nRows);
  ws.getCell('B2').value = 'Sl.No'; ws.getCell('C2').value = 'Description'; style(ws.getCell('B2'), 1); style(ws.getCell('C2'), 1);
  ws.mergeCells('B3:B4'); ws.mergeCells('C3:C4'); ws.getCell('B3').value = groups[0]?.letter || ''; ws.getCell('C3').value = groups[0]?.name || '';
  for (const a of ['B3', 'B4', 'C3', 'C4']) style(ws.getCell(a), 1);
  for (let m = 0; m < 12; m++) {
    const c = col0(m);
    ws.mergeCells(2, c - 1, last, c - 1);                                      // the narrow gap before each month, as in the workbook
    ws.mergeCells(2, c, 2, c + 7); const mh = ws.getCell(2, c); mh.value = new Date(Date.UTC(TR.y, m, 1)); mh.numFmt = 'mmm-yy';
    let s = c; TRK_SECT.forEach(([, n], j) => { if (n > 1) ws.mergeCells(3, s, 3, s + n - 1); ws.getCell(3, s).value = TRK_XL_SECT[j]; s += n; });
    TRK_XL_F.forEach((l, i) => ws.getCell(4, c + i).value = l);
    for (let r = 2; r <= 4; r++) for (let i = 0; i < 8; i++) style(ws.getCell(r, c + i), r === 4 ? 'wrap' : 1);
  }
  ws.getRow(2).height = 24; ws.getRow(3).height = 24; ws.getRow(4).height = 51;
  let r = 5, n = 0;
  groups.forEach((g, gi) => {
    if (gi) {
      ws.getCell(r, 2).value = g.letter; ws.getCell(r, 3).value = g.name; ws.getRow(r).height = 21;
      for (let c = 2; c <= lastCol; c++) if (c !== 4 && (c < 5 || (c - 5) % 9 !== 8)) style(ws.getCell(r, c), 1);
      ws.getCell(r, 3).alignment = { vertical: 'middle' };
      r++;
    }
    for (const x of g.rows) {
      ws.getRow(r).height = 21;
      const sl = ws.getCell(r, 2), d = ws.getCell(r, 3); sl.value = ++n; d.value = x.desc; style(sl, 0); style(d, 0, 'left');
      for (let m = 0; m < 12; m++) {
        const { v } = trackCell(x.key, `${TR.y}-${pad(m + 1)}`);
        TRK_F.forEach(([k, , t], i) => {
          const c = ws.getCell(r, col0(m) + i), val = v[k]; style(c, 0);
          if (val === '' || val == null) return;
          if (t === 'date') c.value = trkDate(val);
          else if (t === 'number' && typeof val === 'number') { c.value = val; c.numFmt = '#,##0.00'; }
          else c.value = String(val);
        });
      }
      r++;
    }
  });
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Tax Invoice Tracker ${TR.y}.xlsx`);
  toast(`Tracker ${TR.y} downloaded · ${n} rows`);
}
