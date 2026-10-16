'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/renderer/shared/engine.js');
const S = require('../src/renderer/shared/species.js');

const cat = (over) => Object.assign({ id: 'p1', name: 'Tom', kind: 'procedural', preset: 'ginger-tabby', species: 'cat', size: 1 }, over || {});

function run(world, seconds, onStep) {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    E.step(world, dt);
    if (onStep && onStep(world) === false) break;
  }
}

test('pet stands on the floor and stays inside the walls while roaming', () => {
  const w = E.createWorld({ width: 1200, height: 800, floor: 740, seed: 7 });
  const p = E.addPet(w, cat({ personality: { energy: 1, curious: 1, playful: 1, affection: 0.5 } }));
  let minX = Infinity; let maxX = -Infinity; let leftFloor = false;
  run(w, 120, () => {
    if (p.surface === 'floor') {
      assert.equal(p.y, 740);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    } else leftFloor = true;
  });
  assert.ok(maxX - minX > 50, 'pet should move around');
  if (!leftFloor) {
    assert.ok(minX >= p.dims.w / 2 - 1);
    assert.ok(maxX <= 1200 - p.dims.w / 2 + 1);
  }
});

test('dropped pet falls under gravity and lands', () => {
  const w = E.createWorld({ width: 800, height: 600, floor: 560, seed: 1, settings: { climb: false } });
  const p = E.addPet(w, cat(), { x: 400, fromTop: true });
  assert.equal(p.state, 'fall');
  let landed = false;
  run(w, 3, () => { if (p.surface === 'floor') { landed = true; return false; } return true; });
  assert.ok(landed);
  assert.equal(p.y, 560);
});

test('drag and throw: pointer picks pet up, release throws it with velocity', () => {
  const w = E.createWorld({ width: 1000, height: 700, floor: 650, seed: 3, settings: { climb: false } });
  const p = E.addPet(w, cat(), { x: 500 });
  E.setState(w, p, 'sit');
  const box = E.hitBox(p);
  const gx = box.x + box.w / 2; const gy = box.y + box.h / 2;
  const hit = E.pointerDown(w, gx, gy);
  assert.equal(hit.kind, 'pet');
  E.step(w, 1 / 60);
  E.pointerMove(w, gx + 20, gy - 20);
  assert.equal(p.state, 'held');
  for (let i = 0; i < 10; i++) { E.step(w, 1 / 60); E.pointerMove(w, gx + 20 + i * 25, gy - 40 - i * 15); }
  E.pointerUp(w, gx + 270, gy - 190);
  assert.ok(['thrown', 'fall'].includes(p.state));
  assert.ok(p.vx > 0, 'throw keeps horizontal momentum');
  run(w, 4);
  assert.equal(p.surface, 'floor');
});

test('clicking a pet emits a click event and wakes a sleeping pet', () => {
  const w = E.createWorld({ width: 900, height: 600, floor: 560, seed: 9 });
  const p = E.addPet(w, cat(), { x: 300 });
  E.setState(w, p, 'sleep');
  const b = E.hitBox(p);
  E.pointerDown(w, b.x + b.w / 2, b.y + b.h / 2);
  E.pointerUp(w, b.x + b.w / 2, b.y + b.h / 2);
  const ev = E.drainEvents(w);
  assert.ok(ev.some((e) => e.type === 'clicked'));
  assert.equal(p.state, 'stretch');
});

test('feeding drops food that the pet walks to and eats', () => {
  const w = E.createWorld({ width: 1000, height: 700, floor: 660, seed: 5 });
  const p = E.addPet(w, cat({ stats: { fullness: 20 } }), { x: 200 });
  E.command(w, p.id, { type: 'feed', food: 'fish' });
  assert.equal(w.items.length, 1);
  let ate = null;
  run(w, 25, () => {
    for (const e of E.drainEvents(w)) if (e.type === 'ate') ate = e;
    return !ate;
  });
  assert.ok(ate, 'pet should finish eating');
  assert.equal(ate.food, 'fish');
  assert.equal(w.items.length, 0);
});

