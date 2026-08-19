/** Chart and verdict data shaping. Pure functions over the engine's analysis
 *  object — no DOM, no React, no fetch — so the same numbers can be asserted
 *  in a test and cannot drift from what the model computed.
 *
 *  The rule throughout: every figure is READ from the analysis. Nothing here
 *  re-derives an economic quantity the engine already published. Where a
 *  chart needs a running total (the cumulative cash line) that is a drawing
 *  transform of a published series, and it is named as such.
 *
 *  Ported from the single-file build's summary dashboard runtime
 *  (auRefSupport / auRefKpis / auRefEconomicsChart / auRefGantt /
 *  auRefTornado / auRefSnapshot). Thresholds and phrasing are the legacy
 *  ones, not new ones.
 */

export type Analysis = any;

/* ── primitives ─────────────────────────────────────────────────────────── */

export const isNum = (v: any): v is number => typeof v === 'number' && isFinite(v);

/** A missing figure is a dash, never a zero. A zero asserts a position; a
 *  dash admits we do not have one. Ported from auRefMoney. */
export function money(v: any, prec?: number): string {
  if (!isNum(v)) return '—';
  const a = Math.abs(v), sign = v < 0 ? '−' : '';
  if (a >= 1e9) return `${sign}A$${(a / 1e9).toFixed(prec == null ? 2 : prec)}b`;
  if (a >= 1e6) return `${sign}A$${(a / 1e6).toFixed(prec == null ? (a < 100e6 ? 2 : 1) : prec)}m`;
  if (a >= 1e3) return `${sign}A$${(a / 1e3).toFixed(1)}k`;
  return `${sign}A$${Math.round(a).toLocaleString('en-AU')}`;
}

/** Whole dollars, the legacy `$` helper: negatives in accounting brackets. */
export function dollars(v: any): string {
  if (!isNum(v)) return '—';
  return v < 0
    ? `(A$${Math.round(Math.abs(v)).toLocaleString('en-AU')})`
    : `A$${Math.round(v).toLocaleString('en-AU')}`;
}

export const pct = (v: any, dp = 1) => (isNum(v) ? `${(v * 100).toFixed(dp)}%` : '—');
export const mult = (v: any) => (isNum(v) ? `${v.toFixed(2)}x` : '—');
export const num = (v: any, dp = 0) =>
  isNum(v)
    ? v.toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp })
    : '—';

