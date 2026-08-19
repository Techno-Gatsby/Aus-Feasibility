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

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
