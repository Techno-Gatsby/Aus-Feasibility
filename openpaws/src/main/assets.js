'use strict';
/*
 * Pet images, sprite frames and videos live as files under userData/assets and are served
 * to the renderers through the paws-asset:// protocol (never raw file:// paths).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.apng': 'image/apng',
};
const MAX_BYTES = 60 * 1024 * 1024;

class Assets {
  constructor(dir) {
    this.dir = path.join(dir, 'assets');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  // Saves a data: URL or Buffer, returns a paws-asset:// URL.
  save(petId, name, data) {
    const safePet = String(petId).replace(/[^a-zA-Z0-9_-]/g, '');
    let buf; let ext = path.extname(name || '').toLowerCase();
    if (typeof data === 'string' && data.startsWith('data:')) {
      const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(data);
      if (!m) throw new Error('Unreadable image data');
      buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8');
      if (!ext) ext = Object.keys(MIME).find((k) => MIME[k] === m[1]) || '.png';
    } else if (Buffer.isBuffer(data)) {
      buf = data;
    } else {
      throw new Error('Unsupported asset data');
    }
    if (buf.length > MAX_BYTES) throw new Error('That file is too large (max 60 MB)');
    if (!MIME[ext]) throw new Error('Unsupported file type ' + ext);
    const base = String(name || 'asset').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'asset';
    const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 10);
    const rel = path.join(safePet, `${base}-${hash}${ext}`);
    const abs = path.join(this.dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf);
    return 'paws-asset://' + rel.split(path.sep).join('/');
  }

  copyFile(petId, srcPath) {
    const buf = fs.readFileSync(srcPath);
    return this.save(petId, path.basename(srcPath), buf);
  }

  resolve(url) {
    const rel = decodeURIComponent(String(url).replace(/^paws-asset:\/\//, '').split('?')[0]);
    const abs = path.normalize(path.join(this.dir, rel));
    // Never serve anything outside the assets folder.
    if (!abs.startsWith(this.dir + path.sep)) return null;
    return abs;
  }

  mimeOf(abs) { return MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream'; }

  removePet(petId) {
    const safePet = String(petId).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safePet) return;
    fs.rmSync(path.join(this.dir, safePet), { recursive: true, force: true });
  }

  readDataUrl(url) {
    const abs = this.resolve(url);
    if (!abs) return null;
    return `data:${this.mimeOf(abs)};base64,${fs.readFileSync(abs).toString('base64')}`;
  }

  // Electron protocol handler body.
  handler() {
    return async (request) => {
      const abs = this.resolve(request.url);
      if (!abs || !fs.existsSync(abs)) return new Response('not found', { status: 404 });
      const data = await fs.promises.readFile(abs);
      // CORS header so pages can read pixels from these images (cutouts, hit-testing).
      return new Response(data, { headers: { 'content-type': this.mimeOf(abs), 'cache-control': 'max-age=31536000', 'access-control-allow-origin': '*' } });
    };
  }
}

module.exports = { Assets, MIME };
