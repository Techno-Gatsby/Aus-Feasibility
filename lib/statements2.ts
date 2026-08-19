/** The four statement panes that exist in the single-file build and were
 *  missing from the app: the monthly engine, offer price / land value, the
 *  consolidated roll-up (P&L, cashflow, balance sheet) and project
 *  comparison.
 *
 *  Same contract as lib/statements.ts — pure functions over the engine's
 *  analysis object, returning a Statement the UI renders without arithmetic
 *  of its own. Nothing here recalculates the model; every figure is read
 *  from the engine or summed from figures the engine published.
 *
 *  The month-to-financial-year map is never derived here. It arrives as
 *  fyOfMonth, computed server-side by the engine's own exported fyOf. A
 *  second implementation of the FY boundary would let these panes disagree
 *  with the P&L about when a year starts.
 */

import type { Row, Statement } from './statements';
import { solve, REASON_TEXT, type SolveResult } from './optimise';

export type { Row, Statement };

const n = (v: any) => (typeof v === 'number' && isFinite(v) ? v : 0);
const arr = (A: any, k: string): number[] => (Array.isArray(A?.R?.[k]) ? A.R[k] : []);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
             'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ════════════════════ 1. MONTHLY ENGINE ════════════════════ */

/** Calendar labels for the month columns. This is month naming, not the
 *  financial-year boundary — it reads startMonth/startYear straight off the
 *  engine's derived inputs and does no year-end logic. */
export function monthLabels(A: any, months: number): string[] {
  const d = A?.d;
  if (!d || !isFinite(d.startMonth) || !isFinite(d.startYear))
    return Array.from({ length: months }, (_, m) => `M${m + 1}`);
  return Array.from({ length: months }, (_, m) => {
    const i = (d.startMonth - 1) + m;
    return `${MON[((i % 12) + 12) % 12]}-${String(d.startYear + Math.floor(i / 12)).slice(2)}`;
  });
}

/** The last month in which anything actually happens. Padding the table out
 *  to the model horizon would print columns of zeros for years in which the
 *  project is finished — a zero there asserts a position that does not
 *  exist. */
function activeMonths(A: any): number {
  const probe = ['cfrefresrev', 'cfrefgst', 'cfrefland', 'cfrefconstruction',
                 'cfgstrefund', 'cfrefnetcash', 'dr1', 'dr2', 'rep', 'pf',
                 'intr', 'lf', 'cfrefequity', 'cfrefsurplus'];
  let last = -1;
  probe.forEach((k) => arr(A, k).forEach((v, i) => {
    if (Math.abs(n(v)) > 0.5) last = Math.max(last, i);
  }));
  return last + 1;
}

/** The month-by-month cashflow the whole model is built on. Every other
 *  statement is an aggregation of these series, so this is the layer where a
 *  timing error is visible.
 *
 *  Sign convention is the engine's own and is NOT flipped: costs are
 *  positive, and a positive line 6 is a cash requirement rather than a
 *  surplus. The annual Cashflow pane presents payments negative for reading;
 *  both tie to the same underlying arrays. */
