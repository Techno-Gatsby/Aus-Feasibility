// The Actuals tab's Excel download and upload, on the plan in src/baseline.json (no fixtures):
// random actuals -> workbook -> every formula evaluated (a small evaluator for the forms the
// page writes) must equal what the tab shows (evalActuals); uploading the file gives the
// actuals back, typed cells win over the tab and blank ones keep it; the earlier layout works.
//   node test/actuals-xlsx.mjs [--seed=7]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = (f) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', f), 'utf8');
(0, eval)(src('xlsx.js'));
(0, eval)(src('xlsx-write.js'));
const plan = JSON.parse(src('baseline.json')).actuals_plan;

// app.js's Actuals and Excel sections, with the page around them stubbed.
const app = src('app.js'), a = app.indexOf('  // ---------- Actuals ----------'), b = app.indexOf('  // Removing a focused input');
if (a < 0 || b < a) throw new Error('Actuals section markers not found in app.js');
const NONPER = new Set(app.match(/const NONPER = new Set\((\[.*?\])\)/)[1].match(/'[^']*'/g).map((s) => s.slice(1, -1)));
const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
const M = new Function('NONPER', 'norm', 'isUnits', 'fmt', 'el', 'td', 'firstCell', 'render', 'dash', 'window', 'localStorage', 'document', 'CSS',
  app.slice(a, b) + '\nreturn { AST, actPeriods, evalActuals, isEditable, actualsWorkbook, importXlsx };')(
  NONPER, norm, (l) => norm(l) === 'sales unit', () => '', 0, 0, 0, () => {}, { data: () => ({ status: 'ok', data: plan }) }, {}, { getItem: () => null, setItem() {} }, {}, {});
await new Promise((r) => setTimeout(r, 5));
const { AST, actPeriods, evalActuals, isEditable } = M;

let seed = +((process.argv.find((x) => x.startsWith('--seed=')) || '').slice(7) || 7);
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const STMTS = [...new Set(plan.map((r) => r.stmt))];
const randomVals = (density) => {
  const v = {};
  for (const s of STMTS) {
    const rows = plan.filter((r) => r.stmt === s), P = actPeriods(rows);
    rows.forEach((r) => P.forEach((y, pi) => {
      if (!isEditable(r, pi) || rnd() > density) return;
      ((v[s] = v[s] || {})[r.project] = v[s][r.project] || {})[r.line + '|' + y] = rnd() < 0.1 ? 0 : Math.round((rnd() - 0.3) * 1e9) / 100;
    }));
  }
  return v;
};
const canon = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((x) => [x, v[x]])) : v));
let bad = 0;
const fail = (m) => { if (++bad <= 20) console.log('  ' + m); };

const vals1 = randomVals(0.6);
AST.vals = JSON.parse(JSON.stringify(vals1));
const bytes = await M.actualsWorkbook(plan, new Date());
const buf = () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const wb = await XLSXLite.open(buf());
const sheets = { Actuals: await wb.sheet('Actuals'), 'BP vs Actuals': await wb.sheet('BP vs Actuals') };
if (wb.sheetNames.join() !== 'BP vs Actuals,Actuals') fail('sheets: ' + wb.sheetNames);

// Values of cells, formulas evaluated as Excel does for IF / COUNT / SUM, + - *, = and "".
const memo = new Map();
function cell(sh, r, c) {
  const k = sh + '!' + r + ',' + c; if (memo.has(k)) return memo.get(k);
  memo.set(k, NaN);
  const s = sheets[sh], f = s.formula(r, c), v = f == null ? s.get(r, c) : evalF(f, sh);
  memo.set(k, v); return v;
}
function evalF(t, sh) {
  let i = 0;
  const eat = (x) => (t.startsWith(x, i) ? ((i += x.length), true) : false), want = (x) => { if (!eat(x)) throw new Error(`expected ${x} at ${i}: ${t}`); };
  const ref = () => {
    const m = t.slice(i).match(/^(?:(\w+)!)?([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?/); if (!m) return null;
    i += m[0].length;
    const c0 = XLSXLite.colNum(m[2]), c1 = m[4] ? XLSXLite.colNum(m[4]) : c0, out = [];
    for (let r = +m[3]; r <= +(m[5] || m[3]); r++) for (let c = c0; c <= c1; c++) out.push(cell(m[1] || sh, r, c));
    return out;
  };
  const prim = () => {
    if (eat('""')) return '';
    if (eat('-')) return -prim();
    const n = t.slice(i).match(/^\d+(\.\d+)?/); if (n) { i += n[0].length; return +n[0]; }
    if (eat('IF(')) { const l = expr(); want('='); const c = l === expr(); want(','); const x = expr(); want(','); const y = expr(); want(')'); return c ? x : y; }
    for (const fn of ['COUNT(', 'SUM(']) if (eat(fn)) {
      const xs = []; do { const s = i, r = ref(); if (r && /^[,)]/.test(t[i])) xs.push(...r); else { i = s; xs.push(expr()); } } while (eat(',')); want(')');
      const ns = xs.filter((v) => typeof v === 'number');
      return fn === 'SUM(' ? ns.reduce((p, q) => p + q, 0) : ns.length;
    }
    const r = ref(); if (r && r.length === 1) return r[0] == null ? '' : r[0]; // blank = "" in a comparison
    throw new Error(`cannot read ${t} at ${i}`);
  };
  const term = () => { let v = prim(); while (eat('*')) v *= prim(); return v; };
  const expr = () => { let v = term(); for (;;) if (eat('+')) v += term(); else if (eat('-')) v -= term(); else return v; };
  const v = expr(); if (i !== t.length) throw new Error('unread: ' + t.slice(i)); return v;
}
const same = (x, y) => (x == null || x === '' ? y == null : typeof x === 'number' && y != null && Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(y)));

