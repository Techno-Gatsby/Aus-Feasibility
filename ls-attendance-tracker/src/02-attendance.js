/* =====================================================================
   Master attendance grid (payroll cycle or calendar month)
   ===================================================================== */
const AV = {
  ym: null, mode: 'payroll',
  f: { client: '', project: '', site: '', shift: '', trade: '', type: '', status: 'active', q: '' },
  sort: 'order', rows: [], dates: [], sel: null, anchor: null, drag: false, onlyEmpty: false, undo: []
};

function attPeriod() {
  if (AV.mode === 'calendar') return { start: AV.ym + '-01', end: `${AV.ym}-${pad(dim(AV.ym))}` };
  return payrollCycle(AV.ym);
}

function renderAttendance() {
  if (!AV.ym) AV.ym = cycleOfDate(todayISO());
  const v = $('#v-attendance');
  const { start, end } = attPeriod();
  const f = AV.f;
  const locked = AV.mode === 'payroll' && S.locks[AV.ym];
  const scope = f.site ? siteName(f.site) : f.project ? IX.proj.get(f.project)?.name : f.client ? IX.client.get(f.client)?.name : '';
  v.innerHTML = docHead('Attendance', `${fmtDMY(start)} – ${fmtDMY(end)}${locked ? ' · <span class="pill neg">locked</span>' : ''}`, `
      <div class="seg"><button data-mode="payroll" class="${AV.mode === 'payroll' ? 'on' : ''}">Payroll month</button><button data-mode="calendar" class="${AV.mode === 'calendar' ? 'on' : ''}">Calendar month</button></div>
      <button class="btn sm" id="av-prev" title="Previous month">◀</button><input type="month" id="av-ym" value="${AV.ym}"><button class="btn sm" id="av-next" title="Next month">▶</button>`)
  + `<div class="dc">
    <div class="row" style="margin-bottom:8px">
      <span class="codes">${S.codes.map(c => `<button data-code="${esc(c.code)}" style="background:${c.color}" title="${esc(c.label)}">${esc(c.code)}${c.key ? `<span class="kbd">${c.key.toUpperCase()}</span>` : ''}</button>`).join('')}<button data-code="" title="Clear">✕<span class="kbd">DEL</span></button></span>
      <label class="chk muted" title="Skip days that already have a code"><input type="checkbox" id="av-empty" ${AV.onlyEmpty ? 'checked' : ''}> empty days only</label>
      <span id="av-selinfo" class="muted small">Select days, then click a code or press its key.</span>
      <span class="spacer"></span>
      ${scope ? `<span class="pill">${esc(scope)} <button class="btn sm" id="av-unscope" title="Show everyone" style="min-height:18px;padding:0 5px;border:0;box-shadow:none">✕</button></span>` : ''}
      <input type="search" id="f-q" placeholder="Name or ID" value="${esc(f.q)}" style="width:150px">
      <select id="f-shift">${opts(S.settings.shifts, f.shift, 'All shifts')}</select>
      <select id="f-trade">${opts(S.settings.trades, f.trade, 'All trades')}</select>
      <select id="f-type">${opts([['ls', 'LS staff'], ['sub', 'Subcontractors']], f.type, 'LS + subcon')}</select>
      <select id="f-status">${opts([['active', 'Working this period'], ['left', 'Left'], ['all', 'Everyone']], f.status)}</select>
      <select id="av-sort">${opts([['order', 'Sheet order'], ['name', 'By name'], ['site', 'By site'], ['shift', 'By shift'], ['code', 'By emp ID']], AV.sort)}</select>
    </div>
    ${setupSteps()}
    <div class="kpis" id="av-kpis" style="grid-template-columns:repeat(6,1fr)"></div>
    <div id="grid-wrap" class="fill"></div>
  </div>`;

  const refilter = () => { AV.sel = null; renderAttendance(); renderStatus(); };
  v.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { AV.mode = b.dataset.mode; refilter(); renderToolbar(); });
  $('#av-ym').onchange = e => { if (e.target.value) { AV.ym = e.target.value; refilter(); renderToolbar(); } };
  $('#av-prev').onclick = () => { AV.ym = addMonths(AV.ym, -1); refilter(); renderToolbar(); };
  $('#av-next').onclick = () => { AV.ym = addMonths(AV.ym, 1); refilter(); renderToolbar(); };
  for (const k of ['shift', 'trade', 'type', 'status']) $('#f-' + k).onchange = e => { f[k] = e.target.value; refilter(); };
  $('#f-q').oninput = e => { f.q = e.target.value; clearTimeout(AV._qt); AV._qt = setTimeout(() => { AV.sel = null; renderGrid(); }, 250); };
  $('#av-sort').onchange = e => { AV.sort = e.target.value; refilter(); };
  if ($('#av-unscope')) $('#av-unscope').onclick = () => clearSel();
  $('#av-empty').onchange = e => AV.onlyEmpty = e.target.checked;
  $$('.codes button', v).forEach(b => b.onclick = () => applyToSel(b.dataset.code ? { c: b.dataset.code } : null));
  renderGrid();
}

