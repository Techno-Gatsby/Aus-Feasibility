/*
 * Live animated cat previews for the Control Center (cards, editor, adoption gallery).
 * Each preview runs a tiny private world so cats idle, blink, groom and wander in place.
 */
(function () {
  'use strict';
  const E = window.PawsEngine; const D = window.PawsDraw; const SP = window.PawsSprites;
  const previews = new Set();
  let raf = null;
  let last = performance.now();

  function mount(canvas, cfg, opts) {
    const o = opts || {};
    const pv = { canvas, cfg: Object.assign({ id: 'pv' + Math.random().toString(36).slice(2) }, cfg), o, world: null, pet: null, visible: true };
    build(pv);
    previews.add(pv);
    if ('IntersectionObserver' in window) {
      pv.io = new IntersectionObserver((ents) => { pv.visible = ents.some((e) => e.isIntersecting); });
      pv.io.observe(canvas);
    }
    if (o.interactive) {
      canvas.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); E.setCursor(pv.world, e.clientX - r.left, e.clientY - r.top, true); E.pointerMove(pv.world, e.clientX - r.left, e.clientY - r.top); });
      canvas.addEventListener('pointerleave', () => E.setCursor(pv.world, -999, -999, false));
      canvas.addEventListener('click', (e) => { const r = canvas.getBoundingClientRect(); E.pointerDown(pv.world, e.clientX - r.left, e.clientY - r.top); E.pointerUp(pv.world, e.clientX - r.left, e.clientY - r.top); });
    }
    if (!raf) raf = requestAnimationFrame(loop);
    return {
      update(next) { pv.cfg = Object.assign({}, pv.cfg, next); if (pv.pet) E.updatePetConfig(pv.world, pv.cfg); },
      state(s, data) { if (pv.pet) E.setState(pv.world, pv.pet, s, data); },
      command(c) { if (pv.pet) E.command(pv.world, pv.pet.id, c); },
      destroy() { previews.delete(pv); if (pv.io) pv.io.disconnect(); },
      get pet() { return pv.pet; },
    };
  }

  function build(pv) {
    const c = pv.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth || c.width; const h = c.clientHeight || c.height;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    pv.dpr = dpr; pv.w = w; pv.h = h;
    pv.world = E.createWorld({ width: w, height: h, floor: h - (pv.o.floorPad != null ? pv.o.floorPad : 10), ceiling: 0, seed: Math.floor(Math.random() * 1e9), settings: { climb: false, walkOff: false, chase: !!pv.o.interactive, scale: 1 } });
    const scale = pv.o.scale || 1;
    pv.cfg.size = (pv.cfg.size || 1) * scale;
    pv.pet = E.addPet(pv.world, pv.cfg, { x: w / 2 });
    pv.pet.mode = pv.o.roam ? 'roam' : 'stay';
    pv.pet.facing = 1;
    if (pv.o.state) E.setState(pv.world, pv.pet, pv.o.state);
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    for (const pv of previews) {
      if (!pv.visible || !pv.canvas.isConnected) continue;
      const c = pv.canvas;
      if (c.clientWidth && Math.abs(c.clientWidth - pv.w) > 1) { const st = pv.pet && pv.pet.state; build(pv); if (st) E.setState(pv.world, pv.pet, pv.o.state || 'sit'); }
      E.step(pv.world, dt);
      E.drainEvents(pv.world);
      if (pv.o.state && pv.pet.state !== pv.o.state && ['idle', 'walk'].includes(pv.pet.state) && pv.o.lockState) E.setState(pv.world, pv.pet, pv.o.state);
      const ctx = c.getContext('2d');
      ctx.setTransform(pv.dpr, 0, 0, pv.dpr, 0, 0);
      ctx.clearRect(0, 0, pv.w, pv.h);
      try {
        if (!pv.cfg.kind || pv.cfg.kind === 'procedural') D.drawPet(ctx, pv.pet, now / 1000, {});
        else SP.drawAssetPet(ctx, pv.pet, now / 1000);
      } catch (e) { /* keep other previews alive */ }
    }
    for (const pv of [...previews]) if (!pv.canvas.isConnected) previews.delete(pv);
    if (!previews.size) { cancelAnimationFrame(raf); raf = null; }
  }

  // Static thumbnail (data URL) of a cat in a pose, for menus and certificates.
  function snapshot(cfg, w, h, state, t) {
    const c = document.createElement('canvas');
    const dpr = 2; c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext('2d'); ctx.scale(dpr, dpr);
    const world = E.createWorld({ width: w, height: h, floor: h - 6, seed: 3 });
    const p = E.addPet(world, Object.assign({ id: 'snap' }, cfg), { x: w / 2 });
    p.facing = 1;
    E.setState(world, p, state || 'sit');
    p.t = t || 0.6;
    if (!cfg.kind || cfg.kind === 'procedural') D.drawPet(ctx, p, t || 0.6, { noShadow: false });
    else SP.drawAssetPet(ctx, p, t || 0.6);
    return c.toDataURL('image/png');
  }

  window.PawsPreview = { mount, snapshot };
})();
