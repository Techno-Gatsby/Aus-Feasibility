/** Statement builders. Pure functions over the engine's analysis object, so
 *  they are testable without a browser and cannot drift from what the model
 *  actually computed. Nothing here recalculates anything — every figure is
 *  read from the engine. */

export type Row = {
  no?: string; label: string; values: (number | null)[]; total: number | null;
  kind?: 'band' | 'sub' | 'result';
};
export type Statement = { caption: string; columns: string[]; rows: Row[]; note?: string };

const n = (v: any) => (typeof v === 'number' && isFinite(v) ? v : 0);

function series(A: any, key: string): { values: number[]; total: number } {
  const fys: number[] = A?.fys ?? [];
  const values = fys.map((y) => n(A?.PL?.[y]?.[key]));
  return { values, total: values.reduce((a, b) => a + b, 0) };
}

/** Profit and loss, in the order an Australian IC expects: revenue net of
 *  GST, then acquisition (which for a foreign investor means stamp duty,
 *  surcharge and FIRB as their own lines, not buried in "other"). */
export function profitAndLoss(A: any): Statement {
  const fys: number[] = A?.fys ?? [];
  const R = (no: string | undefined, label: string, key: string, kind?: Row['kind']): Row => {
    const s = series(A, key);
    return { no, label, values: s.values, total: s.total, kind };
  };
  return {
    caption: 'Profit and loss',
    columns: fys.map((y) => `FY${String(y).slice(2)}`),
    rows: [
      { label: 'REVENUE', values: [], total: null, kind: 'band' },
      R('1.1', 'Gross realisation (incl GST)', 'grossRev'),
      R('1.2', 'Less GST on sales', 'outputGst'),
      R('1', 'Net revenue', 'rev', 'sub'),
      R('1.3', 'Other income', 'otherIncome'),
      { label: 'ACQUISITION', values: [], total: null, kind: 'band' },
      R('2.1', 'Land cost', 'landCost'),
      R('2.2', 'Stamp duty', 'stampDuty'),
      R('2.3', 'Foreign purchaser surcharge', 'foreignPurchaserSurcharge'),
      R('2.4', 'FIRB application fee', 'firbCost'),
      R('2', 'Acquisition cost', 'acquisitionCost', 'sub'),
      { label: 'DEVELOPMENT', values: [], total: null, kind: 'band' },
      R('3.1', 'Construction', 'constructionCost'),
      R('3.2', 'Professional fees', 'professionalFees'),
      R('3.3', 'Development management', 'developmentManagementFees'),
      R('3.4', 'Statutory and authority', 'statutoryCost'),
      R('3.5', 'Contingency', 'contingencyCost'),
      R('3.6', 'Holding cost', 'holdingCost'),
      R('3.7', 'Capitalised finance', 'capitalisedFinanceCost'),
      R('3.8', 'Other direct', 'otherDirectCost'),
      R('3.9', 'Selling and brokerage', 'brokerage'),
      R('3.10', 'Marketing', 'marketing'),
      R('3', 'Direct cost', 'dc', 'sub'),
      R('4', 'Gross profit', 'gp', 'result'),
      { label: 'OVERHEAD', values: [], total: null, kind: 'band' },
      R('5.1', 'General and admin', 'gna'),
      R('5.2', 'Staff', 'staff'),
      R('5.3', 'Corporate allocation', 'corpOverhead'),
      R('5.4', 'Finance cost', 'fin'),
      R('5.5', 'Land tax and rates', 'realEstateTax'),
      R('5', 'Total overhead', 'totalOverhead', 'sub'),
      R('6', 'Net profit before tax', 'npbt', 'result'),
      R('6.1', 'Company tax', 'corporateTax'),
      R('7', 'Net profit after tax', 'npat', 'result'),
    ],
    note:
      'Revenue is shown gross then net of GST, because the margin scheme and ' +
      'input credits move real money in an Australian development. Stamp duty, ' +
      'the foreign purchaser surcharge and FIRB are separate lines: for a ' +
      'foreign investor they are decision-grade numbers, not overheads.',
  };
}

/** Sources and uses. Peak-funding presentation: total cost on the uses side,
 *  funded by peak debt, peak equity, and the settlements recycled back into
 *  cost during the build. The recycled figure is the BALANCING item and is
 *  labelled as such — it is not an independent input. */
