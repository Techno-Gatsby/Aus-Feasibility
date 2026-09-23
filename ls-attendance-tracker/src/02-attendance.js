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
  const projList = S.projects.filter(p => !f.client || p.clientId === f.client).sort((a, b) => a.name.localeCompare(b.name));
  const siteList = S.sites.filter(s => (!f.project || s.projectId === f.project) && (!f.client || IX.proj.get(s.projectId)?.clientId === f.client)).sort((a, b) => a.name.localeCompare(b.name));
  const locked = AV.mode === 'payroll' && S.locks[AV.ym];
  v.innerHTML = `<div class="shell">
  <aside class="rail">
    <div class="fs"><div class="lg">Period</div><div class="grp">
      <select id="av-mode">${opts([['payroll', 'Payroll month (21st – 20th)'], ['calendar', 'Calendar month (1st – end)']], AV.mode)}</select>
      <div class="pair"><button class="btn sm" id="av-prev">◀</button><input type="month" id="av-ym" value="${AV.ym}"><button class="btn sm" id="av-next">▶</button></div>
      <div class="small mono" style="color:var(--ink2)">${fmtDMY(start)} → ${fmtDMY(end)} ${locked ? '<span class="tag bad">Locked</span>' : ''}</div>
      ${AV.mode === 'payroll' ? `<button class="btn sm" id="av-lock">${locked ? 'Unlock this month' : 'Lock this month'}</button>` : ''}
    </div></div>
    <div class="fs"><div class="lg">Mark selected days</div><div class="grp">
      <div class="codes">${S.codes.map(c => `<button data-code="${esc(c.code)}" style="background:${c.color}" title="${esc(c.label)}">${esc(c.code)}${c.key ? ` <kbd>${c.key.toUpperCase()}</kbd>` : ''}<small>${esc(c.label)}</small></button>`).join('')}
        <button data-code="" style="background:#fff">✕ <kbd>DEL</kbd><small>Clear</small></button></div>
      <div id="av-selinfo" class="small muted">No days selected – click or drag in the grid.</div>
      <button class="btn sm" id="av-edit">Reliever / other site…</button>
      <label class="chk"><input type="checkbox" id="av-empty" ${AV.onlyEmpty ? 'checked' : ''}> Fill empty days only</label>
      <div class="row"><button class="btn sm grow" id="av-all">Select all</button><button class="btn sm grow" id="av-undo">Undo</button></div>
    </div></div>
    <div class="fs"><div class="lg">Filter</div><div class="grp">
      <input type="search" id="f-q" placeholder="Search name or emp ID" value="${esc(f.q)}">
      <select id="f-client">${opts(S.clients.map(c => [c.id, c.name]), f.client, 'All clients')}</select>
      <select id="f-project">${opts(projList.map(p => [p.id, p.name]), f.project, 'All projects')}</select>
      <select id="f-site">${opts(siteList.map(s => [s.id, s.name]), f.site, 'All sites')}</select>
      <select id="f-shift">${opts(S.settings.shifts, f.shift, 'All shifts')}</select>
      <select id="f-trade">${opts(S.settings.trades, f.trade, 'All trades')}</select>
      <select id="f-type">${opts([['ls', 'LS staff only'], ['sub', 'Subcontractors only']], f.type, 'LS + subcontractors')}</select>
      <select id="f-status">${opts([['active', 'Working this period'], ['left', 'Left'], ['all', 'Everyone']], f.status)}</select>
      <select id="av-sort">${opts([['order', 'Sort: sheet order'], ['name', 'Sort: name'], ['site', 'Sort: site'], ['shift', 'Sort: shift'], ['code', 'Sort: emp ID']], AV.sort)}</select>
    </div></div>
  </aside>
  <section>
    <div class="ph-row"><div class="grow"><h2 class="ph">Attendance</h2><p class="pd">Select days in the grid (click or drag), then click a code or press its key.</p></div>
      <button class="btn" id="av-add">+ Add employee</button><button class="btn" id="av-xls">Export Excel</button></div>
    ${setupSteps()}
    <div class="kpis" id="av-kpis"></div>
    <div id="grid-wrap"></div>
  </section></div>`;

  const refilter = () => { AV.sel = null; renderAttendance(); };
  $('#av-mode').onchange = e => { AV.mode = e.target.value; refilter(); };
  $('#av-ym').onchange = e => { if (e.target.value) { AV.ym = e.target.value; refilter(); } };
  $('#av-prev').onclick = () => { AV.ym = addMonths(AV.ym, -1); refilter(); };
  $('#av-next').onclick = () => { AV.ym = addMonths(AV.ym, 1); refilter(); };
  $('#f-client').onchange = e => { f.client = e.target.value; f.project = ''; f.site = ''; refilter(); };
  $('#f-project').onchange = e => { f.project = e.target.value; f.site = ''; refilter(); };
  for (const k of ['site', 'shift', 'trade', 'type', 'status']) $('#f-' + k).onchange = e => { f[k] = e.target.value; refilter(); };
  $('#f-q').oninput = e => { f.q = e.target.value; clearTimeout(AV._qt); AV._qt = setTimeout(() => { AV.sel = null; renderGrid(); }, 250); };
  $('#av-sort').onchange = e => { AV.sort = e.target.value; refilter(); };
  $('#av-add').onclick = () => editEmployee(null);
  $('#av-xls').onclick = () => exportMasterXlsx().catch(e => toast(e.message));
  if ($('#av-lock')) $('#av-lock').onclick = () => { if (S.locks[AV.ym]) delete S.locks[AV.ym]; else S.locks[AV.ym] = true; markDirty(); renderAttendance(); };
  $('#av-empty').onchange = e => AV.onlyEmpty = e.target.checked;
  $('#av-all').onclick = () => { if (!AV.rows.length) return; AV.anchor = { r: 0, c: 0 }; AV.sel = { r0: 0, c0: 0, r1: AV.rows.length - 1, c1: AV.dates.length - 1 }; paintSel(); };
  $('#av-undo').onclick = undoAtt;
  $('#av-edit').onclick = () => openCellEditor();
  $$('.codes button').forEach(b => b.onclick = () => applyToSel(b.dataset.code ? { c: b.dataset.code } : null));
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
    wrap.outerHTML = `<div id="grid-wrap" class="empty" style="max-height:none"><b>No employees yet</b>Load them from your master attendance Excel, or type them in one by one.
      <div class="row"><button class="btn pri" onclick="$('#hdr-import').click()">⬆ Import Excel</button><button class="btn" onclick="editEmployee(null)">+ Add employee</button></div></div>`;
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
  const k = (lbl, v, sub, col) => `<div class="kpi" style="--c:${col}"><div class="k">${lbl}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`;
  $('#av-kpis').innerHTML = k('Employees', AV.rows.length, 'in this view', 'var(--accent)') + k('Billable days', all, S.codes.filter(c => c.billable).map(c => c.code).join(' + '), 'var(--pos)')
    + k('Absent', cnt.A || 0, 'days', 'var(--neg)') + k('Day off', cnt.OFF || 0, 'days', 'var(--line3)') + k('Leave / other', leave, 'AL, SL, EL, SIRA…', 'var(--warn)')
    + k('Not marked', blank, 'past days left empty', blank ? '#B45309' : 'var(--line3)');
}
function setSel(a, b) { AV.sel = { r0: Math.min(a.r, b.r), r1: Math.max(a.r, b.r), c0: Math.min(a.c, b.c), c1: Math.max(a.c, b.c) }; paintSel(); }
function paintSel() {
  const wrap = $('#grid-wrap'); if (!wrap) return;
  wrap.querySelectorAll('td.sel').forEach(td => td.classList.remove('sel'));
  const s = AV.sel, si = $('#av-selinfo');
  if (si) si.innerHTML = s ? `<b style="color:var(--accent)">${(s.r1 - s.r0 + 1) * (s.c1 - s.c0 + 1)} day(s) selected</b> · ${s.r1 - s.r0 + 1} worker(s)` : 'No days selected – click or drag in the grid.';
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
  if (!$('#v-attendance').classList.contains('on') || $('#modal-bg').classList.contains('on')) return;
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

function setupSteps() {
  if (!S.employees.length) return '';
  const unm = S.sites.filter(x => !x.projectId).length, noRate = S.projects.filter(p => !p.billing?.rate && p.billing?.basis !== 'fixed').length, noCl = S.projects.filter(p => !p.clientId).length;
  const msg = [unm && `${unm} site(s) not linked to a project`, noCl && `${noCl} project(s) without a client`, noRate && `${noRate} project(s) without a rate`].filter(Boolean);
  return msg.length ? `<div class="alert"><b>Finish setup:</b> ${msg.join(' · ')} <span class="grow"></span><button class="btn sm" onclick="showView('projects')">Fix in Projects &amp; sites →</button></div>` : '';
}
