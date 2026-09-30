/* =====================================================================
   LS worker-attendance API core.
   One file, three hosts: Azure Functions (Node 20), the local dev server,
   and the in-browser demo mode of both HTML pages. Pure logic over a
   small storage interface; crypto is WebCrypto (browser + Node 20).
   ===================================================================== */
const LSAPI = (() => {
  const enc = new TextEncoder();
  const b64u = buf => { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const unb64u = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; };
  const hex = buf => [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
  const subtle = () => globalThis.crypto.subtle;
  const rid = () => hex(globalThis.crypto.getRandomValues(new Uint8Array(9)));

  /** PBKDF2-SHA256, 100k rounds. The admin tracker hashes the PIN; the server only ever sees hash + salt. */
  async function hashPin(pin, saltHex) {
    const salt = saltHex || hex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
    const key = await subtle().importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
    const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, key, 256);
    return { hash: hex(bits), salt };
  }
  async function hmac(secret, data) {
    const key = await subtle().importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return b64u(await subtle().sign('HMAC', key, enc.encode(data)));
  }
  async function signToken(secret, payload) { const body = b64u(enc.encode(JSON.stringify(payload))); return body + '.' + await hmac(secret, body); }
  async function readToken(secret, tok, now) {
    if (!tok || !tok.includes('.')) return null;
    const [body, sig] = tok.split('.');
    if (await hmac(secret, body) !== sig) return null;
    const p = JSON.parse(new TextDecoder().decode(unb64u(body)));
    return p.exp > now ? p : null;
  }

  /* ---------- geo ---------- */
  const R = 6371000, rad = x => x * Math.PI / 180;
  function distance(a, b) {
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  /** Nearest pin of a site to a point: { d, pin, inZone } — in zone when (distance − accuracy) ≤ radius */
  function nearestPin(site, pt, acc) {
    let best = null;
    for (const pin of site?.pins || []) {
      const d = distance(pt, pin); const r = +pin.radius || 100;
      const x = { d: Math.round(d), pin, radius: r, inZone: d - (acc || 0) <= r };
      if (!best || x.d - x.radius < best.d - best.radius) best = x;
    }
    return best;
  }

  /* ---------- dates: all work dates are Dubai time (UTC+4, no DST) ---------- */
  const DXB = 4 * 3600000;
  const dxbISO = t => new Date(t + DXB).toISOString();                 // "2026-07-01T07:03:00.000Z" read as local Dubai time
  const dxbDate = t => dxbISO(t).slice(0, 10);
  const dxbMin = t => { const s = dxbISO(t); return +s.slice(11, 13) * 60 + +s.slice(14, 16); };
  const hm = s => { const [h, m] = String(s || '0:0').split(':').map(Number); return h * 60 + (m || 0); };

  /** Codes a supervisor may give a day with no check-in (the tracker's own codes) */
  const MARK_CODES = [['A', 'Absent'], ['OFF', 'Day off'], ['SL', 'Sick leave'], ['AL', 'Annual leave'], ['EL', 'Emergency leave'], ['UL', 'Unpaid leave'], ['SIRA', 'SIRA exam / training'], ['P', 'Present – no phone (supervisor confirms)']];
  const DEFAULTS = { radius: 100, maxAcc: 50, windowMin: 60, lateMin: 15, photo: true, bindDevice: true, dupMin: 30, shiftHours: 12, starts: { DAY: '07:00', NIGHT: '19:00' }, lockTries: 5, lockMin: 15, tokenHours: 20 };

  /**
   * store: { get(t, id), put(t, obj), list(t, filterFn?, hint?), del(t, id),   hint = { wid, code, since, fromDate, workDate, clientId, enabled }; tables: workers, sites, punches, marks, config lets a server store filter before the scan; putBlob(name, bytes, type), getBlob(name) → {bytes, type} }
   * opts: { store, secret, now: () => ms }
   */
  function create({ store, secret, now = () => Date.now() }) {
    const J = (status, body) => ({ status, body });
    const err = (status, msg, code) => J(status, { error: msg, code: code || status });
    const cfg = async () => ({ ...DEFAULTS, ...((await store.get('config', 'app'))?.v || {}) });

    async function worker(req) {
      const tok = (req.headers?.authorization || '').replace(/^Bearer /i, '');
      const p = await readToken(secret, tok, now()); if (!p) return null;
      const w = await store.get('workers', p.sub); if (!w || !w.enabled) return null;
      if (w.deviceId && p.dev !== w.deviceId) return null;
      return w;
    }
    const roles = req => req.principal?.userRoles || [];
    const isAdmin = req => roles(req).includes('admin');
    const isSup = req => isAdmin(req) || roles(req).includes('supervisor');
    const isViewer = req => isSup(req) || roles(req).includes('viewer');
    const byCode = async code => { const c = String(code || '').trim().toUpperCase(); return (await store.list('workers', w => w.code === c, { code: c }))[0] || null; };

    async function profile(w) {
      const c = await cfg(), t = now(), today = dxbDate(t);
      const sites = await store.list('sites');
      const mine = await store.list('punches', p => p.wid === w.id && p.workDate >= addDays(today, -1), { wid: w.id, fromDate: addDays(today, -1) });
      const open = [...mine].filter(p => p.type === 'in' && !p.outId && p.status !== 'rejected' && t - p.ts < 18 * 3600000).sort((a, b) => b.ts - a.ts)[0] || null;
      return {
        worker: { id: w.id, code: w.code, name: w.name, shift: w.shift, siteId: w.siteId, trade: w.trade || '' },
        site: sites.find(s => s.id === w.siteId) || null,
        sites: sites.filter(s => s.pins?.length).map(s => ({ id: s.id, name: s.name, project: s.project, pins: s.pins })),
        settings: { radius: c.radius, maxAcc: c.maxAcc, photo: c.photo, windowMin: c.windowMin, starts: c.starts, shiftHours: c.shiftHours },
        today, punches: mine.map(strip).sort((a, b) => a.ts - b.ts), open: open && strip(open),
        months: w.months || {}
      };
    }
    const strip = p => { const { photo, ...r } = p; return { ...r, hasPhoto: !!photo }; };
    const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

    /** The core punch rule, shared by worker and supervisor punches */
    async function doPunch(w, b, by) {
      const c = await cfg(), t = now();
      const type = b.type === 'out' ? 'out' : b.type === 'in' ? 'in' : null; if (!type) return err(400, 'type must be in or out');
      const lat = +b.lat, lng = +b.lng, acc = Math.round(+b.acc || 0);
      if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return err(400, 'Location missing – allow location and try again', 'NO_GPS');
      if (c.photo && !b.photo) return err(400, 'Photo required', 'NO_PHOTO');
      if (b.photo && b.photo.length > 900000) return err(413, 'Photo too large');
      if (b.clientId) { const dup = (await store.list('punches', p => p.clientId === b.clientId && p.wid === w.id, { wid: w.id, clientId: b.clientId }))[0]; if (dup) return J(200, { punch: strip(dup), repeat: true }); }
      // device time: queued offline punches keep their own time, never one in the future
      let ts = +new Date(b.ts || t); const flags = [];
      if (!isFinite(ts) || ts > t + 5 * 60000) { ts = t; flags.push('clock'); }
      if (t - ts > 5 * 60000) flags.push('offline');
      if (t - ts > 72 * 3600000) return err(400, 'Punch older than 72 hours – ask your supervisor');
      const mine = await store.list('punches', p => p.wid === w.id && Math.abs(p.ts - ts) < 20 * 3600000 && p.status !== 'rejected', { wid: w.id, fromDate: addDays(dxbDate(ts), -1) });
      const lastSame = mine.filter(p => p.type === type).sort((a, b) => b.ts - a.ts)[0];
      if (lastSame && Math.abs(ts - lastSame.ts) < c.dupMin * 60000) return err(409, `Already marked ${type === 'in' ? 'check-in' : 'check-out'} at ${dxbISO(lastSame.ts).slice(11, 16)}`, 'DUPLICATE');
      // geofence: assigned site first, then any site (reliever)
      const sites = await store.list('sites');
      const assigned = sites.find(s => s.id === w.siteId);
      const pt = { lat, lng };
      let match = assigned ? nearestPin(assigned, pt, acc) : null, site = assigned, reliever = false;
      if (!match?.inZone) {
        const other = sites.filter(s => s.id !== w.siteId).map(s => ({ s, m: nearestPin(s, pt, acc) })).filter(x => x.m?.inZone).sort((a, b) => a.m.d - b.m.d)[0];
        if (other) { site = other.s; match = other.m; reliever = true; }
      }
      const reasons = [];
      if (!assigned?.pins?.length && !reliever) reasons.push('site has no location pin');
      else if (!match?.inZone) reasons.push(`outside zone – ${match ? match.d + ' m from ' + (site?.name || 'site') : 'no site nearby'}`);
      if (acc > c.maxAcc) reasons.push(`GPS accuracy ±${acc} m (limit ${c.maxAcc} m)`);
      if (flags.includes('clock')) reasons.push('phone clock ahead of server');
      // pairing, work date and hours
      let workDate = dxbDate(ts), inP = null, hours = null;
      if (type === 'out') {
        inP = mine.filter(p => p.type === 'in' && !p.outId && p.ts < ts && ts - p.ts < 18 * 3600000).sort((a, b) => b.ts - a.ts)[0] || null;
        if (inP) { workDate = inP.workDate; hours = Math.round((ts - inP.ts) / 36000) / 100; } else reasons.push('no check-in found');
      }
      const shift = w.shift || 'DAY', start = hm(c.starts[shift] || '07:00'), m = dxbMin(ts);
      if (type === 'in') {
        let late = m - start; if (late < -720) late += 1440; if (late > 720) late -= 1440;
        if (late > c.lateMin) flags.push('late ' + late + ' min');
        if (late < -c.windowMin) reasons.push(`too early – check-in opens ${c.windowMin} min before ${c.starts[shift]}`);
        if (shift === 'NIGHT' && m < 12 * 60) workDate = addDays(workDate, -1);   // night shift started after midnight → belongs to the previous date
      } else if (inP && hours < c.shiftHours - c.lateMin / 60) flags.push('early leave');
      const id = rid();
      let photo = '';
      if (b.photo) { const m2 = String(b.photo).match(/^data:(image\/[a-z]+);base64,(.*)$/); if (m2) { photo = `photos/${workDate.slice(0, 7)}/${id}.jpg`; await store.putBlob(photo, unb64u(m2[2].replace(/\+/g, '-').replace(/\//g, '_')), m2[1]); } }
      const punch = { id, wid: w.id, code: w.code, name: w.name, type, ts, serverTs: t, workDate, lat, lng, acc, siteId: site?.id || '', siteName: site?.name || '', assignedSiteId: w.siteId || '', dist: match ? match.d : null, radius: match?.radius || null, inZone: !!match?.inZone, reliever, status: reasons.length ? 'pending' : 'accepted', reasons, flags, photo, clientId: b.clientId || '', deviceId: b.deviceId || '', by: by || 'worker', inId: inP?.id || '', hours, shift };
      await store.put('punches', punch);
      if (inP) { inP.outId = id; inP.serverTs = t; await store.put('punches', inP); }
      return J(200, { punch: strip(punch) });
    }

    const routes = {
      /* ---------- worker ---------- */
      'POST worker/login': async req => {
        const c = await cfg(), b = req.body || {};
        const w = await byCode(b.code); if (!w || !w.enabled) return err(403, 'This ID is not enabled for the app – ask your supervisor', 'NOT_ENABLED');
        if (w.lockUntil > now()) return err(423, `Too many wrong PINs – try again after ${dxbISO(w.lockUntil).slice(11, 16)}`, 'LOCKED');
        const h = await hashPin(b.pin, w.pinSalt);
        if (!w.pinHash || h.hash !== w.pinHash) {
          w.fails = (w.fails || 0) + 1; if (w.fails >= c.lockTries) { w.lockUntil = now() + c.lockMin * 60000; w.fails = 0; }
          await store.put('workers', w); return err(401, 'Wrong PIN', 'BAD_PIN');
        }
        if (c.bindDevice && w.deviceId && b.deviceId && w.deviceId !== b.deviceId) return err(403, 'This ID is registered on another phone – ask admin to reset the device', 'OTHER_DEVICE');
        w.fails = 0; w.lockUntil = 0; if (!w.deviceId && b.deviceId) w.deviceId = b.deviceId; w.lastLogin = now();
        await store.put('workers', w);
        const token = await signToken(secret, { sub: w.id, dev: w.deviceId || '', exp: now() + c.tokenHours * 3600000 });
        return J(200, { token, ...(await profile(w)) });
      },
      'GET worker/me': async req => { const w = await worker(req); return w ? J(200, await profile(w)) : err(401, 'Please sign in again', 'AUTH'); },
      'POST worker/punch': async req => { const w = await worker(req); if (!w) return err(401, 'Please sign in again', 'AUTH'); return doPunch(w, req.body || {}, 'worker'); },
      /* ---------- supervisor ---------- */
      'GET supervisor/board': async req => {
        if (!isSup(req)) return err(403, 'Supervisor role required');
        const today = dxbDate(now()), site = req.query?.site || '';
        const ws = await store.list('workers', w => w.enabled && (!site || w.siteId === site), { enabled: true });
        const ps = await store.list('punches', p => p.workDate === today && p.status !== 'rejected', { workDate: today });
        const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query?.date || '') ? req.query.date : today;
        const ps2 = date === today ? ps : await store.list('punches', p => p.workDate === date && p.status !== 'rejected', { workDate: date });
        const ms = await store.list('marks', m => m.date === date, { workDate: date });
        return J(200, { today, date, codes: MARK_CODES, sites: (await store.list('sites')).map(s => ({ id: s.id, name: s.name, project: s.project, pins: s.pins })), workers: ws.map(w => ({ id: w.id, code: w.code, name: w.name, shift: w.shift, siteId: w.siteId, punches: ps2.filter(p => p.wid === w.id).map(strip), mark: ms.find(m => m.wid === w.id) || null })) });
      },
      /** No check-in: the supervisor / admin decides what the day is (A, OFF, SL, AL …). Blank code clears the mark. */
      'POST supervisor/mark': async req => {
        if (!isSup(req)) return err(403, 'Supervisor role required');
        const b = req.body || {}, w = await byCode(b.code); if (!w) return err(404, 'Worker not found');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '')) return err(400, 'Date required');
        const code = String(b.mark || '').toUpperCase().trim();
        if (code && !MARK_CODES.some(c => c[0] === code)) return err(400, 'Unknown code ' + code);
        const id = w.id + '|' + b.date, old = await store.get('marks', id);
        const m = { id, wid: w.id, code: w.code, name: w.name, date: b.date, workDate: b.date, mark: code, note: String(b.note || '').slice(0, 200), by: req.principal?.userDetails || 'supervisor', at: now(), serverTs: now(), prev: old?.mark || '' };
        await store.put('marks', m); return J(200, { mark: m });
      },
      'POST supervisor/punch': async req => {
        if (!isSup(req)) return err(403, 'Supervisor role required');
        const w = await byCode(req.body?.code); if (!w || !w.enabled) return err(404, 'Worker not found');
        return doPunch(w, req.body, 'supervisor: ' + (req.principal?.userDetails || '?'));
      },
      /* ---------- admin ---------- */
      'PUT admin/roster': async req => {
        if (!isAdmin(req)) return err(403, 'Admin role required');
        const b = req.body || {}; const seen = new Set();
        for (const x of b.workers || []) {
          const old = await store.get('workers', x.id) || {};
          const w = { ...old, id: x.id, code: String(x.code || '').toUpperCase(), name: x.name, trade: x.trade || '', shift: x.shift || 'DAY', siteId: x.siteId || '', enabled: !!x.enabled, months: x.months || {} };
          if (x.pinHash) { w.pinHash = x.pinHash; w.pinSalt = x.pinSalt; w.fails = 0; w.lockUntil = 0; }
          if (x.resetDevice) w.deviceId = '';
          await store.put('workers', w); seen.add(w.id);
        }
        if (b.full) for (const w of await store.list('workers')) if (!seen.has(w.id) && w.enabled) { w.enabled = false; await store.put('workers', w); }
        if (b.sites) { const keep = new Set(b.sites.map(s => s.id)); for (const s of b.sites) await store.put('sites', { id: s.id, name: s.name, project: s.project || '', pins: (s.pins || []).map(p => ({ lat: +p.lat, lng: +p.lng, radius: Math.max(10, +p.radius || 100), label: p.label || '' })) }); for (const s of await store.list('sites')) if (!keep.has(s.id)) await store.del('sites', s.id); }
        if (b.settings) await store.put('config', { id: 'app', v: { ...((await store.get('config', 'app'))?.v || {}), ...b.settings } });
        return J(200, { workers: seen.size, sites: (b.sites || []).length });
      },
      'GET admin/punches': async req => {
        if (!isViewer(req)) return err(403, 'Role required');
        const since = +req.query?.since || 0;
        const ps = await store.list('punches', p => p.serverTs > since, { since });
        return J(200, { now: now(), punches: ps.map(strip).sort((a, b) => a.serverTs - b.serverTs) });
      },
      'POST admin/review': async req => {
        if (!isAdmin(req)) return err(403, 'Admin role required');
        const p = await store.get('punches', req.body?.id); if (!p) return err(404, 'Punch not found');
        p.status = req.body.status === 'rejected' ? 'rejected' : 'accepted'; p.reviewNote = String(req.body.note || '').slice(0, 300); p.reviewBy = req.principal?.userDetails || 'admin'; p.serverTs = now();
        await store.put('punches', p); return J(200, { punch: strip(p) });
      },
      'GET admin/photo': async req => {
        if (!isViewer(req)) return err(403, 'Role required');
        const p = await store.get('punches', req.query?.id); if (!p?.photo) return err(404, 'No photo');
        const b = await store.getBlob(p.photo); if (!b) return err(404, 'No photo');
        return { status: 200, bytes: b.bytes, type: b.type || 'image/jpeg' };
      },
      'GET admin/marks': async req => { if (!isViewer(req)) return err(403, 'Role required'); const since = +req.query?.since || 0; return J(200, { now: now(), marks: await store.list('marks', m => m.serverTs > since, { since }) }); },
      'GET health': async () => J(200, { ok: true, time: now() })
    };

    /** req: { method, path: 'worker/login', query, body, headers, principal } */
    async function handle(req) {
      const r = routes[`${req.method} ${String(req.path).replace(/^\/?(api\/)?/, '').replace(/\/$/, '')}`];
      if (!r) return err(404, 'Not found');
      try { return await r(req); } catch (e) { return err(500, 'Server error: ' + (e?.message || e)); }
    }
    return { handle, doPunch };
  }

  /** In-memory store (tests, dev server); optional persist(snapshot) hook */
  function memoryStore(init, persist) {
    const T = init?.tables || {}, B = init?.blobs || {};
    const tab = t => (T[t] ||= {});
    const save = () => persist?.({ tables: T, blobs: B });
    return {
      async get(t, id) { const x = tab(t)[id]; return x ? JSON.parse(JSON.stringify(x)) : null; },
      async put(t, o) { tab(t)[o.id] = JSON.parse(JSON.stringify(o)); await save(); },
      async del(t, id) { delete tab(t)[id]; await save(); },
      async list(t, f) { return Object.values(tab(t)).map(x => JSON.parse(JSON.stringify(x))).filter(x => !f || f(x)); },
      async putBlob(n, bytes, type) { B[n] = { b64: b64u(bytes), type }; await save(); },
      async getBlob(n) { const x = B[n]; return x ? { bytes: unb64u(x.b64), type: x.type } : null; },
      dump: () => ({ tables: T, blobs: B })
    };
  }

  return { create, memoryStore, hashPin, distance, nearestPin, dxbDate, DEFAULTS, MARK_CODES, b64u, unb64u };
})();
if (typeof module !== 'undefined') module.exports = LSAPI;
