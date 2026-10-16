'use strict';
/*
 * On-device AI background removal for pet photos and video frames.
 *
 * Runs open-source salient-object segmentation models with ONNX Runtime (MIT):
 *   fast  - U²-Net small (u2netp), Apache-2.0, 4.6 MB, ~0.3 s per image on 4 CPU cores
 *   best  - IS-Net general use (DIS), Apache-2.0, 179 MB, ~2.5 s per image
 * Weights are downloaded on first use from the rembg project's public release assets and
 * verified by SHA-256. The renderer sends raw RGBA pixels; this returns an alpha mask.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MODELS = {
  fast: {
    id: 'fast', label: 'Fast (U²-Net small)', file: 'u2netp.onnx', bytes: 4574861,
    url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx',
    sha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
    size: 320, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225],
    credit: 'U²-Net (Qin et al., 2020), Apache-2.0',
  },
  best: {
    id: 'best', label: 'Best (IS-Net)', file: 'isnet-general-use.onnx', bytes: 178648008,
    url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx',
    sha256: '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a',
    size: 1024, mean: [0.5, 0.5, 0.5], std: [1, 1, 1],
    credit: 'DIS / IS-Net (Qin et al., 2022), Apache-2.0',
  },
};

let ort = null;
function runtime() {
  if (ort) return ort;
  try { ort = require('onnxruntime-node'); } catch (e) { ort = false; }
  return ort;
}

// Bilinear resample of an RGBA buffer; box-filters first when shrinking a lot.
function resizeRGBA(src, sw, sh, dw, dh) {
  let data = src; let w = sw; let h = sh;
  while (w >= dw * 2 && h >= dh * 2) {
    const nw = w >> 1; const nh = h >> 1; const out = new Uint8ClampedArray(nw * nh * 4);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        const o = (y * nw + x) * 4; const i0 = ((y * 2) * w + x * 2) * 4; const i1 = i0 + w * 4;
        for (let c = 0; c < 4; c++) out[o + c] = (data[i0 + c] + data[i0 + 4 + c] + data[i1 + c] + data[i1 + 4 + c] + 2) >> 2;
      }
    }
    data = out; w = nw; h = nh;
  }
  const out = new Uint8ClampedArray(dw * dh * 4);
  const xr = w / dw; const yr = h / dh;
  for (let y = 0; y < dh; y++) {
    const fy = Math.max(0, (y + 0.5) * yr - 0.5); const y0 = Math.floor(fy); const y1 = Math.min(h - 1, y0 + 1); const ty = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.max(0, (x + 0.5) * xr - 0.5); const x0 = Math.floor(fx); const x1 = Math.min(w - 1, x0 + 1); const tx = fx - x0;
      const a = (y0 * w + x0) * 4; const b = (y0 * w + x1) * 4; const c = (y1 * w + x0) * 4; const d = (y1 * w + x1) * 4;
      const o = (y * dw + x) * 4;
      for (let k = 0; k < 4; k++) {
        out[o + k] = (data[a + k] * (1 - tx) + data[b + k] * tx) * (1 - ty) + (data[c + k] * (1 - tx) + data[d + k] * tx) * ty;
      }
    }
  }
  return out;
}

function resizeMask(mask, sw, sh, dw, dh) {
  const out = new Float32Array(dw * dh);
  const xr = sw / dw; const yr = sh / dh;
  for (let y = 0; y < dh; y++) {
    const fy = Math.max(0, (y + 0.5) * yr - 0.5); const y0 = Math.floor(fy); const y1 = Math.min(sh - 1, y0 + 1); const ty = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.max(0, (x + 0.5) * xr - 0.5); const x0 = Math.floor(fx); const x1 = Math.min(sw - 1, x0 + 1); const tx = fx - x0;
      out[y * dw + x] = (mask[y0 * sw + x0] * (1 - tx) + mask[y0 * sw + x1] * tx) * (1 - ty) + (mask[y1 * sw + x0] * (1 - tx) + mask[y1 * sw + x1] * tx) * ty;
    }
  }
  return out;
}

// rembg-compatible preprocessing: scale by the image's max value, then mean/std, CHW.
function toTensorData(rgba, w, h, model) {
  const S = model.size;
  const small = resizeRGBA(rgba, w, h, S, S);
  let max = 1;
  for (let i = 0; i < small.length; i += 4) { if (small[i] > max) max = small[i]; if (small[i + 1] > max) max = small[i + 1]; if (small[i + 2] > max) max = small[i + 2]; }
  const out = new Float32Array(3 * S * S);
  const plane = S * S;
  for (let p = 0; p < plane; p++) {
    const i = p * 4;
    out[p] = (small[i] / max - model.mean[0]) / model.std[0];
    out[plane + p] = (small[i + 1] / max - model.mean[1]) / model.std[1];
    out[2 * plane + p] = (small[i + 2] / max - model.mean[2]) / model.std[2];
  }
  return out;
}

class Cutout {
  constructor(dir, opts) {
    this.dir = path.join(dir, 'models');
    this.sessions = {};
    this.downloads = {};
    this.fetch = (opts && opts.fetch) || globalThis.fetch;
  }

  available() { return !!runtime(); }

  status() {
    return Object.values(MODELS).map((m) => ({
      id: m.id, label: m.label, bytes: m.bytes, credit: m.credit,
      installed: fs.existsSync(path.join(this.dir, m.file)),
      downloading: !!this.downloads[m.id],
    }));
  }

  // Downloads a model once, verifying its checksum. onProgress(fraction).
  async ensureModel(id, onProgress) {
    const m = MODELS[id];
    if (!m) throw new Error('Unknown model ' + id);
    const file = path.join(this.dir, m.file);
    if (fs.existsSync(file)) return file;
    if (this.downloads[id]) return this.downloads[id];
    this.downloads[id] = (async () => {
      fs.mkdirSync(this.dir, { recursive: true });
      const res = await this.fetch(m.url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`Model download failed (HTTP ${res.status})`);
      const total = Number(res.headers.get('content-length')) || m.bytes;
      const hash = crypto.createHash('sha256');
      const tmp = file + '.part';
      const out = fs.createWriteStream(tmp);
      let got = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value); got += value.length;
        if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
        if (onProgress) onProgress(Math.min(1, got / total));
      }
      await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
      const digest = hash.digest('hex');
      if (digest !== m.sha256) { fs.rmSync(tmp, { force: true }); throw new Error('Model checksum mismatch; download discarded'); }
      fs.renameSync(tmp, file);
      return file;
    })();
    try { return await this.downloads[id]; } finally { delete this.downloads[id]; }
  }

  async session(id) {
    const rt = runtime();
    if (!rt) throw new Error('On-device AI is not available on this computer; using the classic background remover instead.');
    if (this.sessions[id]) return this.sessions[id];
    const file = await this.ensureModel(id);
    this.sessions[id] = await rt.InferenceSession.create(file, { graphOptimizationLevel: 'all' });
    return this.sessions[id];
  }

  // rgba: Uint8Array/Uint8ClampedArray of w*h*4. Returns Uint8Array alpha mask (w*h).
  async segment(rgba, w, h, id) {
    const m = MODELS[id] || MODELS.fast;
    const sess = await this.session(m.id);
    const rt = runtime();
    const data = toTensorData(rgba, w, h, m);
    const input = new rt.Tensor('float32', data, [1, 3, m.size, m.size]);
    const out = await sess.run({ [sess.inputNames[0]]: input });
    const pred = out[sess.outputNames[0]].data;
    let mi = Infinity; let ma = -Infinity;
    for (let i = 0; i < m.size * m.size; i++) { const v = pred[i]; if (v < mi) mi = v; if (v > ma) ma = v; }
    const span = ma - mi || 1;
    const norm = new Float32Array(m.size * m.size);
    for (let i = 0; i < norm.length; i++) norm[i] = (pred[i] - mi) / span;
    const full = resizeMask(norm, m.size, m.size, w, h);
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < full.length; i++) mask[i] = Math.max(0, Math.min(255, Math.round(full[i] * 255)));
    return mask;
  }
}

module.exports = { Cutout, MODELS, resizeRGBA, resizeMask, toTensorData };