function computeAttRows() {
  const { start, end } = attPeriod();
  AV.dates = datesBetween(start, end);
  const f = AV.f, q = norm(f.q);
  const out = [];
  for (const e of S.employees) {
    if (f.status === 'active' && !((!e.doj || e.doj <= end) && (!e.end || e.end >= start))) continue;
    if (f.status === 'left' && !(e.end && e.end <= end)) continue;
    if (f.type === 'ls' && e.agency) continue;
    if (f.type === 'sub' && !e.agency) continue;
    if (f.trade && e.trade !== f.trade) continue;
    if (q && !norm(e.name).includes(q) && !norm(e.empCode).includes(q)) continue;
    const sites = new Set(), shifts = new Set();
    let lastSite = null;
    for (const d of AV.dates) {
      if (!employedOn(e, d)) continue;
      const s = siteOn(e, d); if (s) { sites.add(s); lastSite = s; }
      shifts.add(shiftOn(e, d));
    }
    if (!sites.size) { const a = assignOn(e, end) || e.assign?.[0]; if (a?.site) { sites.add(a.site); lastSite = a.site; } }
    if (!shifts.size) shifts.add(e.shift || '');
    if (f.site && !sites.has(f.site)) continue;
    if (f.project && ![...sites].some(s => IX.site.get(s)?.projectId === f.project)) continue;
    if (f.client && ![...sites].some(s => projOfSite(s)?.clientId === f.client)) continue;
    if (f.shift && !shifts.has(f.shift)) continue;
    const mainShift = assignOn(e, end)?.shift || e.shift || [...shifts][0] || '';
    out.push({ emp: e, sites, lastSite, shift: mainShift });
  }
  const by = {
    name: (a, b) => a.emp.name.localeCompare(b.emp.name),
    site: (a, b) => siteName(a.lastSite).localeCompare(siteName(b.lastSite)) || a.shift.localeCompare(b.shift) || a.emp.name.localeCompare(b.emp.name),
    shift: (a, b) => a.shift.localeCompare(b.shift) || a.emp.name.localeCompare(b.emp.name),
    code: (a, b) => (a.emp.empCode || 'zz').localeCompare(b.emp.empCode || 'zz')
  }[AV.sort];
  if (by) out.sort(by);
  AV.rows = out;
}

function cellInner(emp, d) {
  if (!employedOn(emp, d)) return { cls: 'd lk', style: '', html: '', title: emp.doj && d < emp.doj ? 'Before joining date' : 'After end date' + (emp.endReason ? ' (' + emp.endReason + ')' : '') };
  const c = getCell(emp.id, d);
  const a = assignOn(emp, d);
  let cls = 'd' + (isLocked(d) ? ' frz' : ''), style = '', html = '', title = fmtDMY(d);
  if (c) {
    const cd = codeDef(c.c);
    style = `background:${cd.color}`; html = esc(c.c.length > 4 ? c.c.slice(0, 4) : c.c);
    title += ` · ${cd.label}`;
    if (c.s && c.s !== a?.site) { html += '<i class="ov"></i>'; }
    if (c.sh && c.sh !== (a?.shift || emp.shift)) html += `<i class="nt">${esc(c.sh[0])}</i>`;
  }
  const s = siteOn(emp, d); if (s) title += ` · ${siteName(s)}`;
  const sh = shiftOn(emp, d); if (sh) title += ` · ${sh}`;
  return { cls, style, html, title };
}