export function monthlyEngine(A: any): Statement {
  const M = activeMonths(A);
  const one = (k: string) => Array.from({ length: M }, (_, m) => n(arr(A, k)[m]));
  const add = (...ks: string[]) =>
    Array.from({ length: M }, (_, m) => ks.reduce((a, k) => a + n(arr(A, k)[m]), 0));
  const sub = (a: string, b: string) =>
    Array.from({ length: M }, (_, m) => n(arr(A, a)[m]) - n(arr(A, b)[m]));
  const R = (no: string, label: string, values: number[], kind?: Row['kind']): Row =>
    ({ no, label, values, total: values.reduce((x, y) => x + y, 0), kind });

  return {
    caption: 'Monthly project cash flow',
    columns: monthLabels(A, M),
    rows: [
      R('1', 'Net revenue', sub('cfrefresrev', 'cfrefgst'), 'sub'),
      R('1.1', 'Revenue — residential', one('cfrefresrev')),
      R('1.2', 'Less GST', one('cfrefgst')),
      R('2', 'Land costs',
        add('cfrefland', 'cfrefstamp', 'cfrefholding', 'cfreffirb', 'cfrefforeignstamp'), 'sub'),
      R('2.1', 'Land cost', one('cfrefland')),
      R('2.2', 'Stamp duty', one('cfrefstamp')),
      R('2.3', 'Land holding costs', one('cfrefholding')),
      R('2.4', 'FIRB fees', one('cfreffirb')),
      R('2.5', 'Foreign purchaser surcharge', one('cfrefforeignstamp')),
      R('3', 'Development cost',
        add('cfrefconstruction', 'cfrefprofessional', 'cfrefdm', 'cfrefstatutory', 'cfrefcontingency'), 'sub'),
      R('3.1', 'Cost of construction', one('cfrefconstruction')),
      R('3.2', 'Professional fees', one('cfrefprofessional')),
      R('3.3', 'Development management fees', one('cfrefdm')),
      R('3.4', 'Statutory costs', one('cfrefstatutory')),
      R('3.5', 'Project contingency', one('cfrefcontingency')),
      R('4', 'Selling costs', add('cfrefbrokerage', 'cfrefselling', 'cfrefmarketing'), 'sub'),
      R('4.1', 'Brokerage', one('cfrefbrokerage')),
      R('4.2', 'Selling expenses', one('cfrefselling')),
      R('4.3', 'Marketing and advertising', one('cfrefmarketing')),
      R('5', 'GST refund', one('cfgstrefund'), 'sub'),
      R('6', 'Net cash flow', one('cfrefnetcash'), 'result'),
      R('7', 'Debt schedule', add('cfrefdebt', 'cfrefdebtfinance', 'cfrefrepayment'), 'sub'),
      R('7.1', 'Debt raised', one('cfrefdebt')),
      R('7.2', 'Debt raised to service debt', one('cfrefdebtfinance')),
      R('7.3', 'Debt repayment', one('cfrefrepayment')),
      R('8', 'Finance costs', add('cfrefprocessing', 'cfrefinterest', 'cfreflifetime'), 'sub'),
      R('8.1', 'Processing fee', one('cfrefprocessing')),
      R('8.2', 'Interest', one('cfrefinterest')),
      R('8.3', 'Line fee', one('cfreflifetime')),
      R('9', 'Equity needed', one('cfrefequity'), 'result'),
      R('10', 'Net surplus', one('cfrefsurplus'), 'result'),
      R('11', 'Profit (10 less 9)', one('cfrefprofit'), 'result'),
    ],
    note:
      'This is the calculation layer: the annual cashflow, the P&L and the ' +
      'balance sheet are all aggregations of these columns. Costs are shown ' +
      'positive in the engine\'s own convention, so a positive line 6 is a cash ' +
      'REQUIREMENT, not a surplus — the annual Cashflow pane flips the sign for ' +
      'reading, and both tie to the same arrays. Columns stop at the last month ' +
      'with activity rather than running to the model horizon.',
  };
}

/** Monthly totals rolled into financial years using the engine's own map.
 *  Exported because the tie between this and the P&L is the check that a
 *  timing error cannot hide behind an annual total. */
export function monthlyByFy(A: any, key: string, fyOfMonth: number[]): Record<number, number> {
  const out: Record<number, number> = {};
  (A?.fys ?? []).forEach((y: number) => { out[y] = 0; });
  const src = arr(A, key);
  for (let m = 0; m < fyOfMonth.length; m++) {
    const y = fyOfMonth[m];
    if (out[y] === undefined) out[y] = 0;
    out[y] += n(src[m]);
  }
  return out;
}

/* ════════════════════ 2. OFFER PRICE / LAND VALUE ════════════════════ */

export type OfferTarget = {
  key: string;            // metric key the engine publishes: eirr, npv, margin…
  target: number;
  label: string;
  mine?: boolean;         // the requirement the user actually set
};
export type OfferCell = {
  value: number | null;         // land price per sqm that hits the target
  achieved: number | null;
  reason: SolveResult['reason'];
  explanation: string;
};
export type OfferGrid = {
  caption: string;
  columns: string[];
  rows: { label: string; mine: boolean; cells: OfferCell[] }[];
  ask: number;
  siteAreaSqm: number;
  ceiling: OfferCell | null;        // NPV nil — the absolute ceiling
  requirement: OfferCell | null;    // the user's own hurdle
  gapPerSqm: number | null;
  gapAcrossSite: number | null;
  note: string;
};

/** Solve for the land price that hits one target.
 *
 *  Deliberately NOT the engine's solveLand. solveLand evaluates an endpoint
 *  at zero first and abandons the search when the metric is undefined there,
 *  and at a land price of zero this model returns a null equity IRR — so it
 *  reports "no solution" for hurdles the curve genuinely crosses. lib/optimise's
 *  solve() scans the interior, skips undefined samples instead of stopping at
 *  them, and says WHY it failed when it fails. */
export function solveLandValue(
  evaluate: (metricKey: string, land: number) => number | null,
  t: OfferTarget,
  lo: number,
  hi: number,
  steps = 24,
): OfferCell {
  const r = solve((x) => evaluate(t.key, x), t.target, lo, hi, steps);
  return {
    value: r.value, achieved: r.achieved,
    reason: r.reason, explanation: REASON_TEXT[r.reason],
  };
}

