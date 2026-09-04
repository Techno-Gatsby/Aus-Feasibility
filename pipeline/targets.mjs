/* The reference block every workbook carries on its monthly cashflow sheet.

   One sheet per project, four figures: PBT, equity IRR, PBT margin and total finance
   cost. Rows are found by LABEL because the same template drifts by a few rows in
   every file - Beckett puts PBT on 57, Oxlade on 70, Hendra on 55.

   Two rulings are baked in, both from the majority of the sheets themselves:
   - every PBT row on every sheet sums from column D, the first dated column, so the
     IRR is measured over that same range. Two files start their XIRR later and drop
     real cash doing it (Hendra a 5,000,000 land deposit, Drummoyne Base 3,200,000);
     `irrCorrected` is the figure that includes it.
   - PBT margin is PBT over NET revenue on all seven sheets that state one. */
import { openWorkbook } from "./lib/xlsx.mjs";
import { xirr, iso, serialToDate, colToNum, numToCol, findXirrCells } from "./eqirr.mjs";

const DIR = "Individual BPs";

export const TARGETS = [
  { parcel: "400 Glenmore Road Paddington - 4:1 FSR", file: "Peddington Feasibility - 2 scenario.xlsx", sheet: "Monthly CF FSR 4", dateRow: 2, salesRow: 4, irr: ["Monthly CF FSR 4", "C62"] },
  { parcel: "400 Glenmore Road Paddington - 2.86:1 FSR", file: "Peddington Feasibility - 2 scenario.xlsx", sheet: "Monthly CF FSR 2.86", dateRow: 2, salesRow: 4, irr: ["Monthly CF FSR 2.86", "C62"] },
  /* Drummoyne's own monthly sheet declares the Max scheme as its IRR - CF - Monthly!C74
     is literally ='SC -3 Quarterly CF - Max'!C74 - and the app's revenue matches Max to
     0.00% against Base's 62%. The Base pairing was comparing two different schemes. */
  { parcel: "Drummoyne, Sydney", file: "Drummoyne - Feasibility.xlsx", sheet: "CF - Monthly", dateRow: 2, salesRow: 4, irr: ["SC -3 Quarterly CF - Max", "C74"] },
  /* Oxlade's sales row is 6, "Sales Phasing"; row 8 is Tower 2 and is all zero. */
  { parcel: "70-72 Oxlade Drive, Brisbane", file: "12. Oxlade Dr Feasibility - july26.xlsx", sheet: "Monthly CF", dateRow: 5, salesRow: 6, irr: ["Monthly CF", "C74"] },
  { parcel: "SP Boulevard, Gold Coast", file: "SP Boulevard CF-20.05.2026.xlsx", sheet: "Monthly CF - Sum", dateRow: 2, salesRow: 4, irr: ["Monthly CF - Sum", "C72"] },
  { parcel: "421 Brunswick Street, Brisbane", file: "Brunswick CF.xlsx", sheet: "Brunswick_50 floors option (2)", dateRow: 3, salesRow: 5, irr: ["Brunswick_50 floors option (2)", "K84"] },
  { parcel: "16 Terry Road, Box Hill", file: "Feasibility-16 Terry Road- 2 phase scheme.xlsx", sheet: "Monthyl CF", dateRow: 2, salesRow: 4, irr: ["Monthyl CF", "C65"] },
  { parcel: "Menin Road, NSW", file: "11. Menin Road working file.xlsx", sheet: "Monthly CF", dateRow: 2, salesRow: 4, irr: ["Monthly CF", "C61"] },
  { parcel: "Beckett Road, Queensland", file: "10. Beckett Road submitted DA.xlsx", sheet: "Monthly CF", dateRow: 2, salesRow: 4, irr: ["Monthly CF", "C61"] },
  { parcel: "Hendra, Brisbane - Lots", file: "Project -8 (Self equity - Hendra).xlsx", sheet: "Monthly CF - lots", dateRow: 2, salesRow: 4, irr: ["Monthly CF - lots", "C59"] },
];

const LABELS = {
  pbt: ["total margin (pbt)", "total margin"],
  margin: ["pbt margin"],
  irr: ["irr (pre-tax)", "project irr (pre-tax)", "irr"],
  netRev: ["net revenue"],
  interest: ["interest expense"],
  lineFee: ["line fee"],
  estFee: ["establishment fee"],
  finTotal: ["total finance cost"],
  equity: ["equity contribution", "equity needed", "equity required"],
};

function rowFor(sh, needles) {
  for (const needle of needles) {
    for (let r = 1; r <= sh.maxRow; r++) {
      for (const col of ["A", "B", "C"]) {
        const v = String(sh.get(r, col) || "").trim().toLowerCase();
        if (v && v.startsWith(needle)) return r;
      }
    }
  }
  return null;
}