export function sourcesAndUses(A: any): Statement {
  const t = (k: string) => series(A, k).total;
  const land = t('landCost'), stamp = t('stampDuty'),
        surcharge = t('foreignPurchaserSurcharge'), firb = t('firbCost');
  const constr = t('constructionCost'), prof = t('professionalFees'),
        dm = t('developmentManagementFees'), stat = t('statutoryCost'),
        cont = t('contingencyCost'), other = t('otherDirectCost'),
        sell = t('brokerage'), mkt = t('marketing');
  const oh = t('totalOverhead'), fin = t('fin'), tax = t('corporateTax');

  const acq = land + stamp + surcharge + firb;
  const dev = constr + prof + dm + stat + cont + other + sell + mkt;
  const total = acq + dev + oh + fin + tax;

  const equity = n(A?.epeak), debt = n(A?.peakdebt);
  const recycled = Math.max(0, total - equity - debt);
  const src = equity + debt + recycled;

  const one = (no: string, label: string, v: number, kind?: Row['kind']): Row =>
    ({ no, label, values: [v], total: v, kind });

  return {
    caption: 'Sources and uses of funds',
    columns: ['Amount'],
    rows: [
      { label: 'USES', values: [], total: null, kind: 'band' },
      one('1.1', 'Land', land),
      one('1.2', 'Stamp duty', stamp),
      one('1.3', 'Foreign purchaser surcharge', surcharge),
      one('1.4', 'FIRB', firb),
      one('1', 'Acquisition', acq, 'sub'),
      one('2.1', 'Construction', constr),
      one('2.2', 'Professional fees', prof),
      one('2.3', 'Development management', dm),
      one('2.4', 'Statutory', stat),
      one('2.5', 'Contingency', cont),
      one('2.6', 'Other direct', other),
      one('2.7', 'Selling and brokerage', sell),
      one('2.8', 'Marketing', mkt),
      one('2', 'Development', dev, 'sub'),
      one('3.1', 'Overheads', oh),
      one('3.2', 'Finance cost', fin),
      one('3.3', 'Company tax', tax),
      { no: '', label: 'TOTAL USES', values: [total], total, kind: 'result' },
      { label: 'SOURCES', values: [], total: null, kind: 'band' },
      one('4.1', 'Equity (peak requirement)', equity),
      one('4.2', 'Debt facility (peak drawn)', debt),
      one('4.3', 'Settlements recycled into cost', recycled),
      { no: '', label: 'TOTAL SOURCES', values: [src], total: src, kind: 'result' },
    ],
    note:
      `Peak funding is ${fmtShort(equity + debt)} — the most this project is out of ` +
      'pocket at once. Settlements recycled is the balancing item, not an input: ' +
      'it is the part of cost funded by earlier settlements rather than drawn capital.',
  };
}

/** Debt sizing and cover. DSCR is measured over the REPAYMENT window only:
 *  during construction a development facility is not serviced from
 *  operations — interest rolls up and is repaid from settlements — so a
 *  construction-phase DSCR is a large negative number that means nothing. */
export function debtCover(A: any) {
  const R = A?.R ?? {};
  const arr = (k: string) => (Array.isArray(R[k]) ? R[k] : []);
  const N = arr('lcl').length;
  const g = (k: string, i: number) => n(arr(k)[i]);
  const COV = 1.25;

  let peak = 0, peakM = 0;
  for (let i = 0; i < N; i++) if (g('lcl', i) > peak) { peak = g('lcl', i); peakM = i; }

  let minD: number | null = null, minM = -1, breaches = 0, periods = 0;
  for (let i = 0; i < N; i++) {
    const ds = g('intr', i) + g('rep', i) + g('lf', i);
    const sales = g('salescash', i);
    if (ds <= 0.5 || sales <= 0.5) continue;
    periods++;
    const cfads = sales - g('devc', i) - g('ovh', i) - g('taxm', i);
    const d = cfads / ds;
    if (minD === null || d < minD) { minD = d; minM = i; }
    if (d < COV) breaches++;
  }
  let future = 0;
  for (let i = peakM; i < N; i++)
    future += g('salescash', i) - g('devc', i) - g('ovh', i) - g('taxm', i);

  const gdv = n(A?.revenue) + n(A?.otherIncome);
  const cost = Math.max(0, gdv - n(A?.npat));
  return {
    peak, peakMonth: peakM + 1, limit: n(A?.lim),
    headroom: n(A?.lim) - peak,
    ltc: cost ? peak / cost : 0,
    ltgrv: gdv ? peak / gdv : 0,
    repaymentCover: peak > 0 ? future / peak : null,
    minDscr: minD, minDscrMonth: minM + 1, servicedPeriods: periods, breaches,
    covenant: COV,
  };
}