/** Short axis tick: 1.2b / 34m / 900k. Compact enough for a 9px label. */
export function axisTick(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}b`;
  if (a >= 1e6) return `${Math.round(v / 1e6)}m`;
  if (a >= 1e3) return `${Math.round(v / 1e3)}k`;
  return String(Math.round(v));
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
             'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Month index -> calendar label, using the engine's own start month/year off
 *  the derived inputs it returned. This is a CALENDAR label, not a financial
 *  year: FY boundaries come from the engine's exported fyOf, delivered to the
 *  client as a resolved month->FY array, and are never recomputed here. */
export function monthLabel(m: any, d: any): string {
  if (!isNum(m) || !d || !isNum(d.startMonth) || !isNum(d.startYear)) return '—';
  const i = (d.startMonth - 1) + m;
  return `${MON[((i % 12) + 12) % 12]}-${String(d.startYear + Math.floor(i / 12)).slice(2)}`;
}

/* ── scales ─────────────────────────────────────────────────────────────── */

export type Domain = { min: number; max: number };

/** Vertical domain for a chart. Returns null when there is nothing to plot,
 *  so the caller renders an empty state instead of an axis with no meaning.
 *
 *  A flat series — a project with no debt has an all-zero loan balance — is
 *  padded to a real interval. Without this the value-to-pixel scale divides
 *  by (max-min) === 0 and every point lands on NaN. */
export function domain(values: (number | null | undefined)[], includeZero = true): Domain | null {
  const nums = values.filter(isNum);
  if (!nums.length) return null;
  let min = Math.min(...nums), max = Math.max(...nums);
  if (includeZero) { min = Math.min(min, 0); max = Math.max(max, 0); }
  if (!(max > min)) {
    const pad = Math.max(1, Math.abs(max) * 0.1);
    return { min: min - pad, max: max + pad };
  }
  const pad = (max - min) * 0.08;
  return { min: min - pad, max: max + pad };
}

/** Five evenly spaced gridline values across the domain, as the legacy did. */
export function gridValues(dm: Domain, n = 4): number[] {
  return Array.from({ length: n + 1 }, (_, i) => dm.min + (dm.max - dm.min) * i / n);
}

/* ── 1. verdict banner ──────────────────────────────────────────────────── */

export type VerdictReason = { label: string; state: 'pass' | 'fail' | 'info' };
export type Verdict = {
  level: 'supports' | 'marginal' | 'stop' | 'unknown';
  icon: string;
  title: string;
  reasons: VerdictReason[];
};

/** The headline judgement. THRESHOLDS ARE THE LEGACY ONES, verbatim:
 *
 *    irrOk = equity IRR >= the hurdle input
 *    npvOk = NPV >= 0
 *    both  -> supports · one -> marginal · neither -> does not support
 *
 *  A figure the model could not produce fails its test — the same as the
 *  legacy comparison against null — but it is REPORTED as unavailable rather
 *  than as a number, so nobody reads a dash as a zero. */
export function verdict(A: Analysis): Verdict | null {
  if (!A) return null;
  const d = A.d ?? {};
  const hurdle = isNum(d.hurdle) ? d.hurdle / 100 : 0;
  const irrOk = isNum(A.eirr) && A.eirr >= hurdle;
  const npvOk = isNum(A.npv) && A.npv >= 0;
  const ok = irrOk && npvOk, soft = !ok && (irrOk || npvOk);

  const npvReason: VerdictReason = !isNum(A.npv)
    ? { label: 'NPV is not available', state: 'info' }
    : npvOk
      ? { label: `Positive ${money(A.npv)} NPV`, state: 'pass' }
      : { label: `Negative ${money(Math.abs(A.npv))} NPV`, state: 'fail' };

  // Neither test has a figure behind it. The legacy comparison would call
  // that a failure, because null fails every comparison — but a judgement
  // nobody computed is not a judgement, and printing one would be the same
  // sin as printing a zero for a missing number. The thresholds above are
  // untouched; this only declines to apply them to nothing.
  const blind = !isNum(A.eirr) && !isNum(A.npv);

  return {
    level: blind ? 'unknown' : ok ? 'supports' : soft ? 'marginal' : 'stop',
    icon: blind ? '?' : ok ? '✓' : soft ? '!' : '×',
    title: blind
      ? 'No verdict — the model has not returned a result'
      : ok
        ? 'Project supports this price'
        : soft
          ? 'Project is marginal at this price'
          : 'Project does not support this price',
    reasons: [
      {
        label: `Equity IRR ${pct(A.eirr)} vs ${num(d.hurdle, 1)}% target`,
        state: isNum(A.eirr) ? (irrOk ? 'pass' : 'fail') : 'info',
      },
      npvReason,
      { label: `Current land ask ${dollars(d.pr)} / sqm`, state: 'info' },
    ],
  };
}

/* ── 2. investment summary KPI cards ────────────────────────────────────── */

export type Kpi = { label: string; value: string; detail: string };

/** Ported from auRefKpis. Revenue includes other income; total cost is the
 *  revenue-less-profit identity the legacy used, so cost and profit can never
 *  disagree with the P&L. */
export function investmentKpis(A: Analysis): Kpi[] {
  if (!A) return [];
  const d = A.d ?? {};
  const revenue = isNum(A.revenue) || isNum(A.otherIncome)
    ? (isNum(A.revenue) ? A.revenue : 0) + (isNum(A.otherIncome) ? A.otherIncome : 0)
    : null;
  const cost = isNum(revenue) && isNum(A.npat) ? Math.max(0, revenue - A.npat) : null;
  const eqShare = isNum(A.epeak) && isNum(cost) ? A.epeak / Math.max(1, cost) : null;
  const margin = isNum(revenue) && revenue !== 0 && isNum(A.npat) ? A.npat / revenue : null;
  const taxed = Math.abs(Number(d.ftax) || 0) > 1e-4 || Math.abs(Number(d.stax) || 0) > 1e-4;

  return [
    { label: 'Equity IRR', value: pct(A.eirr), detail: `vs ${num(d.hurdle, 1)}% target` },
    { label: taxed ? 'Net Profit' : 'Project PBT', value: money(A.npat), detail: `${pct(margin, 0)} margin` },
    { label: 'Revenue', value: money(revenue), detail: 'Total' },
    { label: 'Equity Required', value: money(A.epeak), detail: `${pct(eqShare, 1)} of project cost` },
    { label: 'NPV', value: money(A.npv), detail: `at ${num(d.r, 1)}% discount` },
  ];
}

/* ── 3. revenue / cost / net cash, annual ───────────────────────────────── */

export type EconomicsSeries = {
  years: number[];
  revenue: (number | null)[];
  cost: (number | null)[];
  net: (number | null)[];
};

/** Cumulative revenue, cost and net cash by financial year, over the window
 *  where anything actually happens (with a year of air either side, and a
 *  five-year floor so a short project does not render as two points).
 *
 *  The years are the ENGINE's financial years (A.fys) and the buckets are the
 *  engine's own annualisation (A.PL / A.B) — this file never decides where a
 *  financial year starts. */
export function economics(A: Analysis): EconomicsSeries | null {
  const years: number[] = Array.isArray(A?.fys) ? A.fys : [];
  if (!years.length) return null;

  const rev: number[] = [], cost: number[] = [], net: number[] = [];
  let cr = 0, cc = 0, cn = 0;
  years.forEach((y) => {
    const p = A.PL?.[y] ?? {};
    const r = (isNum(p.rev) ? p.rev : 0) + (isNum(p.otherIncome) ? p.otherIncome : 0);
    const profit = isNum(p.npat) ? p.npat : 0;
    const n = A.B?.net?.[y];
    rev.push((cr += r));
    cost.push((cc += r - profit));
    net.push((cn += isNum(n) ? n : 0));
  });

  // window: first and last year with movement, padded, minimum five columns
  const active = years
    .map((_, i) => i)
    .filter((i) => Math.abs(rev[i]) + Math.abs(cost[i]) + Math.abs(net[i]) > 1);
  const first = active.length ? Math.max(0, active[0] - 1) : 0;
  let last = active.length
    ? Math.min(years.length - 1, active[active.length - 1] + 1)
    : Math.min(years.length - 1, 5);
  if (last - first < 4) last = Math.min(years.length - 1, first + 4);

  const slice = <T,>(a: T[]) => a.slice(first, last + 1);
  const ys = slice(years);
  if (!ys.length) return null;
  return { years: ys, revenue: slice(rev), cost: slice(cost), net: slice(net) };
}

/* ── 4. development timeline ────────────────────────────────────────────── */

export type TimelineBar = { track: 'ent' | 'dev' | 'sales' | 'settle'; from: number; to: number };
export type TimelineRow = { label: string; sub: string; bars: TimelineBar[]; tip: string };
export type Timeline = {
  rows: TimelineRow[];
  milestones: { label: string; month: number }[];
  start: number; end: number; step: number;
};

/** Ported from auRefGantt: entitlement, project-wide sales/contracting, then
 *  one row per construction phase carrying its build bar and its settlement
 *  bar. Every month comes from the analysis (A.entStart, A.d._ent, A.st,
 *  A.close, A.lastDlv, A.phaseSchedule, A.unitRecords, A.projectSales). */
export function timeline(A: Analysis): Timeline | null {
  if (!A) return null;
  const d = A.d ?? {};
  const f = (v: any) => (isNum(Number(v)) ? Number(v) : null);

  const entStart = f(A.entStart) ?? f(d.ddend);
  const entEnd = f(d._ent) ?? f(A.st);
  const close = f(A.close);
  const constructionStart = f(A.st);
  const lastSettlement = f(A.lastDlv);

  const phases: any[] = Array.isArray(A.phaseSchedule) ? A.phaseSchedule : [];
  const units: any[] = Array.isArray(A.unitRecords) ? A.unitRecords : [];
  const rows: TimelineRow[] = [];

  if (entStart != null && entEnd != null) {
    rows.push({
      label: 'Entitlement / approvals',
      sub: `${monthLabel(entStart, d)} to ${monthLabel(entEnd, d)}`,
      bars: [{ track: 'ent', from: entStart, to: Math.max(entStart, entEnd - 1) }],
      tip: `Entitlement / approvals — ${monthLabel(entStart, d)} to ${monthLabel(entEnd, d)}`,
    });
  }

  const ps = A.projectSales ?? {};
  const contracts = units.map((u) => f(u.contractMonth)).filter(isNum);
  const salesStart = f(ps.start) ?? (contracts.length ? Math.min(...contracts) : null);
  const salesEnd = f(ps.end) ?? (contracts.length ? Math.max(...contracts) : null);
  if (salesStart != null && salesEnd != null) {
    const total = f(ps.total) ?? units.length;
    const rate = f(ps.rate) ?? (A.vert ? f(d.vel) : f(d.absn));
    const word = A.vert ? 'units' : 'lots';
    const rateText = rate == null ? 'rate unavailable' : `${num(rate, 1)} ${word}/month`;
    rows.push({
      label: 'Sales / contracting',
      sub: `${rateText} · ${num(total)} ${word} total`,
      bars: [{ track: 'sales', from: salesStart, to: salesEnd }],
      tip: `Project-wide sales / contracting — ${rateText} — ${num(total)} ${word} — ` +
           `${monthLabel(salesStart, d)} to ${monthLabel(salesEnd, d)}`,
    });
  }

  phases.forEach((ph) => {
    const start = f(ph.start), end = f(ph.end) ?? f(ph.complete);
    const mine = units.filter((u) => Number(u.phase) === Number(ph.phase) - 1);
    const deliveries = mine.map((u) => f(u.delivery)).filter(isNum);
    const rs = f(ph.realisationStart) ?? (deliveries.length ? Math.min(...deliveries) : null);
    const re = f(ph.realisationEnd) ?? (deliveries.length ? Math.max(...deliveries) : null);
    const word = A.vert ? 'units' : 'lots';
    const bars: TimelineBar[] = [];
    if (start != null && end != null) bars.push({ track: 'dev', from: start, to: end });
    if (rs != null && re != null) bars.push({ track: 'settle', from: rs, to: re });
    if (!bars.length) return;
    const parts = [`Phase ${ph.phase}`, `${num(ph.lots)} ${word}`];
    if (start != null && end != null)
      parts.push(`Construction ${monthLabel(start, d)} to ${monthLabel(end, d)}`);
    if (rs != null && re != null)
      parts.push(`Settlement ${monthLabel(rs, d)} to ${monthLabel(re, d)} (${num(mine.length)} ${word})`);
    rows.push({
      label: `Phase ${ph.phase}`,
      sub: `Total ${word}: ${num(ph.lots)}`,
      bars, tip: parts.join(' — '),
    });
  });

  const points: number[] = [];
  rows.forEach((r) => r.bars.forEach((b) => {
    points.push(Math.min(b.from, b.to), Math.max(b.from, b.to) + 1);
  }));
  const milestones: { label: string; month: number }[] = [];
  if (close != null) { milestones.push({ label: 'Land close', month: close }); points.push(close); }
  if (constructionStart != null) {
    milestones.push({ label: 'Construction start', month: constructionStart });
    points.push(constructionStart);
  }
  if (lastSettlement != null) {
    milestones.push({ label: 'Last settlement', month: lastSettlement });
    points.push(lastSettlement);
  }
  if (!points.length) return null;

  const start = Math.min(...points);
  let end = Math.max(...points);
  if (end <= start) end = start + 1;
  const span = end - start;
  return { rows, milestones, start, end, step: span <= 24 ? 3 : span <= 48 ? 6 : 12 };
}

/* ── 5. loan balance and cumulative cash, monthly ───────────────────────── */

export type LoanCash = {
  months: number[];
  loan: (number | null)[];
  equityCash: (number | null)[];
  cumulativeCash: (number | null)[];
  fyBreaks: { index: number; fy: number }[];
  hasDebt: boolean;
};

/** Loan balance (A.R.lcl) and equity cash flow (A.R.cfrefprofit), both read
 *  straight off the engine's monthly rows. The cumulative line is a running
 *  total of the published monthly series — a drawing transform, not a second
 *  opinion; its final value is the engine's own A.egain.
 *
 *  fyBreaks are taken from the RESOLVED month->FY array the server built with
 *  the engine's exported fyOf. This file does not know where a financial year
 *  starts and must not guess: two implementations of that boundary have
 *  silently disagreed before. Pass null and you get no year markers, which is
 *  the honest outcome. */
export function loanCash(A: Analysis, fyOfMonth: number[] | null): LoanCash | null {
  const R = A?.R;
  if (!R) return null;

  // the legacy window: the last month in which any cashflow line moves
  const keys = ['cfrefresrev', 'cfrefgst', 'cfrefland', 'cfrefconstruction', 'cfgstrefund',
                'cfrefnetcash', 'dr1', 'dr2', 'rep', 'pf', 'intr', 'lf',
                'cfrefequity', 'cfrefsurplus'];
  let last = 0;
  keys.forEach((k) => (R[k] ?? []).forEach((v: number, i: number) => {
    if (isNum(v) && Math.abs(v) > 0.5) last = Math.max(last, i);
  }));
  const lcl: number[] = R.lcl ?? [];
  const eq: number[] = R.cfrefprofit ?? [];
  if (!lcl.length && !eq.length) return null;
  last = Math.max(last, 0);

  const months = Array.from({ length: last + 1 }, (_, m) => m);
  const loan = months.map((m) => (isNum(lcl[m]) ? lcl[m] : null));
  const equityCash = months.map((m) => (isNum(eq[m]) ? eq[m] : null));
  let run = 0;
  const cumulativeCash = months.map((m) => {
    if (!isNum(eq[m])) return null;
    run += eq[m];
    return run;
  });

  const fyBreaks: { index: number; fy: number }[] = [];
  if (Array.isArray(fyOfMonth) && fyOfMonth.length) {
    for (let m = 1; m <= last; m++) {
      if (fyOfMonth[m] != null && fyOfMonth[m] !== fyOfMonth[m - 1])
        fyBreaks.push({ index: m, fy: fyOfMonth[m] });
    }
  }

  return {
    months, loan, equityCash, cumulativeCash, fyBreaks,
    hasDebt: loan.some((v) => isNum(v) && Math.abs(v) > 0.5),
  };
}

/* ── 6. tornado ─────────────────────────────────────────────────────────── */

export type TornadoDriver = { key: string; label: string };
export type TornadoRow = {
  key: string; label: string;
  low: number | null; high: number | null;
  downside: number; upside: number; span: number;
  lowIsDownside: boolean;
};

/** The legacy tornado's preferred driver order, adapted to the keys this
 *  engine actually exposes: the US build's per-unit construction lever
 *  (vinfl) does not exist here, and buildpsf — construction cost per sqm of
 *  BUA — is the same lever in this model's units. Anything the engine does
 *  not carry is simply absent; nothing is invented to fill the row. */
export const TORNADO_DRIVERS: TornadoDriver[] = [
  { key: 'hpsf', label: 'Sale price per sqm' },
  { key: 'buildpsf', label: 'Construction cost per sqm' },
  { key: 'pr', label: 'Land price' },
  { key: 'pidel', label: 'Eligible share of construction cost' },
  { key: 'pidrt', label: 'Reimbursement / credit rate' },
  { key: 'contpc', label: 'Contingency rate' },
  { key: 'rate', label: 'Interest rate' },
  { key: 'esc', label: 'Price escalation' },
  { key: 'infesc', label: 'Construction escalation' },
  { key: 'ph1dur', label: 'Phase duration' },
];

/** Metric keys are the ones /api/sensitivity accepts; `read` is where the
 *  SAME figure lives on the analysis, so the centre of the tornado is the
 *  engine's own number rather than a re-run of the base case. */
export type TornadoMetric = {
  key: string; label: string;
  read: (A: Analysis) => any;
  fmt: (v: any) => string;
};

export const TORNADO_METRICS: TornadoMetric[] = [
  { key: 'npv', label: 'Project NPV', read: (A) => A?.npv, fmt: (v) => money(v) },
  { key: 'npat', label: 'Net profit', read: (A) => A?.npat, fmt: (v) => money(v) },
  { key: 'equityIrr', label: 'Equity IRR', read: (A) => A?.eirr, fmt: (v) => pct(v) },
  { key: 'margin', label: 'Net margin', read: (A) => A?.margin, fmt: (v) => pct(v) },
  { key: 'moic', label: 'Equity multiple', read: (A) => A?.moic, fmt: (v) => mult(v) },
  { key: 'peakEquity', label: 'Equity required (peak)', read: (A) => A?.epeak, fmt: (v) => money(v) },
];

export const tornadoMetric = (k: string): TornadoMetric =>
  TORNADO_METRICS.find((m) => m.key === k) ?? TORNADO_METRICS[0];

/** Rank drivers by how far a +/- swing moves the metric. Each end is a FULL
 *  model run performed by the sensitivity endpoint, exactly as the legacy
 *  worker did — never a gradient taken at the base case, because a
 *  development model is full of thresholds that a linearisation walks
 *  straight through. A driver that could not be run is dropped, not zeroed. */
export function tornadoRows(
  base: number,
  raw: { key: string; label: string; low: number | null; high: number | null }[],
  limit = 5,
): TornadoRow[] {
  return raw
    .map((r) => {
      if (!isNum(r.low) && !isNum(r.high)) return null;
      const lo = isNum(r.low) ? r.low : base;
      const hi = isNum(r.high) ? r.high : base;
      return {
        key: r.key, label: r.label, low: r.low, high: r.high,
        downside: Math.min(lo, hi) - base,
        upside: Math.max(lo, hi) - base,
        span: Math.abs(hi - lo),
        lowIsDownside: lo <= hi,
      };
    })
    .filter((r): r is TornadoRow => !!r && r.span > 1e-9)
    .sort((a, b) => b.span - a.span)
    .slice(0, limit);
}

/* ── 7. project snapshot ────────────────────────────────────────────────── */

export type SnapshotRow = { label: string; value: string };

/** Ported from auRefSnapshot. Duration is the engine's own close-to-last-
 *  settlement span; first sale is the first month its contracted-value row
 *  moves. */
export function snapshot(A: Analysis): SnapshotRow[] {
  if (!A) return [];
  const d = A.d ?? {};
  const revenue = isNum(A.revenue) || isNum(A.otherIncome)
    ? (isNum(A.revenue) ? A.revenue : 0) + (isNum(A.otherIncome) ? A.otherIncome : 0)
    : null;
  const cost = isNum(revenue) && isNum(A.npat) ? Math.max(0, revenue - A.npat) : null;
  const grossMargin = isNum(revenue) && revenue !== 0 && isNum(A.gross) ? A.gross / revenue : null;
  const duration = isNum(A.lastDlv) && isNum(A.close)
    ? Math.max(1, A.lastDlv - A.close + 1) : null;
  const sval: number[] = A.R?.sval ?? [];
  const firstSale = sval.findIndex((v) => isNum(v) && v > 1);

  return [
    { label: A.vert ? 'Units' : 'Lots / Units', value: num(d._lots) },
    { label: 'Project Cost', value: money(cost) },
    { label: 'Revenue', value: money(revenue) },
    { label: 'Gross Margin', value: pct(grossMargin, 0) },
    { label: 'Equity Multiple', value: mult(A.moic) },
    { label: 'Duration', value: duration == null ? '—' : `${num(duration)} mo` },
    { label: 'First Sale', value: firstSale >= 0 ? monthLabel(firstSale, d) : '—' },
    { label: 'Last Settlement', value: isNum(A.lastDlv) ? monthLabel(A.lastDlv, d) : '—' },
  ];
}
