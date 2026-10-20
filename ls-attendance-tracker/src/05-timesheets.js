/* =====================================================================
   Client timesheets (LS/DO/F-026, one sheet per project) for a calendar
   month or any period up to 31 days. A sheet is generated from the
   attendance; once edited or signed it is saved as a version
   (S.tsDocs) and that version is what is shown, printed and exported.
   ===================================================================== */
const TS_LEGEND = [['P', 'PRESENT'], ['A', 'ABSENT'], ['O', 'DAY OFF'], ['R', 'RELIEVER']];
/** Legend for a project: day-off is "O" on the SCL TR workbook, "OFF" on the Elwood sheets */
const tsLegend = p => TS_LEGEND.map(([a, b]) => [a === 'O' ? (p?.tsOff || 'O') : a, b]);
/* Look of the sheet: logo and every printed text, per client with a default (S.tsLayout = { def, clients: { id: {…} } });
   what is not set falls back to Settings and the LS/DO/F-026 wording */
const TS_COLS = { site: 'SITE NAME', shift: 'SHIFT D/N', name: 'NAME', code: 'EMP. CODE', total: 'TOTAL DAYS' };
function tsLook(p, { noClient = false, noDef = false } = {}) {
  const st = S.settings, L = S.tsLayout || {}, d = noDef ? {} : L.def || {}, c = noClient || !p ? {} : L.clients?.[p.clientId] || {};
  const g = (k, f) => c[k] ?? d[k] ?? f;
  return { logo: g('logo', LOGO), company: g('company', st.companyShort), title: g('title', st.tsTitle), formLabel: g('formLabel', 'Form No:'), formNo: g('formNo', st.formNo), revLabel: g('revLabel', 'REV NO:'), revNo: g('revNo', st.revNo), extra: g('extra', ''),
    monthLabel: g('monthLabel', 'MONTH'), periodLabel: g('periodLabel', 'PERIOD'), projectLabel: g('projectLabel', 'PROJECT NAME'),
    legend: g('legend', TS_LEGEND).map(([a, b]) => [a === 'O' ? (p?.tsOff || 'O') : a, b]), cols: { ...TS_COLS, ...d.cols, ...c.cols }, grand: g('grand', 'GRAND TOTAL'),
    sig: st.signatories.map((s, i) => ({ label: c.sig?.[i]?.label ?? d.sig?.[i]?.label ?? sigLabel(p, s, i), name: c.sig?.[i]?.name ?? d.sig?.[i]?.name ?? s.name ?? '', title: c.sig?.[i]?.title ?? d.sig?.[i]?.title ?? s.title ?? '' })) };
}
/** what differs from the level below → stored for a client (or as the default) */
function tsLookDiff(look, base, p) {
  const out = {};
  for (const k of ['logo', 'company', 'title', 'formLabel', 'formNo', 'revLabel', 'revNo', 'extra', 'monthLabel', 'periodLabel', 'projectLabel', 'grand']) if (look[k] !== base[k]) out[k] = look[k];
  const back = l => l.map(([a, b]) => [a === (p?.tsOff || 'O') ? 'O' : a, b]);
  if (JSON.stringify(look.legend) !== JSON.stringify(base.legend)) out.legend = back(look.legend);
  const cols = {}; for (const k in TS_COLS) if (look.cols[k] !== base.cols[k]) cols[k] = look.cols[k]; if (Object.keys(cols).length) out.cols = cols;
  if (JSON.stringify(look.sig) !== JSON.stringify(base.sig)) out.sig = look.sig.map((x, i) => { const y = {}; for (const k of ['label', 'name', 'title']) if (x[k] !== base.sig[i]?.[k]) y[k] = x[k]; return y; });
  return out;
}
const TV = { mode: 'month', ym: null, from: null, to: null, client: '', q: '', picked: new Set(), all: true, preview: null, edit: null };