const S = sheets.Actuals, B = sheets['BP vs Actuals'];
const hr = S.rowNums().find((r) => S.get(r, 1) === 'Statement'), head = {}, bhead = {};
Object.entries(S.row(hr)).forEach(([c, v]) => (head[v] = +c));
Object.entries(B.row(hr)).forEach(([c, v]) => (bhead[v] = +c));
let row = hr, nf = 0;
for (const s of STMTS) {
  const rows = plan.filter((r) => r.stmt === s), P = actPeriods(rows), A = evalActuals(s, rows, P), by = new Map();
  rows.forEach((r) => { if (!by.has(r.project)) by.set(r.project, []); by.get(r.project).push(r); });
  for (const r of [...by.values()].flatMap((x) => x.sort((p, q) => p.ord - q.ord))) {
    row++;
    if (S.get(row, 2) !== r.project || B.get(row, 2) !== r.project) { fail(`row ${row}: ${S.get(row, 2)} for ${r.key}`); continue; }
    if (r.kind === 'header') continue;
    let tot = null;
    P.forEach((y, pi) => {
      const c = head[y], want = A(r, pi), f = S.formula(row, c);
      if (want != null) tot = (tot || 0) + want;
      if (isEditable(r, pi) ? f != null : f == null && want != null) fail(`${r.key} ${y}: ${f == null ? 'no formula' : 'formula in an input cell'}`);
      if (f != null) nf++;
      if (!same(cell('Actuals', row, c), want)) fail(`${r.key} ${y} (${r.role}): Excel ${cell('Actuals', row, c)}, tab ${want}  =${f}`);
      if (!same(S.get(row, c), want)) fail(`${r.key} ${y}: saved value ${S.get(row, c)}, tab ${want}`);
      if (!same(B.get(row, bhead[y + ' BP']), r[y])) fail(`${r.key} ${y} BP: ${B.get(row, bhead[y + ' BP'])} vs ${r[y]}`);
      if (!same(cell('BP vs Actuals', row, bhead[y + ' Actual']), want)) fail(`${r.key} ${y}: BP vs Actuals link`);
    });
    if (r.kind !== 'balance' && !same(cell('BP vs Actuals', row, bhead['Total actual']), tot)) fail(`${r.key}: total actual ${cell('BP vs Actuals', row, bhead['Total actual'])} vs ${tot}`);
  }
}
if (row - hr !== plan.length) fail(`${row - hr} rows for ${plan.length} plan lines`);
console.log(`workbook ${(bytes.length / 1024).toFixed(0)} KB, ${plan.length} lines, ${nf} formulas checked against the tab`);

// Upload: into empty actuals gives them back; over other actuals typed cells win, blanks keep.
const file = { arrayBuffer: async () => buf() };
AST.vals = {};
await M.importXlsx(file);
if (canon(AST.vals) !== canon(vals1)) fail('upload into empty actuals does not give the downloaded ones back');
const vals2 = randomVals(0.5), want = JSON.parse(JSON.stringify(vals2));
for (const [s, ps] of Object.entries(vals1)) for (const [p, kv] of Object.entries(ps)) Object.assign(((want[s] = want[s] || {})[p] = want[s][p] || {}), kv);
AST.vals = JSON.parse(JSON.stringify(vals2));
await M.importXlsx(file);
if (canon(AST.vals) !== canon(want)) fail('upload over other actuals: typed cells should win and blank ones keep the tab\'s');

// The earlier layout (a sheet per statement, periods in row 4, BP / Actual in row 5) still reads.
const inp = plan.find((r) => r.stmt === 'consol_pl' && r.role === 'input' && r.project !== 'All Projects');
const old = await XLSXWrite.build({ sheets: [{ name: 'Consol P&L', rows: [[], [], [], [null, null, 'FY2027'], [null, null, 'BP', 'Actual'], [inp.project, inp.line, 1, 42]] }] });
AST.vals = {};
await M.importXlsx({ arrayBuffer: async () => old.buffer });
if (((AST.vals.consol_pl || {})[inp.project] || {})[inp.line + '|FY2027'] !== 42) fail('earlier upload layout not read');

console.log(bad ? `FAILED: ${bad} problem(s)` : 'OK: formulas match the tab, upload round-trips');
process.exit(bad ? 1 : 0);
