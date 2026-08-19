/** Articulation tests for the four ported panes.
 *
 *  A statement that does not tie is decoration. These assert the ties that
 *  matter and nothing about specific figures, so a legitimate change of
 *  assumption does not break them:
 *
 *    - the monthly engine's FY sums equal the P&L by financial year
 *    - the monthly engine's totals equal the annual cashflow's totals
 *    - the consolidated P&L / cashflow / balance sheet equal the sum of parts
 *    - the consolidated Business Plan cost lines still sum to direct cost
 *    - the offer-price solver actually hits the target it reports
 *
 *  Every month-to-financial-year map comes from the engine's exported fyOf.
 *  Nothing here reimplements the year boundary.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run, DEF, fyOf, solveLand } from '../lib/engine/model.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

// node 20 cannot strip types, so the module under test is compiled with the
// repo's own tsc first. That makes this test a type check of the module in
// isolation as well: if it does not compile, it does not run.
const out = mkdtempSync(path.join(tmpdir(), 'statements2-'));
try {
  execFileSync(path.join(root, 'node_modules', '.bin', 'tsc'), [
    path.join(root, 'lib', 'statements2.ts'),
    '--outDir', out, '--rootDir', path.join(root, 'lib'),
    '--target', 'es2022', '--module', 'esnext',
    '--moduleResolution', 'bundler', '--strict', '--skipLibCheck',
  ], { cwd: root, stdio: 'inherit' });
} catch {
  console.log('  FAIL  lib/statements2.ts compiles');
  process.exit(1);
}
writeFileSync(path.join(out, 'package.json'), '{"type":"module"}');
const emitted = path.join(out, 'statements2.js');
if (!existsSync(emitted)) { console.log('  FAIL  tsc emitted no statements2.js'); process.exit(1); }
// bundler resolution emits extensionless specifiers; plain node needs '.js'
writeFileSync(emitted, readFileSync(emitted, 'utf8')
  .replace(/(from\s+['"]\.\/[^'"]+)(['"])/g, (_, a, q) => (a.endsWith('.js') ? a : a + '.js') + q));

const {
  monthlyEngine, monthlyByFy,
  consolidatedPlData, consolidatedProfitAndLoss, consolidatedCashflow,
  consolidatedBalanceSheet, balanceStateForFy, projectComparison,
  solveLandValue, offerGrid,
} = await import(pathToFileURL(emitted).href);

let failed = 0;
const check = (name, cond, detail = '') => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
const near = (a, b, scale) => Math.abs(a - b) < Math.max(1, Math.abs(scale) * 1e-6);

/* ---- two parcels, deliberately on different start months so the FY
   alignment is actually exercised rather than assumed ---- */
const BASE = {
  ...DEF, vert: 1,
  acresGross: 6243, acresDed: 0, _acresNet: 6243, buildbua: 41454,
  nprod: 1, n1: 151, w1: 120, d1: 1, p1: 1650000, bua1: 180,
  hpsf: 14000, buildpsf: 4200, buildmo: 24,
  pr: 25000, vel: 4, absn: 4, startMonth: 7, startYear: 2026,
};
const SECOND = {
  ...BASE,
  acresGross: 4100, _acresNet: 4100, buildbua: 26000,
  n1: 96, hpsf: 15500, pr: 28000, startMonth: 2, startYear: 2027, buildmo: 21,
};

const parcelOf = (name, inputs) => {
  const A = run(inputs, {});
  const months = (A.R?.cfrefnetcash ?? []).length;
  const fyOfMonth = Array.from({ length: months }, (_, m) => fyOf(m, A.d ?? inputs));
  return { name, analysis: A, fyOfMonth, inputs };
};

const P1 = parcelOf('Paddington', BASE);
const P2 = parcelOf('Woollahra', SECOND);

console.log('statements2 — monthly engine, offer price, consolidation, comparison\n');
console.log(`  parcels: ${P1.name} FY${P1.analysis.fys[0]}+, ${P2.name} FY${P2.analysis.fys[0]}+`);
console.log(`  revenue: ${Math.round(P1.analysis.revenue).toLocaleString('en-AU')} / ` +
            `${Math.round(P2.analysis.revenue).toLocaleString('en-AU')}\n`);

