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
  /** Descriptor of the clearest face in a Blob / URL, or null when no face is found */
  async function describe(src) {
    const f = await load(), url = typeof src === 'string' ? src : URL.createObjectURL(src);
    try {
      const im = await image(url), opt = new f.SsdMobilenetv1Options({ minConfidence: 0.4 });
      let d = await f.detectSingleFace(im, opt).withFaceLandmarks().withFaceDescriptor();
      if (!d) {                    // a close selfie (face fills the frame) is missed by the detector: retry with a margin around it
        const w = im.naturalWidth, h = im.naturalHeight, c = document.createElement('canvas'); c.width = w * 2; c.height = h * 2;
        const g = c.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, w / 2, h / 2);
        d = await f.detectSingleFace(c, opt).withFaceLandmarks().withFaceDescriptor();
      }
      return d ? Array.from(d.descriptor, x => Math.round(x * 1e4) / 1e4) : null;
    } finally { if (typeof src !== 'string') URL.revokeObjectURL(url); }
  }
  const dist = (a, b) => Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0));
  /** distance → 0-100 score (about 73 at the match threshold) */
  const score = d => Math.max(0, Math.round(100 * (1 - d * d)));
  // distances measured on sample photos: same person 0.47–0.50, different people 0.59 and above
  const MATCH = 0.52, UNSURE = 0.58;
  const verdict = d => d == null ? null : d <= MATCH ? 'match' : d <= UNSURE ? 'unsure' : 'different';
  const badge = f => {
    if (!f) return ''; if (f.none) return '<span class="pill" title="No face found in the check-in photo">no face</span>';
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
/** Store a reference photo for a person (e = the record being edited); returns 'face' | 'noface' */
async function setPersonPhoto(e, file) {
  const b = await shrinkPhoto(file), id = 'ph-' + e.id;
  await Files.put(id, b);
  e.photo = { id, at: new Date().toISOString() };
  let v = null; try { v = await FACE.describe(b); } catch (x) { toast(x.message, 6000); }
  e.face = v; return v ? 'face' : 'noface';
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
  let checked = 0, approved = 0, mismatch = 0;
  try {
    const from = addDays(todayISO(), -14);
    const todo = Object.values(S.punches || {}).filter(p => p.hasPhoto && !p.face && p.workDate >= from && p.status !== 'rejected' && IX.emp.get(p.wid)?.face).sort((a, b) => b.ts - a.ts).slice(0, 60);
    if (!todo.length) return;
    const cl = appClient();
    for (const p of todo) {
      const r = await cl.call('GET', 'admin/photo', null, { query: { id: p.id } }); if (!r.blob) continue;
      const v = await FACE.describe(r.blob); checked++;
      if (!v) { p.face = { none: true, at: Date.now() }; continue; }
      const d = Math.round(FACE.dist(v, IX.emp.get(p.wid).face) * 1000) / 1000; p.face = { d, at: Date.now() };
      const vd = FACE.verdict(d); if (vd === 'different') mismatch++;
      if (vd === 'match' && p.status === 'pending' && p.inZone && c.faceAuto !== false) { await reviewPunch(p.id, 'accepted', `Auto-approved: face matches (${FACE.score(d)}%) and inside the zone`); approved++; }
    }
  } catch (e) { if (!quiet) toast(e.message, 6000); }
  finally {
    FACE_RUN = false;
    if (checked) { markDirty(); renderAll(); if (!quiet || approved || mismatch) toast(`Face check · ${checked} photo(s) · ${approved} auto-approved${mismatch ? ` · ${mismatch} different face – see Insights` : ''}`, 6000); }
  }
}
