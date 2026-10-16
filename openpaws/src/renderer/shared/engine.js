/*
 * OpenPaws world engine: physics, surfaces and the behavior state machine.
 * Pure logic with no DOM access, so it runs in the overlay renderer and in node --test.
 *
 * Coordinates are display-local pixels. A pet's (x, y) is the point where its feet touch
 * the surface it stands on: the floor (dock/taskbar top), a side wall, or the ceiling.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./species.js'));
  else root.PawsEngine = factory(root.PawsSpecies);
})(typeof self !== 'undefined' ? self : this, function (Species) {
  'use strict';

  const GRAVITY = 1900;
  const MAX_THROW = 2600;

  // Release velocity from the last 100 ms of pointer motion, and a pointer that was already
  // still for 80 ms counts as a drop rather than a throw. Adapted from OpenPets'
  // pet-throw-core.ts (MIT License, Copyright (c) 2026 OpenPets).
  const VELOCITY_WINDOW = 0.1;
  const STALE_RELEASE = 0.08;
  const MIN_LAUNCH = 400;
  function releaseVelocity(samples, now) {
    if (!samples || samples.length < 2) return null;
    const first = samples[0]; const last = samples[samples.length - 1];
    if (now - last.t > STALE_RELEASE) return null;
    const dt = last.t - first.t;
    if (dt <= 0) return null;
    const vx = (last.x - first.x) / dt; const vy = (last.y - first.y) / dt;
    const speed = Math.hypot(vx, vy);
    if (!Number.isFinite(speed) || speed < MIN_LAUNCH) return null;
    const k = speed > MAX_THROW ? MAX_THROW / speed : 1;
    return { x: vx * k, y: vy * k };
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  const DEFAULT_SETTINGS = {
    speed: 1, gravity: 1, scale: 1, climb: true, ceiling: true, roam: true, chase: true,
    interactions: true, walkOff: true, quiet: false,
  };

  function createWorld(opts) {
    const o = opts || {};
    const width = o.width || 1280;
    const height = o.height || 800;
    const world = {
      width, height,
      floor: o.floor != null ? o.floor : height,
      ceiling: o.ceiling != null ? o.ceiling : 0,
      left: o.left != null ? o.left : 0,
      right: o.right != null ? o.right : width,
      edges: Object.assign({ left: false, right: false }, o.edges || {}),
      pets: [], items: [], toy: null,
      cursor: { x: -9999, y: -9999, vx: 0, vy: 0, inside: false, still: 99, lastMove: 0 },
      pointer: null,
      t: 0,
      rng: mulberry32(o.seed != null ? o.seed : (Date.now() & 0xffffffff)),
      settings: Object.assign({}, DEFAULT_SETTINGS, o.settings || {}),
      mood: { focus: false, away: false, night: false, weather: null },
      events: [],
      nextItemId: 1,
    };
    return world;
  }

  function setBounds(world, b) {
    Object.assign(world, b);
    for (const p of world.pets) {
      if (p.surface === 'floor') p.y = world.floor;
      p.x = clamp(p.x, world.left - p.dims.w, world.right + p.dims.w);
    }
  }

  function emit(world, ev) { world.events.push(ev); }
  function drainEvents(world) { const e = world.events; world.events = []; return e; }

  const rand = (w, a, b) => a + (b - a) * w.rng();
  function pickWeighted(w, weights) {
    let total = 0;
    for (const k in weights) if (weights[k] > 0) total += weights[k];
    if (total <= 0) return 'idle';
    let r = w.rng() * total;
    for (const k in weights) {
      if (weights[k] <= 0) continue;
      r -= weights[k];
      if (r <= 0) return k;
    }
    return 'idle';
  }

  // ---------------------------------------------------------------- pets

  function addPet(world, cfg, init) {
    const i = init || {};
    const d = Species.dims(cfg, world.settings.scale);
    const p = {
      id: cfg.id, cfg, dims: d,
      x: i.x != null ? i.x : rand(world, world.left + d.w, Math.max(world.left + d.w + 1, world.right - d.w)),
      y: i.y != null ? i.y : (i.fromTop ? world.ceiling + d.h : world.floor),
      vx: i.vx || 0, vy: i.vy || 0,
      facing: i.facing || (world.rng() < 0.5 ? -1 : 1),
      surface: i.fromTop ? 'air' : 'floor',
      state: i.fromTop ? 'fall' : 'idle', t: 0, dur: 1, data: {},
      anim: { phase: 0, blink: 0, blinkT: 2 + world.rng() * 3, lookX: 0, lookY: 0, wag: 0, squash: 0, swing: 0, swingV: 0, ear: 0, earT: 3 },
      emote: null, carrying: null, pettingAcc: 0, pettingT: 0, lastPetted: -99,
      bubble: null, hidden: false,
    };
    if (i.state) setState(world, p, i.state, i.stateData);
    world.pets.push(p);
    return p;
  }

  function removePet(world, id) {
    const i = world.pets.findIndex((p) => p.id === id);
    if (i >= 0) world.pets.splice(i, 1);
    for (const it of world.items) if (it.carriedBy === id) it.carriedBy = null;
  }

  function getPet(world, id) { return world.pets.find((p) => p.id === id); }

  function updatePetConfig(world, cfg) {
    const p = getPet(world, cfg.id);
    if (!p) return null;
    p.cfg = cfg;
    p.dims = Species.dims(cfg, world.settings.scale);
    p.mode = cfg.mode || 'roam';
    return p;
  }

  function stats(p) { return Object.assign({ fullness: 80, energy: 80, happiness: 80, hygiene: 90, bond: 30 }, p.cfg.stats || {}); }
  function personality(p) { return Object.assign({}, Species.PERSONALITY_DEFAULT, p.cfg.personality || {}); }
  function knownTricks(p) {
    const sk = p.cfg.skills || {};
    return Species.TRICKS.filter((t) => sk[t.id] && sk[t.id].prof >= Species.LEARNED).map((t) => t.id);
  }
  function speciesPlan(p) {
    return p.cfg.kind && p.cfg.kind !== 'procedural' ? { walk: 46, run: 160, jump: 0.9, climb: 0.6 } : Species.plan(p.cfg);
  }
  function walkSpeed(world, p) { return speciesPlan(p).walk * world.settings.speed * Math.sqrt(p.dims.s); }
  function runSpeed(world, p) { return speciesPlan(p).run * world.settings.speed * Math.sqrt(p.dims.s); }

  function bounds(world, p) {
    return { min: world.left + p.dims.w / 2, max: world.right - p.dims.w / 2 };
  }

  function setEmote(world, p, kind, dur) {
    p.emote = { kind, t: 0, dur: dur || 1.6 };
    emit(world, { type: 'emote', petId: p.id, kind });
  }

  function setState(world, p, state, data) {
    const prev = p.state;
    p.state = state;
    p.t = 0;
    p.data = data || {};
    const def = STATES[state];
    if (def && def.enter) def.enter(world, p, prev);
    if (prev !== state) emit(world, { type: 'state', petId: p.id, state, prev });
  }

  // Where the pet's body is, for hit tests (axis-aligned box).
  function hitBox(p) {
    const { w, h } = p.dims;
    switch (p.surface) {
      case 'wallR': return { x: p.x - h, y: p.y - w / 2, w: h, h: w };
      case 'wallL': return { x: p.x, y: p.y - w / 2, w: h, h: w };
      case 'ceiling': return { x: p.x - w / 2, y: p.y, w, h };
      default: return { x: p.x - w / 2, y: p.y - h, w, h };
    }
  }

  function inBox(b, x, y, pad) {
    const q = pad || 0;
    return x >= b.x - q && x <= b.x + b.w + q && y >= b.y - q && y <= b.y + b.h + q;
  }

  // ------------------------------------------------------------- deciding

  function onFloorStates() { return ['idle', 'walk', 'run', 'sit', 'lie', 'groom', 'look', 'stretch', 'yawn', 'focus', 'sad', 'beg']; }

  function decide(world, p) {
    if (p.surface !== 'floor') return setState(world, p, 'idle');
    const st = stats(p);
    const per = personality(p);
    const s = world.settings;
    const cur = world.cursor;
    const cursorNear = cur.inside && Math.abs(cur.x - p.x) < 400;
    const hour = new Date().getHours();
    const night = world.mood.night || hour >= 23 || hour < 6;

    // Hungry pets go for food lying around; playful ones for balls.
    const food = world.items.find((it) => (it.kind === 'food') && !it.carriedBy && !it.claimedBy);
    if (food && st.fullness < 97) { food.claimedBy = p.id; return setState(world, p, 'goEat', { itemId: food.id }); }
    const ball = world.items.find((it) => it.kind === 'ball' && !it.carriedBy && !it.claimedBy);
    if (ball && (per.playful > 0.3 || world.rng() < 0.5)) { ball.claimedBy = p.id; return setState(world, p, 'fetch', { itemId: ball.id }); }
    if (world.toy && s.chase) return setState(world, p, 'chaseToy');

    if (world.mood.away) return setState(world, p, world.rng() < 0.85 ? 'sleep' : 'lie');

    if (p.mode === 'follow' && cur.inside) {
      return setState(world, p, cur.still > 6 ? (cur.still > 25 ? 'sleep' : 'sit') : 'chase');
    }

    if (p.mode === 'stay') {
      return setState(world, p, pickWeighted(world, {
        idle: 3, sit: 3, lie: 1, loaf: 2, groom: 1.2, sleep: st.energy < 40 ? 4 : 0.6, look: cursorNear ? 2 : 0, stretch: 0.5, yawn: 0.4,
      }));
    }

    const known = knownTricks(p);
    const w = {
      idle: 2.2,
      walk: 3 + per.curious * 2,
      run: per.energy * 2 + (st.happiness > 70 ? 0.8 : 0),
      sit: 2 + (1 - per.energy) * 2,
      lie: 0.8 + (1 - per.energy) * 1.6,
      sleep: st.energy < 25 ? 7 : st.energy < 50 ? 1.2 : 0.15,
      groom: 1.4,
      loaf: 1.2 + (1 - per.energy) * 1.6,
      knead: st.happiness > 65 && st.bond > 35 ? 0.5 + per.affection * 0.5 : 0,
      slowblink: cursorNear ? per.affection * 0.9 : 0,
      scratch: 0.35,
      jump: per.energy * 1.1,
      stretch: 0.5,
      yawn: st.energy < 50 ? 0.9 : 0.15,
      look: cursorNear ? 1.2 + per.affection : 0,
      chase: s.chase && cur.inside && cur.still < 1.5 ? per.playful * 2.4 : 0,
      climb: s.climb ? per.curious * 1.1 * speciesPlan(p).climb : 0,
      trick: known.length ? per.playful * 0.9 : 0,
      beg: st.fullness < 30 ? 3.5 : 0,
      sad: st.happiness < 25 ? 2.5 : 0,
      walkOff: s.walkOff ? 0.12 * per.curious : 0,
      explore: s.roam && (world.edges.left || world.edges.right) ? 0.35 * per.curious : 0,
      greet: s.interactions && world.pets.length > 1 ? 1.2 : 0,
    };
    if (night) { w.sleep *= 3; w.lie *= 1.5; w.run *= 0.5; }
    if (world.mood.focus) {
      // Focus sessions: the cat settles down next to you instead of running around.
      for (const k of ['run', 'jump', 'chase', 'climb', 'trick', 'walkOff', 'explore', 'greet', 'scratch', 'knead']) w[k] *= 0.15;
      w.walk *= 0.4;
      w.focus = 12;
    }
    if (s.quiet) { w.run *= 0.4; w.jump *= 0.4; w.walkOff = 0; }

    const choice = pickWeighted(world, w);
    switch (choice) {
      case 'walk': return setState(world, p, 'walk', { tx: pickTarget(world, p) });
      case 'run': return setState(world, p, 'run', { tx: pickTarget(world, p, true) });
      case 'climb': {
        const toRight = p.x > (world.left + world.right) / 2;
        return setState(world, p, 'run', { tx: toRight ? world.right + 50 : world.left - 50, climb: true });
      }
      case 'walkOff': {
        const toRight = world.rng() < 0.5;
        return setState(world, p, 'walk', { tx: toRight ? world.right + p.dims.w * 2 : world.left - p.dims.w * 2, offscreen: true });
      }
      case 'explore': {
        const side = world.edges.right && (!world.edges.left || world.rng() < 0.5) ? 'right' : 'left';
        return setState(world, p, 'walk', { tx: side === 'right' ? world.right + p.dims.w * 2 : world.left - p.dims.w * 2, portal: true });
      }
      case 'trick': return setState(world, p, 'trick', { trick: known[Math.floor(world.rng() * known.length)] });
      case 'scratch': {
        // Walk to the nearest wall and have a good scratch on the screen edge.
        const b = bounds(world, p);
        const toRight = p.x > (world.left + world.right) / 2;
        return setState(world, p, 'walk', { tx: toRight ? b.max : b.min, then: 'scratch', thenData: { side: toRight ? 1 : -1 } });
      }
      case 'greet': {
        const other = nearestPet(world, p);
        if (other && other.surface === 'floor') return setState(world, p, 'walk', { tx: other.x - Math.sign(other.x - p.x) * (p.dims.w * 0.9), greet: other.id });
        return setState(world, p, 'idle');
      }
      default: return setState(world, p, choice);
    }
  }

  function pickTarget(world, p, far) {
    const b = bounds(world, p);
    const span = far ? (b.max - b.min) : Math.min(500, b.max - b.min);
    let tx = p.x + (world.rng() * 2 - 1) * span;
    if (world.rng() < 0.25 && world.cursor.inside) tx = world.cursor.x + (world.rng() * 2 - 1) * 80;
    return clamp(tx, b.min, b.max);
  }

  function nearestPet(world, p) {
    let best = null; let bd = Infinity;
    for (const o of world.pets) {
      if (o === p || o.hidden) continue;
      const d = Math.abs(o.x - p.x);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  // ---------------------------------------------------------------- moving

  // Walks along the floor toward data.tx. Returns true on arrival.
  function moveFloor(world, p, dt, speed) {
    const tx = p.data.tx;
    const dx = tx - p.x;
    if (Math.abs(dx) < 2) return true;
    p.facing = dx > 0 ? 1 : -1;
    p.vx = p.facing * speed;
    p.x += p.vx * dt;
    if ((dx > 0 && p.x >= tx) || (dx < 0 && p.x <= tx)) { p.x = tx; return true; }

    const b = bounds(world, p);
    if (p.x < b.min || p.x > b.max) {
      const side = p.x < b.min ? 'left' : 'right';
      const open = world.edges[side] && world.settings.roam;
      if (p.data.climb && world.settings.climb) {
        p.x = side === 'left' ? world.left : world.right;
        p.surface = side === 'left' ? 'wallL' : 'wallR';
        p.y = world.floor - p.dims.w / 2;
        setState(world, p, 'climb');
        return false;
      }
      if (open && p.data.portal) {
        if ((side === 'left' && p.x < world.left - p.dims.w / 2) || (side === 'right' && p.x > world.right + p.dims.w / 2)) {
          emit(world, { type: 'transfer', petId: p.id, side, snapshot: snapshot(p) });
          p.hidden = true;
          setState(world, p, 'transit');
        }
        return false;
      }
      if (p.data.offscreen) {
        if ((side === 'left' && p.x < world.left - p.dims.w) || (side === 'right' && p.x > world.right + p.dims.w)) {
          p.hidden = true;
          setState(world, p, 'away', { side });
        }
        return false;
      }
      p.x = clamp(p.x, b.min, b.max);
      return true;
    }
    return false;
  }

  function snapshot(p) {
    return { state: p.state, facing: p.facing, vx: p.vx, stateData: Object.assign({}, p.data) };
  }

  // Free flight with gravity; resolves collisions with the walls, ceiling and floor.
  function stepAir(world, p, dt) {
    const g = GRAVITY * world.settings.gravity;
    p.vy += g * dt;
    p.vx *= Math.pow(0.85, dt);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const halfW = p.dims.w / 2;
    if (p.x - halfW < world.left) {
      if (p.state === 'thrown' && Math.abs(p.vx) > 500 && world.settings.climb && world.rng() < 0.55 * speciesPlan(p).climb + 0.15) {
        p.x = world.left; p.surface = 'wallL'; p.y = clamp(p.y - p.dims.h / 2, world.ceiling + halfW, world.floor - halfW);
        p.vx = 0; p.vy = 0; return setState(world, p, 'climb', { cling: 1.2 });
      }
      p.x = world.left + halfW; p.vx = Math.abs(p.vx) * 0.45;
    } else if (p.x + halfW > world.right) {
      if (p.state === 'thrown' && Math.abs(p.vx) > 500 && world.settings.climb && world.rng() < 0.55 * speciesPlan(p).climb + 0.15) {
        p.x = world.right; p.surface = 'wallR'; p.y = clamp(p.y - p.dims.h / 2, world.ceiling + halfW, world.floor - halfW);
        p.vx = 0; p.vy = 0; return setState(world, p, 'climb', { cling: 1.2 });
      }
      p.x = world.right - halfW; p.vx = -Math.abs(p.vx) * 0.45;
    }
    if (p.y - p.dims.h < world.ceiling) {
      if (p.state === 'thrown' && p.vy < -900 && world.settings.ceiling && world.settings.climb && world.rng() < 0.5) {
        p.y = world.ceiling; p.surface = 'ceiling'; p.vx = 0; p.vy = 0;
        emit(world, { type: 'ceiling', petId: p.id });
        return setState(world, p, 'ceilingWalk', { tx: clamp(p.x + (world.rng() * 2 - 1) * 300, world.left + halfW, world.right - halfW) });
      }
      p.y = world.ceiling + p.dims.h; p.vy = Math.abs(p.vy) * 0.3;
    }
    if (p.y >= world.floor) {
      p.y = world.floor;
      const impact = p.vy;
      if (impact > 950 && p.state === 'thrown') {
        p.vy = -impact * 0.32;
        p.anim.squash = 1;
        emit(world, { type: 'sound', name: 'boing', petId: p.id });
        p.data.bounces = (p.data.bounces || 0) + 1;
        if (impact > 1700) p.data.dizzy = true;
        return;
      }
      p.vy = 0;
      p.vx = 0;
      p.surface = 'floor';
      p.anim.squash = Math.min(1, impact / 900);
      emit(world, { type: 'land', petId: p.id, impact });
      setState(world, p, p.data.dizzy ? (world.rng() < 0.5 ? 'hiss' : 'dizzy') : 'land');
    }
  }

  // ---------------------------------------------------------------- states

  const STATES = {
    idle: {
      enter(w, p) { p.dur = rand(w, 1.2, 3.5); p.vx = 0; },
      update(w, p) { if (p.t > p.dur) decide(w, p); },
    },
    walk: {
      enter(w, p) { if (p.data.tx == null) p.data.tx = pickTarget(w, p); p.dur = 25; },
      update(w, p, dt) {
        const arrived = moveFloor(w, p, dt, walkSpeed(w, p) * (p.data.fast ? 1.6 : 1));
        if (p.state !== 'walk') return;
        if (arrived || p.t > p.dur) {
          if (p.data.greet) {
            const o = getPet(w, p.data.greet);
            if (o && Math.abs(o.x - p.x) < p.dims.w * 1.4 && o.surface === 'floor') return startGreet(w, p, o);
          }
          if (p.data.then) return setState(w, p, p.data.then, p.data.thenData);
          setState(w, p, w.rng() < 0.55 ? 'idle' : 'sit');
        }
      },
    },
    run: {
      enter(w, p) { if (p.data.tx == null) p.data.tx = pickTarget(w, p, true); p.dur = 12; },
      update(w, p, dt) {
        const arrived = moveFloor(w, p, dt, runSpeed(w, p));
        if (p.state !== 'run') return;
        if (arrived || p.t > p.dur) setState(w, p, w.rng() < 0.3 ? 'jump' : 'idle');
      },
    },
    sit: { enter(w, p) { p.dur = rand(w, 3, 9); p.vx = 0; }, update(w, p) { lookAtCursor(w, p); if (p.t > p.dur) decide(w, p); } },
    lie: { enter(w, p) { p.dur = rand(w, 5, 14); p.vx = 0; }, update(w, p) { if (p.t > p.dur) decide(w, p); } },
    look: { enter(w, p) { p.dur = rand(w, 2, 5); p.vx = 0; }, update(w, p) { lookAtCursor(w, p, true); if (p.t > p.dur) decide(w, p); } },
    groom: { enter(w, p) { p.dur = rand(w, 2.5, 5); p.vx = 0; }, update(w, p) { if (p.t > p.dur) decide(w, p); } },
    stretch: { enter(w, p) { p.dur = 1.8; p.vx = 0; }, update(w, p) { if (p.t > p.dur) decide(w, p); } },
    yawn: { enter(w, p) { p.dur = 1.6; p.vx = 0; }, update(w, p) { if (p.t > p.dur) setState(w, p, stats(p).energy < 50 && w.rng() < 0.6 ? 'sleep' : 'idle'); } },
    sad: { enter(w, p) { p.dur = rand(w, 3, 6); p.vx = 0; setEmote(w, p, 'sweat', 1.5); }, update(w, p) { if (p.t > p.dur) decide(w, p); } },
    beg: {
      enter(w, p) { p.dur = 3.2; p.vx = 0; setEmote(w, p, 'food', 2); emit(w, { type: 'hungry', petId: p.id }); },
      update(w, p) { lookAtCursor(w, p, true); if (p.t > p.dur) decide(w, p); },
    },
    focus: { enter(w, p) { p.dur = rand(w, 20, 40); p.vx = 0; }, update(w, p) { if (p.t > p.dur || !w.mood.focus) decide(w, p); } },
    sleep: {
      enter(w, p) {
        p.dur = w.mood.away ? 1e9 : rand(w, 25, 70);
        p.vx = 0;
        emit(w, { type: 'sleep', petId: p.id, on: true });
      },
      update(w, p) {
        if (Math.floor(p.t / 2.2) !== Math.floor((p.t - 1 / 60) / 2.2)) emit(w, { type: 'emote', petId: p.id, kind: 'zzz' });
        if (!w.mood.away && (p.t > p.dur || (stats(p).energy > 97 && p.t > 10))) wake(w, p);
      },
    },
    jump: {
      enter(w, p) {
        const k = speciesPlan(p).jump;
        p.vy = -(560 + w.rng() * 240) * k * Math.sqrt(p.dims.s);
        p.vx = p.facing * (40 + w.rng() * 80);
        p.surface = 'air';
        emit(w, { type: 'sound', name: 'hop', petId: p.id });
      },
      update(w, p, dt) { stepAir(w, p, dt); },
    },
    pounce: {
      enter(w, p) {
        const tx = p.data.tx != null ? p.data.tx : p.x + p.facing * 120;
        const ty = p.data.ty != null ? p.data.ty : w.floor - 120;
        const height = clamp(w.floor - ty, 60, 420);
        p.vy = -Math.sqrt(2 * GRAVITY * w.settings.gravity * height);
        const tUp = -p.vy / (GRAVITY * w.settings.gravity);
        p.vx = clamp((tx - p.x) / Math.max(0.2, tUp * 1.6), -700, 700);
        p.facing = p.vx >= 0 ? 1 : -1;
        p.surface = 'air';
        emit(w, { type: 'sound', name: 'hop', petId: p.id });
      },
      update(w, p, dt) { stepAir(w, p, dt); },
    },
    fall: { enter(w, p) { p.surface = 'air'; }, update(w, p, dt) { stepAir(w, p, dt); } },
    thrown: { enter(w, p) { p.surface = 'air'; }, update(w, p, dt) { p.anim.spin = (p.anim.spin || 0) + p.vx * dt * 0.01; stepAir(w, p, dt); } },
    land: {
      enter(w, p) { p.dur = 0.28; p.anim.spin = 0; },
      update(w, p) { if (p.t > p.dur) decide(w, p); },
    },
    dizzy: {
      enter(w, p) { p.dur = 2.2; p.anim.spin = 0; setEmote(w, p, 'dizzy', 2.2); emit(w, { type: 'dizzy', petId: p.id }); },
      update(w, p) { if (p.t > p.dur) setState(w, p, 'idle'); },
    },
    held: {
      enter(w, p) { p.surface = 'held'; p.vx = 0; p.vy = 0; emit(w, { type: 'pickedUp', petId: p.id }); },
      update(w, p, dt) {
        const ptr = w.pointer;
        if (!ptr) return setState(w, p, 'fall');
        const tx = ptr.x;
        const ty = ptr.y + p.dims.h * 0.92;
        const ax = (tx - p.x);
        p.x += ax * Math.min(1, dt * 22);
        p.y += (ty - p.y) * Math.min(1, dt * 22);
        // A damped spring makes the pet dangle and swing as you move it.
        const target = clamp(-ptr.vx * 0.0011, -1.1, 1.1);
        p.anim.swingV += ((target - p.anim.swing) * 40 - p.anim.swingV * 6) * dt;
        p.anim.swing += p.anim.swingV * dt;
        if (Math.abs(ptr.vx) > 30) p.facing = ptr.vx > 0 ? 1 : -1;
      },
    },
    climb: {
      enter(w, p) { p.dur = rand(w, 3, 9); p.vx = 0; p.data.pause = p.data.cling || 0; emit(w, { type: 'climb', petId: p.id }); },
      update(w, p, dt) {
        if (p.data.pause > 0) { p.data.pause -= dt; return; }
        if (w.rng() < dt * 0.25) p.data.pause = rand(w, 0.6, 2);
        p.y -= walkSpeed(w, p) * 0.75 * dt;
        p.anim.phase += dt * 6;
        const topY = w.ceiling + p.dims.w / 2;
        if (p.y <= topY) {
          p.y = topY;
          if (w.settings.ceiling && w.rng() < 0.6) {
            const fromRight = p.surface === 'wallR';
            p.surface = 'ceiling';
            p.y = w.ceiling;
            p.x = fromRight ? w.right - p.dims.w / 2 : w.left + p.dims.w / 2;
            emit(w, { type: 'ceiling', petId: p.id });
            return setState(w, p, 'ceilingWalk', { tx: rand(w, w.left + p.dims.w, w.right - p.dims.w) });
          }
          return jumpOffWall(w, p);
        }
        if (p.t > p.dur && w.rng() < dt * 0.6) jumpOffWall(w, p);
      },
    },
    ceilingWalk: {
      enter(w, p) { p.dur = rand(w, 4, 12); if (p.data.tx == null) p.data.tx = rand(w, w.left + p.dims.w, w.right - p.dims.w); },
      update(w, p, dt) {
        const dx = p.data.tx - p.x;
        if (Math.abs(dx) > 3) {
          p.facing = dx > 0 ? 1 : -1;
          p.x += p.facing * walkSpeed(w, p) * 0.7 * dt;
        } else if (w.rng() < dt * 0.5) {
          p.data.tx = rand(w, w.left + p.dims.w, w.right - p.dims.w);
        }
        if (p.t > p.dur && w.rng() < dt) {
          p.surface = 'air'; p.y = w.ceiling + p.dims.h; p.vx = 0; p.vy = 0;
          setState(w, p, 'fall');
        }
      },
    },
    chase: {
      enter(w, p) { p.dur = rand(w, 6, 14); },
      update(w, p, dt) {
        const c = w.cursor;
        if (!c.inside || (p.mode !== 'follow' && p.t > p.dur)) return setState(w, p, 'sit');
        const dx = c.x - p.x;
        const dist = Math.abs(dx);
        if (dist > p.dims.w * 0.6) {
          p.data.tx = clamp(c.x, w.left + p.dims.w / 2, w.right - p.dims.w / 2);
          moveFloor(w, p, dt, dist > 220 ? runSpeed(w, p) : walkSpeed(w, p) * 1.3);
        } else {
          p.vx = 0;
          const above = w.floor - c.y;
          if (above > p.dims.h * 0.8 && above < 380 && c.still < 0.6 && w.rng() < dt * 2) {
            return setState(w, p, 'hunt', { tx: c.x, ty: c.y });
          }
          if (c.still > 2.5) return setState(w, p, p.mode === 'follow' ? 'sit' : 'look');
        }
      },
    },
    chaseToy: {
      enter(w, p) { p.dur = 30; },
      update(w, p, dt) {
        const toy = w.toy;
        if (!toy) return setState(w, p, 'idle');
        const tip = toy.tip || toy;
        const dx = tip.x - p.x;
        if (Math.abs(dx) > p.dims.w * 0.35) {
          p.data.tx = clamp(tip.x, w.left + p.dims.w / 2, w.right - p.dims.w / 2);
          moveFloor(w, p, dt, Math.abs(dx) > 160 ? runSpeed(w, p) : walkSpeed(w, p) * 1.6);
        } else {
          p.vx = 0;
          p.facing = dx >= 0 ? 1 : -1;
          const above = w.floor - tip.y;
          if (above > p.dims.h * 0.5 && above < 420 && w.rng() < dt * 2.5) return setState(w, p, 'hunt', { tx: tip.x, ty: tip.y, toy: true });
          if (above <= p.dims.h * 1.1 && w.rng() < dt * 3) {
            setEmote(w, p, 'sparkle', 0.8);
            emit(w, { type: 'swat', petId: p.id });
          }
        }
      },
    },
    goEat: {
      enter(w, p) { p.dur = 20; },
      update(w, p, dt) {
        const it = w.items.find((i) => i.id === p.data.itemId);
        if (!it) return setState(w, p, 'idle');
        if (!it.grounded) { p.facing = it.x > p.x ? 1 : -1; return; }
        p.data.tx = clamp(it.x - p.facing * p.dims.w * 0.42, w.left + p.dims.w / 2, w.right - p.dims.w / 2);
        const arrived = moveFloor(w, p, dt, Math.abs(it.x - p.x) > 200 ? runSpeed(w, p) : walkSpeed(w, p) * 1.3);
        if (arrived || Math.abs(it.x - p.x) < p.dims.w * 0.55) {
          p.facing = it.x >= p.x ? 1 : -1;
          setState(w, p, 'eat', { itemId: it.id });
        } else if (p.t > p.dur) setState(w, p, 'idle');
      },
    },
    eat: {
      enter(w, p) { p.dur = 2.6; p.vx = 0; },
      update(w, p) {
        if (Math.floor(p.t / 0.45) !== Math.floor((p.t - 1 / 60) / 0.45)) emit(w, { type: 'sound', name: 'munch', petId: p.id });
        if (p.t > p.dur) {
          const i = w.items.findIndex((x) => x.id === p.data.itemId);
          let food = null;
          if (i >= 0) { food = w.items[i].sub; w.items.splice(i, 1); }
          emit(w, { type: 'ate', petId: p.id, food });
          setEmote(w, p, 'heart', 1.4);
          setState(w, p, w.rng() < 0.5 ? 'groom' : 'sit');
        }
      },
    },
    fetch: {
      enter(w, p) { p.dur = 25; p.data.phase = 'go'; },
      update(w, p, dt) {
        const it = w.items.find((i) => i.id === p.data.itemId);
        if (!it) return setState(w, p, 'idle');
        if (p.data.phase === 'go') {
          if (!it.grounded && Math.abs(it.vx) > 40) {
            p.data.tx = clamp(it.x, w.left + p.dims.w / 2, w.right - p.dims.w / 2);
            moveFloor(w, p, dt, runSpeed(w, p));
            return;
          }
          p.data.tx = clamp(it.x, w.left + p.dims.w / 2, w.right - p.dims.w / 2);
          moveFloor(w, p, dt, runSpeed(w, p));
          if (Math.abs(it.x - p.x) < p.dims.w * 0.5 && it.y > w.floor - p.dims.h) {
            it.carriedBy = p.id; it.vx = 0; it.vy = 0;
            p.carrying = it.id;
            p.data.phase = 'return';
            const c = w.cursor;
            p.data.tx = clamp(c.inside ? c.x : rand(w, w.left + 100, w.right - 100), w.left + p.dims.w / 2, w.right - p.dims.w / 2);
            emit(w, { type: 'sound', name: 'squeak', petId: p.id });
          }
        } else {
          const arrived = moveFloor(w, p, dt, runSpeed(w, p) * 0.8);
          if (arrived) {
            it.carriedBy = null; it.claimedBy = null; p.carrying = null;
            it.y = w.floor - it.r; it.vx = p.facing * 30; it.vy = -120; it.grounded = false;
            emit(w, { type: 'fetched', petId: p.id });
            setEmote(w, p, 'heart', 1.2);
            setState(w, p, 'sit', {});
          }
        }
        if (p.t > p.dur) { it.carriedBy = null; it.claimedBy = null; p.carrying = null; setState(w, p, 'idle'); }
      },
    },
    trick: {
      enter(w, p) {
        const t = Species.trick(p.data.trick) || Species.TRICKS[0];
        p.data.trick = t.id;
        p.dur = t.dur;
        p.vx = 0;
        if (t.id === 'backflip') { p.vy = -720 * Math.sqrt(p.dims.s); p.surface = 'air'; p.data.y0 = p.y; }
        if (t.id === 'zoomies') p.data.dir = p.facing;
        if (t.id === 'dance') setEmote(w, p, 'music', t.dur);
        emit(w, { type: 'trickStart', petId: p.id, trick: t.id });
      },
      update(w, p, dt) {
        const tr = p.data.trick;
        if (tr === 'backflip') {
          p.vy += GRAVITY * w.settings.gravity * dt;
          p.y += p.vy * dt;
          if (p.y >= w.floor) { p.y = w.floor; p.surface = 'floor'; p.vy = 0; p.anim.squash = 0.6; return finishTrick(w, p); }
          return;
        }
        if (tr === 'zoomies') {
          const b = bounds(w, p);
          p.x += p.data.dir * runSpeed(w, p) * 1.25 * dt;
          if (p.x < b.min || p.x > b.max) { p.x = clamp(p.x, b.min, b.max); p.data.dir *= -1; }
          p.facing = p.data.dir;
        }
        if (tr === 'moonwalk') {
          const b = bounds(w, p);
          p.x = clamp(p.x - p.facing * walkSpeed(w, p) * 0.8 * dt, b.min, b.max);
        }
        if (tr === 'highfive' || tr === 'wave' || tr === 'beg') lookAtCursor(w, p, true);
        if (p.t > p.dur) finishTrick(w, p);
      },
    },
    greet: {
      enter(w, p) { p.dur = 2.2; p.vx = 0; setEmote(w, p, 'heart', 1.6); },
      update(w, p) {
        const o = getPet(w, p.data.with);
        if (o) p.facing = o.x > p.x ? 1 : -1;
        if (p.t > p.dur) {
          if (o && p.data.lead && personality(p).playful > 0.5 && w.rng() < 0.6 && o.state === 'greet') {
            setState(w, o, 'run', { tx: clamp(o.x + Math.sign(o.x - p.x || 1) * 400, bounds(w, o).min, bounds(w, o).max) });
            return setState(w, p, 'chasePet', { with: o.id });
          }
          setState(w, p, w.rng() < 0.5 ? 'sit' : 'idle');
        }
      },
    },
    chasePet: {
      enter(w, p) { p.dur = rand(w, 3, 6); },
      update(w, p, dt) {
        const o = getPet(w, p.data.with);
        if (!o || o.surface !== 'floor' || p.t > p.dur) return setState(w, p, 'idle');
        p.data.tx = clamp(o.x - Math.sign(o.x - p.x || 1) * p.dims.w * 0.6, bounds(w, p).min, bounds(w, p).max);
        moveFloor(w, p, dt, runSpeed(w, p) * 0.95);
      },
    },
    enjoy: {
      enter(w, p) { p.dur = 2.4; p.vx = 0; emit(w, { type: 'sound', name: 'purr', petId: p.id }); },
      update(w, p) { if (p.t > p.dur) setState(w, p, 'sit'); },
    },
    happy: {
      enter(w, p) { p.dur = 1.0; p.vx = 0; setEmote(w, p, 'heart', 1.2); },
      update(w, p) { if (p.t > p.dur) setState(w, p, w.rng() < 0.5 ? 'jump' : 'sit'); },
    },
    celebrate: {
      enter(w, p) { p.dur = 2.4; p.vx = 0; p.data.hops = 0; setEmote(w, p, 'star', 2); },
      update(w, p, dt) {
        const k = Math.floor(p.t / 0.6);
        if (k !== p.data.hops && p.surface === 'floor') { p.data.hops = k; p.vy = -420; p.surface = 'air'; }
        if (p.surface === 'air') {
          p.vy += GRAVITY * dt; p.y += p.vy * dt;
          if (p.y >= w.floor) { p.y = w.floor; p.vy = 0; p.surface = 'floor'; p.anim.squash = 0.5; }
        }
        if (p.t > p.dur && p.surface === 'floor') setState(w, p, 'sit');
      },
    },
    scared: {
      enter(w, p) { p.dur = 2.5; p.vx = 0; setEmote(w, p, 'exclaim', 1.2); },
      update(w, p) { if (p.t > p.dur) setState(w, p, 'lie'); },
    },
    loaf: { enter(w, p) { p.dur = rand(w, 6, 16); p.vx = 0; }, update(w, p) { if (p.t > p.dur) decide(w, p); } },
    knead: {
      enter(w, p) { p.dur = rand(w, 3, 5); p.vx = 0; emit(w, { type: 'sound', name: 'purr', petId: p.id }); emit(w, { type: 'knead', petId: p.id }); },
      update(w, p) { if (p.t > p.dur) setState(w, p, w.rng() < 0.6 ? 'loaf' : 'sit'); },
    },
    slowblink: {
      enter(w, p) { p.dur = 2.2; p.vx = 0; },
      update(w, p) {
        lookAtCursor(w, p, true);
        if (!p.data.sent && p.t > 1.1) { p.data.sent = true; setEmote(w, p, 'heart', 1.2); emit(w, { type: 'slowblink', petId: p.id }); }
        if (p.t > p.dur) setState(w, p, 'sit');
      },
    },
    // The hunting crouch: low, eyes locked, a butt wiggle, then the pounce.
    hunt: {
      enter(w, p) { p.dur = rand(w, 0.6, 1.5); p.vx = 0; if (p.data.tx != null) p.facing = p.data.tx > p.x ? 1 : -1; },
      update(w, p) {
        const target = p.data.toy && w.toy ? (w.toy.tip || w.toy) : (w.cursor.inside ? w.cursor : null);
        if (target) { p.data.tx = target.x; p.data.ty = target.y; p.facing = target.x > p.x ? 1 : -1; }
        if (p.t > p.dur) setState(w, p, 'pounce', { tx: p.data.tx, ty: p.data.ty, toy: p.data.toy });
      },
    },
    scratch: {
      enter(w, p) { p.dur = rand(w, 2.5, 4); p.vx = 0; if (p.data.side) p.facing = p.data.side; },
      update(w, p) {
        if (Math.floor(p.t / 0.35) !== Math.floor((p.t - 1 / 60) / 0.35)) emit(w, { type: 'sound', name: 'scratch', petId: p.id });
        if (p.t > p.dur) setState(w, p, w.rng() < 0.5 ? 'stretch' : 'idle');
      },
    },
    hiss: {
      enter(w, p) { p.dur = 1.3; p.vx = 0; setEmote(w, p, 'anger', 1.2); emit(w, { type: 'sound', name: 'hiss', petId: p.id }); emit(w, { type: 'hiss', petId: p.id }); },
      update(w, p) { if (p.t > p.dur) setState(w, p, 'groom'); },
    },
    away: {
      enter(w, p) { p.dur = rand(w, 40, 120); p.vx = 0; emit(w, { type: 'away', petId: p.id, side: p.data.side }); },
      update(w, p) { if (p.t > p.dur) returnFromAway(w, p); },
    },
    transit: { enter(w, p) { p.vx = 0; }, update() {} },
  };

  function startGreet(w, p, o) {
    setState(w, p, 'greet', { with: o.id, lead: true });
    if (['idle', 'sit', 'walk', 'look', 'lie'].includes(o.state)) setState(w, o, 'greet', { with: p.id });
    emit(w, { type: 'greet', petId: p.id, other: o.id });
  }

  function finishTrick(w, p) {
    emit(w, { type: 'trickDone', petId: p.id, trick: p.data.trick });
    setEmote(w, p, 'star', 1.2);
    setState(w, p, 'idle');
  }

  function jumpOffWall(w, p) {
    const away = p.surface === 'wallR' ? -1 : 1;
    p.surface = 'air';
    p.x += away * (p.dims.w / 2 + 2);
    p.y += p.dims.h / 2;
    p.vx = away * rand(w, 120, 260);
    p.vy = -rand(w, 100, 300);
    p.facing = away;
    setState(w, p, 'fall');
  }

  function returnFromAway(w, p) {
    const side = p.data.side || (w.rng() < 0.5 ? 'left' : 'right');
    p.hidden = false;
    p.surface = 'floor';
    p.y = w.floor;
    p.x = side === 'left' ? w.left - p.dims.w : w.right + p.dims.w;
    const b = bounds(w, p);
    emit(w, { type: 'returned', petId: p.id });
    setState(w, p, 'walk', { tx: side === 'left' ? b.min + 80 + w.rng() * 200 : b.max - 80 - w.rng() * 200, then: 'happy' });
  }

  function wake(w, p) {
    emit(w, { type: 'sleep', petId: p.id, on: false });
    setState(w, p, 'stretch');
  }

  function lookAtCursor(w, p, turn) {
    const c = w.cursor;
    if (!c.inside) return;
    if (turn && Math.abs(c.x - p.x) > p.dims.w * 0.3) p.facing = c.x > p.x ? 1 : -1;
  }

  // ---------------------------------------------------------------- items

  function addItem(world, kind, opts) {
    const o = opts || {};
    const it = {
      id: 'it' + world.nextItemId++, kind, sub: o.sub || (kind === 'ball' ? 'ball' : 'kibble'),
      x: o.x != null ? o.x : rand(world, world.left + 60, world.right - 60),
      y: o.y != null ? o.y : world.ceiling + 20,
      vx: o.vx || 0, vy: o.vy || 0, r: o.r || (kind === 'ball' ? 9 : 11),
      grounded: false, carriedBy: null, claimedBy: null, t: 0, life: o.life || (kind === 'food' ? 180 : 240),
      forPet: o.forPet || null,
    };
    world.items.push(it);
    emit(world, { type: 'itemAdded', itemId: it.id, kind });
    // Food meant for a specific pet: send that pet straight to it.
    if (it.forPet) {
      const p = getPet(world, it.forPet);
      if (p && p.surface === 'floor' && !['eat', 'held', 'transit', 'away'].includes(p.state)) {
        it.claimedBy = p.id;
        setState(world, p, kind === 'ball' ? 'fetch' : 'goEat', { itemId: it.id });
      }
    }
    return it;
  }

  function stepItems(world, dt) {
    const g = GRAVITY * world.settings.gravity;
    for (let i = world.items.length - 1; i >= 0; i--) {
      const it = world.items[i];
      it.t += dt;
      if (it.t > it.life && !it.carriedBy) { world.items.splice(i, 1); continue; }
      if (it.carriedBy) {
        const p = getPet(world, it.carriedBy);
        if (!p) { it.carriedBy = null; continue; }
        it.x = p.x + p.facing * p.dims.w * 0.48;
        it.y = p.y - p.dims.h * 0.42;
        continue;
      }
      if (world.pointer && world.pointer.itemId === it.id) {
        it.x = world.pointer.x; it.y = world.pointer.y; it.vx = world.pointer.vx; it.vy = world.pointer.vy;
        it.grounded = false;
        continue;
      }
      it.vy += g * dt;
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      if (it.x - it.r < world.left) { it.x = world.left + it.r; it.vx = Math.abs(it.vx) * 0.6; }
      if (it.x + it.r > world.right) { it.x = world.right - it.r; it.vx = -Math.abs(it.vx) * 0.6; }
      if (it.y - it.r < world.ceiling) { it.y = world.ceiling + it.r; it.vy = Math.abs(it.vy) * 0.5; }
      if (it.y + it.r >= world.floor) {
        it.y = world.floor - it.r;
        if (it.vy > 160 && it.kind === 'ball') {
          it.vy = -it.vy * 0.62;
          emit(world, { type: 'sound', name: 'bounce', itemId: it.id });
        } else {
          it.vy = 0;
          if (!it.grounded) emit(world, { type: 'itemLanded', itemId: it.id, kind: it.kind });
          it.grounded = true;
        }
        it.vx *= Math.pow(it.kind === 'ball' ? 0.55 : 0.02, dt);
        if (Math.abs(it.vx) < 4) it.vx = 0;
      } else if (it.y + it.r < world.floor - 1) {
        it.grounded = false;
      }
      it.spin = (it.spin || 0) + it.vx * dt / it.r;
    }
  }

  // ------------------------------------------------------------------ toys

  // A feather wand: a short verlet rope hanging from the cursor with a feather on the end.
  function setToy(world, kind) {
    if (!kind) { world.toy = null; emit(world, { type: 'toy', kind: null }); return; }
    const c = world.cursor;
    const segs = [];
    for (let i = 0; i <= 8; i++) segs.push({ x: c.x, y: c.y + i * 12, px: c.x, py: c.y + i * 12 });
    world.toy = { kind, segs, tip: segs[segs.length - 1], t: 0 };
    emit(world, { type: 'toy', kind });
    for (const p of world.pets) if (p.surface === 'floor' && !['eat', 'sleep', 'trick', 'held', 'away', 'transit'].includes(p.state)) setState(world, p, 'chaseToy');
  }

  function stepToy(world, dt) {
    const toy = world.toy;
    if (!toy) return;
    toy.t += dt;
    const c = world.cursor;
    if (toy.kind === 'laser') {
      toy.x = c.x; toy.y = Math.min(c.y, world.floor - 3); toy.tip = { x: toy.x, y: world.floor - 4 };
      return;
    }
    const segs = toy.segs;
    segs[0].x = c.x; segs[0].y = c.y;
    const g = 900;
    for (let i = 1; i < segs.length; i++) {
      const s = segs[i];
      const vx = (s.x - s.px) * 0.985;
      const vy = (s.y - s.py) * 0.985;
      s.px = s.x; s.py = s.y;
      s.x += vx; s.y += vy + g * dt * dt;
      if (s.y > world.floor - 2) s.y = world.floor - 2;
    }
    const L = 12;
    for (let k = 0; k < 6; k++) {
      for (let i = 1; i < segs.length; i++) {
        const a = segs[i - 1]; const b = segs[i];
        const dx = b.x - a.x; const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
        const diff = (d - L) / d;
        if (i === 1) { b.x -= dx * diff; b.y -= dy * diff; } else {
          a.x += dx * diff * 0.5; a.y += dy * diff * 0.5;
          b.x -= dx * diff * 0.5; b.y -= dy * diff * 0.5;
        }
      }
      segs[0].x = c.x; segs[0].y = c.y;
    }
    toy.tip = segs[segs.length - 1];
  }

  // --------------------------------------------------------------- pointer

  function setCursor(world, x, y, inside) {
    const c = world.cursor;
    const now = world.t;
    const dt = Math.max(1 / 240, now - (c.lastT || 0));
    if (inside) {
      const moved = Math.abs(x - c.x) + Math.abs(y - c.y);
      if (c.inside) {
        c.vx = c.vx * 0.6 + ((x - c.x) / dt) * 0.4;
        c.vy = c.vy * 0.6 + ((y - c.y) / dt) * 0.4;
      }
      if (moved > 1.5) c.still = 0;
      c.x = x; c.y = y;
    } else {
      c.vx = 0; c.vy = 0;
    }
    c.inside = !!inside;
    c.lastT = now;
  }

  function hitTest(world, x, y) {
    for (let i = world.items.length - 1; i >= 0; i--) {
      const it = world.items[i];
      if (it.carriedBy) continue;
      const dx = x - it.x; const dy = y - it.y;
      if (dx * dx + dy * dy <= (it.r + 6) * (it.r + 6)) return { kind: 'item', id: it.id, item: it };
    }
    for (let i = world.pets.length - 1; i >= 0; i--) {
      const p = world.pets[i];
      if (p.hidden) continue;
      if (inBox(hitBox(p), x, y, 4) && (!world.hitFilter || world.hitFilter(p, x, y))) return { kind: 'pet', id: p.id, pet: p };
    }
    return null;
  }

  function pointerDown(world, x, y) {
    const hit = hitTest(world, x, y);
    world.pointer = { x, y, vx: 0, vy: 0, downX: x, downY: y, downT: world.t, lastT: world.t, hit, dragging: false, petId: null, itemId: null, samples: [{ t: world.t, x, y }] };
    return hit;
  }

  function pointerMove(world, x, y) {
    const ptr = world.pointer;
    if (ptr) {
      const dt = Math.max(1 / 240, world.t - ptr.lastT);
      ptr.vx = ptr.vx * 0.5 + ((x - ptr.x) / dt) * 0.5;
      ptr.vy = ptr.vy * 0.5 + ((y - ptr.y) / dt) * 0.5;
      ptr.x = x; ptr.y = y; ptr.lastT = world.t;
      ptr.samples.push({ t: world.t, x, y });
      while (ptr.samples.length > 2 && ptr.samples[0].t < world.t - VELOCITY_WINDOW) ptr.samples.shift();
      if (!ptr.dragging && ptr.hit && Math.hypot(x - ptr.downX, y - ptr.downY) > 6) {
        ptr.dragging = true;
        if (ptr.hit.kind === 'pet') {
          const p = getPet(world, ptr.hit.id);
          if (p && !['transit', 'away'].includes(p.state)) {
            if (p.carrying) {
              const it = world.items.find((i) => i.id === p.carrying);
              if (it) { it.carriedBy = null; it.claimedBy = null; }
              p.carrying = null;
            }
            ptr.petId = p.id;
            setState(world, p, 'held');
          }
        } else if (ptr.hit.kind === 'item') {
          ptr.itemId = ptr.hit.id;
          const it = ptr.hit.item; it.claimedBy = null;
        }
      }
    } else {
      // Hover petting: rubbing the cursor back and forth over a pet.
      const hit = hitTest(world, x, y);
      const c = world.cursor;
      if (hit && hit.kind === 'pet') {
        const p = hit.pet;
        const dx = Math.abs(x - (p._lastHoverX != null ? p._lastHoverX : x));
        p._lastHoverX = x;
        if (world.t - p.pettingT > 1.2) p.pettingAcc = 0;
        p.pettingT = world.t;
        p.pettingAcc += dx;
        if (p.pettingAcc > 420 && world.t - p.lastPetted > 2.5 && p.surface === 'floor' && !['eat', 'trick', 'held'].includes(p.state)) {
          p.pettingAcc = 0;
          p.lastPetted = world.t;
          setEmote(world, p, 'hearts', 1.8);
          emit(world, { type: 'petted', petId: p.id });
          if (p.state === 'sleep') { p.dur += 10; } else setState(world, p, world.rng() < 0.35 ? 'knead' : 'enjoy');
        }
      }
      void c;
    }
  }

  function pointerUp(world, x, y) {
    const ptr = world.pointer;
    world.pointer = null;
    if (!ptr) return null;
    if (ptr.petId) {
      const p = getPet(world, ptr.petId);
      if (p && p.state === 'held') {
        const v = releaseVelocity(ptr.samples, world.t);
        p.vx = v ? v.x : 0;
        p.vy = v ? v.y : 0;
        p.anim.swing = 0; p.anim.swingV = 0;
        const speed = Math.hypot(p.vx, p.vy);
        p.surface = 'air';
        setState(world, p, speed > 250 ? 'thrown' : 'fall');
        emit(world, { type: 'released', petId: p.id, speed });
        if (speed > 1200) emit(world, { type: 'thrownHard', petId: p.id, speed });
      }
      return { kind: 'drop', petId: ptr.petId };
    }
    if (ptr.itemId) {
      const it = world.items.find((i) => i.id === ptr.itemId);
      if (it) {
        const v = releaseVelocity(ptr.samples, world.t);
        it.vx = v ? clamp(v.x, -2000, 2000) : 0; it.vy = v ? clamp(v.y, -2000, 2000) : 0;
        emit(world, { type: 'itemThrown', itemId: it.id, kind: it.kind });
        if (it.kind === 'ball') {
          for (const p of world.pets) {
            if (p.surface === 'floor' && !['eat', 'sleep', 'held', 'away', 'transit', 'trick'].includes(p.state)) {
              it.claimedBy = p.id; setState(world, p, 'fetch', { itemId: it.id }); break;
            }
          }
        }
      }
      return { kind: 'throwItem', itemId: ptr.itemId };
    }
    if (ptr.hit && ptr.hit.kind === 'pet') {
      const p = getPet(world, ptr.hit.id);
      if (p) {
        click(world, p);
        return { kind: 'click', petId: p.id };
      }
    }
    return null;
  }

  function click(world, p) {
    emit(world, { type: 'clicked', petId: p.id });
    if (p.state === 'sleep') return wake(world, p);
    if (p.surface !== 'floor' || ['eat', 'held', 'trick', 'away', 'transit'].includes(p.state)) return;
    setState(world, p, 'happy');
  }

  // --------------------------------------------------------------- commands

  function command(world, petId, cmd) {
    const p = getPet(world, petId);
    if (!p || p.state === 'transit') return false;
    const c = cmd || {};
    if (p.state === 'away' && c.type !== 'comeBack') return false;
    const onFloor = p.surface === 'floor';
    switch (c.type) {
      case 'trick':
        if (!onFloor) return false;
        setState(world, p, 'trick', { trick: c.trick });
        return true;
      case 'sleep': if (onFloor) setState(world, p, 'sleep'); return onFloor;
      case 'wake': if (p.state === 'sleep') wake(world, p); return true;
      case 'jump': if (onFloor) setState(world, p, 'jump'); return onFloor;
      case 'celebrate': if (onFloor) setState(world, p, 'celebrate'); return onFloor;
      case 'sit': if (onFloor) setState(world, p, 'sit'); return onFloor;
      case 'loaf': case 'knead': case 'slowblink': case 'groom': case 'stretch': case 'scratch':
        if (!onFloor) return false;
        if (c.type === 'scratch') { const b = bounds(world, p); const r = p.x > (world.left + world.right) / 2; setState(world, p, 'walk', { tx: r ? b.max : b.min, then: 'scratch', thenData: { side: r ? 1 : -1 } }); } else setState(world, p, c.type);
        return true;
      case 'scared': if (onFloor) setState(world, p, 'scared'); return onFloor;
      case 'focus': if (onFloor) setState(world, p, 'focus'); return onFloor;
      case 'walkOff': {
        if (!onFloor) return false;
        const toRight = c.side ? c.side === 'right' : world.rng() < 0.5;
        setState(world, p, 'walk', { tx: toRight ? world.right + p.dims.w * 2 : world.left - p.dims.w * 2, offscreen: true });
        return true;
      }
      case 'comeBack': if (p.state === 'away') returnFromAway(world, p); return true;
      case 'come': {
        if (!onFloor) return false;
        const b = bounds(world, p);
        setState(world, p, 'run', { tx: clamp(c.x != null ? c.x : world.cursor.x, b.min, b.max) });
        return true;
      }
      case 'feed': {
        const x = clamp(p.x + p.facing * (60 + world.rng() * 80), world.left + 20, world.right - 20);
        addItem(world, 'food', { sub: c.food || 'kibble', x, y: world.ceiling + 10, forPet: p.id });
        return true;
      }
      case 'ball': {
        const x = world.cursor.inside ? world.cursor.x : p.x + p.facing * 200;
        addItem(world, 'ball', { x, y: world.ceiling + 30, vx: (world.rng() * 2 - 1) * 300, forPet: p.id });
        return true;
      }
      case 'mode': p.mode = c.mode; return true;
      default: return false;
    }
  }

  // ----------------------------------------------------------------- step

  function stepPet(world, p, dt) {
    p.t += dt;
    const a = p.anim;
    // Blinking and ear twitches run regardless of state.
    a.blinkT -= dt;
    if (a.blinkT <= 0) { a.blink = 1; a.blinkT = 2.5 + world.rng() * 4; }
    a.blink = Math.max(0, a.blink - dt * 7);
    a.earT -= dt;
    if (a.earT <= 0) { a.ear = 1; a.earT = 3 + world.rng() * 6; }
    a.ear = Math.max(0, a.ear - dt * 4);
    a.squash = Math.max(0, a.squash - dt * 4);
    const moving = Math.abs(p.vx) > 1 || p.state === 'climb' || p.state === 'ceilingWalk';
    if (moving) a.phase += dt * (Math.abs(p.vx) / Math.max(18, p.dims.w * 0.42) + (p.state === 'climb' ? 4 : 0));
    a.wag += dt * (stats(p).happiness > 60 ? 9 : 4);
    // Eyes and head track the cursor a little.
    const c = world.cursor;
    if (c.inside && p.surface === 'floor') {
      const hx = p.x + p.facing * p.dims.w * 0.35;
      const hy = p.y - p.dims.h * 0.75;
      const dx = c.x - hx; const dy = c.y - hy;
      const d = Math.hypot(dx, dy) || 1;
      a.lookX += ((dx / d) * Math.min(1, d / 200) - a.lookX) * Math.min(1, dt * 6);
      a.lookY += ((dy / d) * Math.min(1, d / 200) - a.lookY) * Math.min(1, dt * 6);
    } else {
      a.lookX *= 1 - Math.min(1, dt * 3);
      a.lookY *= 1 - Math.min(1, dt * 3);
    }
    if (p.emote) { p.emote.t += dt; if (p.emote.t > p.emote.dur) p.emote = null; }
    if (p.state !== 'held' && Math.abs(a.swing) > 0.001) { a.swing *= 1 - Math.min(1, dt * 8); }

    const def = STATES[p.state] || STATES.idle;
    def.update(world, p, dt);
  }

  function step(world, dtRaw) {
    const dt = clamp(dtRaw, 0, 1 / 20);
    world.t += dt;
    world.cursor.still += dt;
    stepToy(world, dt);
    for (const p of world.pets.slice()) stepPet(world, p, dt);
    stepItems(world, dt);
  }

  // Is anything moving? Lets the renderer drop its frame rate while everyone naps.
  function isCalm(world) {
    if (world.toy || world.pointer) return false;
    for (const it of world.items) if (!it.grounded || it.carriedBy) return false;
    for (const p of world.pets) {
      if (p.hidden) continue;
      if (Math.abs(p.vx) > 0.5 || Math.abs(p.vy) > 0.5 || p.surface !== 'floor') return false;
      if (!['sleep', 'lie', 'loaf', 'sit', 'focus', 'idle'].includes(p.state)) return false;
    }
    return true;
  }

  // Overlay asks this every mouse move to decide whether to capture clicks.
  function wantsPointer(world, x, y, pad) {
    if (world.pointer) return true;
    for (const it of world.items) {
      const dx = x - it.x; const dy = y - it.y;
      if (dx * dx + dy * dy <= (it.r + 10) * (it.r + 10)) return true;
    }
    for (const p of world.pets) if (!p.hidden && inBox(hitBox(p), x, y, pad || 6) && (!world.hitFilter || world.hitFilter(p, x, y))) return true;
    return false;
  }

  return {
    releaseVelocity, GRAVITY, createWorld, setBounds, addPet, removePet, getPet, updatePetConfig, step, drainEvents,
    setCursor, pointerDown, pointerMove, pointerUp, hitTest, hitBox, wantsPointer, command, addItem,
    setToy, setState, decide, isCalm, knownTricks, stats, STATES, mulberry32,
  };
});
