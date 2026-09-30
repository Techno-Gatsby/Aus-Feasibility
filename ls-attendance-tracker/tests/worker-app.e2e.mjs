import { chromium, devices } from 'playwright';
const N = new URL('./node_modules/', import.meta.url).pathname;
const D = new URL('..', import.meta.url).pathname; const BASE = process.env.BASE || ''; const AURL = BASE ? BASE + '/' : 'file://' + D + 'Attendance%20Tracker.html', WURL = BASE ? BASE + '/worker/' : 'file://' + D + 'Worker%20Attendance.html';
const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await b.newContext({ viewport: { width: 1500, height: 900 }, geolocation: { latitude: 25.03, longitude: 55.44, accuracy: 10 }, permissions: ['geolocation', 'camera'] });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const libs = { 'xlsx.full.min.js': N + 'xlsx/dist/xlsx.full.min.js', 'exceljs.min.js': N + 'exceljs/dist/exceljs.min.js', 'pdf-lib.min.js': N + 'pdf-lib/dist/pdf-lib.min.js', 'qrcode.js': N + 'qrcode-generator/qrcode.js' };
await ctx.route('https://cdn.jsdelivr.net/**', r => { const u = r.request().url(); if (u.includes('/leaflet@')) return r.fulfill({ path: N + 'leaflet/dist/' + u.split('/dist/')[1] }); const f = Object.keys(libs).find(k => u.endsWith(k)); return f ? r.fulfill({ path: libs[f], contentType: 'application/javascript' }) : r.abort(); });
await ctx.route(/tile\.openstreetmap|arcgisonline/, r => r.fulfill({ body: PNG, contentType: 'image/png' }));
let searched = '';
await ctx.route(/photon\.komoot\.io/, r => { searched = new URL(r.request().url()).searchParams.get('q'); r.fulfill({ json: { features: [{ geometry: { coordinates: [55.44, 25.03] }, properties: { name: 'Sobha Elwood', city: 'Dubai', state: 'Dubai' } }, { geometry: { coordinates: [55.45, 25.05] }, properties: { name: 'Al Yufrah', state: 'Dubai' } }] } }); });
await ctx.addInitScript(() => { window.print = () => { window.__printed = document.getElementById('print-root').innerHTML; }; window.prompt = () => 'test reject'; });
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const A = await ctx.newPage(); const errs = []; A.on('pageerror', e => errs.push('admin: ' + e.message));
await A.goto(AURL); await A.waitForSelector('body[data-ready]');
// 1. site location through the UI: search with suggestions, pick, radius
const site = await A.evaluate(() => { const s = S.sites.find(x => x.name === 'INFRA OFFICE' && projOfSite(x.id)?.name === 'SCL - ELWOOD - INFRA'); return s.id; });
await A.evaluate(id => { showView('projects'); editSite(id); }, site); await A.waitForSelector('#es-map .leaflet-control-layers');
await A.fill('#es-q', 'Elwood'); await A.waitForSelector('.lsm-sug button'); ok(searched === 'Elwood' && (await A.locator('.lsm-sug button').count()) === 2, 'type-ahead suggestions shown');

await A.locator('.lsm-sug button').first().dispatchEvent('mousedown'); await A.waitForTimeout(200);
await A.fill('#es-pins input[type=number][data-pk=radius]', '120'); await A.dispatchEvent('#es-pins input[type=number][data-pk=radius]', 'input');
ok(await A.evaluate(() => document.querySelectorAll('.leaflet-control-layers-base input').length) === 2, 'Map / Satellite switch present');