/** One pass over the ledger per period: projectId -> Map(rowKey -> row); cells keyed by day position 1..N. Cached until data changes. */
const PERIOD_CACHE = new Map();
function periodRows(from, to) {
  const ck = from + '|' + to + '|' + DATA_VER; if (PERIOD_CACHE.has(ck)) return PERIOD_CACHE.get(ck);
  if (PERIOD_CACHE.size > 12) PERIOD_CACHE.clear();
  const days = datesBetween(from, to), byProj = new Map();
  S.employees.forEach((emp, ei) => {
    const att = S.att[emp.id]; if (!att) return;
    days.forEach((d, k) => {
      const v = att[d]; if (!v || !employedOn(emp, d)) return;
      const c = typeof v === 'string' ? { c: v } : v;
      const cd = codeDef(c.c); if (!cd.billable && !cd.client) return;
      const site = siteOn(emp, d); const pid = IX.site.get(site)?.projectId; if (!pid) return;
      const shift = shiftOn(emp, d) || '', section = c.c === 'R' ? '__REL' : site, key = `${section}|${shift}|${emp.id}${section === '__REL' ? '|' + site : ''}`;
      let rows = byProj.get(pid); if (!rows) byProj.set(pid, rows = new Map());
      let row = rows.get(key);
      if (!row) rows.set(key, row = { section, shift, emp, ei, first: k + 1, name: c.n || '', cells: {}, total: 0, sites: new Set() });
      row.cells[k + 1] = c.c; row.sites.add(site);
      if (cd.billable) row.total++;
    });
  });
  PERIOD_CACHE.set(ck, byProj); return byProj;
}
const monthRows = ym => periodRows(ym + '-01', `${ym}-${pad(dim(ym))}`);
/** Project-wise sheet for a calendar month (buildTimesheet(pid, 'YYYY-MM')) or a period (buildTimesheet(pid, from, to)). */
function buildTimesheet(projectId, from, to) {
  let ym = null; if (!to) { ym = from; from = ym + '-01'; to = `${ym}-${pad(dim(ym))}`; }
  const dates = datesBetween(from, to);
  const siteOrder = sitesOfProject(projectId).map(s => s.id);
  const rows = periodRows(from, to).get(projectId) || new Map();
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
  return { projectId, ym, from, to, dates, days: dates.length, sections, total, rows: list };
}
const tsLabel = ts => ts.ym ? fmtMonYY(ts.ym) : `${fmtDMY(ts.from)} – ${fmtDMY(ts.to)}`;
const rowName = r => r.name || r.emp?.name || '';
const rowCode = r => r.code ?? (r.emp ? empCodeLabel(r.emp) : '');
const tsKey = ts => `${ts.projectId}|${ts.from}|${ts.to}`;
const rowTotal = cells => Object.values(cells).filter(c => c && codeDef(c).billable).length;
/** codes shown in a day cell: the client codes, plus A and day-off typed into an edited sheet */
const tsShown = (c, edited) => c && (codeDef(c).client || (edited && (c === 'A' || c === 'OFF')));

/* ---------- saved versions ---------- */
const tsDoc = ts => S.tsDocs?.[tsKey(ts)] || null;
/** a saved version's rows -> sheet sections (order kept, each row remembers its index for editing) */
function docSheet(ts, doc) {
  const sections = []; let sec = null;
  doc.rows.forEach((r, ri) => { const name = r.section || ''; if (!sec || sec.name !== name) sections.push(sec = { id: name, name, rows: [] }); sec.rows.push({ ...r, ri, total: rowTotal(r.cells) }); });
  const rows = sections.flatMap(s => s.rows);
  return { ...ts, sections, rows, total: rows.reduce((a, r) => a + r.total, 0), doc };
}
/** rows of a sheet as plain saved rows */
const docRows = ts => ts.sections.flatMap(s => s.rows.map(r => ({ section: s.name, shift: r.shift || '', name: rowName(r), code: rowCode(r), cells: { ...r.cells } })));
/** short fingerprint of the generated sheet, to see whether attendance changed after a version was saved */
function tsBasis(ts) { const s = JSON.stringify(docRows(ts)); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h.toString(36); }
/** What is shown, printed and exported: the saved version if there is one, narrowed to one person if asked */
function tsView(ts, q = TV.q) {
  const doc = tsDoc(ts); let v = doc ? docSheet(ts, doc) : ts;
  if (q) {
    const n = norm(q), keep = r => norm(rowName(r)).includes(n) || norm(rowCode(r)).includes(n);
    const sections = v.sections.map(s => ({ ...s, rows: s.rows.filter(keep) })).filter(s => s.rows.length), rows = sections.flatMap(s => s.rows);
    v = { ...v, sections, rows, total: rows.reduce((a, r) => a + r.total, 0), filtered: q };
  }
  return v;
}

/** Signature label: the Elwood sheets leave the second box (acknowledge) unlabelled */
const sigLabel = (p, s, i) => i === 1 && p?.tsNoAck ? '' : s.label;
/** Layout of a sheet: one text size for all of it – the largest (up to 10.5 px) at which every column's content fits the
 *  page width – and column widths in proportion to what each holds. A site or name far longer than the rest may take two lines. */
