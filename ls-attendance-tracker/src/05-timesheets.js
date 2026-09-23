/* =====================================================================
   Client timesheets (calendar month, one sheet per project, LS/DO/F-026)
   ===================================================================== */
const TS_LEGEND = [['P', 'PRESENT'], ['A', 'ABSENT'], ['O', 'DAY OFF'], ['R', 'RELIEVER']];
const TV = { ym: null, client: '', picked: new Set(), all: true };

/** Build the project-wise breakup for one calendar month from the daily ledger. */
function buildTimesheet(projectId, ym) {
  const days = monthDates(ym);
  const siteOrder = sitesOfProject(projectId).map(s => s.id);
  const siteSet = new Set(siteOrder);
  const rows = new Map();
  S.employees.forEach((emp, ei) => {
    for (const d of days) {
      if (!employedOn(emp, d)) continue;
      const c = getCell(emp.id, d); if (!c) continue;
      const cd = codeDef(c.c); if (!cd.billable && !cd.client) continue;
      const site = siteOn(emp, d); if (!siteSet.has(site)) continue;
      const rel = c.c === 'R';
      const shift = shiftOn(emp, d) || '';
      const section = rel ? '__REL' : site;
      const key = `${section}|${shift}|${emp.id}`;
      let row = rows.get(key);
      if (!row) rows.set(key, row = { section, shift, emp, ei, cells: {}, total: 0, sites: new Set() });
      row.cells[+d.slice(8)] = c.c; row.sites.add(site);
      if (cd.billable) row.total++;
    }
  });
  const secIdx = s => s === '__REL' ? 1e6 : siteOrder.indexOf(s);
  const list = [...rows.values()].sort((a, b) => secIdx(a.section) - secIdx(b.section) || a.ei - b.ei || a.shift.localeCompare(b.shift));
  const sections = [];
  for (const r of list) {
    let sec = sections[sections.length - 1];
    if (!sec || sec.id !== r.section) sections.push(sec = { id: r.section, name: r.section === '__REL' ? 'RELIEVER' : siteName(r.section), rows: [] });
    sec.rows.push(r);
  }
  const total = list.reduce((a, r) => a + r.total, 0);
  // headcount equivalent per site = billable man-days / days in month
  return { projectId, ym, days: days.length, sections, total, rows: list };
}

function tsSheetHTML(ts) {
  const st = S.settings, p = IX.proj.get(ts.projectId);
  const N = ts.days;
  const dayTh = Array.from({ length: N }, (_, i) => `<th>${i + 1}</th>`).join('');
  let body = '';
  for (const sec of ts.sections) {
    sec.rows.forEach((r, i) => {
      body += `<tr>${i === 0 ? `<td class="site" rowspan="${sec.rows.length}">${esc(sec.name)}</td>` : ''}
        <td>${esc(r.shift)}</td><td class="l">${esc(r.emp.name)}</td><td>${esc(empCodeLabel(r.emp))}</td>
        ${Array.from({ length: N }, (_, k) => { const c = r.cells[k + 1]; return `<td>${c && codeDef(c).client ? esc(c === 'OFF' ? 'O' : c) : ''}</td>`; }).join('')}
        <td class="tot">${r.total}</td></tr>`;
    });
  }
  if (!body) body = `<tr><td colspan="${N + 5}" style="padding:10px">No attendance recorded for this project in ${fmtMonYY(ts.ym)}.</td></tr>`;
  const legend = TS_LEGEND.map(([a, b]) => `<tr><td><b>${a}</b></td><td>${b}</td></tr>`).join('');
  const signs = st.signatories.map(s => `<div><b>${esc(s.label)}</b>${esc([s.name, s.title].filter(Boolean).join(' '))}</div>`).join('');
  return `<div class="sheet land ts-sheet">
    <div class="ts-head"><div>
      <div class="t1">${esc(st.companyShort)}</div><div class="t2">${esc(st.tsTitle)}</div>
      <div class="t3">Form No: ${esc(st.formNo)} &nbsp;&nbsp;&nbsp; REV NO: ${esc(st.revNo)} &nbsp;&nbsp;&nbsp; DATE : ${esc(st.formDate)}</div>
      <div class="ts-meta"><div><b>MONTH</b> ${fmtMonYY(ts.ym)}</div><div><b>PROJECT NAME</b> ${esc(p?.name || '')}${p?.code ? ` &nbsp;(${esc(p.code)})` : ''}</div></div>
    </div><table class="ts-legend">${legend}</table></div>
    <table class="ts"><thead><tr><th>SITE NAME</th><th>SHIFT D/N</th><th>NAME</th><th>EMP. CODE</th>${dayTh}<th>TOTAL DAYS</th></tr></thead>
    <tbody>${body}<tr class="gtr"><td colspan="${N + 4}" style="text-align:right;padding-right:8px"><b>GRAND TOTAL</b></td><td class="gt">${ts.total}</td></tr></tbody></table>
    <div class="ts-sign">${signs}</div></div>`;
}

