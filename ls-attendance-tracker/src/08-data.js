/* =====================================================================
   Data & settings view, app bootstrap
   ===================================================================== */
function renderData() {
  const v = $('#v-data'); const st = S.settings;
  const nAtt = Object.values(S.att).reduce((a, x) => a + Object.keys(x).length, 0);
  v.innerHTML = `
  ${pageHead('Settings', 'Your data, attendance codes, company details and signatories.')}
  <div class="card"><h2>Your data</h2>
    <div class="kpis">${[['Employees', S.employees.length], ['Projects', S.projects.length], ['Sites', S.sites.length], ['Attendance days', nAtt.toLocaleString()], ['Invoices', S.invoices.length]].map(([k, v]) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')}</div>
    <p class="hint" style="margin:0 0 10px">Everything is saved automatically in this browser on this computer${S.savedAt ? ' (last saved ' + new Date(S.savedAt).toLocaleString() + ')' : ''}. Click <b>Backup</b> now and then and keep the file in LS_Documents – use it to restore or move to another PC.</p>
    <div class="row">
      <button class="btn pri" onclick="$('#hdr-import').click()">⬆ Import Excel</button>
      <button class="btn" id="dv-dl">Download backup</button>
      <label class="btn" style="display:inline-flex;align-items:center">Restore backup…<input type="file" id="dv-rs" accept=".json,application/json" hidden></label>
    </div>
    <p class="hint">Import Excel accepts the master payroll attendance workbook and client timesheet workbooks – the type of each sheet is detected automatically.</p>
  </div>

  <div class="card"><h2>Attendance codes</h2>
    <p class="hint" style="margin-top:0"><b>Billable</b> days are counted in client timesheet totals and invoices. <b>On client sheet</b> prints the code on the client timesheet (others show blank). Key = keyboard shortcut in the grid.</p>
    <table class="t" id="dv-codes"><thead><tr><th>Code</th><th>Meaning</th><th>Colour</th><th>Key</th><th>Billable</th><th>On client sheet</th><th class="num">Used</th><th></th></tr></thead><tbody>
    ${S.codes.map((c, i) => `<tr><td><b>${esc(c.code)}</b></td><td><input type="text" data-ci="${i}" data-ck="label" value="${esc(c.label)}"></td>
      <td><input type="color" data-ci="${i}" data-ck="color" value="${esc(c.color)}"></td>
      <td><input type="text" maxlength="1" data-ci="${i}" data-ck="key" value="${esc(c.key || '')}" style="width:40px"></td>
      <td><input type="checkbox" data-ci="${i}" data-ck="billable" ${c.billable ? 'checked' : ''}></td>
      <td><input type="checkbox" data-ci="${i}" data-ck="client" ${c.client ? 'checked' : ''}></td>
      <td class="num">${codeUsage(c.code)}</td>
      <td>${['P', 'R'].includes(c.code) ? '' : `<button class="btn sm bad" data-cdel="${i}">✕</button>`}</td></tr>`).join('')}
    </tbody></table>
    <div class="row" style="margin-top:8px"><input type="text" id="dv-nc" placeholder="New code e.g. UL" style="width:120px"><input type="text" id="dv-nl" placeholder="Meaning e.g. Unpaid leave"><button class="btn sm" id="dv-addc">+ Add code</button></div>
  </div>

  <div class="card"><h2>Company, form &amp; periods</h2>
    <div class="grid2">
      ${[['company', 'Company legal name'], ['companyShort', 'Name on headers'], ['tel', 'Tel'], ['trn', 'TRN'], ['formNo', 'Form No'], ['revNo', 'Rev No'], ['formDate', 'Form date'], ['tsTitle', 'Timesheet title'], ['preparedBy', 'Prepared by (operation)']]
      .map(([k, l]) => `<label class="f">${l}<input type="text" data-s="${k}" value="${esc(st[k])}"></label>`).join('')}
      <label class="f">Payroll month starts on day<input type="number" min="1" max="28" data-s="cycleStartDay" value="${st.cycleStartDay}"></label>
      <label class="f">Shift hours (for hourly billing)<input type="number" data-s="shiftHours" value="${st.shiftHours}"></label>
      <label class="f">Shifts (comma separated)<input type="text" data-sl="shifts" value="${esc(st.shifts.join(', '))}"></label>
      <label class="f" style="grid-column:1/-1">Trades (comma separated)<input type="text" data-sl="trades" value="${esc(st.trades.join(', '))}"></label>
      <label class="f" style="grid-column:1/-1">Company address<textarea data-s="address">${esc(st.address)}</textarea></label>
    </div>
    <h3>Timesheet signatories</h3>
    <table class="t"><thead><tr><th>Label</th><th>Name / code</th><th>Title</th></tr></thead><tbody>
      ${st.signatories.map((s, i) => `<tr><td><input type="text" data-sg="${i}" data-sk="label" value="${esc(s.label)}"></td><td><input type="text" data-sg="${i}" data-sk="name" value="${esc(s.name)}" style="width:100%"></td><td><input type="text" data-sg="${i}" data-sk="title" value="${esc(s.title)}" style="width:100%"></td></tr>`).join('')}
    </tbody></table>
  </div>

  <div class="card"><h2 style="color:var(--bad)">Reset</h2>
    <p class="hint" style="margin-top:0">Deletes everything saved in this browser. Download a backup first.</p>
    <button class="btn bad" id="dv-reset">Delete all data…</button></div>`;

  $('#dv-dl').onclick = downloadBackup;
  $('#dv-rs').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const st = JSON.parse(await f.text()); if (!st.employees || !st.settings) throw new Error('Not a tracker backup file');
      if (!await confirmBox(`Replace all current data with "${f.name}" (${st.employees.length} employees)?`, 'Restore', 'bad')) return;
      S = migrate(st); reindex(); markDirty(); renderAll(); toast('Restored');
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
  $('#dv-reset').onclick = async () => {
    if (!await confirmBox('Delete ALL employees, attendance, projects and invoices?', 'Delete everything', 'bad')) return;
    S = defaultState(); reindex(); markDirty(); renderAll(); toast('All data deleted');
  };
}
function codeUsage(code) { let n = 0; for (const k in S.att) for (const d in S.att[k]) { const x = S.att[k][d]; if ((typeof x === 'string' ? x : x.c) === code) n++; } return n; }

/* ---------- bootstrap ---------- */
const VIEWS = { attendance: renderAttendance, timesheets: renderTimesheets, invoices: renderInvoices, employees: renderEmployees, projects: renderProjects, data: renderData };
let curView = 'attendance';
function showView(v) {
  curView = v;
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  $$('.view').forEach(s => s.classList.toggle('on', s.id === 'v-' + v));
  VIEWS[v]();
}
function renderAll() { VIEWS[curView](); }

async function init() {
  let st = null;
  try { const j = await IDB.get('state'); if (j) st = JSON.parse(j); } catch (e) { console.warn('IndexedDB unavailable', e); }
  S = migrate(st || defaultState()); reindex();
  $$('#tabs button').forEach(b => b.onclick = () => showView(b.dataset.view));
  $('#modal-bg').addEventListener('mousedown', e => { if (e.target.id === 'modal-bg') closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#modal-bg').classList.contains('on')) closeModal(); });
  $('#hdr-import').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importExcel(f).catch(err => toast(err.message, 5000)); };
  $('#hdr-backup').onclick = downloadBackup;
  renderSaveState(); showView('attendance');
}
init();
