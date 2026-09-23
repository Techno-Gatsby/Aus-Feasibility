/* =====================================================================
   Data & settings view, app bootstrap
   ===================================================================== */
function renderData() {
  const v = $('#v-data'); const st = S.settings;
  const nAtt = Object.values(S.att).reduce((a, x) => a + Object.keys(x).length, 0);
  v.innerHTML = `
  <div class="card"><h2>Data file</h2>
    ${fsSupported ? '' : '<div class="banner">This browser cannot write to a folder. Open this file in <b>Microsoft Edge</b> or <b>Google Chrome</b>; until then data is kept only inside this browser – use Download backup regularly.</div>'}
    <p style="margin-top:0">Your data is saved as <b>${DATA_FILE}</b> in the folder you choose (pick <b>LS_Documents</b>, next to this HTML file) so OneDrive syncs and versions it. A dated copy is kept once a day in <b>${BACKUP_DIR}\\</b>.
    Current folder: <b>${store.dir ? esc(store.dir.name) : 'none'}</b> ${store.dir ? (store.perm === 'granted' ? '<span class="tag ok">connected</span>' : '<span class="tag warn">needs reconnect</span>') : ''}</p>
    <div class="row">
      <button class="btn pri" id="dv-folder">${store.dir ? 'Change folder' : 'Choose data folder'}</button>
      ${store.dir && store.perm !== 'granted' ? '<button class="btn" onclick="reconnectFolder().then(renderData)">Reconnect</button>' : ''}
      <button class="btn" id="dv-dl">Download backup (.json)</button>
      <label class="btn" style="display:inline-flex;align-items:center">Restore from backup…<input type="file" id="dv-rs" accept=".json,application/json" hidden></label>
    </div>
    <p class="hint">${S.employees.length} employees · ${S.projects.length} projects · ${S.sites.length} sites · ${nAtt.toLocaleString()} attendance days · ${S.invoices.length} invoices${S.savedAt ? ' · last saved ' + new Date(S.savedAt).toLocaleString() : ''}</p>
  </div>

  <div class="card"><h2>Import from Excel</h2>
    <div class="grid2">
      <div><b>Master payroll attendance</b><p class="hint">e.g. "LATINEM SECURITIES MASTER PAYROLL ATTENDANCE MONTH OF JULY-2026.xlsx". Adds/updates employees, their site (PROJECT column), shift, trade, D.O.J and every day's code.</p>
        <label class="btn pri" style="display:inline-flex;align-items:center;margin-top:6px">Choose master file…<input type="file" id="dv-im" accept=".xlsx,.xlsm,.xls" hidden></label></div>
      <div><b>Client timesheet workbook</b><p class="hint">e.g. "SCL TR TIME SHEET - JUNE 2026.xlsx" (one tab per project). Creates projects and their sites and loads that month's attendance.</p>
        <label class="btn" style="display:inline-flex;align-items:center;margin-top:6px">Choose timesheet file…<input type="file" id="dv-ic" accept=".xlsx,.xlsm,.xls" hidden></label></div>
    </div>
    <p class="hint">Excel and PDF features load small libraries from cdn.jsdelivr.net, so they need an internet connection. Everything else works offline.</p>
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
    <p class="hint" style="margin-top:0">Deletes everything in this browser and, if connected, overwrites ${DATA_FILE}. Daily backups in ${BACKUP_DIR}\\ are kept.</p>
    <button class="btn bad" id="dv-reset">Delete all data…</button></div>`;

  $('#dv-folder').onclick = () => connectFolder().then(renderData).catch(e => e.name !== 'AbortError' && toast(e.message));
  $('#dv-dl').onclick = () => downloadBlob(new Blob([JSON.stringify(S)], { type: 'application/json' }), `tracker-data-${todayISO()}.json`);
  $('#dv-rs').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const st = JSON.parse(await f.text()); if (!st.employees || !st.settings) throw new Error('Not a tracker backup file');
      if (!await confirmBox(`Replace all current data with "${f.name}" (${st.employees.length} employees)?`, 'Restore', 'bad')) return;
      S = migrate(st); reindex(); markDirty(); renderAll(); toast('Restored');
    } catch (err) { toast(err.message); }
  };
  $('#dv-im').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importMasterFile(f).catch(err => toast(err.message, 5000)); };
  $('#dv-ic').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importClientFile(f).catch(err => toast(err.message, 5000)); };
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
  try {
    const dir = await IDB.get('dir');
    if (dir) {
      store.dir = dir; store.perm = await permOf(dir, false);
      if (store.perm === 'granted') {
        try { const f = await (await dir.getFileHandle(DATA_FILE)).getFile(); const fs = JSON.parse(await f.text()); if (fs.savedAt && (!S.savedAt || fs.savedAt > S.savedAt)) { S = migrate(fs); reindex(); } } catch { }
      }
    }
  } catch (e) { console.warn(e); }
  $$('#tabs button').forEach(b => b.onclick = () => showView(b.dataset.view));
  $('#modal-bg').addEventListener('mousedown', e => { if (e.target.id === 'modal-bg') closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#modal-bg').classList.contains('on')) closeModal(); });
  renderSaveState(); showView('attendance');
}
init();