/** Assemble the offer-price grid. Cells are supplied by the caller because
 *  solving them means running the model, which happens server-side; this
 *  function owns the presentation and the arithmetic of the gap, nothing
 *  else. An unreachable target stays null — it is never rendered as zero,
 *  because zero would read as "the land is worth nothing" rather than "this
 *  return is not available at any price". */
export function offerGrid(
  targets: OfferTarget[],
  columns: string[],
  cells: OfferCell[][],
  ask: number,
  siteAreaSqm: number,
): OfferGrid {
  const rows = targets.map((t, i) => ({
    label: t.label, mine: !!t.mine,
    cells: columns.map((_, j) => cells[i]?.[j] ?? {
      value: null, achieved: null, reason: 'undefined-metric' as const,
      explanation: REASON_TEXT['undefined-metric'],
    }),
  }));
  const at = (pred: (t: OfferTarget) => boolean) => {
    const i = targets.findIndex(pred);
    return i < 0 ? null : (cells[i]?.[0] ?? null);
  };
  const ceiling = at((t) => t.key === 'npv' && t.target === 0);
  const requirement = at((t) => !!t.mine) ?? ceiling;
  const supported = requirement?.value ?? null;
  const gapPerSqm = supported == null ? null : supported - ask;

  return {
    caption: 'Maximum land price per sqm at each required return',
    columns, rows, ask, siteAreaSqm, ceiling, requirement,
    gapPerSqm,
    gapAcrossSite: gapPerSqm == null ? null : gapPerSqm * siteAreaSqm,
    note:
      'Each cell is the land price at which that return is exactly met, found ' +
      'by bisection over real model runs — not a formula. A blank cell means ' +
      'the return is not reachable at any land price on these assumptions, ' +
      'which is a different answer from a land value of nil. The columns re-solve ' +
      'the whole model at a lower sale price, so they show how much of your ' +
      'land budget is really a bet on the sales rate.',
  };
}

/* ════════════════════ 3. CONSOLIDATION ════════════════════ */

/** One parcel in the roll-up: a name, the analysis the engine returned for
 *  it, and the engine's own month-to-FY map for that parcel's programme.
 *  Each parcel keeps its OWN map — parcels start in different months, and
 *  reusing one parcel's map for another would silently shift its years. */
export type Parcel = { name: string; analysis: any; fyOfMonth: number[] };

const plOf = (A: any, y: number, k: string) => n(A?.PL?.[y]?.[k]);
const bOf = (A: any, y: number, k: string) => n(A?.B?.[k]?.[y]);

/** Financial years across every parcel, sorted. */
export function consolidatedYears(parcels: Parcel[]): number[] {
  const s = new Set<number>();
  parcels.forEach((p) => (p.analysis?.fys ?? []).forEach((y: number) => s.add(Number(y))));
  return [...s].sort((a, b) => a - b);
}

/** The Business Plan presentation of one parcel's P&L for one year. Land is
 *  presented all-in (duty, surcharge, FIRB, holding) because that is what a
 *  board approves; the four cost lines still sum to the engine's own direct
 *  cost, which the test asserts. */
function bpYear(A: any, y: number) {
  const p = (k: string) => plOf(A, y, k);
  const landCost = p('landCost') + p('stampDuty') + p('foreignPurchaserSurcharge')
                 + p('firbCost') + p('acquisitionCost') + p('holdingCost');
  const constructionCost = p('constructionCost');
  const brokerage = p('brokerage');
  const otherDirectCost = p('otherDirectCost') + p('sellingCost') + p('marketing')
    + p('professionalFees') + p('developmentManagementFees') + p('statutoryCost')
    + p('contingencyCost') + p('capitalisedFinanceCost') + p('inputGstCredit');
  const gna = p('gna') + p('gnaShared') + p('da');
  const staff = p('staff') + p('staffShared');
  const corp = p('corpOverhead');
  const overheadCost = gna + staff + corp;
  const financeCost = p('fin');
  const totalOverheadCost = overheadCost + financeCost;
  const grossProfit = p('gp');
  return {
    qualifiedSales: bOf(A, y, 'sval'),
    totalRevenue: p('rev'),
    landCost, constructionCost, brokerage, otherDirectCost,
    directCost: p('dc'),
    grossProfit,
    gna, staff, corp, overheadCost, financeCost, totalOverheadCost,
    preOtherIncomeProfit: grossProfit - totalOverheadCost,
    otherIncome: p('otherIncome'),
    npbt: p('npbt'), tax: p('tax'), npat: p('npat'),
  };
}
export type BpLine = keyof ReturnType<typeof bpYear>;