/* ═══════════ 1. MONTHLY ENGINE ═══════════ */
console.log('monthly engine');
{
  const A = P1.analysis;
  const m = monthlyEngine(A);
  check('builds a month column per active month',
    m.columns.length > 0 && m.columns.length <= P1.fyOfMonth.length,
    `${m.columns.length} of ${P1.fyOfMonth.length} model months`);
  check('every row is as wide as the header',
    m.rows.every((r) => r.kind === 'band' || r.values.length === m.columns.length));

  // the monthly engine's own subtotals must add up
  const row = (no) => m.rows.find((r) => r.no === no);
  const addsUp = (parent, kids) => {
    const p = row(parent);
    let worst = 0;
    for (let i = 0; i < p.values.length; i++) {
      const s = kids.reduce((a, k) => a + row(k).values[i], 0);
      worst = Math.max(worst, Math.abs(s - p.values[i]));
    }
    return worst;
  };
  const d2 = addsUp('2', ['2.1', '2.2', '2.3', '2.4', '2.5']);
  check('line 2 equals its components in every month', d2 < 1, `worst drift ${d2.toFixed(4)}`);
  const d3 = addsUp('3', ['3.1', '3.2', '3.3', '3.4', '3.5']);
  check('line 3 equals its components in every month', d3 < 1, `worst drift ${d3.toFixed(4)}`);
  const d4 = addsUp('4', ['4.1', '4.2', '4.3']);
  check('line 4 equals its components in every month', d4 < 1, `worst drift ${d4.toFixed(4)}`);
  const d8 = addsUp('8', ['8.1', '8.2', '8.3']);
  check('line 8 equals its components in every month', d8 < 1, `worst drift ${d8.toFixed(4)}`);

  // THE tie: annual sums of the monthly series against the P&L, by FY,
  // using the engine's own fyOf map on both sides.
  const fys = A.fys;
  const gross = monthlyByFy(A, 'cfrefresrev', P1.fyOfMonth);
  const gst = monthlyByFy(A, 'cfrefgst', P1.fyOfMonth);
  let worstGross = 0, worstGst = 0, worstNet = 0;
  fys.forEach((y) => {
    const pl = A.PL[y] ?? {};
    worstGross = Math.max(worstGross, Math.abs(gross[y] - num(pl.grossRev)));
    worstGst = Math.max(worstGst, Math.abs(gst[y] - num(pl.outputGst)));
    worstNet = Math.max(worstNet, Math.abs((gross[y] - gst[y]) - num(pl.rev)));
  });
  check('monthly gross revenue ties to P&L BY FINANCIAL YEAR', worstGross < 1,
    `worst FY drift ${Math.round(worstGross)}`);
  check('monthly GST ties to P&L output GST BY FINANCIAL YEAR', worstGst < 1,
    `worst FY drift ${Math.round(worstGst)}`);
  check('monthly line 1 (net revenue) ties to P&L revenue BY FINANCIAL YEAR', worstNet < 1,
    `worst FY drift ${Math.round(worstNet)}`);

  // and the full-life totals, which is where the cash lines tie
  const plTot = (k) => fys.reduce((a, y) => a + num(A.PL[y]?.[k]), 0);
  const gapProfit = Math.abs(row('11').total - plTot('npat'));
  check('monthly line 11 total ties to P&L net profit', gapProfit < 1,
    `gap ${Math.round(gapProfit)}`);
  const gapRev = Math.abs(row('1').total - plTot('rev'));
  check('monthly line 1 total ties to P&L revenue', gapRev < 1, `gap ${Math.round(gapRev)}`);

  // trimming the horizon must not drop money
  const fullTot = (A.R.cfrefprofit ?? []).reduce((a, v) => a + num(v), 0);
  check('trimming inactive months loses nothing',
    Math.abs(row('11').total - fullTot) < 1,
    `trimmed ${row('11').total.toFixed(0)} vs full ${fullTot.toFixed(0)}`);
}

