/* =====================================================================
   Excel import (master payroll sheet, client timesheet workbook) and
   Excel export (master, client timesheets)
   ===================================================================== */
const CODE_ALIAS = { SICK: 'SL', O: 'OFF', 'DAY OFF': 'OFF', PP: 'P', PRESENT: 'P', ABSENT: 'A', RELIEVER: 'R', SRIA: 'SIRA' };
const END_WORDS = ['TERMINATED', 'RESIGNED', 'RESIGN', 'ABSCONDED', 'ABSCONDING', 'CANCELLED', 'VISA CANCELLED', 'TRANSFERRED'];
/** Trade spellings seen in the sheets → one name */
const normTrade = v => { const t = norm(v).replace(/\s*\.\s*$/, ''); return /^CCTV\b/.test(t) ? 'CCTV OPERATOR' : /^TEAM ?LEADERS?$/.test(t) ? 'TEAM LEADER' : /^(SECURITY )?GUARDS?$/.test(t) ? 'SECURITY GUARD' : t; };
const normCode = v => { const s = norm(v).replace(/\s*\.\s*/g, '.'); if (/^SIRA ?\.?T\.?$/.test(s)) return 'SIRA.T'; return CODE_ALIAS[s] || s; };

async function readWorkbook(file) {
  await loadScript(LIB.xlsx);
  return XLSX.read(await file.arrayBuffer(), { type: 'array' });
}
const sheetRows = (wb, name) => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: true });
const isHidden = (wb, i) => !!wb.Workbook?.Sheets?.[i]?.Hidden;

function ensureCode(code, stats) {
  if (IX.code.has(code)) return;
  S.codes.push({ code, label: code, color: '#e9e2f7', billable: false, client: false, key: '' });
  reindex(); stats && (stats.newCodes ||= new Set()).add(code);
}
function findOrCreateSite(name, projectId, stats) {
  const n = norm(name); if (!n) return null;
  let s = S.sites.find(x => norm(x.name) === n && (x.projectId || null) === (projectId || null))
    || (projectId && S.sites.find(x => norm(x.name) === n && !x.projectId))
    || (!projectId && S.sites.find(x => norm(x.name) === n));
  if (s) { if (projectId && !s.projectId) s.projectId = projectId; return s.id; }
  s = { id: uid('s'), projectId: projectId || null, name: n }; S.sites.push(s); IX.site.set(s.id, s);
  if (stats) stats.newSites = (stats.newSites || 0) + 1;
  return s.id;
}
/** Same project spelled differently across files: "SCL - TR - DIC LV 5" = "DIC TR LV-5", "SONAPURE-2" = "SONAPUR TR-2", "JABEL ALI TR-1" = "SCL - JEBEL ALI TR-1" */
function projKey(name) {
  let t = norm(name).replace(/\([^)]*\)/g, ' ').replace(/SUPERVISORS/g, 'SUPERVISOR').replace(/JABEL/g, 'JEBEL').replace(/QOUZ/g, 'QUOZ').replace(/KHWANEEJ/g, 'KHAWANEEJ')
    .replace(/SONAPURE?/g, 'SONAPUR TR').replace(/TR'S/g, 'TR').replace(/\bII\b/g, '2').replace(/[^A-Z0-9]+/g, ' ').trim().split(' ')
    .filter(x => x && !['NEW', 'UNDER', 'FURNITURE', 'INDUSTRY'].includes(x)).map(x => x.replace(/^0+(\d)/, '$1'));
  if (t[0] === 'SCL' && t.length > 2 && t.includes('TR')) t = t.slice(1);
  return [...new Set(t)].sort().join(' ');
}
function findOrCreateProject(name, stats) {
  const n = norm(name), k = projKey(n);
  let p = S.projects.find(x => norm(x.name) === n) || S.projects.find(x => projKey(x.name) === k);
  if (p) return p;
  p = { id: uid('p'), clientId: '', code: '', name: n, entityName: '', poNo: '', billing: { basis: 'ratecard', rate: 0, vat: 0, posts: 0, unit: 'Security', rates: {} }, active: true };
  S.projects.push(p); IX.proj.set(p.id, p); if (stats) stats.newProjects = (stats.newProjects || 0) + 1;
  return p;
}
function splitIdAgency(raw) {
  const s = norm(raw);
  if (!s) return { empCode: '', agency: '' };
  if (/^C\d{3,}$/.test(s)) return { empCode: s, agency: '' };
  const m = s.match(/^SUBCON\s*\(?\s*([^)]*)\)?$/); if (m) return { empCode: '', agency: m[1].trim() || 'SUBCON' };
  if (/^[A-Z]{0,3}\d{3,}$/.test(s)) return { empCode: s, agency: '' };
  return { empCode: '', agency: s };
}
function findEmployee(empCode, name, agency) {
  if (empCode) { const e = S.employees.find(x => x.empCode === empCode); if (e) return e; }
  const n = norm(name);
  return S.employees.find(x => norm(x.name) === n && (!empCode || !x.empCode) && (x.agency || '') === (agency || '')) || null;
}

