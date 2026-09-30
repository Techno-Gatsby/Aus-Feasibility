// node tests/api.test.mjs — API core rules with the in-memory store
import { createRequire } from 'module'; const require = createRequire(import.meta.url);
const L = require('../shared/lsapi.js');
let T = Date.UTC(2026, 6, 1, 3, 0);                 // 07:00 Dubai, 1 Jul 2026
const store = L.memoryStore(); const api = L.create({ store, secret: 'test', now: () => T });
const admin = { userRoles: ['admin'], userDetails: 'ali' };
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const call = (method, path, body, extra = {}) => api.handle({ method, path, body, query: extra.query || {}, headers: extra.headers || {}, principal: extra.principal });
const pin = await L.hashPin('4321');
const SITE = { id: 's1', name: 'INFRA OFFICE', project: 'SCL - ELWOOD - INFRA', pins: [{ lat: 25.0, lng: 55.5, radius: 100 }] };
const GATE = { id: 's2', name: 'GATE NO 1', project: 'SCL - ELWOOD - INFRA', pins: [{ lat: 25.01, lng: 55.5, radius: 100 }] };
let r = await call('PUT', 'admin/roster', { workers: [{ id: 'e1', code: 'c52392', name: 'ANEESH DOMINIC', shift: 'DAY', siteId: 's1', enabled: true, pinHash: pin.hash, pinSalt: pin.salt }, { id: 'e2', code: 'C80453', name: 'HARIKUMAR', shift: 'NIGHT', siteId: 's1', enabled: true, pinHash: pin.hash, pinSalt: pin.salt }], sites: [SITE, GATE] });
ok(r.status === 403, 'roster needs admin role');
r = await call('PUT', 'admin/roster', { workers: [{ id: 'e1', code: 'c52392', name: 'ANEESH DOMINIC', shift: 'DAY', siteId: 's1', enabled: true, pinHash: pin.hash, pinSalt: pin.salt }, { id: 'e2', code: 'C80453', name: 'HARIKUMAR', shift: 'NIGHT', siteId: 's1', enabled: true, pinHash: pin.hash, pinSalt: pin.salt }], sites: [SITE, GATE] }, { principal: admin });
ok(r.status === 200 && r.body.workers === 2, 'roster published');
for (let i = 0; i < 5; i++) r = await call('POST', 'worker/login', { code: 'C52392', pin: '0000', deviceId: 'd1' });
r = await call('POST', 'worker/login', { code: 'C52392', pin: '4321', deviceId: 'd1' });
ok(r.status === 423, 'locked after 5 wrong PINs');
T += 16 * 60000;
r = await call('POST', 'worker/login', { code: 'C52392', pin: '4321', deviceId: 'd1' });
ok(r.status === 200 && r.body.token && r.body.site?.name === 'INFRA OFFICE', 'login after lock expires, profile has site');
let H = { authorization: 'Bearer ' + r.body.token };
const relog = async () => { const x = await call('POST', 'worker/login', { code: 'C52392', pin: '4321', deviceId: 'd1' }); H = { authorization: 'Bearer ' + x.body.token }; };
ok((await call('POST', 'worker/login', { code: 'C52392', pin: '4321', deviceId: 'OTHER' })).status === 403, 'second phone refused (device binding)');
const photo = 'data:image/jpeg;base64,' + Buffer.from('fakejpeg').toString('base64');
// in zone: 60 m from pin, ±10 m
r = await call('POST', 'worker/punch', { type: 'in', lat: 25.00054, lng: 55.5, acc: 10, photo, clientId: 'a1', ts: T }, { headers: H });
ok(r.status === 200 && r.body.punch.status === 'accepted' && r.body.punch.inZone && r.body.punch.dist === 60, 'in-zone check-in accepted, 60 m: ' + JSON.stringify(r.body.punch?.reasons));
ok(r.body.punch.flags.some(f => /^late/.test(f)), 'late flag at 07:16 for 07:00 shift');
const repeat = await call('POST', 'worker/punch', { type: 'in', lat: 25.00054, lng: 55.5, acc: 10, photo, clientId: 'a1', ts: T }, { headers: H });
ok(repeat.body.repeat === true, 'same clientId is idempotent (offline resend)');
ok((await call('POST', 'worker/punch', { type: 'in', lat: 25.00054, lng: 55.5, acc: 10, photo, clientId: 'a2', ts: T + 60000 }, { headers: H })).status === 409, 'duplicate check-in within 30 min blocked');
ok((await call('POST', 'worker/punch', { type: 'out', lat: 25, lng: 55.5, acc: 5, ts: T }, { headers: H })).body.code === 'NO_PHOTO', 'photo required');
T += 12 * 3600000;
r = await call('POST', 'worker/punch', { type: 'out', lat: 25.0012, lng: 55.5, acc: 30, photo, clientId: 'a3', ts: T }, { headers: H });
ok(r.body.punch.status === 'pending' && /outside zone – 133 m/.test(r.body.punch.reasons[0]), 'edge: 133 m − 30 m acc > 100 m → pending: ' + r.body.punch.reasons);
ok(r.body.punch.hours === 12 && r.body.punch.inId, 'check-out paired, 12 h');
// reliever at gate
T += 12 * 3600000; await relog();
r = await call('POST', 'worker/punch', { type: 'in', lat: 25.01, lng: 55.5003, acc: 8, photo, clientId: 'a4', ts: T }, { headers: H });
ok(r.body.punch.status === 'accepted' && r.body.punch.reliever && r.body.punch.siteId === 's2', 'punch at another site zone → accepted as reliever');
// poor accuracy
T += 12 * 3600000; await relog();
r = await call('POST', 'worker/punch', { type: 'in', lat: 25.0, lng: 55.5, acc: 80, photo, clientId: 'a5', ts: T }, { headers: H });
ok(r.body.punch.status === 'pending' && /accuracy/.test(r.body.punch.reasons.join()), 'accuracy ±80 m → pending');
// night shift: check-in 19:05 Dubai 3 Jul, check-out 07:02 4 Jul → work date 3 Jul
T = Date.UTC(2026, 6, 3, 15, 0);
const l2 = await call('POST', 'worker/login', { code: 'C80453', pin: '4321', deviceId: 'd2' }); const H2 = { authorization: 'Bearer ' + l2.body.token };
T = Date.UTC(2026, 6, 3, 15, 5);
r = await call('POST', 'worker/punch', { type: 'in', lat: 25, lng: 55.5, acc: 5, photo, clientId: 'n1', ts: T }, { headers: H2 });
if (!r.body.punch) console.log(r, l2.body.error); ok(r.body.punch?.workDate === '2026-07-03' && !r.body.punch.flags.some(f => /late/.test(f)), 'night check-in 19:05 → 3 Jul, not late');
T = Date.UTC(2026, 6, 4, 3, 2);
r = await call('POST', 'worker/punch', { type: 'out', lat: 25, lng: 55.5, acc: 5, photo, clientId: 'n2', ts: T }, { headers: H2 });
ok(r.body.punch.workDate === '2026-07-03' && r.body.punch.hours === 11.95, 'night check-out next morning pairs to 3 Jul, 11.95 h');
// offline punch 3 h old keeps its own time
r = await call('POST', 'worker/punch', { type: 'in', lat: 25, lng: 55.5, acc: 5, photo, clientId: 'n3', ts: T - 3 * 3600000 }, { headers: H2 });
ok(r.status === 409 || r.body.punch?.flags.includes('offline'), 'old queued punch keeps time / flagged offline');
// admin pull, review, photo
r = await call('GET', 'admin/punches', null, { query: { since: 0 }, principal: admin });
ok(r.body.punches.length >= 6 && r.body.punches.every(p => !p.photo && p.hasPhoto), 'admin pull without photo bytes');
const pend = r.body.punches.find(p => p.status === 'pending');
r = await call('POST', 'admin/review', { id: pend.id, status: 'accepted', note: 'seen on CCTV' }, { principal: admin });
ok(r.body.punch.status === 'accepted' && r.body.punch.reviewNote === 'seen on CCTV', 'review approves pending punch');
r = await call('GET', 'admin/photo', null, { query: { id: pend.id }, principal: admin });
ok(r.status === 200 && Buffer.from(r.bytes).toString() === 'fakejpeg', 'photo streamed back');
ok((await call('GET', 'admin/photo', null, { query: { id: pend.id } })).status === 403, 'photo needs a role');
// no check-in: supervisor marks the day
r = await call('POST', 'supervisor/mark', { code: 'C80453', date: '2026-07-10', mark: 'SL', note: 'called in sick' }, { principal: { userRoles: ['supervisor'], userDetails: 'sup' } });
ok(r.status === 200 && r.body.mark.mark === 'SL', 'supervisor marks no-show day SL');
ok((await call('POST', 'supervisor/mark', { code: 'C80453', date: '2026-07-10', mark: 'XX' }, { principal: admin })).status === 400, 'unknown code refused');
ok((await call('POST', 'supervisor/mark', { code: 'C80453', date: '2026-07-10', mark: 'A' })).status === 403, 'mark needs supervisor role');
r = await call('GET', 'admin/marks', null, { query: { since: 0 }, principal: admin });
ok(r.body.marks.length === 1 && r.body.marks[0].id === 'e2|2026-07-10', 'admin pulls marks');
ok((await call('POST', 'worker/leave', { type: 'SL', from: '2026-07-10', to: '2026-07-11' }, { headers: H2 })).status === 404, 'worker leave requests removed');
// supervisor board and punch
r = await call('GET', 'supervisor/board', null, { principal: { userRoles: ['supervisor'], userDetails: 'sup' } });
ok(r.status === 200 && r.body.workers.length === 2, 'supervisor board');
ok((await call('GET', 'supervisor/board', null, {})).status === 403, 'board needs supervisor role');
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