await A.click('#modal .mf button.pri');
const pins = await A.evaluate(id => IX.site.get(id).pins, site); ok(pins.length === 1 && pins[0].lat === 25.03 && pins[0].radius === 120, 'pin saved ' + JSON.stringify(pins));
// 2. two workers on that site, app access + PIN slips
await A.evaluate(id => { for (const c of ['C52392', 'C80453']) { const e = S.employees.find(x => x.empCode === c); setAssignment(e, '2026-09-01', id, c === 'C52392' ? 'DAY' : 'NIGHT'); e.end = null; } reindex(); markDirty(); }, site);
const pinsOut = await A.evaluate(async () => { const es = ['C52392', 'C80453'].map(c => S.employees.find(x => x.empCode === c)); const sl = await givePins(es); es.forEach(e => e.app.resetDevice = true); await printSlips(sl); return sl.map(x => x.pin); });
await A.waitForTimeout(300); ok((await A.evaluate(() => window.__printed || '')).includes(pinsOut[0]), 'PIN slip printed with PIN');
await A.evaluate(() => showView('app')); await A.click('#toolbar button:has-text("Publish roster")'); await A.waitForTimeout(500);
ok(await A.evaluate(() => S.app.lastPublish > 0), 'roster published');
// 3. worker phone: sign in + in-zone check-in
const Wp = await ctx.newPage(); Wp.on('pageerror', e => errs.push('worker: ' + e.message)); await Wp.setViewportSize({ width: 412, height: 900 });
await Wp.goto(WURL); await Wp.waitForSelector('#code');
await Wp.fill('#code', 'c52392'); await Wp.click('#b-next'); for (const k of pinsOut[0]) await Wp.click(`.pad [data-k="${k}"]`);
await Wp.waitForSelector('#b-punch'); await Wp.waitForTimeout(700);
ok(/In zone · 0 m from INFRA OFFICE/.test(await Wp.textContent('#gps')), 'worker sees in-zone chip');
await Wp.click('#b-punch'); await Wp.waitForSelector('.cam [data-s]'); await Wp.waitForTimeout(500); await Wp.click('.cam [data-s]'); await Wp.click('.cam [data-u]');
await Wp.waitForSelector('#b-done'); ok(/Attendance marked/.test(await Wp.textContent('.res')), 'check-in accepted');
// 4. second worker outside the zone → pending; leave request
await Wp.click('#b-done'); await Wp.evaluate(() => signOut()); await Wp.evaluate(() => { W.editCode = true; render(); });
await ctx.setGeolocation({ latitude: 25.0335, longitude: 55.44, accuracy: 15 });             // ~390 m north
await Wp.fill('#code', 'C80453'); await Wp.click('#b-next'); for (const k of pinsOut[1]) await Wp.click(`.pad [data-k="${k}"]`);
await Wp.waitForSelector('#b-punch'); await Wp.waitForTimeout(700);
ok(/Outside zone/.test(await Wp.textContent('#gps')), 'outside-zone chip');
await Wp.evaluate(() => { W.api._t = 1; });
await Wp.click('#b-punch'); await Wp.waitForSelector('.cam [data-s]'); await Wp.waitForTimeout(400); await Wp.click('.cam [data-s]'); await Wp.click('.cam [data-u]');
await Wp.waitForSelector('#b-done'); const res2 = await Wp.textContent('.res');
ok(/review|Too early|too early/i.test(res2), 'outside punch → review: ' + res2.replace(/\s+/g, ' ').slice(0, 90));
await Wp.click('#b-done');
// supervisor on the phone marks a worker who did not check in (demo/dev role: supervisor/admin)
const third = await A.evaluate(async id => { const e = S.employees.find(x => x.empCode === 'C66585'); setAssignment(e, '2026-09-01', id, 'DAY'); e.end = null; const sl = await givePins([e]); await publishRoster(true); return sl[0].pin; }, site);
await Wp.evaluate(() => openSupervisor()); await Wp.waitForSelector('#sp-date');
await Wp.fill('#sp-date', '2026-09-29'); await Wp.dispatchEvent('#sp-date', 'change'); await Wp.waitForTimeout(400);
await Wp.selectOption('[data-mk="C66585"]', 'SL'); await Wp.waitForTimeout(500);
ok(/1 marked/.test(await Wp.textContent('main')), 'supervisor marked a no-check-in day on the phone');