function fmtShort(v: number) {
  return Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}m` : `$${Math.round(v).toLocaleString('en-AU')}`;
}


/** Annual cashflow, aggregated from the engine's own monthly series using
 *  the engine's own financial-year boundaries (fyOf). Reimplementing the FY
 *  split here would let the cashflow disagree with the P&L about when a year
 *  starts — the kind of drift nobody notices until an auditor does. */
export function cashflow(A: any, fyOfMonth: number[]): Statement {
  const R = A?.R ?? {};
  const fys: number[] = A?.fys ?? [];
  const idx = new Map(fys.map((y, i) => [y, i]));
  const months = fyOfMonth?.length ?? 0;

  const byYear = (key: string): { values: number[]; total: number } => {
    const src = Array.isArray(R[key]) ? R[key] : [];
    const values = fys.map(() => 0);
    for (let mo = 0; mo < months; mo++) {
      const i = idx.get(fyOfMonth[mo]);
      if (i !== undefined) values[i] += n(src[mo]);
    }
    return { values, total: values.reduce((a, b) => a + b, 0) };
  };

  const row = (no: string | undefined, label: string, key: string, sign = 1,
               kind?: Row['kind']): Row => {
    const s = byYear(key);
    return {
      no, label,
      values: s.values.map((v) => v * sign),
      total: s.total * sign,
      kind,
    };
  };

  return {
    caption: 'Cashflow',
    columns: fys.map((y) => `FY${String(y).slice(2)}`),
    rows: [
      { label: 'RECEIPTS', values: [], total: null, kind: 'band' },
      row('1.1', 'Settlement proceeds', 'cfrefresrev'),
      row('1.2', 'GST refunds', 'cfgstrefund'),
      { label: 'PAYMENTS', values: [], total: null, kind: 'band' },
      row('2.1', 'Land', 'cfrefland', -1),
      row('2.2', 'Stamp duty', 'cfrefstamp', -1),
      row('2.3', 'Foreign purchaser surcharge', 'cfrefforeignstamp', -1),
      row('2.4', 'FIRB', 'cfreffirb', -1),
      row('2.5', 'Construction', 'cfrefconstruction', -1),
      row('2.6', 'Professional fees', 'cfrefprofessional', -1),
      row('2.7', 'Development management', 'cfrefdm', -1),
      row('2.8', 'Statutory', 'cfrefstatutory', -1),
      row('2.9', 'Contingency', 'cfrefcontingency', -1),
      row('2.10', 'Holding costs', 'cfrefholding', -1),
      row('2.11', 'Selling and marketing', 'cfrefselling', -1),
      row('2.12', 'GST paid', 'cfinputgstpaid', -1),
      row('2.13', 'Tax paid', 'cftaxpaid', -1),
      { label: 'FINANCE', values: [], total: null, kind: 'band' },
      row('3.1', 'Debt drawn', 'cfdebtraised'),
      row('3.2', 'Debt repaid', 'cfdebtrepaid', -1),
      row('3.3', 'Interest and fees', 'cfrefinterest', -1),
      { label: 'EQUITY', values: [], total: null, kind: 'band' },
      row('4.1', 'Equity injected', 'cfrefequity'),
      row('4.2', 'Equity returned', 'cfequitydist', -1),
      row('5', 'Net cash movement', 'cfrefnetcash', 1, 'result'),
    ],
    note:
      'Aggregated from the model\'s monthly series. The month-to-financial-year ' +
      'map is computed server-side by the engine itself, so the cashflow and the ' +
      'P&L cannot disagree about when a year starts. Payments are shown negative; net cash movement is the engine\'s ' +
      'own figure, not a re-sum of the rows above it.',
  };
}

/** Balance sheet. A.B is already keyed by financial year, so this reads
 *  positions rather than deriving them. Where the engine does not publish a
 *  line the row is omitted entirely rather than shown as zero — a zero
 *  asserts a position, an absent row does not. */
export function balanceSheet(A: any): Statement {
  const fys: number[] = A?.fys ?? [];
  const B = A?.B ?? {};
  const has = (k: string) => B[k] && typeof B[k] === 'object';
  const row = (no: string | undefined, label: string, key: string,
               kind?: Row['kind']): Row | null => {
    if (!has(key)) return null;
    const values = fys.map((y) => n(B[key][y]));
    return { no, label, values, total: values.length ? values[values.length - 1] : null, kind };
  };
  const rows = [
    { label: 'ASSETS', values: [], total: null, kind: 'band' as const },
    row('1.1', 'Cash at bank', 'closing'),
    row('1.2', 'Escrow / deposits held', 'escbal'),
    row('1.3', 'Land at cost', 'land'),
    row('1.4', 'Development work in progress', 'devc'),
    row('1.5', 'Receivable on exchanged contracts', 'balr'),
    { label: 'RECOGNITION', values: [], total: null, kind: 'band' as const },
    row('2.1', 'Settled value', 'sval'),
    row('2.2', 'Revenue recognised', 'recog'),
    row('2.3', 'Deposits received', 'dep'),
  ].filter(Boolean) as Row[];

  return {
    caption: 'Balance sheet positions',
    columns: fys.map((y) => `FY${String(y).slice(2)}`),
    rows,
    note:
      'Closing positions by financial year, read from the model rather than ' +
      'derived. The Total column shows the final year. This is the position set ' +
      'the engine publishes — it is not a statutory balance sheet and does not ' +
      'assert that assets equal liabilities plus equity.',
  };
}