/* ---------- master payroll sheet ---------- */
function parseMasterSheet(rows) {
  let hr = -1;
  for (let i = 0; i < Math.min(rows.length, 25); i++) if ((rows[i] || []).some(v => norm(v) === 'NAME')) { hr = i; break; }
  if (hr < 0) return null;
  const hdr = [rows[hr - 2] || [], rows[hr - 1] || [], rows[hr]];
  const width = Math.max(...hdr.map(r => r.length));
  const col = {};
  for (let c = 0; c < width; c++) {
    const L = hdr.map(r => norm(r[c]));
    if (L.includes('NAME')) col.name = c;
    if (L.some(l => /EMP\.?\s*ID|EMP\.?\s*CODE|STAFF\s*ID|^COMPANY$/.test(l))) col.id ??= c;
    if (L.some(l => l === 'D.O.J' || l === 'DOJ' || /JOINING/.test(l))) col.doj = c;
    if (L.some(l => /^TRADE\b/.test(l) || l === 'DESIGNATION')) col.trade = c;
    if (L.some(l => l === 'PROJECT' || l === 'SITE' || l === 'SITE NAME' || /^PROJECT \(SITE NAME\)$/.test(l))) col.site = c;
  }
  // day columns = longest run of consecutive dates in the header row (or the row above)
  const findDates = r => { const out = []; for (let c = 0; c < width; c++) { const iso = parseAnyDate(r[c]); if (iso && iso >= '2015' && iso <= '2040') out.push({ c, iso }); } return out; };
  let cand = findDates(hdr[2]); if (cand.length < 7) cand = findDates(hdr[1]);
  let best = [], run = [];
  for (const x of cand) { if (run.length && x.iso === addDays(run[run.length - 1].iso, 1) && x.c === run[run.length - 1].c + 1) run.push(x); else run = [x]; if (run.length > best.length) best = [...run]; }
  if (best.length < 7 || col.name == null) return null;
  // shift column = the one holding DAY / NIGHT values
  let shiftBest = 0;
  for (let c = 0; c < width; c++) {
    let n = 0; for (let r = hr + 1; r < Math.min(rows.length, hr + 60); r++) if (['DAY', 'NIGHT'].includes(norm(rows[r]?.[c]))) n++;
    if (n > shiftBest) { shiftBest = n; col.shift = c; }
  }
  if (shiftBest < 3) delete col.shift;
  const out = [];
  for (let r = hr + 1; r < rows.length; r++) {
    const row = rows[r] || []; const name = row[col.name];
    if (typeof name !== 'string' || !name.trim()) continue;
    const N = norm(name); if (N === 'NAME' || /PREPARED BY|REVIEWED BY|APPROVED BY|GRAND TOTAL/.test(N)) continue;
    const id = col.id != null ? row[col.id] : null;
    const cells = best.map(x => row[x.c]);
    const hasCodes = cells.some(v => v != null && String(v).trim() !== '');
    const shift = col.shift != null ? norm(row[col.shift]) : '';
    if (!id && !hasCodes && !['DAY', 'NIGHT'].includes(shift)) continue;
    out.push({ name: N, id: id == null ? '' : String(id), shift: ['DAY', 'NIGHT'].includes(shift) ? shift : '', doj: col.doj != null ? parseAnyDate(row[col.doj]) : null, trade: col.trade != null ? normTrade(row[col.trade]) : '', site: col.site != null ? norm(row[col.site]) : '', cells });
  }
  return { dates: best.map(x => x.iso), rows: out };
}

