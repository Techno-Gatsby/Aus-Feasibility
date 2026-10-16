/*
 * OpenPaws overlay: one transparent, click-through window per display. Runs the pet world,
 * draws it, and turns mouse input into petting, dragging, throwing and menu actions.
 */
(function () {
  'use strict';
  const E = window.PawsEngine; const D = window.PawsDraw; const SP = window.PawsSprites;
  const FX = window.PawsEffects; const SND = window.PawsSound; const S = window.PawsSpecies;
  const paws = window.paws;

  const canvas = document.getElementById('world');
  const ctx = canvas.getContext('2d');
  const ui = document.getElementById('ui');

  let world = E.createWorld({ width: innerWidth, height: innerHeight, floor: innerHeight - 4 });
  const fx = FX.createEffects();
  let settings = { sounds: true, volume: 0.5, weatherEffects: true, weatherGear: true, voice: 'animalese', showNames: true };
  let weather = null;
  let interactive = false;
  let lastT = performance.now();
  let frameSkip = 0;
  const bubbles = new Map();
  let orb = null;
  let hoverTag = null;
  let chip = null;
  let focusInfo = null;
  let pendingEvents = [];
  let mouse = { x: -1, y: -1 };
  let dpr = 1;

  // ------------------------------------------------------------- setup

  function resize() {
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
  }
  addEventListener('resize', resize);
  resize();

  // Photo cats only catch clicks on their opaque pixels.
  const hitFilter = (p, x, y) => (!p.cfg.kind || p.cfg.kind === 'procedural') ? true : SP.alphaHit(p, x, y);
  world.hitFilter = hitFilter;

  function applySettings(s) {
    settings = Object.assign(settings, s || {});
    Object.assign(world.settings, {
      speed: settings.speed ?? world.settings.speed, gravity: settings.gravity ?? world.settings.gravity,
      scale: settings.scale ?? world.settings.scale, climb: settings.climb ?? world.settings.climb,
      ceiling: settings.ceiling ?? world.settings.ceiling, roam: settings.roamDisplays ?? world.settings.roam,
      chase: settings.chaseCursor ?? world.settings.chase, interactions: settings.petInteractions ?? world.settings.interactions,
      walkOff: settings.walkOff ?? world.settings.walkOff, quiet: settings.quiet ?? world.settings.quiet,
    });
    for (const p of world.pets) E.updatePetConfig(world, p.cfg);
    SND.setEnabled(settings.sounds !== false);
    SND.setVolume(settings.volume ?? 0.5);
    applyWeather();
  }

  function init(data) {
    const pets = world.pets.map((p) => p);
    world = E.createWorld({
      width: data.width || innerWidth, height: data.height || innerHeight,
      floor: data.floor, ceiling: data.ceiling, left: data.left, right: data.right, edges: data.edges,
      settings: world.settings,
    });
    world.hitFilter = hitFilter;
    applySettings(data.settings);
    syncPets(data.pets || [], pets);
    if (data.weather) { weather = data.weather; applyWeather(); }
    if (data.mood) applyMood(data.mood);
  }

  // Keep the world's pets in step with the list main says live on this display.
  function syncPets(list, previous) {
    const byId = new Map(list.map((c) => [c.id, c]));
    for (const p of world.pets.slice()) if (!byId.has(p.id)) { E.removePet(world, p.id); dropBubble(p.id); }
    for (const cfg of list) {
      const existing = E.getPet(world, cfg.id);
      if (existing) { E.updatePetConfig(world, cfg); continue; }
      const prev = previous && previous.find((p) => p.id === cfg.id);
      const p = E.addPet(world, cfg, prev ? { x: prev.x, facing: prev.facing } : { fromTop: !!cfg._spawnFromTop });
      p.mode = cfg.mode || 'roam';
    }
  }

  function applyMood(m) {
    world.mood.focus = !!(m && m.focus);
    world.mood.away = !!(m && m.away);
    world.mood.night = !!(m && m.night);
    focusInfo = m && m.focus ? m.focus : null;
    if (m && m.away) for (const p of world.pets) if (p.surface === 'floor' && !['sleep', 'held', 'away', 'transit'].includes(p.state)) E.setState(world, p, 'sleep');
  }

  function applyWeather() {
    const cond = weather && weather.condition;
    if (settings.weatherEffects && (cond === 'rain' || cond === 'drizzle' || cond === 'storm')) FX.setWeather(fx, 'rain', cond === 'drizzle' ? 0.35 : cond === 'storm' ? 0.9 : 0.6);
    else if (settings.weatherEffects && cond === 'snow') FX.setWeather(fx, 'snow', 0.6);
    else FX.setWeather(fx, null);
  }

  // --------------------------------------------------------------- IPC

  paws.on('overlay:init', init);
  paws.on('overlay:pets', (list) => syncPets(list));
  paws.on('overlay:settings', applySettings);
  paws.on('overlay:weather', (w) => { weather = w; applyWeather(); });
  paws.on('overlay:mood', applyMood);
  paws.on('overlay:bounds', (b) => E.setBounds(world, b));
  paws.on('overlay:cursor', (c) => {
    if (!c) return;
    E.setCursor(world, c.x, c.y, c.inside);
    if (c.inside) updateInteractive(c.x, c.y);
    else if (interactive && !world.pointer) setInteractive(false);
  });
  paws.on('overlay:command', ({ petId, cmd }) => runCommand(petId, cmd));
  paws.on('overlay:say', (m) => say(m));
  paws.on('overlay:toast', (t) => toast(t));
  paws.on('overlay:arrive', ({ cfg, side, snapshot }) => {
    if (E.getPet(world, cfg.id)) E.removePet(world, cfg.id);
    const x = side === 'left' ? world.left - 10 : world.right + 10;
    const p = E.addPet(world, cfg, { x, facing: side === 'left' ? 1 : -1 });
    const b = { min: world.left + p.dims.w / 2, max: world.right - p.dims.w / 2 };
    E.setState(world, p, 'walk', { tx: side === 'left' ? b.min + 120 : b.max - 120 });
    void snapshot;
  });

  function runCommand(petId, cmd) {
    if (!cmd) return;
    switch (cmd.type) {
      case 'toy': E.setToy(world, cmd.kind); if (cmd.kind) setTimeout(() => { if (world.toy && world.toy.kind === cmd.kind) E.setToy(world, null); }, (cmd.seconds || 45) * 1000); return;
      case 'confetti': FX.spawn(fx, 'confetti', cmd.x != null ? cmd.x : world.width / 2, cmd.y != null ? cmd.y : world.floor - 200, { count: 90 }); SND.play('success'); return;
      case 'bath': {
        const p = E.getPet(world, petId); if (!p) return;
        FX.spawn(fx, 'bubbles', p.x, p.y - p.dims.h * 0.6); setTimeout(() => FX.spawn(fx, 'bubbles', p.x, p.y - p.dims.h * 0.5), 500);
        if (p.surface === 'floor') E.setState(world, p, 'enjoy');
        return;
      }
      case 'all': for (const p of world.pets) E.command(world, p.id, cmd.cmd); return;
      default: break;
    }
    const targets = petId === '*' ? world.pets.map((p) => p.id) : [petId];
    for (const id of targets) E.command(world, id, cmd);
  }

  // ------------------------------------------------------------- input

  function overUI(x, y) {
    const els = ui.querySelectorAll('.bubble, .orb button, .toast');
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 4 && y <= r.bottom + 4) return true;
    }
    return false;
  }

  function setInteractive(v) {
    if (v === interactive) return;
    interactive = v;
    paws.send('overlay:interactive', v);
  }

  function updateInteractive(x, y) {
    const want = !!world.pointer || E.wantsPointer(world, x, y, 8) || overUI(x, y);
    setInteractive(want);
    updateHover(x, y);
  }

  canvas.addEventListener('mousemove', (e) => {
    mouse = { x: e.clientX, y: e.clientY };
    E.setCursor(world, e.clientX, e.clientY, true);
    E.pointerMove(world, e.clientX, e.clientY);
    updateInteractive(e.clientX, e.clientY);
  });
  ui.addEventListener('mousemove', (e) => updateInteractive(e.clientX, e.clientY));

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const hit = E.pointerDown(world, e.clientX, e.clientY);
    if (!hit && orb) closeOrb();
    SND.play('pop', { minGap: 120 });
  });
  addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    const res = E.pointerUp(world, e.clientX, e.clientY);
    if (res && res.kind === 'click') toggleOrb(res.petId);
    updateInteractive(e.clientX, e.clientY);
  });
  canvas.addEventListener('dblclick', (e) => {
    const hit = E.hitTest(world, e.clientX, e.clientY);
    if (hit && hit.kind === 'pet') { closeOrb(); paws.send('overlay:openChat', { petId: hit.id }); }
  });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const hit = E.hitTest(world, e.clientX, e.clientY);
    paws.send('overlay:contextmenu', { petId: hit && hit.kind === 'pet' ? hit.id : null });
  });

  // --------------------------------------------------------- the orb menu

  function orbActions(p) {
    const known = E.knownTricks(p);
    const asleep = p.state === 'sleep';
    const acts = [
      { id: 'chat', icon: '💬', label: 'Chat' },
      { id: 'feed', icon: '🍖', label: 'Feed' },
      { id: 'treat', icon: '🍪', label: 'Treat' },
      { id: 'ball', icon: '⚾', label: 'Fetch' },
      { id: 'wand', icon: '🪶', label: 'Wand' },
      { id: 'tricks', icon: '✨', label: known.length ? 'Tricks' : 'Train' },
      { id: 'remind', icon: '⏰', label: 'Remind me' },
      { id: asleep ? 'wake' : 'nap', icon: asleep ? '☀️' : '😴', label: asleep ? 'Wake up' : 'Nap' },
      { id: 'walk', icon: '🚶', label: 'Walk' },
      { id: 'more', icon: '⋯', label: 'More' },
    ];
    return acts;
  }

  function toggleOrb(petId) {
    if (orb && orb.petId === petId) return closeOrb();
    openOrb(petId, null);
  }

  function openOrb(petId, sub) {
    closeOrb();
    const p = E.getPet(world, petId);
    if (!p) return;
    const el = document.createElement('div');
    el.className = 'orb';
    const halo = document.createElement('div'); halo.className = 'halo'; el.appendChild(halo);
    const acts = sub === 'tricks' ? trickActions(p) : orbActions(p);
    const n = acts.length;
    // Big enough that n 40px buttons fit on a half circle with a little air between them.
    const radius = Math.max(p.dims.h * 0.9, (n * 48) / Math.PI);
    acts.forEach((a, i) => {
      // Arc over the top of the pet, from left to right.
      const ang = Math.PI + (Math.PI * (i + 0.5)) / n;
      const b = document.createElement('button');
      b.style.left = Math.cos(ang) * radius + 'px';
      b.style.top = Math.sin(ang) * radius * 0.9 + 'px';
      b.style.animationDelay = (i * 0.025) + 's';
      b.innerHTML = `<span aria-hidden="true">${a.icon}</span><span class="lbl">${escapeHtml(a.label)}</span>`;
      b.title = a.label;
      b.addEventListener('click', (e) => { e.stopPropagation(); orbAction(p, a); });
      el.appendChild(b);
    });
    ui.appendChild(el);
    orb = { petId, el, until: performance.now() + 8000 };
    positionOrb();
  }

  function trickActions(p) {
    const known = new Set(E.knownTricks(p));
    const list = S.TRICKS.filter((t) => known.has(t.id)).map((t) => ({ id: 'trick:' + t.id, icon: t.emoji, label: t.label }));
    list.push({ id: 'train', icon: '🎓', label: 'Train' });
    list.unshift({ id: 'back', icon: '↩', label: 'Back' });
    return list;
  }

  function orbAction(p, a) {
    if (a.id === 'tricks') {
      if (!E.knownTricks(p).length) { closeOrb(); paws.send('overlay:menu', { petId: p.id, action: 'train' }); return; }
      return openOrb(p.id, 'tricks');
    }
    if (a.id === 'back') return openOrb(p.id, null);
    if (a.id === 'more') { closeOrb(); paws.send('overlay:contextmenu', { petId: p.id }); return; }
    closeOrb();
    SND.play('pop');
    paws.send('overlay:menu', { petId: p.id, action: a.id });
  }

  function closeOrb() {
    if (!orb) return;
    orb.el.remove();
    orb = null;
  }

  function positionOrb() {
    if (!orb) return;
    const p = E.getPet(world, orb.petId);
    if (!p || p.hidden) return closeOrb();
    const b = E.hitBox(p);
    const cx = Math.min(world.width - 90, Math.max(90, b.x + b.w / 2));
    const cy = Math.max(110, b.y + b.h * 0.55);
    orb.el.style.left = cx + 'px';
    orb.el.style.top = cy + 'px';
    if (performance.now() > orb.until && !overUI(mouse.x, mouse.y)) closeOrb();
  }

  // ---------------------------------------------------------- bubbles

  function say(m) {
    const p = m.petId === '*' ? world.pets[0] : E.getPet(world, m.petId);
    if (!p || !m.text) return;
    dropBubble(p.id);
    const el = document.createElement('div');
    el.className = 'bubble';
    const who = document.createElement('div');
    who.className = 'who' + (m.kind ? ' kind-' + m.kind : '');
    who.textContent = (m.kind === 'reminder' ? '⏰ ' : m.kind === 'event' ? '📅 ' : m.kind === 'weather' ? '🌤 ' : '') + (p.cfg.name || 'Pet');
    const body = document.createElement('div');
    body.className = 'text';
    el.appendChild(who); el.appendChild(body);
    if (m.actions && m.actions.length) {
      const row = document.createElement('div'); row.className = 'actions';
      m.actions.forEach((a, i) => {
        const b = document.createElement('button');
        b.textContent = a.label;
        if (i > 0) b.className = 'secondary';
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          paws.send('overlay:bubble', { petId: p.id, id: m.id, action: a.id, data: a.data });
          dropBubble(p.id);
        });
        row.appendChild(b);
      });
      el.appendChild(row);
    }
    el.addEventListener('click', () => { paws.send('overlay:bubble', { petId: p.id, id: m.id, action: 'open' }); dropBubble(p.id); });
    ui.appendChild(el);
    const text = String(m.text);
    const ttl = m.ttl || Math.min(22000, 4500 + text.length * 70) + (m.actions ? 15000 : 0);
    const bub = { el, body, text, shown: 0, until: performance.now() + ttl, petId: p.id, typing: true };
    bubbles.set(p.id, bub);
    if (m.sound) SND.play(m.sound);
    const voice = m.voice || settings.voice;
    if (m.speak !== false) {
      if (voice === 'tts') SND.speak(text, { voice: p.cfg.voice && p.cfg.voice.name, pitch: p.cfg.voice && p.cfg.voice.pitch, rate: p.cfg.voice && p.cfg.voice.rate });
      else if (voice === 'animalese') SND.babble(text.slice(0, 80), { pitch: (p.cfg.voice && p.cfg.voice.babblePitch) || (380 + 140 / (p.cfg.size || 1)) });
    }
    if (p.surface === 'floor' && ['idle', 'walk', 'sit', 'look', 'lie'].includes(p.state) && m.react !== false) {
      E.setState(world, p, m.kind === 'reminder' ? 'beg' : 'look');
    }
  }

  function dropBubble(petId) {
    const b = bubbles.get(petId);
    if (!b) return;
    bubbles.delete(petId);
    const p = E.getPet(world, petId); if (p) p.talking = false;
    b.el.classList.add('leaving');
    setTimeout(() => b.el.remove(), 200);
  }

  function positionBubbles(dt) {
    const now = performance.now();
    for (const [id, b] of bubbles) {
      const p = E.getPet(world, id);
      if (!p || p.hidden || now > b.until) { dropBubble(id); continue; }
      if (b.typing) {
        b.shown = Math.min(b.text.length, b.shown + dt * 45);
        b.body.textContent = b.text.slice(0, Math.ceil(b.shown));
        p.talking = b.shown < b.text.length;
        if (!p.talking) b.typing = false;
      }
      const box = E.hitBox(p);
      const w = b.el.offsetWidth; const h = b.el.offsetHeight;
      const cx = box.x + box.w / 2;
      let left = Math.round(cx - w / 2);
      left = Math.max(8, Math.min(world.width - w - 8, left));
      let top = Math.round(box.y - h - 12);
      const below = top < 6;
      if (below) top = Math.round(box.y + box.h + 12);
      b.el.classList.toggle('below', below);
      b.el.style.left = left + 'px';
      b.el.style.top = top + 'px';
      b.el.style.setProperty('--tail-x', Math.max(16, Math.min(w - 16, cx - left)) + 'px');
    }
  }

  function toast(t) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.style.top = (18 + ui.querySelectorAll('.toast').length * 70) + 'px';
    el.innerHTML = `<b>${escapeHtml(t.title || '')}</b>${escapeHtml(t.body || '')}`;
    el.addEventListener('click', () => { paws.send('overlay:toastClick', t); el.remove(); });
    ui.appendChild(el);
    if (t.confetti) FX.spawn(fx, 'confetti', world.width - 160, 60, { count: 70 });
    if (t.sound !== false) SND.play(t.confetti ? 'success' : 'notify');
    setTimeout(() => el.remove(), t.ttl || 6000);
  }

  function updateHover(x, y) {
    const hit = !world.pointer && E.hitTest(world, x, y);
    if (hit && hit.kind === 'pet' && settings.showNames !== false && !orb) {
      const p = hit.pet;
      if (!hoverTag) { hoverTag = document.createElement('div'); hoverTag.className = 'tag'; ui.appendChild(hoverTag); }
      const st = E.stats(p);
      const moodIcon = st.fullness < 25 ? '🍖' : st.energy < 20 ? '😴' : st.happiness > 75 ? '😊' : st.happiness < 30 ? '😢' : '🙂';
      hoverTag.innerHTML = `${escapeHtml(p.cfg.name || 'Pet')} <span class="lv">Lv ${p.cfg.level || 1}</span> ${moodIcon}`;
      hoverTag.dataset.pet = p.id;
    } else if (hoverTag) { hoverTag.remove(); hoverTag = null; }
  }

  function positionTags() {
    if (hoverTag) {
      const p = E.getPet(world, hoverTag.dataset.pet);
      if (!p || p.hidden) { hoverTag.remove(); hoverTag = null; } else {
        const b = E.hitBox(p);
        hoverTag.style.left = (b.x + b.w / 2) + 'px';
        hoverTag.style.top = (b.y - 6) + 'px';
      }
    }
    if (focusInfo && world.pets.length) {
      const p = world.pets.find((q) => !q.hidden);
      if (!chip) { chip = document.createElement('div'); chip.className = 'chip'; ui.appendChild(chip); }
      if (p) {
        const left = Math.max(0, Math.round((focusInfo.endsAt - Date.now()) / 1000));
        chip.textContent = `${focusInfo.phase === 'break' ? '☕' : '🎯'} ${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
        chip.classList.toggle('break', focusInfo.phase === 'break');
        const b = E.hitBox(p);
        chip.style.left = (b.x + b.w / 2) + 'px';
        chip.style.top = (b.y - (bubbles.has(p.id) ? 4 : 26)) + 'px';
        chip.style.display = bubbles.has(p.id) ? 'none' : '';
      }
    } else if (chip) { chip.remove(); chip = null; }
  }

  // ---------------------------------------------------------- events

  function headPos(p) {
    const b = E.hitBox(p);
    if (p.surface === 'floor' || p.surface === 'air' || p.surface === 'held') return { x: p.x + (p.facing || 1) * p.dims.w * 0.3, y: b.y + b.h * 0.12 };
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }

  const FORWARD = new Set(['clicked', 'petted', 'ate', 'fetched', 'trickDone', 'thrownHard', 'ceiling', 'away', 'returned', 'greet', 'hungry', 'pickedUp', 'released', 'dizzy', 'swat', 'climb', 'sleep', 'land']);

  function handleEvents(evs) {
    for (const ev of evs) {
      const p = ev.petId ? E.getPet(world, ev.petId) : null;
      switch (ev.type) {
        case 'emote': if (p) { const h = headPos(p); FX.spawn(fx, ev.kind === 'dizzy' ? 'dizzy' : ev.kind, h.x, h.y - 6, { scale: p.dims.s, follow: ev.kind === 'dizzy' ? p.id : null, glyph: foodGlyph(p) }); } break;
        case 'sound': SND.play(ev.name, { minGap: ev.name === 'munch' ? 150 : 60 }); break;
        case 'land': if (p && ev.impact > 450) { FX.spawn(fx, 'dust', p.x, p.y - 2); SND.play('land'); } break;
        case 'ate': if (p) FX.spawn(fx, 'crumbs', p.x + p.facing * p.dims.w * 0.45, p.y - 6); break;
        case 'trickDone': if (p) FX.spawn(fx, 'sparkle', p.x, p.y - p.dims.h * 0.6); break;
        case 'clicked': if (p && Math.random() < 0.6) SND.play(speciesSound(p), { minGap: 800 }); break;
        case 'petted': if (p) SND.play(p.cfg.species === 'cat' || (p.cfg.preset || '').match(/cat|tabby|tuxedo|calico|siamese|ragdoll|bengal/) ? 'purr' : speciesSound(p), { minGap: 2000 }); break;
        case 'fetched': SND.play('squeak'); break;
        case 'transfer': {
          const cfg = p ? p.cfg : null;
          E.removePet(world, ev.petId);
          dropBubble(ev.petId);
          paws.send('overlay:transfer', { petId: ev.petId, side: ev.side, cfg });
          break;
        }
        default: break;
      }
      if (FORWARD.has(ev.type)) pendingEvents.push(Object.assign({ at: Date.now() }, ev, { snapshot: undefined }));
    }
  }

  function speciesSound(p) {
    if (p.cfg.kind && p.cfg.kind !== 'procedural') return p.cfg.species === 'dog' ? 'bark' : 'meow';
    return S.plan(p.cfg).sound || 'pop';
  }
  function foodGlyph(p) { const f = S.FOODS[S.foodFor(p.cfg)]; return f ? f.emoji : '🍖'; }

  setInterval(() => {
    if (pendingEvents.length) { paws.send('overlay:events', pendingEvents); pendingEvents = []; }
  }, 400);
  setInterval(() => {
    const states = {};
    for (const p of world.pets) states[p.id] = { state: p.state, surface: p.surface, hidden: p.hidden };
    paws.send('overlay:petStates', states);
  }, 4000);

  // ------------------------------------------------------------- frame

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - lastT) / 1000);
    const calm = E.isCalm(world) && !fx.parts.length && !fx.weather.kind && ![...bubbles.values()].some((b) => b.typing) && !orb;
    if (calm && (frameSkip = (frameSkip + 1) % 5) !== 0) return; // ~12 fps while everyone rests
    lastT = now;
    E.step(world, dt);
    handleEvents(E.drainEvents(world));
    FX.step(fx, dt, { width: world.width, floor: world.floor });
    draw(now / 1000);
    positionBubbles(dt);
    positionOrb();
    positionTags();
  }

  function draw(time) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, world.width, world.height);
    for (const it of world.items) if (!it.carriedBy) FX.drawItem(ctx, it);
    if (world.toy) FX.drawToy(ctx, world.toy, world.cursor);
    const weatherProp = settings.weatherGear !== false ? weather : null;
    for (const p of world.pets) {
      if (p.hidden) continue;
      try {
        if (!p.cfg.kind || p.cfg.kind === 'procedural') D.drawPet(ctx, p, time, { weather: weatherProp });
        else SP.drawAssetPet(ctx, p, time);
      } catch (e) { console.error('draw failed', p.id, e); }
      if (p.carrying) { const it = world.items.find((i) => i.id === p.carrying); if (it) FX.drawItem(ctx, it); }
    }
    FX.draw(ctx, fx, (id) => { const p = E.getPet(world, id); return p ? headPos(p) : null; });
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // Expose for the browser demo and smoke tests.
  window.__paws = { get world() { return world; }, say, runCommand, init, toast, openOrb };

  requestAnimationFrame(frame);
  paws.send('overlay:ready', { width: innerWidth, height: innerHeight });
})();
