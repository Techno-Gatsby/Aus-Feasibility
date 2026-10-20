/* =====================================================================
   Client timesheets (calendar month, one sheet per project, LS/DO/F-026)
   ===================================================================== */
const TS_LEGEND = [['P', 'PRESENT'], ['A', 'ABSENT'], ['O', 'DAY OFF'], ['R', 'RELIEVER']];
/** Legend for a project: day-off is "O" on the SCL TR workbook, "OFF" on the Elwood sheets */
const tsLegend = p => TS_LEGEND.map(([a, b]) => [a === 'O' ? (p?.tsOff || 'O') : a, b]);
const TV = { ym: null, client: '', picked: new Set(), all: true, preview: null };

/** One pass over the ledger per month: projectId -> Map(rowKey -> row). Cached until data changes. */
const MONTH_CACHE = new Map();
function monthRows(ym) {
  const ck = ym + '|' + DATA_VER; if (MONTH_CACHE.has(ck)) return MONTH_CACHE.get(ck);
  if (MONTH_CACHE.size > 12) MONTH_CACHE.clear();
  const days = monthDates(ym), byProj = new Map();
  S.employees.forEach((emp, ei) => {
    const att = S.att[emp.id]; if (!att) return;
    for (const d of days) {
      const v = att[d]; if (!v || !employedOn(emp, d)) continue;
      const c = typeof v === 'string' ? { c: v } : v;
      const cd = codeDef(c.c); if (!cd.billable && !cd.client) continue;
      const site = siteOn(emp, d); const pid = IX.site.get(site)?.projectId; if (!pid) continue;
      const shift = shiftOn(emp, d) || '', section = c.c === 'R' ? '__REL' : site, key = `${section}|${shift}|${emp.id}${section === '__REL' ? '|' + site : ''}`;
      let rows = byProj.get(pid); if (!rows) byProj.set(pid, rows = new Map());
      let row = rows.get(key);
      if (!row) rows.set(key, row = { section, shift, emp, ei, first: +d.slice(8), name: c.n || '', cells: {}, total: 0, sites: new Set() });
      row.cells[+d.slice(8)] = c.c; row.sites.add(site);
      if (cd.billable) row.total++;
    }
  });
  MONTH_CACHE.set(ck, byProj); return byProj;
}
/** Build the project-wise breakup for one calendar month from the daily ledger. */
function buildTimesheet(projectId, ym) {
  const days = monthDates(ym);
  const siteOrder = sitesOfProject(projectId).map(s => s.id);
  const rows = monthRows(ym).get(projectId) || new Map();
  const secIdx = s => s === '__REL' ? 1e6 : siteOrder.indexOf(s);
  // within a site: DAY before NIGHT, then in order of first day worked (as on the LS/DO/F-026 sheets)
  const shIdx = x => x === 'DAY' ? 0 : x === 'NIGHT' ? 1 : 2;
  const list = [...rows.values()].sort((a, b) => secIdx(a.section) - secIdx(b.section) || shIdx(a.shift) - shIdx(b.shift) || a.first - b.first || a.ei - b.ei);
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

/** Signature label: the Elwood sheets leave the second box (acknowledge) unlabelled */
const sigLabel = (p, s, i) => i === 1 && p?.tsNoAck ? '' : s.label;
/** One text size for the whole sheet: the largest (up to 8.5 px) at which the longest site, shift, name and code fit their columns (names may use two lines) */
const TS_W = 1096, TS_COL = { site: 8, shift: 4, name: 17, code: 9, total: 5 };
let tsCtx = null;
function tsFontSize(ts) {
  tsCtx ||= document.createElement('canvas').getContext('2d');
  const need = (t, pct, lines = 1, bold = false) => { if (!t) return 9; tsCtx.font = `${bold ? '700 ' : ''}10px Verdana, Tahoma, Arial, sans-serif`; const room = (TS_W * pct / 100 - 6) * lines, w = lines > 1 ? tsCtx.measureText(t).width * 1.1 : Math.max(...t.split(/\s+/).map(x => tsCtx.measureText(x).width)); return 10 * room / w; };
  let fs = 8.5;
  for (const sec of ts.sections) { fs = Math.min(fs, need(sec.name, TS_COL.site, 1, true)); for (const r of sec.rows) fs = Math.min(fs, need(r.shift, TS_COL.shift), need(r.name || r.emp.name, TS_COL.name, 2), need(empCodeLabel(r.emp), TS_COL.code, 2)); }
  return Math.max(6.5, Math.floor(fs * 4) / 4);
}
/** LS/DO/F-026 – same blocks as the SCL TR workbook and the signed Elwood sheets */
function tsSheetHTML(ts) {
  const st = S.settings, p = IX.proj.get(ts.projectId), N = ts.days;
  const dayTh = Array.from({ length: N }, (_, i) => `<th class="d">${i + 1}</th>`).join('');
  let body = '';
  for (const sec of ts.sections) {
    sec.rows.forEach((r, i) => {
      body += `<tr>${i === 0 ? `<td class="site" rowspan="${sec.rows.length}">${esc(sec.name)}</td>` : ''}
        <td>${esc(r.shift)}</td><td class="nm">${esc(r.name || r.emp.name)}</td><td>${esc(empCodeLabel(r.emp))}</td>
        ${Array.from({ length: N }, (_, k) => { const c = r.cells[k + 1]; return c && codeDef(c).client ? `<td>${esc(c === 'OFF' ? (p?.tsOff || 'O') : c)}</td>` : '<td class="x"></td>'; }).join('')}
        <td class="tot">${r.total}</td></tr>`;
    });
  }
  if (!body) body = `<tr><td colspan="${N + 5}" style="padding:10px">No attendance for this project in ${fmtMonYY(ts.ym)}.</td></tr>`;
  const sg = st.signatories;
  return `<div class="sheet land ts-sheet" style="--tsf:${tsFontSize(ts)}px">
    <table class="ts-top"><tbody>
      <tr><td colspan="3" class="c b">${esc(st.companyShort)}</td><td rowspan="3" class="lg"><img src="${LOGO}" alt=""></td></tr>
      <tr><td colspan="3" class="c b">${esc(st.tsTitle)}</td></tr>
      <tr><td class="c b">Form No: ${esc(st.formNo)}</td><td class="c b" style="width:22%">REV NO: ${esc(st.revNo)}</td><td style="width:22%"></td></tr>
    </tbody></table>
    <div class="ts-mid">
      <table class="ts-mb"><tr><td class="k">MONTH</td><td class="v">${fmtMonYY(ts.ym)}</td></tr><tr><td class="k">PROJECT NAME</td><td class="v">${esc(p?.name || '')}</td></tr></table>
      <table class="ts-legend">${tsLegend(p).map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>
    </div>
    <table class="ts"><thead><tr><th style="width:${TS_COL.site}%">SITE NAME</th><th style="width:${TS_COL.shift}%">SHIFT<br>D/N</th><th style="width:${TS_COL.name}%">NAME</th><th style="width:${TS_COL.code}%">EMP. CODE</th>${dayTh}<th class="tt" style="width:${TS_COL.total}%">TOTAL DAYS</th></tr></thead>
    <tbody>${body}<tr class="gtr"><td colspan="${N - 6 + 4}" class="nb"></td><td colspan="6" class="gl">GRAND TOTAL</td><td class="gt">${ts.total}</td></tr></tbody></table>
    <table class="ts-sign"><tr>${sg.map((s, i) => `<td>${esc(sigLabel(p, s, i))}</td>`).join('')}</tr><tr class="nm">${sg.map(s => `<td>${esc([s.name, s.title].filter(Boolean).join(' '))}</td>`).join('')}</tr></table>
  </div>`;
}

function renderTimesheets() {
  if (!TV.ym) TV.ym = addMonths(ymOf(todayISO()), -1);
  const v = $('#v-timesheets');
  const projs = S.projects.filter(p => p.active !== false && (!TV.client || p.clientId === TV.client)).sort((a, b) => a.name.localeCompare(b.name));
  const all = projs.map(p => ({ p, ts: buildTimesheet(p.id, TV.ym) }));
  if (TV.all) { TV.picked = new Set(all.filter(x => x.ts.total > 0).map(x => x.p.id)); }
  const chosen = all.filter(x => TV.picked.has(x.p.id));
  const pv = all.find(x => x.p.id === TV.preview) || chosen[0] || null;
  TV.chosen = chosen;
  const D = dim(TV.ym), sumDays = all.reduce((a, x) => a + x.ts.total, 0);
  // keep the project list where it was (unless the month or client changed)
  const key = TV.ym + '|' + (TV.client || ''), keep = TV._key === key; TV._key = key;
  const sTop = keep ? $('#v-timesheets .tw')?.scrollTop || 0 : 0, sLeft = keep ? $('#tv-sheets')?.scrollLeft || 0 : 0;
  v.innerHTML = docHead('Client timesheets', `one LS/DO/F-026 sheet per project · ${chosen.length} ticked for print / export`, `
      <select id="tv-client">${opts(S.clients.map(c => [c.id, c.name]), TV.client, 'All clients')}</select>
      <button class="btn sm" id="tv-prev">◀</button><input type="month" id="tv-ym" value="${TV.ym}"><button class="btn sm" id="tv-next">▶</button>`)
  + `<div class="dc"><div class="split" style="grid-template-columns:minmax(320px,380px) 1fr">
    <div class="tw" style="max-height:calc(100vh - 190px)"><table><thead><tr><th><input type="checkbox" id="tv-all" ${chosen.length === all.length && all.length ? 'checked' : ''}></th><th>Project</th><th class="num">Rows</th><th class="num">Days</th><th class="num" title="billable days ÷ ${D}">Guards</th></tr></thead><tbody>
    ${all.map(({ p, ts }) => `<tr class="${p.id === pv?.p.id ? 'on' : ''}" data-pv="${p.id}" style="cursor:pointer"><td><input type="checkbox" data-tp="${p.id}" ${TV.picked.has(p.id) ? 'checked' : ''}></td><td class="tvn" title="${esc(p.name)} · ${esc(IX.client.get(p.clientId)?.name || '')}">${esc(p.name)}</td>
      <td class="num">${ts.rows.length || ''}</td><td class="num">${ts.total || ''}</td><td class="num">${ts.total ? qtyFmt(ts.total / D) : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No projects yet.</td></tr>'}
    </tbody><tfoot><tr class="total"><td></td><td>${all.length} projects</td><td></td><td class="num">${sumDays}</td><td class="num">${qtyFmt(sumDays / D)}</td></tr></tfoot></table></div>
    <div id="tv-sheets" style="min-width:0;overflow:auto">${pv ? tsSheetHTML(pv.ts) : '<div class="empty"><b>No attendance this month</b>Pick another month, or import / enter attendance first.</div>'}</div>
  </div></div>`;
  tsScale();
  const tw = $('.tw', v); if (tw) tw.scrollTop = sTop; if ($('#tv-sheets')) $('#tv-sheets').scrollLeft = sLeft;
  const rer = () => { renderTimesheets(); renderStatus(); };
  $('#tv-ym').onchange = e => { if (e.target.value) { TV.ym = e.target.value; TV.all = true; rer(); } };
  $('#tv-prev').onclick = () => { TV.ym = addMonths(TV.ym, -1); TV.all = true; rer(); };
  $('#tv-next').onclick = () => { TV.ym = addMonths(TV.ym, 1); TV.all = true; rer(); };
  $('#tv-client').onchange = e => { TV.client = e.target.value; TV.all = true; rer(); };
  $('#tv-all').onchange = e => { TV.all = false; TV.picked = new Set(e.target.checked ? all.map(x => x.p.id) : []); rer(); };
  // clicking a project only swaps the preview, so the list stays where it is
  v.querySelectorAll('[data-pv]').forEach(tr => tr.onclick = e => {
    if (e.target.matches('input')) return;
    const x = all.find(a => a.p.id === tr.dataset.pv); if (!x) return;
    TV.preview = x.p.id; v.querySelectorAll('[data-pv].on').forEach(r => r.classList.remove('on')); tr.classList.add('on');
    const box = $('#tv-sheets'); box.innerHTML = tsSheetHTML(x.ts); box.scrollLeft = 0; tsScale();
  });
  v.querySelectorAll('[data-tp]').forEach(c => c.onchange = () => { TV.all = false; c.checked ? TV.picked.add(c.dataset.tp) : TV.picked.delete(c.dataset.tp); renderTimesheets(); });
}
/** The preview shows the whole A4 sheet scaled to the pane width (same layout as the print) */
function tsScale() {
  const box = $('#tv-sheets'), sh = box?.querySelector('.ts-sheet'); if (!sh) return;
  if (box.dataset.fit !== '1') { box.dataset.fit = '1'; tsFit.disconnect(); tsFit.observe(box); }
  sh.style.zoom = Math.min(2, (box.clientWidth - 2) / 1120).toFixed(3);      // fills the pane width, larger on wide screens
}
const tsFit = new ResizeObserver(() => tsScale());                 // pane resized (window, tree shown / hidden): re-fit
/** Toolbar / menu commands for the ticked projects */
function tsCmd(cmd) {
  if (curView !== 'timesheets') showView('timesheets');
  const chosen = TV.chosen || []; if (!chosen.length) return toast('Tick at least one project');
  if (cmd === 'print') printHTML(chosen.map(x => tsSheetHTML(x.ts)).join(''));
  else exportTimesheetsXlsx(chosen.map(x => x.ts)).catch(e => toast(e.message));
}

function printHTML(html) {
  const root = $('#print-root'); root.innerHTML = html;
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); root.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}
