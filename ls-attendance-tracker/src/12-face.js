/* =====================================================================
   Face check: personnel reference photos and matching of check-in photos.
   Open-source model: @vladmandic/face-api (maintained face-api.js, MIT) –
   SSD MobileNet v1 face detector, 68-point landmarks, ResNet-34 face
   descriptor (128 numbers, 99.38% on the LFW benchmark). Runs in this
   browser; photos are not sent anywhere.
   ===================================================================== */
const FACE = (() => {
  const CDN = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/';
  let ready = null;
  function load() {
    return ready ||= (async () => {
      const f = await import(CDN + 'dist/face-api.esm.js');
      await f.tf.ready();
      const M = CDN + 'model/';
      await Promise.all([f.nets.ssdMobilenetv1.loadFromUri(M), f.nets.faceLandmark68Net.loadFromUri(M), f.nets.faceRecognitionNet.loadFromUri(M)]);
      return f;
    })().catch(e => { ready = null; throw new Error('Face check could not load (internet connection needed): ' + e.message); });
  }
  const image = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Image could not be read')); im.src = src; });
  const canvasOf = (im, w, h, pad, flip) => {
    const c = document.createElement('canvas'); c.width = w * (pad ? 2 : 1); c.height = h * (pad ? 2 : 1); const g = c.getContext('2d');
    if (pad) { g.fillStyle = '#808080'; g.fillRect(0, 0, c.width, c.height); }
    if (flip) { g.translate(c.width, 0); g.scale(-1, 1); }
    g.drawImage(im, pad ? w / 2 : 0, pad ? h / 2 : 0, w, h); return c;
  };
  /** The clearest face in a Blob / URL → { v: 128 numbers, q: { score, size, faces } } or null.
      Accuracy: the photo is read as is and mirrored and the two descriptors are averaged; a close selfie the
      detector misses (face fills the frame) is retried with a margin around it. */
  async function describe(src, { flip = true } = {}) {
    const f = await load(), url = typeof src === 'string' ? src : URL.createObjectURL(src);
    try {
      const im = await image(url), w = im.naturalWidth, h = im.naturalHeight, opt = new f.SsdMobilenetv1Options({ minConfidence: 0.4 });
      let pad = false, all = await f.detectAllFaces(im, opt);
      if (!all.length) { pad = true; all = await f.detectAllFaces(canvasOf(im, w, h, true, false), opt); }
      if (!all.length) return null;
      const one = async c => (await f.detectSingleFace(c, opt).withFaceLandmarks().withFaceDescriptor())?.descriptor;
      const d1 = await one(canvasOf(im, w, h, pad, false)); if (!d1) return null;
      const d2 = flip ? await one(canvasOf(im, w, h, pad, true)) : null;
      const v = Array.from(d1, (x, i) => Math.round((d2 ? (x + d2[i]) / 2 : x) * 1e4) / 1e4);
      const best = all.reduce((a, b) => b.score > a.score ? b : a);
      return { v, q: { score: Math.round(best.score * 100) / 100, size: Math.round(Math.min(best.box.width, best.box.height) / (pad ? 1 : 1)), faces: all.length } };
    } finally { if (typeof src !== 'string') URL.revokeObjectURL(url); }
  }
  const dist = (a, b) => Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0));
  /** distance → 0-100 score (about 73 at the match threshold) */
  const score = d => Math.max(0, Math.round(100 * (1 - d * d)));
  // calibrated on 300 labelled pairs (deepface test set) + sample photos: same person ≤ 0.53, different people ≥ 0.59.
  // At 0.52: 99.7% correct, 0% wrong person accepted, 2.6% right person sent to review.
  const MATCH = 0.52, UNSURE = 0.58;
  const verdict = d => d == null ? null : d <= MATCH ? 'match' : d <= UNSURE ? 'unsure' : 'different';
  const badge = f => {
    if (!f) return ''; if (f.none || f.poor) return `<span class="pill warn" title="${esc(f.why || 'No face found in the check-in photo')}">${f.none ? 'no face' : 'unclear face'}</span>`;
    const v = verdict(f.d); return `<span class="pill ${v === 'match' ? 'pos' : v === 'unsure' ? 'warn' : 'neg'}" title="Face distance ${f.d} (match ≤ ${MATCH})">${v === 'match' ? '✓ face' : v === 'unsure' ? '? face' : '✕ face'} ${score(f.d)}%</span>`;
  };
  return { load, describe, dist, score, verdict, badge, MATCH, UNSURE };
})();