function applyMasterImport(parsed, overwrite) {
  const st = { created: 0, updated: 0, cells: 0, ended: 0 };
  const start = parsed.dates[0];
  for (const r of parsed.rows) {
    const { empCode, agency } = splitIdAgency(r.id);
    let e = findEmployee(empCode, r.name, agency);
    if (!e) {
      e = { id: uid('e'), empCode, name: r.name, agency, trade: r.trade || 'SECURITY GUARD', shift: r.shift || 'DAY', doj: r.doj, end: null, endReason: '', assign: [] };
      S.employees.push(e); IX.emp.set(e.id, e); st.created++;
    } else {
      st.updated++;
      if (r.trade) e.trade = r.trade; if (r.doj) e.doj = r.doj; if (r.shift) e.shift = r.shift;
      if (r.name && r.name !== e.name && empCode) e.name = r.name;
    }
    if (e.trade && !S.settings.trades.includes(e.trade)) S.settings.trades.push(e.trade);
    const siteId = r.site ? findOrCreateSite(r.site, null, st) : null;
    if (siteId) {
      const a = assignOn(e, start);
      const mapped = a && IX.site.get(a.site)?.projectId;   // allocation set from a client timesheet or by hand wins over the payroll label
      if (!a || (!mapped && a.site !== siteId) || (r.shift && a.shift !== r.shift)) {
        const from = !e.assign.length && e.doj && e.doj < start ? e.doj : start;
        setAssignment(e, from, mapped ? a.site : siteId, r.shift || a?.shift || e.shift);
      }
    }
    for (let i = 0; i < parsed.dates.length; i++) {
      const d = parsed.dates[i]; const raw = r.cells[i];
      const code = raw == null ? '' : normCode(raw);
      if (END_WORDS.includes(code)) {
        const last = addDays(d, -1);
        if (!e.end || e.end > last) { e.end = last; e.endReason = code; st.ended++; }
        for (let k = i; k < parsed.dates.length; k++) if (overwrite && S.att[e.id]) delete S.att[e.id][parsed.dates[k]];
        break;
      }
      if (!code || /^\d+(\.\d+)?$/.test(code) || code.startsWith('#')) { if (overwrite && !code && S.att[e.id]?.[d]) delete S.att[e.id][d]; continue; }
      if (!overwrite && S.att[e.id]?.[d]) continue;
      ensureCode(code, st);
      const cur = getCell(e.id, d);
      putCell(e.id, d, { c: code, s: cur?.s, sh: cur?.sh }); st.cells++;
    }
  }
  reindex();
  return st;
}

/* ---------- client timesheet workbook (one tab per project) ---------- */
/**
 * Client timesheet layouts:
 *  A) one project per sheet (SCL TR TIME SHEET): "PROJECT NAME" + "MONTH" labels above a SITE NAME header
 *  B) CLIENT TIME SHEET in the master workbook: header row PROJECT | SITE NAME | SHIFT | NAME | EMP. CODE | 1..31
 */
function parseClientSheet(rows) {
  let hr = -1, project = '', ym = null;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const row = rows[i] || [];
    row.forEach((v, c) => {
      const n = norm(v);
      if (n === 'PROJECT NAME' && !project && !row.some(x => norm(x) === 'SITE NAME')) project = norm(row.slice(c + 1).find(x => x != null && String(x).trim()));
      if (/^MONTH\b/.test(n) && !ym) ym = parseAnyMonth(n.replace(/^MONTH\s*:?\s*/, '')) || parseAnyMonth(row.slice(c + 1).find(x => x != null && String(x).trim()));
    });
    if (hr < 0 && row.some(v => norm(v) === 'SITE NAME')) hr = i;
  }
  if (hr < 0) return null;
  const h = rows[hr]; const col = { days: [] };
  h.forEach((v, c) => {
    const n = norm(v);
    if (n === 'SITE NAME') col.site = c; else if (n === 'PROJECT' || n === 'PROJECT NAME') col.project = c; else if (n.startsWith('SHIFT')) col.shift = c;
    else if (n === 'NAME') col.name = c; else if (/EMP/.test(n)) col.code = c;
    else if ((typeof v === 'number' || /^\d{1,2}$/.test(n)) && +n >= 1 && +n <= 31 && Number.isInteger(+n)) col.days.push({ c, day: +n });
  });
  if (col.name == null || col.days.length < 28) return null;
  if (col.project == null && !project) return null;
  const out = []; let site = '', proj = project;
  for (let r = hr + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    if (row.some(v => /PREPARED BY/.test(norm(v)))) break;
    if (col.project != null && norm(row[col.project]) && !/GRAND TOTAL|^TOTAL/.test(norm(row[col.project]))) { if (norm(row[col.project]) !== proj) site = ''; proj = norm(row[col.project]); }
    if (col.site != null && norm(row[col.site])) site = norm(row[col.site]);
    const name = norm(row[col.name]); if (!name || /GRAND TOTAL/.test(name)) continue;
    const cells = {};
    for (const { c, day } of col.days) { const v = row[c]; if (v != null && String(v).trim() !== '') cells[day] = normCode(v); }
    out.push({ project: proj, site, shift: norm(row[col.shift]), name, id: col.code != null ? String(row[col.code] ?? '') : '', cells });
  }
  return { project: project || null, multi: col.project != null, ym, rows: out, projects: [...new Set(out.map(r => r.project))] };
}