function renderTimesheets() {
  if (!TV.ym) TV.ym = addMonths(ymOf(todayISO()), -1);
  const v = $('#v-timesheets');
  const projs = S.projects.filter(p => p.active !== false && (!TV.client || p.clientId === TV.client)).sort((a, b) => a.name.localeCompare(b.name));
  const all = projs.map(p => ({ p, ts: buildTimesheet(p.id, TV.ym) }));
  if (TV.all) { TV.picked = new Set(all.filter(x => x.ts.total > 0).map(x => x.p.id)); }
  const chosen = all.filter(x => TV.picked.has(x.p.id));
  v.innerHTML = `<div class="card">
    <div class="row">
      <h2 style="margin:0">Client timesheets</h2>
      <button class="btn sm" id="tv-prev">◀</button><input type="month" id="tv-ym" value="${TV.ym}"><button class="btn sm" id="tv-next">▶</button>
      <select id="tv-client">${opts(S.clients.map(c => [c.id, c.name]), TV.client, 'All clients')}</select>
      <span class="grow"></span>
      <button class="btn" id="tv-xls">Export Excel (1 tab per project)</button>
      <button class="btn pri" id="tv-print">Print / Save as PDF</button>
    </div>
    <p class="hint">Calendar month ${fmtDMY(TV.ym + '-01')} – ${fmtDMY(`${TV.ym}-${pad(dim(TV.ym))}`)}. Built from the master attendance: each day goes to the site the person worked at that day; <b>R</b> days go to the RELIEVER section. Totals count billable codes (${S.codes.filter(c => c.billable).map(c => c.code).join(', ')}).</p>
    <div class="scroll" style="max-height:260px;margin-top:8px"><table class="t"><thead><tr><th><input type="checkbox" id="tv-all" ${chosen.length === all.length && all.length ? 'checked' : ''}></th><th>Project</th><th>Client</th><th class="num">Staff rows</th><th class="num">Billable days</th><th class="num">≈ Guards (days ÷ ${dim(TV.ym)})</th></tr></thead><tbody>
    ${all.map(({ p, ts }) => `<tr><td><input type="checkbox" data-tp="${p.id}" ${TV.picked.has(p.id) ? 'checked' : ''}></td><td>${esc(p.name)}</td><td class="small">${esc(IX.client.get(p.clientId)?.name || '')}</td>
      <td class="num">${ts.rows.length}</td><td class="num">${ts.total}</td><td class="num">${qtyFmt(ts.total / dim(TV.ym))}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No projects yet – set them up under Clients, projects &amp; sites.</td></tr>'}
    </tbody></table></div>
  </div>
  <div id="tv-sheets">${chosen.map(x => tsSheetHTML(x.ts)).join('')}</div>`;
  $('#tv-ym').onchange = e => { if (e.target.value) { TV.ym = e.target.value; TV.all = true; renderTimesheets(); } };
  $('#tv-prev').onclick = () => { TV.ym = addMonths(TV.ym, -1); TV.all = true; renderTimesheets(); };
  $('#tv-next').onclick = () => { TV.ym = addMonths(TV.ym, 1); TV.all = true; renderTimesheets(); };
  $('#tv-client').onchange = e => { TV.client = e.target.value; TV.all = true; renderTimesheets(); };
  $('#tv-all').onchange = e => { TV.all = false; TV.picked = new Set(e.target.checked ? all.map(x => x.p.id) : []); renderTimesheets(); };
  v.querySelectorAll('[data-tp]').forEach(c => c.onchange = () => { TV.all = false; c.checked ? TV.picked.add(c.dataset.tp) : TV.picked.delete(c.dataset.tp); renderTimesheets(); });
  $('#tv-print').onclick = () => { if (!chosen.length) return toast('Tick at least one project'); printHTML(chosen.map(x => tsSheetHTML(x.ts)).join('')); };
  $('#tv-xls').onclick = () => { if (!chosen.length) return toast('Tick at least one project'); exportTimesheetsXlsx(chosen.map(x => x.ts)).catch(e => toast(e.message)); };
}

function printHTML(html) {
  const root = $('#print-root'); root.innerHTML = html;
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); root.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}