/** Summed Business Plan P&L across parcels, by financial year. Parcels are
 *  already keyed by real financial year, so summing on the year key IS the
 *  calendar alignment — there is no second timeline to get wrong. */
export function consolidatedPlData(parcels: Parcel[]) {
  const all = consolidatedYears(parcels);
  const map: Record<number, ReturnType<typeof bpYear>> = {};
  all.forEach((y) => {
    const acc = bpYear({}, y);
    parcels.forEach((p) => {
      const one = bpYear(p.analysis, y);
      (Object.keys(acc) as BpLine[]).forEach((k) => { acc[k] += one[k]; });
    });
    map[y] = acc;
  });
  // a year in which nothing at all happened is dropped, not printed as zeros
  const years = all.filter((y) => (Object.keys(map[y]) as BpLine[])
    .some((k) => Math.abs(map[y][k]) > 0.5));
  const value = (y: number, k: BpLine) => n(map[y]?.[k]);
  const total = (k: BpLine) => years.reduce((a, y) => a + value(y, k), 0);
  return { years, map, value, total };
}

function bpRows(S: ReturnType<typeof consolidatedPlData>): Row[] {
  const R = (no: string, label: string, k: BpLine, kind?: Row['kind']): Row => ({
    no, label, values: S.years.map((y) => S.value(y, k)), total: S.total(k), kind,
  });
  return [
    R('', 'Net qualified sales', 'qualifiedSales', 'sub'),
    R('1', 'Total revenue', 'totalRevenue', 'sub'),
    { label: 'DIRECT COST', values: [], total: null, kind: 'band' },
    R('2.1', 'Land cost (incl duty, surcharge, FIRB, holding)', 'landCost'),
    R('2.2', 'Construction cost', 'constructionCost'),
    R('2.3', 'Brokerage and incentive', 'brokerage'),
    R('2.4', 'Other direct cost', 'otherDirectCost'),
    R('2', 'Direct cost (2.1 + 2.2 + 2.3 + 2.4)', 'directCost', 'sub'),
    R('3', 'Gross profit (1 less 2)', 'grossProfit', 'result'),
    { label: 'OVERHEAD', values: [], total: null, kind: 'band' },
    R('4.1', 'General and administrative', 'gna'),
    R('4.2', 'Staff and manpower', 'staff'),
    R('4.3', 'Corporate overhead allocation', 'corp'),
    R('4', 'Overhead cost (4.1 + 4.2 + 4.3)', 'overheadCost', 'sub'),
    R('5', 'Finance cost, net of finance income', 'financeCost'),
    R('6', 'Total overhead cost (4 + 5)', 'totalOverheadCost', 'sub'),
    R('7', 'Net profit before other income', 'preOtherIncomeProfit', 'result'),
    R('8', 'Other income', 'otherIncome'),
    R('9', 'Net profit before taxes', 'npbt', 'result'),
    R('10', 'Taxes', 'tax'),
    R('11', 'Net profit (9 less 10)', 'npat', 'result'),
  ];
}

export function consolidatedProfitAndLoss(parcels: Parcel[]): Statement {
  const S = consolidatedPlData(parcels);
  const names = parcels.map((p) => p.name).join(', ');
  return {
    caption: parcels.length === 1 ? 'Profit and loss (Business Plan presentation)'
                                  : 'Consolidated profit and loss',
    columns: S.years.map((y) => `FY${String(y).slice(2)}`),
    rows: bpRows(S),
    note:
      `${parcels.length} parcel${parcels.length === 1 ? '' : 's'} — ${names}. ` +
      'Parcels are summed on the financial-year key each engine published, so ' +
      'calendar alignment is the engine\'s, not a second timeline built here. ' +
      'Net qualified sales follow contract timing while revenue follows the ' +
      'recognition schedule, so the two lines are deliberately different and ' +
      'should not be expected to agree in any single year.',
  };
}

/** Consolidated cashflow: the same eleven lines as the monthly engine and
 *  the single-parcel cashflow, aggregated into financial years using EACH
 *  parcel's own month map. */