const TS_W = 1096;
let tsCtx = null;
const tsTextW = (t, fs, bold) => { tsCtx ||= document.createElement('canvas').getContext('2d'); tsCtx.font = `${bold ? '700 ' : ''}${fs}px Verdana, Tahoma, Arial, sans-serif`; return tsCtx.measureText(t || '').width; };
function tsLayout(ts, lk) {
  const w10 = (list, bold) => Math.max(0, ...list.map(t => tsTextW(t, 10, bold))) / 10;    // widest text per px of font size
  const words = list => list.flatMap(t => String(t || '').split(/\s+/));
  // width of a text broken over two lines at the best place (e.g. "SUBCON" / "(HEMAYA SECURITY)")
  const twoLines = t => { const w = String(t || '').split(/\s+/).filter(Boolean); if (w.length < 2) return tsTextW(w[0] || '', 10); let best = Infinity;
    for (let k = 1; k < w.length; k++) best = Math.min(best, Math.max(tsTextW(w.slice(0, k).join(' '), 10), tsTextW(w.slice(k).join(' '), 10))); return best; };
  const pad = 8, dpad = 8, N = ts.days, offTxt = IX.proj.get(ts.projectId)?.tsOff === 'OFF' && ts.rows.some(r => Object.values(r.cells).includes('OFF')) ? 'OFF' : 'O';
  let site = w10(ts.sections.map(x => x.name), true), name = w10(ts.rows.map(rowName), false);
  const C = lk?.cols || TS_COLS, longest = t => String(t || '').split(/\s+/).reduce((a, w) => a.length >= w.length ? a : w, '');
  const shift = w10(['NIGHT', longest(C.shift)], true), code = Math.max(w10([longest(C.code)], true) * 10, ...ts.rows.map(r => twoLines(rowCode(r)))) / 10, day = w10([offTxt, '31'], true), total = w10([longest(C.total)], true);
  const solve = () => (TS_W - pad * 5 - dpad * N) / (site + shift + name + code + N * day + total);
  let fs = solve(), two = false;
  // a single outlier that would make everything small: let it take two lines (half the width) instead
  {
    // an outlier (the longest site or name) may take two lines – the column then follows the second-longest entry –
    // but only when the text would otherwise be small (< 8.5 px) and wrapping makes it clearly bigger; otherwise everything stays on one line
    const tamed = (list, bold) => { const v = list.map(t => tsTextW(t, 10, bold) / 10).sort((x, y) => y - x); return Math.max(v[1] || 0, (v[0] || 0) / 2, w10(words(list), bold)); };
    const s0 = site, n0 = name; site = tamed(ts.sections.map(x => x.name), true); name = tamed(ts.rows.map(rowName), false);
    const fs2 = solve();
    if (fs < 8.5 && fs2 >= fs + 0.75 && (site < s0 || name < n0)) { two = true; fs = fs2; } else { site = s0; name = n0; }
  }
  fs = Math.max(6.5, Math.min(10.5, Math.floor(fs * 4) / 4));
  if (typeof window !== 'undefined') window.__tsfs = fs;
  const cols = { site: site * fs + pad, shift: shift * fs + pad, name: name * fs + pad, code: code * fs + pad, day: day * fs + dpad, total: total * fs + pad };
  const used = cols.site + cols.shift + cols.name + cols.code + N * cols.day + cols.total, k = TS_W / used;        // spread what is left evenly
  const pct = x => (x * k / TS_W * 100).toFixed(2) + '%';
  return { fs, two, w: { site: pct(cols.site), shift: pct(cols.shift), name: pct(cols.name), code: pct(cols.code), day: pct(cols.day), total: pct(cols.total) } };
}
/** LS/DO/F-026 – same blocks as the SCL TR workbook and the signed Elwood sheets.
 *  opt.edit: cells editable (preview) */