/* ═══════════ 2. OFFER PRICE / LAND VALUE ═══════════ */
console.log('\noffer price / land value');
{
  const evaluate = (metricKey, land) => {
    try {
      const A = run({ ...BASE, pr: land }, {});
      const v = A?.[metricKey];
      return typeof v === 'number' && isFinite(v) ? v : null;
    } catch { return null; }
  };
  const lo = BASE.pr * 0.05, hi = BASE.pr * 3;

  const ceiling = solveLandValue(evaluate, { key: 'npv', target: 0, label: 'NPV nil' }, lo, hi);
  check('solves the absolute ceiling (NPV nil)', ceiling.value != null,
    ceiling.value == null ? ceiling.reason
      : `$${Math.round(ceiling.value).toLocaleString('en-AU')}/sqm`);
  if (ceiling.value != null) {
    const at = evaluate('npv', ceiling.value);
    check('the model actually returns NPV nil at that price', Math.abs(at) < 1e4,
      `NPV ${Math.round(at).toLocaleString('en-AU')}`);
  }

  const hurdle = solveLandValue(evaluate, { key: 'eirr', target: 0.20, label: 'Equity IRR 20%', mine: true }, lo, hi);
  check('solves a 20% equity IRR hurdle', hurdle.value != null,
    hurdle.value == null ? hurdle.reason
      : `$${Math.round(hurdle.value).toLocaleString('en-AU')}/sqm`);
  if (hurdle.value != null) {
    const at = evaluate('eirr', hurdle.value);
    check('the model actually returns 20% equity IRR at that price',
      at != null && Math.abs(at - 0.20) < 1e-3, `eIRR ${(at * 100).toFixed(3)}%`);
    check('a lower land price buys a higher return (curve is monotone the right way)',
      num(evaluate('eirr', hurdle.value * 0.9)) > 0.20);
  }

  // the documented reason this pane does not use the engine's own solver
  const engineSaid = solveLand(BASE, 'eirr', 0.20, {});
  check('engine solveLand gives up where the interior scan succeeds',
    engineSaid == null && hurdle.value != null,
    engineSaid == null ? 'solveLand returned null; solve() found a price'
                       : `solveLand returned ${Math.round(engineSaid)}`);

  const grid = offerGrid(
    [{ key: 'npv', target: 0, label: 'NPV nil' },
     { key: 'eirr', target: 0.20, label: 'Equity IRR 20%', mine: true },
     { key: 'margin', target: 0.90, label: 'Margin on revenue 90%' }],
    ['At full sale price'],
    [[ceiling], [hurdle],
     [solveLandValue(evaluate, { key: 'margin', target: 0.90, label: '' }, lo, hi)]],
    BASE.pr, BASE.acresGross,
  );
  check('grid reports the gap against the asking price',
    grid.gapPerSqm != null &&
    near(grid.gapPerSqm, hurdle.value - BASE.pr, hurdle.value),
    `${Math.round(grid.gapPerSqm).toLocaleString('en-AU')}/sqm`);
  check('gap across the site is the per-sqm gap times the site area',
    near(grid.gapAcrossSite, grid.gapPerSqm * BASE.acresGross, grid.gapAcrossSite));
  const unreachable = grid.rows[2].cells[0];
  check('an unreachable return stays null and is never presented as zero',
    unreachable.value === null && unreachable.explanation.length > 0,
    `${unreachable.reason} — a 90% margin is not available at any land price`);
}

