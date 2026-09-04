/* Writes the generated SALES_DATA back into the single-file app.
   Run:  node pipeline/cotality.mjs && node pipeline/inject.mjs

   Inlined rather than fetched on purpose: the app is opened both over HTTP and
   by double-clicking the file, and a file:// page cannot fetch a sibling .json.
   So the ~1 MB stays in the HTML - the problem being solved is that it was
   unrefreshable, not that it was large.

   Only the SALES_DATA line is touched; every other byte is left alone. Note the
   replacement is done with split/join, never String.replace: a replacement
   string containing $' or $& is interpreted by replace() as a pattern and will
   silently duplicate the rest of the file. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const HTML = process.argv[2] || "Australia_Land_Feasibility_.html";
const GEN = "pipeline/out/sales-data.json";
const MARK = "const SALES_DATA=";

if (!existsSync(GEN)) { console.error(`${GEN} missing - run: node pipeline/cotality.mjs`); process.exit(1); }

const data = JSON.parse(readFileSync(GEN, "utf8"));
/* Key order fixed so re-runs are byte-stable and diffs stay readable. */
const ordered = { months: data.months, groups: data.groups, fields: data.fields, sa2: data.sa2, lga: data.lga };
const next = MARK + JSON.stringify(ordered) + ";";

const src = readFileSync(HTML, "utf8");
const eol = src.includes("\r\n") ? "\r\n" : "\n";
const lines = src.split(eol);
const hits = lines.map((l, i) => (l.startsWith(MARK) ? i : -1)).filter((i) => i >= 0);

if (hits.length !== 1) { console.error(`expected 1 SALES_DATA line, found ${hits.length}`); process.exit(1); }
const at = hits[0];

if (lines[at] === next) { console.log(`no change - ${HTML} already current (line ${at + 1})`); process.exit(0); }

const backup = HTML + ".pre-inject.bak";
writeFileSync(backup, src);
const before = lines[at].length;
lines[at] = next;
const out = lines.join(eol);
writeFileSync(HTML, out);

/* Everything except that one line must be untouched. */
const check = readFileSync(HTML, "utf8").split(eol);
const drift = check.filter((l, i) => i !== at && l !== lines[i]).length;
console.log(`line ${at + 1}: ${before} -> ${next.length} chars`);
console.log(`months ${data.months[0]} -> ${data.months[data.months.length - 1]} | sa2 ${Object.keys(data.sa2).length} | lga ${Object.keys(data.lga).length}`);
console.log(drift === 0 ? `other lines unchanged. backup: ${backup}` : `WARNING: ${drift} other lines changed`);
