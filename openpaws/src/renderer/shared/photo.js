/*
 * OpenPaws photo tools (browser canvas): background removal, chroma key, trimming,
 * sticker outline and fur-color extraction, used to turn a photo of a real pet into a
 * desktop pet. Everything runs locally; no image ever leaves the machine unless the user
 * chooses an AI art provider.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PawsPhoto = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function canvasOf(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }

  function toCanvas(src, maxSide) {
    const sw = src.naturalWidth || src.width; const sh = src.naturalHeight || src.height;
    const k = Math.min(1, (maxSide || 1024) / Math.max(sw, sh));
    const c = canvasOf(Math.round(sw * k), Math.round(sh * k));
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  function loadImageFromUrl(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (!/^data:|^blob:/.test(url)) img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not read that image'));
      img.src = url;
    });
  }

  // Perceptual-ish RGB distance (redmean).
  function dist(r1, g1, b1, r2, g2, b2) {
    const rm = (r1 + r2) / 2; const dr = r1 - r2; const dg = g1 - g2; const db = b1 - b2;
    return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
  }

  // Sample the image border and cluster it, so a photo on a sofa, floor or wall is detected
  // even when the background is not one flat color.
  function borderPalette(d, w, h) {
    const samples = [];
    const step = Math.max(1, Math.floor((w + h) / 200));
    for (let x = 0; x < w; x += step) { samples.push((0 * w + x) * 4, ((h - 1) * w + x) * 4); }
    for (let y = 0; y < h; y += step) { samples.push((y * w + 0) * 4, (y * w + w - 1) * 4); }
    const clusters = [];
    for (const i of samples) {
      const r = d[i]; const g = d[i + 1]; const b = d[i + 2];
      let best = null; let bd = 1e9;
      for (const c of clusters) { const dd = dist(r, g, b, c.r, c.g, c.b); if (dd < bd) { bd = dd; best = c; } }
      if (best && bd < 60) { best.n++; best.r += (r - best.r) / best.n; best.g += (g - best.g) / best.n; best.b += (b - best.b) / best.n; } else clusters.push({ r, g, b, n: 1 });
    }
    clusters.sort((a, b) => b.n - a.n);
    const total = samples.length;
    return clusters.filter((c) => c.n / total > 0.04).slice(0, 6);
  }

  // Flood fill inward from every border pixel that matches the background palette.
  // tolerance 0..100. Returns a new canvas with transparent background.
  function removeBackground(srcCanvas, opts) {
    const o = opts || {};
    const w = srcCanvas.width; const h = srcCanvas.height;
    const ctx = srcCanvas.getContext('2d', { willReadFrequently: true });
    const id = ctx.getImageData(0, 0, w, h);
    const d = id.data;
    const already = countTransparentBorder(d, w, h);
    if (already > 0.6) return { canvas: srcCanvas, removed: 0, note: 'already transparent' };
    const tol = 20 + (o.tolerance != null ? o.tolerance : 45) * 1.6;
    const pal = borderPalette(d, w, h);
    const bg = new Uint8Array(w * h);
    const q = new Int32Array(w * h);
    let qh = 0; let qt = 0;
    const matches = (p) => {
      const i = p * 4;
      for (const c of pal) if (dist(d[i], d[i + 1], d[i + 2], c.r, c.g, c.b) < tol) return true;
      return false;
    };
    const push = (p) => { if (!bg[p] && matches(p)) { bg[p] = 1; q[qt++] = p; } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (qh < qt) {
      const p = q[qh++]; const x = p % w; const y = (p - x) / w;
      if (x > 0) push(p - 1); if (x < w - 1) push(p + 1);
      if (y > 0) push(p - w); if (y < h - 1) push(p + w);
    }
    // Keep only the largest foreground blob (drops specks of floor or fluff).
    const keep = largestComponent(bg, w, h);
    let removed = 0;
    for (let p = 0; p < w * h; p++) {
      if (bg[p] || !keep[p]) { d[p * 4 + 3] = 0; removed++; }
    }
    featherAlpha(d, w, h, o.feather != null ? o.feather : 1);
    const out = canvasOf(w, h);
    out.getContext('2d').putImageData(id, 0, 0);
    return { canvas: out, removed: removed / (w * h), palette: pal };
  }

  function countTransparentBorder(d, w, h) {
    let n = 0; let t = 0;
    for (let x = 0; x < w; x += 4) { t += 2; if (d[x * 4 + 3] < 20) n++; if (d[((h - 1) * w + x) * 4 + 3] < 20) n++; }
    return n / Math.max(1, t);
  }

  function largestComponent(bg, w, h) {
    const label = new Int32Array(w * h);
    const q = new Int32Array(w * h);
    let best = 0; let bestSize = 0; let next = 1;
    for (let s = 0; s < w * h; s++) {
      if (bg[s] || label[s]) continue;
      let qh = 0; let qt = 0; q[qt++] = s; label[s] = next; let size = 0;
      while (qh < qt) {
        const p = q[qh++]; size++;
        const x = p % w;
        const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w];
        for (const n of nb) if (n >= 0 && n < w * h && !bg[n] && !label[n]) { label[n] = next; q[qt++] = n; }
      }
      if (size > bestSize) { bestSize = size; best = next; }
      next++;
    }
    const keep = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) if (label[p] === best) keep[p] = 1;
    return keep;
  }

  function featherAlpha(d, w, h, radius) {
    if (!radius) return;
    const a = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) a[p] = d[p * 4 + 3];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (a[p] === 0) continue;
        const s = a[p - 1] + a[p + 1] + a[p - w] + a[p + w];
        if (s < 255 * 4) d[p * 4 + 3] = Math.round((a[p] * 2 + s) / 6);
      }
    }
  }

  // Key out a solid green (or any) screen, e.g. AI-generated poses on #00FF00.
  function chromaKey(srcCanvas, key) {
    const k = key || { r: 0, g: 255, b: 0 };
    const w = srcCanvas.width; const h = srcCanvas.height;
    const ctx = srcCanvas.getContext('2d', { willReadFrequently: true });
    const id = ctx.getImageData(0, 0, w, h); const d = id.data;
    const greenish = k.g > 200 && k.r < 80 && k.b < 80;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i]; const g = d[i + 1]; const b = d[i + 2];
      if (greenish) {
        const spill = g - Math.max(r, b);
        if (spill > 60) d[i + 3] = 0;
        else if (spill > 20) { d[i + 3] = Math.round(255 * (1 - (spill - 20) / 40)); d[i + 1] = Math.max(r, b); }
        else if (spill > 0) d[i + 1] = Math.max(r, b) + spill * 0.3;
      } else {
        const dd = dist(r, g, b, k.r, k.g, k.b);
        if (dd < 50) d[i + 3] = 0; else if (dd < 90) d[i + 3] = Math.round(255 * (dd - 50) / 40);
      }
    }
    const out = canvasOf(w, h); out.getContext('2d').putImageData(id, 0, 0);
    return out;
  }

  function trim(srcCanvas, pad) {
    const w = srcCanvas.width; const h = srcCanvas.height;
    const d = srcCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    let x0 = w; let y0 = h; let x1 = -1; let y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return srcCanvas;
    const p = pad == null ? 4 : pad;
    x0 = Math.max(0, x0 - p); y0 = Math.max(0, y0 - p); x1 = Math.min(w - 1, x1 + p); y1 = Math.min(h - 1, y1 + p);
    const out = canvasOf(x1 - x0 + 1, y1 - y0 + 1);
    out.getContext('2d').drawImage(srcCanvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    // Remember where the crop came from so taps on the result map back to the photo.
    out._trim = { x0, y0, w: out.width, h: out.height, srcW: w, srcH: h };
    return out;
  }

  // Sticker look: a solid outline around the silhouette plus a soft drop shadow.
  function sticker(srcCanvas, opts) {
    const o = opts || {};
    const ow = o.outline != null ? o.outline : Math.max(3, Math.round(Math.max(srcCanvas.width, srcCanvas.height) / 90));
    const pad = ow * 2 + 4;
    const w = srcCanvas.width + pad * 2; const h = srcCanvas.height + pad * 2;
    const sil = canvasOf(srcCanvas.width, srcCanvas.height);
    const sc = sil.getContext('2d');
    sc.drawImage(srcCanvas, 0, 0);
    sc.globalCompositeOperation = 'source-in';
    sc.fillStyle = o.color || '#ffffff';
    sc.fillRect(0, 0, sil.width, sil.height);
    const out = canvasOf(w, h);
    const c = out.getContext('2d');
    if (o.shadow !== false) {
      c.save(); c.filter = 'blur(3px)'; c.globalAlpha = 0.25;
      const sh = canvasOf(srcCanvas.width, srcCanvas.height); const shc = sh.getContext('2d');
      shc.drawImage(srcCanvas, 0, 0); shc.globalCompositeOperation = 'source-in'; shc.fillStyle = '#000'; shc.fillRect(0, 0, sh.width, sh.height);
      c.drawImage(sh, pad + 1, pad + 3); c.restore();
    }
    if (ow > 0) {
      const steps = 24;
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        c.drawImage(sil, pad + Math.cos(a) * ow, pad + Math.sin(a) * ow);
      }
    }
    c.drawImage(srcCanvas, pad, pad);
    return out;
  }

  // k-means over opaque pixels. Returns colors sorted by how much of the pet they cover.
  function palette(srcCanvas, k) {
    const K = k || 4;
    const w = srcCanvas.width; const h = srcCanvas.height;
    const d = srcCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const px = [];
    const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 6000)));
    for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) { const i = (y * w + x) * 4; if (d[i + 3] > 200) px.push([d[i], d[i + 1], d[i + 2]]); }
    if (!px.length) return [];
    let cent = [];
    for (let i = 0; i < K; i++) cent.push(px[Math.floor((i + 0.5) * px.length / K)].slice());
    let assign = new Array(px.length).fill(0);
    for (let it = 0; it < 10; it++) {
      for (let i = 0; i < px.length; i++) {
        let best = 0; let bd = 1e9;
        for (let c = 0; c < K; c++) { const dd = dist(px[i][0], px[i][1], px[i][2], cent[c][0], cent[c][1], cent[c][2]); if (dd < bd) { bd = dd; best = c; } }
        assign[i] = best;
      }
      const sums = cent.map(() => [0, 0, 0, 0]);
      for (let i = 0; i < px.length; i++) { const s = sums[assign[i]]; s[0] += px[i][0]; s[1] += px[i][1]; s[2] += px[i][2]; s[3]++; }
      cent = sums.map((s, c) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : cent[c]));
    }
    const counts = new Array(K).fill(0);
    for (const a of assign) counts[a]++;
    const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    return cent.map((c, i) => ({ hex: hex(c), share: counts[i] / px.length, lum: (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255 }))
      .filter((c) => c.share > 0.03).sort((a, b) => b.share - a.share);
  }

  // Turns a fur palette into OpenPaws colors + a pattern guess for a look-alike pet.
  function lookalike(pal, speciesHint) {
    if (!pal.length) return null;
    const base = pal[0];
    const lighter = pal.filter((c) => c.lum > base.lum + 0.12).sort((a, b) => b.lum - a.lum)[0];
    const darker = pal.filter((c) => c.lum < base.lum - 0.15).sort((a, b) => a.lum - b.lum)[0];
    const second = pal[1];
    let pattern = 'solid';
    if (lighter && lighter.share > 0.12) pattern = base.lum < 0.25 ? 'tuxedo' : 'belly';
    if (darker && darker.share > 0.1 && base.lum > 0.75) pattern = speciesHint === 'dog' ? 'spots' : 'patches';
    if (second && pal.length >= 3 && pal[2].share > 0.12 && base.lum > 0.7) pattern = 'calico';
    const colors = {
      base: base.hex,
      belly: (lighter || base).hex,
      accent: pattern === 'tuxedo' ? (lighter || base).hex : (darker || second || base).hex,
      accent2: (pal[2] || darker || base).hex,
    };
    return { colors, pattern };
  }

  // Turns a segmentation mask (0..255 per pixel) into clean alpha on RGBA data, in place:
  // soft threshold, drop stray blobs, and pull the old background's color out of fur edges.
  function applyMaskData(d, w, h, mask, opts) {
    const o = opts || {};
    const lo = (o.lo != null ? o.lo : 0.12) * 255; const hi = (o.hi != null ? o.hi : 0.88) * 255;
    const n = w * h;
    const a = new Uint8Array(n);
    for (let p = 0; p < n; p++) {
      const m = mask[p];
      const t = m <= lo ? 0 : m >= hi ? 1 : (m - lo) / (hi - lo);
      a[p] = Math.round(255 * t * t * (3 - 2 * t));
    }
    // Connected components on the solid part; keep the biggest and anything sizeable.
    const label = new Int32Array(n); const q = new Int32Array(n); const sizes = [0];
    let next = 1;
    for (let s = 0; s < n; s++) {
      if (a[s] < 128 || label[s]) continue;
      let qh = 0; let qt = 0; q[qt++] = s; label[s] = next; let size = 0;
      while (qh < qt) {
        const p = q[qh++]; size++;
        const x = p % w;
        if (x > 0 && a[p - 1] >= 128 && !label[p - 1]) { label[p - 1] = next; q[qt++] = p - 1; }
        if (x < w - 1 && a[p + 1] >= 128 && !label[p + 1]) { label[p + 1] = next; q[qt++] = p + 1; }
        if (p >= w && a[p - w] >= 128 && !label[p - w]) { label[p - w] = next; q[qt++] = p - w; }
        if (p + w < n && a[p + w] >= 128 && !label[p + w]) { label[p + w] = next; q[qt++] = p + w; }
      }
      sizes.push(size); next++;
    }
    // Pick the subject: the blob under the user's tap if given, otherwise the one that is
    // both large and central. Other blobs survive only if they are big next to it.
    const cx = new Float64Array(next); const cy = new Float64Array(next);
    for (let p = 0; p < n; p++) { const l = label[p]; if (l) { cx[l] += p % w; cy[l] += (p / w) | 0; } }
    let subject = 0; let bestScore = -1;
    if (o.seed) {
      const sp = Math.round(o.seed.y * (h - 1)) * w + Math.round(o.seed.x * (w - 1));
      subject = label[sp] || 0;
    }
    if (!subject) {
      const diag = Math.hypot(w, h);
      for (let l = 1; l < next; l++) {
        const mx = cx[l] / sizes[l]; const my = cy[l] / sizes[l];
        const central = 1 - Math.min(1, Math.hypot(mx - w / 2, my - h * 0.55) / (diag * 0.5));
        const score = sizes[l] * (0.35 + central);
        if (score > bestScore) { bestScore = score; subject = l; }
      }
    }
    const ref = Math.max(1, sizes[subject] || 1);
    const ratio = o.keepRatio != null ? o.keepRatio : 0.35;
    const keepLabel = sizes.map((s, l) => l === subject || (s >= ref * ratio && !o.seed));
    // Soft pixels belong to a kept blob if a solid neighbour within 2px does.
    for (let p = 0; p < n; p++) {
      if (a[p] === 0) continue;
      if (label[p]) { if (!keepLabel[label[p]]) a[p] = 0; continue; }
      const x = p % w; const y = (p - x) / w; let ok = false;
      for (let dy = -2; dy <= 2 && !ok; dy++) for (let dx = -2; dx <= 2 && !ok; dx++) {
        const xx = x + dx; const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const l = label[yy * w + xx]; if (l && keepLabel[l]) ok = true;
      }
      if (!ok) a[p] = 0;
    }
    // Edge decontamination: semi-transparent pixels take on the color of nearby solid fur.
    if (o.decontaminate !== false) {
      const r = 3;
      for (let p = 0; p < n; p++) {
        const al = a[p];
        if (al === 0 || al >= 250) continue;
        const x = p % w; const y = (p - x) / w;
        let sr = 0; let sg = 0; let sb = 0; let cnt = 0;
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx; const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const pp = yy * w + xx;
          if (a[pp] >= 250) { const i = pp * 4; sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; cnt++; }
        }
        if (!cnt) continue;
        const k = (1 - al / 255) * 0.85; const i = p * 4;
        d[i] = d[i] * (1 - k) + (sr / cnt) * k;
        d[i + 1] = d[i + 1] * (1 - k) + (sg / cnt) * k;
        d[i + 2] = d[i + 2] * (1 - k) + (sb / cnt) * k;
      }
    }
    for (let p = 0; p < n; p++) d[p * 4 + 3] = Math.min(d[p * 4 + 3], a[p]);
    return d;
  }

  function applyMask(srcCanvas, mask, opts) {
    const w = srcCanvas.width; const h = srcCanvas.height;
    const id = srcCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h);
    applyMaskData(id.data, w, h, mask, opts);
    const out = canvasOf(w, h);
    out.getContext('2d').putImageData(id, 0, 0);
    return out;
  }

  function rgbaOf(c) {
    const id = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
    return id.data;
  }

  // Finds where the head, tail and feet are on a cutout, so a single photo can be rigged
  // for living-photo animation without asking the user to mark anything.
  function autoRig(srcCanvas) {
    const w = srcCanvas.width; const h = srcCanvas.height;
    const d = rgbaOf(srcCanvas);
    const solid = (x, y) => d[(y * w + x) * 4 + 3] > 120;
    let x0 = w; let x1 = 0; let y0 = h; let y1 = 0; let mx = 0; let my = 0; let mass = 0;
    const colTop = new Array(w).fill(-1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (solid(x, y)) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      mx += x; my += y; mass++;
      if (colTop[x] < 0) colTop[x] = y;
    }
    if (!mass) return null;
    mx /= mass; my /= mass;
    const bw = x1 - x0 + 1; const bh = y1 - y0 + 1;
    // More mass high up on one side means the head is there.
    let leftTop = 0; let rightTop = 0;
    const band = y0 + bh * 0.45;
    for (let y = y0; y < band; y++) for (let x = x0; x <= x1; x++) if (solid(x, y)) { if (x < mx) leftTop++; else rightTop++; }
    const sideways = bw > bh * 0.95;
    const facing = Math.abs(leftTop - rightTop) < 0.15 * (leftTop + rightTop) ? 0 : leftTop > rightTop ? -1 : 1;
    // Head: the highest column region on the head side (or top-centre for a front view).
    let headX = mx; let headY = y0;
    if (facing !== 0 && sideways) {
      let best = h; for (let x = x0; x <= x1; x++) { const onSide = facing > 0 ? x > mx : x < mx; if (onSide && colTop[x] >= 0 && colTop[x] < best) { best = colTop[x]; headX = x; } }
      headY = best;
    } else {
      let best = h; for (let x = x0; x <= x1; x++) if (colTop[x] >= 0 && colTop[x] < best) { best = colTop[x]; headX = x; }
      headY = best; headX = (headX + mx) / 2;
    }
    const head = { x: headX / w, y: Math.min(1, (headY + bh * 0.16) / h) };
    // Tail: an upper protrusion on the side away from the head.
    let tail = null;
    if (facing !== 0) {
      const edgeX = facing > 0 ? x0 : x1;
      for (let y = y0; y < y0 + bh * 0.75; y++) if (solid(Math.round(edgeX + facing * 2), y)) { tail = { x: (edgeX + facing * bw * 0.06) / w, y: y / h }; break; }
    }
    return {
      facing, sideways,
      bbox: { x: x0 / w, y: y0 / h, w: bw / w, h: bh / h },
      center: { x: mx / w, y: my / h },
      head, tail, feetY: y1 / h,
    };
  }

  function toDataUrl(c, type) {
    if (c.convertToBlob) {
      return c.convertToBlob({ type: type || 'image/png' }).then((b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); }));
    }
    return Promise.resolve(c.toDataURL(type || 'image/png'));
  }

  // One call that does the usual thing for a pet photo.
  async function makeSticker(url, opts) {
    const o = opts || {};
    const img = await loadImageFromUrl(url);
    let c = toCanvas(img, o.maxSide || 640);
    let removed = 0;
    if (o.chroma) c = chromaKey(c, o.chroma);
    else if (o.removeBackground !== false) { const r = removeBackground(c, { tolerance: o.tolerance }); c = r.canvas; removed = r.removed; }
    c = trim(c, 2);
    const pal = palette(c, 5);
    const st = o.outline === 0 ? c : sticker(c, { outline: o.outline });
    const dataUrl = await toDataUrl(st);
    return { dataUrl, width: st.width, height: st.height, aspect: st.width / st.height, removed, palette: pal };
  }

  return { toCanvas, loadImageFromUrl, removeBackground, chromaKey, trim, sticker, palette, lookalike, toDataUrl, makeSticker, borderPalette, applyMask, applyMaskData, autoRig, rgbaOf, canvasOf };
});
