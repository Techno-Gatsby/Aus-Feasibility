/* One line per project: IRR, PBT and PBT margin against its own Monthly CF sheet.

   This is the scoreboard the whole reconciliation is judged on. It also prints the
   identity that organises the work - PBT difference plus finance difference is zero
   on every project, so PBT reads wrong only because finance does. */
import { loadApp } from "./reconcile.mjs";
import { TARGETS, readTarget, unitsPerYear } from "./targets.mjs";

const pc = (v) => v == null ? "     -" : (v * 100).toFixed(2) + "%";
const d0 = (v) => v == null ? "-" : Math.round(v).toLocaleString();
const rel = (a, b) => (a == null || b == null || !b) ? null : (a - b) / Math.abs(b) * 100;
const flag = (v, tol = 1) => v == null ? "  -  " : (Math.abs(v) <= tol ? " ok  " : " **  ");

export function status() {
  const M = loadApp();
  const rows = [];
  for (const t of TARGETS) {
    const p = M.parcels.find(x => x.name === t.parcel);
    if (!p) { rows.push({ parcel: t.parcel, missing: true }); continue; }
    let T;
    try { T = readTarget(t); } catch (e) { rows.push({ parcel: t.parcel, error: e.message }); continue; }
    const R = M.run(M.derive(p.inputs));
    const appMargin = R.netRevenue ? R.npbt / R.netRevenue : null;
    rows.push({
      parcel: t.parcel, T, R,
      irrApp: R.eirr, irrRef: T.irrCorrected ?? T.irrAsWritten,
      irrAsWritten: T.irrAsWritten, irrTruncated: Math.abs(T.irrExcluded || 0) > 1,
      pbtApp: R.npbt, pbtRef: T.pbt,
      marApp: appMargin, marRef: T.margin,
      finApp: R.finTot, finRef: T.finance,
      /* Cumulative equity injected is the measure, everywhere. Seven of the eight sheets
         that state an equity figure use a window -SUM, which is exactly that. Oxlade alone
         uses -MIN of the cumulative row, i.e. peak outstanding; its basis is flagged in the
         table so the one mismatched reference is visible rather than silently compared. */
      eqRef: T.equity, eqBasis: T.equityBasis, eqApp: R.cashEquityInjected,
      units: [1,2,3,4,5,6,7,8].reduce((a,i)=>a+Math.max(0,+M.derive(p.inputs)["n"+i]||0),0),
    });
  }
  return rows;
}

