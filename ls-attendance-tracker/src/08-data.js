/* =====================================================================
   Settings document, shell (menus, toolbar, tree, status bar), bootstrap
   ===================================================================== */
function renderData() {
  const v = $('#v-data'); const st = S.settings;
  const nAtt = Object.values(S.att).reduce((a, x) => a + Object.keys(x).length, 0);
  v.innerHTML = docHead('Settings', 'Data, rates, codes, company details') + `<div class="dc">
  ${sec('data', 'Data', `
    <div class="kpis">${[['Workers', S.employees.length], ['Projects', S.projects.length], ['Sites', S.sites.length], ['Attendance days', nAtt.toLocaleString()], ['Invoices', S.invoices.length]].map(([k, v]) => `<div class="kpi"><div class="l">${k}</div><div class="v">${v}</div></div>`).join('')}</div>
    <div class="row">
      <button class="btn pri" onclick="$('#hdr-import').click()">Import Excel…</button>
      <button class="btn" id="dv-dl">Download backup</button>
      <label class="btn" style="display:inline-flex;align-items:center">Restore backup…<input type="file" id="dv-rs" accept=".json,application/json" hidden></label>
      <span class="muted small">Saved in this browser${S.savedAt ? ' · last ' + new Date(S.savedAt).toLocaleString() : ''}. Keep a backup in LS_Documents.</span>
    </div>`)}
  ${sec('rates', 'Rate card <span class="cnt">AED per person per month · pro-rata on calendar days</span>', `
    <div class="tw"><table><thead><tr><th>Trade (as on worker)</th><th>Word on invoice</th><th class="num">Rate</th><th>Source</th><th></th></tr></thead><tbody>
    ${st.rateCard.map((r, i) => `<tr><td><input type="text" data-rc="${i}" data-rk="trade" value="${esc(r.trade)}" list="dv-trades"></td><td><input type="text" data-rc="${i}" data-rk="unit" value="${esc(r.unit)}"></td>
      <td class="num"><input type="number" step="0.01" data-rc="${i}" data-rk="rate" value="${r.rate || ''}" style="width:110px"></td><td><input type="text" data-rc="${i}" data-rk="src" value="${esc(r.src || '')}" style="width:100%"></td>
      <td><button class="btn sm bad" data-rcdel="${i}">✕</button></td></tr>`).join('')}
    </tbody></table></div><datalist id="dv-trades">${st.trades.map(t => `<option value="${esc(t)}">`).join('')}</datalist>
    <div class="row" style="margin-top:8px"><button class="btn sm" id="dv-rcadd">Add trade</button><span class="muted small">Trades without a rate bill at 0 until you enter one.</span></div>`)}
  ${sec('codes', 'Attendance codes', `
    <div class="tw"><table id="dv-codes"><thead><tr><th>Code</th><th>Meaning</th><th>Colour</th><th>Key</th><th>Billable</th><th>On client sheet</th><th class="num">Used</th><th></th></tr></thead><tbody>
    ${S.codes.map((c, i) => `<tr><td><b>${esc(c.code)}</b></td><td><input type="text" data-ci="${i}" data-ck="label" value="${esc(c.label)}"></td>
      <td><input type="color" data-ci="${i}" data-ck="color" value="${esc(c.color)}" style="width:44px;padding:1px"></td>
      <td><input type="text" maxlength="1" data-ci="${i}" data-ck="key" value="${esc(c.key || '')}" style="width:40px"></td>
      <td><input type="checkbox" data-ci="${i}" data-ck="billable" ${c.billable ? 'checked' : ''}></td>
      <td><input type="checkbox" data-ci="${i}" data-ck="client" ${c.client ? 'checked' : ''}></td>
      <td class="num">${codeUsage(c.code)}</td>
      <td>${['P', 'R'].includes(c.code) ? '' : `<button class="btn sm bad" data-cdel="${i}">✕</button>`}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="row" style="margin-top:8px"><input type="text" id="dv-nc" placeholder="Code" style="width:90px"><input type="text" id="dv-nl" placeholder="Meaning"><button class="btn sm" id="dv-addc">Add code</button>
    <span class="muted small">Billable = counted on client timesheets and invoices. On client sheet = printed on the timesheet.</span></div>`)}
  ${sec('company', 'Company, form &amp; periods', `
    <div class="form">
      ${[['company', 'Company legal name'], ['companyShort', 'Name on headers'], ['tel', 'Tel'], ['trn', 'TRN'], ['formNo', 'Form No'], ['revNo', 'Rev No'], ['formDate', 'Form date'], ['tsTitle', 'Timesheet title'], ['preparedBy', 'Prepared by (invoice)']]
      .map(([k, l]) => `<label class="f">${l}<input type="text" data-s="${k}" value="${esc(st[k])}"></label>`).join('')}
      <label class="f">Payroll month starts on day<input type="number" min="1" max="28" data-s="cycleStartDay" value="${st.cycleStartDay}"></label>
      <label class="f">Shift hours (hourly billing)<input type="number" data-s="shiftHours" value="${st.shiftHours}"></label>
      <label class="f">Shifts<input type="text" data-sl="shifts" value="${esc(st.shifts.join(', '))}"></label>
      <label class="f wide">Trades<input type="text" data-sl="trades" value="${esc(st.trades.join(', '))}"></label>
      <label class="f wide">Company address<textarea data-s="address">${esc(st.address)}</textarea></label>
    </div>`)}
  ${sec('sign', 'Timesheet signatories', `
    <div class="tw"><table><thead><tr><th>Label</th><th>Name / code</th><th>Title</th></tr></thead><tbody>
      ${st.signatories.map((s, i) => `<tr><td><input type="text" data-sg="${i}" data-sk="label" value="${esc(s.label)}"></td><td><input type="text" data-sg="${i}" data-sk="name" value="${esc(s.name)}" style="width:100%"></td><td><input type="text" data-sg="${i}" data-sk="title" value="${esc(s.title)}" style="width:100%"></td></tr>`).join('')}
    </tbody></table></div>`)}
  ${sec('reset', 'Reset', `<div class="row"><button class="btn" id="dv-seed">Reload shipped data…</button><button class="btn bad" id="dv-reset">Delete all data…</button><span class="muted small">Download a backup first.</span></div>`)}
  </div>`;
  bindSecs(v);
  $('#dv-dl').onclick = downloadBackup;
  v.querySelectorAll('[data-rc]').forEach(i => i.onchange = () => { const r = S.settings.rateCard[+i.dataset.rc]; r[i.dataset.rk] = i.dataset.rk === 'rate' ? +i.value || 0 : i.dataset.rk === 'trade' ? norm(i.value) : i.value.trim(); markDirty(); });
  v.querySelectorAll('[data-rcdel]').forEach(b => b.onclick = () => { S.settings.rateCard.splice(+b.dataset.rcdel, 1); markDirty(); renderData(); });
  $('#dv-rcadd').onclick = () => { S.settings.rateCard.push({ trade: '', unit: '', rate: 0, src: '' }); markDirty(); renderData(); };
  $('#dv-rs').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const st = JSON.parse(await f.text()); if (!st.employees || !st.settings) throw new Error('Not a tracker backup file');
      if (!await confirmBox(`Replace all current data with "${f.name}" (${st.employees.length} workers)?`, 'Restore', 'bad')) return;
      S = migrate(decodeState(st)); reindex(); defaultPeriods(); markDirty(); renderAll(); toast('Restored');
    } catch (err) { toast(err.message); }
  };
  v.querySelectorAll('[data-ci]').forEach(i => i.onchange = () => {
    const c = S.codes[+i.dataset.ci]; const k = i.dataset.ck;
    c[k] = i.type === 'checkbox' ? i.checked : i.value.trim();
    if (k === 'key' && c.key) S.codes.forEach(o => { if (o !== c && o.key?.toLowerCase() === c.key.toLowerCase()) o.key = ''; });
    reindex(); markDirty(); if (k === 'key') renderData();
  });
  v.querySelectorAll('[data-cdel]').forEach(b => b.onclick = async () => {
    const c = S.codes[+b.dataset.cdel]; const n = codeUsage(c.code);
    if (n && !await confirmBox(`${c.code} is used on ${n} day(s). Delete the code and clear those days?`, 'Delete', 'bad')) return;
    for (const k in S.att) for (const d in S.att[k]) { const x = S.att[k][d]; if ((typeof x === 'string' ? x : x.c) === c.code) delete S.att[k][d]; }
    S.codes.splice(+b.dataset.cdel, 1); reindex(); markDirty(); renderData();
  });
  $('#dv-addc').onclick = () => {
    const code = normCode($('#dv-nc').value); if (!code) return;
    if (IX.code.has(code)) return toast('Code exists');
    S.codes.push({ code, label: $('#dv-nl').value.trim() || code, color: '#e9e2f7', billable: false, client: false, key: '' }); reindex(); markDirty(); renderData();
  };
  v.querySelectorAll('[data-s]').forEach(i => i.onchange = () => { const k = i.dataset.s; S.settings[k] = i.type === 'number' ? +i.value : i.value; markDirty(); });
  v.querySelectorAll('[data-sl]').forEach(i => i.onchange = () => { S.settings[i.dataset.sl] = i.value.split(',').map(x => norm(x)).filter(Boolean); markDirty(); });
  v.querySelectorAll('[data-sg]').forEach(i => i.onchange = () => { S.settings.signatories[+i.dataset.sg][i.dataset.sk] = i.value; markDirty(); });
  $('#dv-seed').onclick = async () => {
    if (!await confirmBox('Replace everything with the data shipped in this file (LS workbooks, June–July 2026)?', 'Reload', 'bad')) return;
    S = migrate(shippedState()); reindex(); defaultPeriods(); markDirty(); renderAll(); toast('Shipped data loaded');
  };
  $('#dv-reset').onclick = async () => {
    if (!await confirmBox('Delete ALL workers, attendance, projects and invoices?', 'Delete everything', 'bad')) return;
    S = defaultState(); reindex(); markDirty(); renderAll(); toast('All data deleted');
  };
}
function codeUsage(code) { let n = 0; for (const k in S.att) for (const d in S.att[k]) { const x = S.att[k][d]; if ((typeof x === 'string' ? x : x.c) === code) n++; } return n; }

/* ---------- shell: views, toolbar, menus, tree, status ---------- */
const VIEWS = { attendance: renderAttendance, timesheets: renderTimesheets, invoices: renderInvoices, employees: renderEmployees, projects: renderProjects, data: renderData };
let curView = 'attendance';
const SEL = { client: '', project: '', site: '' };          // tree selection, applied to the open document
function showView(v) {
  curView = v;
  $$('#tabs .doctab').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  $$('.doc').forEach(s => s.classList.toggle('on', s.id === 'v-' + v));
  VIEWS[v](); renderToolbar(); renderStatus();
}
function renderAll() { VIEWS[curView](); renderToolbar(); renderTree(); renderStatus(); }

const TOOLBAR = {
  attendance: () => [{ l: 'Add worker', f: () => editEmployee(null) }, { l: 'Set site / shift…', f: () => openCellEditor(), t: 'Reliever at another site, or a shift change, for the selected days' }, { l: 'Undo', f: undoAtt, t: 'Ctrl+Z' }, 'sep',
    { l: S.locks[AV.ym] ? 'Unlock month' : 'Lock month', f: () => { if (S.locks[AV.ym]) delete S.locks[AV.ym]; else S.locks[AV.ym] = true; markDirty(); renderAttendance(); renderToolbar(); }, t: 'Locked months cannot be edited' }, 'sep',
    { l: 'Export Excel', f: () => exportMasterXlsx().catch(e => toast(e.message)), t: 'Master attendance sheet for this period' }],
  timesheets: () => [{ l: 'Export Excel', f: () => tsCmd('xlsx'), t: 'One tab per ticked project (LS/DO/F-026)' }, { l: 'Print / PDF', f: () => tsCmd('print'), strong: true }],
  invoices: () => [{ l: 'New invoice', f: () => ivCmd('new') }, 'sep', { l: 'Generate lines', f: () => ivCmd('gen'), t: 'From attendance for the ticked projects and months' }, { l: 'Save', f: () => ivCmd('save') }, { l: 'Print pack / PDF', f: () => ivCmd('print'), strong: true, t: 'Break-up sheet followed by the client timesheets' }],
  employees: () => { const n = EV.checked.size; return [{ l: 'Add worker', f: () => editEmployee(null) }, 'sep', { l: 'Assign to site…', f: () => bulkAssign('site'), dis: !n }, { l: 'Change shift…', f: () => bulkAssign('shift'), dis: !n }, { l: 'Set end date…', f: bulkEnd, dis: !n }, { l: 'Delete…', f: bulkDelete, dis: !n }, { l: n ? `${n} ticked` : 'Tick workers for bulk actions', dis: true }]; },
  projects: () => [{ l: 'Add client', f: () => editClient(null) }, { l: 'Add project', f: () => editProject(null) }, { l: 'Add site', f: () => editSite(null, SEL.project || null) }],
  data: () => [{ l: 'Import Excel…', f: () => $('#hdr-import').click(), strong: true }, { l: 'Backup', f: downloadBackup }]
};
function renderToolbar() {
  const tb = $('#toolbar'); const items = TOOLBAR[curView]?.() || [];
  tb.innerHTML = items.map((x, i) => x === 'sep' ? '<span class="sep"></span>' : `<button data-tb="${i}" class="${x.strong ? 'strong' : ''}" ${x.dis ? 'disabled' : ''} title="${esc(x.t || '')}">${esc(x.l)}</button>`).join('')
    + `<span class="spacer"></span><button data-cmd="tree" title="Show / hide the tree">◧ Tree</button>`;
  tb.querySelectorAll('[data-tb]').forEach(b => b.onclick = () => items[+b.dataset.tb].f?.());
  tb.querySelector('[data-cmd=tree]').onclick = () => $('#body').classList.toggle('notree');
}
function renderStatus() {
  const unl = S.sites.filter(s => !s.projectId).length;
  const per = curView === 'attendance' && AV.ym ? (() => { const { start, end } = attPeriod(); return `${AV.mode === 'payroll' ? 'Payroll' : 'Calendar'} month ${fmtMonYY(AV.ym)} · ${fmtDMY(start)} – ${fmtDMY(end)}`; })() : curView === 'timesheets' && TV.ym ? `Calendar month ${fmtMonYY(TV.ym)}` : 'Ready';
  $('#status').textContent = per;
  $('#status2').textContent = `${S.employees.length} workers · ${S.projects.length} projects · ${S.sites.length} sites${unl ? ` · ${unl} unlinked` : ''}`;
}

/* menus */
const MENUS = {
  file: () => [['Import Excel…', () => $('#hdr-import').click()], ['Download backup', downloadBackup], ['Restore backup…', () => { showView('data'); $('#dv-rs').click(); }], null,
    ['Export attendance (Excel)', () => exportMasterXlsx().catch(e => toast(e.message))], ['Export client timesheets (Excel)', () => tsCmd('xlsx')], ['Print client timesheets', () => tsCmd('print')], null,
    ['Reload shipped data…', () => { showView('data'); $('#dv-seed').click(); }], ['Delete all data…', () => { showView('data'); $('#dv-reset').click(); }]],
  edit: () => [['Undo', undoAtt, 'Ctrl+Z'], ['Select all days', () => { if (!AV.rows.length) return; AV.anchor = { r: 0, c: 0 }; AV.sel = { r0: 0, c0: 0, r1: AV.rows.length - 1, c1: AV.dates.length - 1 }; paintSel(); }], ['Set site / shift for selection…', () => openCellEditor(), 'Enter'], ['Clear selected days', () => applyToSel(null, false), 'Del'], null,
    ['Add worker…', () => editEmployee(null)], ['Add client…', () => editClient(null)], ['Add project…', () => editProject(null)], ['Add site…', () => editSite(null, SEL.project || null)]],
  view: () => [...Object.entries({ attendance: 'Attendance', timesheets: 'Client timesheets', invoices: 'Invoice', employees: 'Employees', projects: 'Projects & sites', data: 'Settings' }).map(([k, l]) => [l, () => showView(k)]), null, ['Show / hide tree', () => $('#body').classList.toggle('notree')], ['Data checks…', openChecks]],
  help: () => [['Keys & codes', helpKeys], ['How the numbers are made', helpCalc], ['About', () => openModal('About', `<p>Attendance Tracker for Latinem Securities.<br>Attendance → client timesheets (LS/DO/F-026) → tax invoice break-up. Data is saved in this browser; keep backups in LS_Documents.</p><p class="muted small">Excel and PDF features load SheetJS, ExcelJS and pdf-lib from cdn.jsdelivr.net.</p>`, [{ label: 'Close', cls: 'pri' }])]]
};
function openMenu(btn) {
  const dd = $('#dropdown'); const items = MENUS[btn.dataset.menu]();
  dd.innerHTML = items.map((x, i) => x ? `<button data-mi="${i}">${esc(x[0])}${x[2] ? `<span class="kbd">${esc(x[2])}</span>` : ''}</button>` : '<hr>').join('');
  dd.querySelectorAll('[data-mi]').forEach(b => b.onclick = () => { closeMenu(); items[+b.dataset.mi][1](); });
  const r = btn.getBoundingClientRect(); dd.style.left = r.left + 'px'; dd.style.top = r.bottom + 2 + 'px'; dd.hidden = false;
  $$('.menu').forEach(m => m.classList.toggle('open', m === btn));
}
function closeMenu() { $('#dropdown').hidden = true; $$('.menu.open').forEach(m => m.classList.remove('open')); }
function helpKeys() {
  openModal('Keys & codes', `<div class="form two"><div><h3>Attendance grid</h3><table><tbody>
    ${[['Click / drag', 'select days'], ['Shift + click', 'extend selection'], ['Arrows', 'move'], ['Code key', 'mark selected days'], ['Del', 'clear'], ['Enter', 'reliever site / shift'], ['Ctrl+Z', 'undo'], ['Click a name', 'edit worker']].map(([a, b]) => `<tr><td class="lab">${a}</td><td>${b}</td></tr>`).join('')}</tbody></table></div>
    <div><h3>Codes</h3><table><tbody>${S.codes.map(c => `<tr><td><span class="codes"><button style="background:${c.color}">${esc(c.code)}${c.key ? `<span class="kbd">${c.key.toUpperCase()}</span>` : ''}</button></span></td><td>${esc(c.label)}${c.billable ? ' · billable' : ''}</td></tr>`).join('')}</tbody></table></div></div>`, [{ label: 'Close', cls: 'pri' }]);
}
function helpCalc() {
  openModal('How the numbers are made', `<table><tbody>
    <tr><td class="lab">Payroll month</td><td>${S.settings.cycleStartDay}th of previous month to ${S.settings.cycleStartDay - 1}th, as the LS-PAYROLL sheet.</td></tr>
    <tr><td class="lab">Client timesheet</td><td>Calendar month, one sheet per project, rows grouped by site, relievers in a RELIEVER section. TOTAL DAYS = COUNTIF P (or R). Same cells as LS/DO/F-026.</td></tr>
    <tr><td class="lab">Invoice line</td><td>Workers grouped by trade and days: "4 Security @ 31 Days" at 4,100 = 16,400; "1 Security @ 5 Days" = 4,100 × 5 ÷ 31 = 661.29.</td></tr>
    <tr><td class="lab">Fixed amount</td><td>Projects on a fixed monthly amount (Sobha Waves 32,795) bill that amount regardless of attendance.</td></tr>
    <tr><td class="lab">Rates</td><td>Project rate table → rate card → project unit rate. Verified: guard 4,100 · female guard 3,990 · supervisor 8,000.</td></tr>
  </tbody></table>`, [{ label: 'Close', cls: 'pri' }]);
}

/* tree: clients → projects → sites, with current headcount */
const TREE = { open: new Set(), q: '' };
function renderTree() {
  const ul = $('#tree'); if (!ul) return;
  const today = todayISO(), bySite = new Map();
  for (const e of S.employees) { if (!employedOn(e, today)) continue; const s = assignOn(e, today)?.site; if (s) bySite.set(s, (bySite.get(s) || 0) + 1); }
  const q = norm(TREE.q);
  const projSites = new Map(); for (const s of S.sites) if (s.projectId) (projSites.get(s.projectId) || projSites.set(s.projectId, []).get(s.projectId)).push(s);
  const projN = p => (projSites.get(p.id) || []).reduce((a, s) => a + (bySite.get(s.id) || 0), 0);
  const isSel = (k, id) => (k === 'grp' && SEL.client === id && !SEL.project) || (k === 'proj' && SEL.project === id && !SEL.site) || (k === 'site' && SEL.site === id);
  const node = (cls, id, name, val, kids, open, extra = '') => `<li class="${cls} ${open || (q && kids) ? '' : 'closed'}" data-id="${id}"><div class="node ${isSel(cls, id) ? 'sel' : ''}" data-k="${cls}" data-id="${id}"><span class="tw" data-tg>${kids ? '▾' : ''}</span><span class="nm" title="${esc(name)}">${esc(name)}</span>${extra}<span class="val">${val || ''}</span></div>${kids ? `<ul>${kids}</ul>` : ''}</li>`;
  const siteLi = s => node('site', s.id, s.name, bySite.get(s.id), '', true);
  const projLi = p => { const ss = (projSites.get(p.id) || []).filter(s => !q || norm(s.name).includes(q) || norm(p.name).includes(q)).sort((a, b) => a.name.localeCompare(b.name)); if (q && !ss.length && !norm(p.name).includes(q)) return ''; return node('proj', p.id, p.name, projN(p), ss.map(siteLi).join(''), TREE.open.has(p.id)); };
  const groups = [...S.clients].sort((a, b) => a.name.localeCompare(b.name)).map(c => { const ps = S.projects.filter(p => p.clientId === c.id).sort((a, b) => a.name.localeCompare(b.name)).map(projLi).join(''); if (q && !ps) return ''; return node('grp', c.id, c.name, S.projects.filter(p => p.clientId === c.id).length, ps || '<li class="muted" style="padding:2px 8px">no projects</li>', !TREE.open.has('!' + c.id)); });
  const noClient = S.projects.filter(p => !p.clientId).sort((a, b) => a.name.localeCompare(b.name)).map(projLi).join('');
  const unl = S.sites.filter(s => !s.projectId).filter(s => !q || norm(s.name).includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  ul.innerHTML = groups.join('') + (noClient ? node('grp', '__noclient', 'No client', '', noClient, true, '<span class="pill neg">fix</span>') : '') + (unl.length ? node('grp', '__unlinked', 'Unlinked sites', unl.length, unl.map(siteLi).join(''), TREE.open.has('__unlinked'), '<span class="pill neg">fix</span>') : '');
  $('#railcount').textContent = `${S.projects.length} projects`;
  ul.querySelectorAll('.node').forEach(n => {
    n.onclick = e => {
      const li = n.parentElement, id = n.dataset.id, k = n.dataset.k;
      if (e.target.hasAttribute('data-tg') || (k === 'grp' && id.startsWith('__'))) {
        li.classList.toggle('closed'); const open = !li.classList.contains('closed');
        if (k === 'grp' && !id.startsWith('__')) { open ? TREE.open.delete('!' + id) : TREE.open.add('!' + id); } else { open ? TREE.open.add(id) : TREE.open.delete(id); }
        return;
      }
      selectNode(k, id);
    };
    n.ondblclick = () => { const k = n.dataset.k, id = n.dataset.id; if (id.startsWith('__')) return; k === 'grp' ? editClient(id) : k === 'proj' ? editProject(id) : editSite(id); };
  });
}
function clearSel() { SEL.client = SEL.project = SEL.site = ''; $$('#tree .node.sel').forEach(n => n.classList.remove('sel')); applySel(); }
/** Tree click → filter the open document (click again to clear) */
function selectNode(k, id) {
  const same = (k === 'grp' && SEL.client === id && !SEL.project) || (k === 'proj' && SEL.project === id && !SEL.site) || (k === 'site' && SEL.site === id);
  SEL.client = SEL.project = SEL.site = '';
  if (!same) {
    if (k === 'grp') SEL.client = id;
    else if (k === 'proj') { SEL.project = id; SEL.client = IX.proj.get(id)?.clientId || ''; }
    else { SEL.site = id; const p = projOfSite(id); SEL.project = p?.id || ''; SEL.client = p?.clientId || ''; }
  }
  $$('#tree .node').forEach(n => n.classList.toggle('sel', (n.dataset.k === 'grp' && SEL.client === n.dataset.id && !SEL.project) || (n.dataset.k === 'proj' && SEL.project === n.dataset.id && !SEL.site) || (n.dataset.k === 'site' && SEL.site === n.dataset.id)));
  applySel();
}
function applySel() {
  if (curView === 'attendance') { Object.assign(AV.f, { client: SEL.client, project: SEL.project, site: SEL.site }); AV.sel = null; renderAttendance(); }
  else if (curView === 'timesheets') { TV.client = SEL.client; if (SEL.project) TV.preview = SEL.project; TV.all = true; renderTimesheets(); }
  else if (curView === 'invoices') { const dr = IV.draft ||= newInvoiceDraft(); if (SEL.project) { if (!dr.projectIds.includes(SEL.project)) dr.projectIds.push(SEL.project); const p = IX.proj.get(SEL.project); if (!dr.clientId) dr.clientId = p.clientId || ''; } else dr.clientId = SEL.client; renderInvoices(); }
  else if (curView === 'employees') { EV.project = SEL.project; EV.site = SEL.site; renderEmployees(); }
  else if (curView === 'projects') { PV.focus = SEL.project || SEL.client; renderProjects(); }
  renderStatus();
}

/** Open on the latest payroll cycle that is substantially filled (the client sheet may run a few days past it) */
function defaultPeriods() {
  const perCycle = new Map(); let last = '';
  for (const k in S.att) for (const d in S.att[k]) { const c = cycleOfDate(d); perCycle.set(c, (perCycle.get(c) || 0) + 1); if (d > last) last = d; }
  const max = Math.max(0, ...perCycle.values());
  const cyc = [...perCycle.entries()].filter(([, n]) => n >= max * 0.5).map(([c]) => c).sort().pop();
  AV.ym = cyc || cycleOfDate(todayISO()); AV.mode = 'payroll';
  TV.ym = last ? ymOf(last) : addMonths(ymOf(todayISO()), -1); TV.all = true;
}
async function init() {
  let st = null;
  try { const j = await IDB.get('state'); if (j) st = JSON.parse(j); } catch (e) { console.warn('IndexedDB unavailable', e); }
  S = migrate(location.hash === '#empty' ? defaultState() : st || shippedState()); reindex(); defaultPeriods();
  $$('#tabs .doctab').forEach(b => b.onclick = () => showView(b.dataset.view));
  $$('.menu').forEach(b => { b.onclick = e => { e.stopPropagation(); b.classList.contains('open') ? closeMenu() : openMenu(b); }; b.onmouseenter = () => { if (!$('#dropdown').hidden) openMenu(b); }; });
  document.addEventListener('mousedown', e => { if (!e.target.closest('#dropdown,.menu')) closeMenu(); });
  $('#modal-bg').addEventListener('mousedown', e => { if (e.target.id === 'modal-bg') closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeMenu(); if ($('#modal-bg').classList.contains('on')) closeModal(); } });
  $('#hdr-import').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importExcel(f).catch(err => toast(err.message, 5000)); };
  $('#tree-q').oninput = e => { TREE.q = e.target.value; clearTimeout(TREE._t); TREE._t = setTimeout(renderTree, 200); };
  renderSaveState(); renderTree(); showView('attendance'); document.body.dataset.ready = '1';
}
init();
