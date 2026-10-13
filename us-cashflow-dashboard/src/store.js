// Saving: uploaded model figures, project-detail edits and added photos.
// Shared through the artifact's `db` when the page runs as a published artifact (everyone
// with the link sees the latest upload); otherwise kept in this browser.
//
// db layout
//   plans/current                 pointer to the figures in use: {id, chunks, files, refreshed, at, by} (id null = original figures)
//   plans/<id>/chunks/<n>         the figures as JSON, split into pieces under the 256 KiB document limit
//   details/<project>             edits to one project's details: {project, fields, entities, photoCaptions, hiddenPhotos, at, by}
//   photos/<id>                   an added photo: {project, caption, kind, order, image (JPEG data URL), at, by}
(function () {
  'use strict';
  const CHUNK = 200000; // characters; JSON is written ASCII-only, so also bytes
  const LS = { plan: 'sobha_plan_v1', details: 'sobha_details_v1', photos: 'sobha_photos_v1' };
  const docId = (s) => String(s).replace(/[^A-Za-z0-9_\-.~:@+]/g, '_').slice(0, 180);
  const ascii = (s) => s.replace(/[\u007f-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  const lsGet = (k) => { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };

  const subs = [];
  const S = window.SobhaStore = {
    mode: 'init',          // 'shared' | 'local' | 'memory'
    canWrite: true,
    me: null,              // viewer id (shared mode)
    plan: null,            // {meta, data} of the uploaded figures in use; null = original figures
    planLoading: false,
    details: {},           // project -> edits
    photos: [],            // added photos
    message: '',
    onChange(fn) { subs.push(fn); },
    // Original figures, the uploaded ones when present, then project-detail edits on top.
    effective() { return applyDetails((S.plan && S.plan.data) || window.__BASELINE, S.details, S.photos); },
    modelData() { return (S.plan && S.plan.data) || window.__BASELINE; },
  };
  let db = null, user = null, downloads = null, planId = null;
  const notify = () => { window.dash && dash.setData(S.effective()); subs.forEach((f) => { try { f(); } catch (e) { console.error(e); } }); };

  // ---- project-detail edits applied to the data ----------------------------------------
  // Edits win over model values field by field; clearing an edit shows the model value again.
  function applyDetails(data, details, photos) {
    const out = Object.assign({}, data);
    const has = (o) => o && Object.keys(o).length;
    if (Object.keys(details).length) {
      out.project_profile = (data.project_profile || []).map((r) => (has((details[r.project] || {}).fields) ? Object.assign({}, r, details[r.project].fields) : r));
      // A project with edits but no profile row yet (a new project in the models).
      for (const [p, d] of Object.entries(details)) if (has(d.fields) && !out.project_profile.some((r) => r.project === p)) out.project_profile.push(Object.assign({ project: p, report_name: p, location: '', status: '', note: '' }, d.fields));
      out.project_entity = (data.project_entity || []).map((r) => { const e = ((details[r.project] || {}).entities || {})[r.entity]; return has(e) ? Object.assign({}, r, e) : r; });
      // Project counts on the KPI tiles follow the (possibly edited) statuses.
      const status = {}; out.project_profile.forEach((r) => (status[r.project] = r.status));
      out.kpi_extra = (data.kpi_extra || []).map((r) => (r.project !== 'All Projects' && r.project in status ? Object.assign({}, r, { status: status[r.project] }) : r));
      out.kpi_extra = out.kpi_extra.map((r) => {
        if (r.project !== 'All Projects') return r;
        // Only projects with units or costs in this entity count (as in derive-kpi.js).
        const ps = out.kpi_extra.filter((x) => x.entity === r.entity && x.project !== 'All Projects' && (x.units || x.dev_cost)).map((x) => status[x.project]);
        const n = (re) => ps.filter((s) => re.test(String(s || ''))).length;
        return Object.assign({}, r, { n_confirmed: n(/^confirmed/i), n_consider: n(/consideration/i), n_pipeline: n(/^pipeline/i) });
      });
    }
    const base = (data.project_photos || []).map((r) => {
      const d = details[r.project] || {};
      if ((d.hiddenPhotos || []).includes(r.key)) return null;
      const cap = (d.photoCaptions || {})[r.key];
      return cap ? Object.assign({}, r, { caption: cap }) : r;
    }).filter(Boolean);
    const added = photos.map((p) => ({ key: 'added|' + p.id, project: p.project, order: 1000 + (p.order || 0), kind: p.kind || 'model', caption: p.caption || '', image: p.image, source: 'Added on the dashboard', added: p.id }));
    out.project_photos = base.concat(added);
    return out;
  }
  S.applyDetails = applyDetails;

  // ---- start-up ------------------------------------------------------------------------
  async function init() {
    const c = window.claude;
    try { db = c && c.use ? await c.use('db') : null; } catch (e) { db = null; }
    try { user = c && c.use ? await c.use('user') : null; } catch (e) { user = null; }
    try { downloads = c && c.use ? await c.use('downloads') : null; } catch (e) { downloads = null; }
    if (db) {
      S.mode = 'shared';
      if (user) {
        S.me = await user.id();
        const w = await user.can('data.write');
        S.canWrite = w !== false; // null = not told: keep the controls, a refused write decides
      }
      watchShared();
    } else {
      const ok = lsSet('sobha_probe', 1); lsSet('sobha_probe', null);
      S.mode = ok ? 'local' : 'memory';
      S.plan = lsGet(LS.plan);
      S.details = lsGet(LS.details) || {};
      S.photos = lsGet(LS.photos) || [];
    }
    notify();
  }

  function watchShared() {
    db.doc('plans/current').onSnapshot(async (snap) => {
      const meta = snap.exists ? snap.data() : null;
      if (!meta || !meta.id) { planId = null; S.plan = null; notify(); return; }
      if (planId === meta.id && S.plan) { S.plan = { meta, data: S.plan.data }; notify(); return; }
      planId = meta.id;
      S.planLoading = true; notify();
      try {
        const data = await readChunks(meta);
        if (planId !== meta.id) return; // a newer upload arrived meanwhile
        S.plan = { meta, data };
      } catch (e) {
        S.message = 'The latest uploaded figures could not be loaded (' + (e.message || e.code) + '). Showing the previous figures.';
      }
      S.planLoading = false; notify();
    }, (e) => { S.message = 'Uploaded figures are unavailable right now.'; notify(); });
    db.collection('details').onSnapshot((snap) => {
      const d = {}; snap.docs.forEach((x) => { const v = x.data(); if (v && v.project) d[v.project] = v; });
      S.details = d; notify();
    }, () => {});
    db.collection('photos').onSnapshot((snap) => {
      S.photos = snap.docs.map((x) => Object.assign({ id: x.id }, x.data())).filter((p) => p.project && p.image);
      notify();
    }, () => {});
  }

  async function readChunks(meta) {
    const snap = await db.collection('plans/' + meta.id + '/chunks').get();
    const parts = snap.docs.map((d) => d.data()).sort((a, b) => a.n - b.n);
    if (parts.length !== meta.chunks) throw new Error('incomplete upload');
    return JSON.parse(parts.map((p) => p.s).join(''));
  }

  // ---- writes --------------------------------------------------------------------------
  const refused = (e) => e && e.code === 'invalid_argument';
  function fail(e, what) {
    if (refused(e)) { S.canWrite = false; S.message = 'You can view this dashboard but not change it.'; }
    else if (e && e.code === 'quota_exceeded') S.message = what + ' could not be saved: the dashboard’s storage is full. Remove some added photos and try again.';
    else S.message = what + ' could not be saved' + (e && e.message ? ': ' + e.message : '') + '.';
    notify();
    throw e;
  }
  const stamp = () => ({ at: new Date().toISOString(), by: S.me || null });

  // Save uploaded figures (photos excluded: they stay with the page and the photo edits).
  S.savePlan = async function (data, info) {
    const body = Object.assign({}, data); delete body.project_photos;
    const meta = Object.assign({ files: info.files || [], refreshed: info.refreshed || [], kept: info.kept || [] }, stamp());
    if (S.mode !== 'shared') {
      const plan = { meta: Object.assign({ id: 'local' }, meta), data: body };
      S.plan = plan;
      if (S.mode === 'local' && !lsSet(LS.plan, plan)) S.message = 'Applied for this session only: the browser would not store the figures.';
      notify(); return;
    }
    const json = ascii(JSON.stringify(body));
    const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const n = Math.ceil(json.length / CHUNK);
    try {
      for (let i = 0; i < n; i++) await db.doc(`plans/${id}/chunks/${i}`).set({ n: i, s: json.slice(i * CHUNK, (i + 1) * CHUNK) });
      const prev = await db.doc('plans/current').get();
      await db.doc('plans/current').set(Object.assign({ id, chunks: n }, meta));
      planId = id; S.plan = { meta: Object.assign({ id, chunks: n }, meta), data: body }; notify();
      // Keep the previous upload (for a quick look back); delete the one before it.
      const old = prev.exists ? prev.data() : null;
      const keep = await db.doc('plans/history').get();
      const hist = (keep.exists && keep.data().ids) || [];
      if (old && old.id) hist.unshift({ id: old.id, chunks: old.chunks });
      for (const h of hist.slice(1)) for (let i = 0; i < (h.chunks || 0); i++) await db.doc(`plans/${h.id}/chunks/${i}`).delete();
      await db.doc('plans/history').set({ ids: hist.slice(0, 1) });
    } catch (e) { fail(e, 'The figures'); }
  };

  S.revertPlan = async function () {
    if (S.mode !== 'shared') { S.plan = null; lsSet(LS.plan, null); notify(); return; }
    try { await db.doc('plans/current').set(Object.assign({ id: null, chunks: 0 }, stamp())); } catch (e) { fail(e, 'The change'); }
  };

  // rec: {fields, entities, photoCaptions, hiddenPhotos}; empty objects clear edits.
  S.saveDetails = async function (project, rec) {
    const clean = (o) => { const r = {}; Object.entries(o || {}).forEach(([k, v]) => { if (v !== undefined) r[k] = v; }); return r; };
    const body = Object.assign({ project, fields: clean(rec.fields), entities: rec.entities || {}, photoCaptions: rec.photoCaptions || {}, hiddenPhotos: rec.hiddenPhotos || [] }, stamp());
    const empty = !Object.keys(body.fields).length && !Object.values(body.entities).some((e) => Object.keys(e || {}).length) && !Object.keys(body.photoCaptions).length && !body.hiddenPhotos.length;
    if (S.mode !== 'shared') {
      if (empty) delete S.details[project]; else S.details[project] = body;
      if (S.mode === 'local' && !lsSet(LS.details, S.details)) S.message = 'Saved for this session only: the browser would not store the edits.';
      notify(); return;
    }
    try { if (empty) await db.doc('details/' + docId(project)).delete(); else await db.doc('details/' + docId(project)).set(body); }
    catch (e) { fail(e, 'The project details'); }
  };

  S.addPhoto = async function (project, photo) {
    const rec = Object.assign({ project, caption: photo.caption || '', kind: photo.kind || 'model', order: Date.now() % 1e9, image: photo.image }, stamp());
    if (S.mode !== 'shared') {
      S.photos = S.photos.concat([Object.assign({ id: 'l' + Date.now().toString(36) }, rec)]);
      if (S.mode === 'local' && !lsSet(LS.photos, S.photos)) { S.photos.pop(); S.message = 'The photo is too large for this browser’s storage.'; }
      notify(); return;
    }
    try { await db.collection('photos').add(rec); } catch (e) { fail(e, 'The photo'); }
  };
  S.updatePhoto = async function (id, patch) {
    if (S.mode !== 'shared') { S.photos = S.photos.map((p) => (p.id === id ? Object.assign({}, p, patch) : p)); lsSet(LS.photos, S.photos); notify(); return; }
    try { await db.doc('photos/' + id).update(patch); } catch (e) { fail(e, 'The photo'); }
  };
  S.removePhoto = async function (id) {
    if (S.mode !== 'shared') { S.photos = S.photos.filter((p) => p.id !== id); lsSet(LS.photos, S.photos); notify(); return; }
    try { await db.doc('photos/' + id).delete(); } catch (e) { fail(e, 'The photo'); }
  };

  // Names for the people in saved records ("uploaded by …").
  S.names = async function (ids) {
    const list = [...new Set(ids.filter(Boolean))];
    if (!user || !list.length) return {};
    const ps = await user.profiles(list); const out = {};
    list.forEach((id) => (out[id] = (ps[id] && ps[id].name) || ''));
    return out;
  };

  // Offer a generated file. In the artifact viewer only the downloads capability can save;
  // a copy opened from disk uses an ordinary download link.
  S.saveFile = async function (filename, text) {
    if (downloads) { await downloads.save({ filename, data: new Blob([text], { type: 'text/html' }) }); return 'saved'; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/html' }));
    a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return 'saved';
  };
  S.canDownload = () => !!downloads || !window.claude;

  init();
})();