function main() {
  const rows = status();
  console.log("IRR / PBT / MARGIN vs each project's own Monthly CF sheet     (** = outside 1%)\n");
  console.log("project                        ---- equity IRR ----      ------- PBT -------     --- PBT margin ---    -- finance --");
  console.log("                                 ref     app    gap        ref       app   diff      ref    app  diff      diff");
  let okIrr = 0, okPbt = 0, okMar = 0, n = 0;
  for (const r of rows) {
    if (r.missing) { console.log("  " + r.parcel.slice(0, 28).padEnd(30) + "(no parcel)"); continue; }
    if (r.error) { console.log("  " + r.parcel.slice(0, 28).padEnd(30) + "!! " + r.error.slice(0, 50)); continue; }
    n++;
    const gi = r.irrRef == null ? null : (r.irrApp - r.irrRef) * 100;
    const gp = rel(r.pbtApp, r.pbtRef);
    const gm = (r.marApp == null || r.marRef == null) ? null : (r.marApp - r.marRef) * 100;
    const gf = rel(r.finApp, r.finRef);
    if (gi != null && Math.abs(gi) <= 1) okIrr++;
    if (gp != null && Math.abs(gp) <= 1) okPbt++;
    if (gm != null && Math.abs(gm) <= 1) okMar++;
    console.log("  " + r.parcel.slice(0, 28).padEnd(30)
      + pc(r.irrRef).padStart(8) + pc(r.irrApp).padStart(8)
      + (gi == null ? "     -" : (gi >= 0 ? "+" : "") + gi.toFixed(2)).padStart(8) + flag(gi)
      + d0(r.pbtRef).padStart(12) + d0(r.pbtApp).padStart(12)
      + (gp == null ? "    -" : (gp >= 0 ? "+" : "") + gp.toFixed(1)).padStart(7) + flag(gp)
      + pc(r.marRef).padStart(8) + pc(r.marApp).padStart(7)
      + (gm == null ? "   -" : (gm >= 0 ? "+" : "") + gm.toFixed(1)).padStart(6) + flag(gm)
      + (gf == null ? "     -" : (gf >= 0 ? "+" : "") + gf.toFixed(1) + "%").padStart(9)
      + (r.irrTruncated ? "  [ref corrected]" : ""));
  }
  console.log("\n  within 1%:   IRR " + okIrr + "/" + n + "    PBT " + okPbt + "/" + n + "    margin " + okMar + "/" + n);

  /* Equity required, on the basis each sheet's own formula states. Seven of eight use a
     window -SUM, which is cumulative injected equity, not the peak outstanding the engine
     reports as epeak - so both app measures are shown and the formula picks the comparison. */
  /* Two measures, because equity is the plug. Judged against itself, a 2% debt error on a
     project where equity is a sixth of the funding reads as a 12% equity miss - the bar is
     effectively six times tighter than everything else on this scoreboard. The second column
     scores the same difference against TOTAL funding, which is the like-for-like test. */
  console.log("\n\nEQUITY REQUIRED - cumulative injected");
  console.log("  project                            workbook          app    vs equity   vs funding");
  let okEq = 0, okFund = 0, nEq = 0;
  for (const r of rows) {
    if (r.missing || r.error) continue;
    if (r.eqRef == null) { console.log("    " + r.parcel.slice(0, 30).padEnd(32) + "(no equity row on this sheet)"); continue; }
    nEq++;
    const g = rel(r.eqApp, r.eqRef);
    const funding = Math.abs(r.eqRef) + Math.abs(r.R.peakdebt);
    const gf = funding ? (r.eqApp - r.eqRef) / funding * 100 : null;
    if (g != null && Math.abs(g) <= 1) okEq++;
    if (gf != null && Math.abs(gf) <= 1) okFund++;
    console.log("    " + r.parcel.slice(0, 30).padEnd(32)
      + d0(r.eqRef).padStart(13) + d0(r.eqApp).padStart(13)
      + (g == null ? "    -" : (g >= 0 ? "+" : "") + g.toFixed(1)).padStart(9) + flag(g)
      + (gf == null ? "    -" : (gf >= 0 ? "+" : "") + gf.toFixed(1)).padStart(8) + flag(gf)
      + (r.eqBasis === "peak" ? "  [sheet states a peak]" : ""));
  }
  console.log("\n    within 1% of its own equity: " + okEq + "/" + nEq
    + "     within 1% of total funding: " + okFund + "/" + nEq);

  console.log("\n\nPBT identity - does the PBT gap equal the finance gap?");
  console.log("  project                      PBT diff   finance diff        sum   PBT ex-finance");
  for (const r of rows) {
    if (r.missing || r.error || r.pbtRef == null) continue;
    const dp = r.pbtApp - r.pbtRef, df = r.finApp - (r.finRef || 0);
    const ex = rel(r.pbtApp + r.finApp, r.pbtRef + (r.finRef || 0));
    console.log("    " + r.parcel.slice(0, 26).padEnd(28) + d0(dp).padStart(12) + d0(df).padStart(15)
      + d0(dp + df).padStart(12) + (ex == null ? "-" : (ex >= 0 ? "+" : "") + ex.toFixed(2) + "%").padStart(12));
  }

  console.log("\n\nYearly sales grid to apply (salesmode 1):");
  for (const r of rows) {
    if (r.missing || r.error) continue;
    const u = unitsPerYear(r.T, r.units);
    console.log("    " + r.parcel.slice(0, 26).padEnd(28) + String(r.units).padStart(5) + " units   "
      + (u.length ? u.join(" / ") : "(no sales row found)"));
  }
}

if (process.argv[1] && process.argv[1].endsWith("status.mjs")) main();
