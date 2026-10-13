// Assembles the single-file dashboard from src/.
//   node build.mjs            -> Sobha_USA_Cashflow_Dashboard.html
// No dependencies: the page, the baseline data and the scripts are inlined as-is.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(join(here, 'src', f), 'utf8');

// JSON inside <script> must not close the tag or break on line separators.
const inlineJson = (s) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const inlineJs = (s, name) => {
  if (/<\/script/i.test(s)) throw new Error(name + ' contains </script');
  return s;
};

// Order matters: derived datasets run after the ones they read.
const SCRIPTS = ['shim.js', 'xlsx.js', 'extract.js', 'derive-consol-pl.js', 'derive-components.js', 'derive-kpi.js', 'derive-details.js', 'derive-actuals.js', 'store.js', 'app.js'];
const baseline = JSON.stringify(JSON.parse(src('baseline.json')));

let html = src('page.html').replace(/\s*$/, '\n');
html += '<script id="baseline-data" type="application/json">' + inlineJson(baseline) + '</script>\n';
for (const f of SCRIPTS) html += '<script>\n' + inlineJs(src(f), f).replace(/\s*$/, '\n') + '</script>\n';
html += '</body></html>\n';

const out = join(here, 'Sobha_USA_Cashflow_Dashboard.html');
writeFileSync(out, html);
console.log('wrote', out, (html.length / 1024 / 1024).toFixed(2) + ' MB');
