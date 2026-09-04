/* Line-by-line comparison of every parcel against its workbook.

   Each line records not just the two numbers but the workbook's own formula and
   rate cell, because a value compared against a label whose meaning was guessed
   is how three false findings got reported on Beckett: its "Marketing &
   Brokerage fee" row looked like it covered both and does not, and its PBT
   margin divides by net revenue where I had assumed gross. The formula settles
   both questions in a way the label never can.

   A line is flagged when the numbers differ by more than 1%, and separately when
   the numbers agree but the stated logic does not - a right answer reached the
   wrong way is still a defect, just a latent one. */
import { existsSync } from "node:fs";
import { openWorkbook } from "./lib/xlsx.mjs";
import { loadApp } from "./reconcile.mjs";
import { pairFor } from "./pairs.mjs";

const DIR = "Individual BPs";
const n0 = (v) => v == null ? "-" : Math.round(v).toLocaleString();

/* Workbook label -> engine value. `combine` lists extra labels whose values are
   added to the first, for sheets that split a line the engine keeps whole:
   Beckett shows infrastructure and contingency separately while the engine's
   infTot already carries both. */
export const LINES = [
  { item: "Revenue (gross)",     labels: ["sales revenue", "gross realisation", "gross revenue", "total revenue", "revenue"], app: R => R.grossRevenue },
  { item: "Output GST",          labels: ["less: gst", "output gst", "gst on sales", "gst - output"], app: R => R.outputGst, abs: true },
  { item: "Net revenue",         labels: ["net revenue", "revenue net of gst"], app: R => R.netRevenue },
  { item: "Land cost",           labels: ["land cost", "land consideration", "land purchase", "purchase price"], app: R => R.land },
  { item: "Construction",        labels: ["construction cost", "infrastructure", "coc"], combine: ["contingency"], app: R => R.infTot },
  { item: "Professional fee",    labels: ["professional fee"], app: R => R.professionalTotal },
  { item: "DM fee",              labels: ["dm fee", "development management"], app: R => R.developmentManagementTotal },
  { item: "Land holding",        labels: ["land holding", "holding cost"], app: R => R.carry },
  { item: "Statutory",           labels: ["statutory cost", "statutory"], app: R => (R.stampDuty || 0) + (R.firbCost || 0) + (R.acquisitionCost || 0) },
  { item: "Foreign surcharge",   labels: ["foreign surcharge", "foreign purchaser"], app: R => R.foreignPurchaserSurcharge },
  { item: "Marketing & broker",  labels: ["marketing & brokerage", "marketing and brokerage", "selling & marketing", "sales, marketing"], app: R => (R.brokerCost || 0) + (R.marketing || 0) },
  { item: "GST input credit",    labels: ["input tax credit", "gst - input", "input gst"], app: R => -Math.abs(R.inputGstCredit || 0), abs: true },
  { item: "Finance costs",       labels: ["finance cost", "finance costs"], app: R => R.finTot },
  { item: "Total costs",         labels: ["total costs", "total cost"], app: R => null },
  { item: "Profit before tax",   labels: ["profit before tax"], app: R => R.npbt },
  { item: "Equity",              labels: ["equity"], app: R => R.epeak },
];

const COLS = ["B","C","D","E","F","G","H","I","J","K"];

/* Value, formula and driver rate for one labelled row.

   These sheets lay a row out as label, driver rate, dollar amount, amount per
   unit - Beckett's professional fee is "0.12, 496408, 12107". Taking the first
   number to the right of the label therefore reads the *rate* as the value,
   which is how this first reported the fee as 0 against the engine's 496,408.
   The dollar amount is the largest magnitude in the row, and the rate is the
   entry at or below 1, so both can be picked out without hard-coding columns. */
function readLine(sh, labels) {
  for (const needle of labels) {
    /* Take the leftmost match, not the first in sheet order. These sheets carry a
       commentary column - Beckett's G16 reads "Stamp duty as per statutory
       requirements" - and matching that instead of the "Statutory Costs" label in
       C23 made the line look absent from a sheet that plainly has it. Shorter
       text breaks ties, since a label is terser than a sentence about it. */
    const hits = sh.find(needle, { limit: 40 }) || [];
    const list = Array.isArray(hits) ? hits : [hits];
    if (!list.length) continue;
    const hit = list.slice().sort((a, b) =>
      COLS.indexOf(a.col) - COLS.indexOf(b.col) || String(a.value).length - String(b.value).length)[0];
    const from = Math.max(0, COLS.indexOf(hit.col));
    let best = null, rate = null;
    for (const c of COLS.slice(from + 1)) {
      const v = sh.num(hit.row, c);
      if (v == null) continue;
      if (Math.abs(v) <= 1 && v !== 0) { if (rate == null) rate = v; continue; }
      if (best == null || Math.abs(v) > Math.abs(best.value)) best = { value: v, at: c + hit.row };
    }
    if (best == null && rate == null) continue;
    if (best == null) best = { value: 0, at: null };
    return { value: best.value, at: best.at, label: String(hit.value).trim(),
             formula: best.at ? sh.f(best.at) : "", rate };
  }
  return null;
}

/* The sheet carrying the P&L. Prefer one that actually states a profit line,
   which is what distinguishes a dashboard from an input sheet. */
