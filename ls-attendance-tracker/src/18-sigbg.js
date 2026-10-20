/* =====================================================================
   Signature images: background removal and saved signatures.
   - removeSigBg(): turns a photo or scan of a signature into ink on a
     transparent background. Engine: OpenCV.js (loaded when first
     needed); without internet the same steps run in plain JS below.
       1. grey  2. divide by a blurred "paper" estimate (removes shadows
       and uneven light)  3. adaptive threshold  4. drop specks
       5. crop to the ink  6. transparent PNG in the chosen ink colour
     AI background removers (made for people/objects in photos) lose
     thin pen strokes, so this is the scanner-app approach instead.
   - Saved signature: S.sigPresets[email] = { image, updatedAt }, shared
     through the API (me/signature) so it is the same on every PC.
   ===================================================================== */
const SIG_MAX = [600, 200];
const SIGCV = { cv: null, p: null, failed: false };
/** loads OpenCV.js into SIGCV.cv; resolves true/false (never the module itself: it is "thenable", and resolving a promise with it never ends) */
function sigOpenCV() {
  if (SIGCV.cv || SIGCV.failed) return Promise.resolve(!!SIGCV.cv);
  return SIGCV.p ||= (async () => {
    try {
      await loadScript(LIB.opencv);
      let c = window.cv;
      if (!c?.Mat && typeof c?.then === 'function') c = (await new Promise(r => c.then(m => r({ m })))).m;   // wrapped: the module is itself "thenable"
      if (!c?.Mat) await new Promise((res, rej) => { c.onRuntimeInitialized = res; setTimeout(() => rej(new Error('timeout')), 30000); });
      SIGCV.cv = c; return true;
    } catch (e) { SIGCV.failed = true; return false; }
  })();
}
const sigEngine = () => SIGCV.cv ? 'OpenCV' : SIGCV.failed ? 'basic (offline)' : 'basic – OpenCV loading…';
const odd = n => (n | 0) | 1;

