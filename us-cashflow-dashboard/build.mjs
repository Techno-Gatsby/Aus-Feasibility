// Assembles the single-file dashboard from src/.
//   node build.mjs
//     -> Sobha_USA_Cashflow_Dashboard.html   complete page, opens straight from disk
//     -> dist/artifact.html                  the same page without the document wrapper, for publishing
// No dependencies: the page, the baseline data and the scripts are inlined as-is.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
const SCRIPTS = ['shim.js', 'xlsx.js', 'extract.js', 'derive-consol-pl.js', 'derive-components.js', 'derive-details.js', 'derive-kpi.js', 'derive-actuals.js', 'store.js', 'app.js', 'upload.js'];
const baseline = JSON.stringify(JSON.parse(src('baseline.json')));

// page.html = <title>, font link and styles, then <div id="dash-root">…
const page = src('page.html').replace(/\s*$/, '\n');
const cut = page.indexOf('<div id="dash-root">');
const headPart = page.slice(0, cut), bodyPart = page.slice(cut);

let body = bodyPart;
body += '<script id="baseline-data" type="application/json">' + inlineJson(baseline) + '</script>\n';
// data-sb marks the page's own scripts, so "Download updated dashboard" can rebuild the file.
for (const f of SCRIPTS) body += '<script data-sb="' + f + '">\n' + inlineJs(src(f), f).replace(/\s*$/, '\n') + '</script>\n';

const full = '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n'
  + headPart + '</head><body>\n' + body + '</body></html>\n';
writeFileSync(join(here, 'Sobha_USA_Cashflow_Dashboard.html'), full);
mkdirSync(join(here, 'dist'), { recursive: true });
writeFileSync(join(here, 'dist', 'artifact.html'), headPart + body);
console.log('wrote Sobha_USA_Cashflow_Dashboard.html', (full.length / 1048576).toFixed(2) + ' MB, and dist/artifact.html');
