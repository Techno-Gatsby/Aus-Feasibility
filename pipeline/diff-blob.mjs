/* Acceptance test: does the rebuilt pipeline reproduce the blob currently shipping
   in the HTML? Any difference is either a bug here or a rounding rule not yet
   recovered. Run:  node pipeline/diff-blob.mjs */
import { readFileSync } from "node:fs";

const HTML = process.argv[2] || "Australia_Land_Feasibility_.html";
const GEN = "pipeline/out/sales-data.json";

const line = readFileSync(HTML, "utf8").split("\n").find((l) => l.startsWith("const SALES_DATA="));
if (!line) throw new Error("no SALES_DATA line in " + HTML);
const cur = new Function("return " + line.replace(/^const SALES_DATA=/, "").replace(/;\s*$/, ""))();
const gen = JSON.parse(readFileSync(GEN, "utf8"));

let bad = 0;
const say = (ok, msg) => { console.log((ok ? "  PASS  " : "  FAIL  ") + msg); if (!ok) bad++; };

say(JSON.stringify(cur.months) === JSON.stringify(gen.months), `months (${gen.months.length})`);
/* Fields may be APPENDED to - every existing index must keep its meaning, so the
   reference list has to be a prefix of the generated one. Reordering or removing
   a field silently changes what every stored snapshot means, so that fails. */
const prefixOk = cur.fields.every((f, i) => gen.fields[i] === f);
const added = gen.fields.slice(cur.fields.length);
say(prefixOk, `fields: ${cur.fields.length} reference fields unchanged in place` +
    (added.length ? ` (+${added.length} appended: ${added.join(", ")})` : ""));

const gk = Object.keys(cur.groups), gd = gk.filter((k) => cur.groups[k] !== gen.groups[k]);
say(gd.length === 0 && gk.length === Object.keys(gen.groups).length,
    `groups ${gk.length} (${gd.length} differ${gd.length ? ": " + gd.slice(0, 3).join(", ") : ""})`);

const fieldMiss = new Map(); const samples = [];
for (const level of ["sa2", "lga"]) {
  const A = cur[level], B = gen[level];
  const ka = Object.keys(A), kb = Object.keys(B);
  const missing = ka.filter((k) => !B[k]), extra = kb.filter((k) => !A[k]);
  say(missing.length === 0, `${level}: ${ka.length} areas, ${missing.length} missing${missing.length ? " e.g. " + missing.slice(0, 3).join(" / ") : ""}`);
  say(extra.length === 0, `${level}: ${extra.length} unexpected${extra.length ? " e.g. " + extra.slice(0, 3).join(" / ") : ""}`);

  let cellsBad = 0, cells = 0, seriesBad = 0;
  for (const k of ka) {
    if (!B[k]) continue;
    for (const t of ["H", "U"]) {
      if (!A[k][t]) continue;
      if (!B[k][t]) { seriesBad++; continue; }
      const [ac, av, as] = A[k][t], [bc, bv, bs] = B[k][t];
      if (ac !== bc) { seriesBad++; if (samples.length < 6) samples.push(`${level} ${k} [${t}] counts\n      have ${ac}\n      want ${bc}`); }
      if (av !== bv) { seriesBad++; if (samples.length < 6) samples.push(`${level} ${k} [${t}] values\n      have ${av}\n      want ${bv}`); }
      const a = as.split(","), b = bs.split(",");
      for (let i = 0; i < cur.fields.length; i++) {
        cells++;
        if (a[i] !== b[i]) {
          cellsBad++;
          const f = cur.fields[i];
          if (!fieldMiss.has(f)) fieldMiss.set(f, { n: 0, eg: [] });
          const e = fieldMiss.get(f); e.n++;
          if (e.eg.length < 2) e.eg.push(`${k}[${t}] have=${a[i]} want=${b[i]}`);
        }
      }
    }
  }
  say(seriesBad === 0, `${level}: monthly series mismatches ${seriesBad}`);
  say(cellsBad === 0, `${level}: snapshot cells ${cellsBad}/${cells} differ`);
}

if (fieldMiss.size) {
  console.log("\nSnapshot mismatches by field:");
  for (const [f, e] of [...fieldMiss].sort((x, y) => y[1].n - x[1].n))
    console.log(`  ${f.padEnd(11)} ${String(e.n).padStart(6)}   ${e.eg.join(" | ")}`);
}
if (samples.length) console.log("\nSeries samples:\n   " + samples.join("\n   "));
console.log(bad === 0 ? "\nEXACT MATCH - pipeline reproduces the shipped blob." : `\n${bad} check(s) failed.`);
process.exit(bad ? 1 : 0);