export function consolidatedCashflow(parcels: Parcel[]): Statement {
  const years = consolidatedYears(parcels);
  const sy = (key: string, y: number) =>
    parcels.reduce((acc, p) => {
      const src = arr(p.analysis, key);
      let t = 0;
      for (let m = 0; m < p.fyOfMonth.length; m++) if (p.fyOfMonth[m] === y) t += n(src[m]);
      return acc + t;
    }, 0);
  const line = (...keys: string[]) => years.map((y) => keys.reduce((a, k) => a + sy(k, y), 0));
  const diff = (a: string, b: string) => years.map((y) => sy(a, y) - sy(b, y));

  const live = new Set<number>();
  const probe = ['cfrefresrev', 'cfrefland', 'cfrefconstruction', 'cfrefnetcash',
                 'cfrefequity', 'cfrefsurplus', 'cfrefinterest'];
  years.forEach((y) => { if (probe.some((k) => Math.abs(sy(k, y)) > 0.5)) live.add(y); });
  const keep = years.map((y) => live.has(y));
  const trim = (vs: number[]) => vs.filter((_, i) => keep[i]);

  const R = (no: string, label: string, values: number[], kind?: Row['kind']): Row => {
    const v = trim(values);
    return { no, label, values: v, total: v.reduce((a, b) => a + b, 0), kind };
  };
  const names = parcels.map((p) => p.name).join(', ');

  return {
    caption: parcels.length === 1 ? 'Cash flow statement' : 'Consolidated cash flow statement',
    columns: years.filter((_, i) => keep[i]).map((y) => `FY${String(y).slice(2)}`),
    rows: [
      R('1', 'Net revenue', diff('cfrefresrev', 'cfrefgst'), 'sub'),
      R('1.1', 'Revenue — residential', line('cfrefresrev')),
      R('1.2', 'Less GST', line('cfrefgst')),
      R('2', 'Land costs',
        line('cfrefland', 'cfrefstamp', 'cfrefholding', 'cfreffirb', 'cfrefforeignstamp'), 'sub'),
      R('2.1', 'Land cost', line('cfrefland')),
      R('2.2', 'Stamp duty', line('cfrefstamp')),
      R('2.3', 'Land holding costs', line('cfrefholding')),
      R('2.4', 'FIRB fees', line('cfreffirb')),
      R('2.5', 'Foreign purchaser surcharge', line('cfrefforeignstamp')),
      R('3', 'Development cost',
        line('cfrefconstruction', 'cfrefprofessional', 'cfrefdm', 'cfrefstatutory', 'cfrefcontingency'), 'sub'),
      R('3.1', 'Cost of construction', line('cfrefconstruction')),
      R('3.2', 'Professional fees', line('cfrefprofessional')),
      R('3.3', 'Development management fees', line('cfrefdm')),
      R('3.4', 'Statutory costs', line('cfrefstatutory')),
      R('3.5', 'Project contingency', line('cfrefcontingency')),
      R('4', 'Selling costs', line('cfrefbrokerage', 'cfrefselling', 'cfrefmarketing'), 'sub'),
      R('4.1', 'Brokerage', line('cfrefbrokerage')),
      R('4.2', 'Selling expenses', line('cfrefselling')),
      R('4.3', 'Marketing and advertising', line('cfrefmarketing')),
      R('5', 'GST refund', line('cfgstrefund'), 'sub'),
      R('6', 'Net cash flow', line('cfrefnetcash'), 'result'),
      R('7', 'Debt schedule', line('cfrefdebt', 'cfrefdebtfinance', 'cfrefrepayment'), 'sub'),
      R('7.1', 'Debt raised', line('cfrefdebt')),
      R('7.2', 'Debt raised to service debt', line('cfrefdebtfinance')),
      R('7.3', 'Debt repayment', line('cfrefrepayment')),
      R('8', 'Finance costs', line('cfrefprocessing', 'cfrefinterest', 'cfreflifetime'), 'sub'),
      R('8.1', 'Processing fee', line('cfrefprocessing')),
      R('8.2', 'Interest', line('cfrefinterest')),
      R('8.3', 'Line fee', line('cfreflifetime')),
      R('9', 'Equity needed', line('cfrefequity'), 'result'),
      R('10', 'Net surplus', line('cfrefsurplus'), 'result'),
      R('11', 'Profit (10 less 9)', line('cfrefprofit'), 'result'),
    ],
    note:
      `${parcels.length} parcel${parcels.length === 1 ? '' : 's'} — ${names}. ` +
      'Each parcel is placed in financial years by its OWN month map, computed by ' +
      'the engine, then added. Parcels that overlap in a calendar year are summed ' +
      'in that year. Costs are positive in the engine\'s convention, so a positive ' +
      'line 6 is a pre-financing cash requirement.',
  };
}

/* ---- consolidated balance sheet ---- */

