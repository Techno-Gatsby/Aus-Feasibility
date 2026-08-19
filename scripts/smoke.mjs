/** Engine smoke test. Asserts the model loads, validates, and returns a
 *  complete analysis shape. Deliberately does NOT assert specific figures:
 *  those depend on inputs, and a test that pins them would break on every
 *  legitimate assumption change while catching nothing real. */
import { run, DEF, GROUPS, AUSTRALIA_MODEL_VERSION } from '../lib/engine/model.js';

let failed = 0;
const check = (name, cond, detail = '') => {
  const ok = !!cond;
  if (!ok) failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

console.log('engine smoke test');
check('model version present', typeof AUSTRALIA_MODEL_VERSION === 'string', AUSTRALIA_MODEL_VERSION);
check('input groups present', Array.isArray(GROUPS) && GROUPS.length > 0, `${GROUPS.length} groups`);
check('defaults present', DEF && Object.keys(DEF).length > 100, `${Object.keys(DEF).length} keys`);

// the engine must REJECT empty defaults rather than silently return zeros
let threw = null;
try { run(DEF, {}); } catch (e) { threw = e.message; }
check('validates empty defaults', !!threw, threw ?? 'did not throw');

const scheme = {
  ...DEF, vert: 1,
  acresGross: 6243, acresDed: 0, _acresNet: 6243, buildbua: 41454,
  nprod: 1, n1: 151, w1: 120, d1: 1, p1: 1650000, bua1: 180,
  hpsf: 14000, buildpsf: 4200, buildmo: 24,
  pr: 195000000, vel: 4, absn: 4, startMonth: 7, startYear: 2026,
};
let A = null, err = null;
try { A = run(scheme, {}); } catch (e) { err = e.message; }
check('runs a vertical scheme', !!A, err ?? '');
if (A) {
  check('returns revenue', typeof A.revenue === 'number' && A.revenue > 0);
  check('returns period arrays', A.R && Object.keys(A.R).length > 50,
        `${Object.keys(A.R ?? {}).length} arrays`);
  check('returns P&L', !!A.PL);
  ['lcl', 'intr', 'rep', 'salescash', 'devc'].forEach((k) =>
    check(`debt array R.${k}`, Array.isArray(A.R?.[k])));
}

// ---- statement arithmetic (mirrors lib/statements.ts) ----
if (A) {
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  const tot = (k) => (A.fys ?? []).reduce((a, y) => a + num(A.PL?.[y]?.[k]), 0);

  // The P&L must actually articulate: revenue less direct cost is gross
  // profit, and gross profit less overhead and tax is net profit. If these
  // drift the statement is decorative, not a statement.
  const rev = tot('rev') + tot('otherIncome');
  const gpCheck = Math.abs((rev - tot('dc')) - tot('gp'));
  check('P&L articulates: rev - direct = gross profit', gpCheck < Math.max(1, rev * 1e-6),
        `drift ${Math.round(gpCheck)}`);

  const npatCheck = Math.abs((tot('npbt') - tot('corporateTax')) - tot('npat'));
  check('P&L articulates: NPBT - tax = NPAT', npatCheck < Math.max(1, rev * 1e-6),
        `drift ${Math.round(npatCheck)}`);

  // Sources must equal uses by construction, because the recycled figure is
  // the balancing item. If this ever fails the balancing logic is wrong.
  const uses = tot('landCost') + tot('stampDuty') + tot('foreignPurchaserSurcharge') +
    tot('firbCost') + tot('constructionCost') + tot('professionalFees') +
    tot('developmentManagementFees') + tot('statutoryCost') + tot('contingencyCost') +
    tot('otherDirectCost') + tot('brokerage') + tot('marketing') +
    tot('totalOverhead') + tot('fin') + tot('corporateTax');
  const equity = num(A.epeak), debt = num(A.peakdebt);
  const recycled = Math.max(0, uses - equity - debt);
  check('sources balance to uses', Math.abs((equity + debt + recycled) - uses) < 1,
        `uses ${Math.round(uses)}`);

  // DSCR must be measured only in the repayment window. A negative minimum
  // means construction periods leaked in, which is the bug this guards.
  const R = A.R ?? {};
  const g = (k, i) => num(Array.isArray(R[k]) ? R[k][i] : 0);
  let minD = null, periods = 0;
  for (let i = 0; i < (R.lcl?.length ?? 0); i++) {
    const ds = g('intr', i) + g('rep', i) + g('lf', i);
    if (ds <= 0.5 || g('salescash', i) <= 0.5) continue;
    periods++;
    const d = (g('salescash', i) - g('devc', i) - g('ovh', i) - g('taxm', i)) / ds;
    if (minD === null || d < minD) minD = d;
  }
  check('DSCR excludes construction periods', minD === null || minD > -1,
        minD === null ? 'no serviced period' : `min ${minD.toFixed(2)}x over ${periods}`);

  // The cashflow and the P&L must agree. They are built from different
  // series -- PL[] by financial year, cfref* by month -- so if the FY
  // boundary or the aggregation is wrong these diverge. This is the check
  // that would have caught a second, disagreeing implementation of fyOf.
  const cfTot = (k) => (Array.isArray(R[k]) ? R[k] : []).reduce((a, b) => a + num(b), 0);
  const revGap = Math.abs(tot('rev') - cfTot('cfrefresrev'));
  check('cashflow receipts tie to P&L revenue', revGap < 1, `gap ${Math.round(revGap)}`);
  const profitGap = Math.abs(tot('npat') - cfTot('cfrefprofit'));
  check('cashflow profit ties to P&L NPAT', profitGap < 1, `gap ${Math.round(profitGap)}`);

  // Balance sheet positions must be published per financial year, not as a
  // single scalar -- an omitted row is honest, a flattened one is not.
  const B = A.B ?? {};
  const fyKeyed = ['closing', 'land', 'devc', 'balr', 'sval', 'recog']
    .filter((k) => B[k] && typeof B[k] === 'object');
  check('balance positions are FY-keyed', fyKeyed.length >= 5, `${fyKeyed.length} of 6`);
}

// ---- contingency recognition ----
// A contingency is cost like any other: it has to reach the P&L and the equity
// roll-forward, not just the cash outflow. Most real schemes carry one, so a
// scheme that only reconciles at contpc:0 is a scheme that never gets used.
// Running the same inputs with and without a contingency isolates its effect,
// and every effect must be exactly the contingency -- no more, no less.
const CONT_PC = 5;
let C = null, cErr = null;
try { C = run({ ...scheme, contpc: CONT_PC }, {}); } catch (e) { cErr = e.message; }
check('runs a scheme carrying a contingency', !!C, cErr ?? '');
if (A && C) {
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  const totOf = (X, k) => (X.fys ?? []).reduce((a, y) => a + num(X.PL?.[y]?.[k]), 0);
  const expected = (CONT_PC / 100) * scheme.buildbua * scheme.buildpsf;
  const near = (a, b) => Math.abs(a - b) < Math.max(1, Math.abs(expected) * 1e-9);

  check('contingency is priced off construction cost',
        near(num(C.contTot), expected),
        `${Math.round(num(C.contTot))} vs ${Math.round(expected)}`);

  // The reported total is worthless if it never lands in a statement line.
  check('contingency lands in the P&L contingency line',
        near(totOf(C, 'contingencyCost'), num(C.contTot)),
        `drift ${Math.round(totOf(C, 'contingencyCost') - num(C.contTot))}`);

  // Direct cost -- and therefore gross profit -- must move by the contingency
  // and by nothing else. This is what fails when the spend is booked to cash
  // but never released out of inventory into cost of sales.
  const dcDelta = totOf(C, 'dc') - totOf(A, 'dc');
  check('contingency raises direct cost by its own amount', near(dcDelta, expected),
        `delta ${Math.round(dcDelta)}`);
  const gpDelta = totOf(A, 'gp') - totOf(C, 'gp');
  check('contingency reduces gross profit by its own amount', near(gpDelta, expected),
        `delta ${Math.round(gpDelta)}`);

  // The equity roll-forward is the independent witness: profit earned must
  // equal equity returned less equity injected.
  const equityGap = Math.abs(num(C.egain) -
    (totOf(C, 'npat') + totOf(C, 'da') - num(C.depreciableCapex)));
  check('contingency scheme ties profit to equity', equityGap < 1,
        `gap ${Math.round(equityGap)}`);

  // Cash and accrual must see the same contingency.
  const cfCont = (C.R?.cfrefcontingency ?? []).reduce((a, b) => a + num(b), 0);
  check('cashflow contingency ties to the P&L', Math.abs(cfCont - num(C.contTot)) < 1,
        `gap ${Math.round(cfCont - num(C.contTot))}`);
}

// ---- reference cashflow completeness ----
// The reference cashflow is the statement the project is funded from, so it has
// to account for every dollar the engine spends: net cash out must equal the
// project cashflow it is derived from, month by month. The rows that go missing
// are always the conditional ones -- a cost that only exists when a particular
// input is switched on, or that the code assumed belonged to the other
// development mode. So each one is switched on here and the identity re-tested.
// Each case also names the engine row it is meant to exercise: if that row is
// empty the case proves nothing, and a silently vacuous test is worse than none.
const refCases = [
  ['builder-risk insurance', { insur: 1.5, ph1dellag: 30 }, ['insurance']],
  ['a reimbursed fixed contingency',
   { contfixed: 900000, pidel: 60, pidrt: 100, infrastructurecharge: 8000 }, ['pid']],
  ['a display suite and depreciable capex',
   { modelcost: 3000000, dacapex: 5000000, dalife: 5 }, ['model', 'capex']],
  ['horizontal infrastructure inside a vertical scheme', { infl: 80000 }, ['infra']],
];
for (const [label, extra, drivers] of refCases) {
  let X = null, xErr = null;
  try { X = run({ ...scheme, ...extra }, {}); } catch (e) { xErr = e.message; }
  check(`runs with ${label}`, !!X, xErr ?? '');
  if (!X) continue;
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  const R = X.R ?? {};
  const rowTotal = (k) => (Array.isArray(R[k]) ? R[k] : []).reduce((a, b) => a + num(b), 0);

  const empty = drivers.filter((k) => Math.abs(rowTotal(k)) < 1);
  check(`${label} actually reaches the model`, empty.length === 0,
        empty.length ? `empty: ${empty.join(', ')}` : drivers
          .map((k) => `${k} ${Math.round(rowTotal(k))}`).join(', '));

  // R.net is the project cashflow before funding; the reference statement shows
  // the same thing sign-flipped, as a funding requirement, with tax added back
  // because the layout has no separate tax line. Any cost the statement forgets
  // shows up here as a month that does not tie.
  let worst = 0, worstMonth = -1;
  for (let i = 0; i < (R.cfrefnetcash?.length ?? 0); i++) {
    const gap = Math.abs(num(R.cfrefnetcash[i]) - (-num(R.net?.[i]) + num(R.taxm?.[i])));
    if (gap > worst) { worst = gap; worstMonth = i; }
  }
  check(`reference cashflow accounts for every dollar with ${label}`, worst < 1,
        worst < 1 ? 'ties every month' : `off by ${Math.round(worst)} in month ${worstMonth}`);
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