/** Billing client per project, following the groups in Trackers.xlsx → Tax Invoice Tracker (A SCL & Infra … H Factories) */
const CLIENT_RULES = [
  [/^KAIZEN\b/, 'KAIZEN OWNERS ASSOCIATION'],
  [/^(ASTECO|PROVIS)\b/, 'PROVIS OWNERS ASSOCIATION'],
  [/^SCM\b/, 'SOBHA COMMUNITY MANAGEMENT LLC'],
  [/^LFM\b|NURSERY/, 'LFM & LANDSCAPING'],
  [/^RAK\b/, 'SOBHA MODULAR - RAK'],
  [/FURNITURE INDUSTRIES/, 'SOBHA FURNITURE INDUSTRIES - KIZAD'],
  [/^(SOBHA REALTY|CRM|DEVELOPMENT|PNCA)\b/, 'SOBHA LLC'],
  [/^RELIEVER$|CRUSHER/, ''],
  [/./, 'SOBHA CONSTRUCTIONS LLC']
];
function clientForProjectName(name) {
  const hit = CLIENT_RULES.find(([re]) => re.test(norm(name))); if (!hit || !hit[1]) return '';
  let c = S.clients.find(x => norm(x.name) === hit[1]);
  if (!c) { c = { id: uid('c'), name: hit[1], customerCode: '', trn: '', address: '' }; S.clients.push(c); IX.client.set(c.id, c); }
  return c.id;
}
/** "Replace": a client timesheet is authoritative for the month for every worker on it – days on none of their rows are cleared */
function clearUntouched(tm, overwrite) {
  if (!overwrite) return;
  for (const [ym, touched] of tm) for (const [id, days] of touched) for (const d of monthDates(ym)) if (!days.has(d) && S.att[id]?.[d]) delete S.att[id][d];
}
/** Link payroll site labels (e.g. "THE CREST") to the client-timesheet project most of their workers are allocated to (e.g. "SCM THE CREST") */
function autoMapSites() {
  let n = 0;
  for (const site of S.sites.filter(x => !x.projectId)) {
    const votes = {}; let total = 0;
    for (const e of S.employees) {
      const i = (e.assign || []).findIndex(a => a.site === site.id); if (i < 0) continue;
      const later = e.assign.slice(i + 1).find(a => IX.site.get(a.site)?.projectId); if (!later) continue;
      const pid = IX.site.get(later.site).projectId; votes[pid] = (votes[pid] || 0) + 1; total++;
    }
    const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] / total >= 0.6) { site.projectId = best[0]; n++; }
  }
  reindex(); return n;
}
/** Remove unmapped sites nobody uses any more (payroll labels replaced by client-timesheet sites) */
function pruneSites() {
  const used = new Set();
  for (const e of S.employees) for (const a of e.assign || []) used.add(a.site);
  for (const k in S.att) for (const d in S.att[k]) { const v = S.att[k][d]; if (typeof v === 'object' && v.s) used.add(v.s); }
  const before = S.sites.length; S.sites = S.sites.filter(x => x.projectId || used.has(x.id)); reindex(); return before - S.sites.length;
}

