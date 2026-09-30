// Inlines sources into two self-contained HTML files: node build.mjs
//   Attendance Tracker.html  ← shared/*.js + src/*.js + src/style.css + src/shell.html   (admin)
//   Worker Attendance.html   ← shared/*.js + src-worker/*.js + worker.css + shell.html    (phone)
// and copies the API core into azure/api for the Functions app.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
const here = p => new URL(p, import.meta.url);
const js = d => readdirSync(here(d)).filter(f => f.endsWith('.js')).sort().map(f => readFileSync(here(d + f), 'utf8'));
const shared = js('./shared/');
function out(name, dir, css, shell) {
  const html = readFileSync(here(dir + shell), 'utf8').replace('/*STYLE*/', () => readFileSync(here(dir + css), 'utf8')).replace('/*SCRIPT*/', () => [...shared, ...js(dir)].join('\n'));
  writeFileSync(here('./' + name), html); console.log(name, (html.length / 1024).toFixed(0) + ' KB');
}
out('Attendance Tracker.html', './src/', 'style.css', 'shell.html');
out('Worker Attendance.html', './src-worker/', 'worker.css', 'shell.html');
// Azure deploy folder: web/index.html (admin), web/worker/index.html (phone), api/src/lsapi.js (core)
if (existsSync(here('./azure/'))) {
  mkdirSync(here('./azure/api/src/'), { recursive: true }); mkdirSync(here('./azure/web/worker/'), { recursive: true });
  copyFileSync(here('./shared/lsapi.js'), here('./azure/api/src/lsapi.js'));
  copyFileSync(here('./Attendance Tracker.html'), here('./azure/web/index.html'));
  copyFileSync(here('./Worker Attendance.html'), here('./azure/web/worker/index.html'));
}
