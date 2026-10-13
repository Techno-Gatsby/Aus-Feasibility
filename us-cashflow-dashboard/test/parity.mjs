// Parity test: runs the page's own extraction code on the model workbooks and compares
// every dataset with the data the dashboard currently ships (src/baseline.json).
//
//   node test/parity.mjs [fixturesDir] [--only=consol_cf,kpi_extra] [--show=20]
//
// fixturesDir (default ./fixtures, gitignored) must hold the three V5 models and the
// BP Input Sheets workbook. Exit code 1 when any dataset differs by more than $1.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const args = process.argv.slice(2);
const opt = (k) => { const a = args.find((x) => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : null; };
const fixtures = args.find((a) => !a.startsWith('--')) || join(root, 'fixtures');
const only = opt('only') ? new Set(opt('only').split(',')) : null;
const show = +(opt('show') || 8);

// Load the same scripts the page loads, in the same order.
const html = readFileSync(join(root, 'build.mjs'), 'utf8');
const scripts = JSON.parse(html.match(/const SCRIPTS = (\[[^\]]*\])/)[1].replace(/'/g, '"'))
  .filter((f) => f === 'xlsx.js' || f === 'extract.js' || f.startsWith('derive-'));
for (const f of scripts) {
  try { vm.runInThisContext(readFileSync(join(root, 'src', f), 'utf8'), { filename: f }); }
  catch (e) { console.log(`! ${f} failed to load: ${e.message}`); }
}
const X = globalThis.SobhaExtract;

const baseline = JSON.parse(readFileSync(join(root, 'src', 'baseline.json'), 'utf8'));
// Differences explained by the workbooks themselves (the shipped figures came from an earlier model run).
const ACCEPTED = JSON.parse(readFileSync(join(root, 'test', 'accepted-diffs.json'), 'utf8'));
const books = [];
for (const f of readdirSync(fixtures).filter((f) => /\.xlsx$/i.test(f) && !f.startsWith('~$'))) {
  const b = readFileSync(join(fixtures, f));
  books.push({ name: f, wb: await XLSXLite.open(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) });
}
const t0 = Date.now();
const { data, report } = await X.build(books, baseline);
console.log(`extracted in ${Date.now() - t0} ms; models: ${report.files.map((f) => f.name + ' -> ' + (f.model || '?')).join(', ')}`);
for (const w of report.warnings) console.log('  warning:', w);

// Compare two values: numbers within $1 (ratios within 1e-4); everything else exactly.
function same(a, b, field) {
  if (typeof a === 'number' && typeof b === 'number') {
    const tol = Math.abs(b) <= 20 && !/units|unit|^ord$|^level$|year/.test(field) ? 1e-4 : 1;
    return Math.abs(a - b) <= tol;
  }
  if ((a == null || a === '') && (b == null || b === '')) return true;
  return a === b;
}

let bad = 0;
const datasets = Object.keys(baseline).filter((k) => !only || only.has(k));
for (const ds of datasets) {
  if (ds === 'project_photos') continue;
  const want = baseline[ds], got = data[ds];
  if (!report.refreshed.includes(ds)) { console.log(`- ${ds}: kept from baseline (not extracted)`); bad++; continue; }
  const keyOf = (r, i) => (r.key != null ? r.key : i);
  const gm = new Map(got.map((r, i) => [keyOf(r, i), r]));
  const wm = new Map(want.map((r, i) => [keyOf(r, i), r]));
  const missing = [...wm.keys()].filter((k) => !gm.has(k));
  const extra = [...gm.keys()].filter((k) => !wm.has(k));
  const diffs = [], acc = ACCEPTED[ds] || {};
  let accepted = 0;
  for (const [k, w] of wm) {
    const g = gm.get(k); if (!g) continue;
    for (const f of new Set([...Object.keys(w), ...Object.keys(g)])) {
      if (f === 'source' || f === 'image') continue;
      if (same(g[f], w[f], f)) continue;
      const a = acc[k + ' . ' + f];
      if (a && same(g[f], a.got, f)) { accepted++; continue; }
      diffs.push(`${k} . ${f}: got ${JSON.stringify(g[f])} want ${JSON.stringify(w[f])}`);
    }
  }
  const ok = !missing.length && !extra.length && !diffs.length;
  if (!ok) bad++;
  console.log(`${ok ? '✓' : '✗'} ${ds}: ${want.length} rows; missing ${missing.length}, extra ${extra.length}, differing values ${diffs.length}${accepted ? `; ${accepted} known model differences (test/accepted-diffs.json)` : ''}`);
  if (!ok) {
    missing.slice(0, show).forEach((k) => console.log('    missing', k));
    extra.slice(0, show).forEach((k) => console.log('    extra  ', k));
    diffs.slice(0, show).forEach((d) => console.log('    ', d));
  }
}
console.log(bad ? `\n${bad} dataset(s) differ` : '\nall datasets match');
process.exit(bad ? 1 : 0);