export type BalanceState = {
  cash: number; receivables: number; inventoryWip: number; landWip: number;
  advanceLand: number; currentAssets: number; capexNet: number;
  nonCurrentAssets: number; totalAssets: number; landPayable: number;
  debt: number; taxPayable: number; otherPayable: number;
  totalLiabilities: number; equityCapital: number; retained: number;
  totalEquity: number; totalLE: number;
};
const ZERO_STATE = (): BalanceState => ({
  cash: 0, receivables: 0, inventoryWip: 0, landWip: 0, advanceLand: 0,
  currentAssets: 0, capexNet: 0, nonCurrentAssets: 0, totalAssets: 0,
  landPayable: 0, debt: 0, taxPayable: 0, otherPayable: 0, totalLiabilities: 0,
  equityCapital: 0, retained: 0, totalEquity: 0, totalLE: 0,
});
const sumAll = (a: number[]) => (a ?? []).reduce((x, v) => x + n(v), 0);
const cum = (a: number[], m: number) => {
  if (!a || m < 0) return 0;
  let t = 0; const lim = Math.min(m, a.length - 1);
  for (let i = 0; i <= lim; i++) t += n(a[i]);
  return t;
};
const cumKeys = (A: any, m: number, keys: string[]) =>
  keys.reduce((t, k) => t + cum(arr(A, k), m), 0);

/** Position at the end of month m, built from the engine's cumulative
 *  monthly arrays. Retained earnings is the plug, so assets equal liabilities
 *  plus equity by construction — the statement balances because it is
 *  derived that way, which is worth stating rather than presenting as a
 *  discovered fact. */
export function balanceStateAt(A: any, fyOfMonth: number[], m: number): BalanceState {
  if (m < 0) return ZERO_STATE();
  const NM = n(A?.NM);
  m = Math.min(m, NM);
  const d = A?.d ?? {};
  const beforeClose = m < n(A?.close);

  const totalLandPayments = sumAll(arr(A, 'land'));
  const totalClosing = sumAll(arr(A, 'closing')) + sumAll(arr(A, 'firb'));
  const paidLand = cum(arr(A, 'land'), m);
  const paidClosing = cum(arr(A, 'closing'), m) + cum(arr(A, 'firb'), m);

  const advanceLand = beforeClose ? paidLand + paidClosing : 0;
  const landPayable = beforeClose ? 0 : Math.max(0, totalLandPayments - paidLand);
  const landCommitted = beforeClose ? 0 : totalLandPayments + totalClosing;
  const landWip = Math.max(0, landCommitted - cum(arr(A, 'landcogs'), m)
                              - cum(arr(A, 'landgstrefund'), m));

  const baseDevAdds = Math.max(0, cum(arr(A, 'devc'), m) - paidLand - paidClosing);
  const capAdds = cumKeys(A, m, ['retaxcapadd', 'hoacapadd', 'insurancecapadd', 'fincapadd']);
  const baseDevRelease = cumKeys(A, m, ['concogs', 'vertcogs', 'othcogs']);
  const capRelease = cumKeys(A, m, ['retaxcaprel', 'hoacaprel', 'insurancecaprel', 'fincaprel']);
  const pidReduction = d.pidacct ? cum(arr(A, 'pid'), m) : 0;
  const inventoryWip = Math.max(0, baseDevAdds + capAdds - baseDevRelease - capRelease - pidReduction);

  const cash = n(arr(A, 'cash')[m]);
  const receivables = Math.max(0, n(arr(A, 'escbal')[m]));
  const capexNet = Math.max(0, cum(arr(A, 'capex'), m) - cum(arr(A, 'da'), m));
  const currentAssets = cash + receivables + inventoryWip + landWip + advanceLand;
  const nonCurrentAssets = capexNet;
  const totalAssets = currentAssets + nonCurrentAssets;

  const debt = Math.max(0, n(arr(A, 'lcl')[m]));
  // the FY this month belongs to comes from the engine's map, never recomputed
  const currentFy = fyOfMonth?.[m];
  const taxAccrued = (A?.fys ?? [])
    .filter((y: number) => currentFy == null || Number(y) <= Number(currentFy))
    .reduce((t: number, y: number) => t + plOf(A, y, 'tax'), 0);
  const taxPayable = Math.max(0, taxAccrued - cum(arr(A, 'taxm'), m));
  const otherPayable = 0;
  const totalLiabilities = landPayable + debt + taxPayable + otherPayable;

  const equityCapital = Math.max(0, cum(arr(A, 'eqin'), m) - cum(arr(A, 'eqout'), m));
  const retained = totalAssets - totalLiabilities - equityCapital;

  return {
    cash, receivables, inventoryWip, landWip, advanceLand, currentAssets,
    capexNet, nonCurrentAssets, totalAssets, landPayable, debt, taxPayable,
    otherPayable, totalLiabilities, equityCapital, retained,
    totalEquity: equityCapital + retained,
    totalLE: totalLiabilities + equityCapital + retained,
  };
}

/** The parcel's position at the end of a given financial year, or null if
 *  the parcel had not started. A parcel whose programme ended earlier keeps
 *  its final position — that is a real balance, not an absence. */