/** grey + "paper" estimate per pixel → normalised 0..255 where paper ≈ 255 */
function sigNormJS(g, w, h) {
  const B = Math.max(8, Math.round(Math.max(w, h) / 40)), bw = Math.ceil(w / B), bh = Math.ceil(h / B), mx = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {        // brightest pixels of each block ≈ paper (ink is dark)
    const hist = new Uint32Array(256); let n = 0;
    for (let y = by * B; y < Math.min(h, by * B + B); y++) for (let x = bx * B; x < Math.min(w, bx * B + B); x++) { hist[g[y * w + x]]++; n++; }
    let k = 0, v = 255; for (; v > 0; v--) { k += hist[v]; if (k >= n * 0.1) break; }
    mx[by * bw + bx] = v;
  }
  const sm = new Float32Array(bw * bh);                                       // smooth the block grid
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { let s = 0, c = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < bh && xx >= 0 && xx < bw) { s += mx[yy * bw + xx]; c++; } } sm[y * bw + x] = Math.max(mx[y * bw + x], s / c); }
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(bh - 1, Math.max(0, (y + .5) / B - .5)), y0 = fy | 0, y1 = Math.min(bh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(bw - 1, Math.max(0, (x + .5) / B - .5)), x0 = fx | 0, x1 = Math.min(bw - 1, x0 + 1), tx = fx - x0;
      const bg = (sm[y0 * bw + x0] * (1 - tx) + sm[y0 * bw + x1] * tx) * (1 - ty) + (sm[y1 * bw + x0] * (1 - tx) + sm[y1 * bw + x1] * tx) * ty;
      out[y * w + x] = g[y * w + x] / Math.max(1, bg) * 255;
    }
  }
  return out;
}
/** Sauvola local threshold on the normalised image (integral images) */
function sigThreshJS(n, w, h, strength) {
  const r = Math.max(7, Math.round(Math.min(w, h) / 25)), k = 0.36 - strength * 0.003, W = w + 1;
  const I = new Float64Array(W * (h + 1)), I2 = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) { let s = 0, s2 = 0; for (let x = 0; x < w; x++) { const v = n[y * w + x]; s += v; s2 += v * v; I[(y + 1) * W + x + 1] = I[y * W + x + 1] + s; I2[(y + 1) * W + x + 1] = I2[y * W + x + 1] + s2; } }
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const a = Math.max(0, y - r), b = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const c = Math.max(0, x - r), d = Math.min(w, x + r + 1), cnt = (b - a) * (d - c);
      const s = I[b * W + d] - I[a * W + d] - I[b * W + c] + I[a * W + c], s2 = I2[b * W + d] - I2[a * W + d] - I2[b * W + c] + I2[a * W + c];
      const mean = s / cnt, sd = Math.sqrt(Math.max(0, s2 / cnt - mean * mean));
      m[y * w + x] = n[y * w + x] < mean * (1 + k * (sd / 128 - 1)) ? 1 : 0;
    }
  }
  return m;
}
/** the same two steps with OpenCV: divide by a closed+blurred background, then adaptive Gaussian threshold */
function sigCV(cv, g, w, h, strength) {
  const src = cv.matFromArray(h, w, cv.CV_8UC1, g), bg = new cv.Mat(), norm = new cv.Mat(), th = new cv.Mat();
  try {
    cv.medianBlur(src, src, 3);                                              // camera noise, strongest in shadows
    const kz = odd(Math.max(9, Math.round(Math.max(w, h) / 40))), ker = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(kz, kz));
    cv.morphologyEx(src, bg, cv.MORPH_CLOSE, ker); ker.delete();             // ink removed → paper only
    cv.GaussianBlur(bg, bg, new cv.Size(odd(kz * 2), odd(kz * 2)), 0);
    cv.divide(src, bg, norm, 255);
    const bs = odd(Math.max(15, Math.round(Math.min(w, h) / 12)));
    cv.adaptiveThreshold(norm, th, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, bs, 14 - strength * 0.12);
    return { n: Uint8ClampedArray.from(norm.data), m: Uint8Array.from(th.data, v => v ? 1 : 0) };
  } finally { src.delete(); bg.delete(); norm.delete(); th.delete(); }
}
/** drop specks: connected ink pieces smaller than minA pixels */
function sigDespeck(m, w, h, minA) {
  const seen = new Uint8Array(w * h), st = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!m[i] || seen[i]) continue;
    let top = 0, len = 0; st[top++] = i; seen[i] = 1; const comp = [];
    while (top) { const p = st[--top]; comp.push(p); len++; const x = p % w, y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const q = yy * w + xx; if (m[q] && !seen[q]) { seen[q] = 1; st[top++] = q; } } }
    if (len < minA) for (const p of comp) m[p] = 0;
  }
  return m;
}
/** image → ink mask; opts: { strength 0..100 (higher keeps fainter ink), engine 'auto'|'js' } */
function sigMask(img, opts = {}) {
  const { data, width: w, height: h } = img, g = new Uint8ClampedArray(w * h), strength = opts.strength ?? 50;
  for (let i = 0; i < w * h; i++) { const a = data[i * 4 + 3] / 255; g[i] = (data[i * 4] * .299 + data[i * 4 + 1] * .587 + data[i * 4 + 2] * .114) * a + 255 * (1 - a); }
  let n, m;
  if (SIGCV.cv && opts.engine !== 'js') ({ n, m } = sigCV(SIGCV.cv, g, w, h, strength));
  else { n = sigNormJS(g, w, h); m = sigThreshJS(n, w, h, strength); }
  const cut = 236 - (100 - strength) * 0.5;                                   // paper after normalising is ~255: never ink
  for (let i = 0; i < w * h; i++) if (n[i] > cut) m[i] = 0;
  sigDespeck(m, w, h, Math.max(6, Math.round(w * h / 40000)));
  return { m, n };
}
/** image (img/canvas/ImageBitmap) → transparent PNG data URL of the ink, cropped and fitted to 600×200 */
function removeSigBg(src, opts = {}) {
  const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height, f = Math.min(1, 1600 / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * f)), h = Math.max(1, Math.round(sh * f));
  const c = document.createElement('canvas'); c.width = w; c.height = h; const cx = c.getContext('2d', { willReadFrequently: true });
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); cx.drawImage(src, 0, 0, w, h);
  const img = cx.getImageData(0, 0, w, h), { m, n } = sigMask(img, opts), d = img.data;
  const ink = opts.ink === 'black' ? [17, 17, 17] : opts.ink === 'blue' ? [22, 52, 150] : null;
  let lo = 255; for (let i = 0; i < w * h; i++) if (m[i] && n[i] < lo) lo = n[i];
  const span = Math.max(30, 200 - lo);
  for (let i = 0; i < w * h; i++) {
    if (!m[i]) { d[i * 4 + 3] = 0; continue; }
    const a = Math.min(1, Math.max(.35, (235 - n[i]) / span));              // soft edges: faint ink is partly see-through
    if (ink) { d[i * 4] = ink[0]; d[i * 4 + 1] = ink[1]; d[i * 4 + 2] = ink[2]; }
    else { const k = Math.min(1, n[i] / 255); for (let j = 0; j < 3; j++) d[i * 4 + j] = d[i * 4 + j] * (0.55 + 0.45 * k); }   // original colour, a little deeper
    d[i * 4 + 3] = Math.round(a * 255);
  }
  cx.putImageData(img, 0, 0);
  return sigFit(c);
}
/** crop a transparent canvas to its ink (alpha) and fit into 600×200; '' when empty */
function sigFit(c) {
  const w = c.width, h = c.height, d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return '';
  const p = 6; x0 = Math.max(0, x0 - p); y0 = Math.max(0, y0 - p); x1 = Math.min(w - 1, x1 + p); y1 = Math.min(h - 1, y1 + p);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, f = Math.min(1, SIG_MAX[0] / cw, SIG_MAX[1] / ch);
  const o = document.createElement('canvas'); o.width = Math.max(1, Math.round(cw * f)); o.height = Math.max(1, Math.round(ch * f));
  const ox = o.getContext('2d'); ox.imageSmoothingQuality = 'high'; ox.drawImage(c, x0, y0, cw, ch, 0, 0, o.width, o.height);
  return o.toDataURL('image/png');
}
const sigLoadImg = url => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Not an image this browser can read (use JPG or PNG)')); i.src = url; });