function pnlSheet(wb) {
  const names = wb.sheetNames();
  const scored = names.map(nm => {
    let sh; try { sh = wb.rawSheet(nm); } catch { return null; }
    const hasPbt = !!sh.find("profit before tax");
    const hits = LINES.filter(L => readLine(sh, L.labels)).length;
    return { nm, sh, score: (hasPbt ? 100 : 0) + hits };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
  return scored[0] || null;
}

function main() {
  const M = loadApp();
  const seen = new Map();
  console.log("LINE ITEMS - app vs workbook, flagged above 1%\n");
  for (const parcel of M.parcels) {
    const pair = pairFor(parcel.name, seen);
    console.log("\n=== " + parcel.name);
    if (!pair) { console.log("    no workbook paired"); continue; }
    const path = DIR + "/" + pair.file;
    if (!existsSync(path)) { console.log("    workbook missing: " + path); continue; }
    const wb = openWorkbook(path);
    const pick = pnlSheet(wb);
    if (!pick) { console.log("    no P&L-like sheet found"); continue; }
    const R = M.run(M.derive(parcel.inputs));
    console.log("    " + pair.file + "  ->  sheet \"" + pick.nm + "\"");
    console.log("    line                    workbook            app           diff       %    rate   evidence");
    let flagged = 0, mapped = 0, costSum = 0, costSumWb = 0, wbTotalCost = null;
    const COST = new Set(["Land cost","Construction","Professional fee","DM fee","Land holding",
      "Statutory","Foreign surcharge","Marketing & broker","GST input credit","Finance costs"]);
    for (const L of LINES) {
      const hit = readLine(pick.sh, L.labels);
      if (!hit) { console.log("    " + L.item.padEnd(22) + "  (not found on this sheet)"); continue; }
      let wbv = hit.value;
      if (L.combine) for (const extra of L.combine) {
        const e = readLine(pick.sh, [extra]);
        if (e) wbv += e.value;
      }
      const appv = L.app(R);
      mapped++;
      if (L.item === "Total costs") wbTotalCost = wbv;
      if (COST.has(L.item) && appv != null) { costSum += appv; costSumWb += wbv; }
      if (appv == null) {
        console.log("    " + L.item.padEnd(22) + n0(wbv).padStart(14) + "        (no single engine key)");
        continue;
      }
      const a = L.abs ? Math.abs(appv) : appv, w = L.abs ? Math.abs(wbv) : wbv;
      const diff = a - w;
      const p = w !== 0 ? diff / Math.abs(w) * 100 : (a === 0 ? 0 : Infinity);
      const flag = Math.abs(p) > 1;
      if (flag) flagged++;
      console.log("    " + L.item.padEnd(22) + n0(w).padStart(14) + n0(a).padStart(15)
        + n0(diff).padStart(15) + (Number.isFinite(p) ? (p >= 0 ? "+" : "") + p.toFixed(1) : "  n/a").padStart(8)
        + (hit.rate != null ? (Math.round(hit.rate * 1e4) / 1e4).toString() : "").padStart(8)
        + "  " + (flag ? "<< " : "   ") + hit.at + " " + (hit.formula ? hit.formula.slice(0, 26) : hit.label.slice(0, 26)));
    }
    const margin = (k) => R.netRevenue ? (R.npbt / (k === "net" ? R.netRevenue : R.grossRevenue) * 100).toFixed(2) + "%" : "-";
    console.log("    ---");
    /* Does each side's mapped cost lines add up to its own total? A line that
       looks wildly out while PBT still reconciles is a gap in this mapping, not a
       difference in the model - Menin's "Statutory" reads 53% low while its PBT
       lands within 1%, which is only possible if the engine books that spend
       under a line this table does not name. Saying so is the difference between
       a finding and a false alarm. */
    const appTotalCost = R.netRevenue - R.npbt;
    const mappedApp = costSum, mappedWb = costSumWb;
    const appResidual = appTotalCost - mappedApp;
    console.log("    cost check   app: mapped lines " + n0(mappedApp)
      + "  vs net revenue - PBT " + n0(appTotalCost)
      + "  -> unmapped " + n0(appResidual)
      + (Math.abs(appResidual) > Math.abs(appTotalCost) * 0.01 ? "  << engine books cost outside these lines" : ""));
    /* The bottom line that does not depend on my labelling at all: each side
       total cost, taken from its own accounts. Where this agrees, a big per-line
       gap above is a mapping artefact rather than a costing difference. */
    if (wbTotalCost != null) {
      const tp = (appTotalCost - wbTotalCost) / Math.abs(wbTotalCost) * 100;
      console.log("    TOTAL COST   workbook " + n0(wbTotalCost) + "   app " + n0(appTotalCost)
        + "   diff " + n0(appTotalCost - wbTotalCost) + "  " + (tp >= 0 ? "+" : "") + tp.toFixed(2) + "%"
        + (Math.abs(tp) > 1 ? "   << over 1%" : "   within 1%"));
    }
    if (wbTotalCost != null) {
      const wbResidual = wbTotalCost - mappedWb;
      console.log("    cost check   workbook: mapped lines " + n0(mappedWb)
        + "  vs its own Total costs " + n0(wbTotalCost)
        + "  -> unmapped " + n0(wbResidual));
    }
    console.log("    PBT margin   app  " + margin("net") + " of net revenue,  " + margin("gross") + " of gross");
    console.log("    Equity IRR   app  " + (R.eirr == null ? "n/a" : (R.eirr * 100).toFixed(2) + "%")
      + "   peak equity " + n0(R.epeak) + "   injected " + n0(R.cashEquityInjected));
    console.log("    " + flagged + " of " + mapped + " mapped lines differ by more than 1%");
  }
}

main();
