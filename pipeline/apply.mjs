/* Applies an input patch to named parcels in the app.

   Keys are appended at the END of the parcel's input object rather than edited in
   place. A later key in a JS object literal wins, so this overrides whatever the
   spread or an earlier line set, without having to find and rewrite existing keys -
   which is what makes it safe to run repeatedly on a 2.4 MB file. */
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "Australia_Land_Feasibility_.html";

export function applyPatches(patches, label) {
  let s = readFileSync(FILE, "utf8");
  const report = [];
  for (const [name, patch] of Object.entries(patches)) {
    const keys = Object.entries(patch);
    if (!keys.length) { report.push([name, "no change"]); continue; }
    const at = s.indexOf('newParcel("' + name + '"');
    if (at < 0) { report.push([name, "PARCEL NOT FOUND"]); continue; }
    const open = s.indexOf("{", at);
    let depth = 0, i = open;
    for (; i < s.length; i++) {
      const c = s[i];
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (!depth) break; }
    }
    const body = keys.map(([k, v]) => k + ":" + v).join(",");
    const ins = ",\n      /* " + label + " */\n      " + body;
    s = s.slice(0, i) + ins + s.slice(i);
    report.push([name, body]);
  }
  writeFileSync(FILE, s);
  return report;
}

if (process.argv[1] && process.argv[1].endsWith("apply.mjs")) {
  const patches = JSON.parse(readFileSync(process.argv[2], "utf8"));
  for (const [n, r] of applyPatches(patches, process.argv[3] || "patch")) console.log("  " + n.slice(0, 40).padEnd(42) + r);
}