function tsSheetHTML(ts, opt = {}) {
  const st = S.settings, p = IX.proj.get(ts.projectId), N = ts.days, ed = !!opt.edit, edited = !!ts.doc || ed, lk = opt.look || tsLook(p), lay = tsLayout(ts, lk), fs = lay.fs, LM = !!opt.layout;
  const E = (k, t, br) => LM ? `<span class="tl" contenteditable="true" spellcheck="false" data-lk="${k}">${esc(t)}</span>` : br ? esc(t).replace(' ', '<br>') : esc(t);
  const dayTh = (ts.dates || []).map(d => `<th class="d" style="width:${lay.w.day}">${+d.slice(8)}</th>`).join('');
  const ce = (attrs, txt, cls = '') => ed ? `<td class="ed ${cls}" contenteditable="true" spellcheck="false" ${attrs}>${esc(txt)}</td>` : `<td${cls ? ` class="${cls}"` : ''}><div class="c2">${esc(txt)}</div></td>`;
  let body = '';
  ts.sections.forEach((sec, si) => {
    sec.rows.forEach((r, i) => {
      const ri = r.ri ?? -1;
      body += `<tr data-row="${ri}">${i === 0 ? (ed ? `<td class="site ed" rowspan="${sec.rows.length}" contenteditable="true" spellcheck="false" data-sec="${si}">${esc(sec.name)}</td>` : `<td class="site" rowspan="${sec.rows.length}"><div class="c2" style="-webkit-line-clamp:${sec.rows.length * 2}">${esc(sec.name)}</div></td>`) : ''}
        ${ce(`data-r="${ri}" data-f="shift"`, r.shift || '')}${ce(`data-r="${ri}" data-f="name"`, rowName(r), 'nm')}${ce(`data-r="${ri}" data-f="code"`, rowCode(r))}
        ${Array.from({ length: N }, (_, k) => { const c = r.cells[k + 1], show = tsShown(c, edited), txt = show ? (c === 'OFF' ? (p?.tsOff || 'O') : c) : '';
          return ed ? `<td class="ed d${show ? '' : ' x'}" contenteditable="true" spellcheck="false" data-r="${ri}" data-d="${k + 1}">${esc(txt)}</td>` : show ? `<td>${esc(txt)}</td>` : '<td class="x"></td>'; }).join('')}
        <td class="tot">${r.total}${ed ? `<button class="ts-del" data-del="${ri}" title="Delete this row">✕</button>` : ''}</td></tr>`;
    });
    if (ed) body += `<tr class="ts-add"><td colspan="${N + 5}"><button class="btn sm" data-add="${si}">+ Add row to ${esc(sec.name || 'this section')}</button></td></tr>`;
  });
  if (ed) body += `<tr class="ts-add"><td colspan="${N + 5}"><button class="btn sm" data-addsec="1">+ Add a site section</button></td></tr>`;
  if (!body) body = `<tr><td colspan="${N + 5}" style="padding:10px">No attendance for this project in ${esc(tsLabel(ts))}.</td></tr>`;
  const sg = lk.sig, sigs = ts.doc?.sigs || [], ver = ts.doc?.version || 0;
  const sigCell = (s, i) => {
    const g = sigs.find(x => x.slot === i);
    const who = LM ? `${E(`sig.${i}.name`, s.name)} ${E(`sig.${i}.title`, s.title)}` : esc([s.name, s.title].filter(Boolean).join(' '));
    return `<td>${g ? `<div class="ts-sig">${g.image ? `<img src="${g.image}" alt="">` : `<span class="ts-sig-t">${esc(g.name)}</span>`}<div class="ts-sig-m">${esc(g.name)} · ${esc(fmtDMY(g.at.slice(0, 10)))}${g.version < ver ? ` <b class="stale">(signed v${g.version}, sheet now v${ver})</b>` : ''}</div></div>` : ''}${who}</td>`;
  };
  return `<div class="sheet land ts-sheet${ed ? ' editing' : ''}${lay.two ? ' two' : ''}" style="--tsf:${fs}px">
    <table class="ts-top"><tbody>
      <tr><td colspan="3" class="c b">${E('company', lk.company)}</td><td rowspan="3" class="lg">${LM ? `<div class="tl-logo">${lk.logo !== 'none' ? `<img src="${lk.logo}" alt="">` : '<span class="muted small">No logo</span>'}<div class="tl-tools"><button type="button" class="btn sm" data-logo="up">${lk.logo !== 'none' ? 'Replace' : 'Add'} logo</button>${lk.logo !== 'none' ? '<button type="button" class="btn sm" data-logo="rm">Remove</button>' : ''}</div></div>` : lk.logo !== 'none' ? `<img src="${lk.logo}" alt="">` : ''}</td></tr>
      <tr><td colspan="3" class="c b">${E('title', lk.title)}</td></tr>
      <tr><td class="c b">${E('formLabel', lk.formLabel)} ${E('formNo', lk.formNo)}</td><td class="c b" style="width:22%">${E('revLabel', lk.revLabel)} ${E('revNo', lk.revNo)}</td><td style="width:22%" class="c b">${E('extra', lk.extra)}</td></tr>
    </tbody></table>
    <div class="ts-mid">
      <table class="ts-mb"><tr><td class="k">${ts.ym ? E('monthLabel', lk.monthLabel) : E('periodLabel', lk.periodLabel)}</td><td class="v">${esc(tsLabel(ts))}</td></tr><tr><td class="k">${E('projectLabel', lk.projectLabel)}</td><td class="v">${esc(p?.name || '')}</td></tr></table>
      <table class="ts-legend">${lk.legend.map(([a, b], i) => `<tr><td>${E(`legend.${i}.0`, a)}</td><td>${E(`legend.${i}.1`, b)}${LM ? `<button type="button" class="ts-del" data-lgdel="${i}" title="Remove this line">✕</button>` : ''}</td></tr>`).join('')}${LM ? '<tr><td colspan="2"><button type="button" class="btn sm" data-lgadd="1">+ Line</button></td></tr>' : ''}</table>
    </div>
    <table class="ts"><thead><tr><th style="width:${lay.w.site}">${E('cols.site', lk.cols.site)}</th><th style="width:${lay.w.shift}">${E('cols.shift', lk.cols.shift, true)}</th><th style="width:${lay.w.name}">${E('cols.name', lk.cols.name)}</th><th style="width:${lay.w.code}">${E('cols.code', lk.cols.code)}</th>${dayTh}<th class="tt" style="width:${lay.w.total}">${E('cols.total', lk.cols.total)}</th></tr></thead>
    <tbody>${body}<tr class="gtr"><td colspan="${Math.max(1, N - 6 + 4)}" class="nb"></td><td colspan="6" class="gl">${E('grand', lk.grand)}</td><td class="gt">${ts.total}</td></tr></tbody></table>
    <table class="ts-sign"><tr>${sg.map((s, i) => `<td>${E(`sig.${i}.label`, s.label)}</td>`).join('')}</tr><tr class="nm">${sg.map(sigCell).join('')}</tr></table>
  </div>`;
}