/* ---------- the shared parts of the dialogs: draw pad and upload with background removal ---------- */
function sigDrawHTML(p) { return `<canvas id="${p}-c" width="560" height="170" class="sig-pad"></canvas><div class="row" style="margin-top:6px"><button type="button" class="btn sm" id="${p}-clr">Clear</button><span class="muted small">Draw with the mouse, finger or pen.</span></div>`; }
function sigUploadHTML(p) {
  return `<div class="sg-up"><label class="btn sm">Choose photo / scan…<input type="file" id="${p}-f" accept="image/*" hidden></label><span class="muted small" id="${p}-fn">A photo of your signature on white paper works best.</span></div>
    <div class="sg-ctl"><label><input type="checkbox" id="${p}-rb" checked> Remove background</label>
      <label>Ink <select id="${p}-ink"><option value="">Original</option><option value="black">Black</option><option value="blue">Blue</option></select></label>
      <label title="Higher keeps fainter strokes; lower removes more of the paper">Lighter <input type="range" id="${p}-st" min="0" max="100" value="50"> Darker</label></div>
    <div class="sig-prev" id="${p}-pv"><span class="muted small">Preview appears here</span></div><div class="muted small" id="${p}-en"></div>`;
}
/** draw pad → { get() → trimmed PNG or '' } */
function sigBindDraw(m, p) {
  const cv = $(`#${p}-c`, m), cx = cv.getContext('2d'); let drawn = false, down = false;
  cx.lineWidth = 2.6; cx.lineCap = 'round'; cx.lineJoin = 'round'; cx.strokeStyle = '#123';
  const pt = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
  cv.onpointerdown = e => { down = true; cv.setPointerCapture(e.pointerId); cx.beginPath(); cx.moveTo(...pt(e)); };
  cv.onpointermove = e => { if (!down) return; cx.lineTo(...pt(e)); cx.stroke(); drawn = true; };
  cv.onpointerup = () => { down = false; };
  $(`#${p}-clr`, m).onclick = () => { cx.clearRect(0, 0, cv.width, cv.height); drawn = false; };
  return { get: () => drawn ? sigFit(cv) : '' };
}
/** upload with live background removal → { get() → PNG or '' } */
function sigBindUpload(m, p) {
  let img = null, out = '', file = '';
  const pv = $(`#${p}-pv`, m), en = $(`#${p}-en`, m);
  const run = () => {
    if (!img) return;
    const rb = $(`#${p}-rb`, m).checked;
    m.querySelectorAll(`#${p}-ink,#${p}-st`).forEach(x => x.disabled = !rb);
    try {
      if (rb) out = removeSigBg(img, { ink: $(`#${p}-ink`, m).value, strength: +$(`#${p}-st`, m).value });
      else { const c = document.createElement('canvas'), f = Math.min(1, SIG_MAX[0] / img.naturalWidth, SIG_MAX[1] / img.naturalHeight); c.width = Math.round(img.naturalWidth * f); c.height = Math.round(img.naturalHeight * f); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); out = c.toDataURL('image/png'); }
    } catch (e) { out = ''; toast('Could not read the image: ' + e.message, 5000); }
    pv.innerHTML = out ? `<img src="${out}" alt="Signature preview">` : '<span class="muted small">No ink found – try “Darker”.</span>';
    en.textContent = rb ? 'Background removal: ' + sigEngine() : '';
  };
  $(`#${p}-f`, m).onchange = async e => {
    const f = e.target.files[0]; if (!f) return; file = f.name; $(`#${p}-fn`, m).textContent = f.name;
    const url = URL.createObjectURL(f); try { img = await sigLoadImg(url); } catch (er) { toast(er.message, 5000); return; } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
    run();
    if (!SIGCV.cv && !SIGCV.failed) sigOpenCV().then(() => { if (m.isConnected) run(); });   // better result once OpenCV is ready
  };
  let t; m.querySelectorAll(`#${p}-rb,#${p}-ink,#${p}-st`).forEach(x => x.oninput = x.onchange = () => { clearTimeout(t); t = setTimeout(run, 60); });
  return { get: () => out, has: () => !!img };
}