export function balanceStateForFy(p: Parcel, y: number): BalanceState | null {
  const map = p.fyOfMonth ?? [];
  if (!map.length) return null;
  if (y < map[0]) return null;
  if (y > map[map.length - 1]) return balanceStateAt(p.analysis, map, map.length - 1);
  let m = -1;
  for (let i = 0; i < map.length; i++) if (map[i] === y) m = i;
  if (m < 0) return null;
  return balanceStateAt(p.analysis, map, m);
}

export function consolidatedBalanceSheet(parcels: Parcel[]): Statement {
  const all = consolidatedYears(parcels);
  const perYear = all.map((y) => {
    const acc = ZERO_STATE();
    let any = false;
    parcels.forEach((p) => {
      const s = balanceStateForFy(p, y);
      if (!s) return;
      any = true;
      (Object.keys(acc) as (keyof BalanceState)[]).forEach((k) => { acc[k] += s[k]; });
    });
    return { y, s: acc, any };
  }).filter((x) => x.any && (Math.abs(x.s.totalAssets) + Math.abs(x.s.totalLE)) > 0.5);

  const years = perYear.map((x) => x.y);
  const states = perYear.map((x) => x.s);
  const V = (no: string, label: string, k: keyof BalanceState, kind?: Row['kind']): Row => {
    const values = states.map((s) => s[k]);
    return { no, label, values, total: values.length ? values[values.length - 1] : null, kind };
  };
  const names = parcels.map((p) => p.name).join(', ');

  return {
    caption: parcels.length === 1 ? 'Balance sheet' : 'Consolidated balance sheet',
    columns: years.map((y) => `FY${String(y).slice(2)}`),
    rows: [
      { label: 'I. ASSETS', values: [], total: null, kind: 'band' },
      V('a', 'Cash and cash equivalents', 'cash'),
      V('b', 'Receivables and escrow', 'receivables'),
      V('c', 'Inventory work in progress', 'inventoryWip'),
      V('d', 'Land work in progress', 'landWip'),
      V('e', 'Advance for land', 'advanceLand'),
      V('', 'Total current assets', 'currentAssets', 'sub'),
      V('f', 'Project capex, net of depreciation', 'capexNet'),
      V('', 'Total non-current assets', 'nonCurrentAssets', 'sub'),
      V('', 'TOTAL ASSETS', 'totalAssets', 'result'),
      { label: 'II. LIABILITIES AND EQUITY', values: [], total: null, kind: 'band' },
      V('a', 'Land cost payable', 'landPayable'),
      V('b', 'Debt drawn', 'debt'),
      V('c', 'Tax payable', 'taxPayable'),
      V('', 'Total liabilities', 'totalLiabilities', 'sub'),
      V('d', 'Equity share capital', 'equityCapital'),
      V('e', 'Retained earnings', 'retained'),
      V('', 'Total equity', 'totalEquity', 'sub'),
      V('', 'TOTAL LIABILITIES AND EQUITY', 'totalLE', 'result'),
    ],
    note:
      `${parcels.length} parcel${parcels.length === 1 ? '' : 's'} — ${names}. ` +
      'Positions are struck at each parcel\'s own financial-year end, using the ' +
      'engine\'s month map, then added. A parcel that had not started is absent ' +
      'from that year rather than contributing zeros; a parcel that has finished ' +
      'carries its closing position forward, because that is a real balance. ' +
      'Retained earnings is the balancing figure, so assets equal liabilities plus ' +
      'equity by construction — that is not independent evidence the model is right. ' +
      'The Total column is the final year, not a sum.',
  };
}

/* ════════════════════ 4. PROJECT COMPARISON ════════════════════ */

export type CompareFmt = 'money' | 'pct' | 'x' | 'int' | 'area';
export type CompareRow = {
  label: string;
  values: (number | null)[];
  portfolio: number | null;
  fmt: CompareFmt;
  /** why the portfolio figure is absent, when it is */
  portfolioNote?: string;
};
export type Comparison = {
  caption: string;
  columns: string[];
  rows: CompareRow[];
  best: number | null;         // index of the strongest equity return
  discountRatePct: number;
  note: string;
};

const absStart = (A: any) => n(A?.d?.startYear) * 12 + (n(A?.d?.startMonth) - 1);
const fin = (v: any) => (typeof v === 'number' && isFinite(v) ? v : null);

/** Side-by-side of every parcel, with the portfolio column filled ONLY where
 *  the figure is genuinely additive. Peak equity and peak debt are aligned on
 *  the calendar and taken as the portfolio maximum, because two parcels'
 *  peaks rarely fall in the same month and adding them would overstate the
 *  requirement. IRR is not additive at all and is left absent. */