function applyClientImport(parsed, overwrite, ymOverride, shared) {
  const st = { created: 0, cells: 0, conflicts: 0 };
  const ym = parsed.ym || ymOverride;
  st.ym = ym; if (!ym) throw new Error('Month missing for ' + (parsed.project || 'client timesheet'));
  const lastReal = {}, seen = shared?.seen || new Set();
  const tm = shared?.touched || new Map(); if (!tm.has(ym)) tm.set(ym, new Map()); const touched = tm.get(ym);
  for (const r of parsed.rows) {
    if (!r.project) continue;
    const proj = findOrCreateProject(r.project, st);
    if (!proj.clientId) proj.clientId = clientForProjectName(proj.name);
    const rel = /RELIEVER|RELEIVER/.test(r.site);
    const siteId = rel ? (lastReal[proj.id] || findOrCreateSite(r.project, proj.id, st)) : findOrCreateSite(r.site || r.project, proj.id, st);
    if (!rel) lastReal[proj.id] = siteId;
    const { empCode, agency } = splitIdAgency(r.id);
    let e = findEmployee(empCode, r.name, agency);
    const shift = ['DAY', 'NIGHT'].includes(r.shift) ? r.shift : '';
    if (!e) {
      const trade = /CCTV/.test(r.site) ? 'CCTV OPERATOR' : /TEAM LEADER/.test(r.site) ? 'TEAM LEADER' : /SUPERVISOR/.test(r.site) ? 'SECURITY SUPERVISOR' : 'SECURITY GUARD';
      e = { id: uid('e'), empCode, name: r.name, agency, trade, shift: shift || 'DAY', doj: null, end: null, endReason: '', assign: [] };
      S.employees.push(e); IX.emp.set(e.id, e); st.created++;
    }
    if (!rel && assignOn(e, ym + '-01')?.site !== siteId && !seen.has(e.id)) setAssignment(e, ym + '-01', siteId, shift || e.shift);
    if (!rel) seen.add(e.id);
    for (const [day, raw] of Object.entries(r.cells).sort((a, b) => +a[0] - +b[0])) {
      if (/^\d+(\.\d+)?$/.test(raw) || raw.startsWith('#') || +day > dim(ym)) continue;
      const d = `${ym}-${pad(day)}`;
      if (END_WORDS.includes(raw)) { const last = addDays(d, -1); if (!e.end || e.end > last) { e.end = last; e.endReason = raw; st.ended = (st.ended || 0) + 1; } break; }
      const code = rel && raw === 'P' ? 'R' : raw;
      if (touched.get(e.id)?.has(d) && codeDef(getCell(e.id, d)?.c).billable && codeDef(code).billable) {
        (st.double ||= []).push(`${e.name} ${fmtDMY(d)}: ${IX.site.get(siteOn(e, d))?.name || '?'} / ${r.site || r.project}`);
      }
      const prev = getCell(e.id, d);
      if (!overwrite && prev) continue;
      if (prev && prev.c !== code && !touched.get(e.id)?.has(d)) st.conflicts++;
      ensureCode(code, st);
      const a = assignOn(e, d);
      putCell(e.id, d, { c: code, s: siteId !== a?.site ? siteId : undefined, sh: shift && shift !== (a?.shift || e.shift) ? shift : undefined });
      (touched.get(e.id) || touched.set(e.id, new Set()).get(e.id)).add(d);
      st.cells++;
    }
    if (!touched.has(e.id)) touched.set(e.id, new Set());
  }
  if (!shared) clearUntouched(tm, overwrite);
  reindex();
  return st;
}

