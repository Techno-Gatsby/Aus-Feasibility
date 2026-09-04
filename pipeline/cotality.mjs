/* Rebuilds SALES_DATA from the Cotality monthly workbooks.
   Replaces the lost scratchpad/xl/build.cjs. Run:  node pipeline/cotality.mjs

   Each delivery folder holds two workbooks. Data lags the delivery by three
   months, so the date in the FILENAME is authoritative and the folder name is
   only a label. Columns are resolved by header text, never by letter: the same
   field sits at AX in the ASGS workbook and AU in the National one. */
import { readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openWorkbook } from "./lib/xlsx.mjs";

const ROOT = "Cotality monthly data";
const OUT = "pipeline/out";

/* Rounding reverse-engineered from the shipped blob and verified against
   ACT|Aranda and NSW|Paddington - Moore Park: money is whole thousands, land is
   one decimal, ratios are four. Cotality writes nothing where it has no reading;
   the blob wrote 0, and salesRecord() treats 0 as absent for the fields listed in
   SNAP_ZERO_IS_MISSING. Keeping that convention so the diff is exact. */
const r0 = (v) => Math.round(v);
const rN = (v, n) => { const f = 10 ** n; return Math.round(v * f) / f; };

const SNAP = [
  ["med3",       "Median sales price last 3 months",                  (v) => r0(v / 1000)],
  ["med12",      "Median sales price last 12 months",                 (v) => r0(v / 1000)],
  ["p25",        "25th Percentile sales price last 12 months",        (v) => r0(v / 1000)],
  ["p75",        "75th Percentile sales price last 12 months",        (v) => r0(v / 1000)],
  ["sales12",    "# of sales last 12 months",                         r0],
  ["avgLand",    "Average land size",                                 (v) => rN(v, 1)],
  ["dom",        "Median time on market last 12 months",              r0],
  ["vendorDisc", "Median vendor discount last 12 months",             (v) => rN(v, 4)],
  ["chg12",      "12 month change in median sales price (12 months)", (v) => rN(v, 4)],
  ["yield",      "Indicative gross rental yield (12 months)",         (v) => rN(v, 4)],
  ["rent",       "Median asking rent last 12 months",                 r0],
  ["turnover",   "Sales turnover last 12 months",                     (v) => rN(v, 4)],
  ["stock",      "Total number of properties",                        r0],
  /* Appended after "stock" so every index above keeps its meaning and an older
     app reading only the first 13 fields still parses this snapshot correctly. */
  ["value12",    "Total sales value last 12 months",                  (v) => r0(v / 1000)],
  ["medNew",     "Median new property sales price last 12 months",    (v) => r0(v / 1000)],
  ["salesNew",   "# of new property sales last 12 months",            r0],
];
const FIELDS = SNAP.map((s) => s[0]);
const COUNT_COL = "# of sales last 1 month";
const VALUE_COL = "Total sales value last 1 month";

const num = (s) => { if (s === "" || s == null) return null; const n = +s; return Number.isFinite(n) ? n : null; };

