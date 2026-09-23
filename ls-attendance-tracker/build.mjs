// Inlines src/ into a single self-contained HTML file: node build.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const dir = new URL('./src/', import.meta.url);
const js = readdirSync(dir).filter(f => f.endsWith('.js')).sort().map(f => readFileSync(new URL(f, dir), 'utf8')).join('\n');
const css = readFileSync(new URL('style.css', dir), 'utf8');
const html = readFileSync(new URL('shell.html', dir), 'utf8').replace('/*STYLE*/', () => css).replace('/*SCRIPT*/', () => js);
writeFileSync(new URL('./Attendance_Tracker.html', import.meta.url), html);
console.log('Attendance_Tracker.html', (html.length / 1024).toFixed(0) + ' KB');
