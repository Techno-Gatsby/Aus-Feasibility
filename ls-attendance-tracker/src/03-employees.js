/* =====================================================================
   Employees: list, add / edit / delete, assignments, bulk actions
   ===================================================================== */
const EV = { q: '', status: 'active', type: '', site: '', project: '', checked: new Set() };

function renderEmployees() {
  const v = $('#v-employees');
  const today = todayISO(), q = norm(EV.q);
  const list = S.employees.filter(e => {
    const cur = assignOn(e, today) || e.assign?.[e.assign.length - 1];
    if (EV.status === 'active' && e.end && e.end < today) return false;
    if (EV.status === 'left' && !(e.end && e.end < today)) return false;
    if (EV.type === 'ls' && e.agency) return false;
    if (EV.type === 'sub' && !e.agency) return false;
    if (EV.site && cur?.site !== EV.site) return false;
    if (EV.project && IX.site.get(cur?.site)?.projectId !== EV.project) return false;
    if (q && !norm(e.name).includes(q) && !norm(e.empCode).includes(q) && !norm(e.agency).includes(q)) return false;
    return true;
  });
  const scope = EV.site ? siteName(EV.site) : EV.project ? IX.proj.get(EV.project)?.name : '';
  v.innerHTML = docHead('Employees', `${list.length} shown · ${S.employees.length} total`, `
      ${scope ? `<span class="pill">${esc(scope)} <button class="btn sm" id="ev-unscope" style="min-height:18px;padding:0 5px;border:0;box-shadow:none">✕</button></span>` : ''}
      <input type="search" id="ev-q" placeholder="Name / ID / agency" value="${esc(EV.q)}" style="width:200px">
      <select id="ev-status">${opts([['active', 'Current'], ['left', 'Left'], ['all', 'Everyone']], EV.status)}</select>
      <select id="ev-type">${opts([['ls', 'LS staff'], ['sub', 'Subcontractors']], EV.type, 'LS + subcon')}</select>`)
  + `<div class="dc"><div class="tw fill"><table><thead><tr>
    <th><input type="checkbox" id="ev-all"></th><th>Emp ID</th><th>Name</th><th>Agency</th><th>Trade</th><th>Shift</th><th>Current site</th><th>Project</th><th>D.O.J</th><th>End date</th><th></th></tr></thead>
    <tbody>${list.map(e => {
      const cur = assignOn(e, today) || e.assign?.[e.assign.length - 1];
      const p = projOfSite(cur?.site);
      return `<tr><td><input type="checkbox" data-chk="${e.id}" ${EV.checked.has(e.id) ? 'checked' : ''}></td>
        <td class="mono">${esc(e.empCode)}</td><td><a href="#" data-edit="${e.id}">${esc(e.name)}</a></td><td>${esc(e.agency || '')}</td><td>${esc(e.trade || '')}</td>
        <td>${esc(cur?.shift || e.shift || '')}</td><td>${esc(siteName(cur?.site))}</td><td class="muted">${esc(p?.name || '')}</td>
        <td class="mono">${fmtDMY(e.doj)}</td><td>${e.end ? `<span class="mono">${fmtDMY(e.end)}</span> <span class="pill ${e.end < today ? 'neg' : 'warn'}">${esc(e.endReason || 'end')}</span>` : ''}</td>
        <td><button class="btn sm" data-edit="${e.id}">Edit</button></td></tr>`;
    }).join('') || '<tr><td colspan="11" class="muted">No workers match.</td></tr>'}</tbody></table></div></div>`;
  if ($('#ev-unscope')) $('#ev-unscope').onclick = clearSel;
  $('#ev-q').oninput = e => { EV.q = e.target.value; clearTimeout(EV._t); EV._t = setTimeout(() => { renderEmployees(); const i = $('#ev-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
  for (const k of ['status', 'type']) $('#ev-' + k).onchange = e => { EV[k] = e.target.value; renderEmployees(); };
  v.querySelectorAll('[data-edit]').forEach(b => b.onclick = ev => { ev.preventDefault(); editEmployee(b.dataset.edit); });
  v.querySelectorAll('[data-chk]').forEach(c => c.onchange = () => { c.checked ? EV.checked.add(c.dataset.chk) : EV.checked.delete(c.dataset.chk); renderToolbar(); });
  $('#ev-all').onchange = e => { list.forEach(x => e.target.checked ? EV.checked.add(x.id) : EV.checked.delete(x.id)); renderEmployees(); renderToolbar(); };
}

function selectedEmps() { const l = [...EV.checked].map(id => IX.emp.get(id)).filter(Boolean); if (!l.length) toast('Tick one or more workers first'); return l; }
function bulkAssign(kind) {
  const l = selectedEmps(); if (!l.length) return;
  openModal(kind === 'site' ? `Assign ${l.length} employee(s) to a site` : `Change shift for ${l.length} employee(s)`, `
    <div class="form">
      <label class="f">Effective from<input type="date" id="ba-from" value="${todayISO()}"></label>
      ${kind === 'site' ? `<label class="f">Site<select id="ba-site">${siteOptions('', null)}</select></label>` : ''}
      <label class="f">Shift<select id="ba-shift">${kind === 'site' ? '<option value="">Keep current shift</option>' : ''}${opts(S.settings.shifts, '')}</select></label>
    </div><p class="muted small">Attendance before this date keeps its old site / shift.</p>`,
    [{ label: 'Cancel' }, {
      label: 'Apply', cls: 'pri', onClick: m => {
        const from = $('#ba-from', m).value; if (!from) { toast('Pick a date'); return false; }
        for (const e of l) {
          const cur = assignOn(e, from);
          const site = kind === 'site' ? $('#ba-site', m).value : cur?.site || '';
          const sh = $('#ba-shift', m).value || cur?.shift || e.shift;
          setAssignment(e, from, site, sh);
          if (kind === 'shift') e.shift = sh;
        }
        markDirty(); renderAll(); toast('Updated ' + l.length + ' worker(s)');
      }
    }]);
}
function bulkEnd() {
  const l = selectedEmps(); if (!l.length) return;
  openModal(`Set end date for ${l.length} employee(s)`, `<div class="form">
    <label class="f">Last working day<input type="date" id="be-d" value="${todayISO()}"></label>
    <label class="f">Reason<select id="be-r">${opts(['RESIGNED', 'TERMINATED', 'ABSCONDED', 'TRANSFERRED', 'CONTRACT END', 'OTHER'], 'RESIGNED')}</select></label></div>`,
    [{ label: 'Cancel' }, { label: 'Apply', cls: 'pri', onClick: m => { for (const e of l) { e.end = $('#be-d', m).value || null; e.endReason = $('#be-r', m).value; } markDirty(); renderAll(); } }]);
}
async function bulkDelete() {
  const l = selectedEmps(); if (!l.length) return;
  const n = l.reduce((a, e) => a + Object.keys(S.att[e.id] || {}).length, 0);
  if (!await confirmBox(`Delete ${l.length} employee(s) and ${n} attendance record(s)?\n\nThis also removes them from past client timesheets. To keep history, set an end date instead.`, 'Delete', 'bad')) return;
  for (const e of l) { delete S.att[e.id]; EV.checked.delete(e.id); }
  const ids = new Set(l.map(e => e.id)); S.employees = S.employees.filter(e => !ids.has(e.id));
  reindex(); markDirty(); renderAll();
}

function editEmployee(id) {
  const isNew = !id;
  const e = isNew ? { id: uid('e'), empCode: '', name: '', agency: '', trade: 'SECURITY GUARD', shift: 'DAY', doj: todayISO(), end: null, endReason: '', assign: [] } : JSON.parse(JSON.stringify(IX.emp.get(id)));
  const nAtt = Object.keys(S.att[e.id] || {}).length;
  const asgRows = () => e.assign.map((a, i) => `<tr>
      <td><input type="date" data-a="${i}" data-k="from" value="${a.from}"></td>
      <td><select data-a="${i}" data-k="site">${siteOptions(a.site)}</select></td>
      <td><select data-a="${i}" data-k="shift">${opts(S.settings.shifts, a.shift)}</select></td>
      <td><button class="btn sm bad" data-adel="${i}">✕</button></td></tr>`).join('');
  const m = openModal(isNew ? 'Add worker' : 'Edit worker', `
    <div class="form">
      <label class="f">Name *<input type="text" id="ee-name" value="${esc(e.name)}"></label>
      <label class="f">Emp ID (LS code, e.g. C14761)<input type="text" id="ee-code" value="${esc(e.empCode)}"></label>
      <label class="f">Subcontractor agency (blank = LS staff)<input type="text" id="ee-agency" list="ee-agencies" value="${esc(e.agency || '')}" placeholder="e.g. FSS, 365 SECURITY"></label>
      <label class="f">Trade<input type="text" id="ee-trade" list="ee-trades" value="${esc(e.trade || '')}"></label>
      <label class="f">Default shift<select id="ee-shift">${opts(S.settings.shifts, e.shift)}</select></label>
      <label class="f">Joining date (D.O.J)<input type="date" id="ee-doj" value="${e.doj || ''}"></label>
      <label class="f">End date (last working day)<input type="date" id="ee-end" value="${e.end || ''}"></label>
      <label class="f">End reason<select id="ee-endr">${opts(['RESIGNED', 'TERMINATED', 'ABSCONDED', 'TRANSFERRED', 'CONTRACT END', 'OTHER'], e.endReason, '')}</select></label>
    </div>
    <datalist id="ee-trades">${S.settings.trades.map(t => `<option value="${esc(t)}">`).join('')}</datalist>
    <datalist id="ee-agencies">${[...new Set(S.employees.map(x => x.agency).filter(Boolean))].map(t => `<option value="${esc(t)}">`).join('')}</datalist>
    <h3>Site allocation history</h3>
    <p class="muted small" style="margin-top:0">Each row applies from its date until the next. Day exceptions (relieving elsewhere) are set in the grid.</p>
    <table><thead><tr><th>From</th><th>Site (project)</th><th>Shift</th><th></th></tr></thead><tbody id="ee-asg">${asgRows()}</tbody></table>
    <button class="btn sm" id="ee-addasg" style="margin-top:6px">Add allocation</button>
    ${!isNew ? `<p class="muted small">${nAtt} attendance day(s) on file.</p>` : ''}
    ${!isNew ? (() => { const a = e.app || {}, last = Object.values(S.punches || {}).filter(p => p.wid === e.id).sort((x, y) => y.ts - x.ts)[0];
      return `<h3 style="margin:14px 0 6px">Worker app</h3><div class="row"><span class="pill ${a.on ? 'pos' : ''}">${a.on ? 'Enabled' : 'Not enabled'}</span>${a.on ? `<span class="muted small">ID <b class="mono">${esc(appCode(e))}</b> · PIN set ${esc(fmtDMY(a.pinAt))}${last ? ` · last punch ${new Date(last.ts).toLocaleString()}` : ''}</span>` : ''}<span class="spacer"></span>
        <button class="btn sm" id="ee-pin">${a.on ? 'New PIN + slip' : 'Enable + PIN + slip'}</button>${a.on ? '<button class="btn sm" id="ee-dev">Reset phone</button><button class="btn sm bad" id="ee-off">Disable</button>' : ''}</div>`; })() : ''}`,
    [
      ...(!isNew ? [{ label: 'Delete worker', cls: 'bad', onClick: async () => {
        if (!await confirmBox(`Delete ${e.name} and ${nAtt} attendance record(s)?\n\nTo keep history, set an end date instead.`, 'Delete', 'bad')) return;
        S.employees = S.employees.filter(x => x.id !== e.id); delete S.att[e.id]; reindex(); markDirty(); renderAll();
      } }] : []),
      { label: 'Cancel' },
      {
        label: 'Save', cls: 'pri', onClick: m => {
          readAsg(m);
          e.name = $('#ee-name', m).value.trim().replace(/\s+/g, ' ').toUpperCase();
          if (!e.name) { toast('Name is required'); return false; }
          e.empCode = $('#ee-code', m).value.trim().toUpperCase();
          const dup = e.empCode && S.employees.find(x => x.id !== e.id && x.empCode === e.empCode);
          if (dup) { toast(`Emp ID ${e.empCode} already belongs to ${dup.name}`); return false; }
          e.agency = $('#ee-agency', m).value.trim().toUpperCase();
          e.trade = $('#ee-trade', m).value.trim().toUpperCase();
          e.shift = $('#ee-shift', m).value;
          e.doj = $('#ee-doj', m).value || null;
          e.end = $('#ee-end', m).value || null;
          e.endReason = e.end ? ($('#ee-endr', m).value || 'OTHER') : '';
          if (e.doj && e.end && e.end < e.doj) { toast('End date is before joining date'); return false; }
          e.assign = e.assign.filter(a => a.from).sort((a, b) => a.from < b.from ? -1 : 1);
          if (e.trade && !S.settings.trades.includes(e.trade)) S.settings.trades.push(e.trade);
          if (isNew) S.employees.push(e); else S.employees[S.employees.findIndex(x => x.id === e.id)] = e;
          reindex(); markDirty(); renderAll(); toast('Saved ' + e.name);
        }
      }
    ]);
  function readAsg(m) { m.querySelectorAll('[data-a]').forEach(inp => { e.assign[+inp.dataset.a][inp.dataset.k] = inp.value; }); }
  function bindAsg() {
    m.querySelectorAll('[data-adel]').forEach(b => b.onclick = () => { readAsg(m); e.assign.splice(+b.dataset.adel, 1); $('#ee-asg', m).innerHTML = asgRows(); bindAsg(); });
  }
  bindAsg();
  const appBtn = (sel, f) => { const b = $(sel, m); if (b) b.onclick = async () => { readAsg(m); const real = IX.emp.get(e.id); await f(real); e.app = real.app; closeModal(); renderAll(); }; };
  appBtn('#ee-pin', async real => printSlips(await givePins([real])));
  appBtn('#ee-dev', async real => { real.app.resetDevice = true; markDirty(); toast('Phone reset – Publish roster to apply'); });
  appBtn('#ee-off', async real => { real.app.on = false; markDirty(); toast('App disabled – Publish roster to apply'); });
  $('#ee-addasg', m).onclick = () => {
    readAsg(m);
    const last = e.assign[e.assign.length - 1];
    e.assign.push({ from: e.assign.length ? todayISO() : ($('#ee-doj', m).value || todayISO()), site: last?.site || '', shift: $('#ee-shift', m).value });
    $('#ee-asg', m).innerHTML = asgRows(); bindAsg();
  };
}
