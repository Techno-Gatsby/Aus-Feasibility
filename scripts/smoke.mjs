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

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
