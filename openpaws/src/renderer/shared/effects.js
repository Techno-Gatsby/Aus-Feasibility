/*
 * OpenPaws effects: particles (hearts, zzz, notes, confetti, dust), weather (rain, snow),
 * items (food, balls) and toys (feather wand, laser). Canvas 2D, no assets.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PawsEffects = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const TAU = Math.PI * 2;

  function createEffects() {
    return { parts: [], weather: { kind: null, drops: [], intensity: 0 }, t: 0 };
  }

  const rnd = (a, b) => a + Math.random() * (b - a);

  function spawn(fx, kind, x, y, opts) {
    const o = opts || {};
    const add = (p) => { if (fx.parts.length < 400) fx.parts.push(Object.assign({ kind, x, y, vx: 0, vy: 0, t: 0, life: 1.4, size: 1, rot: 0, vr: 0 }, p)); };
    const s = o.scale || 1;
    switch (kind) {
      case 'heart': add({ vy: -40, vx: rnd(-10, 10), life: 1.5, size: 9 * s }); break;
      case 'hearts': for (let i = 0; i < 4; i++) add({ kind: 'heart', x: x + rnd(-14, 14), y: y + rnd(-4, 6), vy: rnd(-70, -40), vx: rnd(-25, 25), life: rnd(1.1, 1.8), size: rnd(6, 10) * s, delay: i * 0.12 }); break;
      case 'zzz': add({ vy: -22, vx: 14, life: 2.6, size: 9 * s, wob: Math.random() * TAU }); break;
      case 'music': for (let i = 0; i < 2; i++) add({ kind: 'note', x: x + rnd(-10, 10), vy: rnd(-50, -30), vx: rnd(-20, 20), life: 1.8, size: 11 * s, delay: i * 0.4, glyph: Math.random() < 0.5 ? '♪' : '♫' }); break;
      case 'sparkle': for (let i = 0; i < 5; i++) add({ kind: 'spark', x: x + rnd(-18, 18), y: y + rnd(-12, 12), life: rnd(0.5, 0.9), size: rnd(3, 6) * s, color: ['#ffd34d', '#fff2a8', '#ff9ed2'][i % 3] }); break;
      case 'star': for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; add({ kind: 'spark', vx: Math.cos(a) * 80, vy: Math.sin(a) * 80 - 30, life: 0.8, size: 5 * s, color: '#ffd34d' }); } break;
      case 'sweat': add({ vy: 30, vx: 18, life: 1.0, size: 6 * s }); break;
      case 'exclaim': add({ vy: -10, life: 1.1, size: 16 * s, glyph: '!' , kind: 'glyph', color: '#e8516b' }); break;
      case 'question': add({ vy: -10, life: 1.4, size: 16 * s, glyph: '?', kind: 'glyph', color: '#5b7fd6' }); break;
      case 'food': add({ kind: 'thought', vy: -6, life: 2.2, size: 12 * s, glyph: o.glyph || '🍖' }); break;
      case 'dust': for (let i = 0; i < 6; i++) add({ kind: 'dust', x: x + rnd(-10, 10), vx: (i < 3 ? -1 : 1) * rnd(30, 80), vy: rnd(-30, -10), life: rnd(0.4, 0.7), size: rnd(3, 6) * s }); break;
      case 'confetti': for (let i = 0; i < (o.count || 60); i++) add({ kind: 'confetti', x: x + rnd(-40, 40), y: y + rnd(-20, 10), vx: rnd(-260, 260), vy: rnd(-620, -260), vr: rnd(-12, 12), life: rnd(1.8, 3), size: rnd(4, 7), color: ['#e8516b', '#ffd34d', '#5b7fd6', '#4ec98a', '#b07be8', '#ff9a3c'][i % 6], gravity: 700 }); break;
      case 'crumbs': for (let i = 0; i < 4; i++) add({ kind: 'dust', x: x + rnd(-6, 6), vx: rnd(-40, 40), vy: rnd(-90, -40), life: 0.5, size: 2.5, color: '#c98d3f', gravity: 500 }); break;
      case 'bubbles': for (let i = 0; i < 8; i++) add({ kind: 'bubble', x: x + rnd(-25, 25), y: y + rnd(-20, 5), vy: rnd(-50, -20), vx: rnd(-15, 15), life: rnd(1.2, 2.2), size: rnd(3, 8) }); break;
      case 'dizzy': for (let i = 0; i < 3; i++) add({ kind: 'orbit', life: 2.2, size: 5 * s, phase: (i / 3) * TAU, cx: x, cy: y, follow: o.follow }); break;
      default: break;
    }
  }

  function step(fx, dt, bounds) {
    fx.t += dt;
    for (let i = fx.parts.length - 1; i >= 0; i--) {
      const p = fx.parts[i];
      if (p.delay > 0) { p.delay -= dt; continue; }
      p.t += dt;
      if (p.t >= p.life) { fx.parts.splice(i, 1); continue; }
      if (p.gravity) p.vy += p.gravity * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      if (p.kind === 'confetti') { p.vx *= Math.pow(0.4, dt); if (bounds && p.y > bounds.floor) { p.y = bounds.floor; p.vy = 0; p.vx *= 0.5; } }
      if (p.kind === 'zzz') p.x += Math.sin(p.t * 3 + p.wob) * 0.4;
    }
    stepWeather(fx, dt, bounds);
  }

  function heartPath(ctx, x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.35);
    ctx.bezierCurveTo(x - s * 1.1, y - s * 0.35, x - s * 0.55, y - s * 1.05, x, y - s * 0.45);
    ctx.bezierCurveTo(x + s * 0.55, y - s * 1.05, x + s * 1.1, y - s * 0.35, x, y + s * 0.35);
    ctx.closePath();
  }

  function sparkPath(ctx, x, y, s) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU; const r = i % 2 ? s * 0.35 : s;
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
  }

  function draw(ctx, fx, petLookup) {
    drawWeather(ctx, fx);
    for (const p of fx.parts) {
      if (p.delay > 0) continue;
      const k = p.t / p.life;
      const alpha = k < 0.15 ? k / 0.15 : k > 0.7 ? (1 - k) / 0.3 : 1;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      switch (p.kind) {
        case 'heart': {
          const s = p.size * (0.7 + Math.min(1, k * 4) * 0.3);
          heartPath(ctx, p.x, p.y, s);
          ctx.fillStyle = '#ff5c8a'; ctx.fill();
          ctx.lineWidth = 1.2; ctx.strokeStyle = '#c93565'; ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.arc(p.x - s * 0.4, p.y - s * 0.45, s * 0.16, 0, TAU); ctx.fill();
          break;
        }
        case 'zzz': {
          ctx.font = `bold ${Math.round(p.size * (0.8 + k * 0.8))}px "Trebuchet MS", system-ui, sans-serif`;
          ctx.fillStyle = '#6b7fd6'; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3;
          ctx.strokeText('z', p.x, p.y); ctx.fillText('z', p.x, p.y);
          break;
        }
        case 'note': case 'glyph': {
          ctx.font = `bold ${Math.round(p.size)}px system-ui, sans-serif`;
          ctx.fillStyle = p.color || '#7a5bd6'; ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 3;
          ctx.strokeText(p.glyph, p.x, p.y); ctx.fillText(p.glyph, p.x, p.y);
          break;
        }
        case 'thought': {
          ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 1.15, 0, TAU); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.arc(p.x - p.size * 0.9, p.y + p.size * 1.2, p.size * 0.3, 0, TAU); ctx.fill(); ctx.stroke();
          ctx.font = `${Math.round(p.size * 1.2)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000';
          ctx.fillText(p.glyph, p.x, p.y + 1);
          break;
        }
        case 'spark': sparkPath(ctx, p.x, p.y, p.size * (1 - k * 0.5)); ctx.fillStyle = p.color || '#ffd34d'; ctx.fill(); break;
        case 'sweat': {
          ctx.fillStyle = '#7cc4ff'; ctx.beginPath();
          ctx.moveTo(p.x, p.y - p.size); ctx.quadraticCurveTo(p.x + p.size * 0.8, p.y, p.x, p.y + p.size * 0.6); ctx.quadraticCurveTo(p.x - p.size * 0.8, p.y, p.x, p.y - p.size); ctx.fill();
          break;
        }
        case 'dust': ctx.fillStyle = p.color || 'rgba(170,160,150,0.7)'; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 + k), 0, TAU); ctx.fill(); break;
        case 'confetti': ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); break;
        case 'bubble': ctx.strokeStyle = 'rgba(120,180,255,0.8)'; ctx.fillStyle = 'rgba(200,230,255,0.35)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill(); ctx.stroke(); break;
        case 'orbit': {
          const tgt = p.follow && petLookup ? petLookup(p.follow) : null;
          const cx = tgt ? tgt.x : p.cx; const cy = tgt ? tgt.y : p.cy;
          const a = p.phase + p.t * 5;
          sparkPath(ctx, cx + Math.cos(a) * 16, cy + Math.sin(a) * 5, p.size); ctx.fillStyle = '#ffd34d'; ctx.fill();
          break;
        }
        default: break;
      }
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- weather

  function setWeather(fx, kind, intensity) {
    fx.weather.kind = kind;
    fx.weather.intensity = intensity == null ? 0.5 : intensity;
    if (!kind) fx.weather.drops = [];
  }

  function stepWeather(fx, dt, b) {
    const w = fx.weather;
    if (!w.kind || !b) return;
    const target = Math.round((w.kind === 'snow' ? 70 : 110) * w.intensity * (b.width / 1600));
    while (w.drops.length < target) {
      w.drops.push({ x: Math.random() * b.width, y: Math.random() * b.floor * (w.drops.length ? 1 : 0), v: w.kind === 'snow' ? rnd(30, 70) : rnd(700, 950), r: w.kind === 'snow' ? rnd(1.5, 3.6) : rnd(9, 16), ph: Math.random() * TAU });
    }
    if (w.drops.length > target) w.drops.length = target;
    for (const d of w.drops) {
      d.y += d.v * dt;
      if (w.kind === 'snow') d.x += Math.sin(fx.t * 1.3 + d.ph) * 18 * dt; else d.x -= d.v * 0.12 * dt;
      if (d.y > b.floor) { d.y = -10; d.x = Math.random() * b.width; }
      if (d.x < -20) d.x = b.width + 10;
    }
  }

  function drawWeather(ctx, fx) {
    const w = fx.weather;
    if (!w.kind || !w.drops.length) return;
    ctx.save();
    if (w.kind === 'snow') {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.shadowColor = 'rgba(120,140,170,0.6)'; ctx.shadowBlur = 2;
      for (const d of w.drops) { ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, TAU); ctx.fill(); }
    } else {
      ctx.strokeStyle = 'rgba(120,160,220,0.45)'; ctx.lineWidth = 1.3; ctx.beginPath();
      for (const d of w.drops) { ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + d.r * 0.12, d.y - d.r); }
      ctx.stroke();
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ items

  function drawItem(ctx, it) {
    ctx.save();
    ctx.translate(it.x, it.y);
    const r = it.r;
    if (it.kind === 'ball') {
      ctx.rotate(it.spin || 0);
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fillStyle = '#e8516b'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#a5283f'; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r, -0.4, 0.4); ctx.arc(0, 0, r * 0.35, 0.4, -0.4, true); ctx.closePath(); ctx.fillStyle = '#ffd34d'; ctx.fill();
      ctx.beginPath(); ctx.arc(0, 0, r, Math.PI - 0.4, Math.PI + 0.4); ctx.arc(0, 0, r * 0.35, Math.PI + 0.4, Math.PI - 0.4, true); ctx.closePath(); ctx.fill();
      ctx.rotate(-(it.spin || 0));
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.arc(-r * 0.35, -r * 0.4, r * 0.25, 0, TAU); ctx.fill();
    } else {
      drawFood(ctx, it.sub, r);
    }
    ctx.restore();
  }

  function drawFood(ctx, sub, r) {
    ctx.lineWidth = 1.4;
    switch (sub) {
      case 'fish':
        ctx.fillStyle = '#7fb3e8'; ctx.strokeStyle = '#3f6fa8';
        ctx.beginPath(); ctx.ellipse(0, 0, r * 1.1, r * 0.6, 0, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-r * 1.0, 0); ctx.lineTo(-r * 1.7, -r * 0.6); ctx.lineTo(-r * 1.7, r * 0.6); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#123'; ctx.beginPath(); ctx.arc(r * 0.6, -r * 0.12, r * 0.12, 0, TAU); ctx.fill();
        break;
      case 'bone':
        ctx.fillStyle = '#f7efe1'; ctx.strokeStyle = '#b8a27f';
        ctx.beginPath(); ctx.rect(-r, -r * 0.28, r * 2, r * 0.56); ctx.fill(); ctx.stroke();
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) { ctx.beginPath(); ctx.arc(sx * r, sy * r * 0.32, r * 0.36, 0, TAU); ctx.fill(); ctx.stroke(); }
        ctx.fillRect(-r * 0.95, -r * 0.26, r * 1.9, r * 0.52);
        break;
      case 'carrot':
        ctx.fillStyle = '#ff8a2a'; ctx.strokeStyle = '#c45a10';
        ctx.beginPath(); ctx.moveTo(-r * 1.3, 0); ctx.quadraticCurveTo(0, -r * 0.6, r * 0.8, -r * 0.35); ctx.lineTo(r * 0.8, r * 0.35); ctx.quadraticCurveTo(0, r * 0.6, -r * 1.3, 0); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#4ec98a'; for (const a of [-0.5, 0, 0.5]) { ctx.beginPath(); ctx.ellipse(r * 1.1, a * r * 0.5, r * 0.45, r * 0.15, a, 0, TAU); ctx.fill(); }
        break;
      case 'cookie':
        ctx.fillStyle = '#d9a35f'; ctx.strokeStyle = '#9a6b2f';
        ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#5a3b20'; for (const [x, y] of [[-0.4, -0.3], [0.3, -0.4], [0.1, 0.3], [-0.3, 0.4], [0.5, 0.2]]) { ctx.beginPath(); ctx.arc(x * r, y * r, r * 0.12, 0, TAU); ctx.fill(); }
        break;
      case 'berry':
        for (const [x, y] of [[-0.4, 0.2], [0.4, 0.2], [0, -0.35]]) { ctx.beginPath(); ctx.arc(x * r, y * r, r * 0.55, 0, TAU); ctx.fillStyle = '#5b5fd6'; ctx.fill(); ctx.strokeStyle = '#2f3290'; ctx.stroke(); }
        break;
      case 'bamboo':
        ctx.fillStyle = '#7bc96f'; ctx.strokeStyle = '#3f8a35';
        ctx.beginPath(); ctx.rect(-r * 1.4, -r * 0.25, r * 2.8, r * 0.5); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-r * 0.3, -r * 0.25); ctx.lineTo(-r * 0.3, r * 0.25); ctx.moveTo(r * 0.6, -r * 0.25); ctx.lineTo(r * 0.6, r * 0.25); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(r * 0.2, -r * 0.6, r * 0.5, r * 0.18, -0.5, 0, TAU); ctx.fill();
        break;
      case 'seed':
        ctx.fillStyle = '#f2d16b'; ctx.strokeStyle = '#a58a2c';
        for (const [x, y, a] of [[-0.4, 0.1, 0.3], [0.3, 0.2, -0.4], [0, -0.3, 0.1]]) { ctx.beginPath(); ctx.ellipse(x * r, y * r, r * 0.42, r * 0.24, a, 0, TAU); ctx.fill(); ctx.stroke(); }
        break;
      default: {
        // Kibble bowl
        ctx.fillStyle = '#c96b4b'; ctx.strokeStyle = '#8a3f27';
        ctx.beginPath(); ctx.moveTo(-r * 1.3, -r * 0.2); ctx.lineTo(r * 1.3, -r * 0.2); ctx.lineTo(r * 0.9, r * 0.9); ctx.lineTo(-r * 0.9, r * 0.9); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#a8642d';
        for (const [x, y] of [[-0.7, -0.35], [-0.2, -0.5], [0.35, -0.42], [0.8, -0.3], [0.05, -0.2]]) { ctx.beginPath(); ctx.arc(x * r, y * r, r * 0.22, 0, TAU); ctx.fill(); }
      }
    }
  }

  // ------------------------------------------------------------------- toys

  function drawToy(ctx, toy, cursor) {
    if (!toy) return;
    ctx.save();
    if (toy.kind === 'laser') {
      const t = toy.tip;
      const g = ctx.createRadialGradient(t.x, t.y, 0, t.x, t.y, 12);
      g.addColorStop(0, 'rgba(255,40,40,1)'); g.addColorStop(0.3, 'rgba(255,40,40,0.7)'); g.addColorStop(1, 'rgba(255,40,40,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(t.x, t.y, 12, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(t.x, t.y, 2, 0, TAU); ctx.fill();
    } else {
      const segs = toy.segs;
      // The stick
      ctx.strokeStyle = '#8a5a3c'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cursor.x - 26, cursor.y - 30); ctx.lineTo(segs[0].x, segs[0].y); ctx.stroke();
      ctx.strokeStyle = 'rgba(60,60,60,0.8)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(segs[0].x, segs[0].y);
      for (let i = 1; i < segs.length; i++) ctx.lineTo(segs[i].x, segs[i].y);
      ctx.stroke();
      const tip = toy.tip; const prev = segs[segs.length - 2];
      const ang = Math.atan2(tip.y - prev.y, tip.x - prev.x);
      ctx.translate(tip.x, tip.y); ctx.rotate(ang - Math.PI / 2);
      for (const [c, w, l] of [['#ff7eb6', 7, 26], ['#ffd34d', 5, 20], ['#7ec8ff', 4, 15]]) {
        ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(0, l / 2, w, l / 2, 0, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  }

  return { createEffects, spawn, step, draw, setWeather, drawItem, drawToy, heartPath };
});