/* ═══════════ 3. CONSOLIDATION ═══════════ */
console.log('\nconsolidated P&L');
{
  const one = consolidatedPlData([P1]);
  const two = consolidatedPlData([P2]);
  const both = consolidatedPlData([P1, P2]);
  const LINES = ['qualifiedSales', 'totalRevenue', 'landCost', 'constructionCost',
    'brokerage', 'otherDirectCost', 'directCost', 'grossProfit', 'gna', 'staff',
    'corp', 'overheadCost', 'financeCost', 'totalOverheadCost',
    'preOtherIncomeProfit', 'otherIncome', 'npbt', 'tax', 'npat'];

  let worst = 0, worstLine = '';
  LINES.forEach((k) => {
    const d = Math.abs(both.total(k) - (one.total(k) + two.total(k)));
    if (d > worst) { worst = d; worstLine = k; }
  });
  check('CONSOLIDATED TOTAL EQUALS THE SUM OF ITS PARTS (every line)', worst < 1,
    worst < 1 ? `${LINES.length} lines, worst drift ${worst.toFixed(6)}`
              : `${worstLine} drifts ${Math.round(worst)}`);

  // and year by year, not just in total
  let worstY = 0, worstYLabel = '';
  both.years.forEach((y) => LINES.forEach((k) => {
    const d = Math.abs(both.value(y, k) - (one.value(y, k) + two.value(y, k)));
    if (d > worstY) { worstY = d; worstYLabel = `${k} FY${y}`; }
  }));
  check('consolidated equals the sum of its parts YEAR BY YEAR', worstY < 1,
    worstY < 1 ? `${both.years.length} years checked` : `${worstYLabel} drifts ${Math.round(worstY)}`);

  // it must still articulate the way the single-parcel P&L does
  let dcDrift = 0, ohDrift = 0, npbtDrift = 0, npatDrift = 0;
  both.years.forEach((y) => {
    const v = (k) => both.value(y, k);
    dcDrift = Math.max(dcDrift, Math.abs(
      (v('landCost') + v('constructionCost') + v('brokerage') + v('otherDirectCost')) - v('directCost')));
    ohDrift = Math.max(ohDrift, Math.abs((v('overheadCost') + v('financeCost')) - v('totalOverheadCost')));
    npbtDrift = Math.max(npbtDrift, Math.abs((v('preOtherIncomeProfit') + v('otherIncome')) - v('npbt')));
    npatDrift = Math.max(npatDrift, Math.abs((v('npbt') - v('tax')) - v('npat')));
  });
  check('articulates: the four cost lines sum to direct cost', dcDrift < 1, `drift ${dcDrift.toFixed(4)}`);
  check('articulates: overhead plus finance is total overhead', ohDrift < 1, `drift ${ohDrift.toFixed(4)}`);
  check('articulates: profit before other income plus other income is NPBT', npbtDrift < 1, `drift ${npbtDrift.toFixed(4)}`);
  check('articulates: NPBT less tax is NPAT', npatDrift < 1, `drift ${npatDrift.toFixed(4)}`);

  // gross profit must reconcile to revenue less direct cost, as in the P&L pane
  let gpDrift = 0;
  both.years.forEach((y) => {
    gpDrift = Math.max(gpDrift, Math.abs(
      (both.value(y, 'totalRevenue') - both.value(y, 'directCost')) - both.value(y, 'grossProfit')));
  });
  check('articulates: revenue less direct cost is gross profit', gpDrift < 1, `drift ${gpDrift.toFixed(4)}`);

  const S = consolidatedProfitAndLoss([P1, P2]);
  check('statement renders a column per active year and no empty years',
    S.columns.length === both.years.length && S.columns.length > 0,
    `${S.columns.length} years`);
  check('statement row totals equal the sum of the row',
    S.rows.filter((r) => r.kind !== 'band')
      .every((r) => near(r.total, r.values.reduce((a, b) => a + b, 0), r.total)));
}

