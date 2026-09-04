/* Month-by-month reconciliation of every parcel against its workbook.

   The endpoint IRR cannot distinguish "the cash is smaller" from "the cash is
   later", and on Beckett the answer turned out to be almost entirely the second:
   its P&L reconciles to 0.25% while its IRR sits three points low, purely because
   the final settlement lands a month after the workbook's. So the comparison has
   to be the series, not the total.

   Alignment is by date, never by column index. Each workbook period is a bucket
   ending on its own dated column, and engine months fall into the bucket whose
   end date they land on or before - which makes a quarterly sheet (Drummoyne) and
   a monthly one (everything else) the same problem. */
import { openWorkbook } from "./lib/xlsx.mjs";
import { loadApp } from "./reconcile.mjs";
import { PAIRS, UNPAIRED_WORKBOOKS, pairFor } from "./pairs.mjs";
import { findXirrCells, seriesFor, xirr, iso, serialToDate } from "./eqirr.mjs";
import { pathToFileURL } from "node:url";

const DIR = "Individual BPs";
const pct = (v) => v == null ? "   n/a " : (v * 100).toFixed(2) + "%";
const money = (v) => Math.round(v).toLocaleString();

/* Engine period m ends on the last day of its month, which is the convention the
   workbooks date their columns with and the one monthEndYearFractions already
   assumes inside the model. */
const engineMonthEnd = (d, m) => Date.UTC(Math.round(d.startYear), Math.round(d.startMonth) + m, 0);

/* Sum engine cashflows into the workbook's own periods. Anything falling before
   the first bucket joins it, so early equity is never dropped on the floor - that
   would flatter the app's IRR exactly where the workbooks are already suspect.

   Cash landing after the workbook's last dated column gets its own extra monthly
   periods rather than being folded into the final bucket. Folding is what an
   overrun looks like if you are not careful, and it is badly misleading: on
   Paddington it dragged three months of tail receipts forward and lifted the
   app's apparent IRR by three points. The workbook simply reads zero out there. */
function bucket(engineCf, d, serials) {
  const edges = serials.map(s => serialToDate(s).getTime());
  const extra = [], early = [];
  const last = edges[edges.length - 1], firstEdge = edges[0];
  for (let m = 0; m < engineCf.length; m++) {
    if (!engineCf[m]) continue;
    const t = engineMonthEnd(d, m);
    if (t > last) extra.push(t);
    /* Cash before the workbook's first period gets its own period at the front, for
       the same reason the tail does. Folding it forward moved Hendra's land deposit
       five months later and read 52% where the model says 34%. Several of these
       XIRR ranges genuinely start after the project does. */
    else if (t < firstEdge) early.push(t);
  }
  const extraEdges = [...new Set(extra)].sort((a, b) => a - b);
  const earlyEdges = [...new Set(early)].sort((a, b) => a - b);
  const allEdges = [...earlyEdges, ...edges, ...extraEdges];
  const out = new Array(allEdges.length).fill(0);
  for (let m = 0; m < engineCf.length; m++) {
    const v = engineCf[m];
    if (!v) continue;
    const t = engineMonthEnd(d, m);
    let i = allEdges.findIndex(e => t <= e);
    if (i === -1) i = allEdges.length - 1;
    out[i] += v;
  }
  const serialOf = (ms) => ms / 864e5 + 25569;
  return {
    series: out,
    serials: allEdges.map(serialOf),
    extended: extraEdges.length, lead: earlyEdges.length,
  };
}

export function compareParcel(M, parcel, pair) {
  const wb = openWorkbook(DIR + "/" + pair.file);
  const cells = findXirrCells(wb);
  const x = cells.find(c => c.parsed && c.sheetName === pair.sheet && c.ref === pair.cell);
  if (!x) throw new Error(`no XIRR at ${pair.sheet}!${pair.cell} in ${pair.file}`);
  const s = seriesFor(wb, x);

  const d = M.derive(parcel.inputs);
  const R = M.run(d);
  const engineCf = R.R.eqcf.slice(0, R.NM + 1);
  const B = bucket(engineCf, d, s.serials);
  const appSeries = B.series;
  /* The workbook contributes nothing beyond its own last dated column. */
  const lead = B.serials.length - s.cashflows.length - B.extended;
  const wbSeries = new Array(Math.max(0,lead)).fill(0).concat(s.cashflows, new Array(B.extended).fill(0));

  const rows = [];
  let cumApp = 0, cumWb = 0, firstDiverge = null;
  const tol = Math.max(1000, Math.abs(s.cashflows.reduce((a, b) => a + Math.abs(b), 0)) * 1e-5);
  for (let i = 0; i < B.serials.length; i++) {
    const a = appSeries[i], w = wbSeries[i], diff = a - w;
    cumApp += a; cumWb += w;
    if (Math.abs(diff) > tol) {
      if (firstDiverge === null) firstDiverge = i;
      rows.push({ i, col: s.columns[i] || "(+)", date: iso(B.serials[i]), wb: w, app: a, diff, cum: cumApp - cumWb });
    }
  }
  return {
    parcel: parcel.name, pair, x, series: s, R, d,
    appOnWorkbookDates: xirr(appSeries, B.serials),
    appNative: R.eirr, workbook: s.recomputed ?? s.cached,
    rows, firstDiverge, extended: B.extended, totalApp: cumApp, totalWb: cumWb,
  };
}

