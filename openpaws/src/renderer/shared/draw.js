/*
 * OpenPaws cat renderer (Canvas 2D).
 *
 * Two views: SIDE for moving (walk, run, hunt, jump, climb, scratch) and FRONT for resting
 * and showing off (sit, loaf, sleep, groom, beg, wave, knead...). Cats turn toward you when
 * they settle, like real ones do. Everything is vector-drawn each frame with soft gradient
 * shading, so poses blend smoothly and any coat can be customised.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./species.js'));
  else root.PawsDraw = factory(root.PawsSpecies);
})(typeof self !== 'undefined' ? self : this, function (Species) {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };

  // ------------------------------------------------------------ colors

  function hexToRgb(hex) {
    let h = (hex || '#888888').replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(r, g, b) { return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join(''); }
  function shade(hex, amt) {
    const [r, g, b] = hexToRgb(hex);
    if (amt >= 0) return rgbToHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);
    return rgbToHex(r * (1 + amt), g * (1 + amt), b * (1 + amt));
  }
  function mix(a, b, t) { const x = hexToRgb(a); const y = hexToRgb(b); return rgbToHex(lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)); }
  function luminance(hex) { const [r, g, b] = hexToRgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }
  function rgba(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
  function lineFor(base) { return luminance(base) < 0.22 ? shade(base, -0.5) : shade(base, -0.42); }
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // Soft vertical shading for a fur area spanning y0..y1.
  function furFill(ctx, base, y0, y1, k) {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    const s = k == null ? 1 : k;
    g.addColorStop(0, shade(base, 0.14 * s));
    g.addColorStop(0.45, base);
    g.addColorStop(1, shade(base, -0.16 * s));
    return g;
  }

  // A filled stroke whose width tapers from w0 to w1 along a cubic bezier (tails, legs).
  function taper(ctx, p0, p1, p2, p3, w0, w1, steps) {
    const n = steps || 18;
    const left = []; const right = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n; const u = 1 - t;
      const x = u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x;
      const y = u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y;
      const dx = 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x);
      const dy = 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y);
      const l = Math.hypot(dx, dy) || 1;
      const w = lerp(w0, w1, t) / 2;
      left.push({ x: x - (dy / l) * w, y: y + (dx / l) * w });
      right.push({ x: x + (dy / l) * w, y: y - (dx / l) * w });
    }
    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    for (const q of left) ctx.lineTo(q.x, q.y);
    const e = p3; const w = w1 / 2;
    const last = left[left.length - 1]; const lastR = right[right.length - 1];
    const ang = Math.atan2(last.y - lastR.y, last.x - lastR.x);
    ctx.arc(e.x, e.y, w, ang, ang + Math.PI, true);
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
    ctx.closePath();
  }

  // ------------------------------------------------------------- poses

  const FRONT_STATES = new Set(['sit', 'focus', 'groom', 'yawn', 'beg', 'happy', 'enjoy', 'greet', 'dizzy', 'sad', 'look', 'slowblink', 'knead', 'loaf', 'sleep', 'lie', 'celebrate']);
  const FRONT_TRICKS = new Set(['sit', 'wave', 'beg', 'highfive', 'dance', 'slowblink', 'knead']);

  function computePose(p, time) {
    const st = p.state; const t = p.t || 0; const a = p.anim || {};
    const stats = p.cfg.stats || {};
    const happy = (stats.happiness ?? 80) > 60;
    const pose = {
      view: 'side', legs: 'stand', bodyAngle: 0, bodyLift: 0, sx: 1, sy: 1, rot: 0, flip: 1,
      headTurn: 0.55, headTilt: 0, headDX: 0, headDY: 0,
      eyes: 'open', lid: 0, pupil: 0.45, mouth: 'none', ears: 'up', earFlick: a.ear || 0,
      tail: happy ? 'up' : 'level', tailFlick: Math.sin(time * 2.2 + (hashStr(String(p.id)) % 7)) * 0.5,
      paw: null, pawK: 0, prop: null, shake: 0, blush: false, puff: 0,
    };
    const speed = Math.abs(p.vx || 0);
    const moving = speed > 1;

    if (['walk', 'run', 'chase', 'chaseToy', 'goEat', 'fetch', 'chasePet', 'ceilingWalk', 'climb'].includes(st)) {
      if (moving || st === 'climb' || st === 'ceilingWalk') {
        const run = speed > 110;
        pose.legs = run ? 'run' : 'walk';
        pose.tail = run ? 'level' : 'up';
        pose.headTurn = run ? 0.9 : 0.8;
        if (run) { pose.ears = 'back'; pose.pupil = 0.8; }
        if (p.carrying) pose.mouth = 'hold';
      }
      if (st === 'climb' && p.data && p.data.pause > 0) pose.legs = 'stand';
    }

    switch (st) {
      case 'idle': pose.legs = 'stand'; pose.headTurn = 0.35; break;
      case 'look': pose.view = 'front'; pose.legs = 'sit'; pose.headTilt = clamp((a.lookX || 0) * (p.facing || 1), -1, 1) * 0.22 - 0.05; pose.ears = 'perk'; pose.pupil = 0.7; break;
      case 'sit': pose.view = 'front'; pose.legs = 'sit'; pose.headTilt = Math.sin(time * 0.6) * 0.04; break;
      case 'focus': pose.view = 'front'; pose.legs = 'loaf'; pose.prop = 'laptop'; pose.eyes = 'down'; pose.headDY = 1.5; break;
      case 'loaf': pose.view = 'front'; pose.legs = 'loaf'; pose.lid = 0.35; break;
      case 'lie': pose.view = 'front'; pose.legs = 'loaf'; pose.lid = 0.25; break;
      case 'sleep': pose.view = 'front'; pose.legs = 'curl'; pose.eyes = 'closed'; pose.sy = 1 + Math.sin(time * 1.8) * 0.025; break;
      case 'groom': pose.view = 'front'; pose.legs = 'sit'; pose.paw = 'groom'; pose.pawK = 0.5 + Math.sin(t * 9) * 0.5; pose.eyes = 'closed'; pose.mouth = 'lick'; pose.headTilt = 0.22; pose.headDY = 2; break;
      case 'yawn': { const k = Math.sin(Math.min(1, t / 1.5) * Math.PI); pose.view = 'front'; pose.legs = 'sit'; pose.mouth = k > 0.25 ? 'yawn' : 'none'; pose.eyes = k > 0.3 ? 'closed' : 'open'; pose.lid = 0.4; pose.headTilt = -0.12 * k; pose.headDY = -2 * k; break; }
      case 'sad': pose.view = 'front'; pose.legs = 'loaf'; pose.ears = 'flat'; pose.eyes = 'sad'; pose.tail = 'down'; pose.headDY = 3; break;
      case 'beg': pose.view = 'front'; pose.legs = 'stand-up'; pose.paw = 'both'; pose.eyes = 'wide'; pose.pupil = 0.95; pose.mouth = 'meow'; break;
      case 'stretch': { const k = Math.sin(Math.min(1, t / 1.6) * Math.PI); pose.legs = 'bow'; pose.bow = k; pose.eyes = k > 0.4 ? 'closed' : 'open'; pose.mouth = k > 0.55 ? 'yawn' : 'none'; pose.tail = 'up'; pose.headTurn = 0.6; break; }
      case 'hunt': {
        pose.legs = 'crouch'; pose.tail = 'low'; pose.ears = 'perk'; pose.pupil = 1; pose.eyes = 'wide'; pose.headTurn = 0.9;
        pose.wiggle = Math.sin(time * 26) * (t > 0.3 ? 1 : 0); break;
      }
      case 'scratch': pose.legs = 'scratch'; pose.scratchK = Math.sin(time * 14); pose.eyes = 'closed'; pose.tail = 'up'; pose.headTurn = 0.7; break;
      case 'hiss': pose.legs = 'arch'; pose.puff = 1; pose.tail = 'puff'; pose.ears = 'back'; pose.mouth = 'hiss'; pose.eyes = 'wide'; pose.pupil = 1; pose.headTurn = 0.4; break;
      case 'knead': pose.view = 'front'; pose.legs = 'sit'; pose.paw = 'knead'; pose.pawK = Math.sin(time * 7); pose.eyes = 'happy'; pose.blush = true; pose.shake = 0.3; break;
      case 'slowblink': { const k = Math.sin(clamp(t / 2.0, 0, 1) * Math.PI); pose.view = 'front'; pose.legs = 'sit'; pose.lid = 0.15 + 0.85 * k; pose.headTilt = 0.08; break; }
      case 'jump': case 'pounce': case 'fall':
        pose.legs = 'air'; pose.tail = 'level'; pose.bodyAngle = clamp((p.vy || 0) / 1500, -0.45, 0.45);
        pose.eyes = 'wide'; pose.pupil = 0.9; pose.ears = st === 'fall' ? 'back' : 'perk'; pose.headTurn = 0.85; break;
      case 'thrown': pose.legs = 'air'; pose.tail = 'level'; pose.eyes = 'wide'; pose.pupil = 1; pose.mouth = 'meow'; pose.ears = 'back'; pose.rot = a.spin || 0; pose.puff = 0.4; break;
      case 'land': pose.legs = 'stand'; pose.sx = 1 + 0.16 * (a.squash || 0); pose.sy = 1 - 0.18 * (a.squash || 0); break;
      case 'dizzy': pose.view = 'front'; pose.legs = 'sit'; pose.eyes = 'spiral'; pose.headTilt = Math.sin(time * 5) * 0.2; pose.mouth = 'wobble'; break;
      case 'held': pose.legs = 'dangle'; pose.tail = 'down'; pose.eyes = (stats.bond || 0) > 50 ? 'happy' : 'wide'; pose.mouth = (stats.bond || 0) > 50 ? 'smile' : 'meow'; pose.ears = 'back'; pose.headTurn = 0.2; break;
      case 'eat': pose.legs = 'stand'; pose.headDX = 5; pose.headDY = 13; pose.headTilt = 0.35; pose.mouth = 'munch'; pose.eyes = 'happy'; pose.headTurn = 0.85; break;
      case 'happy': pose.view = 'front'; pose.legs = 'sit'; pose.eyes = 'happy'; pose.mouth = 'smile'; pose.blush = true; pose.tail = 'up'; break;
      case 'enjoy': pose.view = 'front'; pose.legs = 'loaf'; pose.eyes = 'happy'; pose.mouth = 'smile'; pose.blush = true; pose.shake = 0.35; break;
      case 'greet': pose.view = 'front'; pose.legs = 'sit'; pose.eyes = 'happy'; pose.mouth = 'smile'; pose.headTilt = 0.15; break;
      case 'celebrate': pose.view = p.surface === 'air' ? 'side' : 'front'; pose.legs = p.surface === 'air' ? 'air' : 'sit'; pose.eyes = 'happy'; pose.mouth = 'meow'; break;
      case 'scared': pose.legs = 'crouch'; pose.ears = 'flat'; pose.eyes = 'wide'; pose.pupil = 1; pose.shake = 1; pose.tail = 'down'; pose.puff = 0.6; break;
      case 'trick': trickPose(p, pose, t, time); break;
      default: break;
    }
    if (p.surface === 'held') { pose.view = 'side'; pose.legs = 'dangle'; }
    if (p.surface !== 'floor' && pose.view === 'front') pose.view = 'side';
    if (p.talking && pose.mouth === 'none') pose.mouth = 'talk';
    if (a.blink > 0.5 && pose.eyes === 'open') pose.eyes = 'blink';
    // Pupils narrow in bright weather and widen at night or when excited.
    return pose;
  }

  function trickPose(p, pose, t, time) {
    const tr = p.data && p.data.trick;
    const def = Species.trick(tr) || { dur: 2 };
    const k = clamp(t / def.dur, 0, 1);
    if (FRONT_TRICKS.has(tr)) { pose.view = 'front'; pose.legs = 'sit'; }
    switch (tr) {
      case 'sit': pose.eyes = k > 0.3 ? 'happy' : 'open'; break;
      case 'wave': pose.paw = 'wave'; pose.pawK = Math.sin(t * 14); pose.eyes = 'happy'; pose.mouth = 'smile'; break;
      case 'beg': pose.legs = 'stand-up'; pose.paw = 'both'; pose.pawK = Math.sin(t * 8) * 0.3; pose.eyes = 'wide'; pose.pupil = 1; pose.mouth = 'meow'; break;
      case 'highfive': pose.paw = 'high'; pose.pawK = k > 0.45 && k < 0.62 ? 1 : 0; pose.eyes = 'happy'; pose.mouth = 'smile'; break;
      case 'slowblink': pose.lid = 0.15 + 0.85 * Math.sin(k * Math.PI); break;
      case 'knead': pose.paw = 'knead'; pose.pawK = Math.sin(time * 7); pose.eyes = 'happy'; pose.blush = true; break;
      case 'dance': pose.legs = 'stand-up'; pose.paw = 'dance'; pose.pawK = Math.sin(time * 7); pose.bodyLift = Math.abs(Math.sin(time * 7)) * 4; pose.headTilt = Math.sin(time * 7) * 0.18; pose.eyes = 'happy'; pose.mouth = 'smile'; break;
      case 'spin': pose.legs = 'stand'; pose.flip = Math.cos(k * TAU * 2); pose.bodyLift = Math.sin(k * Math.PI) * 10; pose.eyes = 'happy'; break;
      case 'rollover': pose.legs = 'tuck'; pose.rot = k * TAU; pose.eyes = 'happy'; pose.tail = 'down'; break;
      case 'playdead': { const f = ease(t / 0.5); pose.legs = f > 0.6 ? 'up' : 'stand'; pose.rot = f * Math.PI; pose.eyes = 'x'; pose.mouth = 'tongue'; pose.tail = 'down'; break; }
      case 'backflip': pose.legs = 'air'; pose.rot = -k * TAU; pose.tail = 'level'; pose.eyes = 'happy'; break;
      case 'zoomies': pose.legs = 'run'; pose.tail = 'level'; pose.eyes = 'wide'; pose.pupil = 1; pose.ears = 'back'; pose.headTurn = 0.9; break;
      default: pose.view = 'front'; pose.legs = 'sit';
    }
  }

  // ----------------------------------------------------------- main entry

  function drawPet(ctx, p, time, opts) {
    const o = opts || {};
    if (p.hidden) return;
    const P = Species.plan(p.cfg);
    const s = p.dims.s;
    const pose = computePose(p, time);
    const a = p.anim || (p.anim = {});

    // Turning between side and front view: a quick squash so it reads as a body turn.
    if (a.view !== pose.view) { a.viewPrev = a.view || pose.view; a.view = pose.view; a.viewAt = time; }
    const turnK = a.viewAt != null ? clamp((time - a.viewAt) / 0.22, 0, 1) : 1;
    const view = turnK < 0.5 ? a.viewPrev : pose.view;
    const squeeze = turnK < 1 ? 1 - Math.sin(turnK * Math.PI) * 0.45 : 1;

    const frame = frameTransform(p);
    ctx.save();
    if (p.surface === 'floor' && !o.noShadow) {
      ctx.fillStyle = 'rgba(30,20,10,0.16)';
      const wide = view === 'front' ? 0.42 : 0.55;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y - 0.5, P.bodyLen * s * wide * (1 - (pose.bodyLift || 0) / 60), 3.4 * s, 0, 0, TAU);
      ctx.fill();
    }
    ctx.translate(frame.x, frame.y);
    ctx.rotate(frame.rot);
    ctx.scale(frame.face * (pose.flip || 1) * squeeze, 1);
    if (pose.shake) ctx.translate(Math.sin(time * 70) * 0.7 * pose.shake, 0);
    if (pose.sx !== 1 || pose.sy !== 1) ctx.scale(pose.sx, pose.sy);
    if (pose.rot) {
      const pivotY = -(P.legLen + P.bodyH * 0.5) * s;
      ctx.translate(0, -Math.max(0, -Math.cos(pose.rot)) * (P.headR * s * 0.9));
      ctx.translate(0, pivotY); ctx.rotate(pose.rot); ctx.translate(0, -pivotY);
    }
    const look = buildLook(P, p);
    if (view === 'front') drawFront(ctx, P, s, pose, p, time, look, o);
    else drawSide(ctx, P, s, pose, p, time, look, o, frame);
    ctx.restore();
  }

  function frameTransform(p) {
    switch (p.surface) {
      case 'wallR': return { x: p.x, y: p.y, rot: -Math.PI / 2, face: 1 };
      case 'wallL': return { x: p.x, y: p.y, rot: Math.PI / 2, face: -1 };
      case 'ceiling': return { x: p.x, y: p.y, rot: Math.PI, face: -(p.facing || 1) };
      case 'held': {
        const top = p.dims.h * 0.92;
        return { x: p.x, y: p.y - top, rot: (p.anim && p.anim.swing) || 0, face: p.facing || 1, held: true, top };
      }
      default: return { x: p.x, y: p.y, rot: 0, face: p.facing || 1 };
    }
  }

  // Colors and pattern helpers resolved once per frame.
  function buildLook(P, p) {
    const c = P.colors;
    const pat = P.pattern;
    const L = {
      c, pat, line: lineFor(c.base), base: c.base, belly: c.belly || shade(c.base, 0.4),
      white: '#fbfaf7', rnd: prng(hashStr(String(p.id || 'cat'))), seed: hashStr(String(p.id || 'cat')),
      paw: c.base, leg: c.base, tail: c.base, ear: c.base, earInner: c.inner || shade(c.base, 0.35),
      muzzle: mix(c.base, c.belly || '#ffffff', 0.55), face: null, fluff: P.fluff || 0,
      whisker: luminance(c.base) < 0.35 ? 'rgba(255,255,255,0.75)' : 'rgba(70,55,50,0.45)',
    };
    switch (pat) {
      case 'tuxedo': case 'bicolor': L.paw = c.belly; L.muzzle = c.belly; break;
      case 'points': L.paw = c.accent; L.leg = mix(c.base, c.accent, 0.7); L.tail = c.accent; L.ear = c.accent; L.earInner = shade(c.accent, 0.25); L.face = c.accent; L.muzzle = mix(c.accent, c.base, 0.35); break;
      case 'mitted': L.paw = '#ffffff'; L.leg = mix(c.base, c.accent, 0.35); L.tail = c.accent; L.ear = c.accent; L.earInner = shade(c.accent, 0.3); L.face = c.accent; L.muzzle = '#ffffff'; break;
      case 'sphynx': L.muzzle = c.belly; L.whisker = 'rgba(120,80,70,0.25)'; break;
      default: break;
    }
    return L;
  }

  // =============================================================== FRONT

  function drawFront(ctx, P, s, pose, p, time, L, opts) {
    const R = P.headR * s;
    const W = P.bodyH * s * 1.62 * (P.build || 1); // body width seen from the front
    const legs = pose.legs;
    const lift = (pose.bodyLift || 0) * s;
    const side = 1; // tail wraps toward the cat's facing side; the frame already mirrors

    if (legs === 'curl') return drawCurl(ctx, P, s, pose, p, time, L, R, W);

    const loaf = legs === 'loaf';
    const standUp = legs === 'stand-up';
    const seatH = loaf ? P.bodyH * s * 0.95 : standUp ? (P.legLen + P.bodyH * 1.5) * s : (P.legLen + P.bodyH * 1.18) * s;
    const top = -seatH - lift;

    // --- tail (behind body, wrapping out along the floor)
    drawFrontTail(ctx, P, s, pose, L, W, time, loaf, side);

    // --- haunches
    if (!standUp) {
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        const hx = sx * W * (loaf ? 0.38 : 0.46); const hy = loaf ? -seatH * 0.42 : -seatH * 0.3;
        ctx.ellipse(hx, hy - lift, W * (loaf ? 0.44 : 0.36), seatH * (loaf ? 0.42 : 0.31), sx * 0.15, 0, TAU);
        ctx.fillStyle = furFill(ctx, L.base, hy - seatH * 0.3, 0); ctx.fill();
        ctx.lineWidth = 1.1 * s; ctx.strokeStyle = rgba(L.line, 0.75); ctx.stroke();
        patternHaunch(ctx, P, s, L, hx, hy - lift, W, seatH, sx);
      }
      if (!loaf) {
        for (const sx of [-1, 1]) { // hind paws peeking out
          ctx.beginPath(); ctx.ellipse(sx * W * 0.58, -2.6 * s, 5.2 * s, 3 * s, 0, 0, TAU);
          ctx.fillStyle = L.paw; ctx.fill(); ctx.lineWidth = 1 * s; ctx.strokeStyle = rgba(L.line, 0.7); ctx.stroke();
        }
      }
    } else {
      // Standing up on hind legs: show thighs and feet below a taller body.
      for (const sx of [-1, 1]) {
        ctx.beginPath(); ctx.ellipse(sx * W * 0.3, -P.legLen * s * 0.75 - lift, W * 0.26, P.legLen * s * 0.7, sx * 0.1, 0, TAU);
        ctx.fillStyle = furFill(ctx, L.base, -P.legLen * s * 1.5, 0); ctx.fill(); ctx.lineWidth = 1.1 * s; ctx.strokeStyle = rgba(L.line, 0.75); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(sx * W * 0.33, -2.6 * s, 6 * s, 3.2 * s, 0, 0, TAU);
        ctx.fillStyle = L.paw; ctx.fill(); ctx.stroke();
      }
    }

    // --- chest / body
    const bodyBottom = loaf ? -1 * s : -2 * s;
    const neckY = top + R * 0.25;
    const bw = loaf ? W * 0.98 : W * 0.78;
    ctx.beginPath();
    ctx.moveTo(-bw * 0.62, bodyBottom - lift * 0.3);
    ctx.bezierCurveTo(-bw * 0.72, lerp(bodyBottom, neckY, 0.45), -bw * 0.52, neckY + R * 0.2, -bw * 0.34, neckY);
    ctx.lineTo(bw * 0.34, neckY);
    ctx.bezierCurveTo(bw * 0.52, neckY + R * 0.2, bw * 0.72, lerp(bodyBottom, neckY, 0.45), bw * 0.62, bodyBottom - lift * 0.3);
    ctx.closePath();
    ctx.fillStyle = furFill(ctx, L.base, neckY, 0); ctx.fill();
    ctx.lineWidth = 1.1 * s; ctx.strokeStyle = rgba(L.line, 0.75); ctx.stroke();
    ctx.save(); ctx.clip();
    patternChest(ctx, P, s, L, bw, neckY, bodyBottom);
    if (L.fluff > 0.3) chestRuff(ctx, s, L, bw, neckY, R);
    ctx.restore();

    // --- front legs and paws
    if (!loaf) drawFrontLegs(ctx, P, s, pose, L, W, neckY, time, standUp, lift, 'down');
    else {
      for (const sx of [-1, 1]) { // tucked paws peeking under the chest
        ctx.beginPath(); ctx.ellipse(sx * W * 0.16, -1.8 * s, 5 * s, 2.6 * s, 0, 0, TAU);
        ctx.fillStyle = L.paw; ctx.fill(); ctx.lineWidth = 1 * s; ctx.strokeStyle = rgba(L.line, 0.65); ctx.stroke();
      }
    }

    drawNeckwear(ctx, s, p, 0, neckY + R * 0.18, R, time, true);
    // --- head
    const hx = (pose.headDX || 0) * s * 0.3;
    const hy = neckY - R * 0.62 + (pose.headDY || 0) * s;
    drawFrontHead(ctx, P, s, pose, p, time, L, hx, hy, R);
    if (pose.paw === 'groom') drawGroomPaw(ctx, s, L, hx, hy, R, pose);
    if (!loaf && pose.paw) drawFrontLegs(ctx, P, s, pose, L, W, neckY, time, standUp, lift, 'up');
    if (pose.prop === 'laptop') drawLaptop(ctx, s, W);
    if (opts.weather) drawWeatherProp(ctx, opts.weather, s, hx, hy, R, time);
  }

  function drawFrontTail(ctx, P, s, pose, L, W, time, loaf, side) {
    const tw = P.tailW * s;
    const flick = Math.sin(time * 2.6) * 0.5 + (pose.tailFlick || 0) * 0.5;
    const r0 = { x: side * W * 0.5, y: -W * 0.35 };
    let p1; let p2; let p3;
    if (pose.tail === 'up' && !loaf) {
      p1 = { x: side * W * 1.05, y: -W * 0.45 }; p2 = { x: side * W * 1.15, y: -W * 1.25 }; p3 = { x: side * W * (0.82 + flick * 0.12), y: -W * 1.55 };
    } else {
      p1 = { x: side * W * 1.05, y: -W * 0.05 }; p2 = { x: side * W * 0.65, y: 1.5 * s }; p3 = { x: -side * W * (0.25 + flick * 0.05), y: -2.4 * s - Math.max(0, flick) * 5 * s };
    }
    taper(ctx, r0, p1, p2, p3, tw * 1.05, tw * 0.85);
    ctx.fillStyle = L.tail === L.base ? furFill(ctx, L.base, -W, 0) : L.tail; ctx.fill();
    ctx.lineWidth = 1 * s; ctx.strokeStyle = rgba(L.line, 0.7); ctx.stroke();
    if (P.pattern === 'tabby' || P.pattern === 'rosettes') {
      ctx.save(); ctx.clip(); ctx.strokeStyle = rgba(L.c.accent, 0.8); ctx.lineWidth = 2.4 * s;
      for (let i = 1; i < 6; i++) { const t = i / 6; const q = bez(r0, p1, p2, p3, t); ctx.beginPath(); ctx.arc(q.x, q.y, tw * 0.75, 0, TAU); ctx.stroke(); }
      ctx.restore();
    }
  }

  function bez(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return { x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x, y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y };
  }

  // pass 'down' draws legs standing on the floor (behind the head); pass 'up' draws raised
  // paws afterwards so a wave or high five shows in front of the face.
  function drawFrontLegs(ctx, P, s, pose, L, W, neckY, time, standUp, lift, pass) {
    const lw = P.legW * s * 1.18;
    for (const sx of [-1, 1]) {
      const near = sx === 1;
      let up = 0; let ax = 0;
      if (pose.paw === 'wave' && near) up = 1;
      if (pose.paw === 'high' && near) up = 1.3;
      if (pose.paw === 'both') up = 0.9;
      if (pose.paw === 'dance') up = 0.6 + 0.4 * (sx * (pose.pawK || 0));
      if (pose.paw === 'knead') up = Math.max(0, sx * (pose.pawK || 0)) * 0.22;
      if (pose.paw === 'groom' && near) continue;
      const rootX = sx * W * 0.2; const rootY = neckY + (standUp ? W * 0.35 : W * 0.32);
      if ((up > 0.3) !== (pass === 'up')) continue;
      if (up > 0.3) {
        // Raised paw: forearm angled up and outward (wave, high five), or curled in front
        // of the chest when begging.
        const wave = pose.paw === 'wave' ? (pose.pawK || 0) * 0.35 : 0;
        let ang = -Math.PI / 2 + sx * (0.55 - up * 0.25) + wave;
        let len = P.legLen * s * (0.9 + up * 0.25);
        if (pose.paw === 'both' || pose.paw === 'dance') { ang = -Math.PI / 2 + sx * 0.25 + (pose.pawK || 0) * 0.15; len = P.legLen * s * 0.62; }
        const ex = rootX + Math.cos(ang) * len; const ey = rootY + Math.sin(ang) * len;
        taper(ctx, { x: rootX, y: rootY }, { x: rootX + (ex - rootX) * 0.3, y: rootY + (ey - rootY) * 0.3 }, { x: rootX + (ex - rootX) * 0.7, y: rootY + (ey - rootY) * 0.7 }, { x: ex, y: ey }, lw, lw * 0.95);
        ctx.fillStyle = furFill(ctx, L.leg, ey, rootY); ctx.fill(); ctx.lineWidth = 1 * s; ctx.strokeStyle = rgba(L.line, 0.7); ctx.stroke();
        drawPawPad(ctx, s, L, ex, ey, lw, pose.paw === 'high' && pose.pawK > 0.5);
      } else {
        const footY = -2.6 * s - up * 6 * s;
        const fx = sx * W * 0.21;
        ctx.beginPath();
        ctx.moveTo(rootX - lw / 2, rootY);
        ctx.quadraticCurveTo(fx - lw * 0.62, lerp(rootY, footY, 0.6), fx - lw / 2, footY);
        ctx.lineTo(fx + lw / 2, footY);
        ctx.quadraticCurveTo(fx + lw * 0.62, lerp(rootY, footY, 0.6), rootX + lw / 2, rootY);
        ctx.closePath();
        ctx.fillStyle = furFill(ctx, L.leg, rootY, footY); ctx.fill(); ctx.lineWidth = 1 * s; ctx.strokeStyle = rgba(L.line, 0.7); ctx.stroke();
        if (L.paw !== L.leg) { ctx.save(); ctx.clip(); ctx.fillStyle = L.paw; ctx.fillRect(fx - lw, footY - lw * 1.1, lw * 2, lw * 1.6); ctx.restore(); }
        // Paw with toe lines
        ctx.beginPath(); ctx.ellipse(fx, footY + 0.4 * s, lw * 0.62, lw * 0.42, 0, 0, TAU);
        ctx.fillStyle = L.paw; ctx.fill(); ctx.lineWidth = 1 * s; ctx.strokeStyle = rgba(L.line, 0.7); ctx.stroke();
        ctx.strokeStyle = rgba(L.line, 0.45); ctx.lineWidth = 0.8 * s;
        for (const tx of [-0.2, 0.2]) { ctx.beginPath(); ctx.moveTo(fx + tx * lw, footY + 0.6 * s); ctx.lineTo(fx + tx * lw, footY - lw * 0.2); ctx.stroke(); }
      }
    }
  }

  function drawPawPad(ctx, s, L, x, y, lw, glow) {
    ctx.beginPath(); ctx.arc(x, y, lw * 0.62, 0, TAU);
    ctx.fillStyle = L.paw; ctx.fill(); ctx.lineWidth = 1 * s; ctx.strokeStyle = rgba(L.line, 0.7); ctx.stroke();
    // Toe beans
    const bean = luminance(L.c.base) < 0.3 ? '#4a3a40' : '#f19aa6';
    ctx.fillStyle = bean;
    ctx.beginPath(); ctx.ellipse(x, y + lw * 0.12, lw * 0.26, lw * 0.2, 0, 0, TAU); ctx.fill();
    for (const [bx, by] of [[-0.3, -0.25], [0, -0.38], [0.3, -0.25]]) { ctx.beginPath(); ctx.arc(x + bx * lw, y + by * lw, lw * 0.11, 0, TAU); ctx.fill(); }
    if (glow) { ctx.strokeStyle = 'rgba(255,211,77,0.9)'; ctx.lineWidth = 2 * s; ctx.beginPath(); ctx.arc(x, y, lw * 1.1, 0, TAU); ctx.stroke(); }
  }

  function drawGroomPaw(ctx, s, L, hx, hy, R, pose) {
    const lw = 7.5 * s;
    const px = hx + R * 0.32; const py = hy + R * (0.55 - pose.pawK * 0.12);
    taper(ctx, { x: R * 0.35, y: hy + R * 1.9 }, { x: R * 0.6, y: hy + R * 1.4 }, { x: px + R * 0.15, y: py + R * 0.4 }, { x: px, y: py }, lw, lw);
    ctx.fillStyle = L.leg; ctx.fill(); ctx.lineWidth = 1 * s; ctx.strokeStyle = rgba(L.line, 0.7); ctx.stroke();
    drawPawPad(ctx, s, L, px, py, lw, false);
  }

  // Curled-up sleeping cat: a soft donut with the head tucked and the tail around the front.
  function drawCurl(ctx, P, s, pose, p, time, L, R, W) {
    const bw = W * 1.15; const bh = P.bodyH * s * 1.05;
    const breathe = Math.sin(time * 1.8) * 0.02;
    ctx.save();
    ctx.beginPath(); ctx.ellipse(0, -bh * 0.55, bw * (1 + breathe * 0.5), bh * (0.58 + breathe), 0, 0, TAU);
    ctx.fillStyle = furFill(ctx, L.base, -bh * 1.2, 0); ctx.fill();
    ctx.lineWidth = 1.1 * s; ctx.strokeStyle = rgba(L.line, 0.75); ctx.stroke();
    ctx.clip();
    if (P.pattern === 'tabby') { ctx.strokeStyle = rgba(L.c.accent, 0.75); ctx.lineWidth = 2.6 * s; ctx.lineCap = 'round'; for (let i = -2; i <= 3; i++) { ctx.beginPath(); ctx.arc(-bw * 0.1, -bh * 0.2, bw * (0.35 + i * 0.12), Math.PI * 1.1, Math.PI * 1.6); ctx.stroke(); } }
    if (P.pattern === 'calico' || P.pattern === 'tortie') blotches(ctx, L, -bw * 0.4, -bh * 0.6, bw, bh, 5);
    if (P.pattern === 'points' || P.pattern === 'mitted') { const g = ctx.createRadialGradient(bw * 0.4, -bh * 0.4, 0, bw * 0.4, -bh * 0.4, bw); g.addColorStop(0, rgba(L.c.accent, 0.5)); g.addColorStop(1, rgba(L.c.accent, 0)); ctx.fillStyle = g; ctx.fillRect(-bw, -bh * 1.3, bw * 2, bh * 1.4); }
    if (P.pattern === 'rosettes') spots(ctx, L, -bw, -bh * 1.1, bw * 2, bh, 12, s, true);
    ctx.restore();
    // Tail around the front
    const tw = P.tailW * s;
    taper(ctx, { x: -bw * 0.85, y: -bh * 0.35 }, { x: -bw * 0.9, y: -1 * s }, { x: bw * 0.2, y: 1 * s }, { x: bw * 0.62, y: -bh * 0.18 }, tw * 1.05, tw * 0.9);
    ctx.fillStyle = L.tail === L.base ? shade(L.base, -0.05) : L.tail; ctx.fill(); ctx.lineWidth = 1 * s; ctx.strokeStyle = rgba(L.line, 0.7); ctx.stroke();
    // Head resting on the front of the curl
    const hx = bw * 0.38; const hy = -bh * 0.78;
    const cfgPose = Object.assign({}, pose, { eyes: 'closed', headTilt: 0.32, ears: pose.ears });
    drawFrontHead(ctx, P, s, cfgPose, p, time, L, hx, hy, R * 0.92);
    // Paw over the nose
    ctx.beginPath(); ctx.ellipse(hx - R * 0.25, hy + R * 0.82, 6 * s, 3.4 * s, -0.2, 0, TAU);
    ctx.fillStyle = L.paw; ctx.fill(); ctx.lineWidth = 1 * s; ctx.strokeStyle = rgba(L.line, 0.6); ctx.stroke();
  }

  // ---------------------------------------------------------------- head

  function headShape(ctx, R, face) {
    const cheekW = face === 'chubby' ? 1.16 : face === 'wedge' ? 0.94 : face === 'flat' ? 1.1 : 1.06;
    const chin = face === 'wedge' ? 0.92 : 0.8;
    ctx.beginPath();
    ctx.moveTo(0, -R * 0.95);
    ctx.bezierCurveTo(R * 0.62, -R * 0.97, R * 0.98 * cheekW, -R * 0.55, R * 1.02 * cheekW, R * 0.05);
    ctx.bezierCurveTo(R * 1.05 * cheekW, R * 0.5, face === 'wedge' ? R * 0.42 : R * 0.62, R * chin, 0, R * chin);
    ctx.bezierCurveTo(face === 'wedge' ? -R * 0.42 : -R * 0.62, R * chin, -R * 1.05 * cheekW, R * 0.5, -R * 1.02 * cheekW, R * 0.05);
    ctx.bezierCurveTo(-R * 0.98 * cheekW, -R * 0.55, -R * 0.62, -R * 0.97, 0, -R * 0.95);
    ctx.closePath();
  }

  function drawEar(ctx, P, s, R, L, sx, pose, time) {
    const type = P.ears;
    const big = type === 'big' ? 1.2 : type === 'huge' ? 1.5 : type === 'small' ? 0.78 : type === 'tufted' ? 1.1 : 1;
    const sz = P.earSize * s * big;
    const flat = pose.ears === 'flat' ? 1 : pose.ears === 'back' ? 0.55 : 0;
    const perk = pose.ears === 'perk' ? 1 : 0;
    const flick = sx === 1 ? (pose.earFlick || 0) * 0.35 : 0;
    ctx.save();
    ctx.translate(sx * R * 0.56, -R * 0.66);
    ctx.rotate(sx * (0.34 + flat * 0.9 - perk * 0.12) + sx * flick);
    if (type === 'fold') {
      ctx.beginPath(); ctx.moveTo(-sz * 0.55, sz * 0.25); ctx.quadraticCurveTo(-sz * 0.2, -sz * 0.55, sz * 0.5, -sz * 0.05); ctx.quadraticCurveTo(sz * 0.35, sz * 0.35, -sz * 0.55, sz * 0.25); ctx.closePath();
      ctx.fillStyle = shade(L.ear, -0.06); ctx.fill(); ctx.lineWidth = 1 * s; ctx.strokeStyle = rgba(L.line, 0.75); ctx.stroke();
      ctx.restore(); return;
    }
    const w = sz * 0.6; const h = sz;
    ctx.beginPath();
    ctx.moveTo(-w, sz * 0.25);
    ctx.bezierCurveTo(-w * 0.8, -h * 0.35, -w * 0.25, -h * 0.92, 0, -h);
    ctx.bezierCurveTo(w * 0.25, -h * 0.92, w * 0.8, -h * 0.35, w, sz * 0.25);
    ctx.closePath();
    ctx.fillStyle = furFill(ctx, L.ear, -h, sz * 0.25, 0.6); ctx.fill();
    ctx.lineWidth = 1 * s; ctx.strokeStyle = rgba(L.line, 0.8); ctx.stroke();
    // Inner ear
    ctx.beginPath();
    ctx.moveTo(-w * 0.55, sz * 0.18);
    ctx.bezierCurveTo(-w * 0.45, -h * 0.25, -w * 0.15, -h * 0.68, 0, -h * 0.74);
    ctx.bezierCurveTo(w * 0.15, -h * 0.68, w * 0.45, -h * 0.25, w * 0.55, sz * 0.18);
    ctx.closePath();
    const ig = ctx.createLinearGradient(0, -h * 0.7, 0, sz * 0.2);
    ig.addColorStop(0, shade(L.earInner, -0.1)); ig.addColorStop(1, shade(L.earInner, 0.2));
    ctx.fillStyle = ig; ctx.fill();
    // Ear fur tufts
    if (P.pattern !== 'sphynx') {
      ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 0.8 * s; ctx.lineCap = 'round';
      for (const k of [-0.25, 0, 0.25]) { ctx.beginPath(); ctx.moveTo(k * w, sz * 0.18); ctx.quadraticCurveTo(k * w * 0.6 + sx * w * 0.1, -h * 0.2, k * w * 0.3, -h * 0.4); ctx.stroke(); }
    }
    if (type === 'tufted') { ctx.strokeStyle = shade(L.ear, -0.45); ctx.lineWidth = 1.4 * s; ctx.beginPath(); ctx.moveTo(0, -h); ctx.lineTo(sx * 1 * s, -h - 5 * s); ctx.stroke(); }
    ctx.restore();
    void time;
  }

  // Front-facing head. headTurn shifts features toward the facing side for a 3/4 look.
  function drawFrontHead(ctx, P, s, pose, p, time, L, hx, hy, R, turn) {
    const tn = turn || 0; // 0 = straight at you, 1 = profile
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(pose.headTilt || 0);
    const off = tn * R * 0.38; // features slide toward the facing side
    // Far ear first (behind skull) when turned.
    drawEar(ctx, P, s, R, L, -1, pose, time);
    if (tn < 0.5) drawEar(ctx, P, s, R, L, 1, pose, time);
    headShape(ctx, R, P.face);
    ctx.fillStyle = furFill(ctx, L.base, -R, R * 0.85); ctx.fill();
    ctx.lineWidth = 1.15 * s; ctx.strokeStyle = rgba(L.line, 0.8); ctx.stroke();
    ctx.save(); ctx.clip();
    facePattern(ctx, P, s, R, L, off);
    // Soft forehead light
    const hl = ctx.createRadialGradient(-R * 0.25, -R * 0.55, R * 0.05, -R * 0.25, -R * 0.55, R * 1.1);
    hl.addColorStop(0, 'rgba(255,255,255,0.22)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl; ctx.fillRect(-R * 1.4, -R * 1.2, R * 2.8, R * 2.4);
    ctx.restore();
    if (L.fluff > 0.3) cheekRuff(ctx, s, R, L, P.face);
    if (tn >= 0.5) drawEar(ctx, P, s, R, L, 1, pose, time);
    drawMuzzle(ctx, P, s, R, L, pose, time, off, p);
    drawEyes(ctx, P, s, R, L, pose, p, time, off, tn);
    if (pose.blush || (p.cfg.accessories && p.cfg.accessories.face === 'blush')) {
      ctx.fillStyle = 'rgba(255,120,145,0.32)';
      for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(off + sx * R * 0.62, R * 0.3, R * 0.17, R * 0.09, 0, 0, TAU); ctx.fill(); }
    }
    drawFacewear(ctx, s, R, p, off);
    drawHat(ctx, s, R, p, time);
    ctx.restore();
  }

  function facePattern(ctx, P, s, R, L, off) {
    const c = L.c;
    switch (P.pattern) {
      case 'tabby': {
        ctx.strokeStyle = rgba(c.accent, 0.85); ctx.lineCap = 'round'; ctx.lineWidth = 1.9 * s;
        // The classic "M" on the forehead
        ctx.beginPath(); ctx.moveTo(off - R * 0.32, -R * 0.42); ctx.lineTo(off - R * 0.18, -R * 0.72); ctx.lineTo(off, -R * 0.5); ctx.lineTo(off + R * 0.18, -R * 0.72); ctx.lineTo(off + R * 0.32, -R * 0.42); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(off, -R * 0.5); ctx.lineTo(off, -R * 0.92); ctx.stroke();
        for (const sx of [-1, 1]) {
          for (const k of [0, 1]) { ctx.beginPath(); ctx.moveTo(sx * R * 1.02, R * (0.05 + k * 0.2)); ctx.quadraticCurveTo(sx * R * 0.85, R * (0.0 + k * 0.2), sx * R * 0.62, R * (0.08 + k * 0.16)); ctx.stroke(); }
          ctx.beginPath(); ctx.moveTo(off + sx * R * 0.58, -R * 0.08); ctx.quadraticCurveTo(off + sx * R * 0.8, -R * 0.05, off + sx * R * 0.95, -R * 0.22); ctx.stroke();
        }
        break;
      }
      case 'tuxedo': case 'bicolor': {
        ctx.fillStyle = L.belly;
        ctx.beginPath(); ctx.moveTo(off, -R * 0.35); ctx.bezierCurveTo(off + R * 0.18, -R * 0.1, off + R * 0.6, R * 0.15, off + R * 0.7, R * 0.95); ctx.lineTo(off - R * 0.7, R * 0.95); ctx.bezierCurveTo(off - R * 0.6, R * 0.15, off - R * 0.18, -R * 0.1, off, -R * 0.35); ctx.fill();
        break;
      }
      case 'calico': blotches(ctx, L, -R, -R, R * 2, R * 1.2, 2, true); break;
      case 'tortie': blotches(ctx, L, -R, -R, R * 2, R * 1.8, 5); break;
      case 'points': case 'mitted': {
        const g = ctx.createRadialGradient(off, R * 0.3, R * 0.05, off, R * 0.3, R * 0.95);
        g.addColorStop(0, rgba(c.accent, 0.95)); g.addColorStop(0.55, rgba(c.accent, 0.55)); g.addColorStop(1, rgba(c.accent, 0));
        ctx.fillStyle = g; ctx.fillRect(-R * 1.3, -R, R * 2.6, R * 2.2);
        if (P.pattern === 'mitted') { ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.ellipse(off, R * 0.75, R * 0.35, R * 0.28, 0, 0, TAU); ctx.fill(); }
        break;
      }
      case 'rosettes': spots(ctx, L, -R, -R, R * 2, R * 0.9, 6, s, false); break;
      case 'sphynx': {
        ctx.strokeStyle = rgba(c.accent, 0.6); ctx.lineWidth = 1 * s; ctx.lineCap = 'round';
        for (const k of [0, 1, 2]) { ctx.beginPath(); ctx.moveTo(off - R * 0.3, -R * (0.55 + k * 0.1)); ctx.quadraticCurveTo(off, -R * (0.62 + k * 0.1), off + R * 0.3, -R * (0.55 + k * 0.1)); ctx.stroke(); }
        break;
      }
      default: break;
    }
  }

  function blotches(ctx, L, x, y, w, h, n, earStyle) {
    const r = prng(L.seed + 11);
    const cols = [L.c.accent, L.c.accent2 || shade(L.c.accent, -0.5)];
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = cols[i % 2];
      const bx = x + r() * w; const by = y + r() * h;
      ctx.beginPath(); ctx.ellipse(earStyle && i < 2 ? x + (i === 0 ? w * 0.2 : w * 0.82) : bx, earStyle && i < 2 ? y + h * 0.18 : by, w * (0.16 + r() * 0.16), h * (0.22 + r() * 0.2), r() * 3, 0, TAU); ctx.fill();
    }
  }

  function spots(ctx, L, x, y, w, h, n, s, rings) {
    const r = prng(L.seed + 5);
    for (let i = 0; i < n; i++) {
      const sx = x + r() * w; const sy = y + r() * h; const rad = (1.6 + r() * 1.8) * s;
      if (rings) { ctx.fillStyle = rgba(L.c.accent2 || L.c.accent, 0.8); ctx.beginPath(); ctx.ellipse(sx, sy, rad * 1.6, rad * 1.3, r() * 3, 0, TAU); ctx.fill(); }
      ctx.fillStyle = rgba(L.c.accent, 0.9); ctx.beginPath(); ctx.ellipse(sx, sy, rad, rad * 0.8, r() * 3, 0, TAU); ctx.fill();
    }
  }

  function cheekRuff(ctx, s, R, L, face) {
    const cheekW = face === 'chubby' ? 1.16 : 1.06;
    ctx.fillStyle = L.base;
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(sx * R * 1.0 * cheekW, -R * 0.05);
      for (let i = 0; i < 4; i++) {
        const t = (i + 1) / 4;
        const x = sx * R * lerp(1.0 * cheekW, 0.45, t); const y = R * lerp(-0.05, 0.85, t);
        ctx.lineTo(x + sx * R * 0.2, y - R * 0.02);
        ctx.lineTo(x, y + R * 0.06);
      }
      ctx.lineTo(sx * R * 0.3, R * 0.6);
      ctx.closePath(); ctx.fill();
    }
  }

  function chestRuff(ctx, s, L, bw, neckY, R) {
    ctx.fillStyle = mix(L.base, L.belly, 0.6);
    ctx.beginPath();
    ctx.moveTo(-bw * 0.4, neckY);
    for (let i = 0; i <= 6; i++) { const t = i / 6; ctx.lineTo(lerp(-bw * 0.4, bw * 0.4, t), neckY + R * (0.9 + (i % 2) * 0.3)); }
    ctx.lineTo(bw * 0.4, neckY);
    ctx.closePath(); ctx.fill();
  }

  function patternChest(ctx, P, s, L, bw, neckY, bottom) {
    const c = L.c;
    switch (P.pattern) {
      case 'tabby':
        ctx.fillStyle = rgba(L.belly, 0.85); ctx.beginPath(); ctx.ellipse(0, lerp(neckY, bottom, 0.45), bw * 0.3, (bottom - neckY) * 0.48, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = rgba(c.accent, 0.7); ctx.lineWidth = 2 * s; ctx.lineCap = 'round';
        for (let i = 0; i < 2; i++) { const y = neckY + (bottom - neckY) * (0.18 + i * 0.16); ctx.beginPath(); ctx.moveTo(-bw * 0.3, y); ctx.quadraticCurveTo(0, y + 5 * s, bw * 0.3, y); ctx.stroke(); }
        for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(sx * bw * 0.68, neckY + (bottom - neckY) * (0.25 + i * 0.22)); ctx.quadraticCurveTo(sx * bw * 0.5, neckY + (bottom - neckY) * (0.3 + i * 0.22), sx * bw * 0.42, neckY + (bottom - neckY) * (0.38 + i * 0.22)); ctx.stroke(); }
        break;
      case 'tuxedo': case 'bicolor': case 'mitted':
        ctx.fillStyle = P.pattern === 'mitted' ? '#ffffff' : L.belly;
        ctx.beginPath(); ctx.moveTo(-bw * 0.3, neckY); ctx.quadraticCurveTo(0, neckY + 8 * s, bw * 0.3, neckY); ctx.bezierCurveTo(bw * 0.5, lerp(neckY, bottom, 0.6), bw * 0.4, bottom, 0, bottom); ctx.bezierCurveTo(-bw * 0.4, bottom, -bw * 0.5, lerp(neckY, bottom, 0.6), -bw * 0.3, neckY); ctx.fill();
        break;
      case 'calico': ctx.fillStyle = L.belly; ctx.beginPath(); ctx.ellipse(0, lerp(neckY, bottom, 0.55), bw * 0.32, (bottom - neckY) * 0.5, 0, 0, TAU); ctx.fill(); blotches(ctx, L, -bw * 0.8, neckY, bw * 1.6, (bottom - neckY), 4); break;
      case 'tortie': blotches(ctx, L, -bw * 0.7, neckY, bw * 1.4, (bottom - neckY), 7); break;
      case 'points': { ctx.fillStyle = rgba(L.belly, 0.8); ctx.beginPath(); ctx.ellipse(0, lerp(neckY, bottom, 0.5), bw * 0.32, (bottom - neckY) * 0.5, 0, 0, TAU); ctx.fill(); break; }
      case 'rosettes': ctx.fillStyle = rgba(L.belly, 0.75); ctx.beginPath(); ctx.ellipse(0, lerp(neckY, bottom, 0.5), bw * 0.28, (bottom - neckY) * 0.48, 0, 0, TAU); ctx.fill(); spots(ctx, L, -bw * 0.7, neckY, bw * 1.4, bottom - neckY, 9, s, true); break;
      case 'sphynx': { ctx.strokeStyle = rgba(c.accent, 0.5); ctx.lineWidth = 1 * s; for (let i = 0; i < 3; i++) { const y = neckY + 4 * s + i * 4 * s; ctx.beginPath(); ctx.moveTo(-bw * 0.25, y); ctx.quadraticCurveTo(0, y + 2 * s, bw * 0.25, y); ctx.stroke(); } break; }
      default: { ctx.fillStyle = rgba(L.belly, 0.45); ctx.beginPath(); ctx.ellipse(0, lerp(neckY, bottom, 0.45), bw * 0.28, (bottom - neckY) * 0.45, 0, 0, TAU); ctx.fill(); }
    }
  }

  function patternHaunch(ctx, P, s, L, hx, hy, W, seatH, sx) {
    if (P.pattern === 'tabby') {
      ctx.save(); ctx.beginPath(); ctx.ellipse(hx, hy, W * 0.36, seatH * 0.31, sx * 0.15, 0, TAU); ctx.clip();
      ctx.strokeStyle = rgba(L.c.accent, 0.75); ctx.lineWidth = 2.2 * s; ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(hx + sx * W * 0.25, hy + seatH * 0.15, W * (0.2 + i * 0.12), Math.PI * 0.9, Math.PI * 1.5); ctx.stroke(); }
      ctx.restore();
    } else if (P.pattern === 'calico' || P.pattern === 'tortie') {
      ctx.save(); ctx.beginPath(); ctx.ellipse(hx, hy, W * 0.36, seatH * 0.31, sx * 0.15, 0, TAU); ctx.clip();
      blotches(ctx, Object.assign({}, L, { seed: L.seed + (sx > 0 ? 3 : 7) }), hx - W * 0.3, hy - seatH * 0.3, W * 0.6, seatH * 0.6, 2);
      ctx.restore();
    } else if (P.pattern === 'points' || P.pattern === 'mitted') {
      ctx.save(); ctx.beginPath(); ctx.ellipse(hx, hy, W * 0.36, seatH * 0.31, sx * 0.15, 0, TAU); ctx.clip();
      const g = ctx.createLinearGradient(0, hy - seatH * 0.3, 0, hy + seatH * 0.3); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, rgba(L.c.accent, 0.35));
      ctx.fillStyle = g; ctx.fillRect(hx - W, hy - seatH, W * 2, seatH * 2); ctx.restore();
    } else if (P.pattern === 'rosettes') {
      ctx.save(); ctx.beginPath(); ctx.ellipse(hx, hy, W * 0.36, seatH * 0.31, sx * 0.15, 0, TAU); ctx.clip();
      spots(ctx, Object.assign({}, L, { seed: L.seed + (sx > 0 ? 1 : 2) }), hx - W * 0.35, hy - seatH * 0.3, W * 0.7, seatH * 0.6, 5, s, true); ctx.restore();
    }
  }

  function drawMuzzle(ctx, P, s, R, L, pose, time, off, p) {
    const flat = P.face === 'flat';
    const ny = flat ? R * 0.2 : R * 0.27;
    // Whisker pads
    ctx.fillStyle = L.muzzle;
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(off + sx * R * 0.16, ny + R * 0.2, R * 0.2, R * 0.15, 0, 0, TAU); ctx.fill(); }
    ctx.beginPath(); ctx.ellipse(off, ny + R * 0.32, R * 0.14, R * 0.1, 0, 0, TAU); ctx.fill();
    // Whiskers
    ctx.strokeStyle = L.whisker; ctx.lineWidth = 0.75 * s; ctx.lineCap = 'round';
    const tw = Math.sin(time * 1.7) * 0.02;
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const y0 = ny + R * (0.16 + k * 0.07);
        ctx.beginPath(); ctx.moveTo(off + sx * R * 0.3, y0);
        ctx.quadraticCurveTo(off + sx * R * 0.8, y0 - R * (0.08 - k * 0.07) + tw * R, off + sx * R * 1.22, y0 - R * (0.12 - k * 0.12) + tw * R * 2);
        ctx.stroke();
      }
    }
    // Nose
    const nose = L.c.nose || '#e8908c';
    const nw = R * (flat ? 0.12 : 0.15);
    ctx.beginPath();
    ctx.moveTo(off - nw, ny - nw * 0.55);
    ctx.quadraticCurveTo(off, ny - nw * 0.85, off + nw, ny - nw * 0.55);
    ctx.quadraticCurveTo(off + nw * 0.5, ny + nw * 0.45, off, ny + nw * 0.62);
    ctx.quadraticCurveTo(off - nw * 0.5, ny + nw * 0.45, off - nw, ny - nw * 0.55);
    ctx.closePath();
    ctx.fillStyle = nose; ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.ellipse(off - nw * 0.3, ny - nw * 0.35, nw * 0.28, nw * 0.16, 0, 0, TAU); ctx.fill();
    // Mouth
    const my = ny + nw * 0.62;
    const line = luminance(L.c.base) < 0.3 ? 'rgba(20,10,10,0.8)' : shade(L.line, -0.15);
    ctx.strokeStyle = line; ctx.lineWidth = Math.max(0.9, 1.1 * s);
    const m = pose.mouth;
    const talkOpen = m === 'talk' ? Math.abs(Math.sin(time * 15)) : 0;
    if (m === 'yawn' || m === 'meow' || m === 'hiss' || m === 'tongue' || m === 'munch' || talkOpen > 0.35 || m === 'hold') {
      const k = m === 'yawn' ? 1.5 : m === 'hiss' ? 1.25 : m === 'munch' ? (Math.sin(time * 18) > 0 ? 0.7 : 0.25) : m === 'talk' ? talkOpen * 0.7 : m === 'hold' ? 0.5 : 0.85;
      const ow = R * 0.17 * Math.max(0.7, k); const oh = R * 0.16 * k;
      ctx.beginPath(); ctx.moveTo(off - ow, my + oh * 0.1); ctx.quadraticCurveTo(off, my - oh * 0.2, off + ow, my + oh * 0.1);
      ctx.quadraticCurveTo(off + ow * 0.8, my + oh * 1.6, off, my + oh * 1.7); ctx.quadraticCurveTo(off - ow * 0.8, my + oh * 1.6, off - ow, my + oh * 0.1); ctx.closePath();
      ctx.fillStyle = '#6a2e36'; ctx.fill(); ctx.stroke();
      if (m !== 'hiss') { ctx.beginPath(); ctx.ellipse(off, my + oh * 1.25, ow * 0.6, oh * 0.45, 0, 0, TAU); ctx.fillStyle = '#f08a9a'; ctx.fill(); }
      if (m === 'hiss' || m === 'yawn') { ctx.fillStyle = '#fff'; for (const sx of [-1, 1]) { ctx.beginPath(); ctx.moveTo(off + sx * ow * 0.6, my + oh * 0.1); ctx.lineTo(off + sx * ow * 0.45, my + oh * 0.55); ctx.lineTo(off + sx * ow * 0.3, my + oh * 0.12); ctx.fill(); } }
    } else if (m === 'lick') {
      ctx.beginPath(); ctx.moveTo(off, my - R * 0.02); ctx.lineTo(off, my + R * 0.05); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(off + R * 0.04, my + R * 0.12, R * 0.07, R * 0.09, 0.2, 0, TAU); ctx.fillStyle = '#f08a9a'; ctx.fill();
    } else {
      // The classic cat mouth: a short line then a soft "w".
      const smile = m === 'smile' ? 1.4 : 1;
      ctx.beginPath(); ctx.moveTo(off, my - R * 0.02); ctx.lineTo(off, my + R * 0.04); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(off - R * 0.16 * smile, my + R * 0.02);
      ctx.quadraticCurveTo(off - R * 0.08, my + R * 0.11 * smile, off, my + R * 0.04);
      ctx.quadraticCurveTo(off + R * 0.08, my + R * 0.11 * smile, off + R * 0.16 * smile, my + R * 0.02);
      ctx.stroke();
      if (m === 'wobble') { ctx.beginPath(); ctx.ellipse(off, my + R * 0.13, R * 0.05, R * 0.06, 0, 0, TAU); ctx.fillStyle = '#f08a9a'; ctx.fill(); }
    }
    void p;
  }

  function drawEyes(ctx, P, s, R, L, pose, p, time, off, tn) {
    const e = P.eye * s * (P.face === 'flat' ? 1.08 : 1);
    const mode = pose.eyes;
    const lx = clamp((p.anim ? p.anim.lookX : 0) * (p.facing || 1), -1, 1);
    const ly = clamp(p.anim ? p.anim.lookY : 0, -1, 1);
    const spread = R * (P.face === 'wedge' ? 0.4 : 0.43) * (1 - tn * 0.25);
    const eyes = [{ x: off - spread, y: -R * 0.06, k: 1 - tn * 0.18, col: L.c.eye }, { x: off + spread, y: -R * 0.06, k: 1, col: L.c.eye2 || L.c.eye }];
    const dark = luminance(L.c.base) < 0.3;
    const lineCol = dark ? '#0d0a0b' : '#2b201f';
    for (const ey of eyes) {
      const w = e * 1.08 * ey.k; const h = e * 1.18;
      ctx.save();
      ctx.translate(ey.x, ey.y);
      ctx.lineCap = 'round';
      ctx.strokeStyle = lineCol; ctx.lineWidth = Math.max(1.1, 1.35 * s);
      if (mode === 'closed' || mode === 'blink') {
        ctx.beginPath(); ctx.moveTo(-w, 0); ctx.quadraticCurveTo(0, h * 0.55, w, 0); ctx.stroke();
      } else if (mode === 'happy') {
        ctx.beginPath(); ctx.moveTo(-w, h * 0.25); ctx.quadraticCurveTo(0, -h * 0.65, w, h * 0.25); ctx.stroke();
      } else if (mode === 'x') {
        ctx.beginPath(); ctx.moveTo(-w * 0.7, -h * 0.6); ctx.lineTo(w * 0.7, h * 0.6); ctx.moveTo(w * 0.7, -h * 0.6); ctx.lineTo(-w * 0.7, h * 0.6); ctx.stroke();
      } else if (mode === 'spiral') {
        ctx.beginPath();
        for (let a = 0; a < TAU * 2; a += 0.3) { const rr = (a / (TAU * 2)) * w; const x = Math.cos(a + time * 6) * rr; const y = Math.sin(a + time * 6) * rr; if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
        ctx.stroke();
      } else {
        const wide = mode === 'wide' ? 1.12 : 1;
        // Almond eye: rounded top, flatter bottom.
        ctx.beginPath();
        ctx.moveTo(-w * wide, 0);
        ctx.bezierCurveTo(-w * wide, -h * 1.0 * wide, w * wide, -h * 1.0 * wide, w * wide, 0);
        ctx.bezierCurveTo(w * wide, h * 0.9 * wide, -w * wide, h * 0.9 * wide, -w * wide, 0);
        ctx.closePath();
        ctx.save(); ctx.clip();
        const ig = ctx.createRadialGradient(lx * w * 0.2, ly * h * 0.2 + h * 0.15, h * 0.1, 0, 0, h * 1.1);
        ig.addColorStop(0, shade(ey.col, 0.45)); ig.addColorStop(0.55, ey.col); ig.addColorStop(1, shade(ey.col, -0.45));
        ctx.fillStyle = ig; ctx.fillRect(-w * 1.5, -h * 1.5, w * 3, h * 3);
        // Pupil: a slit that opens up when excited or in the dark.
        const dil = clamp(pose.pupil != null ? pose.pupil : 0.45, 0.12, 1);
        ctx.fillStyle = '#0c0809';
        ctx.beginPath(); ctx.ellipse(lx * w * 0.32, ly * h * 0.22 + (mode === 'down' ? h * 0.35 : 0), w * (0.16 + dil * 0.52), h * (0.78 + dil * 0.06), 0, 0, TAU); ctx.fill();
        // Catchlights
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath(); ctx.ellipse(-w * 0.32 + lx * w * 0.12, -h * 0.38, w * 0.3, h * 0.26, -0.4, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(w * 0.34, h * 0.32, w * 0.13, 0, TAU); ctx.fill();
        // Eyelid: sleepy, slow-blink, sad.
        let lid = pose.lid || 0;
        if (mode === 'sad') lid = Math.max(lid, 0.35);
        if (lid > 0.01) {
          ctx.fillStyle = shade(L.face && P.pattern === 'points' ? L.c.accent : L.base, -0.05);
          ctx.beginPath(); ctx.moveTo(-w * 1.5, -h * 1.5); ctx.lineTo(w * 1.5, -h * 1.5);
          const ly2 = -h * 1.0 + lid * h * 1.9;
          ctx.lineTo(w * 1.5, ly2 - (mode === 'sad' ? h * 0.3 : 0)); ctx.quadraticCurveTo(0, ly2 + h * 0.25, -w * 1.5, ly2 + (mode === 'sad' ? h * 0.1 : 0)); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = lineCol; ctx.lineWidth = Math.max(1, 1.2 * s);
          ctx.beginPath(); ctx.moveTo(-w * 1.05, ly2 + (mode === 'sad' ? h * 0.1 : 0)); ctx.quadraticCurveTo(0, ly2 + h * 0.25, w * 1.05, ly2 - (mode === 'sad' ? h * 0.3 : 0)); ctx.stroke();
        }
        ctx.restore();
        // Upper lash line
        ctx.strokeStyle = lineCol; ctx.lineWidth = Math.max(1.1, 1.5 * s);
        ctx.beginPath(); ctx.moveTo(-w * wide * 1.02, h * 0.02); ctx.bezierCurveTo(-w * wide, -h * 1.0 * wide, w * wide, -h * 1.0 * wide, w * wide * 1.08, -h * 0.08); ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ================================================================ SIDE

  function drawSide(ctx, P, s, pose, p, time, L, opts, frame) {
    const R = P.headR * s;
    const Lb = P.bodyLen * s; const H = P.bodyH * s; const LL = P.legLen * s; const LW = P.legW * s;
    const phase = (p.anim && p.anim.phase) || 0;
    const legs = pose.legs;
    let bx = 0; let by = -(LL + H * 0.5) - (pose.bodyLift || 0) * s; let ba = pose.bodyAngle || 0;
    let bodyL = Lb; let bodyH = H * (1 + (pose.puff || 0) * 0.12);

    if (legs === 'walk' || legs === 'run') {
      const run = legs === 'run';
      by += Math.sin(phase * 2) * (run ? 2.4 : 0.9) * s;
      if (run) { ba += Math.sin(phase * 2) * 0.07; bodyL *= 1.08; }
    } else if (legs === 'crouch') {
      by = -(LL * 0.42 + H * 0.5); ba = -0.04; bx = (pose.wiggle || 0) * 0;
    } else if (legs === 'bow') {
      by = -(LL * 0.8 + H * 0.5) + (pose.bow || 0) * LL * 0.25; ba = 0.3 * (pose.bow || 0);
    } else if (legs === 'tuck' || legs === 'up') {
      by = -(H * 0.5 + LL * 0.15);
    } else if (legs === 'scratch') {
      ba = -1.15; bx = -Lb * 0.18; by = -(LL * 0.45 + Lb * 0.42);
    } else if (legs === 'arch') {
      by = -(LL * 1.05 + H * 0.5);
    } else if (legs === 'dangle') {
      ba = -Math.PI / 2 * 0.9;
      const nx = P.headX * s * 0.8; const ny = -H * 0.42;
      const c0 = Math.cos(ba); const s0 = Math.sin(ba);
      bx = -(nx * c0 - ny * s0); by = -(nx * s0 + ny * c0) + R * 0.4;
    }
    const cos = Math.cos(ba); const sin = Math.sin(ba);
    const T = (lx, ly) => ({ x: bx + lx * cos - ly * sin, y: by + lx * sin + ly * cos });

    const shoulder = T(bodyL * 0.3, bodyH * 0.1);
    const hip = T(-bodyL * 0.3, bodyH * 0.02);
    const neck = T(bodyL * 0.42, -bodyH * 0.38);
    const tailRoot = T(-bodyL * 0.47, -bodyH * 0.28);
    const wig = legs === 'crouch' ? (pose.wiggle || 0) * 1.6 * s : 0;

    // Feet
    const feet = sideFeet(P, s, pose, legs, phase, shoulder, hip, LL, Lb, frame, time);

    // Far legs
    drawSideLeg(ctx, s, L, feet[0], LW * 0.92, true, false);
    drawSideHindLeg(ctx, s, L, feet[2], LW * 0.95, true, LL, wig);
    // Tail
    drawSideTail(ctx, P, s, pose, L, { x: tailRoot.x + wig, y: tailRoot.y }, time, p);

    // Body
    ctx.save();
    ctx.translate(bx + wig * 0.5, by); ctx.rotate(ba);
    const rx = bodyL / 2; const ry = bodyH / 2;
    const arch = legs === 'arch' ? 1 : 0;
    ctx.beginPath();
    ctx.moveTo(-rx, -ry * 0.1);
    ctx.bezierCurveTo(-rx * 0.98, -ry * 1.05 - arch * ry * 0.9, -rx * 0.2, -ry * 1.05 - arch * ry * 1.4, rx * 0.3, -ry * 0.98 - arch * ry * 0.8);
    ctx.bezierCurveTo(rx * 0.85, -ry * 0.95, rx * 1.05, -ry * 0.35, rx * 1.0, ry * 0.15);
    ctx.bezierCurveTo(rx * 0.95, ry * 0.95, rx * 0.4, ry * 1.08, 0, ry * 0.92);
    ctx.bezierCurveTo(-rx * 0.45, ry * 0.8, -rx * 1.0, ry * 0.95, -rx, -ry * 0.1);
    ctx.closePath();
    ctx.fillStyle = furFill(ctx, L.base, -ry, ry); ctx.fill();
    ctx.lineWidth = 1.1 * s; ctx.strokeStyle = rgba(L.line, 0.78); ctx.stroke();
    ctx.save(); ctx.clip();
    sidePattern(ctx, P, s, L, rx, ry);
    ctx.restore();
    if (pose.puff) furSpikes(ctx, s, L, rx, ry, pose.puff);
    ctx.restore();

    // Thigh over the body
    const thighR = bodyH * 0.5;
    ctx.beginPath(); ctx.ellipse(hip.x + wig * 0.5, hip.y + thighR * 0.15, thighR * 0.95, thighR * 1.05, ba - 0.15, 0, TAU);
    ctx.fillStyle = furFill(ctx, L.base, hip.y - thighR, hip.y + thighR); ctx.fill();
    ctx.lineWidth = 1.05 * s; ctx.strokeStyle = rgba(L.line, 0.55); ctx.stroke();
    if (P.pattern === 'tabby') { ctx.save(); ctx.clip(); ctx.strokeStyle = rgba(L.c.accent, 0.7); ctx.lineWidth = 2.2 * s; ctx.lineCap = 'round'; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(hip.x + thighR * 0.8, hip.y + thighR * 0.4, thighR * (0.5 + i * 0.35), Math.PI * 0.95, Math.PI * 1.45); ctx.stroke(); } ctx.restore(); }

    // Near legs
    drawSideHindLeg(ctx, s, L, feet[3], LW, false, LL, wig);
    drawSideLeg(ctx, s, L, feet[1], LW, false, legs === 'scratch');

    // Head, 3/4 view
    let head = { x: neck.x + R * 0.35 + (pose.headDX || 0) * s, y: neck.y - R * 0.45 + (pose.headDY || 0) * s };
    if (legs === 'crouch') head = { x: neck.x + R * 0.5, y: neck.y - R * 0.1 };
    if (legs === 'tuck' || legs === 'up') head = { x: neck.x + R * 0.35, y: Math.min(neck.y - R * 0.3, -R * 0.9) };
    if (legs === 'dangle') head = { x: neck.x + R * 0.05, y: neck.y - R * 0.5 };
    if (legs === 'bow') head = { x: neck.x + R * 0.45, y: neck.y - R * 0.15 + (pose.bow || 0) * R * 0.45 };
    // Neck filler
    ctx.beginPath(); ctx.ellipse((neck.x + head.x) / 2, (neck.y + head.y) / 2 + R * 0.25, R * 0.58, R * 0.66, 0, 0, TAU);
    ctx.fillStyle = L.base; ctx.fill();
    drawNeckwear(ctx, s, p, (neck.x + head.x) / 2, (neck.y + head.y) / 2 + R * 0.55, R, time, false);
    drawFrontHead(ctx, P, s, pose, p, time, L, head.x, head.y, R, clamp(pose.headTurn, 0, 0.85));
    if (opts.weather) drawWeatherProp(ctx, opts.weather, s, head.x, head.y, R, time);
  }

  function sideFeet(P, s, pose, legs, phase, shoulder, hip, LL, Lb, frame, time) {
    const out = [];
    const gait = legs === 'run' ? [0, 0.4, Math.PI, Math.PI + 0.4] : [Math.PI, 0, 0, Math.PI];
    const stride = LL * (legs === 'run' ? 1.0 : 0.62);
    const lift = LL * (legs === 'run' ? 0.5 : 0.3);
    const roots = [shoulder, shoulder, hip, hip];
    for (let i = 0; i < 4; i++) {
      const r = { x: roots[i].x + (i % 2 ? 1.4 : -1.4) * s, y: roots[i].y };
      let f;
      switch (legs) {
        case 'walk': case 'run': { const ph = phase + gait[i]; f = { x: r.x + Math.sin(ph) * stride * 0.5, y: -Math.max(0, Math.cos(ph)) * lift }; break; }
        case 'crouch': f = i < 2 ? { x: r.x + LL * 0.45, y: 0 } : { x: r.x + LL * 0.25, y: 0 }; break;
        case 'bow': f = i < 2 ? { x: r.x + LL * 0.75, y: 0 } : { x: r.x - 1 * s, y: 0 }; break;
        case 'tuck': f = { x: r.x + (i < 2 ? LL * 0.6 : LL * 0.3), y: -LL * 0.05 }; break;
        case 'up': f = { x: r.x + (i < 2 ? 2 : -2) * s, y: r.y + LL * 1.05 }; break;
        case 'air': f = i < 2 ? { x: r.x + LL * 0.75, y: r.y + LL * 0.55 } : { x: r.x - LL * 0.85, y: r.y + LL * 0.5 }; break;
        case 'scratch': {
          if (i < 2) { const k = Math.sin(time * 14 + (i ? Math.PI : 0)); f = { x: r.x + LL * 0.55, y: r.y - LL * (0.7 + k * 0.25) }; } else f = { x: r.x + LL * 0.15, y: 0 };
          break;
        }
        case 'arch': f = { x: r.x + (i < 2 ? -1 : 1) * s, y: 0 }; break;
        case 'dangle': {
          const fr = frame.rot || 0; const down = { x: Math.sin(fr) * frame.face, y: Math.cos(fr) };
          const sw = Math.sin(time * 3 + i) * 0.08;
          f = { x: r.x + (down.x + sw) * LL * 1.1, y: r.y + down.y * LL * 1.1 };
          break;
        }
        default: f = { x: r.x + (i < 2 ? 1 : -1) * s, y: 0 };
      }
      out.push({ root: r, foot: f });
    }
    return out;
  }

  function drawSideLeg(ctx, s, L, leg, w, far, beans) {
    const { root, foot } = leg;
    const col = far ? shade(L.leg, -0.14) : L.leg;
    const mid = { x: lerp(root.x, foot.x, 0.55) - 1.2 * s, y: lerp(root.y, foot.y, 0.55) };
    taper(ctx, root, { x: lerp(root.x, mid.x, 0.6), y: lerp(root.y, mid.y, 0.6) }, mid, foot, w * 1.2, w * 0.85, 10);
    ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 1 * s; ctx.strokeStyle = rgba(L.line, far ? 0.5 : 0.7); ctx.stroke();
    const pc = L.paw !== L.base ? (far ? shade(L.paw, -0.1) : L.paw) : col;
    ctx.beginPath(); ctx.ellipse(foot.x + w * 0.25, foot.y - w * 0.15, w * 0.72, w * 0.5, 0, 0, TAU);
    ctx.fillStyle = pc; ctx.fill(); ctx.lineWidth = 1 * s; ctx.strokeStyle = rgba(L.line, far ? 0.5 : 0.7); ctx.stroke();
    if (beans) { ctx.fillStyle = '#f19aa6'; ctx.beginPath(); ctx.arc(foot.x + w * 0.3, foot.y - w * 0.1, w * 0.22, 0, TAU); ctx.fill(); }
  }

  // Cat hind leg: thigh, then a backward hock, then the foot.
  function drawSideHindLeg(ctx, s, L, leg, w, far, LL, wig) {
    const { root, foot } = leg;
    const r = { x: root.x + wig * 0.5, y: root.y };
    const hock = { x: foot.x - LL * 0.22, y: foot.y - LL * 0.42 };
    const knee = { x: lerp(r.x, hock.x, 0.5) + LL * 0.18, y: lerp(r.y, hock.y, 0.45) };
    const col = far ? shade(L.leg, -0.14) : L.leg;
    taper(ctx, r, knee, { x: hock.x, y: hock.y - LL * 0.05 }, hock, w * 1.5, w * 0.82, 10);
    ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 1 * s; ctx.strokeStyle = rgba(L.line, far ? 0.45 : 0.65); ctx.stroke();
    taper(ctx, hock, { x: lerp(hock.x, foot.x, 0.4), y: lerp(hock.y, foot.y, 0.4) }, { x: lerp(hock.x, foot.x, 0.8), y: lerp(hock.y, foot.y, 0.8) }, foot, w * 0.82, w * 0.8, 6);
    ctx.fillStyle = col; ctx.fill(); ctx.stroke();
    const pc = L.paw !== L.base ? (far ? shade(L.paw, -0.1) : L.paw) : col;
    ctx.beginPath(); ctx.ellipse(foot.x + w * 0.35, foot.y - w * 0.15, w * 0.78, w * 0.48, 0, 0, TAU);
    ctx.fillStyle = pc; ctx.fill(); ctx.lineWidth = 1 * s; ctx.strokeStyle = rgba(L.line, far ? 0.5 : 0.7); ctx.stroke();
  }

  function drawSideTail(ctx, P, s, pose, L, r, time, p) {
    const T = P.tailLen * s; const tw = P.tailW * s * (1 + (pose.puff || 0) * 0.9);
    const wag = Math.sin(((p.anim && p.anim.wag) || time * 5) * 0.5) * 0.5 + (pose.tailFlick || 0) * 0.3;
    let c1; let c2; let e;
    switch (pose.tail) {
      case 'level': c1 = { x: r.x - T * 0.35, y: r.y - T * 0.05 }; c2 = { x: r.x - T * 0.7, y: r.y - T * 0.12 + wag * 4 * s }; e = { x: r.x - T * 0.98, y: r.y - T * 0.28 + wag * 6 * s }; break;
      case 'low': c1 = { x: r.x - T * 0.35, y: r.y + T * 0.2 }; c2 = { x: r.x - T * 0.7, y: r.y + T * 0.28 }; e = { x: r.x - T * 0.98, y: r.y + T * 0.15 + Math.sin(time * 12) * 3 * s }; break;
      case 'down': c1 = { x: r.x - T * 0.25, y: r.y + T * 0.3 }; c2 = { x: r.x - T * 0.45, y: r.y + T * 0.65 }; e = { x: r.x - T * 0.7, y: Math.min(-2 * s, r.y + T * 0.75) }; break;
      case 'puff': c1 = { x: r.x - T * 0.15, y: r.y - T * 0.4 }; c2 = { x: r.x - T * 0.1, y: r.y - T * 0.8 }; e = { x: r.x + T * 0.05, y: r.y - T * 1.05 }; break;
      default: // 'up': the happy question-mark tail
        c1 = { x: r.x - T * 0.32, y: r.y - T * 0.08 }; c2 = { x: r.x - T * 0.42 + wag * T * 0.1, y: r.y - T * 0.85 }; e = { x: r.x - T * 0.12 + wag * T * 0.2, y: r.y - T * 0.98 };
    }
    taper(ctx, r, c1, c2, e, tw * 1.1, tw * 0.85);
    ctx.fillStyle = L.tail === L.base ? furFill(ctx, L.base, e.y, r.y + T * 0.3) : L.tail; ctx.fill();
    ctx.lineWidth = 1 * s; ctx.strokeStyle = rgba(L.line, 0.72); ctx.stroke();
    if (P.pattern === 'tabby' || P.pattern === 'rosettes' || (L.fluff > 0.5)) {
      ctx.save(); ctx.clip();
      if (P.pattern === 'tabby') { ctx.strokeStyle = rgba(L.c.accent, 0.8); ctx.lineWidth = 2.6 * s; for (let i = 1; i < 6; i++) { const q = bez(r, c1, c2, e, i / 6); ctx.beginPath(); ctx.arc(q.x, q.y, tw * 0.8, 0, TAU); ctx.stroke(); } }
      if (P.pattern === 'rosettes') { for (let i = 1; i < 6; i++) { const q = bez(r, c1, c2, e, i / 6); ctx.fillStyle = rgba(L.c.accent, 0.8); ctx.beginPath(); ctx.arc(q.x + 1.5 * s, q.y, 2 * s, 0, TAU); ctx.fill(); } }
      ctx.restore();
    }
  }

  function sidePattern(ctx, P, s, L, rx, ry) {
    const c = L.c;
    const belly = () => { ctx.fillStyle = rgba(L.belly, 0.9); ctx.beginPath(); ctx.ellipse(rx * 0.1, ry * 0.85, rx * 0.8, ry * 0.45, 0, 0, TAU); ctx.fill(); };
    switch (P.pattern) {
      case 'tabby':
        belly();
        ctx.strokeStyle = rgba(c.accent, 0.85); ctx.lineCap = 'round';
        for (let i = -3; i <= 3; i++) {
          ctx.lineWidth = (2.6 - Math.abs(i) * 0.2) * s;
          const x = i * rx * 0.24;
          ctx.beginPath(); ctx.moveTo(x - rx * 0.05, -ry * 1.05); ctx.quadraticCurveTo(x + rx * 0.08, -ry * 0.35, x - rx * 0.02, ry * 0.25); ctx.stroke();
        }
        ctx.lineWidth = 3 * s; ctx.beginPath(); ctx.moveTo(-rx, -ry * 0.92); ctx.lineTo(rx * 0.7, -ry * 0.95); ctx.stroke();
        break;
      case 'tuxedo': case 'bicolor':
        ctx.fillStyle = L.belly; ctx.beginPath(); ctx.ellipse(rx * 0.2, ry * 0.75, rx * 0.85, ry * 0.55, 0, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.ellipse(rx * 0.85, ry * 0.1, rx * 0.25, ry * 0.9, -0.2, 0, TAU); ctx.fill();
        break;
      case 'calico': belly(); blotches(ctx, L, -rx, -ry * 1.1, rx * 2, ry * 1.4, 5); break;
      case 'tortie': blotches(ctx, L, -rx, -ry, rx * 2, ry * 2, 9); break;
      case 'points': case 'mitted': {
        const g = ctx.createLinearGradient(-rx, 0, rx, 0); g.addColorStop(0, rgba(c.accent, 0.45)); g.addColorStop(0.45, rgba(c.accent, 0)); ctx.fillStyle = g; ctx.fillRect(-rx, -ry * 1.2, rx * 2, ry * 2.4);
        belly(); break;
      }
      case 'rosettes': belly(); spots(ctx, L, -rx, -ry * 1.1, rx * 2, ry * 1.5, 16, s, true); break;
      case 'sphynx': { ctx.strokeStyle = rgba(c.accent, 0.5); ctx.lineWidth = 1 * s; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(rx * (0.4 + i * 0.12), -ry * 0.7); ctx.quadraticCurveTo(rx * (0.35 + i * 0.12), 0, rx * (0.45 + i * 0.12), ry * 0.5); ctx.stroke(); } break; }
      default: { ctx.fillStyle = rgba(L.belly, 0.4); ctx.beginPath(); ctx.ellipse(rx * 0.1, ry * 0.9, rx * 0.75, ry * 0.4, 0, 0, TAU); ctx.fill(); }
    }
    // Rim light along the back, shadow along the belly.
    const g = ctx.createLinearGradient(0, -ry, 0, ry);
    g.addColorStop(0, 'rgba(255,255,255,0.14)'); g.addColorStop(0.35, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = g; ctx.fillRect(-rx - 2, -ry - 2, rx * 2 + 4, ry * 2 + 4);
  }

  function furSpikes(ctx, s, L, rx, ry, k) {
    ctx.fillStyle = L.base;
    ctx.beginPath();
    for (let i = 0; i <= 10; i++) {
      const t = i / 10; const x = lerp(-rx * 0.9, rx * 0.5, t);
      const y = -ry * (1.1 + Math.sin(t * Math.PI) * 0.9);
      ctx.moveTo(x - 3 * s, y + 4 * s); ctx.lineTo(x, y - 4 * s * k); ctx.lineTo(x + 3 * s, y + 4 * s);
    }
    ctx.fill();
  }

  // ---------------------------------------------------------- accessories

  function drawHat(ctx, s, R, p, time) {
    const acc = p.cfg.accessories || {};
    const hat = acc.hat || 'none';
    if (hat === 'none') return;
    const col = acc.hatColor || '#e8516b';
    ctx.save();
    ctx.lineWidth = 1 * s; ctx.strokeStyle = 'rgba(40,30,30,0.55)';
    switch (hat) {
      case 'bow': {
        ctx.translate(R * 0.42, -R * 0.78); ctx.rotate(0.25);
        ctx.fillStyle = col;
        for (const sx of [-1, 1]) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(sx * R * 0.25, -R * 0.3, sx * R * 0.45, -R * 0.15, sx * R * 0.42, 0); ctx.bezierCurveTo(sx * R * 0.45, R * 0.15, sx * R * 0.25, R * 0.3, 0, 0); ctx.fill(); ctx.stroke(); }
        ctx.beginPath(); ctx.arc(0, 0, R * 0.09, 0, TAU); ctx.fillStyle = shade(col, -0.25); ctx.fill();
        break;
      }
      case 'flower': {
        ctx.translate(-R * 0.48, -R * 0.75);
        for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.ellipse(Math.cos(i * TAU / 5) * R * 0.15, Math.sin(i * TAU / 5) * R * 0.15, R * 0.13, R * 0.09, i * TAU / 5, 0, TAU); ctx.fillStyle = col; ctx.fill(); }
        ctx.beginPath(); ctx.arc(0, 0, R * 0.08, 0, TAU); ctx.fillStyle = '#ffd34d'; ctx.fill();
        break;
      }
      case 'beanie':
        ctx.translate(0, -R * 0.7);
        ctx.beginPath(); ctx.ellipse(0, R * 0.12, R * 0.88, R * 0.6, 0, Math.PI, TAU); ctx.closePath(); ctx.fillStyle = col; ctx.fill(); ctx.stroke();
        ctx.fillStyle = shade(col, -0.2); ctx.fillRect(-R * 0.9, R * 0.02, R * 1.8, R * 0.2);
        ctx.beginPath(); ctx.arc(0, -R * 0.52, R * 0.17, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill();
        break;
      case 'party':
        ctx.translate(R * 0.1, -R * 0.82); ctx.rotate(0.15);
        ctx.beginPath(); ctx.moveTo(-R * 0.38, R * 0.08); ctx.lineTo(0, -R * 1.05); ctx.lineTo(R * 0.38, R * 0.08); ctx.closePath(); ctx.fillStyle = col; ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ffd34d'; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(-R * 0.12 + i * R * 0.12, -R * 0.15 - i * R * 0.25, R * 0.06, 0, TAU); ctx.fill(); }
        ctx.beginPath(); ctx.arc(0, -R * 1.08, R * 0.12, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill();
        break;
      case 'crown':
        ctx.translate(0, -R * 0.88);
        ctx.beginPath(); ctx.moveTo(-R * 0.42, R * 0.05); ctx.lineTo(-R * 0.48, -R * 0.38); ctx.lineTo(-R * 0.2, -R * 0.15); ctx.lineTo(0, -R * 0.5); ctx.lineTo(R * 0.2, -R * 0.15); ctx.lineTo(R * 0.48, -R * 0.38); ctx.lineTo(R * 0.42, R * 0.05); ctx.closePath();
        ctx.fillStyle = '#f5c542'; ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#e8516b'; ctx.beginPath(); ctx.arc(0, -R * 0.1, R * 0.07, 0, TAU); ctx.fill();
        break;
      case 'witch':
        ctx.translate(0, -R * 0.8);
        ctx.beginPath(); ctx.ellipse(0, R * 0.05, R * 0.95, R * 0.16, 0, 0, TAU); ctx.fillStyle = '#3b2b5a'; ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-R * 0.42, 0); ctx.quadraticCurveTo(0, -R * 0.75, R * 0.25, -R * 1.3); ctx.quadraticCurveTo(R * 0.12, -R * 0.55, R * 0.42, 0); ctx.closePath(); ctx.fillStyle = '#4a3672'; ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#f5c542'; ctx.fillRect(-R * 0.4, -R * 0.18, R * 0.8, R * 0.12);
        break;
      case 'santa':
        ctx.translate(0, -R * 0.75); ctx.rotate(-0.12);
        ctx.beginPath(); ctx.moveTo(-R * 0.6, R * 0.1); ctx.quadraticCurveTo(0, -R * 1.15, R * 0.85, -R * 0.5); ctx.lineTo(R * 0.6, R * 0.1); ctx.closePath(); ctx.fillStyle = '#d93a3a'; ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(0, R * 0.08, R * 0.68, R * 0.16, 0, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(R * 0.88, -R * 0.48, R * 0.15, 0, TAU); ctx.fill();
        break;
      case 'halo':
        ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 2.4 * s; ctx.globalAlpha = 0.85 + Math.sin(time * 3) * 0.15;
        ctx.beginPath(); ctx.ellipse(0, -R * 1.35 + Math.sin(time * 2) * 1.5 * s, R * 0.55, R * 0.15, 0, 0, TAU); ctx.stroke();
        break;
      default: break;
    }
    ctx.restore();
  }

  function drawFacewear(ctx, s, R, p, off) {
    const face = (p.cfg.accessories || {}).face;
    if (!face || face === 'none' || face === 'blush') return;
    ctx.save();
    ctx.lineWidth = 1.4 * s; ctx.strokeStyle = '#2a2222';
    const sp = R * 0.43; const r = R * 0.28;
    for (const sx of [-1, 1]) {
      ctx.beginPath(); ctx.arc(off + sx * sp, -R * 0.06, r, 0, TAU);
      if (face === 'sunglasses') { ctx.fillStyle = 'rgba(20,20,30,0.88)'; ctx.fill(); }
      ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(off - sp + r, -R * 0.1); ctx.quadraticCurveTo(off, -R * 0.18, off + sp - r, -R * 0.1); ctx.stroke();
    ctx.restore();
  }

  function drawNeckwear(ctx, s, p, cx, cy, R, time, front) {
    const acc = p.cfg.accessories || {};
    const neck = acc.neck;
    if (!neck || neck === 'none') return;
    const col = acc.neckColor || '#3d7be8';
    ctx.save();
    ctx.lineCap = 'round';
    const w = R * (front ? 0.7 : 0.55);
    if (neck === 'collar' || neck === 'bell') {
      ctx.strokeStyle = col; ctx.lineWidth = 3 * s;
      ctx.beginPath(); ctx.moveTo(cx - w, cy - R * 0.08); ctx.quadraticCurveTo(cx, cy + R * 0.2, cx + w, cy - R * 0.08); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy + R * 0.2, (neck === 'bell' ? 3.4 : 2.8) * s, 0, TAU);
      ctx.fillStyle = neck === 'bell' ? '#f5c542' : '#d8dde6'; ctx.fill(); ctx.lineWidth = 0.8 * s; ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.stroke();
      if (neck === 'bell') { ctx.beginPath(); ctx.moveTo(cx - 2 * s, cy + R * 0.22); ctx.lineTo(cx + 2 * s, cy + R * 0.22); ctx.stroke(); }
    } else if (neck === 'bandana') {
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(cx - w, cy - R * 0.1); ctx.quadraticCurveTo(cx, cy, cx + w, cy - R * 0.1); ctx.lineTo(cx, cy + R * 0.55); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(cx + (i - 1) * R * 0.2, cy + R * 0.08 + (i === 1 ? R * 0.18 : 0), 0.9 * s, 0, TAU); ctx.fill(); }
    } else if (neck === 'scarf') {
      ctx.strokeStyle = col; ctx.lineWidth = 5 * s;
      ctx.beginPath(); ctx.moveTo(cx - w, cy - R * 0.12); ctx.quadraticCurveTo(cx, cy + R * 0.12, cx + w, cy - R * 0.12); ctx.stroke();
      const flap = Math.sin(time * 4) * 2 * s;
      ctx.lineWidth = 4 * s; ctx.beginPath(); ctx.moveTo(cx + w * 0.4, cy); ctx.lineTo(cx + w * 0.55 + flap, cy + R * 0.65); ctx.stroke();
    } else if (neck === 'bowtie') {
      ctx.fillStyle = col;
      for (const sx of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx, cy + R * 0.05); ctx.lineTo(cx + sx * R * 0.32, cy - R * 0.12); ctx.lineTo(cx + sx * R * 0.32, cy + R * 0.22); ctx.closePath(); ctx.fill(); }
      ctx.beginPath(); ctx.arc(cx, cy + R * 0.05, R * 0.07, 0, TAU); ctx.fillStyle = shade(col, -0.3); ctx.fill();
    }
    ctx.restore();
  }

  function drawLaptop(ctx, s, W) {
    ctx.save();
    const x = 0; const y = -2 * s;
    ctx.fillStyle = '#c9ced6'; ctx.strokeStyle = '#8a9099'; ctx.lineWidth = 1 * s;
    ctx.beginPath(); ctx.moveTo(x - W * 0.55, y); ctx.lineTo(x + W * 0.55, y); ctx.lineTo(x + W * 0.5, y - 3 * s); ctx.lineTo(x - W * 0.5, y - 3 * s); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#2b3140';
    ctx.beginPath(); ctx.moveTo(x - W * 0.48, y - 3 * s); ctx.lineTo(x + W * 0.48, y - 3 * s); ctx.lineTo(x + W * 0.44, y - 3 * s - W * 0.55); ctx.lineTo(x - W * 0.44, y - 3 * s - W * 0.55); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#7fb3ff'; ctx.globalAlpha = 0.7; ctx.fillRect(x - W * 0.38, y - 3 * s - W * 0.48, W * 0.76, W * 0.4); ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawWeatherProp(ctx, weather, s, hx, hy, R, time) {
    const cond = weather && weather.condition;
    if (cond === 'rain' || cond === 'drizzle' || cond === 'storm') {
      ctx.save();
      const x = hx - R * 0.15; const top = hy - R * 2.6;
      ctx.strokeStyle = '#6b5a4a'; ctx.lineWidth = 1.6 * s;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, hy + R * 0.9); ctx.stroke();
      const w = R * 2.2;
      ctx.beginPath(); ctx.moveTo(x - w, top + 4 * s); ctx.quadraticCurveTo(x, top - w * 0.9, x + w, top + 4 * s);
      for (let i = 3; i >= 0; i--) ctx.quadraticCurveTo(x - w + (i + 0.5) * (w / 2), top - 2 * s, x - w + i * (w / 2), top + 4 * s);
      ctx.fillStyle = '#e8516b'; ctx.fill(); ctx.strokeStyle = shade('#e8516b', -0.35); ctx.stroke();
      ctx.restore();
    }
    void time;
  }

  return { drawPet, computePose, shade, mix, hexToRgb, luminance, hashStr, taper };
});
