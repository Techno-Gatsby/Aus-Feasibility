/* Locates each workbook's equity IRR the way the workbook itself defines it.

   Every one of these files computes its return with XIRR over an explicit date
   row, so the formula is a complete specification of the comparison: which row
   holds the equity cashflow, which row holds the dates, and which columns are in
   scope. Reading it beats hand-mapping cell addresses, which is what produced
   three false "findings" on Beckett before this existed - and it cannot drift,
   because if someone inserts a row the formula moves with it.

   Recomputing XIRR and checking it against the sheet's own cached value is the
   gate: until those agree, nothing read off that sheet is trustworthy. */
import { readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { openWorkbook } from "./lib/xlsx.mjs";

export const colToNum = (s) => { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };
export const numToCol = (n) => { let s = ""; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; } return s; };
export const serialToDate = (d) => new Date(Date.UTC(1899, 11, 30) + d * 864e5);
export const iso = (d) => serialToDate(d).toISOString().slice(0, 10);

/* Excel's XIRR: actual/365 from the first date, solved by bisection rather than
   Newton so a wild guess cannot walk it onto a different root. The workbooks seed
   theirs with 40 and 10 - meaning 4000% and 1000% - so matching Excel's solver
   would mean inheriting its convergence accidents. */
export function xirr(cashflows, serials) {
  if (!cashflows.some(v => v < 0) || !cashflows.some(v => v > 0)) return null;
  const t0 = serials[0];
  const npv = (r) => cashflows.reduce((a, c, i) => a + c / Math.pow(1 + r, (serials[i] - t0) / 365), 0);
  let lo = -0.9999, hi = 10;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid; else { lo = mid; }
  }
  return (lo + hi) / 2;
}

const RANGE = /XIRR\(\s*(?:'([^']+)'!)?\$?([A-Z]{1,3})\$?(\d+)\s*:\s*\$?([A-Z]{1,3})\$?(\d+)\s*,\s*(?:'([^']+)'!)?\$?([A-Z]{1,3})\$?(\d+)/i;

/* Every XIRR in the workbook, with its range decoded. */
export function findXirrCells(wb) {
  const out = [];
  for (const sheetName of wb.sheetNames()) {
    let sh;
    try { sh = wb.rawSheet(sheetName); } catch { continue; }
    for (const [ref, formula] of sh.formulas) {
      if (!/XIRR/i.test(formula)) continue;
      const m = formula.match(RANGE);
      if (!m) { out.push({ sheetName, ref, formula, parsed: false }); continue; }
      out.push({
        sheetName, ref, formula, parsed: true,
        cfSheet: m[1] || sheetName, cfRow: +m[3], colFrom: m[2], colTo: m[4],
        dateSheet: m[6] || sheetName, dateRow: +m[8],
        cached: sh.num(ref),
      });
    }
  }
  return out;
}

/* Pull the series the formula points at, and prove it reproduces the cached
   value. A mismatch means the range was misread - not that the sheet is wrong. */
export function seriesFor(wb, x) {
  const cfSheet = wb.rawSheet(x.cfSheet), dateSheet = wb.rawSheet(x.dateSheet);
  const from = colToNum(x.colFrom), to = colToNum(x.colTo);
  const cashflows = [], serials = [], columns = [];
  for (let c = from; c <= to; c++) {
    const col = numToCol(c);
    const date = dateSheet.num(x.dateRow, col);
    if (date == null) continue;
    columns.push(col);
    serials.push(date);
    cashflows.push(cfSheet.num(x.cfRow, col) || 0);
  }
  const recomputed = xirr(cashflows, serials);
  return {
    cashflows, serials, columns, recomputed, cached: x.cached,
    reproduces: recomputed != null && x.cached != null && Math.abs(recomputed - x.cached) < 5e-4,
  };
}

/* Monthly CF is the agreed reference, so prefer a sheet whose name says so - but
   only among cells that actually hold a result. Several workbooks carry XIRR
   cells cached at 0.00% (SP Boulevard's EB3 recomputes to 19.22% while the
   sibling C72 on the same sheet holds a live 27.71%), and Brunswick's ladder of
   IFERROR ranges leaves most of its cells empty by design. Picking on sheet name
   alone lands on those and silently compares against a dead cell. */
const nameRank = (s) => /monthly\s*cf/i.test(s) ? 0
  : /monthly/i.test(s) ? 1
  : /quarterly\s*cf/i.test(s) ? 2
  : /cash\s*flow|cashflow|\bcf\b/i.test(s) ? 3 : 4;

export function preferredXirr(cells, seriesOf) {
  const scored = cells.filter(c => c.parsed).map(c => {
    let s = null;
    try { s = seriesOf(c); } catch { /* unreadable range - ranks last */ }
    const live = s && s.reproduces && c.cached != null && Math.abs(c.cached) > 1e-9;
    /* A cell that recomputes to a real rate is still usable when its cached value
       is a stale zero, but it ranks below one the sheet itself agrees with. */
    const usable = s && s.recomputed != null;
    return { c, s, tier: live ? 0 : usable ? 1 : 2, rank: nameRank(c.sheetName), periods: s ? s.columns.length : 0 };
  });
  scored.sort((a, b) => a.tier - b.tier || a.rank - b.rank || b.periods - a.periods);
  return scored.length ? scored[0] : null;
}

export function scanWorkbooks(dir = "Individual BPs") {
  const out = [];
  for (const file of readdirSync(dir)) {
    if (!/\.xlsx$/i.test(file) || /^~\$/.test(file)) continue;
    const path = dir + "/" + file;
    let wb;
    try { wb = openWorkbook(path); } catch (e) { out.push({ file, path, error: e.message }); continue; }
    const cells = findXirrCells(wb);
    const best = preferredXirr(cells, (c) => seriesFor(wb, c));
    out.push({ file, path, wb, cells, pick: best && best.c, series: best && best.s, tier: best && best.tier });
  }
  return out;
}

/* argv[1] is undefined under `node -e`, where this module is only ever imported. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const r of scanWorkbooks(process.argv[2] || "Individual BPs")) {
    console.log("\n== " + r.file);
    if (r.error) { console.log("   !! " + r.error); continue; }
    if (!r.pick) { console.log("   no XIRR found (" + r.cells.length + " cells scanned)"); continue; }
    const p = r.pick, s = r.series;
    console.log("   sheet   " + p.sheetName + "  cell " + p.ref);
    console.log("   formula " + p.formula.slice(0, 72));
    console.log("   cf row " + p.cfRow + ", dates row " + p.dateRow + ", cols " + p.colFrom + ".." + p.colTo);
    if (s.error) { console.log("   !! " + s.error); continue; }
    const pct = (v) => v == null ? "n/a" : (v * 100).toFixed(2) + "%";
    console.log("   cached " + pct(s.cached) + "   recomputed " + pct(s.recomputed)
      + "   " + (s.reproduces ? "REPRODUCES" : "*** MISMATCH ***"));
    console.log("   " + s.columns.length + " periods, " + iso(s.serials[0]) + " -> " + iso(s.serials[s.serials.length - 1]));
    if (r.cells.filter(c => c.parsed).length > 1) {
      console.log("   other XIRR cells: " + r.cells.filter(c => c.parsed && c !== p)
        .map(c => c.sheetName + "!" + c.ref + "=" + pct(c.cached)).join(", ").slice(0, 150));
    }
  }
}