function rowHTML(i) {
  const { emp, lastSite, sites, shift } = AV.rows[i];
  const counts = {}; let bill = 0;
  let cells = '';
  AV.dates.forEach((d, j) => {
    const ci = cellInner(emp, d);
    const c = employedOn(emp, d) ? getCell(emp.id, d) : null;
    if (c) { counts[c.c] = (counts[c.c] || 0) + 1; if (codeDef(c.c).billable) bill++; }
    cells += `<td class="${ci.cls}" data-c="${j}" style="${ci.style}" title="${esc(ci.title)}">${ci.html}</td>`;
  });
  const p = counts.P || 0;
  const other = Object.entries(counts).filter(([k]) => k !== 'P').map(([k, n]) => `${k}${n}`).join(' · ');
  const proj = projOfSite(lastSite);
  const left = emp.end && emp.end <= AV.dates[AV.dates.length - 1];
  return `<tr data-r="${i}" class="${left ? 'left' : ''}">
    <td class="fix" style="left:0;width:38px;min-width:38px;text-align:right">${i + 1}</td>
    <td class="fix nm" style="left:38px;width:210px;min-width:210px" data-emp="${emp.id}" title="${esc(emp.name)} – click to edit">${esc(emp.name)}</td>
    <td>${esc(empCodeLabel(emp))}</td><td>${esc(shift)}</td><td class="small">${esc(emp.trade || '')}</td>
    <td class="small" title="${esc(proj ? proj.name : 'Site not mapped to a project')}">${esc(siteName(lastSite))}${sites.size > 1 ? ` <span class="tag">+${sites.size - 1}</span>` : ''}</td>
    <td class="small">${fmtDMY(emp.doj)}</td>
    ${cells}
    <td class="tot">${p}</td><td class="tot" style="color:var(--brand2)">${bill}</td><td class="sum">${esc(other)}</td></tr>`;
}

function renderGrid() {
  computeAttRows();
  const wrap = $('#grid-wrap'); if (!wrap) return;
  if (!S.employees.length) {
    $('#av-kpis').innerHTML = '';
    wrap.outerHTML = `<div id="grid-wrap" class="empty fill" style="flex:none"><b>No workers yet</b>Import the master attendance workbook, or add workers one by one.
      <div class="row"><button class="btn pri" onclick="$('#hdr-import').click()">Import Excel…</button><button class="btn" onclick="editEmployee(null)">Add worker</button></div></div>`;
    return;
  }
  const dh1 = AV.dates.map(d => `<th class="${[5, 6].includes(weekday(d)) ? 'we' : ''}">${WD[weekday(d)].slice(0, 2)}</th>`).join('');
  const dh2 = AV.dates.map(d => `<th class="${[5, 6].includes(weekday(d)) ? 'we' : ''}" title="${fmtDMY(d)}">${+d.slice(8)}${d.slice(8) === '01' || d === AV.dates[0] ? '<br><span class="small muted">' + MON[+d.slice(5, 7) - 1] + '</span>' : ''}</th>`).join('');
  wrap.innerHTML = `<table class="ag"><thead>
    <tr><th class="fix" rowspan="2" style="left:0">#</th><th class="fix" rowspan="2" style="left:38px;text-align:left">Name</th><th rowspan="2">Emp ID</th><th rowspan="2">Shift</th><th rowspan="2">Trade</th><th rowspan="2">Site</th><th rowspan="2">D.O.J</th>${dh1}<th rowspan="2">P</th><th rowspan="2" title="Billable days">Bill</th><th rowspan="2">Other</th></tr>
    <tr>${dh2}</tr></thead>
    <tbody>${AV.rows.map((_, i) => rowHTML(i)).join('')}</tbody>
    <tfoot><tr><td class="fix" style="left:0"></td><td class="fix" style="left:38px;text-align:left">Billable per day</td><td colspan="5"></td>${AV.dates.map((_, j) => `<td data-f="${j}"></td>`).join('')}<td colspan="3" id="av-ftot"></td></tr></tfoot></table>`;
  renderFooter();
  paintSel();
  const tb = wrap.querySelector('tbody');
  tb.onmousedown = e => {
    const nm = e.target.closest('td.nm'); if (nm) { editEmployee(nm.dataset.emp); return; }
    const td = e.target.closest('td.d'); if (!td) return;
    e.preventDefault();
    const r = +td.parentElement.dataset.r, c = +td.dataset.c;
    if (e.shiftKey && AV.anchor) setSel(AV.anchor, { r, c });
    else { AV.anchor = { r, c }; setSel(AV.anchor, AV.anchor); }
    AV.drag = true;
  };
  tb.onmouseover = e => { if (!AV.drag) return; const td = e.target.closest('td.d'); if (!td) return; setSel(AV.anchor, { r: +td.parentElement.dataset.r, c: +td.dataset.c }); };
  tb.ondblclick = e => { if (e.target.closest('td.d')) openCellEditor(); };
}
document.addEventListener('mouseup', () => AV.drag = false);