test('ball: pet fetches and brings it back', () => {
  const w = E.createWorld({ width: 1200, height: 700, floor: 660, seed: 11 });
  const p = E.addPet(w, cat({ personality: { playful: 1 } }), { x: 600 });
  E.setCursor(w, 300, 500, true);
  E.command(w, p.id, { type: 'ball' });
  let fetched = false;
  run(w, 30, () => { for (const e of E.drainEvents(w)) if (e.type === 'fetched') fetched = true; return !fetched; });
  assert.ok(fetched);
});

test('known tricks can be performed and finish', () => {
  const w = E.createWorld({ width: 900, height: 600, floor: 560, seed: 2 });
  const p = E.addPet(w, cat({ skills: { backflip: { prof: 80 } } }), { x: 400 });
  assert.deepEqual(E.knownTricks(p), ['backflip']);
  for (const tr of S.TRICKS) {
    E.setState(w, p, 'idle');
    p.surface = 'floor'; p.y = w.floor;
    assert.ok(E.command(w, p.id, { type: 'trick', trick: tr.id }), tr.id);
    let done = false;
    run(w, tr.dur + 2, () => { for (const e of E.drainEvents(w)) if (e.type === 'trickDone') done = true; return !done; });
    assert.ok(done, `${tr.id} should finish`);
    assert.equal(p.surface, 'floor', `${tr.id} ends on the floor`);
  }
});

test('walking past an open edge emits a transfer to the next display', () => {
  const w = E.createWorld({ width: 800, height: 600, floor: 560, seed: 4, edges: { right: true } });
  const p = E.addPet(w, cat(), { x: 700 });
  E.setState(w, p, 'walk', { tx: 1000, portal: true });
  let transfer = null;
  run(w, 10, () => { for (const e of E.drainEvents(w)) if (e.type === 'transfer') transfer = e; return !transfer; });
  assert.ok(transfer);
  assert.equal(transfer.side, 'right');
  assert.equal(p.state, 'transit');
});

test('walking off a closed edge sends the pet away, and it comes back', () => {
  const w = E.createWorld({ width: 800, height: 600, floor: 560, seed: 4 });
  const p = E.addPet(w, cat(), { x: 100 });
  E.command(w, p.id, { type: 'walkOff', side: 'left' });
  run(w, 10, () => p.state !== 'away');
  assert.equal(p.state, 'away');
  assert.ok(p.hidden);
  E.command(w, p.id, { type: 'comeBack' });
  assert.equal(p.hidden, false);
  let back = false;
  run(w, 12, () => { if (p.x > 60) back = true; return !back; });
  assert.ok(back);
});

test('climbing: a run at the wall turns into a climb and reaches the ceiling or drops', () => {
  const w = E.createWorld({ width: 600, height: 500, floor: 480, ceiling: 0, seed: 21, settings: { climb: true, ceiling: true } });
  const p = E.addPet(w, cat({ personality: { curious: 1 } }), { x: 450 });
  E.setState(w, p, 'run', { tx: 700, climb: true });
  const surfaces = new Set();
  run(w, 30, () => { surfaces.add(p.surface); });
  assert.ok(surfaces.has('wallR'), 'should climb the right wall');
});

test('focus mode makes pets settle into focus/quiet states', () => {
  const w = E.createWorld({ width: 1000, height: 600, floor: 560, seed: 8 });
  w.mood.focus = true;
  const p = E.addPet(w, cat());
  const seen = {};
  for (let i = 0; i < 200; i++) { p.surface = 'floor'; p.y = w.floor; E.decide(w, p); seen[p.state] = (seen[p.state] || 0) + 1; }
  assert.ok((seen.focus || 0) > 60, JSON.stringify(seen));
});

test('away mood (user idle) puts pets to sleep', () => {
  const w = E.createWorld({ width: 1000, height: 600, floor: 560, seed: 8 });
  w.mood.away = true;
  const p = E.addPet(w, cat());
  let sleeps = 0;
  for (let i = 0; i < 50; i++) { E.decide(w, p); if (p.state === 'sleep') sleeps++; }
  assert.ok(sleeps > 30);
});

test('feather wand rope hangs below the cursor and pets chase it', () => {
  const w = E.createWorld({ width: 1000, height: 600, floor: 560, seed: 12 });
  const p = E.addPet(w, cat(), { x: 100 });
  E.setCursor(w, 700, 300, true);
  E.setToy(w, 'wand');
  run(w, 3);
  assert.ok(w.toy.tip.y > 300, 'feather hangs below cursor');
  assert.ok(p.x > 300, 'pet runs toward the toy');
});

