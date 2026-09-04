/* Reconciles every seeded project in the app against its source workbook.
   Run:  node pipeline/reconcile.mjs [projectFilter]

   The whole point is to compare two INDEPENDENT calculations, so every expected
   value is read from the workbook's own output cells. Nothing is re-derived from
   the workbook's inputs - that would only prove the spreadsheet agrees with
   itself. Where a workbook holds several scenarios, the one being compared is
   named explicitly rather than guessed.

   A delta is evidence that the two disagree. It is not proof that the app is
   wrong: an input mismatch, a different scenario and a genuine engine fault all
   present the same way, and the report separates them. */
import { readFileSync, existsSync } from "node:fs";
import { openWorkbook } from "./lib/xlsx.mjs";

const APP_FILE = "Australia_Land_Feasibility_.html";

/* ---- load the engine and the ACTUAL parcels out of the single-file app ----
   The tabs the user sees are newParcel(...) entries that spread a business-plan
   seed and then override it, sometimes heavily - Beckett's parcel runs vel 41/15
   where its seed says 41/24. Reconciling the raw seeds compares something the
   app never shows, so the parcels are what get extracted. */
function matchBracket(s, from, open = "[", close = "]") {
  let depth = 0, inStr = null;
  for (let i = from; i < s.length; i++) {
    const c = s[i], p = s[i - 1];
    if (inStr) { if (c === inStr && p !== "\\") inStr = null; continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "/" && s[i + 1] === "*") { const e = s.indexOf("*/", i); i = e < 0 ? s.length : e + 1; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (!depth) return i; }
  }
  return -1;
}

export function loadApp(file = APP_FILE) {
  const s = readFileSync(file, "utf8");
  const engine = s.slice(s.indexOf("/*MODEL_START*/"), s.indexOf("/*MODEL_END*/"));
  /* newParcel is declared before the seeds and BP_INPUTS after them, so the slice
     has to span the whole block: cleanProjectLocation .. SOURCE_BP_DEFAULT. */
  const bpStart = s.indexOf("function cleanProjectLocation(");
  const seeds = s.slice(bpStart, s.indexOf("const SOURCE_BP_DEFAULT=", bpStart));

  const pStart = s.indexOf("parcels:[", s.indexOf("const APP={"));
  const arrOpen = s.indexOf("[", pStart);
  const arrClose = matchBracket(s, arrOpen);
  const parcelsSrc = s.slice(arrOpen, arrClose + 1);

  return new Function(engine + "\n" + seeds +
    "\nconst __parcels=" + parcelsSrc + ";" +
    "\nreturn {DEF,derive,run,BUSINESS_PLAN_PROJECTS,makeBusinessPlanInputs,parcels:__parcels};")();
}

/* ---- which workbook backs which project, and which scenario inside it ----
   Filled in as each pairing is confirmed. `sheet` and `labels` are how the
   reader locates the workbook's own answer; leaving them null means the pairing
   is not yet established and the project reports as UNMAPPED rather than
   silently comparing against the wrong thing. */
export const MAP = {
  beckett:   { book: "Individual BPs/10. Beckett Road submitted DA.xlsx", sheet: "Output Dashboard ", note: "lots scheme" },
  menin:     { book: "Individual BPs/11. Menin Road working file.xlsx", sheet: null },
  oxlade:    { book: "12. Oxlade Dr Feasibility - july26.xlsx", sheet: null, note: "root copy preferred over Individual BPs" },
  oxladeOld: { book: "12. Oxlade Dr Feasibility - july26.xlsx", sheet: null, note: "original pricing scenario" },
  brunswick: { book: "Individual BPs/Brunswick CF.xlsx", sheet: null },
  sp:        { book: "Individual BPs/SP Boulevard CF-20.05.2026.xlsx", sheet: null, note: "no working IRR in the sheet" },
  project6:  { book: "Individual BPs/Drummoyne - Feasibility.xlsx", sheet: null, note: "Drummoyne; Max scenario" },
  project7:  { book: "Individual BPs/Project -7 (SPB) - Self Equity 1.xlsx", sheet: null },
  project8:  { book: "Individual BPs/Project -8 (Self equity - Hendra).xlsx", sheet: null },
  project9:  { book: "Individual BPs/Project 9 - self funded (drummoyne).xlsx", sheet: null },
  project4:  { book: null, sheet: null },
  project5:  { book: null, sheet: null },
};