function renderFooter() {
  const tf = $('#grid-wrap tfoot'); if (!tf) return;
  let all = 0;
  AV.dates.forEach((d, j) => {
    let n = 0;
    for (const { emp } of AV.rows) { if (!employedOn(emp, d)) continue; const c = getCell(emp.id, d); if (c && codeDef(c.c).billable) n++; }
    all += n; tf.querySelector(`[data-f="${j}"]`).textContent = n || '';
  });
  $('#av-ftot').textContent = all + ' billable days';
  // KPI strip for the visible rows
  const cnt = {}; let blank = 0;
  for (const { emp } of AV.rows) for (const d of AV.dates) { if (!employedOn(emp, d)) continue; const c = getCell(emp.id, d); if (!c) { if (d <= todayISO()) blank++; continue; } cnt[c.c] = (cnt[c.c] || 0) + 1; }
  const leave = S.codes.filter(c => !c.billable && !['A', 'OFF'].includes(c.code)).reduce((a, c) => a + (cnt[c.code] || 0), 0);
  const k = (lbl, v, sub, col) => `<div class="kpi" style="--c:${col}"><div class="l">${lbl}</div><div class="v">${v}</div><div class="d">${sub}</div></div>`;
  $('#av-kpis').innerHTML = k('Workers', AV.rows.length, 'in this view', 'var(--heading)') + k('Billable days', all, S.codes.filter(c => c.billable).map(c => c.code).join(' + '), 'var(--pos)')
    + k('Absent', cnt.A || 0, 'days', 'var(--neg)') + k('Day off', cnt.OFF || 0, 'days', 'var(--mute)') + k('Leave / other', leave, 'AL, SL, EL, SIRA…', 'var(--warn)')
    + k('Not marked', blank, 'past days left empty', blank ? 'var(--warn)' : 'var(--mute)');
}
function setSel(a, b) { AV.sel = { r0: Math.min(a.r, b.r), r1: Math.max(a.r, b.r), c0: Math.min(a.c, b.c), c1: Math.max(a.c, b.c) }; paintSel(); }
function paintSel() {
  const wrap = $('#grid-wrap'); if (!wrap) return;
  wrap.querySelectorAll('td.sel').forEach(td => td.classList.remove('sel'));
  const s = AV.sel, si = $('#av-selinfo');
  if (si) si.innerHTML = s ? `<b style="color:var(--accent)">${(s.r1 - s.r0 + 1) * (s.c1 - s.c0 + 1)} day(s)</b> · ${s.r1 - s.r0 + 1} worker(s) selected` : 'Select days, then click a code or press its key.';
  if (!s) return;
  const trs = wrap.querySelectorAll('tbody tr');
  for (let r = s.r0; r <= s.r1; r++) { const tr = trs[r]; if (!tr) continue; const tds = tr.querySelectorAll('td.d'); for (let c = s.c0; c <= s.c1; c++) tds[c]?.classList.add('sel'); }
}
function refreshRows(rowIdx) {
  const trs = $$('#grid-wrap tbody tr');
  for (const r of rowIdx) { const tr = trs[r]; if (!tr) continue; const tmp = document.createElement('tbody'); tmp.innerHTML = rowHTML(r); tr.replaceWith(tmp.firstElementChild); }
  renderFooter(); paintSel();
}