export function readTarget(t) {
  const wb = openWorkbook(DIR + "/" + t.file);
  const sh = wb.rawSheet(t.sheet);
  const rows = {};
  for (const [k, needles] of Object.entries(LABELS)) rows[k] = rowFor(sh, needles);

  /* Every dated column, so the corrected IRR can run over the same span the PBT row
     is summed over. */
  const cols = [], serials = [];
  for (let c = 1; c <= colToNum("EZ"); c++) {
    const col = numToCol(c), dt = sh.num(t.dateRow, col);
    if (dt != null) { cols.push(col); serials.push(dt); }
  }

  const out = {
    parcel: t.parcel, file: t.file, sheet: t.sheet, rows, cols, serials,
    pbt: rows.pbt ? sh.num(rows.pbt, "C") : null,
    margin: rows.margin ? sh.num(rows.margin, "C") : null,
    netRev: rows.netRev ? sh.num(rows.netRev, "C") : null,
    finance: null, irrAsWritten: null, irrCorrected: null, irrCell: null,
  };

  /* "Equity Contribution" is not one measure. Seven of the eight sheets that state it use
     -SUM over a window that stops before distributions, which is CUMULATIVE INJECTED equity;
     only Oxlade uses -MIN of the cumulative row, which is PEAK OUTSTANDING. They are
     different quantities and the app reports both, so the formula decides which to compare. */
  if (rows.equity) {
    out.equity = sh.num(rows.equity, "C");
    const f = String(sh.f(rows.equity, "C") || "");
    out.equityBasis = /MIN\s*\(/i.test(f) ? "peak" : (/SUM\s*\(/i.test(f) ? "injected" : "unknown");
    out.equityFormula = f;
  }

  const fin = ["interest", "lineFee", "estFee"].map(k => rows[k] ? (sh.num(rows[k], "C") || 0) : 0);
  out.finance = rows.finTotal ? sh.num(rows.finTotal, "C") : fin.reduce((a, b) => a + b, 0);

  /* The XIRR cell tells us which row is the equity cashflow and over what range the
     sheet chose to measure it. We keep both: the sheet's own answer, and the same row
     measured from the first dated column. */
  const x = findXirrCells(wb).find(c => c.parsed && c.sheetName === t.irr[0] && c.ref === t.irr[1]);
  if (x) {
    out.irrCell = x.sheetName + "!" + x.ref;
    out.irrAsWritten = x.cached;
    const cfSh = wb.rawSheet(x.cfSheet), dtSh = wb.rawSheet(x.dateSheet);
    let first = null;
    for (let c = 1; c <= colToNum("EZ"); c++) { const col = numToCol(c); if (dtSh.num(x.dateRow, col) != null) { first = col; break; } }
    const cf = [], dt = [];
    for (let c = colToNum(first); c <= colToNum(x.colTo); c++) {
      const col = numToCol(c), d = dtSh.num(x.dateRow, col);
      if (d == null) continue;
      dt.push(d); cf.push(cfSh.num(x.cfRow, col) || 0);
    }
    out.irrCorrected = xirr(cf, dt);
    out.irrExcluded = cf.slice(0, colToNum(x.colFrom) - colToNum(first)).reduce((a, b) => a + b, 0);
  }

  /* Yearly sales split, for the salesmode-1 grid. Shares of gross sales stand in for
     shares of units: on these single-product parcels the two are the same to within
     price escalation, and the alternative is no phasing at all. */
  const byYear = {};
  let total = 0;
  for (let i = 0; i < cols.length; i++) {
    const v = sh.num(t.salesRow, cols[i]) || 0;
    if (!v) continue;
    const y = serialToDate(serials[i]).getUTCFullYear();
    byYear[y] = (byYear[y] || 0) + v;
    total += v;
  }
  /* Drop leading and trailing empty years: a zero at the end of the grid is an artefact
     of the sheet running its date row past the last sale, not a year with no sales. */
  const years = Object.keys(byYear).map(Number).sort((a, b) => a - b).filter(y => Math.abs(byYear[y]) > 1);
  out.salesByYear = years.map(y => ({ year: y, value: byYear[y], share: total ? byYear[y] / total : 0 }));
  out.salesTotal = total;
  out.salesFrom = cols.length ? iso(serials[0]) : null;
  return out;
}

export function unitsPerYear(target, totalUnits) {
  const rows = target.salesByYear;
  if (!rows.length || !(totalUnits > 0)) return [];
  const raw = rows.map(r => r.share * totalUnits);
  const out = raw.map(v => Math.round(v));
  /* Rounding must not change the unit count, so the largest year absorbs the drift. */
  let drift = totalUnits - out.reduce((a, b) => a + b, 0);
  if (drift) {
    let i = 0;
    for (let k = 1; k < out.length; k++) if (out[k] > out[i]) i = k;
    out[i] += drift;
  }
  return out;
}