function main() {
  const M = loadApp();
  const seen = new Map();
  const results = [];
  for (const parcel of M.parcels) {
    const key = parcel.name.replace(/\s*\(.*$/, "");
    const pair = pairFor(parcel.name, seen);
    seen.set(key, (seen.get(key) || 0) + 1);
    if (!pair) { results.push({ parcel: parcel.name, unpaired: true }); continue; }
    try { results.push(compareParcel(M, parcel, pair)); }
    catch (e) { results.push({ parcel: parcel.name, error: e.message, pair }); }
  }

  console.log("EQUITY IRR - app vs its workbook's own Monthly CF cell\n");
  console.log("parcel                          workbook   app(wb dates)  app(native)   gap pts   verdict");
  for (const r of results) {
    if (r.unpaired) { console.log(r.parcel.slice(0, 30).padEnd(32) + "  (no workbook paired)"); continue; }
    if (r.error) { console.log(r.parcel.slice(0, 30).padEnd(32) + "  !! " + r.error); continue; }
    const gap = (r.appOnWorkbookDates != null && r.workbook != null)
      ? (r.appOnWorkbookDates - r.workbook) * 100 : null;
    const verdict = gap == null ? "no irr" : Math.abs(gap) <= 1 ? "PASS" : "FAIL";
    console.log(r.parcel.slice(0, 30).padEnd(32)
      + pct(r.workbook).padStart(9) + pct(r.appOnWorkbookDates).padStart(14)
      + pct(r.appNative).padStart(13)
      + (gap == null ? "     -" : (gap >= 0 ? "+" : "") + gap.toFixed(2)).padStart(10) + "   " + verdict
      + (r.pair.confirm ? "  [pairing unconfirmed]" : ""));
  }

  for (const r of results) {
    if (r.unpaired || r.error) continue;
    console.log("\n\n=== " + r.parcel);
    console.log("    " + r.pair.file + "  ->  " + r.pair.sheet + "!" + r.pair.cell);
    console.log("    " + r.x.formula.slice(0, 74));
    if (r.pair.confirm) console.log("    CONFIRM: " + r.pair.confirm);
    if (r.pair.note) console.log("    note: " + r.pair.note);
    console.log("    periods " + r.series.columns.length + "  " + iso(r.series.serials[0])
      + " -> " + iso(r.series.serials[r.series.serials.length - 1])
      + "   engine starts " + r.d.startYear + "-" + String(r.d.startMonth).padStart(2, "0")
      + ", " + (r.R.NM + 1) + " months");
    if (r.extended) console.log("    !! app runs " + r.extended + " period(s) past the workbook's last dated column - appended, not folded in");
    console.log("    total equity CF   workbook " + money(r.totalWb).padStart(14)
      + "   app " + money(r.totalApp).padStart(14)
      + "   diff " + money(r.totalApp - r.totalWb));
    if (!r.rows.length) { console.log("    every period agrees within tolerance"); continue; }
    console.log("    first divergence: period " + r.firstDiverge + " (" + r.rows[0].date + ")"
      + "   " + r.rows.length + " period(s) differ");
    console.log("     #  col  date            workbook            app           diff        cum diff");
    for (const w of r.rows.slice(0, 14)) {
      console.log("    " + String(w.i).padStart(2) + "  " + w.col.padEnd(4) + w.date + " "
        + money(w.wb).padStart(15) + money(w.app).padStart(15)
        + money(w.diff).padStart(15) + money(w.cum).padStart(16));
    }
    if (r.rows.length > 14) console.log("    ... " + (r.rows.length - 14) + " more");
  }

  console.log("\n\nWorkbooks with no app parcel: " + UNPAIRED_WORKBOOKS.join(", "));
}

/* Only run the report when invoked directly - compareParcel is imported by the
   per-project diagnostics, which must not trigger a full run on import. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