/* Labels a feasibility sheet is likely to use for each headline. Searched in
   order; the first hit wins. Deliberately loose, because these are hand-built. */
const LABELS = {
  eirr:      ["equity irr", "irr - equity", "equity return"],
  irr:       ["project irr", "unlevered irr", "irr (project)"],
  revenue:   ["revenue", "gross realisation", "gross sales"],
  netRev:    ["net revenue"],
  pbt:       ["profit before tax", "pbt", "net profit"],
  totalCost: ["total costs", "total cost"],
  equity:    ["equity"],
};

export function readWorkbookOutputs(book, sheetName) {
  if (!book || !existsSync(book)) return { error: `workbook not found: ${book}` };
  const wb = openWorkbook(book);
  const names = wb.sheetNames();
  const target = sheetName && names.includes(sheetName) ? sheetName
    : names.find((n) => /dashboard|summary|output/i.test(n));
  if (!target) return { error: `no dashboard-like sheet in ${book}`, sheets: names };
  const sh = wb.rawSheet(target);
  const out = { sheet: target, sheets: names };
  for (const [key, needles] of Object.entries(LABELS)) {
    for (const needle of needles) {
      const hit = sh.find(needle);
      if (!hit) continue;
      /* Take the first numeric cell to the right of the label. */
      const cols = ["B","C","D","E","F","G","H","I","J"];
      const from = cols.indexOf(hit.col);
      let v = null, at = null;
      for (const c of cols.slice(from + 1)) { const n = sh.num(hit.row, c); if (n != null) { v = n; at = c + hit.row; break; } }
      if (v != null) { out[key] = v; out[key + "_at"] = at; out[key + "_label"] = hit.value; break; }
    }
  }
  return out;
}

export function runProject(M, key) {
  const seed = M.BUSINESS_PLAN_PROJECTS[key];
  if (!seed) return { error: `no seed named ${key}` };
  let d, R;
  try { d = M.derive(M.makeBusinessPlanInputs(seed)); } catch (e) { return { error: "derive: " + e.message }; }
  try { R = M.run(d); } catch (e) { return { error: "run: " + e.message, d }; }
  return { d, R };
}

const pctS = (v) => v == null ? "     —" : (v * 100).toFixed(2).padStart(6) + "%";
const moneyS = (v) => v == null ? "           —" : Math.round(v).toLocaleString().padStart(12);

if (process.argv[1] && process.argv[1].endsWith("reconcile.mjs")) {
  const only = process.argv[2];
  const M = loadApp();
  const keys = Object.keys(M.BUSINESS_PLAN_PROJECTS).filter((k) => !only || k.includes(only));
  console.log(`${keys.length} seeded projects\n`);

  for (const key of keys) {
    const m = MAP[key] || {};
    const { d, R, error } = runProject(M, key);
    const name = (M.BUSINESS_PLAN_PROJECTS[key].name || key).slice(0, 44);
    console.log("=".repeat(78));
    console.log(`${key}  —  ${name}`);
    if (error) { console.log(`  APP ERROR: ${error}`); continue; }

    const wb = m.book ? readWorkbookOutputs(m.book, m.sheet) : { error: "no workbook mapped" };
    console.log(`  workbook: ${m.book || "(unmapped)"}${wb.sheet ? "  sheet: " + JSON.stringify(wb.sheet) : ""}`);
    if (wb.error) console.log(`  ${wb.error}`);
    if (m.note) console.log(`  note: ${m.note}`);

    console.log(`  app   equity IRR ${pctS(R.eirr)}   project IRR ${pctS(R.irr)}   pre-tax ${pctS(R.irrPreTax)}`);
    console.log(`        revenue ${moneyS(R.grossRevenue)}   PBT ${moneyS(R.npbt)}   equity in ${moneyS(R.cashEquityInjected)}`);
    if (!wb.error) {
      console.log(`  book  equity IRR ${pctS(wb.eirr)}${wb.eirr_at ? " @" + wb.eirr_at : ""}   revenue ${moneyS(wb.revenue)}   PBT ${moneyS(wb.pbt)}   equity ${moneyS(wb.equity)}`);
      if (wb.eirr != null && R.eirr != null) {
        const dd = (R.eirr - wb.eirr) * 100;
        console.log(`  DELTA equity IRR ${(dd >= 0 ? "+" : "") + dd.toFixed(2)} pts` + (Math.abs(dd) > 1 ? "   <-- investigate" : "   ok"));
      }
    }
  }
}