/** Apply a value to every selected cell. val = null clears; val = {c, s?, sh?} where s/sh undefined = keep, null = back to assigned */
function applyToSel(val, onlyEmpty = AV.onlyEmpty) {
  const s = AV.sel; if (!s) { toast('Select one or more cells first'); return; }
  const changes = []; const rowsTouched = new Set(); let skippedLock = 0;
  for (let r = s.r0; r <= s.r1; r++) {
    const emp = AV.rows[r].emp;
    for (let c = s.c0; c <= s.c1; c++) {
      const d = AV.dates[c];
      if (!employedOn(emp, d)) continue;
      if (isLocked(d)) { skippedLock++; continue; }
      const prev = S.att[emp.id]?.[d];
      if (onlyEmpty && prev) continue;
      let nv = null;
      if (val) {
        const cur = getCell(emp.id, d) || {};
        const a = assignOn(emp, d);
        nv = { c: val.c ?? cur.c, s: val.s === undefined ? cur.s : val.s, sh: val.sh === undefined ? cur.sh : val.sh };
        if (!nv.c) nv = null;
        else {
          if (!nv.s || nv.s === a?.site) delete nv.s;
          if (!nv.sh || nv.sh === (a?.shift || emp.shift)) delete nv.sh;
        }
      }
      changes.push({ e: emp.id, d, prev: prev === undefined ? null : (typeof prev === 'object' ? { ...prev } : prev) });
      putCell(emp.id, d, nv); rowsTouched.add(r);
    }
  }
  if (skippedLock) toast(`${skippedLock} cell(s) skipped – payroll month is locked`);
  else if (changes.length > 1) toast(val ? `Marked ${changes.length} days as ${val.c}` : `Cleared ${changes.length} days`);
  if (!changes.length) return;
  AV.undo.push(changes); if (AV.undo.length > 60) AV.undo.shift();
  markDirty(); refreshRows(rowsTouched);
}
function undoAtt() {
  const ch = AV.undo.pop(); if (!ch) { toast('Nothing to undo'); return; }
  for (const x of ch) { if (x.prev == null) { if (S.att[x.e]) delete S.att[x.e][x.d]; } else (S.att[x.e] ||= {})[x.d] = x.prev; }
  markDirty(); renderGrid(); toast(`Undid ${ch.length} cell change(s)`);
}
function openCellEditor() {
  const s = AV.sel; if (!s) { toast('Select one or more cells first'); return; }
  const n = (s.r1 - s.r0 + 1) * (s.c1 - s.c0 + 1);
  const one = n === 1 ? getCell(AV.rows[s.r0].emp.id, AV.dates[s.c0]) : null;
  openModal(`Set ${n} cell${n > 1 ? 's' : ''}`, `
    <div class="grid2">
      <label class="f">Code<select id="ce-code">${opts(S.codes.map(c => [c.code, `${c.code} – ${c.label}`]), one?.c || 'R', null)}<option value="">(clear)</option></select></label>
      <label class="f">Worked at site<select id="ce-site"><option value="__keep">Keep as is</option><option value="__def">Assigned site (default)</option>${siteOptions(one?.s, null)}</select></label>
      <label class="f">Shift<select id="ce-shift"><option value="__keep">Keep as is</option><option value="__def">Assigned shift (default)</option>${opts(S.settings.shifts, one?.sh)}</select></label>
    </div>
    <label class="chk" style="margin-top:10px"><input type="checkbox" id="ce-empty" ${AV.onlyEmpty ? 'checked' : ''}> Only fill empty cells</label>
    <p class="hint">Use this for relievers: select their days, choose <b>R</b> and the site they relieved at. The day is then billed on that site's client timesheet in the RELIEVER section.</p>`,
    [{ label: 'Cancel' }, {
      label: 'Apply', cls: 'pri', onClick: m => {
        const code = $('#ce-code', m).value, site = $('#ce-site', m).value, sh = $('#ce-shift', m).value;
        if (!code) { applyToSel(null, $('#ce-empty', m).checked); return; }
        applyToSel({ c: code, s: site === '__keep' ? undefined : site === '__def' ? null : site, sh: sh === '__keep' ? undefined : sh === '__def' ? null : sh }, $('#ce-empty', m).checked);
      }
    }]);
  if (one?.s) $('#ce-site').value = one.s;
  if (one?.sh) $('#ce-shift').value = one.sh;
}

