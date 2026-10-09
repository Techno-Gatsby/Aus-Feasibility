/* =====================================================================
   Clients -> Projects -> Sites, with billing configuration per project
   ===================================================================== */
const BASES = [
  ['ratecard', 'Rate card per trade, pro-rata on calendar days'],
  ['monthly_cal', 'Monthly rate per guard, pro-rata on calendar days'],
  ['monthly_26', 'Monthly rate per guard, pro-rata on 26 days'],
  ['monthly_30', 'Monthly rate per guard, pro-rata on 30 days'],
  ['daily', 'Rate per man-day'],
  ['hourly', 'Rate per hour (man-days × shift hours)'],
  ['fixed', 'Fixed posts × monthly rate (ignores attendance)'],
  ['lump', 'Fixed monthly amount (enter it as the unit rate)']
];
const PV = { q: '', focus: '' };

function renderProjects() {
  const v = $('#v-projects');
  const q = norm(PV.q);
  const unmapped = S.sites.filter(s => !s.projectId || !IX.proj.has(s.projectId));
  const today = todayISO(), bySite = new Map();
  for (const e of S.employees) { if (!employedOn(e, today)) continue; const s = assignOn(e, today)?.site; if (s) bySite.set(s, (bySite.get(s) || 0) + 1); }
  const headcount = id => bySite.get(id) || 0;
  const projRows = [...S.projects].filter(p => (!q || norm(p.name).includes(q) || norm(p.code).includes(q) || sitesOfProject(p.id).some(s => norm(s.name).includes(q))) && (!PV.focus || p.id === PV.focus || p.clientId === PV.focus))
    .sort((a, b) => (IX.client.get(a.clientId)?.name || 'zz').localeCompare(IX.client.get(b.clientId)?.name || 'zz') || a.name.localeCompare(b.name));
  const projOpts = opts(S.projects.map(p => [p.id, p.name]).sort((a, b) => a[1].localeCompare(b[1])), '', '— choose project —');
  const focus = PV.focus ? (IX.proj.get(PV.focus)?.name || IX.client.get(PV.focus)?.name) : '';
  v.innerHTML = docHead('Projects &amp; sites', 'client → project → sites · SAP code, PO and rates per project', `
      ${focus ? `<span class="pill">${esc(focus)} <button class="btn sm" id="pv-unfocus" style="min-height:18px;padding:0 5px;border:0;box-shadow:none">✕</button></span>` : ''}
      <input type="search" id="pv-q" placeholder="Project / code / site" value="${esc(PV.q)}" style="width:200px">`)
  + `<div class="dc">
  ${sec('clients', 'Clients', `<div class="tw"><table><thead><tr><th>Billing entity</th><th>Customer code</th><th>TRN</th><th class="num">Projects</th><th></th></tr></thead><tbody>
    ${S.clients.map(c => `<tr><td class="lab">${esc(c.name)}</td><td class="mono">${esc(c.customerCode || '')}</td><td class="mono">${esc(c.trn || '')}</td><td class="num">${S.projects.filter(p => p.clientId === c.id).length}</td>
      <td><button class="btn sm" data-ec="${c.id}">Edit</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No clients yet.</td></tr>'}
    </tbody></table></div>`, `<span class="cnt">${S.clients.length}</span>`)}
  ${unmapped.length ? sec('unmapped', `Unlinked sites <span class="pill neg">${unmapped.length}</span>`, `
    <div class="row" style="margin:0 0 8px"><span class="muted small">Their days appear on no client timesheet. Link ticked sites to</span><select id="pv-bulkp">${projOpts}</select><button class="btn sm pri" id="pv-bulk">Link</button></div>
    <div class="tw" style="max-height:260px"><table><thead><tr><th><input type="checkbox" id="pv-all"></th><th>Site</th><th class="num">Staff now</th><th>Link one by one</th><th></th></tr></thead><tbody>
    ${unmapped.map(s => `<tr><td><input type="checkbox" data-um="${s.id}"></td><td>${esc(s.name)}</td><td class="num">${headcount(s.id)}</td>
      <td><select data-map="${s.id}">${projOpts}<option value="__new">New project with this name…</option></select></td>
      <td><button class="btn sm" data-es="${s.id}">Edit</button></td></tr>`).join('')}
    </tbody></table></div>`) : ''}
  ${(() => { const withPin = S.sites.filter(x => x.pins?.length), projPin = S.projects.filter(x => x.pins?.length), covered = S.sites.filter(x => sitePins(x).length); return sec('locations', `Locations for the worker app <span class="cnt">${covered.length} of ${S.sites.length} sites have a zone</span>`, `
    <div class="row" style="margin-bottom:8px"><button class="btn sm" id="pv-zones" ${covered.length ? '' : 'disabled'}>Map of all zones</button><label class="btn sm" style="display:inline-flex;align-items:center">Upload documents in bulk…<input type="file" id="pv-bulkdocs" accept="application/pdf" multiple hidden></label><span class="muted small">A <b>project</b> location covers every site of the project that has no pin of its own; a <b>site</b> pin overrides it. Punches inside a zone are accepted automatically; others wait for review.</span></div>
    ${projPin.length ? `<div class="tw" style="max-height:200px"><table><thead><tr><th>Project</th><th>Pins</th><th class="num">Radius (m)</th><th class="num">Sites covered</th><th></th></tr></thead><tbody>
    ${projPin.map(x => `<tr><td class="lab">${esc(x.name)}</td><td class="mono small">${x.pins.map(p => `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`).join(' · ')}</td><td class="num">${x.pins.map(p => p.radius).join(', ')}</td><td class="num">${sitesOfProject(x.id).filter(y => !y.pins?.length).length}</td><td><button class="btn sm" data-ep="${x.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>` : ''}
    ${withPin.length ? `<div class="tw" style="max-height:240px;margin-top:${projPin.length ? 8 : 0}px"><table><thead><tr><th>Site</th><th>Project</th><th>Pins</th><th class="num">Radius (m)</th><th class="num">Staff now</th><th></th></tr></thead><tbody>
    ${withPin.map(x => `<tr><td>${esc(x.name)}</td><td class="muted">${esc(projOfSite(x.id)?.name || '—')}</td><td class="mono small">${x.pins.map(p => `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`).join(' · ')}</td><td class="num">${x.pins.map(p => p.radius).join(', ')}</td><td class="num">${headcount(x.id) || ''}</td><td><button class="btn sm" data-es="${x.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>` : ''}
    ${!projPin.length && !withPin.length ? '<p class="muted small" style="margin:0">Nothing set yet – use <b>Edit</b> on a project or a site.</p>' : ''}`, '', ); })()}
  ${sec('projects', 'Projects', projRows.map(p => {
      const c = IX.client.get(p.clientId); const b = p.billing || {};
      const ss = sitesOfProject(p.id);
      const bill = (!b.basis || b.basis === 'ratecard') ? 'Rate card · guard ' + money(rateFor(p, 'SECURITY GUARD')) + (Object.keys(b.rates || {}).length ? ' · project rates' : '') : b.basis === 'lump' ? 'Fixed ' + money(b.rate) + ' / month' : esc((BASES.find(x => x[0] === b.basis) || [, ''])[1]) + (b.rate ? ' · ' + money(b.rate) : '');
      return `<div class="comp">
        <div class="ch"><b>${esc(p.name)}</b>${p.code ? `<span class="mono muted">${esc(p.code)}</span>` : ''}${p.poNo ? `<span class="mono muted">${esc(p.poNo)}</span>` : ''}
          <span class="muted">${esc(c?.name || '')}</span>
          ${!p.clientId ? '<span class="pill neg">no client</span>' : ''}
          ${!rateFor(p, 'SECURITY GUARD') && !['fixed', 'lump'].includes(b.basis) ? '<span class="pill warn">no rate</span>' : ''}
          ${p.active === false ? '<span class="pill">inactive</span>' : ''}
          ${p.pins?.length ? `<span class="pill pos" title="Project-wide worker-app zone">📍 project ${p.pins[0].radius} m</span>` : ''}
          ${p.docs?.length ? `<span class="pill" title="Documents added to every invoice pack">📄 ${p.docs.map(d => (d.kind === 'woi' ? 'WOI' : d.kind.toUpperCase()) + ' ' + (d.pages || '?') + ' p').join(' · ')}</span>` : ''}
          <span class="spacer"></span><span class="muted small">${bill} · VAT ${b.vat || 0}%</span>
          <button class="btn sm" data-addsite="${p.id}">Add site</button><button class="btn sm" data-ep="${p.id}">Edit</button></div>
        <div class="cb"><table><tbody>${ss.map(s => `<tr><td style="width:60%">${esc(s.name)}${s.pins?.length ? ' <span class="pill pos" title="Has its own worker-app zone">📍 ' + s.pins[0].radius + ' m</span>' : p.pins?.length ? ' <span class="pill" title="Uses the project zone">📍 project</span>' : ''}</td><td class="num muted">${headcount(s.id) || ''}</td><td style="text-align:right"><button class="btn sm" data-es="${s.id}">Edit</button></td></tr>`).join('') || '<tr><td class="muted">No sites yet</td></tr>'}</tbody></table></div>
      </div>`;
    }).join('') || '<p class="muted">No projects match.</p>', `<span class="cnt">${projRows.length}</span>`)}
  </div>`;
  bindSecs(v);
  if ($('#pv-zones')) $('#pv-zones').onclick = zonesMap;
  if ($('#pv-bulkdocs')) $('#pv-bulkdocs').onchange = e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) bulkDocs(fs).catch(err => toast(err.message, 6000)); };
  if ($('#pv-unfocus')) $('#pv-unfocus').onclick = () => { PV.focus = ''; clearSel(); };
  if ($('#pv-bulk')) {
    $('#pv-all').onchange = e => v.querySelectorAll('[data-um]').forEach(c => c.checked = e.target.checked);
    $('#pv-bulk').onclick = () => {
      const pid = $('#pv-bulkp').value, ids = [...v.querySelectorAll('[data-um]:checked')].map(c => c.dataset.um);
      if (!pid || !ids.length) return toast('Tick sites and choose a project');
      ids.forEach(id => IX.site.get(id).projectId = pid); markDirty(); renderAll(); toast(`Linked ${ids.length} site(s)`);
    };
  }
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
  openModal(id ? 'Edit client' : 'Add client', `<div class="form">
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
  p.pins ||= [];
  const m = openModal(id ? 'Edit project' : 'Add project', `<div class="form">
    <label class="f">Project name * (as on timesheet)<input type="text" id="ep-name" value="${esc(p.name)}" placeholder="SCL TR - AL QUOZ TR"></label>
    <label class="f">Project code (SAP)<input type="text" id="ep-code" value="${esc(p.code || '')}" placeholder="104N135"></label>
    <label class="f">Client<select id="ep-client">${opts(S.clients.map(c => [c.id, c.name]), p.clientId, '— choose client —')}</select></label>
    <label class="f">Entity on invoice<input type="text" id="ep-entity" value="${esc(p.entityName || '')}" placeholder="SOBHA CONSTRUCTIONS LLC (ELWOOD INFRASTRUCTURE @ Al Yufrah)"></label>
    <label class="f">Name in Tax Invoice Tracker<input type="text" id="ep-tn" value="${esc(p.trackerName || '')}"></label>
    <label class="f">SAP project name<input type="text" id="ep-sapn" value="${esc(p.sapName || '')}" placeholder="SOBHA ELWOOD INFRASTRUCTURE"></label>
    <label class="f">SAP project / order code<input type="text" id="ep-oc" value="${esc(p.orderCode || '')}" placeholder="3020110P047"></label>
    <label class="f">Work order ref<input type="text" id="ep-wo" value="${esc(p.woNo || '')}" placeholder="LOR-104N135-24-0001"></label>
    <label class="f">Day off on timesheet<select id="ep-off">${opts([['O', 'O (SCL TR sheets)'], ['OFF', 'OFF (Elwood sheets)']], p.tsOff || 'O')}</select></label>
    <label class="f">2nd signature label<select id="ep-ack">${opts([['0', 'ACKNOWLEDGE BY: (SCL TR sheets)'], ['1', 'blank (Elwood sheets)']], p.tsNoAck ? '1' : '0')}</select></label>
    <label class="f">PO / Work order instruction no.<input type="text" id="ep-po" value="${esc(p.poNo || '')}" placeholder="INS-104N135-26-0002"></label>
    <label class="f">Active<select id="ep-active">${opts([['1', 'Active'], ['0', 'Inactive']], p.active === false ? '0' : '1')}</select></label>
    ${id ? `<label class="f">Merge into another project (moves all sites)<select id="ep-merge">${opts(S.projects.filter(x => x.id !== id).map(x => [x.id, x.name]).sort((a, b) => a[1].localeCompare(b[1])), '', "— don't merge —")}</select></label>` : ''}
    </div>
    <h3 style="margin:14px 0 6px">Billing</h3>
    <div class="form">
      <label class="f">Basis<select id="ep-basis">${opts(BASES, p.billing.basis)}</select></label>
      <label class="f">Unit rate (other bases)<input type="number" step="0.01" id="ep-rate" value="${p.billing.rate || 0}"></label>
      <label class="f">VAT %<input type="number" step="0.01" id="ep-vat" value="${p.billing.vat ?? 0}"></label>
      <label class="f">Fixed posts (for "fixed" basis)<input type="number" id="ep-posts" value="${p.billing.posts || 0}"></label>
      <label class="f">Unit word on invoice<input type="text" id="ep-unit" value="${esc(p.billing.unit || 'Security')}"></label>
    </div>
    <h3 style="margin:14px 0 6px">Rate per trade for this project <span class="muted small">(blank = rate card)</span></h3>
    <table><thead><tr><th>Trade</th><th class="num">Rate card</th><th class="num">This project (AED / month)</th></tr></thead><tbody>
    ${S.settings.rateCard.map(r => `<tr><td>${esc(r.trade)}</td><td class="num">${r.rate ? money(r.rate) : '<span class="pill warn">not set</span>'}</td><td class="num"><input type="number" step="0.01" data-rt="${esc(r.trade)}" value="${p.billing.rates[r.trade] || ''}" placeholder="${r.rate || ''}" style="width:120px"></td></tr>`).join('')}
    </tbody></table>
    <p class="muted small">Lines group workers by trade and days: "4 Security @ 31 Days" × 4,100 = 16,400; "1 Security @ 5 Days" = 4,100 × 5 ÷ 31 = 661.29.</p>
    <h3 style="margin:14px 0 6px">Documents attached to every invoice pack <span class="muted small">– e.g. the Work Order Instruction: uploaded once, added to each pack of this project unless the invoice uses another file</span></h3>
    <div id="ep-docs"></div>
    <div class="row" style="margin-top:6px"><label class="btn sm" style="display:inline-flex;align-items:center">Upload PDF…<input type="file" id="ep-docfile" accept="application/pdf" hidden></label><span class="muted small">Pages are kept exactly as uploaded. Many WOIs at once: Projects &amp; sites → <b>Upload documents in bulk…</b>. In Invoice → Pack you can also take the WOI pages out of a full invoice PDF.</span></div>
    <h3 style="margin:14px 0 6px">Project location &amp; coverage <span class="muted small">– for the worker app: every site of this project without a pin of its own uses this zone</span></h3>
    ${pinEditorHTML('ep')}`,
    [...(id ? [{ label: 'Delete', cls: 'bad', onClick: async () => {
      const ss = sitesOfProject(id);
      if (!await confirmBox(`Delete project ${p.name}? Its ${ss.length} site(s) become unmapped (attendance is kept).`, 'Delete', 'bad')) return;
      ss.forEach(s => s.projectId = null); S.projects = S.projects.filter(x => x.id !== id); reindex(); markDirty(); renderAll();
    } }] : []), { label: 'Cancel' }, {
      label: 'Save', cls: 'pri', onClick: m => {
        p.name = $('#ep-name', m).value.trim(); if (!p.name) { toast('Name required'); return false; }
        p.code = $('#ep-code', m).value.trim(); p.clientId = $('#ep-client', m).value; p.entityName = $('#ep-entity', m).value.trim();
        p.poNo = $('#ep-po', m).value.trim(); p.trackerName = $('#ep-tn', m).value.trim(); p.sapName = $('#ep-sapn', m).value.trim(); p.orderCode = $('#ep-oc', m).value.trim(); p.woNo = $('#ep-wo', m).value.trim(); p.tsOff = $('#ep-off', m).value; p.tsNoAck = $('#ep-ack', m).value === '1'; p.active = $('#ep-active', m).value === '1';
        const into = $('#ep-merge', m)?.value;
        if (into) {
          sitesOfProject(id).forEach(x => x.projectId = into);
          for (const inv of S.invoices) inv.projectIds = [...new Set(inv.projectIds.map(x => x === id ? into : x))];
          S.projects = S.projects.filter(x => x.id !== id); reindex(); markDirty(); renderAll(); toast('Merged into ' + IX.proj.get(into).name); return;
        }
        const rates = {}; m.querySelectorAll('[data-rt]').forEach(i => { if (+i.value) rates[i.dataset.rt] = +i.value; });
        p.billing = { basis: $('#ep-basis', m).value, rate: +$('#ep-rate', m).value || 0, vat: +$('#ep-vat', m).value || 0, posts: +$('#ep-posts', m).value || 0, unit: $('#ep-unit', m).value.trim() || 'Security', rates };
        PE.finish();
        if (id) S.projects[S.projects.findIndex(x => x.id === id)] = p; else S.projects.push(p);
        reindex(); onCreated?.(p.id); reindex(); markDirty(); renderAll(); Files.sweep();
        if (p.pins.length && S.employees.some(e => e.app?.on)) toast('Project location saved – Publish roster in Worker app to send it to phones', 5000);
      }
    }], { width: 'min(1500px,94vw)' });
  p.docs ||= [];
  const DOC_KINDS = [['woi', 'Work Order Instruction'], ['lpo', 'LPO / purchase order'], ['agreement', 'Rate agreement'], ['other', 'Other']];
  const docsTable = () => {
    $('#ep-docs', m).innerHTML = p.docs.length ? `<div class="tw"><table><thead><tr><th>Document</th><th>File</th><th class="num">Pages</th><th>Position in pack</th><th></th></tr></thead><tbody>
      ${p.docs.map((d, i) => `<tr><td><select data-dk="${i}" style="min-width:170px">${opts(DOC_KINDS, d.kind)}</select></td><td class="small" style="white-space:normal"><a href="#" data-dopen="${i}">${esc(d.name)}</a> <span class="muted">${PDFX.fmtSize(d.size || 0)}</span></td><td class="num">${d.pages || '?'}</td>
        <td><select data-dp="${i}">${opts([['end', 'End of pack (after timesheets)'], ['afterInvoice', 'After the invoice pages']], d.pos || 'end')}</select></td>
        <td style="text-align:right"><label class="btn sm">Replace<input type="file" data-drep="${i}" accept="application/pdf" hidden></label> <button class="btn sm bad" data-ddel="${i}">✕</button></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted small" style="margin:0">No documents yet. Upload the Work Order Instruction PDF (the 3 pages at the end of the Elwood pack).</p>';
    m.querySelectorAll('[data-dk]').forEach(x => x.onchange = () => p.docs[+x.dataset.dk].kind = x.value);
    m.querySelectorAll('[data-dp]').forEach(x => x.onchange = () => p.docs[+x.dataset.dp].pos = x.value);
    m.querySelectorAll('[data-dopen]').forEach(a => a.onclick = e => { e.preventDefault(); PDFX.open(p.docs[+a.dataset.dopen].id); });
    m.querySelectorAll('[data-ddel]').forEach(b => b.onclick = () => { p.docs.splice(+b.dataset.ddel, 1); docsTable(); });
    m.querySelectorAll('[data-drep]').forEach(inp => inp.onchange = async () => { const f = inp.files[0]; if (!f) return; const old = p.docs[+inp.dataset.drep]; const d = await PDFX.store(f, { name: f.name, kind: old.kind }); p.docs[+inp.dataset.drep] = { ...d, pos: old.pos }; docsTable(); });
  };
  docsTable();
  $('#ep-docfile', m).onchange = async e => {
    const f = e.target.files[0]; if (!f) return; e.target.value = '';
    try { const d = await PDFX.store(f, { name: f.name, kind: p.docs.some(x => x.kind === 'woi') ? 'other' : 'woi' }); p.docs.push({ ...d, pos: 'end' }); docsTable(); toast(`${f.name} · ${d.pages} page(s) – Save to keep it`); }
    catch (err) { toast('Could not read the PDF: ' + err.message, 5000); }
  };
  const PE = pinEditor(m, p, { px: 'ep', name: p.name, others: [...S.projects.filter(x => x.id !== p.id && x.pins?.length).map(x => ({ name: x.name + ' (project)', pins: x.pins })), ...S.sites.filter(x => x.pins?.length).map(x => ({ name: x.name, pins: x.pins }))], empty: 'No project location yet – search above or click the map. Sites can still have their own pins.' });
}

/** Pins that apply to a site: its own, else its project's (project-wide coverage) */
function sitePins(s) { if (!s) return []; if (s.pins?.length) return s.pins; return IX.proj.get(s.projectId)?.pins || []; }

/* ---------- shared location editor (sites and projects) ---------- */
function pinEditorHTML(px, extraBtn) {
  return `<div class="row" style="margin-bottom:6px"><div class="grow" style="position:relative;min-width:260px"><input type="text" id="${px}-q" placeholder="Search a place, paste coordinates or a Google Maps link" style="width:100%"></div>
      <button class="btn sm" id="${px}-add">Add pin at map centre</button>${extraBtn || ''}</div>
    <div id="${px}-map" class="mapbox"></div>
    <div class="muted small" style="margin:4px 0 6px">Click the map or drag the pin to move the selected pin. Several pins are allowed (e.g. gate and office). The circle is the coverage: punches inside it are accepted automatically.</div>
    <div class="tw"><table><thead><tr><th></th><th>Label</th><th>Latitude</th><th>Longitude</th><th>Zone radius (m)</th><th></th></tr></thead><tbody id="${px}-pins"></tbody></table></div>`;
}
/** Binds the editor in modal m to owner.pins (edited in place). o: { px, others:[{name,pins}], ghost:{name,pins}|null, empty } */
function pinEditor(m, owner, o) {
  const px = o.px, R0 = appCfg().radius; owner.pins ||= [];
  let sel = 0, map = null, drawn = [], ghost = o.ghost || null;
  const table = () => {
    $(`#${px}-pins`, m).innerHTML = owner.pins.map((p, i) => `<tr class="${i === sel ? 'on' : ''}"><td><input type="radio" name="${px}-sel" data-sel="${i}" ${i === sel ? 'checked' : ''}></td>
      <td><input type="text" data-pk="label" data-pi="${i}" value="${esc(p.label || '')}" placeholder="e.g. Main gate" style="width:130px"></td>
      <td><input type="number" step="0.000001" data-pk="lat" data-pi="${i}" value="${p.lat}" style="width:120px"></td><td><input type="number" step="0.000001" data-pk="lng" data-pi="${i}" value="${p.lng}" style="width:120px"></td>
      <td><div class="row" style="flex-wrap:nowrap"><input type="range" min="20" max="1000" step="10" data-pk="radius" data-pi="${i}" value="${p.radius}" style="width:140px"><input type="number" min="10" data-pk="radius" data-pi="${i}" value="${p.radius}" style="width:70px"></div></td>
      <td><button class="btn sm bad" data-pdel="${i}">✕</button></td></tr>`).join('') || `<tr><td colspan="6" class="muted">${o.empty || 'No location yet – search above or click the map.'}</td></tr>`;
    const root = $(`#${px}-pins`, m);
    root.querySelectorAll('[data-sel]').forEach(r => r.onchange = () => { sel = +r.dataset.sel; table(); draw(true); });
    root.querySelectorAll('[data-pk]').forEach(i => i.oninput = () => { const p = owner.pins[+i.dataset.pi]; p[i.dataset.pk] = i.dataset.pk === 'label' ? i.value : +i.value; if (i.dataset.pk === 'radius') root.querySelectorAll(`[data-pk=radius][data-pi="${i.dataset.pi}"]`).forEach(x => x !== i && (x.value = i.value)); draw(false); });
    root.querySelectorAll('[data-pdel]').forEach(b => b.onclick = () => { owner.pins.splice(+b.dataset.pdel, 1); sel = Math.max(0, Math.min(sel, owner.pins.length - 1)); table(); draw(true); });
  };
  const place = (lat, lng) => { if (!owner.pins.length) { owner.pins.push({ lat, lng, radius: R0, label: '' }); sel = 0; } else Object.assign(owner.pins[sel], { lat: +lat.toFixed(6), lng: +lng.toFixed(6) }); table(); draw(false); };
  function draw(fit) {
    if (!map) return; const L = window.L;
    drawn.forEach(x => x.remove()); drawn = [];
    for (const x of o.others || []) for (const p of x.pins || []) drawn.push(LSMap.zone(map, p, { color: '#93A0B5', fill: .05, label: x.name, marker: false }));
    for (const p of ghost?.pins || []) { const z = LSMap.zone(map, p, { color: '#5B4AB8', fill: .04, label: `${ghost.name} – project zone (${p.radius} m)`, marker: false }); z.c.setStyle({ dashArray: '6 6' }); drawn.push(z); }
    owner.pins.forEach((p, i) => {
      const z = LSMap.zone(map, p, { color: i === sel ? '#1766CB' : '#5B4AB8', marker: false }); drawn.push(z);
      const mk = L.marker([p.lat, p.lng], { draggable: true }).addTo(map).bindTooltip(p.label || o.name || 'pin'); drawn.push({ remove: () => mk.remove() });
      mk.on('drag', e => { z.c.setLatLng(e.latlng); }); mk.on('dragend', e => { sel = i; place(e.target.getLatLng().lat, e.target.getLatLng().lng); });
      mk.on('click', () => { sel = i; table(); draw(false); });
    });
    const pts = owner.pins.length ? owner.pins : (ghost?.pins || []);
    if (fit && pts.length) map.fitBounds(L.latLngBounds(pts.map(p => [p.lat, p.lng])).pad(0.8), { maxZoom: 17 });
  }
  table();
  const c0 = owner.pins[0] || ghost?.pins?.[0];
  LSMap.create($(`#${px}-map`, m), { zoom: c0 ? 16 : 10, center: c0 ? [c0.lat, c0.lng] : undefined, satellite: true }).then(mp => {
    map = mp; map.on('click', e => place(e.latlng.lat, e.latlng.lng)); draw(true);
    const onRs = () => { if (!$(`#${px}-map`, m)?.isConnected) return window.removeEventListener('resize', onRs); try { map.invalidateSize(); } catch (e) { } };
    window.addEventListener('resize', onRs);
  }).catch(e => { $(`#${px}-map`, m).innerHTML = `<div class="empty" style="height:100%">${esc(e.message)} – type coordinates in the table instead.</div>`; });
  LSMap.search($(`#${px}-q`, m), x => { if (map) map.setView([x.lat, x.lng], 17); place(x.lat, x.lng); }, { key: appCfg().arcgisKey });
  $(`#${px}-add`, m).onclick = () => { const c = map ? map.getCenter() : { lat: 25.2, lng: 55.3 }; owner.pins.push({ lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6), radius: R0, label: '' }); sel = owner.pins.length - 1; table(); draw(false); };
  const useBtn = $(`#${px}-use`, m); if (useBtn) useBtn.onclick = () => { if (!ghost?.pins?.length) return toast('The project has no location yet'); owner.pins.splice(0, owner.pins.length, ...ghost.pins.map(p => ({ ...p }))); sel = 0; table(); draw(true); };
  return {
    setGhost(g) { ghost = g; if (useBtn) useBtn.hidden = !g?.pins?.length; draw(!owner.pins.length); },
    finish() { owner.pins = owner.pins.filter(p => isFinite(p.lat) && isFinite(p.lng)).map(p => ({ lat: +(+p.lat).toFixed(6), lng: +(+p.lng).toFixed(6), radius: Math.max(10, Math.round(+p.radius || R0)), label: p.label || '' })); return owner.pins; }
  };
}

function editSite(id, projectId) {
  const s = id ? JSON.parse(JSON.stringify(IX.site.get(id))) : { id: uid('s'), projectId: projectId || null, name: '' };
  s.pins ||= [];
  const refs = id ? countSiteRefs(id) : 0;
  const ghostOf = pid => { const p = pid && IX.proj.get(pid); return p?.pins?.length ? { name: p.name, pins: p.pins } : null; };
  const m = openModal(id ? 'Edit site' : 'Add site', `<div class="form">
    <label class="f">Site name *<input type="text" id="es-name" value="${esc(s.name)}"></label>
    <label class="f">Project<select id="es-proj">${opts(S.projects.map(p => [p.id, p.name]).sort((a, b) => a[1].localeCompare(b[1])), s.projectId, '— unmapped —')}</select></label>
    ${id ? `<label class="f">Merge into another site (moves all staff & attendance)<select id="es-merge"><option value="">— don't merge —</option>${siteOptions(null, null).replace(`value="${id}"`, `value="${id}" disabled`)}</select></label>` : ''}
    </div>${id ? `<p class="muted small">${refs} allocation / attendance reference(s) use this site.</p>` : ''}
    <h3 style="margin:14px 0 6px">Location for the worker app <span class="muted small">– leave empty to use the project location (dashed circle), or set the site's own pin</span></h3>
    ${pinEditorHTML('es', `<button class="btn sm" id="es-use" ${ghostOf(s.projectId) ? '' : 'hidden'}>Use project location</button>`)}`,
    [...(id ? [{ label: 'Delete', cls: 'bad', onClick: async () => {
      if (refs) { toast('Site is in use – merge it into another site instead'); return false; }
      S.sites = S.sites.filter(x => x.id !== id); reindex(); markDirty(); renderAll();
    } }] : []), { label: 'Cancel' }, {
      label: 'Save', cls: 'pri', onClick: m => {
        const merge = $('#es-merge', m)?.value;
        if (merge) { mergeSite(id, merge); return; }
        s.name = $('#es-name', m).value.trim().replace(/\s+/g, ' ').toUpperCase(); if (!s.name) { toast('Name required'); return false; }
        s.projectId = $('#es-proj', m).value || null;
        PE.finish();
        if (id) S.sites[S.sites.findIndex(x => x.id === id)] = s; else S.sites.push(s);
        reindex(); markDirty(); renderAll();
        if (sitePins(s).length && S.employees.some(e => e.app?.on)) toast('Location saved – Publish roster in Worker app to send it to phones', 5000);
      }
    }], { width: 'min(1500px,94vw)' });
  const PE = pinEditor(m, s, { px: 'es', name: s.name, others: S.sites.filter(o => o.id !== s.id && o.pins?.length).map(o => ({ name: o.name, pins: o.pins })), ghost: ghostOf(s.projectId), empty: ghostOf(s.projectId) ? 'No own pin – this site uses the project location. Search above, click the map or press "Use project location" to give it its own.' : 'No location yet – search above or click the map.' });
  $('#es-proj', m).onchange = e => PE.setGhost(ghostOf(e.target.value));
}
/** Bulk upload of Work Order Instructions (one PDF per WOI, or one PDF holding several): matched to projects by the WOI / PO number or project code in the text */
async function bulkDocs(files) {
  toast(`Reading ${files.length} PDF(s)…`, 60000);
  const rows = [];
  for (const f of files) {
    const all = PDFX.classify((await PDFX.pages(f, { thumbs: false })).pages);
    // a full invoice pack: keep only its Work Order pages; a plain WOI file: every page
    const pages = all.some(p => p.kind === 'woi') ? all.filter(p => p.kind === 'woi') : all;
    // split at every page where a new WORK ORDER INSTRUCTION header appears with a different WOI number
    const groups = []; let cur = null;
    pages.forEach(p => { const i = p.i - 1;
      const head = /WORK\s*ORDER\s*INSTRUCTION/i.test(p.text), po = (p.text.match(/\b(INS-[A-Z0-9]+-\d{2}-\d{4})\b/) || [])[1] || '';
      if (!cur || (head && po && cur.po && po !== cur.po)) { cur = { po, idx: [], pages: [] }; groups.push(cur); }
      if (!cur.po && po) cur.po = po; cur.idx.push(i); cur.pages.push(p);
    });
    for (const g of groups) {
      const f2 = PDFX.fields(g.pages), nm = (g.pages.map(p => p.text).join(' ').match(/Project\s*Name\s*:?\s*(.+?)\s+(?:Project\s*Code|Work\s*Order|Sub\s*-?\s*Contractor|$)/i) || [])[1] || '';
      const proj = (f2.poNo && S.projects.find(p => p.poNo === f2.poNo)) || (f2.projectCode && S.projects.find(p => p.code === f2.projectCode)) || (nm && S.projects.find(p => norm(p.sapName || '') === norm(nm) || norm(p.name).includes(norm(nm)))) || null;
      rows.push({ file: f, idx: groups.length > 1 || pages.length !== all.length ? g.idx : null, n: g.idx.length, po: f2.poNo || '', code: f2.projectCode || '', name: nm, pid: proj?.id || '', how: proj ? (proj.poNo === f2.poNo ? 'WOI no' : proj.code === f2.projectCode ? 'project code' : 'name') : '', act: 'add' });
    }
  }
  $('#toast').classList.remove('show');
  if (!rows.length) return toast('No pages found');
  const popts = opts(S.projects.map(p => [p.id, p.name]).sort((a, b) => a[1].localeCompare(b[1])), '', '— choose project —');
  const m = openModal(`Upload documents · ${rows.length} document(s) in ${files.length} file(s)`, `
    <p class="muted small" style="margin:0 0 8px">Each document is matched to a project by the WOI / PO number (INS-…) or the project code found in its text. Check the project, then Save. A project that already has a WOI gets it replaced.</p>
    <div class="tw" style="max-height:60vh"><table><thead><tr><th>File</th><th class="num">Pages</th><th>WOI no</th><th>Code</th><th>Project</th><th>Matched by</th><th>Action</th></tr></thead><tbody>
    ${rows.map((r, i) => `<tr><td class="small" style="white-space:normal;max-width:260px">${esc(r.file.name)}${r.idx ? ` <span class="muted">p ${r.idx[0] + 1}–${r.idx[r.idx.length - 1] + 1}</span>` : ''}</td><td class="num">${r.n}</td><td class="mono small">${esc(r.po || '—')}</td><td class="mono small">${esc(r.code || '—')}</td>
      <td><select data-bp="${i}" style="min-width:240px">${popts.replace(`value="${r.pid}"`, `value="${r.pid}" selected`)}</select></td>
      <td>${r.how ? `<span class="pill pos">${r.how}</span>` : '<span class="pill warn">not matched</span>'}</td>
      <td><select data-ba="${i}">${opts([['add', 'Save as WOI'], ['skip', 'Skip']], r.act)}</select></td></tr>`).join('')}</tbody></table></div>`,
    [{ label: 'Cancel' }, { label: 'Save', cls: 'pri', onClick: async m => {
      let saved = 0, skipped = 0;
      for (const [i, r] of rows.entries()) {
        const pid = m.querySelector(`[data-bp="${i}"]`).value, act = m.querySelector(`[data-ba="${i}"]`).value;
        const p = IX.proj.get(pid); if (act !== 'add' || !p) { skipped++; continue; }
        const d = await PDFX.store(r.file, { name: r.po ? `WOI ${r.po}.pdf` : r.file.name, kind: 'woi', pages: r.idx || undefined });
        p.docs = (p.docs || []).filter(x => x.kind !== 'woi'); p.docs.push({ ...d, pos: 'end' });
        if (!p.poNo && r.po) p.poNo = r.po; if (!p.code && r.code) p.code = r.code;
        saved++;
      }
      markDirty(); renderAll(); Files.sweep(); toast(`Saved ${saved} Work Order Instruction(s)${skipped ? ` · ${skipped} skipped` : ''}`, 6000);
    } }], { width: 'min(1300px,94vw)' });
}
/** All zones on one map */
async function zonesMap() {
  const m = openModal('Zones for the worker app', `<div id="zm" class="mapbox tall"></div>`, [{ label: 'Close', cls: 'pri' }], { width: 'min(1500px,94vw)' });
  try {
    const map = await LSMap.create($('#zm', m), {}), L = window.L, b = L.latLngBounds([]);
    for (const pr of S.projects) for (const p of pr.pins || []) { const z = LSMap.zone(map, p, { color: '#5B4AB8', fill: .05, label: `${pr.name} – project zone · ${p.radius} m` }); z.c.setStyle({ dashArray: '6 6' }); z.c.on('click', () => { closeModal(); editProject(pr.id); }); b.extend([p.lat, p.lng]); }
    for (const s of S.sites) for (const p of s.pins || []) { const z = LSMap.zone(map, p, { label: `${s.name} · ${p.radius} m` }); z.c.on('click', () => { closeModal(); editSite(s.id); }); b.extend([p.lat, p.lng]); }
    if (b.isValid()) map.fitBounds(b.pad(0.2), { maxZoom: 16 });
  } catch (e) { $('#zm', m).innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
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