/** One entry point: detects master-attendance sheets and client-timesheet sheets in any workbook. */
async function importExcel(file) {
  const wb = await readWorkbook(file);
  const found = [];
  wb.SheetNames.forEach((n, i) => {
    const rows = sheetRows(wb, n), hidden = isHidden(wb, i);
    const m = parseMasterSheet(rows);
    if (m && m.rows.length) { found.push({ n, hidden, type: 'master', p: m, info: `${m.rows.length} workers · ${fmtDMY(m.dates[0])} – ${fmtDMY(m.dates[m.dates.length - 1])}` }); return; }
    const c = parseClientSheet(rows);
    if (c && c.rows.length) found.push({ n, hidden, type: 'client', p: c, info: `${c.multi ? c.projects.length + ' projects' : c.project} · ${c.ym ? fmtMonYY(c.ym) : 'month not in sheet'} · ${c.rows.length} rows` });
  });
  if (!found.length) { toast('No attendance found in this file. It needs a NAME column and a row of dates (master sheet), or PROJECT NAME + MONTH + SITE NAME (client timesheet).', 7000); return; }
  const master = found.find(f => f.type === 'master');
  const defYm = master ? ymOf(master.p.dates[master.p.dates.length - 1]) : addMonths(ymOf(todayISO()), -1);
  openModal('Import Excel', `
    <p style="margin-top:0"><b>${esc(file.name)}</b> – tick the sheets to import.</p>
    <table class="t"><thead><tr><th></th><th>Sheet</th><th>Type</th><th>Contents</th></tr></thead><tbody>
    ${found.map((f, k) => `<tr><td><input type="checkbox" data-sh="${k}" ${f.hidden ? '' : 'checked'}></td><td><b>${esc(f.n)}</b>${f.hidden ? ' <span class="tag">hidden</span>' : ''}</td>
      <td><span class="tag ${f.type === 'master' ? 'ok' : ''}">${f.type === 'master' ? 'Master attendance' : 'Client timesheet'}</span></td><td class="small">${esc(f.info)}${f.type === 'client' ? `<div class="row" style="margin-top:4px"><span class="muted">Month:</span><input type="month" data-ym="${k}" value="${f.p.multi && master ? defYm : (f.p.ym || defYm)}">${f.p.ym && f.p.multi && master && f.p.ym !== defYm ? `<span class="tag warn">sheet says ${fmtMonYY(f.p.ym)} – check</span>` : ''}</div>` : ''}</td></tr>`).join('')}
    </tbody></table>
    <label class="chk" style="margin-top:12px"><input type="checkbox" id="im-ow" checked> Replace attendance already entered for the same days</label>`,
    [{ label: 'Cancel' }, {
      label: 'Import', cls: 'pri', onClick: m => {
        const ow = $('#im-ow', m).checked; const t = { created: 0, cells: 0, ended: 0, newSites: 0, newProjects: 0, conflicts: 0 }; const dbl = []; const shared = { touched: new Map(), seen: new Set() }; const codes = new Set(); let lastMaster = null;
        m.querySelectorAll('[data-sh]:checked').forEach(c => {
          const f = found[+c.dataset.sh];
          const r = f.type === 'master' ? applyMasterImport(f.p, ow) : applyClientImport({ ...f.p, ym: m.querySelector(`[data-ym="${c.dataset.sh}"]`)?.value || f.p.ym }, ow, null, shared);
          for (const k in t) t[k] += r[k] || 0; r.newCodes?.forEach(x => codes.add(x)); if (r.double) dbl.push(...r.double);
          if (f.type === 'master' && (!lastMaster || f.p.dates.at(-1) > lastMaster.dates.at(-1))) lastMaster = f.p;
        });
        clearUntouched(shared.touched, ow);
        if (m.querySelector('[data-sh]:checked') && found.some((f, k) => f.type === 'client' && m.querySelector(`[data-sh="${k}"]`)?.checked)) S.issues = { at: new Date().toISOString(), double: dbl.slice(0, 2000) };
        const pruned = pruneSites(), autoMapped = autoMapSites();
        if (lastMaster) { AV.ym = cycleOfDate(lastMaster.dates[lastMaster.dates.length - 1]); AV.mode = 'payroll'; }
        markDirty(); renderAll();
        const unm = S.sites.filter(x => !x.projectId).length;
        openModal('Import complete', `<div class="kpis">${[['Workers added', t.created], ['Days written', t.cells], ['End dates set', t.ended], ['New sites', t.newSites], ['New projects', t.newProjects]].map(([k, v]) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')}</div>
          ${dbl.length ? `<div class="alert"><div><b>${dbl.length} person-day(s) are billed on two rows for the same day</b> in the client timesheet – the tracker keeps the later row. Check these in the source sheet:<div class="small" style="max-height:120px;overflow:auto;margin-top:4px">${dbl.slice(0, 200).map(esc).join('<br>')}</div></div></div>` : ''}
          ${t.conflicts ? `<div class="alert info">${t.conflicts} day(s) differed between the payroll sheet and the client timesheet – the client timesheet was used for client billing.</div>` : ''}
          ${autoMapped ? `<p>${autoMapped} payroll site label(s) were linked automatically to the client-timesheet project most of their workers belong to.</p>` : ''}
          ${codes.size ? `<p>New codes added as <b>not billable</b>: ${[...codes].map(esc).join(', ')} (change in Settings).</p>` : ''}
          ${unm ? `<div class="alert">${unm} site(s) are not linked to a project yet. Link them so they appear on client timesheets and invoices.</div>` : ''}`,
          unm ? [{ label: 'Later' }, { label: 'Link sites now', cls: 'pri', onClick: () => showView('projects') }] : [{ label: 'OK', cls: 'pri' }]);
        return false;
      }
    }]);
}

/* ---------- Excel export (styled, via ExcelJS) ---------- */
const argb = hex => 'FF' + String(hex || '#FFFFFF').replace('#', '').toUpperCase().padEnd(6, 'F').slice(0, 6);
const thin = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
const colL = n => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
function billFormula(range) { return S.codes.filter(c => c.billable).map(c => `COUNTIF(${range},"${c.code}")`).join('+') || '0'; }