document.addEventListener('keydown', e => {
  if (curView !== 'attendance' || $('#modal-bg').classList.contains('on')) return;
  if (e.target.matches('input,select,textarea')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undoAtt(); return; }
  if (!AV.sel) return;
  const mv = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
  if (mv) {
    e.preventDefault();
    const cur = e.shiftKey ? { r: AV.sel.r0 === AV.anchor.r ? AV.sel.r1 : AV.sel.r0, c: AV.sel.c0 === AV.anchor.c ? AV.sel.c1 : AV.sel.c0 } : { ...AV.anchor };
    const nx = { r: Math.max(0, Math.min(AV.rows.length - 1, cur.r + mv[0])), c: Math.max(0, Math.min(AV.dates.length - 1, cur.c + mv[1])) };
    if (e.shiftKey) setSel(AV.anchor, nx); else { AV.anchor = nx; setSel(nx, nx); }
    const td = $$('#grid-wrap tbody tr')[nx.r]?.querySelectorAll('td.d')[nx.c]; td?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); applyToSel(null, false); return; }
  if (e.key === 'Enter') { e.preventDefault(); openCellEditor(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
  const cd = S.codes.find(c => c.key && c.key.toLowerCase() === e.key.toLowerCase());
  if (cd) {
    e.preventDefault(); applyToSel({ c: cd.code });
    // single-cell entry: advance to the next day for fast typing
    const s = AV.sel;
    if (s.r0 === s.r1 && s.c0 === s.c1 && s.c1 < AV.dates.length - 1) { AV.anchor = { r: s.r0, c: s.c0 + 1 }; setSel(AV.anchor, AV.anchor); }
  }
});

/** Everything that would make a timesheet or invoice wrong, in one list */
function dataChecks() {
  const out = [], add = (title, items, fix, view, short, act) => { if (items.length) out.push({ title, items, fix, view, short, act }); };
  const ym = AV.mode === 'calendar' ? AV.ym : AV.ym, used = new Map();
  for (const rows of monthRows(ym).values()) for (const r of rows.values()) if (r.total) used.set(r.emp.trade || 'SECURITY GUARD', (used.get(r.emp.trade || 'SECURITY GUARD') || 0) + 1);
  const today = todayISO(), inUse = new Set(); for (const e of S.employees) { if (employedOn(e, today)) { const a = assignOn(e, today)?.site; if (a) inUse.add(a); } for (const d in S.att[e.id] || {}) { const v = S.att[e.id][d]; if (typeof v === 'object' && v.s && d.startsWith(ym)) inUse.add(v.s); } }
  add('Sites in use but not linked to a project – their days are on no client timesheet', S.sites.filter(x => !x.projectId && inUse.has(x.id)).map(x => x.name), 'Link in Projects & sites', 'projects', 'unlinked sites in use');
  add('Projects without a client', S.projects.filter(p => !p.clientId && p.active !== false).map(p => p.name), 'Set client in Projects & sites', 'projects', 'projects without client');
  const noRate = [...used.keys()].filter(t => !S.settings.rateCard.find(r => r.trade === t)?.rate && !S.projects.some(p => p.billing?.rates?.[t]));
  add(`Trades working in ${fmtMonYY(ym)} with no rate – invoice lines would be 0`, noRate.map(t => `${t} (${used.get(t)} worker-rows)`), 'Add to rate card & enter rates', 'data', 'trades without rate', () => { noRate.forEach(t => { if (!S.settings.rateCard.some(r => r.trade === t)) S.settings.rateCard.push({ trade: t, unit: unitFor(t), rate: 0, src: 'enter rate' }); }); markDirty(); });
  add('Double entries in the last client-timesheet import (same person, same day, two rows)', S.issues?.double || [], 'Correct the source sheet, then re-import', null, 'double entries');
  add('Current workers with no site', S.employees.filter(e => employedOn(e, today) && !assignOn(e, today)?.site).map(e => `${e.name} ${empCodeLabel(e)}`), 'Assign in Employees', 'employees', 'workers without site');
  return out;
}
function setupSteps() {
  if (!S.employees.length) return '';
  const ch = dataChecks(); if (!ch.length) return '<div class="alert info"><b>✓ All checks passed</b> – every site is linked, every project has a client and every working trade has a rate.</div>';
  return `<div class="alert"><b>${ch.reduce((a, c) => a + c.items.length, 0)} item(s) to check:</b> ${ch.map(c => `${c.items.length} ${c.short}`).join(' · ')}<span class="grow"></span><button class="btn sm" onclick="openChecks()">Review →</button></div>`;
}
function openChecks() {
  const ch = dataChecks();
  openModal('Data checks', ch.map((c, i) => `<div class="comp"><div class="ch"><b class="grow">${esc(c.title)} <span class="pill warn">${c.items.length}</span></b>${c.view ? `<button class="btn sm pri" data-go="${c.view}" data-ci="${i}">${esc(c.fix)}</button>` : `<span class="small muted">${esc(c.fix)}</span>`}</div>
    <div class="small" style="max-height:140px;overflow:auto;padding:8px 10px;columns:2">${c.items.slice(0, 300).map(esc).join('<br>')}${c.items.length > 300 ? '<br>…' : ''}</div></div>`).join('') || '<p>Nothing to fix.</p>', [{ label: 'Close', cls: 'pri' }], { width: 'min(900px,100%)' });
  $$('#modal [data-go]').forEach(b => b.onclick = () => { ch[+b.dataset.ci].act?.(); closeModal(); showView(b.dataset.go); });
}
