/*
 * OpenPaws asset pets: photo stickers, frame/sprite sets (AI poses, sprite sheets, Shimeji
 * packs, animated GIF/WebP) and video behaviors. Pets without a frame for the current
 * behavior fall back to procedural motion of their base image (bob, tilt, squash, roll).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PawsSprites = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const TAU = Math.PI * 2;

  const images = new Map();
  const animCache = new Map();
  const videos = new Map();

  function loadImage(url) {
    if (!url) return null;
    let e = images.get(url);
    if (!e) {
      const img = new Image();
      img.decoding = 'async';
      if (!/^data:|^blob:/.test(url)) img.crossOrigin = 'anonymous';
      e = { img, ok: false, err: false };
      img.onload = () => { e.ok = true; };
      img.onerror = () => { e.err = true; };
      img.src = url;
      images.set(url, e);
      // Animated GIF/WebP/APNG: decode every frame with WebCodecs when available.
      if (/\.(gif|webp|png)(\?|$)/i.test(url) || url.startsWith('data:image/gif') || url.startsWith('data:image/webp')) decodeAnimated(url);
    }
    return e.ok ? e.img : null;
  }

  async function decodeAnimated(url) {
    if (typeof ImageDecoder === 'undefined' || animCache.has(url)) return;
    animCache.set(url, null);
    try {
      const res = await fetch(url);
      const type = res.headers.get('content-type') || (url.includes('.gif') ? 'image/gif' : url.includes('.webp') ? 'image/webp' : 'image/png');
      const dec = new ImageDecoder({ data: res.body, type });
      await dec.tracks.ready;
      const track = dec.tracks.selectedTrack;
      if (!track || track.frameCount <= 1) return;
      const frames = []; let total = 0;
      for (let i = 0; i < track.frameCount; i++) {
        const r = await dec.decode({ frameIndex: i });
        const bmp = await createImageBitmap(r.image);
        const dur = (r.image.duration || 100000) / 1000;
        frames.push({ bmp, at: total, dur });
        total += dur;
        r.image.close();
      }
      animCache.set(url, { frames, total });
    } catch (e) { /* static image then */ }
  }

  function animFrame(url, timeMs) {
    const a = animCache.get(url);
    if (!a || !a.frames.length) return null;
    const t = timeMs % a.total;
    for (const f of a.frames) if (t >= f.at && t < f.at + f.dur) return f.bmp;
    return a.frames[0].bmp;
  }

  function loadVideo(url) {
    let v = videos.get(url);
    if (!v) {
      const el = document.createElement('video');
      el.src = url; el.muted = true; el.loop = true; el.playsInline = true; el.crossOrigin = 'anonymous';
      el.play().catch(() => {});
      v = { el, canvas: document.createElement('canvas'), lastT: -1 };
      videos.set(url, v);
    }
    return v;
  }

  // Video frames with a green or white screen get keyed out at pet size (cheap).
  function videoFrame(v, key, w, h) {
    const el = v.el;
    if (el.readyState < 2) return null;
    if (el.paused) el.play().catch(() => {});
    const cw = Math.max(16, Math.round(w)); const ch = Math.max(16, Math.round(h));
    if (v.canvas.width !== cw || v.canvas.height !== ch) { v.canvas.width = cw; v.canvas.height = ch; }
    if (v.lastT === el.currentTime) return v.canvas;
    v.lastT = el.currentTime;
    const c = v.canvas.getContext('2d', { willReadFrequently: true });
    c.clearRect(0, 0, cw, ch);
    c.drawImage(el, 0, 0, cw, ch);
    if (key && key !== 'none') {
      const id = c.getImageData(0, 0, cw, ch); const d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i]; const g = d[i + 1]; const b = d[i + 2];
        if (key === 'green') {
          const k = g - Math.max(r, b);
          if (k > 40) d[i + 3] = 0; else if (k > 15) { d[i + 3] = 255 * (1 - (k - 15) / 25); d[i + 1] = Math.max(r, b); }
        } else if (key === 'white') {
          const m = Math.min(r, g, b);
          if (m > 240) d[i + 3] = 0; else if (m > 220) d[i + 3] = 255 * (1 - (m - 220) / 20);
        }
      }
      c.putImageData(id, 0, 0);
    }
    return v.canvas;
  }

  // Which clip to show for each engine state, with fallbacks when a pack lacks one.
  const CLIP_FOR_STATE = {
    idle: ['idle'], look: ['look', 'idle'], walk: ['walk', 'idle'], run: ['run', 'walk', 'idle'],
    chase: ['run', 'walk', 'idle'], chaseToy: ['run', 'walk', 'idle'], goEat: ['walk', 'idle'], fetch: ['run', 'walk', 'idle'],
    chasePet: ['run', 'walk', 'idle'], sit: ['sit', 'idle'], focus: ['sit', 'idle'], lie: ['lie', 'sit', 'idle'],
    sleep: ['sleep', 'lie', 'sit', 'idle'], groom: ['groom', 'sit', 'idle'], stretch: ['stretch', 'idle'], yawn: ['sit', 'idle'],
    sad: ['sad', 'lie', 'sit', 'idle'], beg: ['beg', 'sit', 'idle'], jump: ['jump', 'fall', 'idle'], pounce: ['jump', 'fall', 'idle'],
    fall: ['fall', 'jump', 'idle'], thrown: ['fall', 'jump', 'idle'], land: ['land', 'idle'], dizzy: ['dizzy', 'sit', 'idle'],
    held: ['held', 'fall', 'idle'], climb: ['climb', 'walk', 'idle'], ceilingWalk: ['ceiling', 'climb', 'walk', 'idle'],
    eat: ['eat', 'sit', 'idle'], happy: ['happy', 'idle'], enjoy: ['happy', 'sit', 'idle'], greet: ['happy', 'idle'],
    celebrate: ['happy', 'jump', 'idle'], scared: ['scared', 'lie', 'idle'],
  };

  function pickClip(asset, p) {
    const frames = (asset && asset.frames) || {};
    const vids = (asset && asset.videos) || {};
    let chain = CLIP_FOR_STATE[p.state] || ['idle'];
    if (p.state === 'trick') chain = [p.data && p.data.trick, 'happy', 'idle'];
    for (const name of chain) {
      if (name && vids[name]) return { kind: 'video', name, url: vids[name] };
      if (name && frames[name] && frames[name].length) return { kind: 'frames', name, list: frames[name] };
    }
    return null;
  }

  // Procedural motion applied to a still image (or a frame set missing this behavior).
  function motion(p, time, clipName) {
    const st = p.state; const a = p.anim || {}; const t = p.t || 0;
    const m = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, flip: 1, feet: false };
    const native = clipName && CLIP_FOR_STATE[st] && CLIP_FOR_STATE[st][0] === clipName;
    const moving = Math.abs(p.vx || 0) > 1 || st === 'climb' || st === 'ceilingWalk';
    if (moving && !native) {
      const ph = a.phase || 0;
      m.dy = -Math.abs(Math.sin(ph)) * 5 * p.dims.s;
      m.rot = Math.sin(ph) * 0.07;
      m.sy = 1 - Math.abs(Math.cos(ph)) * 0.04;
      m.feet = true;
    }
    if (native) return m;
    switch (st) {
      case 'sit': case 'focus': case 'groom': case 'yawn': m.sy = 0.94; m.sx = 1.03; break;
      case 'lie': m.sy = 0.82; m.sx = 1.08; break;
      case 'sleep': m.rot = -1.35; m.dy = -p.dims.w * 0.08; m.sy = 1 + Math.sin(time * 2.2) * 0.02; break;
      case 'sad': m.sy = 0.86; m.rot = 0.06; break;
      case 'beg': m.sy = 1.06; m.rot = Math.sin(time * 6) * 0.05; break;
      case 'jump': case 'pounce': case 'fall': m.sy = 1.08; m.sx = 0.94; m.rot = Math.max(-0.4, Math.min(0.4, (p.vy || 0) / 1600)); break;
      case 'thrown': m.rot = a.spin || 0; break;
      case 'land': m.sy = 1 - 0.2 * (a.squash || 0); m.sx = 1 + 0.15 * (a.squash || 0); break;
      case 'dizzy': m.rot = Math.sin(time * 5) * 0.15; break;
      case 'held': m.rot = (a.swing || 0); m.sy = 1.05; break;
      case 'eat': m.rot = 0.22 + Math.sin(time * 16) * 0.03; break;
      case 'happy': case 'greet': case 'celebrate': m.dy = -Math.abs(Math.sin(t * 9)) * 8 * p.dims.s; m.sy = 1 + Math.sin(t * 18) * 0.04; break;
      case 'enjoy': m.rot = Math.sin(time * 30) * 0.015; m.sy = 0.95; break;
      case 'scared': m.dx = Math.sin(time * 70) * 1.2; m.sy = 0.9; break;
      case 'stretch': m.sx = 1.12; m.sy = 0.9; break;
      case 'trick': {
        const tr = p.data && p.data.trick; const def = { spin: 1.6, rollover: 1.8, backflip: 1.3 }[tr] || 2.5; const k = Math.min(1, t / def);
        if (tr === 'spin') m.flip = Math.cos(k * TAU * 2);
        else if (tr === 'rollover') { m.rot = k * TAU; m.dy = -Math.abs(Math.sin(k * Math.PI)) * p.dims.h * 0.3; }
        else if (tr === 'backflip') m.rot = -k * TAU * (p.facing || 1);
        else if (tr === 'dance') { m.rot = Math.sin(time * 7) * 0.16; m.dy = -Math.abs(Math.sin(time * 7)) * 6; }
        else if (tr === 'playdead') { m.rot = Math.min(1, t / 0.5) * Math.PI * 0.5; m.dy = -p.dims.w * 0.05; }
        else if (tr === 'zoomies' || tr === 'moonwalk') { const ph = a.phase || time * 8; m.dy = -Math.abs(Math.sin(ph)) * 5; m.rot = Math.sin(ph) * 0.08; }
        else { m.dy = -Math.abs(Math.sin(t * 7)) * 8; m.rot = Math.sin(t * 7) * 0.08; }
        break;
      }
      default: break;
    }
    return m;
  }

  // ------------------------------------------------------------ living photo

  // Behaviour -> which uploaded photo pose to show.
  const POSE_FOR_STATE = {
    sit: ['sit'], focus: ['sit'], groom: ['sit'], yawn: ['sit'], enjoy: ['sit', 'happy'], dizzy: ['sit'],
    lie: ['lie', 'sleep'], sad: ['lie', 'sit'], sleep: ['sleep', 'lie'], scared: ['lie'],
    walk: ['walk'], run: ['walk'], chase: ['walk'], chaseToy: ['walk'], goEat: ['walk'], fetch: ['walk'], chasePet: ['walk'], climb: ['walk'], ceilingWalk: ['walk'],
    happy: ['happy'], greet: ['happy'], celebrate: ['happy'], beg: ['beg', 'sit'], look: ['look'], held: ['held'],
  };

  function pickPose(asset, p) {
    const poses = asset.poses || {};
    let chain = POSE_FOR_STATE[p.state] || [];
    if (p.state === 'trick') chain = ({ sit: ['sit'], beg: ['beg', 'sit'], wave: ['sit'], highfive: ['beg', 'sit'], playdead: ['lie'], dance: ['happy'] })[p.data && p.data.trick] || ['happy'];
    for (const name of chain) if (poses[name]) return { name, url: poses[name], rig: (asset.rigs && asset.rigs[name]) || null };
    return { name: 'stand', url: (poses.stand || asset.url), rig: asset.rig || (asset.rigs && asset.rigs.stand) || null };
  }

  const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

  // Displacement field for a rigged photo: breathing torso, head bob/tilt/turn, tail wag and
  // a walking shuffle of the legs. (u, v) are normalized image coordinates.
  function warpParams(p, time, rig, poseName) {
    const st = p.state; const a = p.anim || {};
    const moving = Math.abs(p.vx || 0) > 1 || st === 'climb' || st === 'ceilingWalk';
    const asleep = st === 'sleep';
    const excited = ['happy', 'greet', 'celebrate', 'enjoy', 'beg'].includes(st) || (st === 'trick');
    const look = (p.facing || 1) * (a.lookX || 0);
    return {
      breath: (asleep ? 0.028 : 0.016) * Math.sin(time * (asleep ? 1.6 : 2.3)),
      headTilt: (asleep ? 0.02 : 0.05) * Math.sin(time * 0.9 + 1) + (a.lookY || 0) * -0.08 + (excited ? Math.sin(time * 6) * 0.05 : 0),
      headBob: moving ? Math.sin((a.phase || 0) * 2) * 0.012 : Math.sin(time * 1.3) * 0.006,
      headTurn: asleep ? 0 : Math.max(-1, Math.min(1, look)) * 0.6,
      tailWag: rig && rig.tail ? Math.sin((a.wag || time * 6) * (excited ? 1.8 : 1)) * (excited ? 0.32 : moving ? 0.12 : 0.18) : 0,
      walk: moving && poseName !== 'walk-frames' ? 1 : 0,
      phase: a.phase || 0,
    };
  }

  function displace(u, v, rig, k) {
    let x = u; let y = v;
    const c = rig.center; const hd = rig.head;
    const bh = rig.bbox.h || 1; const bw = rig.bbox.w || 1;
    const scale = Math.max(bh, bw);
    // Head region weight
    const dh = Math.hypot((u - hd.x) / bw, (v - hd.y) / bh);
    const wHead = 1 - smooth(0.18, 0.42, dh);
    // Breathing: expand around the torso centre, away from the head.
    const dt = Math.hypot((u - c.x) / bw, (v - c.y) / bh);
    const wTorso = Math.exp(-(dt * dt) / 0.18) * (1 - wHead);
    y += (v - c.y) * k.breath * wTorso * 1.4;
    x += (u - c.x) * k.breath * wTorso * 0.5;
    if (wHead > 0.001) {
      const px = hd.x + (c.x - hd.x) * 0.35; const py = hd.y + (c.y - hd.y) * 0.45;
      const ang = k.headTilt * wHead;
      const rx = x - px; const ry = y - py;
      const cs = Math.cos(ang); const sn = Math.sin(ang);
      x = px + rx * cs - ry * sn; y = py + rx * sn + ry * cs;
      // Turning toward the cursor: squash the face a little and slide it sideways.
      x += k.headTurn * 0.035 * scale * wHead - (u - hd.x) * Math.abs(k.headTurn) * 0.12 * wHead;
      y += k.headBob * wHead;
    }
    if (rig.tail && k.tailWag) {
      const tl = rig.tail;
      const dtl = Math.hypot((u - tl.x) / bw, (v - tl.y) / bh);
      const wTail = 1 - smooth(0.06, 0.3, dtl);
      if (wTail > 0.001) {
        const px = tl.x + (c.x - tl.x) * 0.45; const py = tl.y + (c.y - tl.y) * 0.45;
        const ang = k.tailWag * wTail; const rx = x - px; const ry = y - py;
        const cs = Math.cos(ang); const sn = Math.sin(ang);
        x = px + rx * cs - ry * sn; y = py + rx * sn + ry * cs;
      }
    }
    if (k.walk) {
      const feet = rig.feetY || 1; const legTop = feet - bh * 0.3;
      if (v > legTop) {
        const lk = Math.min(1, (v - legTop) / (feet - legTop));
        const front = (u - c.x) * (rig.facing || 1) > 0 ? 0 : Math.PI;
        const s = Math.sin(k.phase + front);
        x += s * 0.045 * bw * lk;
        y -= Math.max(0, Math.cos(k.phase + front)) * 0.02 * bh * lk;
      }
    }
    return { x, y };
  }

  // Draws img as a grid of affine-mapped triangles following the displacement field.
  function warpDraw(ctx, img, rig, k, dx, dy, dw, dh) {
    const iw = img.naturalWidth || img.width; const ih = img.naturalHeight || img.height;
    const b = rig.bbox;
    const G = 7;
    const u0 = Math.max(0, b.x - 0.02); const v0 = Math.max(0, b.y - 0.04);
    const u1 = Math.min(1, b.x + b.w + 0.02); const v1 = Math.min(1, b.y + b.h + 0.01);
    // Outside the subject's box the image is transparent, so the grid only covers the box.
    const pts = [];
    for (let j = 0; j <= G; j++) {
      const row = [];
      for (let i = 0; i <= G; i++) {
        const u = u0 + (u1 - u0) * (i / G); const v = v0 + (v1 - v0) * (j / G);
        const q = displace(u, v, rig, k);
        row.push({ su: u * iw, sv: v * ih, x: dx + q.x * dw, y: dy + q.y * dh });
      }
      pts.push(row);
    }
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const a = pts[j][i]; const b2 = pts[j][i + 1]; const c = pts[j + 1][i]; const d = pts[j + 1][i + 1];
        tri(ctx, img, a, b2, c);
        tri(ctx, img, b2, d, c);
      }
    }
  }

  function tri(ctx, img, p0, p1, p2) {
    // Grow the destination triangle by ~0.7px so neighbours overlap and no seams show.
    const cx = (p0.x + p1.x + p2.x) / 3; const cy = (p0.y + p1.y + p2.y) / 3;
    const grow = (p) => { const vx = p.x - cx; const vy = p.y - cy; const l = Math.hypot(vx, vy) || 1; return { x: p.x + (vx / l) * 0.7, y: p.y + (vy / l) * 0.7 }; };
    const q0 = grow(p0); const q1 = grow(p1); const q2 = grow(p2);
    // Affine map from source (su,sv) to destination (x,y).
    const s0u = p0.su; const s0v = p0.sv; const s1u = p1.su; const s1v = p1.sv; const s2u = p2.su; const s2v = p2.sv;
    const den = s0u * (s2v - s1v) - s1u * s2v + s2u * s1v + (s1u - s2u) * s0v;
    if (Math.abs(den) < 1e-6) return;
    const m11 = -(s0v * (p2.x - p1.x) - s1v * p2.x + s2v * p1.x + (s1v - s2v) * p0.x) / den;
    const m12 = (s1v * p2.y + s0v * (p1.y - p2.y) - s2v * p1.y + (s2v - s1v) * p0.y) / den;
    const m21 = (s0u * (p2.x - p1.x) - s1u * p2.x + s2u * p1.x + (s1u - s2u) * p0.x) / den;
    const m22 = -(s1u * p2.y + s0u * (p1.y - p2.y) - s2u * p1.y + (s2u - s1u) * p0.y) / den;
    const dx = (s0u * (s2v * p1.x - s1v * p2.x) + s0v * (s1u * p2.x - s2u * p1.x) + (s2u * s1v - s1u * s2v) * p0.x) / den;
    const dy = (s0u * (s2v * p1.y - s1v * p2.y) + s0v * (s1u * p2.y - s2u * p1.y) + (s2u * s1v - s1u * s2v) * p0.y) / den;
    ctx.save();
    ctx.beginPath(); ctx.moveTo(q0.x, q0.y); ctx.lineTo(q1.x, q1.y); ctx.lineTo(q2.x, q2.y); ctx.closePath();
    ctx.clip();
    ctx.transform(m11, m12, m21, m22, dx, dy);
    const minU = Math.max(0, Math.floor(Math.min(s0u, s1u, s2u)) - 2); const minV = Math.max(0, Math.floor(Math.min(s0v, s1v, s2v)) - 2);
    const maxU = Math.min(img.naturalWidth || img.width, Math.ceil(Math.max(s0u, s1u, s2u)) + 2);
    const maxV = Math.min(img.naturalHeight || img.height, Math.ceil(Math.max(s0v, s1v, s2v)) + 2);
    if (maxU > minU && maxV > minV) ctx.drawImage(img, minU, minV, maxU - minU, maxV - minV, minU, minV, maxU - minU, maxV - minV);
    ctx.restore();
  }

  function drawAssetPet(ctx, p, time) {
    if (p.hidden) return;
    const asset = p.cfg.asset || {};
    const clip = pickClip(asset, p);
    let pose = null;
    let src = null;
    if (clip && clip.kind === 'video') {
      const v = loadVideo(clip.url);
      const ar = asset.aspect || 1;
      src = videoFrame(v, asset.key || 'none', p.dims.h * ar * 1.5, p.dims.h * 1.5);
    } else if (clip && clip.kind === 'frames') {
      const list = clip.list;
      const fps = asset.fps || 8;
      const moving = Math.abs(p.vx || 0) > 1;
      const idx = moving && (clip.name === 'walk' || clip.name === 'run')
        ? Math.floor((p.anim.phase || 0) * list.length / TAU) % list.length
        : Math.floor(time * fps) % list.length;
      const url = list[(idx + list.length) % list.length];
      src = animFrame(url, time * 1000) || loadImage(url);
    }
    if (!src) {
      pose = pickPose(asset, p);
      const url = pose.url || (asset.frames && asset.frames.idle && asset.frames.idle[0]);
      src = url ? (animFrame(url, time * 1000) || loadImage(url)) : null;
    }
    // A dedicated pose photo (sitting, sleeping...) already shows the behaviour, so only the
    // gentle living-photo motion runs on it instead of the squash/rotate fallback.
    const m = motion(p, time, clip ? clip.name : (pose && pose.name !== 'stand' ? (CLIP_FOR_STATE[p.state] || [])[0] : null));
    const rig = pose && asset.living !== false ? pose.rig : null;

    // Shadow
    if (p.surface === 'floor') {
      ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.beginPath(); ctx.ellipse(p.x, p.y - 1, p.dims.w * 0.34, 3.5 * p.dims.s, 0, 0, TAU); ctx.fill(); ctx.restore();
    }
    ctx.save();
    let rot = 0; let face = p.facing || 1; let x = p.x; let y = p.y;
    if (p.surface === 'wallR') rot = -Math.PI / 2;
    else if (p.surface === 'wallL') { rot = Math.PI / 2; face = -1; }
    else if (p.surface === 'ceiling') { rot = Math.PI; face = -face; }
    else if (p.surface === 'held') { y = p.y - p.dims.h * 0.92; }
    ctx.translate(x, y);
    ctx.rotate(rot);
    // Each pose photo may face its own way; video clips use the cat's overall facing.
    const poseFacing = pose && pose.rig && pose.rig.facing ? pose.rig.facing : null;
    const nativeFacing = poseFacing != null ? (poseFacing < 0 ? -1 : 1) : (asset.facing === 'left' ? -1 : 1);
    ctx.scale(face * nativeFacing * m.flip, 1);
    const h = p.dims.h; const w = src ? h * ((src.width || src.naturalWidth || 1) / (src.height || src.naturalHeight || 1)) : p.dims.w;
    if (p.surface === 'held') {
      ctx.rotate(m.rot);
      ctx.scale(m.sx, m.sy);
      if (src) ctx.drawImage(src, -w / 2, -h * 0.08, w, h);
    } else {
      ctx.translate(m.dx, m.dy);
      // Rotate around the middle of the body so rolls and flips stay in place.
      ctx.translate(0, -h / 2); ctx.rotate(m.rot); ctx.translate(0, h / 2);
      ctx.scale(m.sx, m.sy);
      if (m.feet && asset.feet === true && !(asset.frames && asset.frames.walk)) drawFeet(ctx, p, w, time);
      if (src && rig && rig.bbox) {
        const k = warpParams(p, time, rig, pose.name);
        if (m.feet) { k.walk = 1; m.rot *= 0.4; }
        warpDraw(ctx, src, rig, k, -w / 2, -h, w, h);
      } else if (src) ctx.drawImage(src, -w / 2, -h, w, h);
      else placeholder(ctx, w, h);
    }
    ctx.restore();
  }

  // Little paper-doll feet that patter under a photo sticker while it walks.
  function drawFeet(ctx, p, w, time) {
    const ph = p.anim.phase || time * 8;
    ctx.save();
    ctx.fillStyle = p.cfg.asset && p.cfg.asset.feetColor ? p.cfg.asset.feetColor : '#f2e6da';
    ctx.strokeStyle = 'rgba(80,60,50,0.7)'; ctx.lineWidth = 1.2;
    const fs = 5 * p.dims.s;
    for (let i = 0; i < 4; i++) {
      const off = (i < 2 ? 0.22 : -0.22) * w + (i % 2 ? 4 : -4) * p.dims.s;
      const k = Math.sin(ph + (i % 2 ? Math.PI : 0) + (i < 2 ? 0 : Math.PI));
      ctx.beginPath(); ctx.ellipse(off + k * 3 * p.dims.s, -fs * 0.6 - Math.max(0, k) * 3 * p.dims.s, fs, fs * 0.65, 0, 0, TAU);
      ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  function placeholder(ctx, w, h) {
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(0, -h / 2, w / 2.5, h / 2.4, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#999'; ctx.font = '12px system-ui'; ctx.textAlign = 'center'; ctx.fillText('loading…', 0, -h / 2);
  }

  // Shimeji-ee packs use numbered images (shime1.png ... shime46.png), facing left.
  // This maps the standard numbering to OpenPaws clips.
  // Indices follow Shimeji-ee's default conf/actions.xml: 1 stand, 2-3 walk steps, 4 fall,
  // 5-6 resist, 7-10 dragged sway, 11 sit, 12-14 wall climb, 18-19 bounce, 20 trip,
  // 21 sprawl, 22 jump, 23-25 ceiling, 26 sit looking up, 30-33 edge sit / dangle legs.
  const SHIMEJI_MAP = {
    idle: [1], walk: [1, 2, 1, 3], run: [1, 2, 1, 3], fall: [4], held: [1, 7, 1, 8], scared: [5, 6], sit: [11],
    climb: [12, 13, 14, 13], ceiling: [23, 24, 25, 24], jump: [22], land: [18, 19], lie: [21], sleep: [21],
    happy: [22, 1], look: [26], sad: [20], eat: [11], beg: [30, 31], groom: [32, 33],
  };

  function shimejiFrames(fileMap) {
    // fileMap: { 'shime1.png': url, ... }
    const frames = {};
    for (const [clip, nums] of Object.entries(SHIMEJI_MAP)) {
      const list = nums.map((n) => fileMap['shime' + n + '.png']).filter(Boolean);
      if (list.length) frames[clip] = list;
    }
    return frames;
  }

  // Pixel-accurate hit testing for photo cats, so clicks through the transparent parts of a
  // photo reach the windows underneath. Idea from OpenPets' pet-alpha-hit-test.ts (MIT).
  const alphaMaps = new Map();
  function alphaMap(url) {
    let m = alphaMaps.get(url);
    if (m !== undefined) return m;
    const e = images.get(url);
    if (!e || !e.ok) return null;
    const S = 96; const img = e.img;
    const k = S / Math.max(img.naturalWidth, img.naturalHeight);
    const w = Math.max(1, Math.round(img.naturalWidth * k)); const h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0, w, h);
    try { m = { w, h, data: cx.getImageData(0, 0, w, h).data }; } catch (_) { m = false; }
    alphaMaps.set(url, m);
    return m;
  }
  function alphaHit(p, x, y) {
    if (p.surface !== 'floor' && p.surface !== 'air') return true;
    const asset = p.cfg.asset || {};
    const pose = pickPose(asset, p);
    const url = pose.url || asset.url;
    const m = url ? alphaMap(url) : null;
    if (!m) return true;
    const h = p.dims.h; const w = h * (m.w / m.h);
    const poseFacing = pose.rig && pose.rig.facing ? (pose.rig.facing < 0 ? -1 : 1) : (asset.facing === 'left' ? -1 : 1);
    let u = (x - (p.x - w / 2)) / w; const v = (y - (p.y - h)) / h;
    if ((p.facing || 1) * poseFacing < 0) u = 1 - u;
    if (u < 0 || u > 1 || v < 0 || v > 1) return false;
    const px = Math.floor(u * (m.w - 1)); const py = Math.floor(v * (m.h - 1));
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const sx = px + dx; const sy = py + dy;
      if (sx < 0 || sy < 0 || sx >= m.w || sy >= m.h) continue;
      if (m.data[(sy * m.w + sx) * 4 + 3] >= 64) return true;
    }
    return false;
  }

  return { alphaHit, drawAssetPet, loadImage, pickClip, pickPose, motion, warpDraw, warpParams, displace, shimejiFrames, SHIMEJI_MAP, CLIP_FOR_STATE, POSE_FOR_STATE };
});