export function projectComparison(parcels: Parcel[], discountRatePct = 7.25): Comparison {
  const As = parcels.map((p) => p.analysis);
  const val = (k: string) => As.map((A) => fin(A?.[k]));
  const sum = (k: string) => As.reduce((a, A) => a + n(A?.[k]), 0);

  let best: number | null = null;
  As.forEach((A, i) => {
    const e = fin(A?.eirr);
    if (e == null) return;
    if (best == null || e > n(As[best]?.eirr)) best = i;
  });

  // calendar-aligned equity and debt balances
  const rate = Math.max(0, discountRatePct);
  const monthly = Math.pow(1 + rate / 100, 1 / 12) - 1;
  const starts = As.map(absStart);
  const valuationMonth = starts.length ? Math.min(...starts) : 0;
  const eq = new Map<number, number>(), dbt = new Map<number, number>();
  let npv = 0;
  As.forEach((A, i) => {
    let outstanding = 0;
    const NM = n(A?.NM);
    for (let m = 0; m <= NM; m++) {
      const am = starts[i] + m;
      outstanding = Math.max(0, outstanding + n(arr(A, 'eqin')[m]) - n(arr(A, 'eqout')[m]));
      eq.set(am, (eq.get(am) ?? 0) + outstanding);
      dbt.set(am, (dbt.get(am) ?? 0) + n(arr(A, 'lcl')[m]));
      npv += n(arr(A, 'net')[m]) / Math.pow(1 + monthly, am - valuationMonth);
    }
  });
  const peakEquity = eq.size ? Math.max(...eq.values()) : 0;
  const peakDebt = dbt.size ? Math.max(...dbt.values()) : 0;

  const revenue = sum('revenue'), npat = sum('npat');
  const einj = sum('einj'), eret = sum('eret');

  const rows: CompareRow[] = [
    { label: 'Site area (sqm)', values: As.map((A) => fin(A?.d?.acresGross)),
      portfolio: As.reduce((a, A) => a + n(A?.d?.acresGross), 0), fmt: 'area' },
    { label: 'Units / lots', values: As.map((A) => fin(A?.lots)), portfolio: sum('lots'), fmt: 'int' },
    { label: 'Land price A$/sqm', values: As.map((A) => fin(A?.d?.pr)),
      portfolio: null, fmt: 'money',
      portfolioNote: 'a per-sqm price cannot be added across parcels' },
    { label: 'Revenue', values: val('revenue'), portfolio: revenue, fmt: 'money' },
    { label: 'Gross profit', values: val('gross'), portfolio: sum('gross'), fmt: 'money' },
    { label: 'Net profit', values: val('npat'), portfolio: npat, fmt: 'money' },
    { label: 'Margin on revenue', values: val('margin'),
      portfolio: revenue ? npat / revenue : null, fmt: 'pct',
      portfolioNote: revenue ? undefined : 'no revenue to measure against' },
    { label: 'Project IRR', values: val('irr'), portfolio: null, fmt: 'pct',
      portfolioNote: 'IRR is not additive; a portfolio IRR needs a merged cashflow, not a sum' },
    { label: 'Equity IRR', values: val('eirr'), portfolio: null, fmt: 'pct',
      portfolioNote: 'IRR is not additive; a portfolio IRR needs a merged cashflow, not a sum' },
    { label: 'Equity multiple', values: val('moic'),
      portfolio: einj ? eret / einj : null, fmt: 'x',
      portfolioNote: einj ? undefined : 'no equity injected' },
    { label: 'Peak equity required', values: val('epeak'), portfolio: peakEquity, fmt: 'money',
      portfolioNote: undefined },
    { label: 'Peak debt drawn', values: val('peakdebt'), portfolio: peakDebt, fmt: 'money' },
    { label: 'Net present value', values: val('npv'), portfolio: npv, fmt: 'money' },
  ];

  return {
    caption: 'Every parcel side by side',
    columns: parcels.map((p) => p.name),
    rows, best, discountRatePct: rate,
    note:
      'Portfolio peak equity and peak debt are calendar-aligned and taken as the ' +
      'portfolio maximum, not the sum of each parcel\'s own peak — two parcels ' +
      'rarely peak in the same month, and adding the peaks would overstate what ' +
      `you must actually fund. Portfolio NPV is discounted to the earliest model ` +
      `start at ${rate.toFixed(2)}% a year. Where a figure is not additive the ` +
      'portfolio cell is left empty and says why: a blank is honest, a number ' +
      'there would not be. Each parcel carries its own land price, payment date ' +
      'and cost base, so this is like for like only where you have made it so.',
  };
}