/** The period on screen: a calendar month, or From–To (up to 31 days) */
function tsPeriod() {
  if (!TV.ym) TV.ym = addMonths(ymOf(todayISO()), -1);
  if (TV.mode === 'range' && TV.from && TV.to) return [TV.from, TV.to];
  return [TV.ym];
}
function renderTimesheets() {
  const per = tsPeriod(), v = $('#v-timesheets');
  const projs = S.projects.filter(p => p.active !== false && (!TV.client || p.clientId === TV.client)).sort((a, b) => a.name.localeCompare(b.name));
  let all = projs.map(p => { const base = buildTimesheet(p.id, ...per); return { p, base, ts: tsView(base) }; });
  if (TV.q) all = all.filter(x => x.ts.rows.length);
  if (TV.all) { TV.picked = new Set(all.filter(x => x.ts.total > 0).map(x => x.p.id)); }
  const chosen = all.filter(x => TV.picked.has(x.p.id));
  const pv = all.find(x => x.p.id === TV.preview) || chosen[0] || all[0] || null;
  TV.chosen = chosen; TV.pv = pv;
  if (TV.edit && (!pv || TV.edit.key !== tsKey(pv.base))) TV.edit = null;
  const D = all[0]?.base.days || dim(TV.ym), sumDays = all.reduce((a, x) => a + x.ts.total, 0);
  // keep the project list where it was (unless the period or client changed)
  const key = per.join('|') + '|' + (TV.client || '') + '|' + TV.q, keep = TV._key === key; TV._key = key;
  const sTop = keep ? $('#v-timesheets .tw')?.scrollTop || 0 : 0;
  v.innerHTML = docHead('Client timesheets', `one LS/DO/F-026 sheet per project · ${chosen.length} ticked for print / export`, `
      <input type="search" id="tv-q" placeholder="Name or Emp ID" value="${esc(TV.q)}" style="width:170px" title="Show only this person's rows">
      <select id="tv-client">${opts(S.clients.map(c => [c.id, c.name]), TV.client, 'All clients')}</select>
      <span class="seg"><button data-tm="month" class="${TV.mode !== 'range' ? 'on' : ''}">Month</button><button data-tm="range" class="${TV.mode === 'range' ? 'on' : ''}">Custom period</button></span>
      ${TV.mode === 'range' ? `<input type="date" id="tv-from" value="${TV.from || ''}"><span class="muted">–</span><input type="date" id="tv-to" value="${TV.to || ''}">`
        : `<button class="btn sm" id="tv-prev">◀</button><input type="month" id="tv-ym" value="${TV.ym}"><button class="btn sm" id="tv-next">▶</button>`}`)
  + `<div class="dc"><div class="split tv-split">
    <div class="tw tv-list"><table><thead><tr><th><input type="checkbox" id="tv-all" ${chosen.length === all.length && all.length ? 'checked' : ''}></th><th>Project</th><th class="num">Rows</th><th class="num">Days</th><th class="num" title="billable days ÷ ${D}">Guards</th></tr></thead><tbody>
    ${all.map(({ p, ts }) => `<tr class="${p.id === pv?.p.id ? 'on' : ''}" data-pv="${p.id}" style="cursor:pointer"><td><input type="checkbox" data-tp="${p.id}" ${TV.picked.has(p.id) ? 'checked' : ''}></td><td class="tvn" title="${esc(p.name)} · ${esc(IX.client.get(p.clientId)?.name || '')}">${esc(p.name)}${ts.doc ? ' <span class="pill" title="Edited / signed version">v' + ts.doc.version + '</span>' : ''}</td>
      <td class="num">${ts.rows.length || ''}</td><td class="num">${ts.total || ''}</td><td class="num">${ts.total ? qtyFmt(ts.total / D) : ''}</td></tr>`).join('') || `<tr><td colspan="5" class="muted">${TV.q ? `Nobody matching “${esc(TV.q)}” in this period.` : 'No projects yet.'}</td></tr>`}
    </tbody><tfoot><tr class="total"><td></td><td>${all.length} projects</td><td></td><td class="num">${sumDays}</td><td class="num">${qtyFmt(sumDays / D)}</td></tr></tfoot></table></div>
    <div class="tv-right"><div id="tv-bar" class="tv-bar"></div><div id="tv-sheets">${pv ? '' : `<div class="empty"><b>No attendance in this period</b>Pick another period, or import / enter attendance first.</div>`}</div></div>
  </div></div>`;
  tsShowPreview();
  const tw = $('.tw', v); if (tw) tw.scrollTop = sTop;
  const rer = () => { TV.all = true; renderTimesheets(); renderStatus(); };
  v.querySelectorAll('[data-tm]').forEach(b => b.onclick = () => { TV.mode = b.dataset.tm; if (TV.mode === 'range' && !TV.from) { TV.from = TV.ym + '-01'; TV.to = addDays(TV.from, 14); } rer(); });
  if ($('#tv-ym')) $('#tv-ym').onchange = e => { if (e.target.value) { TV.ym = e.target.value; rer(); } };
  if ($('#tv-prev')) $('#tv-prev').onclick = () => { TV.ym = addMonths(TV.ym, -1); rer(); };
  if ($('#tv-next')) $('#tv-next').onclick = () => { TV.ym = addMonths(TV.ym, 1); rer(); };
  for (const k of ['from', 'to']) if ($('#tv-' + k)) $('#tv-' + k).onchange = e => {
    const val = e.target.value; if (!val) return;
    let f = k === 'from' ? val : TV.from, t = k === 'to' ? val : TV.to;
    if (t < f) [f, t] = [t, f];
    if (daysBetween(f, t) > 30) { toast('A period can be at most 31 days'); t = addDays(f, 30); }
    TV.from = f; TV.to = t; rer();
  };
  $('#tv-q').oninput = e => { clearTimeout(TV._qt); TV._qt = setTimeout(() => { TV.q = e.target.value.trim(); rer(); const i = $('#tv-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 300); };
  $('#tv-client').onchange = e => { TV.client = e.target.value; rer(); };
  $('#tv-all').onchange = e => { TV.all = false; TV.picked = new Set(e.target.checked ? all.map(x => x.p.id) : []); renderTimesheets(); };
  // clicking a project only swaps the preview, so the list stays where it is
  v.querySelectorAll('[data-pv]').forEach(tr => tr.onclick = e => {
    if (e.target.matches('input')) return;
    const x = all.find(a => a.p.id === tr.dataset.pv); if (!x) return;
    if (TV.edit && !confirm('Leave without saving your edits?')) return;
    TV.edit = null; TV.preview = x.p.id; TV.pv = x; v.querySelectorAll('[data-pv].on').forEach(r => r.classList.remove('on')); tr.classList.add('on');
    tsShowPreview();
  });
  v.querySelectorAll('[data-tp]').forEach(c => c.onchange = () => { TV.all = false; c.checked ? TV.picked.add(c.dataset.tp) : TV.picked.delete(c.dataset.tp); renderTimesheets(); });
}
/** Preview of the selected sheet + its bar (edit / Excel / versions / signatures) */
function tsShowPreview() {
  const box = $('#tv-sheets'), bar = $('#tv-bar'), pv = TV.pv; if (!box || !bar || !pv) { if (bar) bar.innerHTML = ''; return; }
  const ts = tsView(pv.base), doc = ts.doc, ed = TV.edit;
  if (TV.lay) return tsShowLayout(box, bar, ts);
  const changed = doc && doc.basis && doc.basis !== tsBasis(pv.base);
  const signed = (doc?.sigs || []).length;
  bar.innerHTML = ed
    ? `<b>Editing</b><span class="muted small">Click a cell and type: P, A, ${esc(IX.proj.get(ts.projectId)?.tsOff || 'O')}, R… · names, codes and sites are editable · ✕ deletes a row</span><span class="spacer"></span><button class="btn sm" id="te-cancel">Cancel</button><button class="btn sm pri" id="te-save">Save version</button>`
    : `<button class="btn sm" id="te-edit">Edit sheet</button><button class="btn sm" id="te-lay" title="Logo and every printed text – for this client or for all">Edit layout</button><button class="btn sm" id="te-xlsx">Download Excel</button><label class="btn sm">Upload edited Excel…<input type="file" id="te-up" accept=".xlsx,.xls" hidden></label>
       ${doc ? `<span class="pill">v${doc.version} · ${esc(fmtDMY(doc.savedAt.slice(0, 10)))}${doc.savedBy ? ' · ' + esc(doc.savedBy) : ''}</span>${doc.edited ? '<span class="pill warn">edited</span>' : ''}` : '<span class="muted small">Generated from attendance</span>'}
       ${signed ? `<span class="pill pos">${signed} signature(s)</span>` : ''}${!ts.filtered ? '<button class="btn sm pri" id="te-sign">Sign…</button>' : ''}<button class="btn sm" id="te-mail" title="Email this timesheet (and invoice packs) to the client">Email…</button>
       ${changed ? `<span class="pill warn" title="Attendance was changed after this version was saved">attendance changed</span><button class="btn sm" id="te-upd">Update from attendance</button>` : ''}
       ${ts.filtered ? `<span class="pill">only “${esc(ts.filtered)}”</span>` : ''}
       <span class="spacer"></span>${doc ? '<button class="btn sm bad" id="te-reset">Reset to attendance</button>' : ''}`;
  box.innerHTML = tsSheetHTML(ed ? docSheet(pv.base, { ...(doc || {}), rows: ed.rows }) : ts, { edit: !!ed });
  box.scrollLeft = 0; tsScale();
  const q = s => bar.querySelector(s);
  if (ed) {
    q('#te-cancel').onclick = () => { TV.edit = null; tsShowPreview(); };
    q('#te-save').onclick = () => { tsSaveVersion(pv.base, TV.edit.rows, true); TV.edit = null; renderTimesheets(); toast('Saved – the PDF and Excel now use this version'); };
    tsBindEdit(box);
    return;
  }
  q('#te-edit').onclick = () => { if (ts.filtered) return toast('Clear the Name / Emp ID filter to edit the whole sheet'); TV.edit = { key: tsKey(pv.base), rows: JSON.parse(JSON.stringify(doc ? doc.rows : docRows(pv.base))) }; tsShowPreview(); };
  q('#te-lay').onclick = () => { const p = IX.proj.get(ts.projectId); TV.lay = { look: JSON.parse(JSON.stringify(tsLook(p))), scope: p?.clientId ? 'client' : 'def', p }; tsShowPreview(); };
  q('#te-xlsx').onclick = () => exportTimesheetsXlsx([ts]).catch(e => toast(e.message));
  q('#te-up').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { const rows = await readTimesheetXlsx(f, pv.base); tsSaveVersion(pv.base, rows, true); renderTimesheets(); toast(`Read ${rows.length} row(s) from ${f.name} – saved as a new version`); } catch (err) { toast(err.message, 6000); } };
  if (q('#te-upd')) q('#te-upd').onclick = async () => { if (!await confirmBox('Replace the saved version with the current attendance? Your edits on this sheet are replaced, and anyone who signed is notified.', 'Update')) return; tsSaveVersion(pv.base, docRows(pv.base), false); renderTimesheets(); };
  if (q('#te-reset')) q('#te-reset').onclick = async () => { if (!await confirmBox(`Drop the saved version${signed ? ' and its signatures' : ''} and show the sheet from attendance again?`, 'Reset', 'bad')) return; tsDropVersion(pv.base); renderTimesheets(); };
  if (q('#te-mail')) q('#te-mail').onclick = () => emailClient({ projectId: pv.base.projectId, base: pv.base, type: 'ts' });
  if (q('#te-sign')) q('#te-sign').onclick = () => {
    if (!whoAmI()) return askMe(() => q('#te-sign')?.click());
    const slots = S.settings.signatories.map((sg, i) => [i, sg]).filter(([i]) => canSign(i));
    if (!slots.length) { const m = openModal('Not allowed to sign yet', `<p style="margin-top:0"><b>${esc(whoAmI())}</b> is not on the list of people who may sign timesheets.</p><p class="muted">An admin adds signers in <b>Settings → Timesheet signatories → Emails allowed to sign</b> (one list per box: Prepared, Acknowledged, Verified, Approved, Accepted).</p>`, [{ label: 'Change my email', onClick: () => { setTimeout(() => askMe(), 0); } }, { label: 'Open Settings', cls: 'pri', onClick: () => { showView('data'); setTimeout(() => $('[data-sec="sign"]')?.scrollIntoView({ block: 'start' }), 100); } }]); return; }
    if (slots.length === 1) return signTimesheet(pv.base, slots[0][0]);
    const m = openModal('Sign as', `<div class="row" style="flex-direction:column;align-items:stretch;gap:6px">${slots.map(([i, sg]) => `<button class="btn" data-sl="${i}">${esc(sg.label || 'Box ' + (i + 1))}</button>`).join('')}</div>`, [{ label: 'Cancel' }]);
    m.querySelectorAll('[data-sl]').forEach(b => b.onclick = () => { closeModal(); signTimesheet(pv.base, +b.dataset.sl); });
  };
}
/** Layout mode: logo and every printed text editable on the sheet; saved for this client or as the default for all */
function tsShowLayout(box, bar, ts) {
  const L = TV.lay, p = L.p, c = IX.client.get(p?.clientId), has = !!S.tsLayout?.clients?.[p?.clientId];
  bar.innerHTML = `<b>Layout</b><span class="muted small">Click any text on the sheet and type; the logo has Replace / Remove.</span>
    <label class="small">Apply to <select id="tl-scope">${c ? `<option value="client"${L.scope === 'client' ? ' selected' : ''}>this client – ${esc(c.name)}</option>` : ''}<option value="def"${L.scope === 'def' ? ' selected' : ''}>all clients (default)</option></select></label>
    <span class="spacer"></span>${has ? '<button class="btn sm bad" id="tl-reset">Reset this client to default</button>' : ''}<button class="btn sm" id="tl-x">Cancel</button><button class="btn sm pri" id="tl-save">Save layout</button>`;
  box.innerHTML = tsSheetHTML(ts, { look: L.look, layout: true }); box.scrollLeft = 0; tsScale();
  const q = s => bar.querySelector(s);
  const read = () => box.querySelectorAll('[data-lk]').forEach(el => { const path = el.dataset.lk.split('.'), v = el.textContent.replace(/\s+/g, ' ').trim(); let o = L.look; for (const k of path.slice(0, -1)) o = o[k]; o[path.at(-1)] = v; });
  box.oninput = read;
  box.onclick = e => {
    const b = e.target.closest('button'); if (!b) return; read();
    if (b.dataset.logo === 'rm') { L.look.logo = 'none'; tsShowPreview(); }
    else if (b.dataset.logo === 'up') pickFiles('image/*', false, async fs => { try { L.look.logo = await tsLogoPng(fs[0]); tsShowPreview(); } catch (er) { toast('Could not read that image', 5000); } });
    else if (b.dataset.lgdel) { L.look.legend.splice(+b.dataset.lgdel, 1); tsShowPreview(); }
    else if (b.dataset.lgadd) { L.look.legend.push(['X', 'MEANING']); tsShowPreview(); }
  };
  q('#tl-scope').onchange = e => { read(); L.scope = e.target.value; };
  q('#tl-x').onclick = () => { TV.lay = null; tsShowPreview(); };
  q('#tl-save').onclick = () => {
    read(); const T = S.tsLayout ||= { def: {}, clients: {} };
    if (L.scope === 'client' && p?.clientId) { const d = tsLookDiff(L.look, tsLook(p, { noClient: true }), p); if (Object.keys(d).length) T.clients[p.clientId] = d; else delete T.clients[p.clientId]; }
    else T.def = tsLookDiff(L.look, tsLook(p, { noClient: true, noDef: true }), p);
    TV.lay = null; markDirty(); tsShowPreview(); toast(L.scope === 'client' ? `Layout saved for ${c?.name}` : 'Layout saved for all clients');
  };
  q('#tl-reset')?.addEventListener('click', async () => { if (!await confirmBox(`Use the default layout for ${c.name} again?`, 'Reset', 'bad')) return; delete S.tsLayout.clients[p.clientId]; TV.lay = null; markDirty(); tsShowPreview(); });
}
/** a logo image → PNG data URL, at most 400 px wide (PNG so the Excel export can use it too) */
async function tsLogoPng(f) {
  const url = URL.createObjectURL(f);
  try { const im = await sigLoadImg(url), w = im.naturalWidth || 400, h = im.naturalHeight || 160, k = Math.min(1, 400 / w), c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); return c.toDataURL('image/png'); }
  finally { URL.revokeObjectURL(url); }
}
/** Edit mode: cells write into TV.edit.rows; totals follow as you type */
function tsBindEdit(box) {
  const rows = TV.edit.rows, valid = new Set(S.codes.map(c => c.code));
  const redrawTotals = () => { let g = 0; box.querySelectorAll('tr[data-row]').forEach(tr => { const r = rows[+tr.dataset.row]; if (!r) return; const t = rowTotal(r.cells); g += t; const td = tr.querySelector('.tot'); if (td) td.firstChild.nodeValue = t; }); const gt = box.querySelector('.gt'); if (gt) gt.textContent = g; };
  box.oninput = e => {
    const td = e.target.closest('td.ed'); if (!td) return;
    if (td.dataset.sec != null) { const sec = tsSections(rows)[+td.dataset.sec]; for (const i of sec) rows[i].section = td.textContent.trim().toUpperCase(); return; }
    const r = rows[+td.dataset.r]; if (!r) return;
    if (td.dataset.d) { let c = td.textContent.trim().toUpperCase(); if (c === 'O') c = 'OFF'; if (c) r.cells[td.dataset.d] = c; else delete r.cells[td.dataset.d]; td.classList.toggle('x', !c); redrawTotals(); }
    else r[td.dataset.f] = td.textContent.trim().replace(/\s+/g, ' ').toUpperCase();
  };
  box.onfocusout = e => {
    const td = e.target.closest('td.ed'); if (!td?.dataset.d) return;
    const r = rows[+td.dataset.r], c = r?.cells[td.dataset.d];
    if (c && !valid.has(c)) { toast(`“${c}” is not an attendance code`); delete r.cells[td.dataset.d]; td.textContent = ''; td.classList.add('x'); redrawTotals(); }
    else if (c) td.textContent = c === 'OFF' ? (IX.proj.get(TV.pv.p.id)?.tsOff || 'O') : c;
  };
  box.onkeydown = e => {
    const td = e.target.closest('td.ed'); if (!td?.dataset.d) return;
    const mv = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0], Enter: [1, 0] }[e.key]; if (!mv) return;
    const trs = [...box.querySelectorAll('tr[data-row]')], ti = trs.indexOf(td.closest('tr')), d = +td.dataset.d + mv[1];
    const nx = trs[ti + mv[0]]?.querySelector(`td[data-d="${d}"]`); if (nx) { e.preventDefault(); nx.focus(); const s = getSelection(); s.selectAllChildren(nx); }
  };
  box.onclick = e => {
    const del = e.target.closest('[data-del]'), add = e.target.closest('[data-add]'), sec = e.target.closest('[data-addsec]');
    if (del) { rows.splice(+del.dataset.del, 1); tsShowPreview(); }
    else if (add) { const idx = tsSections(rows)[+add.dataset.add], last = idx[idx.length - 1]; rows.splice(last + 1, 0, { section: rows[last].section, shift: rows[last].shift, name: '', code: '', cells: {} }); tsShowPreview(); box.querySelector(`td[data-r="${last + 1}"][data-f="name"]`)?.focus(); }
    else if (sec) { rows.push({ section: 'NEW SITE', shift: 'DAY', name: '', code: '', cells: {} }); tsShowPreview(); box.querySelector(`td[data-r="${rows.length - 1}"][data-f="name"]`)?.focus(); }
  };
}
/** row indexes per section, in the order shown */
function tsSections(rows) { const out = []; let cur = null; rows.forEach((r, i) => { if (!out.length || rows[i - 1].section !== r.section) out.push(cur = []); cur.push(i); }); return out; }

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