// 5. admin sync → P + dot; right-click → details with photo and distance
await A.bringToFront(); await A.evaluate(() => syncApp()); await A.waitForTimeout(600);
const st = await A.evaluate(() => { const e = S.employees.find(x => x.empCode === 'C52392'); const d = Object.values(S.punches).find(p => p.wid === e.id).workDate; return { d, cell: getCell(e.id, d), pend: pendingPunches().length, mark: getCell(S.employees.find(x => x.empCode === 'C66585').id, '2026-09-29')?.c }; });
ok(st.cell?.c === 'P' && st.pend === 1 && st.mark === 'SL', 'sync: P written, 1 punch to review, supervisor SL applied ' + JSON.stringify(st));
await A.evaluate(d => { AV.ym = cycleOfDate(d); AV.mode = 'payroll'; AV.f.q = 'ANEESH DOMINIC'; showView('attendance'); }, st.d); await A.waitForTimeout(300);
const r = await A.evaluate(() => AV.rows.findIndex(x => x.emp.empCode === 'C52392')), c = await A.evaluate(d => AV.dates.indexOf(d), st.d);
const cell = A.locator('#grid-wrap tbody tr').nth(r).locator('td.d').nth(c);
ok(await cell.locator('.pd').count() === 1, 'grid cell shows app dot');
await A.evaluate(() => { const tb = document.querySelector('#grid-wrap tbody'); const f = tb.oncontextmenu; tb.oncontextmenu = e => { window.__cm = [e.target.className, e.target.closest('td.d')?.className]; try { f(e); } catch (x) { window.__cm.push(x.message); } }; }); A.on('console', m => console.log('C', m.text())); const bb = await cell.boundingBox(); console.log('bb', bb, await A.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return el?.tagName + '.' + el?.className + ' ' + el?.closest('#modal-bg,#grid-wrap')?.id; }, [bb.x + bb.width / 2, bb.y + bb.height / 2])); await A.evaluate(() => { window.__ev = []; for (const t of ['mousedown','mouseup','contextmenu','auxclick']) document.addEventListener(t, e => window.__ev.push(t + ':' + e.button + ':' + e.target.tagName + ':' + e.defaultPrevented), true); }); await cell.click({ button: 'right' }); await A.waitForTimeout(300); console.log('ev', await A.evaluate(() => window.__ev)); console.log('dd', await A.evaluate(() => ({ cm: window.__cm, h: document.querySelector('#dropdown').hidden, html: document.querySelector('#dropdown').innerHTML.slice(0, 80) })), errs); await A.waitForSelector('#dropdown:not([hidden])'); 
await A.click('#dropdown button:has-text("Punch details")'); await A.waitForSelector('#pd-map .leaflet-control-layers'); await A.waitForSelector('.ph img', { timeout: 5000 });
const det = (await A.textContent('#modal .mb')).replace(/\s+/g, ' ');
ok(/25\.030000, 55\.440000/.test(det) && /0 m from pin · zone 120 m/.test(det) && /accepted/.test(det), 'punch details: coordinates, distance, status');
 await A.keyboard.press('Escape');
// 6. review: approve the pending punch → P; approve leave → SL days
await A.evaluate(() => showView('app')); await A.waitForTimeout(200); 
await A.click('#v-app [data-ok]'); await A.waitForTimeout(400);
const st2 = await A.evaluate(() => { const e = S.employees.find(x => x.empCode === 'C80453'); const p = Object.values(S.punches).find(x => x.wid === e.id); return { c: getCell(e.id, p.workDate)?.c, s: p.status }; });
ok(st2.s === 'accepted' && st2.c === 'P', 'approved pending punch → P ' + JSON.stringify(st2));
// admin decides a no-check-in day in the tracker
await A.evaluate(() => { AP.date = '2026-09-28'; renderApp(); }); await A.waitForTimeout(200);
const missN = await A.evaluate(() => noCheckIn('2026-09-28').length);
await A.check('#ap-all'); await A.selectOption('#ap-bulk', 'A'); await A.click('#ap-apply'); await A.waitForTimeout(200);
const aDays = await A.evaluate(() => ['C52392', 'C80453', 'C66585'].map(c => getCell(S.employees.find(x => x.empCode === c).id, '2026-09-28')?.c));
ok(missN === 3 && aDays.every(x => x === 'A') && (await A.evaluate(() => noCheckIn('2026-09-28').length)) === 0, 'admin marked 3 no-check-in days A ' + aDays);
// 7. worker month view shows published codes after re-publish
await A.evaluate(() => publishRoster(true)); await Wp.bringToFront(); await Wp.evaluate(() => { W.sup = false; W.api = LSClient.make({ base: API_BASE }); return refresh(false).then(() => go('month')); }); await Wp.waitForTimeout(300); 
ok(/1\s*days worked|days worked/.test(await Wp.textContent('main')), 'month view renders');
console.log(errs.length ? errs : 'no page errors'); console.log(`\n${pass} passed, ${fail} failed`); await b.close();