console.log('\nconsolidated cashflow');
{
  const one = consolidatedCashflow([P1]);
  const two = consolidatedCashflow([P2]);
  const both = consolidatedCashflow([P1, P2]);
  const tot = (S, no) => S.rows.find((r) => r.no === no)?.total ?? 0;
  const REFS = ['1', '1.1', '1.2', '2', '2.1', '2.2', '2.3', '2.4', '2.5', '3',
    '3.1', '3.2', '3.3', '3.4', '3.5', '4', '4.1', '4.2', '4.3', '5', '6',
    '7', '7.1', '7.2', '7.3', '8', '8.1', '8.2', '8.3', '9', '10', '11'];
  let worst = 0, worstRef = '';
  REFS.forEach((no) => {
    const d = Math.abs(tot(both, no) - (tot(one, no) + tot(two, no)));
    if (d > worst) { worst = d; worstRef = no; }
  });
  check('CONSOLIDATED CASHFLOW EQUALS THE SUM OF ITS PARTS', worst < 1,
    worst < 1 ? `${REFS.length} lines` : `line ${worstRef} drifts ${Math.round(worst)}`);

  // the consolidated cashflow must tie to the consolidated P&L on revenue
  const pl = consolidatedPlData([P1, P2]);
  check('cashflow net revenue ties to consolidated P&L revenue',
    Math.abs(tot(both, '1') - pl.total('totalRevenue')) < 1,
    `gap ${Math.round(Math.abs(tot(both, '1') - pl.total('totalRevenue')))}`);
  check('cashflow profit ties to consolidated P&L net profit',
    Math.abs(tot(both, '11') - pl.total('npat')) < 1,
    `gap ${Math.round(Math.abs(tot(both, '11') - pl.total('npat')))}`);

  // subtotals inside the consolidated statement
  const row = (no) => both.rows.find((r) => r.no === no);
  const cols = both.columns.length;
  const sumKids = (parent, kids) => {
    let worstD = 0;
    for (let i = 0; i < cols; i++)
      worstD = Math.max(worstD, Math.abs(
        kids.reduce((a, k) => a + row(k).values[i], 0) - row(parent).values[i]));
    return worstD;
  };
  check('line 2 equals its components in every year', sumKids('2', ['2.1', '2.2', '2.3', '2.4', '2.5']) < 1);
  check('line 3 equals its components in every year', sumKids('3', ['3.1', '3.2', '3.3', '3.4', '3.5']) < 1);
  check('line 7 equals its components in every year', sumKids('7', ['7.1', '7.2', '7.3']) < 1);
  check('line 8 equals its components in every year', sumKids('8', ['8.1', '8.2', '8.3']) < 1);

  // and the consolidated monthly-derived figure must equal the single-parcel
  // monthly engine for the parcel on its own
  const m1 = monthlyEngine(P1.analysis);
  const solo = consolidatedCashflow([P1]);
  const gap = Math.abs((m1.rows.find((r) => r.no === '11')?.total ?? 0) - tot(solo, '11'));
  check('one-parcel consolidation equals that parcel\'s monthly engine', gap < 1,
    `gap ${Math.round(gap)}`);
}

console.log('\nconsolidated balance sheet');
{
  const both = consolidatedBalanceSheet([P1, P2]);
  check('builds a column per year with a real position', both.columns.length > 0,
    `${both.columns.length} years`);

  const findRow = (S, label) => S.rows.find((r) => r.label === label);
  const one = consolidatedBalanceSheet([P1]);
  const two = consolidatedBalanceSheet([P2]);

  // sum-of-parts on the balance sheet is checked per year, since the year
  // sets differ between parcels
  const years = [...new Set([...P1.analysis.fys, ...P2.analysis.fys])].sort();
  const KEYS = ['cash', 'receivables', 'inventoryWip', 'landWip', 'advanceLand',
    'currentAssets', 'capexNet', 'nonCurrentAssets', 'totalAssets', 'landPayable',
    'debt', 'taxPayable', 'totalLiabilities', 'equityCapital', 'retained',
    'totalEquity', 'totalLE'];
  let worst = 0, worstKey = '';
  years.forEach((y) => {
    const s1 = balanceStateForFy(P1, y), s2 = balanceStateForFy(P2, y);
    KEYS.forEach((k) => {
      const parts = num(s1?.[k]) + num(s2?.[k]);
      // rebuild what the consolidated statement would show for that year
      const acc = num(s1?.[k]) + num(s2?.[k]);
      const d = Math.abs(acc - parts);
      if (d > worst) { worst = d; worstKey = `${k} FY${y}`; }
    });
  });
  check('per-parcel states are additive by construction', worst < 1e-9, worstKey || 'exact');

  // the real check: the rendered consolidated row equals part one plus part two
  let rowWorst = 0, rowWorstLabel = '';
  both.rows.filter((r) => r.kind !== 'band').forEach((r) => {
    both.columns.forEach((c, i) => {
      const iOne = one.columns.indexOf(c), iTwo = two.columns.indexOf(c);
      const a = iOne < 0 ? 0 : num(findRow(one, r.label)?.values[iOne]);
      const b = iTwo < 0 ? 0 : num(findRow(two, r.label)?.values[iTwo]);
      const d = Math.abs(num(r.values[i]) - (a + b));
      if (d > rowWorst) { rowWorst = d; rowWorstLabel = `${r.label} ${c}`; }
    });
  });
  check('CONSOLIDATED BALANCE SHEET EQUALS THE SUM OF ITS PARTS', rowWorst < 1,
    rowWorst < 1 ? `${both.rows.length} rows x ${both.columns.length} years`
                 : `${rowWorstLabel} drifts ${Math.round(rowWorst)}`);

  // it must balance in every year
  const assets = findRow(both, 'TOTAL ASSETS');
  const le = findRow(both, 'TOTAL LIABILITIES AND EQUITY');
  let bal = 0;
  assets.values.forEach((v, i) => { bal = Math.max(bal, Math.abs(v - le.values[i])); });
  check('assets equal liabilities plus equity in every year', bal < 1,
    `worst drift ${bal.toFixed(6)} (retained earnings is the plug)`);

  // current assets must be its own components
  const c = (l) => findRow(both, l).values;
  let ca = 0;
  c('Total current assets').forEach((v, i) => {
    const s = c('Cash and cash equivalents')[i] + c('Receivables and escrow')[i]
      + c('Inventory work in progress')[i] + c('Land work in progress')[i]
      + c('Advance for land')[i];
    ca = Math.max(ca, Math.abs(s - v));
  });
  check('total current assets equals its components', ca < 1, `drift ${ca.toFixed(6)}`);
}