async function exportTimesheetsXlsx(list) {
  await loadScript(LIB.exceljs);
  const wb = new ExcelJS.Workbook(); const used = new Set(); const st = S.settings;
  for (const ts of list) {
    const p = IX.proj.get(ts.projectId);
    let nm = (p?.name || 'Project').replace(/^SCL\s*(TR)?\s*-\s*/i, '').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Sheet';
    let k = 2; const base = nm; while (used.has(nm.toUpperCase())) nm = (base.slice(0, 28) + ' ' + k++); used.add(nm.toUpperCase());
    const ws = wb.addWorksheet(nm, { pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    const N = ts.days, C0 = 5, CT = C0 + N; // 1-based columns: B site, C shift, D name, E code, F.. days, total
    ws.getColumn(1).width = 2; ws.getColumn(2).width = 26; ws.getColumn(3).width = 8; ws.getColumn(4).width = 34; ws.getColumn(5).width = 16;
    for (let i = 0; i < N; i++) ws.getColumn(C0 + 1 + i).width = 3.6; ws.getColumn(CT + 1).width = 9;
    // Same cell positions as the LS/DO/F-026 workbook: header rows 2-4, legend AI6:AJ9, MONTH row 8, PROJECT row 10, table from row 13
    ws.getCell('B2').value = st.companyShort; ws.getCell('B2').font = { bold: true, size: 14 };
    ws.getCell('B3').value = st.tsTitle; ws.getCell('B3').font = { bold: true, size: 11 };
    ws.getCell('B4').value = `Form No: ${st.formNo}`; ws.getCell('I4').value = `REV NO: ${st.revNo}`; ws.getCell(4, CT - 8).value = `DATE : ${st.formDate}`;
    TS_LEGEND.forEach(([a, b], i) => { const c1 = ws.getCell(6 + i, CT), c2 = ws.getCell(6 + i, CT + 1); c1.value = a; c2.value = b; c1.border = c2.border = thin; c1.font = { bold: true }; });
    const [yy, mm] = ts.ym.split('-').map(Number);
    ws.getCell('B8').value = 'MONTH'; ws.getCell('C8').value = new Date(Date.UTC(yy, mm - 1, 1)); ws.getCell('C8').numFmt = 'mmm-yy'; ws.getCell('C8').alignment = { horizontal: 'left' }; ws.getCell('B8').font = { bold: true };
    ws.getCell('B10').value = 'PROJECT NAME'; ws.getCell('C10').value = p?.name || ''; ws.getCell('B10').font = { bold: true };
    const HR = 13;
    const head = ['SITE NAME', 'SHIFT D/N', 'NAME', 'EMP. CODE', ...Array.from({ length: N }, (_, i) => i + 1), 'TOTAL DAYS'];
    head.forEach((v, i) => { const c = ws.getCell(HR, 2 + i); c.value = v; c.font = { bold: true }; c.border = thin; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }; });
    const pCodes = S.codes.filter(c => c.billable && c.code !== 'R').map(c => c.code);
    let r = HR + 1;
    for (const sec of ts.sections) {
      const r0 = r;
      for (const row of sec.rows) {
        ws.getCell(r, 2).value = r === r0 ? sec.name : null;
        ws.getCell(r, 3).value = row.shift; ws.getCell(r, 4).value = row.emp.name; ws.getCell(r, 5).value = empCodeLabel(row.emp);
        for (let d = 1; d <= N; d++) { const code = row.cells[d]; const c = ws.getCell(r, C0 + d); c.value = code && codeDef(code).client ? (code === 'OFF' ? 'O' : code) : null; c.alignment = { horizontal: 'center' }; }
        const rg = `${colL(C0)}${r}:${colL(C0 + N - 1)}${r}`;
        // template: =COUNTIF(F14:AI14,"P") for site rows, "R" for reliever rows
        const f = (sec.id === '__REL' ? ['R'] : pCodes).map(k => `COUNTIF(${rg},"${k}")`).join('+') || '0';
        ws.getCell(r, CT + 1).value = { formula: f, result: row.total };
        for (let c = 2; c <= CT + 1; c++) ws.getCell(r, c).border = thin;
        ws.getCell(r, CT + 1).font = { bold: true }; ws.getCell(r, CT + 1).alignment = { horizontal: 'center' };
        r++;
      }
      if (r - 1 > r0) ws.mergeCells(r0, 2, r - 1, 2);
      const sc = ws.getCell(r0, 2); sc.font = { bold: true }; sc.alignment = { vertical: 'middle', wrapText: true };
    }
    ws.getCell(r, CT - 3).value = 'GRAND TOTAL'; ws.getCell(r, CT - 3).font = { bold: true };
    ws.getCell(r, CT + 1).value = { formula: `SUM(${colL(CT)}${HR + 1}:${colL(CT)}${Math.max(HR + 1, r - 1)})`, result: ts.total };
    ws.getCell(r, CT + 1).font = { bold: true }; ws.getCell(r, CT + 1).border = thin; ws.getCell(r, CT + 1).alignment = { horizontal: 'center' };
    r++;
    // signatories: labels B, D, I, R, AC; "name title" in one cell below
    const spots = [2, 4, 9, 18, 29];
    st.signatories.forEach((s, i) => { const c = Math.min(spots[i] || 2 + i * 6, CT); ws.getCell(r, c).value = s.label; ws.getCell(r, c).font = { bold: true }; ws.getCell(r + 1, c).value = ' ' + [s.name, s.title].filter(Boolean).join(' ') + ' '; ws.getCell(r + 1, c).alignment = { wrapText: true, vertical: 'top' }; });
    ws.getRow(r + 1).height = 45;
    ws.views = [{ state: 'frozen', ySplit: HR }];
  }
  const buf = await wb.xlsx.writeBuffer();
  const c = TV.client ? IX.client.get(TV.client)?.name + ' ' : '';
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${c}TIME SHEET - ${fmtMonthName(list[0].ym).replace('-', ' ')}.xlsx`);
}

async function exportMasterXlsx() {
  if (!AV.rows.length) { toast('Nothing to export'); return; }
  await loadScript(LIB.exceljs);
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('LS-PAYROLL ATTENDENCE', { pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const D = AV.dates, C0 = 8;
  const { start, end } = attPeriod();
  ws.getCell('A1').value = `${S.settings.companyShort} MASTER PAYROLL ATTENDANCE MONTH OF ${fmtMonthName(AV.ym)}`; ws.getCell('A1').font = { bold: true, size: 13 };
  // template rows: 3 = MONTH / PREPARED BY, 4 = D.O.J TRADE PROJECT + weekdays + TOTAL, 5 = S.NO EMP NO NAME EMP ID NO + dates, data from 6
  ws.getCell('E3').value = 'MONTH'; ws.getCell('F3').value = `${fmtDMY(start)} TO ${fmtDMY(end)}`;
  ws.getCell(3, C0 + 9).value = 'PREPARED BY OPERATION'; ws.getCell(3, C0 + 14).value = S.settings.preparedBy; ws.getCell(3, C0 + 21).value = 'REVIEWED BY';
  ['D.O.J', 'TRADE', 'PROJECT'].forEach((h, i) => ws.getCell(4, 5 + i).value = h);
  ['S.NO', 'EMP NO', 'NAME', 'EMP ID NO'].forEach((h, i) => ws.getCell(5, 1 + i).value = h);
  D.forEach((d, j) => { ws.getCell(4, C0 + j).value = WD[weekday(d)]; const c = ws.getCell(5, C0 + j); const [y, m, dd] = d.split('-').map(Number); c.value = new Date(Date.UTC(y, m - 1, dd)); c.numFmt = 'yyyy-mm-dd'; });
  ws.getCell(4, C0 + D.length).value = ' T0TAL ';
  for (let c = 1; c <= C0 + D.length; c++) for (const r of [4, 5]) { const x = ws.getCell(r, c); x.font = { bold: true }; x.border = thin; x.alignment = { horizontal: 'center', vertical: 'middle', textRotation: r === 5 && c >= C0 && c < C0 + D.length ? 90 : 0 }; x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }; }
  ws.getColumn(1).width = 6; ws.getColumn(2).width = 8; ws.getColumn(3).width = 38; ws.getColumn(4).width = 12; ws.getColumn(5).width = 11; ws.getColumn(6).width = 18; ws.getColumn(7).width = 26;
  D.forEach((_, j) => ws.getColumn(C0 + j).width = 4.6); ws.getRow(5).height = 62;
  AV.rows.forEach((row, i) => {
    const r = 6 + i, e = row.emp;
    [i + 1, row.shift, e.name, empCodeLabel(e), e.doj ? fmtDMY(e.doj) : '', e.trade, siteName(row.lastSite)].forEach((v, k) => { ws.getCell(r, k + 1).value = v; ws.getCell(r, k + 1).border = thin; });
    let endMarked = false;
    D.forEach((d, j) => {
      const x = ws.getCell(r, C0 + j); x.border = thin; x.alignment = { horizontal: 'center' };
      if (!employedOn(e, d)) { if (e.end && d > e.end && !endMarked) { x.value = e.endReason || 'LEFT'; endMarked = true; } return; }
      const c = getCell(e.id, d); if (!c) return;
      x.value = c.c; x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(codeDef(c.c).color) } };
      if (c.s && c.s !== assignOn(e, d)?.site) x.note = 'Worked at ' + siteName(c.s);
    });
    const rg = `${colL(C0 - 1)}${r}:${colL(C0 + D.length - 2)}${r}`;
    ws.getCell(r, C0 + D.length).value = { formula: `COUNTIF(${rg},"P")` };
    ws.getCell(r, C0 + D.length).border = thin;
  });
  ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 5 }];
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${S.settings.companyShort} MASTER PAYROLL ATTENDANCE MONTH OF ${fmtMonthName(AV.ym)}.xlsx`);
}