/* ---------- saved signature per email ---------- */
const sigPreset = (email = ME.email) => email ? S.sigPresets?.[email] || null : null;
function sigSavePreset(image) {
  if (!ME.email) return;
  const updatedAt = new Date().toISOString();
  if (image) S.sigPresets[ME.email] = { image, updatedAt }; else delete S.sigPresets[ME.email];
  markDirty();
  appClient().call('PUT', 'me/signature', { image: image || '', updatedAt }).then(r => { if (r.status !== 200 && !appClient().demo) toast('Saved here, but could not share it with other PCs: ' + (r.body?.error || r.status), 5000); }).catch(() => {});
}
/** the server copy wins when it is newer (saved on another PC) */
async function sigFetchPreset() {
  if (!ME.email) return;
  try {
    const r = await appClient().call('GET', 'me/signature'); if (r.status !== 200) return;
    const x = r.body.preset, l = S.sigPresets[ME.email];
    if (x && (!l || x.updatedAt > l.updatedAt)) { S.sigPresets[ME.email] = { image: x.image, updatedAt: x.updatedAt }; markDirty(); }
  } catch (e) { }
}
/** "My signature": upload (background removed) or draw once, used whenever you sign */
function mySignatureDialog(then) {
  if (!ME.email) return askMe(() => mySignatureDialog(then));
  const cur = sigPreset();
  const m = openModal('My signature', `<p class="muted small" style="margin-top:0">Saved for <b>${esc(ME.email)}</b> and used when you sign a timesheet. ${cur ? 'Current:' : 'Nothing saved yet.'}</p>
    ${cur ? `<div class="sig-prev cur"><img src="${cur.image}" alt="Saved signature"></div>` : ''}
    <div data-tab="upload">${sigUploadHTML('ms')}</div><div data-tab="draw">${sigDrawHTML('md')}</div>`,
    [...(cur ? [{ label: 'Delete saved signature', cls: 'bad', onClick: () => { sigSavePreset(''); toast('Saved signature deleted'); then?.(); } }] : []), { label: 'Cancel' },
      { label: 'Save', cls: 'pri', onClick: mm => { const img = PTAB.mysig === 'draw' ? dr.get() : up.get(); if (!img) { toast(PTAB.mysig === 'draw' ? 'Draw your signature first' : 'Choose a photo of your signature first'); return false; } sigSavePreset(img); toast('Signature saved'); then?.(); } }], { width: '640px' });
  editorTabs(m, 'mysig', [['upload', 'Upload image'], ['draw', 'Draw']]);
  const up = sigBindUpload(m, 'ms'), dr = sigBindDraw(m, 'md');
  sigOpenCV();
  return m;
}