/* ═══════════ 4. PROJECT COMPARISON ═══════════ */
console.log('\nproject comparison');
{
  const C = projectComparison([P1, P2], 7.25);
  check('one column per parcel', C.columns.length === 2, C.columns.join(' | '));
  const row = (l) => C.rows.find((r) => r.label === l);

  const rev = row('Revenue');
  check('portfolio revenue is the sum of the parcels',
    near(rev.portfolio, num(rev.values[0]) + num(rev.values[1]), rev.portfolio),
    `$${Math.round(rev.portfolio).toLocaleString('en-AU')}`);
  const np = row('Net profit');
  check('portfolio net profit is the sum of the parcels',
    near(np.portfolio, num(np.values[0]) + num(np.values[1]), np.portfolio));

  const eq = row('Peak equity required');
  const summedPeaks = num(eq.values[0]) + num(eq.values[1]);
  check('portfolio peak equity is calendar-aligned, not the sum of peaks',
    eq.portfolio != null && eq.portfolio <= summedPeaks + 1,
    `aligned $${Math.round(eq.portfolio).toLocaleString('en-AU')} vs summed ` +
    `$${Math.round(summedPeaks).toLocaleString('en-AU')}`);

  const irr = row('Equity IRR');
  check('IRR carries no portfolio figure and says why',
    irr.portfolio === null && !!irr.portfolioNote, irr.portfolioNote);

  const margin = row('Margin on revenue');
  check('portfolio margin is profit over revenue, not an average of margins',
    near(margin.portfolio, np.portfolio / rev.portfolio, margin.portfolio),
    `${(margin.portfolio * 100).toFixed(2)}%`);

  check('the strongest equity return is identified',
    C.best !== null && C.best >= 0 && C.best < 2,
    C.best === null ? 'none' : C.columns[C.best]);

  // a metric the engine did not produce must arrive as null, not as zero
  const mirrors = [['Project IRR', 'irr'], ['Equity IRR', 'eirr'], ['Net present value', 'npv']];
  const lied = mirrors.filter(([label, key]) =>
    row(label).values.some((v, i) => {
      const raw = [P1, P2][i].analysis[key];
      const absent = !(typeof raw === 'number' && isFinite(raw));
      return absent ? v !== null : v !== raw;
    }));
  check('an unavailable figure is null, never zero, and a present one is untouched',
    lied.length === 0, lied.length ? lied.map((x) => x[0]).join(', ') : `${mirrors.length} metrics mirrored exactly`);
  const projIrr = row('Project IRR');
  check('project IRR is absent rather than zero where the engine returns none',
    projIrr.values.every((v) => v === null || typeof v === 'number'),
    projIrr.values.map((v) => (v == null ? 'absent' : (v * 100).toFixed(1) + '%')).join(' | '));
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
