// Flexibility test: the page's extraction keeps working when the models run more years or add
// a project. The workbooks in fixtures/ (as for test/parity.mjs) are changed in memory the way
// a later model version would change them, and the extraction runs on them:
//   years    every sheet read by year gets 5 more years after its last one (cashflows FY 2036 …
//            FY 2040, P&Ls FY 33 … FY 38), headed in the sheet's own style, figures = the last
//            year's × 1.1 … 1.5, Total columns including them; likewise the G&A workbook (G&A
//            sheet: every year block; OHcost-H+V / H / V) and the three Exposure sheets (each
//            table's periods, before the version-comparison blocks to their right);
//   project  on top of that, Brook Hollow copied as 'Test Ridge @ Austin - Texas' after the last
//            project of every per-project sheet (cashflows, P&Ls, Summary val, budgets, property
//            tax, Timeline Assumptions): its figures 5 periods later (so it runs into the new
//            years), its dates 5 years later, its Summary val column × 1.5.
// Checks: the new years carry the expected figures in every dataset with periods, the new
// project appears in every per-project dataset, no step fails, nothing else moves, and the
// Actuals Excel download (test/actuals-xlsx.mjs) works on the result.
//
//   node test/flex.mjs [fixturesDir] [--show=8] [--dump=file.json] [--write=dir]
// --dump writes the 'project' run's datasets (e.g. to load into the page with dash.setData);
// --write saves its changed workbooks (the sheets the extraction reads) as .xlsx files, to
// upload into the page. Both hold model figures: keep them out of the repository.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const args = process.argv.slice(2);
const opt = (k) => { const a = args.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const fixtures = args.find((a) => !a.startsWith('--')) || join(root, 'fixtures');
const show = +(opt('show') || 8);

// Load the same scripts the page loads, in the same order (as test/parity.mjs).
const scripts = JSON.parse(readFileSync(join(root, 'build.mjs'), 'utf8').match(/const SCRIPTS = (\[[^\]]*\])/)[1].replace(/'/g, '"'))
  .filter((f) => f === 'xlsx.js' || f === 'extract.js' || f.startsWith('derive-'));
for (const f of scripts) {
  try { vm.runInThisContext(readFileSync(join(root, 'src', f), 'utf8'), { filename: f }); }
  catch (e) { console.log(`! ${f} failed to load: ${e.message}`); }
}
const X = globalThis.SobhaExtract;
const baseline = JSON.parse(readFileSync(join(root, 'src', 'baseline.json'), 'utf8'));

const N = 5;                                    // years added
const factor = (k) => 1 + k / 10;               // the k-th new year = last year × factor(k)
const FROM = 'Brook Hollow @ Prosper - Texas', NEW = 'Test Ridge @ Austin - Texas', NEW_SHORT = 'Test Ridge';
const SHIFT = 5;                                // the new project runs this many periods / years later
const SCALE = 1.5;                              // its Summary val column
const ALL = 'All Projects', CORP = X.lib.CORP;

// ---- sheets as plain cells, changed and handed back with the XLSXLite sheet interface ----
const isNum = (v) => typeof v === 'number' && isFinite(v);
const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const FY = /^(FY\s*'?)(\d{2}|\d{4})$/i;
const PERIOD = (v) => typeof v === 'string' && (FY.test(clean(v)) || /^till\b/i.test(clean(v)) || /\bto\b.*'\d{2}$/i.test(clean(v)));
const rowNums = (g) => Object.keys(g.v).map(Number).sort((a, b) => a - b);

function grid(s) {
  const v = {}, f = {};
  for (const r of s.rowNums()) v[r] = Object.assign({}, s.row(r));
  for (let r = 1; r <= s.maxRow; r++) for (let c = 1; c <= s.maxCol; c++) { const x = s.formula(r, c); if (x != null) (f[r] = f[r] || {})[c] = x; }
  return { name: s.name, v, f, uncached: s.uncached, errors: s.errors };
}
function sheetOf(g) {
  const rows = {}, f = g.f;
  let maxRow = 0, maxCol = 0;
  for (const [r, row] of Object.entries(g.v)) {
    const o = {};
    for (const [c, x] of Object.entries(row)) if (x != null && x !== '') { o[c] = x; maxCol = Math.max(maxCol, +c); }
    if (Object.keys(o).length) { rows[r] = o; maxRow = Math.max(maxRow, +r); }
  }
  return {
    name: g.name, rows, maxRow, maxCol, uncached: g.uncached, errors: g.errors,
    get(r, c) { const row = rows[r]; return row ? (row[c] === undefined ? null : row[c]) : null; },
    formula(r, c) { const row = f[r]; return row && row[c] !== undefined ? row[c] : null; },
    row(r) { return rows[r] || {}; },
    rowNums() { return Object.keys(rows).map(Number).sort((a, b) => a - b); },
  };
}
function insertCols(g, after, n) {
  for (const t of ['v', 'f']) for (const r of Object.keys(g[t])) {
    const out = {};
    for (const [c, x] of Object.entries(g[t][r])) out[+c > after ? +c + n : c] = x;
    g[t][r] = out;
  }
}
function insertRows(g, after, n) {
  for (const t of ['v', 'f']) { const out = {}; for (const [r, x] of Object.entries(g[t])) out[+r > after ? +r + n : r] = x; g[t] = out; }
}
// Excel date serial moved by whole years (time of day kept).
function laterBy(v, years) {
  const d = new Date((Math.floor(v) - 25569) * 864e5); d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.getTime() / 864e5 + 25569 + (v - Math.floor(v));
}
const isoLater = (s, years) => { if (!s) return s; const d = new Date(s + 'T00:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() + years); return d.toISOString().slice(0, 10); };
const monLater = (s, years) => (s == null ? s : String(s).replace(/'(\d{2})\b/g, (m, y) => "'" + String((+y + years) % 100).padStart(2, '0')));

// Header rows of the year columns, as the extraction finds them.
const HEADERS = {
  prt: (row) => clean(row[2]) === 'Sr.no' || clean(row[3]) === 'Particular',
  pl: (row) => Object.values(row).some((v) => /^description$/i.test(clean(v))),
  rpt: (row, g, r) => Object.values(g.v[r + 1] || {}).some((v) => /^rpt transfer to cost of revenue$/i.test(clean(v))),
  oh: (row) => Object.values(row).some((v) => typeof v === 'string' && FY.test(clean(v))),
};
// Sheets the extraction reads by year (in whichever workbook has them).
const YEAR_SHEETS = {
  'Consol Projectwise cash': 'prt', 'landowner Projectwise cashflow': 'prt', 'Homebuilde Projectwise cashflow': 'prt',
  'landowner Projectwise cashf new': 'prt',
  'landowner Projectwise PL': 'pl', 'Homebuilde Projectwise PL': 'pl', 'Cons P&L': 'pl',
  'Real property tax V2 - updated': 'rpt',
  'OHcost-H+V': 'oh', 'OHcost-H': 'oh', 'OHcost-V': 'oh',
};
const EXPOSURE = ['Cons Exposure', 'HS Exposure'];

// The year columns at index a (width w) copied N times after them; f(x, k, r, j) gives each copy.
function copyCols(g, a, w, f, rows = null) {
  const end = a + w - 1, keep = (r) => !rows || (+r >= rows[0] && +r <= rows[1]);
  for (const t of ['v', 'f']) for (const r of Object.keys(g[t])) {
    if (!keep(r)) continue;
    const row = g[t][r], out = {};
    for (const [c, x] of Object.entries(row)) out[+c > end ? +c + N * w : c] = x;
    for (let k = 1; k <= N; k++) for (let j = 0; j < w; j++) { const x = row[a + j]; if (x !== undefined) out[end + (k - 1) * w + j + 1] = t === 'v' ? f(x, k, +r, j) : x; }
    g[t][r] = out;
  }
}
// G&A sheet: blocks of years (cost, TOTAL OH, Sobha Developers % and amounts, Sobha Homes …),
// each a run of years in the rows above 'Expense Head'. Amounts scale, shares are copied.
function addGAYears(g) {
  const h = rowNums(g).find((r) => Object.values(g.v[r]).some((x) => /^expense head$/i.test(clean(x))));
  const cells = [];
  for (const r of rowNums(g).filter((r) => r < h + 2)) for (const [c, x] of Object.entries(g.v[r])) if (isNum(x) && x >= 2000 && x <= 2100 && x === Math.round(x)) cells.push({ r, c: +c, y: x });
  cells.sort((a, b) => a.c - b.c);
  const blocks = [];
  for (const x of cells) { const b = blocks[blocks.length - 1]; if (b && x.y > b[b.length - 1].y && x.r === b[0].r) b.push(x); else blocks.push([x]); }
  let last = null;
  for (const b of blocks.filter((b) => b.length > 1).reverse()) {
    const a = b[b.length - 1], w = a.c - b[b.length - 2].c, share = a.r > h;
    last = a.y;
    copyCols(g, a.c, w, (x, k, r) => (r === a.r && x === a.y ? a.y + k : isNum(x) && !share && r > h + 1 ? x * factor(k) : x));
  }
  return { last, labels: Array.from({ length: N }, (_, i) => 'FY' + (last + i + 1)) };
}
// Exposure: each table ('Particulars' header) gets N more periods after its last; the labels
// ('As at 31 Dec 2033', a date, 'FY 2033') N years later, the figures × factor.
function addExposureYears(g) {
  const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const lab = (x) => (isNum(x) ? (x > 40000 && x < 60000 ? x : null) : /^(as at\s+\d{1,2}\s+[a-z]+\s+\d{4}|fy\s*\d{2,4}|till\s+[a-z]{3}[a-z]*\s*'\d{2})$/i.test(clean(x)) ? clean(x) : null);
  const later = (x, k) => (isNum(x) ? laterBy(x, k) : x.replace(/(\d{4})$/, (m) => String(+m + k)));
  const heads = rowNums(g).map((r) => ({ r, c: Object.keys(g.v[r]).map(Number).sort((a, b) => a - b).find((c) => /^particulars$/i.test(clean(g.v[r][c]))) })).filter((x) => x.c);
  let labels = null;
  heads.forEach((hd, i) => {
    const row = g.v[hd.r], P = [], seen = new Set();
    for (const c of Object.keys(row).map(Number).filter((c) => c > hd.c).sort((a, b) => a - b)) { const l = lab(row[c]); if (l == null) continue; if (seen.has(l)) break; seen.add(l); P.push(c); }
    if (P.length < 2) return;
    const a = P[P.length - 1], w = Math.min(a - P[P.length - 2], 2), end = i + 1 < heads.length ? heads[i + 1].r - 1 : Math.max(...rowNums(g));
    copyCols(g, a, w, (x, k, r) => (r === hd.r && lab(x) != null ? later(x, k) : isNum(x) ? x * factor(k) : x), [hd.r, end]);
    labels = labels || Array.from({ length: N }, (_, k) => String(later(row[a], k + 1)));
  });
  return { labels: labels || [] };
}

// N more years after the last one. A year can span several columns (a P&L's amount and
// '% of revenue', the property-tax table's six): the last year's columns are copied.
function addYears(g, kind) {
  const hdr = rowNums(g).filter((r) => HEADERS[kind](g.v[r], g, r)), fy = [];
  for (const r of hdr) for (const [c, x] of Object.entries(g.v[r])) { const m = typeof x === 'string' && clean(x).match(FY); if (m) fy.push([+c, m[2].length === 2 ? 2000 + +m[2] : +m[2]]); }
  if (!fy.length) throw new Error(`${g.name}: no year columns`);
  const last = Math.max(...fy.map((x) => x[1])), firstCol = (y) => Math.min(...fy.filter((x) => x[1] === y).map((x) => x[0]));
  const a = firstCol(last), w = a - firstCol(Math.max(...fy.filter((x) => x[1] < last).map((x) => x[1]))), end = a + w - 1;
  if (!(w >= 1)) throw new Error(`${g.name}: cannot tell the width of a year`);
  const totals = [...new Set(hdr.flatMap((r) => Object.keys(g.v[r]).filter((c) => /^total$/i.test(clean(g.v[r][c])))))].map(Number);
  const src = { v: {}, f: {} };
  for (const t of ['v', 'f']) for (const [r, row] of Object.entries(g[t])) for (let j = 0; j < w; j++) if (row[a + j] !== undefined) (src[t][r] = src[t][r] || {})[j] = row[a + j];
  insertCols(g, end, N * w);
  const col = (k, j) => end + (k - 1) * w + j + 1;
  for (const [r, row] of Object.entries(src.v)) {
    let added = 0;
    for (let k = 1; k <= N; k++) for (const [j, x] of Object.entries(row)) {
      g.v[r][col(k, +j)] = isNum(x) ? x * factor(k) : typeof x === 'string' && FY.test(clean(x))
        ? x.replace(/(\d{2}|\d{4})(\s*)$/, (m, y, sp) => (y.length === 2 ? String((+y + k) % 100).padStart(2, '0') : String(+y + k)) + sp) : x;
      if (+j === 0 && isNum(x)) added += x * factor(k);
    }
    for (const t0 of totals) { const t = t0 > end ? t0 + N * w : t0; if (isNum(g.v[r][t])) g.v[r][t] += added; }
  }
  for (const [r, row] of Object.entries(src.f)) for (let k = 1; k <= N; k++) for (const [j, x] of Object.entries(row)) (g.f[r] = g.f[r] || {})[col(k, +j)] = x;
  return { last, labels: Array.from({ length: N }, (_, i) => 'FY' + (last + i + 1)), at: end + 1, n: N * w };
}

// The new project's block in a sheet with one block per project (project names in column A):
// FROM's block copied after the last project's, its figures SHIFT periods later.
function addBlock(g, kind, years) {
  const rows = rowNums(g), first = {}, last = {}, order = [];
  for (const r of rows) { const p = clean(g.v[r][1]); if (!p || p === ALL) continue; if (!(p in first)) { first[p] = r; order.push(p); } last[p] = r; }
  if (!(FROM in first)) return null;
  // A block starts at its title row (the project's name a few rows above its header), if any.
  const title = (p) => { for (let r = first[p] - 5; r < first[p]; r++) if (Object.values(g.v[r] || {}).some((x) => clean(x) === p)) return r; return first[p]; };
  const next = order[order.indexOf(FROM) + 1], start = title(FROM), end = next ? title(next) - 1 : last[FROM];
  const at = last[order[order.length - 1]] + (end - last[FROM]); // the last block has as many rows after its last named one
  const hdr = rows.filter((r) => HEADERS[kind](g.v[r], g, r));
  const P = [...new Set(hdr.flatMap((r) => Object.keys(g.v[r]).filter((c) => PERIOD(g.v[r][c]) && (!years || +c < years.at + years.n))))].map(Number).sort((x, y) => x - y);
  const totals = [...new Set(hdr.flatMap((r) => Object.keys(g.v[r]).filter((c) => /^total$/i.test(clean(g.v[r][c])))))].map(Number);
  const V = [], F = [];
  for (let r = start; r <= end; r++) {
    const v = Object.assign({}, g.v[r] || {});
    for (const c of Object.keys(v)) if (clean(v[c]) === FROM) v[c] = NEW;
    if (!P.some((c) => PERIOD(v[c]))) { // not a header row
      const old = P.map((c) => v[c]);
      P.forEach((c, j) => { const x = j >= SHIFT ? old[j - SHIFT] : isNum(old[j]) ? 0 : undefined; if (isNum(x)) v[c] = x; else delete v[c]; });
      for (const t of totals) if (isNum(v[t])) v[t] = P.reduce((s, c) => s + (isNum(v[c]) ? v[c] : 0), 0);
    }
    V.push(v); F.push(Object.assign({}, g.f[r] || {}));
  }
  insertRows(g, at, V.length);
  V.forEach((v, i) => { g.v[at + 1 + i] = v; g.f[at + 1 + i] = F[i]; });
  return { at: at + 1, rows: V.length };
}

// A list with one row per project under a header row: FROM's row copied after the last one,
// its dates SHIFT years later.
function addListRow(g, headerRe) {
  const rows = rowNums(g), hr = rows.find((r) => Object.values(g.v[r]).some((x) => headerRe.test(clean(x))));
  if (hr == null) throw new Error(`${g.name}: no list header`);
  const H = g.v[hr], nc = +Object.keys(H).find((c) => /^(project name|particulars)$/i.test(clean(H[c])));
  let src = null, last = null;
  for (const r of rows) {
    const n = r > hr && clean(g.v[r][nc]);
    if (!n) continue;
    if (/^total$/i.test(n)) break;
    if (n === FROM && src == null) src = r;
    last = r;
  }
  if (src == null) throw new Error(`${g.name}: no row for ${FROM}`);
  const v = Object.assign({}, g.v[src]);
  v[nc] = NEW;
  for (const c of Object.keys(H)) if (/date|release/i.test(clean(H[c])) && isNum(v[c]) && v[c] > 30000) v[c] = laterBy(v[c], SHIFT);
  insertRows(g, last, 1);
  g.v[last + 1] = v; g.f[last + 1] = Object.assign({}, g.f[src] || {});
  return { at: last + 1 };
}

// 'Summary val': FROM's column copied (× SCALE) before 'Total'.
function addSummaryColumn(g) {
  const hr = rowNums(g).find((r) => /^particulars$/i.test(clean(g.v[r][2])));
  const H = g.v[hr], src = +Object.keys(H).find((c) => clean(H[c]) === FROM), tot = +Object.keys(H).find((c) => /^total$/i.test(clean(H[c])));
  const at = tot ? tot - 1 : Math.max(...Object.keys(H).map(Number));
  insertCols(g, at, 1);
  for (const [r, row] of Object.entries(g.v)) { const x = row[src]; if (x !== undefined) row[at + 1] = +r === hr ? NEW : isNum(x) ? x * SCALE : x; }
  return { col: at + 1 };
}

// 'Timeline Assumptions': FROM's phase rows copied as NEW_SHORT's at the end (a raw-land
// project in Austin), dates SHIFT years later.
function addTimelineRows(g) {
  const rows = rowNums(g), hr = rows.find((r) => Object.values(g.v[r]).some((x) => /acquisition start/i.test(clean(x))));
  const top = g.v[hr - 1] || {}, colOf = (re, d) => +(Object.keys(top).find((c) => re.test(clean(top[c]))) || d);
  const nc = colOf(/proposed projects/i, 4), tc = colOf(/type of project/i, 6), lc = colOf(/^location$/i, 5);
  const dates = Object.keys(g.v[hr]).filter((c) => /start|finish|close/i.test(clean(g.v[hr][c])));
  const key = X.lib.nameKey(FROM), src = [];
  let type = null, last = null;
  for (const r of rows) {
    const n = r > hr && clean(g.v[r][nc]);
    if (!n || /^note/i.test(n)) continue;
    if (clean(g.v[r][tc])) type = g.v[r][tc];
    if (X.lib.nameKey(n) === key) src.push({ r, type });
    last = r;
  }
  if (!src.length) throw new Error(`${g.name}: no row for ${FROM}`);
  insertRows(g, last, src.length);
  src.forEach((x, i) => {
    const v = Object.assign({}, g.v[x.r]);
    v[nc] = NEW_SHORT + (clean(v[nc]).match(/\s*-\s*phase\s*\d+\s*$/i) || [''])[0];
    if (i === 0) { v[tc] = x.type; v[lc] = 'Austin'; }
    for (const c of dates) if (isNum(v[c])) v[c] = laterBy(v[c], SHIFT);
    g.v[last + 1 + i] = v;
  });
  return { at: last + 1, rows: src.length };
}

const edits = {
  years: (n) => (YEAR_SHEETS[n] ? [(g, i) => { i.years = addYears(g, YEAR_SHEETS[n]); }]
    : n === 'G&A' ? [(g, i) => { i.years = addGAYears(g); }]
    : EXPOSURE.includes(n) ? [(g, i) => { i.years = addExposureYears(g); }] : []),
  project: (n) => {
    if (YEAR_SHEETS[n] === 'prt' || YEAR_SHEETS[n] === 'pl' && n !== 'Cons P&L') return [(g, i) => { i.block = addBlock(g, YEAR_SHEETS[n], i.years); }];
    if (n === 'Summary val') return [(g, i) => { i.column = addSummaryColumn(g); }];
    if (['Cons Budgetd Costs new', 'Cons Budgetd Costs', 'HS Budget costs1'].includes(n)) return [(g, i) => { i.list = addListRow(g, /^project name$/i); }];
    if (n === 'Real property tax V2 - updated') return [(g, i) => { i.list = addListRow(g, /^rpt transfer to cost of revenue$/i); }];
    if (n === 'Timeline Assumptions') return [(g, i) => { i.list = addTimelineRows(g); }];
    return [];
  },
};
// The workbooks with sheets changed when the extraction asks for them; info[file › sheet] says how.
function changed(books, kinds) {
  const info = {};
  return {
    info,
    books: books.map(({ name, wb }) => {
      const cache = {};
      return { name, wb: {
        sheetNames: wb.sheetNames, has: (n) => wb.has(n), served: () => Object.keys(cache).filter((n) => cache[n]),
        async sheet(n) {
          if (n in cache) return cache[n];
          const s = await wb.sheet(n), todo = s ? kinds.flatMap((k) => edits[k](n)) : [];
          if (!todo.length) return (cache[n] = s);
          const g = grid(s), i = (info[name + ' › ' + n] = {});
          for (const e of todo) e(g, i);
          return (cache[n] = sheetOf(g));
        },
      } };
    }),
  };
}

// ---- runs --------------------------------------------------------------------------------
const books = [];
for (const f of readdirSync(fixtures).filter((f) => /\.xlsx$/i.test(f) && !f.startsWith('~$'))) {
  const b = readFileSync(join(fixtures, f));
  books.push({ name: f, wb: await XLSXLite.open(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) });
}
const base = await X.build(books, baseline);
const Y = changed(books, ['years']), yrs = await X.build(Y.books, baseline);
const P = changed(books, ['years', 'project']), prj = await X.build(P.books, baseline);
console.log(`models: ${base.report.files.filter((f) => f.model).map((f) => f.model).join(', ')}; sheets changed: ${Object.keys(P.info).length}`);
for (const [k, v] of Object.entries(P.info)) {
  const y = v.years ? `${v.years.labels[0]}…${v.years.labels[N - 1]}` : '';
  const p = v.block ? `block at row ${v.block.at} (${v.block.rows} rows)` : v.column ? `column ${XLSXLite.colName(v.column.col)}` : v.list ? `row ${v.list.at}` : '';
  console.log(`  ${k}: ${[y, p].filter(Boolean).join(', ')}`);
}

// ---- checks ------------------------------------------------------------------------------
const G = {};
const check = (group, ok, msg) => { const g = (G[group] = G[group] || { n: 0, bad: [] }); g.n++; if (!ok) g.bad.push(msg); return ok; };
const near = (a, b, tol = 0.001) => ((a == null || a === '') && (b == null || b === '') ? true : isNum(a) && isNum(b) ? Math.abs(a - b) <= tol : a === b);
const byKey = (rows) => new Map((rows || []).map((r) => [r.key, r]));
const periodsOf = (rows) => [...new Set((rows || []).flatMap((r) => Object.keys(r).filter((k) => /^FY\d{4}$|^Till |^[A-Z][a-z]{2}-[A-Z][a-z]{2}'\d{2}$/.test(k))))];
const yearOf = (p) => { const m = String(p).match(/^FY(\d{4})$/) || String(p).match(/'(\d{2})$/); return m ? (m[1].length === 2 ? 2000 + +m[1] : +m[1]) : null; };
const sourceInfo = (run, info, ds) => { const s = run.report.sources[ds]; return s ? info[s.split(', ')[0]] || {} : {}; };
const fmt = (v) => (isNum(v) ? Math.round(v * 100) / 100 : JSON.stringify(v));
// The same rows in two runs (fields compared with near; a field null in one and missing in the other is the same).
function sameRows(group, A, B, keep = () => true, skip = [], tol = 0.001) {
  const bm = byKey(B);
  for (const a of A.filter(keep)) {
    const b = bm.get(a.key);
    if (!check(group, b, `${a.key}: missing`)) continue;
    for (const f of new Set([...Object.keys(a), ...Object.keys(b)])) if (!skip.includes(f) && f !== 'source') check(group, near(b[f], a[f], tol), `${a.key} . ${f}: ${fmt(b[f])}, expected ${fmt(a[f])}`);
  }
}
const sumOf = (rows, f) => rows.reduce((s, r) => s + (isNum(r[f]) ? r[f] : 0), 0);

// No step may fail on the changed workbooks.
for (const [name, run] of [['years', yrs], ['project', prj]]) {
  const lost = base.report.refreshed.filter((d) => !run.report.refreshed.includes(d));
  check(name + ' › every dataset still builds', !lost.length, `not built: ${lost.map((d) => d + ' (' + (run.report.sources[d] || '?') + ')').join(', ')}`);
  // (Expected: the copied years and project do not add up across sheets the way a real model does.)
  for (const w of run.report.warnings.filter((w) => !base.report.warnings.includes(w))) console.log(`  ${name} run warns: ${w.slice(0, 150)}`);
}

// ---- years -------------------------------------------------------------------------------
// Cashflows: the old periods as before, the new ones = last year × factor, totals including them.
for (const ds of ['consol_cf', 'landowner_cf', 'homebuilder_cf']) {
  const g = 'years › ' + ds, add = sourceInfo(yrs, Y.info, ds).years;
  if (!check(g, add, 'sheet not changed')) continue;
  const was = base.report.periods[ds], now = yrs.report.periods[ds], last = was[was.length - 1];
  check(g, JSON.stringify(now) === JSON.stringify(was.concat(add.labels)), `periods ${now.join(', ')}`);
  const fm = byKey(yrs.data[ds]);
  check(g, yrs.data[ds].length === base.data[ds].length, `${yrs.data[ds].length} rows, was ${base.data[ds].length}`);
  for (const b of base.data[ds]) {
    const f = fm.get(b.key);
    if (!check(g, f, `${b.key}: missing`)) continue;
    for (const p of was) check(g, near(f[p], b[p]), `${b.key} ${p}: ${fmt(f[p])}, was ${fmt(b[p])}`);
    let added = 0;
    add.labels.forEach((p, i) => {
      const want = b.kind === 'header' ? null : b[last] * factor(i + 1);
      check(g, near(f[p], want, 0.02), `${b.key} ${p}: ${fmt(f[p])}, expected ${fmt(want)}`);
      added += f[p] || 0;
    });
    check(g, near(f.Budget, b.Budget), `${b.key} Budget`);
    check(g, near(f.Total, b.Total == null ? null : b.Total + added, 0.05), `${b.key} Total: ${fmt(f.Total)}, expected ${fmt(b.Total + added)}`);
  }
}
// P&Ls: the statement's lines likewise; project lines add up by line, so they scale too, and the
// corporate remainder (rounded to nothing under $0.50) within $1.
for (const ds of ['landowner_pl', 'homebuilder_pl', 'consol_pl']) {
  const g = 'years › ' + ds, add = sourceInfo(yrs, Y.info, ds).years;
  if (!check(g, add, 'sheet not changed')) continue;
  const was = periodsOf(base.data[ds]), now = periodsOf(yrs.data[ds]), last = was[was.length - 1];
  check(g, JSON.stringify(now) === JSON.stringify(was.concat(add.labels)), `periods ${now.join(', ')}`);
  const fm = byKey(yrs.data[ds]), bm = byKey(base.data[ds]);
  // consol_pl's project lines come from consol_project_pl, which spreads costs over all its years.
  const scaled = (r) => ds !== 'consol_pl' || !r.level;
  for (const b of base.data[ds].filter(scaled)) {
    const f = fm.get(b.key), tol = b.project === CORP ? 1 : 0.02;
    if (!check(g, f, `${b.key}: missing`)) continue;
    for (const p of was) check(g, near(f[p], b[p], b.project === CORP ? 1 : 0.001), `${b.key} ${p}: ${fmt(f[p])}, was ${fmt(b[p])}`);
    let added = 0;
    add.labels.forEach((p, i) => {
      const want = b.kind === 'header' ? null : (b[last] || 0) * factor(i + 1);
      check(g, near(f[p], want, tol), `${b.key} ${p}: ${fmt(f[p])}, expected ${fmt(want)}`);
      added += want || 0;
    });
    check(g, near(f.Total, b.Total == null ? null : b.Total + added, b.project === CORP ? 5 : 0.1), `${b.key} Total: ${fmt(f.Total)}, expected ${fmt(b.Total + added)}`);
  }
  for (const f of yrs.data[ds].filter((r) => !bm.has(r.key))) check(g, f.project === CORP, `${f.key}: new row`);
  // Each line = its project and corporate lines, in every period.
  for (const t of yrs.data[ds].filter((r) => !r.level && r.kind !== 'header')) {
    const kids = yrs.data[ds].filter((r) => r.parent === t.key);
    if (kids.length) for (const p of now.concat('Total')) check(g, near(sumOf(kids, p), t[p], 1), `${t.key} ${p}: lines below add up to ${fmt(sumOf(kids, p))}, not ${fmt(t[p])}`);
  }
}
// Project P&L: one column per year to the cashflow's last; revenue = the cashflow's by year.
function checkProjectPL(g, run) {
  const rows = run.data.consol_project_pl, cf = run.data.consol_cf;
  const years = [...new Set(run.report.periods.consol_cf.map((p) => 'FY' + yearOf(p)))];
  for (const r of rows) {
    check(g, years.every((y) => y in r), `${r.key}: years ${periodsOf([r]).join(', ')}`);
    if (r.kind !== 'header') check(g, near(r.Total, years.reduce((s, y) => s + r[y], 0), 0.1), `${r.key} Total`);
    if (r.line !== 'Total Revenue') continue;
    const rev = cf.find((x) => x.project === r.project && /^revenue$/i.test(x.line));
    for (const y of years) {
      const want = run.report.periods.consol_cf.filter((p) => 'FY' + yearOf(p) === y).reduce((s, p) => s + (rev[p] || 0), 0);
      check(g, near(r[y], want, 0.05), `${r.key} ${y}: ${fmt(r[y])}, cashflow revenue ${fmt(want)}`);
    }
  }
  return years;
}
{
  const years = checkProjectPL('years › consol_project_pl', yrs);
  check('years › consol_project_pl', years[years.length - 1] === 'FY' + (yearOf(base.report.periods.consol_cf.slice(-1)[0]) + N), `last year ${years[years.length - 1]}`);
  const was = new Set(base.data.consol_project_pl.map((r) => r.key));
  check('years › consol_project_pl', yrs.data.consol_project_pl.every((r) => was.has(r.key)) && was.size === yrs.data.consol_project_pl.length, 'rows differ');
}
// Consol line breakdown: every period, and the components plus override still make the line.
function checkComponents(g, run) {
  const P = run.report.periods.consol_cf, comps = run.data.consol_components;
  const by = {};
  for (const c of comps) { check(g, P.every((p) => p in c), `${c.key}: periods`); (by[c.project + '|' + c.consol_line] = by[c.project + '|' + c.consol_line] || []).push(c); }
  for (const r of run.data.consol_cf) {
    const cs = by[r.project + '|' + r.line];
    if (cs) for (const p of P) check(g, near(sumOf(cs, p), r[p], 1), `${r.key} ${p}: components ${fmt(sumOf(cs, p))}, line ${fmt(r[p])}`);
  }
}
checkComponents('years › consol_components', yrs);

// Actuals plan: "Till Dec'YY", then every year to the last any statement has; each figure the
// statement's for that year.
function checkPlan(g, run) {
  const plan = run.data.actuals_plan, d = run.data;
  const stmts = ['consol_cf', 'landowner_cf', 'homebuilder_cf', 'consol_pl', 'landowner_pl', 'homebuilder_pl'];
  const lastY = Math.max(...stmts.flatMap((s) => periodsOf(d[s]).map(yearOf)));
  const cols = periodsOf(plan);
  check(g, cols[cols.length - 1] === 'FY' + lastY, `columns ${cols.join(', ')}; the statements reach FY${lastY}`);
  const sig = cols.join('|');
  for (const r of plan) check(g, periodsOf([r]).join('|') === sig, `${r.key}: columns ${periodsOf([r]).join(', ')}`);
  const Y0 = yearOf(cols[0]);
  const later = cols.filter((c) => yearOf(c) > Y0);
  // A year the statement lacks is blank, or 0 on 'Cons P&L' lines in the years only the project P&Ls reach.
  const cmp = (r, src) => { for (const c of later) check(g, src[c] == null ? r[c] == null || r[c] === 0 && r.stmt === 'consol_pl' : near(r[c], r.role === 'header' ? null : src[c], 0.011), `${r.key} ${c}: ${fmt(r[c])}, statement ${fmt(src[c])}`); };
  for (const st of stmts.slice(0, 3)) {
    const m = new Map(d[st].map((x) => [x.project + '|' + x.ord, x]));
    for (const r of plan.filter((x) => x.stmt === st)) { const s = m.get(r.project + '|' + r.ord); if (check(g, s, `${r.key}: no ${st} line`)) cmp(r, s); }
  }
  for (const st of ['consol_pl', 'landowner_pl']) {
    const top = d[st].filter((x) => !x.level);
    for (const r of plan.filter((x) => x.stmt === st && x.project === ALL)) { const s = top[r.ord - 1]; if (check(g, s && s.line.trim() === r.line, `${r.key}: no ${st} line`)) cmp(r, s); }
  }
  const pp = {};
  for (const x of d.consol_project_pl) (pp[x.project] = pp[x.project] || []).push(x);
  for (const r of plan.filter((x) => x.stmt === 'consol_pl' && x.project !== ALL)) { const s = (pp[r.project] || [])[r.ord - 1]; if (check(g, s, `${r.key}: no project P&L line`)) cmp(r, s); }
  // Lines without a source dataset here (Homebuilder 'Cons P&L', project lines under the P&Ls): figures in every year the statement has.
  for (const st of ['landowner_pl', 'homebuilder_pl']) {
    const ys = new Set(periodsOf(d[st]).map((p) => (yearOf(p) <= Y0 ? cols[0] : p)));
    for (const r of plan.filter((x) => x.stmt === st && x.role !== 'header')) for (const c of cols) check(g, (r[c] != null) === ys.has(c), `${r.key} ${c}: ${fmt(r[c])}`);
  }
  return lastY;
}
checkPlan('years › actuals_plan', yrs);

// Sales by year: the old years as before; new rows only in the new years, as the cashflows say.
function expectSales(run, project, ent) {
  const rows = run.data[ent + '_cf'].filter((r) => r.project === project), P = run.report.periods[ent + '_cf'];
  const sv = rows.find((r) => /^sales$/i.test(r.line)), su = rows.find((r) => /^sales unit$/i.test(r.line)), by = {};
  if (sv) for (const p of P) { const y = yearOf(p), b = (by[y] = by[y] || { v: 0, u: 0 }); b.v += sv[p] || 0; b.u += su ? su[p] || 0 : 0; }
  return by;
}
// Rows (keep) as the cashflows say, and one for every year with sales of at least $0.1 Mn.
function checkSales(g, run, keep) {
  const rows = run.data.project_sales.filter(keep), have = new Set(rows.map((r) => r.key));
  for (const r of rows) {
    const b = expectSales(run, r.project, r.entity.toLowerCase())[r.year];
    check(g, b && near(r.sales_value_m, Math.round(b.v / 1e5) / 10, 0.11) && near(r.units, Math.round(b.u), 1), `${r.key}: ${r.sales_value_m} Mn / ${r.units}, cashflow ${b ? (b.v / 1e6).toFixed(2) + ' Mn / ' + b.u.toFixed(1) : 'none'}`);
  }
  for (const ent of ['Landowner', 'Homebuilder']) for (const p of new Set(run.data[ent.toLowerCase() + '_cf'].map((r) => r.project))) {
    if (p === ALL) continue;
    for (const [y, b] of Object.entries(expectSales(run, p, ent.toLowerCase()))) {
      const k = `${p}|${ent}|${y}`;
      if (Math.round(b.v / 1e5) && keep({ key: k, project: p, entity: ent, year: +y })) check(g, have.has(k), `${k}: missing (sales ${(b.v / 1e6).toFixed(2)} Mn)`);
    }
  }
}
{
  const g = 'years › project_sales', bm = byKey(base.data.project_sales);
  sameRows(g, base.data.project_sales, yrs.data.project_sales);
  const maxY = {};
  for (const r of base.data.project_sales) maxY[r.entity] = Math.max(maxY[r.entity] || 0, r.year);
  for (const r of yrs.data.project_sales.filter((x) => !bm.has(x.key))) check(g, r.year > (maxY[r.entity] || 0), `${r.key}: new row in an old year`);
  checkSales(g, yrs, (r) => r.year > (maxY[r.entity] || 0));
}
// KPI tiles: sales and units are the cashflows' totals, new years included.
function checkKPI(g, run, keep = () => true) {
  for (const r of run.data.kpi_extra.filter(keep)) {
    const rows = run.data[r.entity + '_cf'].filter((x) => x.project === r.project);
    const s = rows.find((x) => /^sales$/i.test(x.line)), u = rows.find((x) => /^sales unit$/i.test(x.line));
    check(g, near(r.sales, s ? s.Total : 0, 0.02), `${r.key} sales ${fmt(r.sales)}, cashflow ${fmt(s && s.Total)}`);
    check(g, r.units === (u ? Math.round(u.Total) : 0), `${r.key} units ${r.units}, cashflow ${fmt(u && u.Total)}`);
  }
}
checkKPI('years › kpi_extra', yrs);
sameRows('years › kpi_extra', base.data.kpi_extra, yrs.data.kpi_extra, () => true, ['units', 'sales', 'avg_price', 'dev_cost', 'peak_debt', 'peak_debt_period', 'avg_unit_size', 'avg_unit_cost']);
// Equity IRR: the totals include the new years; the IRR is the sheet's.
function checkIRR(g, run, keep = () => true) {
  for (const r of run.data.project_irr.filter(keep)) {
    const inf = run.data[r.entity + '_cf'].find((x) => x.project === r.project && /^equity infusion$/i.test(x.line));
    check(g, near(r.equity_infused, inf ? inf.Total : null, 0.01), `${r.key} equity infused ${fmt(r.equity_infused)}, cashflow ${fmt(inf && inf.Total)}`);
  }
}
checkIRR('years › project_irr', yrs);
sameRows('years › project_irr', base.data.project_irr, yrs.data.project_irr, () => true, ['equity_infused', 'equity_released', 'net_return', 'multiple']);

// Equity schedule (project details): every infusion and release of the model's own cashflow is in
// one of its columns, whatever year it falls in: the columns add up to the infusions less what
// is released (equity back plus net profit, from Summary val).
async function checkEquity(g, run, bks) {
  const own = {};
  for (const [ent, sheet, model] of [['landowner', 'landowner Projectwise cashflow', 'landowner'], ['homebuilder', 'Homebuilde Projectwise cashflow', 'homebuilder']]) {
    const file = run.report.files.find((f) => f.model === model), b = file && bks.find((x) => x.name === file.name);
    own[ent] = b && b.wb.has(sheet) ? X.lib.readCF(await b.wb.sheet(sheet)) : null;
  }
  const sum = {};
  for (const r of run.data.project_summary) sum[r.entity + '|' + r.project] = r;
  const rows = run.data.project_entity, cols = Object.keys(rows[0] || {}).filter((k) => k.startsWith('equity '));
  for (const r of rows) {
    const ent = r.entity.toLowerCase(), cf = own[ent];
    if (!cf) continue;
    check(g, Object.keys(r).filter((k) => k.startsWith('equity ')).join() === cols.join(), `${r.key}: columns differ`);
    const line = (re) => cf.rows.find((x) => x.project === r.project && re.test(x.line));
    const inf = line(/^equity infusion$/i), rel = line(/^equity release$/i);
    const tot = (x) => (x ? cf.periods.reduce((s, p) => s + (x[p] || 0), 0) : 0);
    const sv = sum[ent + '|' + r.project] || {};
    const back = tot(rel) ? (sv.equity_infused || 0) + (sv.net_profit || 0) : 0;
    const want = (tot(inf) - back) / 1e6, got = cols.reduce((s, c) => s + (r[c] || 0), 0);
    check(g, near(got, want, 0.006 * cols.length + 0.01), `${r.key}: schedule adds up to ${got.toFixed(2)} Mn, the cashflow to ${want.toFixed(2)} Mn (columns ${cols[0].slice(7)} to ${cols[cols.length - 1].slice(7)})`);
    const years = cf.periods.filter((p) => Math.abs((inf && inf[p]) || 0) + Math.abs((rel && rel[p]) || 0) >= 0.5).map(yearOf);
    if (years.length) check(g, cols.some((c) => yearOf(c.slice(7)) >= Math.max(...years)), `${r.key}: equity moves in ${Math.max(...years)}, the schedule stops at ${cols[cols.length - 1].slice(7)}`);
  }
}
await checkEquity('unchanged › project_entity', base, books);
await checkEquity('years › project_entity', yrs, Y.books);
// (The schedule itself changes where the copied last year moves equity: checked above.)
sameRows('years › project_entity', base.data.project_entity, yrs.data.project_entity, () => true, ['revenue_funding_m', ...Object.keys(yrs.data.project_entity[0] || {}).filter((k) => k.startsWith('equity '))]);

// Everything else does not depend on the years.
for (const ds of ['project_summary', 'project_roe', 'project_timeline']) sameRows('years › ' + ds, base.data[ds], yrs.data[ds]);
sameRows('years › project_profile', base.data.project_profile.map((r) => Object.assign({ key: r.project }, r)), yrs.data.project_profile.map((r) => Object.assign({ key: r.project }, r)), () => true, ['total_direct_cost_m']);

// G&A: every year field gains the new years (amounts × factor, shares as the last year's);
// the depreciation schedule is read for whichever new years 'Cal.' has.
{
  const last = Math.max(...Object.keys(base.data.ga_lines[0]).map((k) => +(k.match(/^cost (\d{4})$/) || [])[1] || 0));
  const g = 'years › ga_lines', fm = byKey(yrs.data.ga_lines);
  check(g, yrs.data.ga_lines.length === base.data.ga_lines.length, `${yrs.data.ga_lines.length} rows`);
  for (const b of base.data.ga_lines) {
    const f = fm.get(b.key);
    if (!check(g, f, `${b.key}: missing`)) continue;
    // (rule_oh / rule_cost read formulas, which this test does not re-point when it inserts columns)
    for (const k of Object.keys(b)) if (!['source', 'rule_oh', 'rule_cost'].includes(k)) check(g, near(f[k], b[k]), `${b.key} . ${k}: ${fmt(f[k])}, was ${fmt(b[k])}`);
    for (const fld of ['cost', 'oh', 'proj', 'lo', 'hb', 'lo_pct', 'hb_pct']) for (let k = 1; k <= N; k++) {
      const v = b[fld + ' ' + last], want = !isNum(v) ? v : /_pct$/.test(fld) ? v : v * factor(k);
      check(g, near(f[fld + ' ' + (last + k)], want, 0.02), `${b.key} . ${fld} ${last + k}: ${fmt(f[fld + ' ' + (last + k)])}, expected ${fmt(want)}`);
    }
  }
  const g2 = 'years › ga_oh', om = byKey(yrs.data.ga_oh);
  for (const b of base.data.ga_oh) {
    const f = om.get(b.key);
    if (!check(g2, f, `${b.key}: missing`)) continue;
    for (const k of Object.keys(b)) if (k !== 'source') check(g2, near(f[k], b[k]), `${b.key} . ${k}: ${fmt(f[k])}, was ${fmt(b[k])}`);
    for (const p of ['v', 'p']) for (let k = 1; k <= N; k++) { const v = b[p + ' ' + last], want = isNum(v) ? v * factor(k) : v; check(g2, near(f[p + ' ' + (last + k)], want, 0.02), `${b.key} . ${p} ${last + k}: ${fmt(f[p + ' ' + (last + k)])}, expected ${fmt(want)}`); }
  }
  sameRows('years › ga_components', base.data.ga_components, yrs.data.ga_components, () => true, Array.from({ length: N }, (_, k) => 'v ' + (last + k + 1)));
}
// Exposure: each table's periods, then N more (figures × factor); what a line is made of still adds up.
{
  const g = 'years › exposure', fm = byKey(yrs.data.exposure);
  check(g, yrs.data.exposure.length === base.data.exposure.length, `${yrs.data.exposure.length} rows, was ${base.data.exposure.length}`);
  for (const b of base.data.exposure) {
    const f = fm.get(b.key);
    if (!check(g, f, `${b.key}: missing`)) continue;
    const sec = base.data.exposure.find((x) => x.key === (b.parent || b.key)), n = Object.keys(sec).filter((k) => /^h\d+$/.test(k)).length;
    for (const k of Object.keys(b)) check(g, near(f[k], b[k]), `${b.key} . ${k}: ${fmt(f[k])}, was ${fmt(b[k])}`);
    for (let k = 1; k <= N; k++) {
      if (b.kind === 'section') { check(g, f['h' + (n + k)] != null, `${b.key} . h${n + k}: none`); continue; }
      const v = b['p' + n], want = isNum(v) ? v * factor(k) : v;
      check(g, near(f['p' + (n + k)], want, 0.02), `${b.key} . p${n + k}: ${fmt(f['p' + (n + k)])}, expected ${fmt(want)}`);
    }
  }
  const g2 = 'years › exposure_parts', P2 = yrs.data.exposure_parts;
  const pm = byKey(P2);
  for (const b of base.data.exposure_parts) { const f = pm.get(b.key); if (check(g2, f, `${b.key}: missing`)) for (const k of Object.keys(b)) check(g2, near(f[k], b[k]), `${b.key} . ${k}: ${fmt(f[k])}, was ${fmt(b[k])}`); }
  for (const r of yrs.data.exposure.filter((r) => P2.some((p) => p.row === r.key))) {
    const parts = P2.filter((p) => p.row === r.key);
    for (const k of Object.keys(r).filter((k) => /^p\d+$/.test(k))) if (isNum(r[k])) check(g2, near(sumOf(parts, k), r[k], 1), `${r.key} . ${k}: parts add up to ${fmt(sumOf(parts, k))}, not ${fmt(r[k])}`);
  }
}

// ---- project -----------------------------------------------------------------------------
const isNew = (r) => r.project === NEW;
// The rows that were there are as in the 'years' run (P&L remainders and totals over projects aside).
for (const ds of ['consol_cf', 'landowner_cf', 'homebuilder_cf', 'consol_project_pl', 'consol_components', 'project_irr', 'project_summary', 'project_roe', 'project_timeline', 'project_sales', 'project_entity'])
  sameRows('project › ' + ds, yrs.data[ds], prj.data[ds], (r) => !isNew(r), ds === 'project_timeline' ? ['sheet_row'] : []);
for (const ds of ['landowner_pl', 'homebuilder_pl']) sameRows('project › ' + ds, yrs.data[ds], prj.data[ds], (r) => r.project !== CORP);
sameRows('project › consol_pl', yrs.data.consol_pl, prj.data.consol_pl, (r) => !r.level);
sameRows('project › kpi_extra', yrs.data.kpi_extra, prj.data.kpi_extra, (r) => r.project !== ALL);
sameRows('project › project_profile', yrs.data.project_profile.map((r) => Object.assign({ key: r.project }, r)), prj.data.project_profile.map((r) => Object.assign({ key: r.project }, r)));

// The new project's lines: Brook Hollow's, SHIFT periods later.
function shifted(g, rows, P, total) {
  const src = rows.filter((r) => r.project === FROM), got = byKey(rows.filter(isNew));
  check(g, got.size === src.length && src.length, `${got.size} lines for ${NEW}, ${FROM} has ${src.length}`);
  for (const b of src) {
    const key = NEW + b.key.slice(FROM.length), f = got.get(key);
    if (!check(g, f, `${key}: missing`)) continue;
    check(g, f.line === b.line && f.kind === b.kind, `${key}: ${f.line} / ${f.kind}`);
    P.forEach((p, j) => { const want = b.kind === 'header' ? null : j >= SHIFT ? b[P[j - SHIFT]] : 0; check(g, near(f[p], want), `${key} ${p}: ${fmt(f[p])}, expected ${fmt(want)}`); });
    if (total && b.kind !== 'header' && f.Total != null) check(g, near(f.Total, P.reduce((s, p) => s + (f[p] || 0), 0), 0.1), `${key} Total ${fmt(f.Total)}`);
  }
}
for (const ds of ['consol_cf', 'landowner_cf', 'homebuilder_cf']) {
  shifted('project › ' + ds, prj.data[ds], prj.report.periods[ds], true);
  check('project › ' + ds, prj.data[ds].some((r) => isNew(r) && /^sales$/i.test(r.line) && prj.report.periods[ds].slice(-N).some((p) => r[p] > 0)), `${NEW} has no sales in the new years`);
}
for (const ds of ['landowner_pl', 'homebuilder_pl']) shifted('project › ' + ds, prj.data[ds], periodsOf(prj.data[ds]), true);
{
  const g = 'project › consol_pl', P = periodsOf(prj.data.consol_pl);
  const kids = prj.data.consol_pl.filter(isNew);
  check(g, kids.length, `no ${NEW} lines`);
  const pl = prj.data.consol_project_pl.filter(isNew);
  for (const k of kids) {
    const s = pl.find((x) => X.lib.concept(x.line) === X.lib.concept(k.line) && x.kind !== 'header');
    if (s) for (const p of P) check(g, near(k[p], s[p], 0.011), `${k.key} ${p}: ${fmt(k[p])}, project P&L ${fmt(s[p])}`);
  }
}
{
  const g = 'project › consol_project_pl';
  checkProjectPL(g, prj);
  check(g, prj.data.consol_project_pl.filter(isNew).length === prj.data.consol_project_pl.filter((r) => r.project === FROM).length, `${NEW} lines`);
}
checkComponents('project › consol_components', prj);
check('project › consol_components', prj.data.consol_components.some(isNew), `no ${NEW} components`);
{
  const g = 'project › project_irr';
  checkIRR(g, prj, isNew);
  for (const ent of ['consol', 'landowner', 'homebuilder']) {
    const f = prj.data.project_irr.find((r) => r.key === ent + '|' + NEW), b = prj.data.project_irr.find((r) => r.key === ent + '|' + FROM);
    if (check(g, f, `${ent}|${NEW}: missing`)) check(g, near(f.pretax_equity_irr, b.pretax_equity_irr, 1e-9), `${f.key} IRR ${f.pretax_equity_irr}`);
  }
}
for (const ds of ['project_summary', 'project_roe']) {
  const g = 'project › ' + ds, rows = prj.data[ds];
  for (const b of rows.filter((r) => r.project === FROM)) {
    const f = rows.find((r) => r.key === b.entity + '|' + NEW);
    if (!check(g, f, `${b.entity}|${NEW}: missing`)) continue;
    for (const k of ['revenue', 'gross_profit', 'net_profit', 'equity_infused', 'debt_raised', 'roe']) if (k in b) check(g, near(f[k], isNum(b[k]) ? b[k] * SCALE : b[k], 1e-6 * Math.max(1, Math.abs(b[k] || 0))), `${f.key} . ${k}: ${fmt(f[k])}`);
  }
}
{
  const g = 'project › project_profile', f = prj.data.project_profile.find(isNew), b = prj.data.project_profile.find((r) => r.project === FROM);
  const rev = prj.data.project_summary.find((r) => r.key === 'consol|' + NEW);
  if (check(g, f, `${NEW}: missing`)) {
    for (const k of ['acreage', 'units', 'nsa_sqft', 'avg_home_sqft']) check(g, near(f[k], b[k]), `${k}: ${fmt(f[k])}, ${FROM} ${fmt(b[k])}`);
    check(g, f.location === 'Austin' && f.report_name === NEW_SHORT, `report name / location: ${f.report_name} / ${f.location}`);
    check(g, near(f.gross_revenue_m, Math.round(rev.revenue / 1e4) / 100, 0.001), `gross revenue ${f.gross_revenue_m}`);
  }
}
{
  const g = 'project › project_timeline', rows = prj.data.project_timeline;
  const src = rows.filter((r) => r.project === FROM), got = rows.filter(isNew);
  check(g, got.length === src.length && src.length, `${got.length} timeline rows for ${NEW}, ${FROM} has ${src.length}`);
  for (const b of src) {
    const f = got.find((r) => r.key === NEW + b.key.slice(FROM.length));
    if (check(g, f, `${NEW + b.key.slice(FROM.length)}: missing`)) check(g, f.start === isoLater(b.start, SHIFT) && f.finish === isoLater(b.finish, SHIFT) && f.units === b.units && f.input_name.startsWith(NEW_SHORT), `${f.key}: ${f.start} – ${f.finish}`);
  }
}
{
  const g = 'project › project_entity', rows = prj.data.project_entity;
  for (const b of rows.filter((r) => r.project === FROM)) {
    const f = rows.find((r) => r.key === NEW + '|' + b.entity);
    if (!check(g, f, `${NEW}|${b.entity}: missing`)) continue;
    for (const k of ['timeline', 'land_parcel_receipt', 'sales_commencement', 'development_completion', 'hand_over', 'equity_release']) check(g, f[k] === monLater(b[k], SHIFT), `${f.key} . ${k}: ${f[k]}, ${FROM} ${b[k]}`);
    const was = yearOf(base.report.periods[b.entity.toLowerCase() + '_cf'].slice(-1)[0]);
    check(g, Object.keys(f).some((k) => k.startsWith('equity FY') && yearOf(k.slice(7)) > was && f[k]), `${f.key}: no equity after FY${was}`);
  }
  await checkEquity(g, prj, P.books);
}
{
  const g = 'project › project_sales', rows = prj.data.project_sales.filter(isNew);
  check(g, rows.some((r) => r.entity === 'Homebuilder' && r.year > yearOf(base.report.periods.homebuilder_cf.slice(-1)[0])), `${NEW}: no Homebuilder sales in the new years`);
  checkSales(g, prj, isNew);
}
{
  const g = 'project › kpi_extra', rows = prj.data.kpi_extra;
  checkKPI(g, prj, isNew);
  for (const b of rows.filter((r) => r.project === FROM)) {
    const f = rows.find((r) => r.key === b.entity + '|' + NEW);
    if (check(g, f, `${b.entity}|${NEW}: missing`)) check(g, f.start === isoLater(b.start, SHIFT) && f.completion === isoLater(b.completion, SHIFT), `${f.key}: ${f.start} – ${f.completion}`);
  }
}
{
  const g = 'project › actuals_plan';
  const lastY = checkPlan(g, prj);
  check(g, lastY === yearOf(base.report.periods.consol_cf.slice(-1)[0]) + N, `last year FY${lastY}`);
  // The new project in every statement, with figures in the statement's own last year.
  for (const st of ['consol_cf', 'landowner_cf', 'homebuilder_cf', 'consol_pl', 'landowner_pl', 'homebuilder_pl']) {
    const y = periodsOf(prj.data[st]).slice(-1)[0], rows = prj.data.actuals_plan.filter((r) => r.stmt === st && isNew(r));
    check(g, rows.length && rows.some((r) => r.role !== 'header' && r[y] != null), `${st}: ${rows.length} ${NEW} lines, none with ${y}`);
  }
}

// The Actuals Excel download on the plan with the extra years and project: formulas, values and
// upload round trip, as test/actuals-xlsx.mjs checks them for the shipped plan.
{
  const g = 'project › Actuals Excel (test/actuals-xlsx.mjs)';
  let out;
  try { out = execFileSync(process.execPath, [join(here, 'actuals-xlsx.mjs'), '--plan=-'], { input: JSON.stringify(prj.data.actuals_plan), encoding: 'utf8' }); check(g, /^OK/m.test(out), out.trim()); }
  catch (e) { check(g, false, String(e.stdout || e.message).trim().split('\n').slice(-6).join(' | ')); }
  if (out) console.log('  actuals-xlsx: ' + out.trim().split('\n').join(' | '));
}

if (opt('dump')) { writeFileSync(opt('dump'), JSON.stringify(prj.data)); console.log(`wrote ${opt('dump')}`); }
if (opt('write')) {
  vm.runInThisContext(readFileSync(join(root, 'src', 'xlsx-write.js'), 'utf8'), { filename: 'xlsx-write.js' });
  for (const b of P.books) {
    const f = prj.report.files.find((x) => x.name === b.name), sheets = [];
    if (!f || !f.model) continue;
    for (const n of [...new Set(b.wb.served().concat(X.MODELS[f.model].need))]) {
      const s = await b.wb.sheet(n), rows = [];
      for (let r = 1; r <= s.maxRow; r++) {
        const row = [];
        for (let c = 1; c <= s.maxCol; c++) { const v = s.get(r, c), fx = s.formula(r, c); row.push(fx ? { f: fx, v: v == null ? '' : v } : v); }
        rows.push(row);
      }
      sheets.push({ name: n, rows });
    }
    writeFileSync(join(opt('write'), b.name), await XLSXWrite.build({ sheets }));
  }
  console.log(`wrote the changed workbooks to ${opt('write')}`);
}

let bad = 0;
for (const [name, g] of Object.entries(G)) {
  if (g.bad.length) bad++;
  console.log(`${g.bad.length ? '✗' : '✓'} ${name}: ${g.n} checks${g.bad.length ? `, ${g.bad.length} failed` : ''}`);
  g.bad.slice(0, show).forEach((m) => console.log('    ' + m));
}
console.log(bad ? `\n${bad} group(s) failed` : '\nall checks pass: more years and a new project are read');
process.exit(bad ? 1 : 0);
