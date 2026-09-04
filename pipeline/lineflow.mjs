/* Per-line monthly reconciliation against a workbook's Monthly CF sheet.

   monthlydiff.mjs compares one series - the equity cashflow - which answers "is the
   return right" but not "which line is wrong". These workbooks lay out every cost as
   its own dated row, and the engine keeps a mirror of exactly that shape in its
   cfref* arrays, so each line can be compared on its own axis: total, and month by
   month.

   Rows are found by LABEL, never by row number: Beckett puts Net Cashflow on row 45
   and Hendra on row 43, and the same template drifts by a row or two in every file. */
import { openWorkbook } from "./lib/xlsx.mjs";
import { serialToDate, iso } from "./eqirr.mjs";

const colToNum = (s) => { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };
const numToCol = (n) => { let s = ""; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; } return s; };

/* Workbook label -> engine monthly series. `abs` compares magnitudes where the two
   sides disagree only about which way a cost points. The cfref* arrays are the
   engine's own reference cashflow, built to mirror these sheets line for line. */
export const LINES = [
  /* Group subtotals carry the comparison. Component rows are NOT portable across
     these files - Beckett splits construction by phase, Hendra by infra, and
     contingency and decontamination sit inside the group on one sheet and outside
     it on another - but every file carries the same subtotal rows, and those are
     what the engine's aggregates can be compared against without guessing. The
     indented rows are shown for detail where they do match. */
  { item: "Gross sales",            labels: ["gross sales"],              app: R => R.cfrefresrev },
  { item: "Output GST",             labels: ["less gst", "less: gst"],    app: R => R.cfrefgst, abs: true },
  { item: "Net revenue",            labels: ["net revenue"],              app: R => sub(R.cfrefresrev, R.cfrefgst) },
  { item: "Sales & marketing",      labels: ["sales & marketing", "sales and marketing"],
    app: R => add(R.cfrefbrokerage, R.cfrefselling, R.cfrefmarketing) },
  { item: "  Marketing",            labels: ["marketing costs"],          app: R => R.cfrefmarketing },
  { item: "  Brokerage",            labels: ["brokerage"],                app: R => R.cfrefbrokerage },
  { item: "  Settlement brokerage", labels: ["settlement brokerage"],     app: R => R.cfrefselling },
  { item: "Land costs",             labels: ["land costs", "land cost"],  app: R => R.cfrefland },
  { item: "Statutory & approvals",  labels: ["statutory & approvals", "statutory and approvals"],
    app: R => add(R.cfrefstamp, R.cfrefforeignstamp, R.cfreffirb, R.cfrefholding, R.cfrefstatutory) },
  { item: "  Stamp duty",           labels: ["stamp duty"],               app: R => R.cfrefstamp },
  { item: "  Foreign surcharge",    labels: ["foreign surcharge"],        app: R => R.cfrefforeignstamp },
  { item: "  FIRB fee",             labels: ["firb application", "firb"], app: R => R.cfreffirb },
  { item: "  Land holding",         labels: ["land holding"],             app: R => R.cfrefholding },
  { item: "  Statutory costs",      labels: ["statutory costs"],          app: R => R.cfrefstatutory },
  { item: "Construction & dev",     labels: ["construction & development", "construction and development"],
    app: R => add(R.cfrefconstruction, R.cfrefprofessional, R.cfrefdm, R.cfrefcontingency) },
  { item: "  Professional fee",     labels: ["professional fee"],         app: R => R.cfrefprofessional },
  { item: "  DM fee",               labels: ["dm fee", "dm"],             app: R => R.cfrefdm },
  { item: "GST input credit",       labels: ["gst - input tax", "input tax credit", "gst - input"],
    app: R => R.gstrefund, abs: true },
  /* The sheet's own definition of this subtotal is the sum of the groups above it,
     so that is what it is compared against. R.devc is a different quantity - it
     excludes selling costs and treats GST its own way - and using it reported a 5%
     gap that was a definition mismatch rather than a costing difference. */
  { item: "Total dev cost ex fin",  labels: ["total development cost"],
    app: R => sub(add(R.cfrefland, R.cfrefstamp, R.cfrefforeignstamp, R.cfreffirb, R.cfrefholding,
      R.cfrefstatutory, R.cfrefconstruction, R.cfrefprofessional, R.cfrefdm, R.cfrefcontingency,
      R.cfrefbrokerage, R.cfrefselling, R.cfrefmarketing), R.gstrefund) },
  { item: "Net cashflow",           labels: ["net cashflow"],             app: R => R.cfrefnetcash, abs: true },
  { item: "Debt drawdown",          labels: ["debt drawdown"],            app: R => R.cfrefdebt, abs: true },
  { item: "Interest",               labels: ["interest expense"],         app: R => R.cfrefinterest },
  { item: "Line fee",               labels: ["line fee"],                 app: R => R.cfreflifetime },
  { item: "Establishment fee",      labels: ["establishment fee"],        app: R => R.cfrefprocessing },
  { item: "Principal repayment",    labels: ["principle repayment", "principal repayment"],
    app: R => R.cfrefrepayment },
  /* A balance is a level, not a flow: summing it across months is meaningless, so
     this one compares its peak and its month-by-month path instead. */
  { item: "Closing debt (peak)",    labels: ["ending debt balance"],      app: R => R.lcl, balance: true },
];

