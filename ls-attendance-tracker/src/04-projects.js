/* =====================================================================
   Clients -> Projects -> Sites, with billing configuration per project
   ===================================================================== */
const BASES = [
  ['ratecard', 'Rate card per trade, pro-rata on calendar days (as Latinem invoices)'],
  ['monthly_cal', 'Monthly rate per guard, pro-rata on calendar days'],
  ['monthly_26', 'Monthly rate per guard, pro-rata on 26 days'],
  ['monthly_30', 'Monthly rate per guard, pro-rata on 30 days'],
  ['daily', 'Rate per man-day'],
  ['hourly', 'Rate per hour (man-days × shift hours)'],
  ['fixed', 'Fixed posts × monthly rate (ignores attendance)'],
  ['lump', 'Fixed monthly amount (e.g. Sobha Waves 32,795) – enter it as the unit rate']
];
const PV = { q: '' };

function renderProjects() {
  const v = $('#v-projects');
  const q = norm(PV.q);
  const unmapped = S.sites.filter(s => !s.projectId || !IX.proj.has(s.projectId));
  const headcount = siteId => { const t = todayISO(); return S.employees.filter(e => employedOn(e, t) && assignOn(e, t)?.site === siteId).length; };
  const projRows = [...S.projects].filter(p => !q || norm(p.name).includes(q) || norm(p.code).includes(q) || sitesOfProject(p.id).some(s => norm(s.name).includes(q)))
    .sort((a, b) => (IX.client.get(a.clientId)?.name || 'zz').localeCompare(IX.client.get(b.clientId)?.name || 'zz') || a.name.localeCompare(b.name));
  v.innerHTML = pageHead('Projects &amp; sites', 'Client → project → sites. Each project holds the SAP code, PO number and billing rate used on invoices.') + `
  <div class="card">
    <div class="row"><h2 style="margin:0">Clients</h2><span class="grow"></span><button class="btn pri" id="pv-addc">+ Add client</button></div>
    <table class="t" style="margin-top:8px"><thead><tr><th>Client (billing entity)</th><th>Customer code</th><th>TRN</th><th class="num">Projects</th><th></th></tr></thead><tbody>
    ${S.clients.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.customerCode || '')}</td><td>${esc(c.trn || '')}</td><td class="num">${S.projects.filter(p => p.clientId === c.id).length}</td>
      <td><button class="btn sm" data-ec="${c.id}">Edit</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No clients yet – e.g. SOBHA CONSTRUCTIONS LLC, Sobha Community Management LLC, Provis, Kaizen.</td></tr>'}
    </tbody></table>
  </div>
  ${unmapped.length ? `<div class="card"><h2>Unmapped sites <span class="tag warn">${unmapped.length}</span></h2>
    <p class="hint" style="margin-top:0">Sites from the master sheet that don't belong to a project yet. They won't appear on client timesheets or invoices until linked.</p>
    <div class="row" style="margin:0 0 8px"><b class="small">Link ticked sites to</b><select id="pv-bulkp">${opts(S.projects.map(p => [p.id, p.name]).sort((a, b) => a[1].localeCompare(b[1])), '', '— choose project —')}</select><button class="btn sm pri" id="pv-bulk">Link</button></div>
    <table class="t"><thead><tr><th><input type="checkbox" id="pv-all"></th><th>Site</th><th class="num">Staff now</th><th>Or link one by one</th><th></th></tr></thead><tbody>
    ${unmapped.map(s => `<tr><td><input type="checkbox" data-um="${s.id}"></td><td>${esc(s.name)}</td><td class="num">${headcount(s.id)}</td>
      <td><select data-map="${s.id}">${opts(S.projects.map(p => [p.id, p.name]).sort((a, b) => a[1].localeCompare(b[1])), '', '— choose project —')}<option value="__new">+ New project with this name…</option></select></td>
      <td><button class="btn sm" data-es="${s.id}">Edit</button></td></tr>`).join('')}
    </tbody></table></div>` : ''}
  <div class="card">
    <div class="row"><h2 style="margin:0">Projects &amp; sites</h2>
      <input type="search" id="pv-q" placeholder="Search project / code / site" value="${esc(PV.q)}" style="width:230px">
      <span class="grow"></span><button class="btn pri" id="pv-addp">+ Add project</button></div>
    ${projRows.map(p => {
      const c = IX.client.get(p.clientId); const b = p.billing || {};
      const ss = sitesOfProject(p.id);
      return `<div style="border:1px solid var(--line);border-radius:8px;margin-top:12px">
        <div class="row" style="padding:8px 12px;background:#f7f8fa;border-bottom:1px solid var(--line);border-radius:8px 8px 0 0">
          <b>${esc(p.name)}</b>${p.code ? `<span class="tag">${esc(p.code)}</span>` : ''}
          <span class="muted small">${esc(c?.name || 'No client')}</span>
          ${!p.clientId ? '<span class="tag warn">client not set</span>' : ''}
          ${!rateFor(p, 'SECURITY GUARD') && b.basis !== 'fixed' ? '<span class="tag warn">rate not set</span>' : ''}
          <span class="small muted">${(!b.basis || b.basis === 'ratecard') ? 'Rate card · guard AED ' + money(rateFor(p, 'SECURITY GUARD')) + (Object.keys(b.rates || {}).length ? ' (project rates)' : '') : esc((BASES.find(x => x[0] === b.basis) || [, ''])[1]) + (b.rate ? ' · AED ' + money(b.rate) : '')} · VAT ${b.vat || 0}%</span>
          ${p.active === false ? '<span class="tag">inactive</span>' : ''}
          <span class="grow"></span>
          <button class="btn sm" data-addsite="${p.id}">+ Site</button>
          <button class="btn sm" data-ep="${p.id}">Edit project</button>
        </div>
        <table class="t"><tbody>${ss.map(s => `<tr><td style="width:50%">${esc(s.name)}</td><td class="num small muted">${headcount(s.id)} staff now</td>
          <td style="text-align:right"><button class="btn sm" data-es="${s.id}">Edit</button></td></tr>`).join('') || '<tr><td class="muted small">No sites yet</td></tr>'}</tbody></table>
      </div>`;
    }).join('') || '<p class="muted">No projects yet.</p>'}
  </div>`;
  $('#pv-addc').onclick = () => editClient(null);
  if ($('#pv-bulk')) {
    $('#pv-all').onchange = e => v.querySelectorAll('[data-um]').forEach(c => c.checked = e.target.checked);
    $('#pv-bulk').onclick = () => {
      const pid = $('#pv-bulkp').value, ids = [...v.querySelectorAll('[data-um]:checked')].map(c => c.dataset.um);
      if (!pid || !ids.length) return toast('Tick sites and choose a project');
      ids.forEach(id => IX.site.get(id).projectId = pid); markDirty(); renderAll(); toast(`Linked ${ids.length} site(s)`);
    };
  }
  $('#pv-addp').onclick = () => editProject(null);
  $('#pv-q').oninput = e => { PV.q = e.target.value; clearTimeout(PV._t); PV._t = setTimeout(() => { renderProjects(); const i = $('#pv-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
  v.querySelectorAll('[data-ec]').forEach(b => b.onclick = () => editClient(b.dataset.ec));
  v.querySelectorAll('[data-ep]').forEach(b => b.onclick = () => editProject(b.dataset.ep));
  v.querySelectorAll('[data-es]').forEach(b => b.onclick = () => editSite(b.dataset.es));
  v.querySelectorAll('[data-addsite]').forEach(b => b.onclick = () => editSite(null, b.dataset.addsite));
  v.querySelectorAll('[data-map]').forEach(sel => sel.onchange = () => {
    const s = IX.site.get(sel.dataset.map);
    if (sel.value === '__new') { editProject(null, s.name, pid => { s.projectId = pid; }); return; }
    if (sel.value) { s.projectId = sel.value; markDirty(); renderAll(); }
  });
}

function editClient(id) {
  const c = id ? { ...IX.client.get(id) } : { id: uid('c'), name: '', customerCode: '', trn: '', address: '' };
  openModal(id ? 'Edit client' : 'Add client', `<div class="grid2">
    <label class="f">Client / billing entity name *<input type="text" id="ec-name" value="${esc(c.name)}"></label>
    <label class="f">Customer code (SAP)<input type="text" id="ec-cc" value="${esc(c.customerCode || '')}"></label>
    <label class="f">TRN<input type="text" id="ec-trn" value="${esc(c.trn || '')}"></label>
    </div><label class="f" style="margin-top:10px">Address<textarea id="ec-addr">${esc(c.address || '')}</textarea></label>`,
    [...(id ? [{ label: 'Delete', cls: 'bad', onClick: async () => {
      if (S.projects.some(p => p.clientId === id)) { toast('Move or delete this client\'s projects first'); return; }
      S.clients = S.clients.filter(x => x.id !== id); reindex(); markDirty(); renderAll();
    } }] : []), { label: 'Cancel' }, {
      label: 'Save', cls: 'pri', onClick: m => {
        c.name = $('#ec-name', m).value.trim(); if (!c.name) { toast('Name required'); return false; }
        c.customerCode = $('#ec-cc', m).value.trim(); c.trn = $('#ec-trn', m).value.trim(); c.address = $('#ec-addr', m).value;
        if (id) S.clients[S.clients.findIndex(x => x.id === id)] = c; else S.clients.push(c);
        reindex(); markDirty(); renderAll();
      }
    }]);
}

function editProject(id, presetName, onCreated) {
  const p = id ? JSON.parse(JSON.stringify(IX.proj.get(id))) : { id: uid('p'), clientId: '', code: '', name: presetName || '', entityName: '', poNo: '', woiNo: '', billing: { basis: 'ratecard', rate: 0, vat: 0, posts: 0, unit: 'Security', rates: {} }, active: true };
  p.billing ||= { basis: 'ratecard', rate: 0, vat: 0 };
  p.billing.rates ||= {};
  openModal(id ? 'Edit project' : 'Add project', `<div class="grid2">
    <label class="f">Project name * (as on timesheet)<input type="text" id="ep-name" value="${esc(p.name)}" placeholder="SCL TR - AL QUOZ TR"></label>
    <label class="f">Project code (SAP)<input type="text" id="ep-code" value="${esc(p.code || '')}" placeholder="104N135"></label>
    <label class="f">Client<select id="ep-client">${opts(S.clients.map(c => [c.id, c.name]), p.clientId, '— choose client —')}</select></label>
    <label class="f">Entity text on invoice<input type="text" id="ep-entity" value="${esc(p.entityName || '')}" placeholder="SOBHA CONSTRUCTIONS LLC (ELWOOD INFRASTRUCTURE @ Al Yufrah)"></label>
    <label class="f">PO / Work order instruction no.<input type="text" id="ep-po" value="${esc(p.poNo || '')}" placeholder="INS-104N135-26-0002"></label>
    <label class="f">Active<select id="ep-active">${opts([['1', 'Active'], ['0', 'Inactive']], p.active === false ? '0' : '1')}</select></label>
    ${id ? `<label class="f">Merge into another project (moves all sites)<select id="ep-merge">${opts(S.projects.filter(x => x.id !== id).map(x => [x.id, x.name]).sort((a, b) => a[1].localeCompare(b[1])), '', "— don't merge —")}</select></label>` : ''}
    </div>
    <h3>Billing</h3>
    <div class="grid2">
      <label class="f">Basis<select id="ep-basis">${opts(BASES, p.billing.basis)}</select></label>
      <label class="f">Unit rate (other bases)<input type="number" step="0.01" id="ep-rate" value="${p.billing.rate || 0}"></label>
      <label class="f">VAT %<input type="number" step="0.01" id="ep-vat" value="${p.billing.vat ?? 0}"></label>
      <label class="f">Fixed posts (for "fixed" basis)<input type="number" id="ep-posts" value="${p.billing.posts || 0}"></label>
      <label class="f">Unit word on invoice<input type="text" id="ep-unit" value="${esc(p.billing.unit || 'Security')}"></label>
    </div>
    <h3>Rate per trade for this project <small class="muted" style="text-transform:none;letter-spacing:0">(blank = rate card in Settings)</small></h3>
    <table class="t"><thead><tr><th>Trade</th><th class="num">Rate card</th><th class="num">This project (AED / month)</th></tr></thead><tbody>
    ${S.settings.rateCard.map(r => `<tr><td>${esc(r.trade)}</td><td class="num">${r.rate ? money(r.rate) : '<span class="tag warn">not set</span>'}</td><td class="num"><input type="number" step="0.01" data-rt="${esc(r.trade)}" value="${p.billing.rates[r.trade] || ''}" placeholder="${r.rate || ''}" style="width:120px"></td></tr>`).join('')}
    </tbody></table>
    <p class="hint">Invoice lines follow Latinem invoices: workers grouped by trade and days worked, e.g. "4 Security @ 31 Days" at 4,100 = 16,400 (Elwood) or "1 Security @ 5 Days" = 4,100 × 5 ÷ 31 = 661.29.</p>`,
    [...(id ? [{ label: 'Delete', cls: 'bad', onClick: async () => {
      const ss = sitesOfProject(id);
      if (!await confirmBox(`Delete project ${p.name}? Its ${ss.length} site(s) become unmapped (attendance is kept).`, 'Delete', 'bad')) return;
      ss.forEach(s => s.projectId = null); S.projects = S.projects.filter(x => x.id !== id); reindex(); markDirty(); renderAll();
    } }] : []), { label: 'Cancel' }, {
      label: 'Save', cls: 'pri', onClick: m => {
        p.name = $('#ep-name', m).value.trim(); if (!p.name) { toast('Name required'); return false; }
        p.code = $('#ep-code', m).value.trim(); p.clientId = $('#ep-client', m).value; p.entityName = $('#ep-entity', m).value.trim();
        p.poNo = $('#ep-po', m).value.trim(); p.active = $('#ep-active', m).value === '1';
        const into = $('#ep-merge', m)?.value;
        if (into) {
          sitesOfProject(id).forEach(x => x.projectId = into);
          for (const inv of S.invoices) inv.projectIds = [...new Set(inv.projectIds.map(x => x === id ? into : x))];
          S.projects = S.projects.filter(x => x.id !== id); reindex(); markDirty(); renderAll(); toast('Merged into ' + IX.proj.get(into).name); return;
        }
        const rates = {}; m.querySelectorAll('[data-rt]').forEach(i => { if (+i.value) rates[i.dataset.rt] = +i.value; });
        p.billing = { basis: $('#ep-basis', m).value, rate: +$('#ep-rate', m).value || 0, vat: +$('#ep-vat', m).value || 0, posts: +$('#ep-posts', m).value || 0, unit: $('#ep-unit', m).value.trim() || 'Security', rates };
        if (id) S.projects[S.projects.findIndex(x => x.id === id)] = p; else S.projects.push(p);
        reindex(); onCreated?.(p.id); reindex(); markDirty(); renderAll();
      }
    }]);
}

function editSite(id, projectId) {
  const s = id ? { ...IX.site.get(id) } : { id: uid('s'), projectId: projectId || null, name: '' };
  const refs = id ? countSiteRefs(id) : 0;
  openModal(id ? 'Edit site' : 'Add site', `<div class="grid2">
    <label class="f">Site name *<input type="text" id="es-name" value="${esc(s.name)}"></label>
    <label class="f">Project<select id="es-proj">${opts(S.projects.map(p => [p.id, p.name]).sort((a, b) => a[1].localeCompare(b[1])), s.projectId, '— unmapped —')}</select></label>
    ${id ? `<label class="f">Merge into another site (moves all staff & attendance)<select id="es-merge"><option value="">— don't merge —</option>${siteOptions(null, null).replace(`value="${id}"`, `value="${id}" disabled`)}</select></label>` : ''}
    </div>${id ? `<p class="hint">${refs} allocation/attendance reference(s) use this site.</p>` : ''}`,
    [...(id ? [{ label: 'Delete', cls: 'bad', onClick: async () => {
      if (refs) { toast('Site is in use – merge it into another site instead'); return; }
      S.sites = S.sites.filter(x => x.id !== id); reindex(); markDirty(); renderAll();
    } }] : []), { label: 'Cancel' }, {
      label: 'Save', cls: 'pri', onClick: m => {
        const merge = $('#es-merge', m)?.value;
        if (merge) { mergeSite(id, merge); return; }
        s.name = $('#es-name', m).value.trim().replace(/\s+/g, ' ').toUpperCase(); if (!s.name) { toast('Name required'); return false; }
        s.projectId = $('#es-proj', m).value || null;
        if (id) S.sites[S.sites.findIndex(x => x.id === id)] = s; else S.sites.push(s);
        reindex(); markDirty(); renderAll();
      }
    }]);
}
function countSiteRefs(id) {
  let n = 0;
  for (const e of S.employees) for (const a of e.assign || []) if (a.site === id) n++;
  for (const k in S.att) for (const d in S.att[k]) { const v = S.att[k][d]; if (typeof v === 'object' && v.s === id) n++; }
  return n;
}
function mergeSite(from, to) {
  for (const e of S.employees) {
    if (!e.assign?.length) continue;
    for (const a of e.assign) if (a.site === from) a.site = to;
    e.assign = e.assign.filter((a, i, arr) => i === 0 || a.site !== arr[i - 1].site || a.shift !== arr[i - 1].shift);
  }
  for (const k in S.att) for (const d in S.att[k]) { const v = S.att[k][d]; if (typeof v === 'object' && v.s === from) v.s = to; }
  S.sites = S.sites.filter(x => x.id !== from); reindex(); markDirty(); renderAll(); toast('Sites merged');
}