const initials = n => String(n || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
/** Downscale a photo to max 480 px JPEG (keeps the backup small) */
async function shrinkPhoto(file) {
  const u = URL.createObjectURL(file);
  try {
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u; });
    const k = Math.min(1, 480 / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement('canvas');
    c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    return await new Promise(res => c.toBlob(res, 'image/jpeg', .85));
  } finally { URL.revokeObjectURL(u); }
}
/** Reference faces of a person: uploaded photos (up to 3) + faces learned from clearly matching check-ins (up to 3) */
const faceRefs = e => [...(e?.faces || (e?.face ? [e.face] : [])), ...(e?.facesLearned || [])];
const faceDist = (e, v) => { const r = faceRefs(e); return r.length ? Math.min(...r.map(x => FACE.dist(v, x))) : null; };
/** Store a reference photo (e = the record being edited). add = keep earlier photos (up to 3). Returns 'face' | 'noface' | 'many' */
async function setPersonPhoto(e, file, add = false) {
  const b = await shrinkPhoto(file), id = 'ph-' + e.id + (add && e.photo ? '-' + Date.now().toString(36) : '');
  await Files.put(id, b);
  let r = null; try { r = await FACE.describe(b); } catch (x) { toast(x.message, 6000); }
  if (!add || !e.photo) e.photo = { id, at: new Date().toISOString() };
  if (!r) return 'noface';
  e.faces = [...(add ? faceRefs({ faces: e.faces, face: e.face }) : []), r.v].slice(-3); e.face = e.faces[0];
  if (!add) e.facesLearned = [];
  return r.q.faces > 1 ? 'many' : 'face';
}
async function photoURL(e) { if (!e?.photo) return ''; const b = await Files.get(e.photo.id); return b ? URL.createObjectURL(b) : ''; }

/** Bulk: image files named by Emp ID (C52392.jpg, C52392 - Name.png …) */
async function bulkPhotos(files) {
  const byCode = new Map(S.employees.map(e => [String(e.empCode || '').toUpperCase(), e]));
  const res = { ok: 0, noface: [], unknown: [] };
  toast(`Reading ${files.length} photo(s)…`, 3000);
  for (const f of files) {
    const code = (f.name.toUpperCase().match(/[A-Z]{0,3}\d{4,}/) || [''])[0], e = byCode.get(code);
    if (!e) { res.unknown.push(f.name); continue; }
    (await setPersonPhoto(e, f)) === 'face' ? res.ok++ : res.noface.push(`${e.name} (${f.name})`);
  }
  reindex(); markDirty(); renderAll();
  openModal('Photos uploaded', `<p><b>${res.ok}</b> photo(s) saved with a recognisable face.</p>
    ${res.noface.length ? `<p class="warn">No face found – use a clear, front-facing photo:<br>${res.noface.map(esc).join('<br>')}</p>` : ''}
    ${res.unknown.length ? `<p class="muted">No Emp ID matched these file names:<br>${res.unknown.map(esc).join('<br>')}</p>` : ''}`, [{ label: 'Close', cls: 'pri' }]);
}

/** Compare check-in photos with the person's reference face; approve pending punches that match and are inside the zone */
let FACE_RUN = false;
async function faceCheckPunches(quiet = true) {
  const c = appCfg(); if (FACE_RUN || c.faceCheck === false) return; FACE_RUN = true;
  let checked = 0, approved = 0, mismatch = 0, toReview = 0;
  try {
    const from = addDays(todayISO(), -14);
    const todo = Object.values(S.punches || {}).filter(p => p.hasPhoto && !p.face && p.workDate >= from && p.status !== 'rejected' && faceRefs(IX.emp.get(p.wid)).length).sort((a, b) => b.ts - a.ts).slice(0, 60);
    if (!todo.length) return;
    const cl = appClient();
    for (const p of todo) {
      const r = await cl.call('GET', 'admin/photo', null, { query: { id: p.id } }); if (!r.blob) continue;
      const e = IX.emp.get(p.wid), x = await FACE.describe(r.blob); checked++;
      // quality gate: one clear face, big enough to compare
      const why = !x ? 'no face in the photo' : x.q.faces > 1 ? 'more than one face in the photo' : x.q.score < 0.45 || x.q.size < 60 ? 'face not clear in the photo' : '';
      if (why) p.face = { none: !x, poor: !!x, why, at: Date.now() };
      else {
        const d = Math.round(faceDist(e, x.v) * 1000) / 1000; p.face = { d, at: Date.now() };
        const vd = FACE.verdict(d);
        if (vd === 'match') {
          if (d <= 0.4 && x.q.score >= 0.9) { e.facesLearned = [...(e.facesLearned || []), x.v].slice(-3); }      // learns how the person looks on site
          if (p.status === 'pending' && p.inZone && c.faceAuto !== false) { await reviewPunch(p.id, 'accepted', `Auto-approved: face matches (${FACE.score(d)}%) and inside the zone`); approved++; }
          continue;
        }
        mismatch++;
      }
      // failed face check: to Punches to review (the day stays open – never marked absent automatically)
      if (c.faceReview !== false && p.type === 'in') {
        const reason = p.face.why || (FACE.verdict(p.face.d) === 'unsure' ? `face check unsure (${FACE.score(p.face.d)}%)` : `face does not match (${FACE.score(p.face.d)}%)`);
        if (p.status === 'accepted' && !/^Approved/.test(p.reviewNote || '') && !p.reviewBy) { await reviewPunch(p.id, 'pending', 'Face check', reason); toReview++; }
        else if (p.status === 'pending' && !p.reasons?.includes(reason)) p.reasons = [...(p.reasons || []), reason];
      }
    }
  } catch (e) { if (!quiet) toast(e.message, 6000); }
  finally {
    FACE_RUN = false;
    if (checked) { markDirty(); renderAll(); if (!quiet || approved || mismatch) toast(`Face check · ${checked} photo(s) · ${approved} auto-approved${toReview ? ` · ${toReview} sent to Punches to review` : ''}${mismatch ? ` · ${mismatch} not matching` : ''}`, 6000); }
  }
}