const sub = (a, b) => {
  const n = Math.max((a || []).length, (b || []).length), out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) out[i] = ((a || [])[i] || 0) - ((b || [])[i] || 0);
  return out;
};

const add = (...rows) => {
  const n = Math.max(...rows.map(r => (r || []).length));
  const out = new Array(n).fill(0);
  for (const r of rows) for (let i = 0; i < (r || []).length; i++) out[i] += r[i] || 0;
  return out;
};
const sum = (a) => (a || []).reduce((x, y) => x + (y || 0), 0);

/* The label column is not the same on every sheet, so scan the first few and take
   the leftmost cell whose text starts with the label - "Brokerage" must not match
   "Settlement brokerage", which is why this anchors at the start rather than
   anywhere in the string. */
function findRow(sh, labels, cols = ["A", "B", "C"]) {
  for (const needle of labels) {
    for (const col of cols) {
      for (let r = 1; r <= sh.maxRow; r++) {
        const v = String(sh.get(r, col) || "").trim().toLowerCase();
        if (v && v.startsWith(needle)) return { row: r, col, label: String(sh.get(r, col)).trim() };
      }
    }
  }
  return null;
}

export function compareLines(opts) {
  const { workbook, sheet, dateRow, firstCol, lastCol, R, d } = opts;
  const wb = openWorkbook(workbook);
  const sh = wb.rawSheet(sheet);

  const from = colToNum(firstCol), to = colToNum(lastCol);
  const cols = [], serials = [];
  for (let c = from; c <= to; c++) {
    const col = numToCol(c), dt = sh.num(dateRow, col);
    if (dt == null) continue;
    cols.push(col); serials.push(dt);
  }
  const edges = serials.map(s => serialToDate(s).getTime());
  const monthEnd = (m) => Date.UTC(Math.round(d.startYear), Math.round(d.startMonth) + m, 0);
  /* Engine months land in the workbook period they fall on or before; anything past
     the last dated column keeps its own appended period so a tail is never dragged
     forward into the final month. */
  const bucket = (series) => {
    const extra = [];
    for (let m = 0; m < (series || []).length; m++)
      if (series[m] && monthEnd(m) > edges[edges.length - 1]) extra.push(monthEnd(m));
    const all = [...edges, ...[...new Set(extra)].sort((a, b) => a - b)];
    const out = new Array(all.length).fill(0);
    for (let m = 0; m < (series || []).length; m++) {
      const v = series[m]; if (!v) continue;
      let i = all.findIndex(e => monthEnd(m) <= e);
      if (i === -1) i = all.length - 1;
      out[i] += v;
    }
    return { out, extended: all.length - edges.length };
  };

  const results = [];
  for (const L of LINES) {
    const hit = findRow(sh, L.labels);
    if (!hit) { results.push({ item: L.item, missing: true }); continue; }
    const wbMonthly = cols.map(c => sh.num(hit.row, c) || 0);
    const appSeries = L.app(R) || [];
    const { out: appMonthly, extended } = bucket(appSeries);
    const f = L.abs ? Math.abs : (x) => x;
    const peak = (arr) => Math.max(0, ...(arr || []).map(v => Math.abs(v || 0)));
    const wbTotal = L.balance ? peak(wbMonthly) : f(sum(wbMonthly));
    const appTotal = L.balance ? peak(appSeries) : f(sum(appSeries));
    const pct = Math.abs(wbTotal) > 1 ? (appTotal - wbTotal) / Math.abs(wbTotal) * 100 : (Math.abs(appTotal) < 1 ? 0 : null);

    let first = null, worst = 0, worstMonth = null;
    const tol = Math.max(500, Math.abs(wbTotal) * 0.002);
    for (let i = 0; i < appMonthly.length; i++) {
      const w = f(wbMonthly[i] || 0), a = f(appMonthly[i] || 0), diff = a - w;
      if (Math.abs(diff) > tol) {
        if (first === null) first = i;
        if (Math.abs(diff) > Math.abs(worst)) { worst = diff; worstMonth = i; }
      }
    }
    results.push({
      item: L.item, row: hit.row, label: hit.label, wbTotal, appTotal, pct,
      within1pc: pct != null && Math.abs(pct) <= 1,
      firstDivergentPeriod: first,
      firstDivergentDate: first == null ? null : (first < serials.length ? iso(serials[first]) : "(past window)"),
      worst, worstMonth, extended,
      shape: first == null ? "aligned" : (Math.abs(pct || 0) <= 1 ? "same total, different months" : "different total"),
    });
  }
  return { results, periods: cols.length, from: iso(serials[0]), to: iso(serials[serials.length - 1]) };
}
