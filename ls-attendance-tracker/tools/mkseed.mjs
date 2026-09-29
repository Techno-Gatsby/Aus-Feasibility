// Builds src/00-seed.js from the LS workbooks by running the app's own importer headlessly.
// usage: node tools/mkseed.mjs <dir with real-master.xlsx real-scl.xlsx real-trackers.xlsx> [--dry]
import { chromium } from 'playwright'; import fs from 'fs'; import path from 'path';
const dir = path.resolve(process.argv[2] || '.'), dry = process.argv.includes('--dry');
const root = new URL('..', import.meta.url).pathname;
const libs = { 'xlsx.full.min.js': 'node_modules/xlsx/dist/xlsx.full.min.js', 'exceljs.min.js': 'node_modules/exceljs/dist/exceljs.min.js', 'pdf-lib.min.js': 'node_modules/pdf-lib/dist/pdf-lib.min.js' };
const b = await chromium.launch(); const ctx = await b.newContext();
await ctx.route('https://cdn.jsdelivr.net/**', r => { const f = Object.keys(libs).find(k => r.request().url().endsWith(k)); return f ? r.fulfill({ path: path.join(dir, libs[f]), contentType: 'application/javascript' }) : r.abort(); });
const pg = await ctx.newPage(); pg.on('pageerror', e => console.log('PAGE ERROR', e.message));
await pg.goto('file://' + path.join(root, 'Attendance Tracker.html').replace(/ /g, '%20')); await pg.waitForTimeout(300);
const b64 = f => fs.readFileSync(path.join(dir, f)).toString('base64');
const out = await pg.evaluate(async ({ master, scl, trk }) => {
  S = migrate(defaultState()); reindex();
  await loadScript(LIB.xlsx);
  const read = s => XLSX.read(Uint8Array.from(atob(s), c => c.charCodeAt(0)), { type: 'array' });
  const log = [];
  // 1. master workbook (payroll + CLIENT TIME SHEET + SUB-CONTRACTORS), then SCL TR workbook
  for (const [name, s] of [['master', master], ['scl', scl]]) {
    const found = detectSheets(read(s));
    const m = found.find(f => f.type === 'master'); const defYm = m ? ymOf(m.p.dates.at(-1)) : null;
    const picks = found.map((f, k) => f.hidden ? null : { k, ym: f.type === 'client' ? (f.p.multi && m ? defYm : f.p.ym || defYm) : undefined }).filter(Boolean);
    const r = runImport(found, picks, true);
    log.push(`${name}: ${found.length} sheets, ${picks.length} imported, ${JSON.stringify(r.t)}, double ${r.dbl.length}, unlinked ${r.unm}`);
  }
  // 2. billing structure from Trackers.xlsx → Tax Invoice Tracker (client groups A–H) + legal names from the summary sheet
  const wb = read(trk); const rows = XLSX.utils.sheet_to_json(wb.Sheets['Tax Invoice Tracker'], { header: 1, defval: null });
  const GROUP = { 'SCL & INFRA': 'SOBHA CONSTRUCTIONS LLC', 'SOBHA LLC': 'SOBHA LLC', 'PROVIS OWNERS ASSOCIATION': 'PROVIS OWNERS ASSOCIATION MANAGEMENT SERVICES LLC', 'KAIZEN OWNERS ASSOCIATION': 'KAIZEN OWNERS ASSOCIATION MANAGEMENT SERVICES LLC', 'SOBHA COMMUNITY MANAGEMENT': 'SOBHA COMMUNITY MANAGEMENT LLC', 'LFM & LANDSCAPING': 'LFM & LANDSCAPING', 'AL SINIYA ISLAND': 'AL SINIYA ISLAND', 'FACTORIES': 'FACTORIES' };
  const RENAME = { 'PROVIS OWNERS ASSOCIATION': GROUP['PROVIS OWNERS ASSOCIATION'], 'KAIZEN OWNERS ASSOCIATION': GROUP['KAIZEN OWNERS ASSOCIATION'] };
  for (const c of S.clients) if (RENAME[c.name]) c.name = RENAME[c.name];
  const client = n => { let c = S.clients.find(x => x.name === n); if (!c) { c = { id: uid('c'), name: n, customerCode: '', trn: '', address: '' }; S.clients.push(c); } return c; };
  // attendance names → tracker billing lines. Loose key: entity words dropped, known short forms expanded.
  const ALIAS = { GPH: 'GREENS PHASE', CVH: 'CREEK VISTA HEIGHTS', HEAVEN: 'HAVEN', TECHNOPARK: 'TECHNO PARK FACTORY', ADMIN: 'ADMINISTRATION', "TR'S": 'TR', SUPERVISORS: 'SUPERVISOR', JABEL: 'JEBEL', QOUZ: 'QUOZ', KHWANEEJ: 'KHAWANEEJ', SONAPURE: 'SONAPUR' };
  const DROP = new Set(['SCL', 'SCM', 'KAIZEN', 'ASTECO', 'PROVIS', 'SOBHA', 'COMMUNITY', 'MANAGEMENT', 'LATINEM', 'LANDSCAPING', 'PROJECTS', 'BY', 'THE', 'AND', 'OFFICE', 'FACTORY', 'INDUSTRY', 'INDUSTRIES', 'SECURITY', 'NEW', 'UNDER', 'LV', 'MARKETING', 'TR']);
  const FIX = { 'DEVELOPMENT': 'DEVELOPMENT REALTY', 'SCL VILLAS': 'VILLA PHASE 3 4 INVESTMENT VILLA', 'SCL ADMIN PMO': 'H2 PMO', 'SCL S TOWER': 'TOWER', 'SCM S TOWER': 'S TOWER', 'DIP TR\'S': 'DIP TR 1', 'UNDER CONSTRUCTION JABEL ALI TR': 'JEBEL ALI CONSTRUCTION', 'SCL SUPERVISOR': 'SUPERVISOR SCL', "TR'S SUPERVISOR": 'TR SUPERVISOR', 'INFRA NURSERY SHARJAH': 'NURSERY', 'SCM WAVES 1': 'WAVES', 'RAK': 'MODULAR RAK', 'FURNITURE INDUSTRY KIZAD JEBEL ALI TR': 'KIZAD JEBEL ALI TR', 'SCL P & M': 'P&M', 'SCL CENTRAL STORE': 'CENTRAL STORE', 'SCL ERT-1': 'ERT 1', 'SCL ERT-2': 'ERT 2' };
  const TFIX = { 'SECURITY SUPERVISOR - SCL': 'SUPERVISOR SCL', 'TR- SUPERVISOR': 'TR SUPERVISOR', 'JEBEL ALI TR - NEW CONSTRUCTION': 'JEBEL ALI CONSTRUCTION', 'SOBHA TOWER': 'TOWER', 'SOBHA COMMUNITY MANAGEMENT - S TOWER': 'S TOWER', 'H2 PMO OFFICE': 'H2 PMO', 'P&M': 'P&M', 'ERT-1': 'ERT 1', 'ERT-2': 'ERT 2', 'DIC LV 2 TR': 'DIC 2', 'DIC LV 3 TR': 'DIC 3', 'DIC LV 5 TR': 'DIC 5', 'CENTRAL STORE': 'CENTRAL STORE' };
  const loose = (name, fix) => { const n = norm(name).replace(/\([^)]*\)/g, ' '); if (fix[n]) return fix[n].split(' ').sort().join(' '); return [...new Set(n.replace(/&/g, ' ').replace(/[^A-Z0-9']+/g, ' ').split(' ').map(x => ALIAS[x] || x).join(' ').split(' ').filter(x => x && !DROP.has(x)).map(x => x.replace(/^0+(\d)/, '$1')))].sort().join(' '); };
  let grp = null; const unmatched = [], matched = [];
  const byLoose = new Map(); for (const p of S.projects) { const k = loose(p.name, FIX); (byLoose.get(k) || byLoose.set(k, []).get(k)).push(p); }
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]; const sl = r[1], name = r[2] && String(r[2]).replace(/\s+/g, ' ').trim(); if (!name) continue;
    if (typeof sl === 'string' && /^[A-Z]$/.test(sl)) { grp = GROUP[norm(name)] || norm(name); if (grp !== 'FACTORIES') client(grp); continue; }
    if (!grp) continue;
    const k = loose(name, TFIX); const hits = byLoose.get(k) || [];
    const cn = grp === 'FACTORIES' ? (/RAK/.test(norm(name)) ? 'SOBHA MODULAR - RAK' : 'SOBHA FURNITURE INDUSTRIES - KIZAD') : grp;
    if (hits.length) { for (const p of hits) { p.clientId = client(cn).id; p.trackerName = name; } matched.push(name + ' = ' + hits.map(p => p.name).join(' / ')); }
    else unmatched.push(name);
  }
  // SCL - ELWOOD - INFRA, Jan–May 2026, transcribed from the signed timesheets in Tax Invoice_Elwood Infra-January to May 2026.pdf (pages 3–7)
  {
    const INF = 'INFRA OFFICE', GATE = 'GATE NO 1 (MAIN ENTRANCE)';
    const EL = {
      '2026-01': [[INF, 'DAY', 'ANEESH DOMINIC', 'C52392', '1-13,15-31'], [INF, 'NIGHT', 'HARIKUMAR', 'C80453', '1-31'], [GATE, 'DAY', 'AJEESH MANIRAJ', 'C49692', '1-2'], [GATE, 'DAY', 'DEEPAK MOHANAN JANTHA MOHANAN', 'C84306', '3-20,22-31'], [GATE, 'NIGHT', 'RAJNISH KUMAR RAM LAL', 'C37234', '1-14'], [GATE, 'NIGHT', 'NABEEL MOHAMED PAKKER MYDEEN', 'C52293', '15-31'], [INF, 'DAY', 'KRISHNAKUMAR GOKULKUMAR GOKULKUMAR NRAYANA SHENOY', 'C81088', '14', 'R'], [GATE, 'DAY', 'KRISHNAKUMAR GOKULKUMAR GOKULKUMAR NRAYANA SHENOY', 'C81088', '21', 'R']],
      '2026-02': [[INF, 'DAY', 'ANEESH DOMINIC', 'C52392', '1-28'], [INF, 'NIGHT', 'HARIKUMAR', 'C80453', '1-15'], [INF, 'NIGHT', 'ARSHPREET SINGH RANJIT SINGH', 'C83436', '16-28'], [GATE, 'DAY', 'DEEPAK MOHANAN JANTHA MOHANAN', 'C84306', '1-28'], [GATE, 'NIGHT', 'NABEEL MOHAMED PAKKER MYDEEN', 'C52293', '1-28']],
      '2026-03': [[INF, 'DAY', 'ANEESH DOMINIC', 'C52392', '1-11'], [INF, 'DAY', 'BIR BAHADUR', 'SUBCON (INTEGRA)', '12-27'], [INF, 'DAY', 'VIKASH SIYAK RICHHPAL SIYAK', 'C36251', '28-31'], [INF, 'NIGHT', 'AGENDIA VLAVIDIKOS', 'SUBCON (AFF)', '1-31'], [GATE, 'DAY', 'PRATHEEK JAGADEESH', 'C66585', '1-31'], [GATE, 'NIGHT', 'SUSHANTH JAYA POOJARY', 'C83541', '1-31']],
      '2026-04': [[INF, 'DAY', 'VIKASH SIYAK RICHHPAL SIYAK', 'C36251', '1-30'], [INF, 'NIGHT', 'AGENDIA VLAVIDIKOS', 'SUBCON (AFF)', '1-9'], [INF, 'NIGHT', 'PRAVEEN RAJENDRAN SUKUMARI RAJENDRA K', 'C80749', '10-30'], [GATE, 'DAY', 'PRATHEEK JAGADEESH', 'C66585', '1-30'], [GATE, 'NIGHT', 'SUSHANTH JAYA POOJARY', 'C83541', '1-30']],
      '2026-05': [[INF, 'DAY', 'VIKASH SIYAK RICHHPAL SIYAK', 'C36251', '1-5'], [INF, 'DAY', 'AJI PHILIP JON JHON PHILIP', 'C74946', '7-31'], [INF, 'NIGHT', 'SUSHANTH JAYA POOJARY', 'C83541', '1-31'], [GATE, 'DAY', 'PRATHEEK JAGADEESH', 'C66585', '1-31'], [GATE, 'NIGHT', 'PRAVEEN RAJENDRAN SUKUMARI RAJENDRA K', 'C80749', '1-11,15-31'], [INF, 'DAY', 'RAKESH KUMAR MAKHAN LAL', 'C41976', '6', 'R'], [GATE, 'NIGHT', 'JASBIR SINGH HARBHAJAN SINGH', 'C64887', '12-14', 'R']]
    };
    let el = S.projects.find(p => /ELWOOD/.test(p.name) && /INFRA/.test(p.name));
    if (!el) { el = { id: uid('p'), name: 'SCL - ELWOOD - INFRA', active: true }; S.projects.push(el); }
    Object.assign(el, { name: 'SCL - ELWOOD - INFRA', clientId: client('SOBHA CONSTRUCTIONS LLC').id, trackerName: 'Infra- Sobha Elwood', code: '104N135', poNo: 'INS-104N135-26-0002', woNo: 'LOR-104N135-24-0001', sapName: 'SOBHA ELWOOD INFRASTRUCTURE', orderCode: '3020110P047', tsOff: 'OFF', tsNoAck: true,
      entityName: 'SOBHA CONSTRUCTIONS LLC (ELWOOD INFRASTRUCTURE @ Al Yufrah)', billing: { basis: 'fixed', rate: 4100, vat: 0, posts: 4, unit: 'Security', rates: {} } });   // WOI: 4,100 / guard / month; invoice: 4 Security @ N Days
    reindex();
    const siteId = {}; for (const n of [INF, GATE]) { let x = S.sites.find(y => y.projectId === el.id && y.name === n); if (!x) { x = { id: uid('s'), projectId: el.id, name: n }; S.sites.push(x); } siteId[n] = x.id; }
    reindex();
    const days = (spec, ym) => spec.split(',').flatMap(r => { const [a, b] = r.split('-').map(Number); return Array.from({ length: (b || a) - a + 1 }, (_, i) => `${ym}-${pad(a + i)}`); });
    let added = 0, found = 0;
    for (const [ym, rows] of Object.entries(EL)) for (const [site, shift, name, id, spec, code] of rows) {
      const { empCode, agency } = splitIdAgency(id);
      let e = findEmployee(empCode, name, agency);
      if (!e) { e = { id: uid('e'), empCode, name, agency, trade: 'SECURITY GUARD', shift, doj: null, end: null, endReason: '', assign: [] }; S.employees.push(e); IX.emp.set(e.id, e); e._elwood = true; added++; } else if (!e._seen) { found++; e._seen = 1; }
      for (const d of days(spec, ym)) (S.att[e.id] ||= {})[d] = { c: code || 'P', s: siteId[site], sh: shift, ...(norm(e.name) !== name ? { n: name } : {}) };   // keep the name as written on the sheet
      if (e._elwood) { e._last = !e._last || days(spec, ym).at(-1) > e._last ? days(spec, ym).at(-1) : e._last; if (!e.assign.length) e.assign.push({ from: days(spec, ym)[0], site: siteId[site], shift }); }
    }
    // workers only on the Elwood sheets (not on the Jun–Jul payroll): allocation ends with their last day on those sheets
    for (const e of S.employees) { if (e._elwood) { e.end = e._last; e.endReason = 'LAST ON ELWOOD SHEET'; } delete e._elwood; delete e._last; delete e._seen; }
    log.push(`elwood: ${added} workers added, ${found} already on payroll`);
    reindex();
    const chk = Object.keys(EL).map(m => m + '=' + buildTimesheet(el.id, m).total).join(' ');
    log.push('elwood totals ' + chk);
  }
  S.clients = S.clients.filter(c => S.projects.some(p => p.clientId === c.id));
  reindex();
  // 3. known SAP data: Elwood (from the tax invoice pack) and Waves (Trackers → Waves-SCM)
  const el = S.projects.find(p => /ELWOOD/.test(p.name) && /INFRA/.test(p.name));

  const wv = S.projects.filter(p => /WAVES/.test(p.name) && !/GRANDE|OPULENCE/.test(p.name)).sort((a, b) => a.name.length - b.name.length)[0];
  const scm = client('SOBHA COMMUNITY MANAGEMENT LLC');
  if (wv) { wv.code = '110P016'; wv.clientId = scm.id; wv.billing = { basis: 'lump', rate: 32795, vat: 0, posts: 0, unit: 'Security', rates: {} }; }
  const sclC = client('SOBHA CONSTRUCTIONS LLC'); sclC.address = 'SOBHA SAPPHIRE,13TH FLOOR,AL KHAIL ROAD,BUSINESS BAY\nDUBAI,25654\nUnited Arab Emirates'; sclC.trn = '100551377300003';   // as on invoice 2026-0900000689
  // 4. invoice history: Waves-SCM sheet (38 invoices) + the Elwood Jan–May 2026 invoice
  const xd = v => typeof v === 'number' ? parseAnyDate(v) : (parseAnyDate(v) || null);
  const ws = XLSX.utils.sheet_to_json(wb.Sheets['Waves-SCM'], { header: 1, defval: null });
  const hr = ws.findIndex(r => r[0] === 'Sl.No');
  for (let i = hr + 1; i < ws.length; i++) {
    const r = ws[i]; if (typeof r[0] !== 'number' || !r[1]) continue;
    const ym = xd(r[2])?.slice(0, 7); if (!ym) continue;
    const amt = +r[9] || 0, paid = +r[10] || 0, status = String(r[12] || '');
    S.invoices.push({ id: uid('i'), no: String(r[1]), date: xd(r[3]) || '', clientId: scm.id, projectIds: wv ? [wv.id] : [], from: ym, to: ym, entity: 'SOBHA COMMUNITY MANAGEMENT LLC', trn: '', customerCode: '', poNo: '', attachTs: true, notes: '',
      lines: [{ desc: String(r[8] || ''), rate: amt, amount: amt, vat: 0 }], savedAt: new Date().toISOString(),
      track: { invSent: xd(r[4]) || '', paidAmt: paid || '', paidOn: /paid/i.test(status) && paid >= amt - 0.01 ? (xd(r[13]) || '') : '', status } });
  }
  if (el) S.invoices.push({ id: uid('i'), no: '2026-0900000689', date: '2026-06-01', clientId: sclC.id, projectIds: [el.id], from: '2026-01', to: '2026-05', entity: el.entityName, trn: '100551377300003', customerCode: '', poNo: el.poNo, sapProject: el.sapName, orderCode: el.orderCode, custAddress: sclC.address, payTerms: '30 DAYS CREDIT FROM DT INV SUB', printDate: '2026-08-20', advance: 0, retention: 0, withSap: true, attachTs: true, notes: '', savedAt: new Date().toISOString(),
    lines: ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'].map(m => ({ desc: `${fmtMonYY(m)}  4 Security @ ${dim(m)} Days`, rate: 4100, amount: 16400, vat: 0, src: { pid: el.id, m, md: 4 * dim(m) } })), track: { invSent: '2026-08-20' } });
  S.invoices.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  S.settings.rateCard = [{ trade: 'SECURITY GUARD', unit: 'Security', rate: 4100, src: 'WOI INS-104N135-26-0002' }, { trade: 'LADY SECURITY GUARD', unit: 'Female Security Guard', rate: 3990, src: 'Tax Invoice Breakup' }, { trade: 'SECURITY SUPERVISOR', unit: 'Security Supervisor', rate: 8000, src: 'Tax Invoice Breakup' }];
  S.savedAt = null; S.seedVer = '2026-09-29c'; markDirty();
  // short ids keep the file small (e1…, s1…, p1…, c1…, i1…)
  let json = JSON.stringify(encodeState(S)); const ids = new Map(); let n = 0;
  for (const k of ['employees', 'sites', 'projects', 'clients', 'invoices']) S[k].forEach((x, i) => ids.set(x.id, x.id[0] + (i + 1)));
  json = json.replace(/"[escpi][a-z0-9]{10,}"/g, m => { const id = m.slice(1, -1); return ids.has(id) ? '"' + ids.get(id) + '"' : m; });
  const enc = JSON.parse(json);
  const dbg = { imported: S.projects.filter(p => !p.noAttendance).map(p => p.name).sort(), names: S.projects.filter(p => !/^SCL|TR\b|INFRA|ERT|H2|CCP|STORE|FACTORY|TOWER|VILLA|SOBHA ONE|CREST|CREEK|SEA HAVEN|SOLIS|ORBIS|VERDE|MALL|JUMMAH|WAVES OPULENCE|CENTRAL|SKY|RESERVE|P&M|CHAIRMAN|PMO|BAHYAH|ADVANCED|MARBLE|TECHNO|DIC|ELWOOD/.test(p.name)).map(p => p.name), elwood: S.projects.filter(p => /ELWOOD/.test(p.name)).map(p => p.name), waves: S.projects.filter(p => /WAVES/.test(p.name)).map(p => p.name), sizes: Object.fromEntries(Object.entries(enc).map(([k, v]) => [k, JSON.stringify(v).length])) };
  return { dbg, log, matched, unmatched, stats: { emp: S.employees.length, proj: S.projects.length, sites: S.sites.length, unl: S.sites.filter(s => !s.projectId).length, inv: S.invoices.length, clients: S.clients.map(c => c.name + ':' + S.projects.filter(p => p.clientId === c.id).length), noClient: S.projects.filter(p => !p.clientId).map(p => p.name) }, json };
}, { master: b64('real-master.xlsx'), scl: b64('real-scl.xlsx'), trk: b64('real-trackers.xlsx') });
console.log(out.log.join('\n')); console.log('tracker matched', out.matched.length, '\n  ' + out.matched.join('\n  '), '\nnot in attendance:', out.unmatched.length, '\n  ' + out.unmatched.join(' | '));
console.log(JSON.stringify(out.stats, null, 1)); console.log(JSON.stringify(out.dbg, null, 1)); console.log('seed size KB', (out.json.length / 1024).toFixed(0));
if (!dry) fs.writeFileSync(path.join(root, 'src/00-seed.js'), '/* Shipped data – generated by tools/mkseed.mjs from the LS workbooks. null = start empty. */\nconst SEED = ' + out.json + ';\n');
await b.close();