export function findDeliveries(root = ROOT) {
  const out = [];
  for (const dir of readdirSync(root)) {
    const p = join(root, dir);
    if (!statSync(p).isDirectory()) continue;
    const files = readdirSync(p).filter((f) => /\.xlsx$/i.test(f) && !f.startsWith("~$"));
    const dated = (f) => (f.match(/(\d{8}) Data/) || [])[1];
    const asgs = files.find((f) => /ASGS/i.test(f));
    const nat  = files.find((f) => !/ASGS/i.test(f));
    const date = dated(asgs || nat || "");
    if (!date) { console.warn(`  skip ${dir}: no "YYYYMMDD Data" in filename`); continue; }
    out.push({ dir, date, month: `${date.slice(0, 4)}-${date.slice(4, 6)}`,
               asgs: asgs && join(p, asgs), nat: nat && join(p, nat) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/* One level (sa2|lga) across every month. Areas are the union over all months:
   an area that appears in only some deliveries still gets a full-length series.
   A month with no sales is written 0, not blank: Cotality omits the cell entirely,
   and salesRecord() sums with (x||0), so 0 and absent are already equivalent there. */
function buildLevel(deliveries, pick) {
  const areas = new Map();
  const groups = new Map();
  deliveries.forEach((d, mi) => {
    const { rows, nameCol, parentCol } = pick(d);
    for (const row of rows) {
      const state = (row.State || "").trim();
      const name = (row[nameCol] || "").trim();
      const type = (row["Property Type"] || "").trim();
      if (!state || !name || (type !== "H" && type !== "U")) continue;
      const key = `${state}|${name}`;
      if (parentCol && row[parentCol]) groups.set(key, String(row[parentCol]).trim());
      let a = areas.get(key);
      if (!a) areas.set(key, (a = {}));
      let t = a[type];
      if (!t) a[type] = (t = { counts: new Array(deliveries.length).fill(null),
                               values: new Array(deliveries.length).fill(null), snap: null, snapAt: -1 });
      const c = num(row[COUNT_COL]), v = num(row[VALUE_COL]);
      /* The row exists, so this month is on the record: a blank cell means no
         sales that month and serialises to 0. A month where the area is absent
         from the workbook altogether stays null and serialises to "" - that is
         how the shipped blob tells an SA2 that did not yet exist apart from one
         that simply sold nothing. */
      t.counts[mi] = c == null ? 0 : r0(c);
      t.values[mi] = v == null ? 0 : r0(v / 1000);
      /* Snapshot is the latest month in which this area+type appears. */
      if (mi > t.snapAt) {
        t.snapAt = mi;
        t.snap = SNAP.map(([, col, fn]) => { const x = num(row[col]); return x == null ? 0 : fn(x); });
      }
    }
  });
  return { areas, groups };
}

const csv = (a) => a.map((x) => (x == null ? "" : String(x))).join(",");

export function build(root = ROOT) {
  const deliveries = findDeliveries(root);
  if (!deliveries.length) throw new Error(`no deliveries under ${root}`);
  console.log(`${deliveries.length} deliveries: ${deliveries[0].month} -> ${deliveries[deliveries.length - 1].month}`);

  const cache = new Map();
  const sheetOf = (file, sheet) => {
    const k = file + "::" + sheet;
    if (!cache.has(k)) cache.set(k, openWorkbook(file).sheet(sheet));
    return cache.get(k);
  };

  for (const d of deliveries) {
    process.stdout.write(`  ${d.month} `);
    sheetOf(d.asgs, "SA2"); sheetOf(d.nat, "LGA");
    console.log("ok");
  }

  const sa2 = buildLevel(deliveries, (d) => ({ rows: sheetOf(d.asgs, "SA2").rows, nameCol: "SA2", parentCol: "SA3" }));
  const lga = buildLevel(deliveries, (d) => ({ rows: sheetOf(d.nat, "LGA").rows, nameCol: "Local Government Area", parentCol: null }));

  const pack = (m) => {
    const o = {};
    for (const key of [...m.keys()].sort()) {
      const a = m.get(key), e = {};
      for (const t of ["H", "U"]) if (a[t]) e[t] = [csv(a[t].counts), csv(a[t].values), csv(a[t].snap)];
      if (Object.keys(e).length) o[key] = e;
    }
    return o;
  };
  const groups = {};
  for (const k of [...sa2.groups.keys()].sort()) groups[k] = sa2.groups.get(k);

  return { months: deliveries.map((d) => d.month), groups, fields: FIELDS, sa2: pack(sa2.areas), lga: pack(lga.areas) };
}

if (process.argv[1] && process.argv[1].endsWith("cotality.mjs")) {
  const data = build();
  mkdirSync(OUT, { recursive: true });
  const json = JSON.stringify(data);
  writeFileSync(join(OUT, "sales-data.json"), json);
  console.log(`\nsa2 areas ${Object.keys(data.sa2).length} | lga areas ${Object.keys(data.lga).length} | groups ${Object.keys(data.groups).length}`);
  console.log(`wrote ${OUT}/sales-data.json (${(json.length / 1e6).toFixed(2)} MB)`);
}