test('hover petting emits petted event', () => {
  const w = E.createWorld({ width: 1000, height: 600, floor: 560, seed: 13 });
  const p = E.addPet(w, cat(), { x: 500 });
  E.setState(w, p, 'sit');
  const b = E.hitBox(p);
  let petted = false;
  for (let i = 0; i < 80 && !petted; i++) {
    E.step(w, 1 / 60);
    E.pointerMove(w, b.x + (i % 2 ? 4 : b.w - 4), b.y + b.h / 2);
    for (const e of E.drainEvents(w)) if (e.type === 'petted') petted = true;
  }
  assert.ok(petted);
});

test('engine performance: 12 pets for 60 simulated seconds', () => {
  const w = E.createWorld({ width: 2560, height: 1440, floor: 1380, seed: 99 });
  for (let i = 0; i < 12; i++) E.addPet(w, cat({ id: 'p' + i, preset: S.PRESETS[i % S.PRESETS.length].id }));
  const t0 = process.hrtime.bigint();
  run(w, 60);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  // 3600 frames x 12 pets; a frame budget of 16ms leaves the engine a tiny slice of it.
  assert.ok(ms / 3600 < 2, `avg ${(ms / 3600).toFixed(3)} ms/frame`);
});

test('cat behaviours: loaf, knead, slow blink, scratch and the hunting crouch', () => {
  const w = E.createWorld({ width: 1000, height: 600, floor: 560, seed: 31 });
  const p = E.addPet(w, cat(), { x: 500 });
  for (const type of ['loaf', 'knead', 'slowblink']) {
    assert.ok(E.command(w, p.id, { type }), type);
    assert.equal(p.state, type);
    run(w, 6);
  }
  E.command(w, p.id, { type: 'scratch' });
  let scratched = false;
  run(w, 20, () => { if (p.state === 'scratch') scratched = true; return !scratched; });
  assert.ok(scratched, 'walks to the wall and scratches');
  E.setState(w, p, 'idle');
  E.setCursor(w, p.x + 10, w.floor - 150, true);
  E.setState(w, p, 'hunt', { tx: p.x + 10, ty: w.floor - 150 });
  let pounced = false;
  run(w, 3, () => { if (p.state === 'pounce') pounced = true; return !pounced; });
  assert.ok(pounced, 'crouch ends in a pounce');
});

test('level curve', () => {
  assert.equal(S.levelForXp(0), 1);
  assert.equal(S.levelForXp(49), 1);
  assert.equal(S.levelForXp(50), 2);
  assert.equal(S.levelForXp(150), 3);
  assert.equal(S.levelForXp(500), 5);
  assert.equal(S.xpForLevel(5), 500);
});

test('holding still before letting go drops the cat instead of throwing it', () => {
  const w = E.createWorld({ width: 1000, height: 700, floor: 650, seed: 3, settings: { climb: false } });
  const p = E.addPet(w, cat(), { x: 500 });
  E.setState(w, p, 'sit');
  const b = E.hitBox(p);
  E.pointerDown(w, b.x + b.w / 2, b.y + b.h / 2);
  for (let i = 0; i < 8; i++) { E.step(w, 1 / 60); E.pointerMove(w, b.x + b.w / 2 + i * 30, b.y + b.h / 2 - i * 10); }
  for (let i = 0; i < 12; i++) E.step(w, 1 / 60); // hold still ~200 ms
  E.pointerUp(w, b.x + b.w / 2 + 210, b.y + b.h / 2 - 70);
  assert.equal(p.vx, 0);
  assert.equal(p.state, 'fall');
});

test('releaseVelocity ignores slow drags and caps flicks', () => {
  assert.equal(E.releaseVelocity([{ t: 0, x: 0, y: 0 }, { t: 0.1, x: 10, y: 0 }], 0.1), null);
  const v = E.releaseVelocity([{ t: 0, x: 0, y: 0 }, { t: 0.05, x: 500, y: 0 }], 0.05);
  assert.ok(v.x > 2000 && v.x <= 2600);
});
