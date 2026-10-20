import { chromium, devices } from 'playwright';
const N = new URL('./node_modules/', import.meta.url).pathname;
const RUN = String(Date.now()).slice(-5);
const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await b.newContext({ ...devices['Pixel 7'], geolocation: { latitude: 25.03, longitude: 55.4401, accuracy: 9 }, permissions: ['geolocation', 'camera'] });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
await ctx.route('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/**', r => r.fulfill({ path: N + 'leaflet/dist/' + r.request().url().split('/dist/')[1] }));
await ctx.route(/arcgisonline/, r => r.fulfill({ body: PNG, contentType: 'image/png' }));
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
// record what the page asks the camera for
await ctx.addInitScript(() => { const md = navigator.mediaDevices; if (!md) return; const g = md.getUserMedia.bind(md); md.getUserMedia = c => { window.__cam = c; return g(c); }; });
const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.stack.split('\n').slice(0, 5).join(' | ')));
// roster: one worker, PIN 2468, site at current position (dev server, admin role)
await pg.goto((process.env.BASE || 'http://localhost:4280') + '/worker/'); await pg.waitForSelector('#code');
await pg.evaluate(async RUN => { const h = await LSAPI.hashPin('2468'); await fetch('/api/admin/roster', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workers: [{ id: 'wq' + RUN, code: 'C7' + RUN, name: 'TEST OFFLINE', shift: 'DAY', siteId: 'sq1', enabled: true, pinHash: h.hash, pinSalt: h.salt, resetDevice: true }], sites: [{ id: 'sq1', name: 'TEST SITE', pins: [{ lat: 25.03, lng: 55.44, radius: 100 }] }], settings: { windowMin: 1440 } }) }); }, RUN);
await pg.fill('#code', 'C7' + RUN); await pg.click('#b-next'); for (const k of '2468') await pg.click(`.pad [data-k="${k}"]`); await pg.waitForSelector('#b-punch'); await pg.waitForTimeout(600);
// offline punch → queued
await ctx.setOffline(true);
await pg.click('#b-punch'); await pg.waitForSelector('.cam [data-s]:not([disabled])');
const cam = await pg.evaluate(() => ({ c: window.__cam?.video, fit: getComputedStyle(document.querySelector('.cam video')).objectFit, flip: getComputedStyle(document.querySelector('.cam video')).transform }));
ok(cam.c?.facingMode === 'user' && !cam.c.width && !cam.c.height && cam.fit === 'contain' && cam.flip.startsWith('matrix(-1'), 'selfie camera: whole frame, no forced size, mirrored preview ' + JSON.stringify(cam));
await pg.click('.cam [data-s]'); await pg.click('.cam [data-u]'); await pg.waitForSelector('#b-done');
ok(/Saved on phone/.test(await pg.textContent('.res')), 'offline punch saved on phone');
await pg.click('#b-done'); await pg.waitForTimeout(300);
ok(/1 waiting to send/.test(await pg.textContent('#qbar')), 'queue bar shows 1 waiting');
await ctx.setOffline(false); await pg.evaluate(() => flushQueue()); await pg.waitForTimeout(800);
ok(await pg.evaluate(async () => (await qAll()).length) === 0 && /Accepted/.test(await pg.textContent('.list')), 'queue flushed on reconnect, punch accepted');
// language: Urdu (RTL) and Malayalam
await pg.click('#b-lang'); await pg.click('.sheet-menu button:has-text("اردو")'); await pg.waitForTimeout(200);
ok(await pg.evaluate(() => document.documentElement.dir) === 'rtl' && /چیک آؤٹ/.test(await pg.textContent('#b-punch')), 'Urdu, right-to-left');

await pg.click('#b-lang'); await pg.click('.sheet-menu button:has-text("English")');
// supervisor board + punch on behalf (dev server role = admin)
await pg.click('#b-menu'); await pg.click('.sheet-menu button:has-text("Supervisor")'); await pg.waitForSelector('#sp-site');
ok(new RegExp('C7' + RUN).test(await pg.textContent('main')) && +(await pg.textContent('[data-f=in] b')) >= 1, 'supervisor board shows worker on site');

await pg.evaluate(() => { W.sup = false; go('home'); }); await pg.waitForSelector('#b-punch');
// slow server: after 6 s the check-out is kept on the phone and the worker can go; the request still lands, once
await ctx.route('**/api/worker/punch', async r => { await new Promise(x => setTimeout(x, 8000)); r.continue().catch(() => { }); });
await pg.click('#b-punch'); await pg.waitForSelector('.cam [data-s]:not([disabled])'); await pg.click('.cam [data-s]');
const t0 = Date.now(); await pg.click('.cam [data-u]'); await pg.waitForSelector('#b-done', { timeout: 9000 }); const wait = Date.now() - t0;
ok(/Saved on phone/.test(await pg.textContent('.res')) && wait < 7500, `slow server: worker released after ${wait} ms`);
await pg.waitForTimeout(3500);
ok(await pg.evaluate(async () => (await qAll()).length) === 0, 'slow check-out delivered and removed from the phone queue');
await ctx.unroute('**/api/worker/punch');
// reopening: Today appears from the last profile while the server is still answering
await ctx.route('**/api/worker/me', async r => { await new Promise(x => setTimeout(x, 4000)); r.continue().catch(() => { }); });
const t1 = Date.now(); await pg.reload(); await pg.waitForSelector('#b-punch'); const open = Date.now() - t1;
ok(open < 3000, `Today shown ${open} ms after reopening, before the server answered`);
await ctx.unroute('**/api/worker/me');

console.log(errs.length ? errs : 'no page errors'); console.log(`${pass} passed, ${fail} failed`); await b.close();
