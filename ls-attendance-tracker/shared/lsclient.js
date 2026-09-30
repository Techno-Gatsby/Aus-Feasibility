/* =====================================================================
   API client for both pages. With an API address (Azure) it calls fetch;
   without one it runs the same LSAPI core in the browser against a demo
   store in IndexedDB, shared by the two pages opened in one browser.
   ===================================================================== */
const LSClient = (() => {
  const DB = 'ls-worker-demo', KEY = 'store';
  const idb = () => new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const idbGet = async k => { const db = await idb(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); };
  const idbSet = async (k, v) => { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); };
  let chain = Promise.resolve();                       // serialise demo calls (load → handle → save)

  /** role: principal used in demo mode ('admin' for the tracker, 'supervisor' for the phone's supervisor screen) */
  function make({ base = '', role = '' } = {}) {
    base = String(base || '').trim().replace(/\/+$/, '');
    const demo = !base;
    async function demoCall(method, path, body, opt) {
      const run = async () => {
        const snap = await idbGet(KEY);
        let dirty = false;
        const store = LSAPI.memoryStore(snap, () => { dirty = true; });
        const api = LSAPI.create({ store, secret: 'ls-demo-secret' });
        const r = await api.handle({ method, path, body, query: opt.query || {}, headers: opt.token ? { authorization: 'Bearer ' + opt.token } : {}, principal: (opt.role || role) ? { userRoles: [opt.role || role], userDetails: 'demo ' + (opt.role || role) } : null });
        if (dirty) await idbSet(KEY, store.dump());
        return r;
      };
      const p = chain.then(run, run); chain = p.catch(() => {}); return p;
    }
    async function call(method, path, body, opt = {}) {
      if (demo) { const r = await demoCall(method, path, body, opt); if (r.bytes) return { status: r.status, blob: new Blob([r.bytes], { type: r.type }) }; return r; }
      const q = opt.query ? '?' + new URLSearchParams(opt.query) : '';
      const res = await fetch(`${base}/${path}${q}`, { method, credentials: 'include', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(opt.token ? { Authorization: 'Bearer ' + opt.token } : {}) }, body: body ? JSON.stringify(body) : undefined });
      if ((res.headers.get('content-type') || '').startsWith('image/')) return { status: res.status, blob: await res.blob() };
      let j = null; try { j = await res.json(); } catch (e) { j = { error: res.statusText }; }
      return { status: res.status, body: j };
    }
    return { call, demo, base };
  }
  return { make, resetDemo: () => idbSet(KEY, null) };
})();
