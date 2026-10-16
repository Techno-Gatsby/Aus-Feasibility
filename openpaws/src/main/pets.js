'use strict';
/*
 * Pet registry and care loop: needs (fullness, energy, happiness, hygiene, bond), XP and
 * levels, trick training, treats (earned by being productive) and achievements.
 */
const crypto = require('crypto');
const Species = require('../renderer/shared/species.js');

const DECAY_PER_HOUR = { fullness: 6, energy: 4.5, happiness: 3.5, hygiene: 2.5 };
const XP = { petted: 3, clicked: 1, ate: 4, fetched: 5, trickDone: 6, chat: 2, train: 4, reminderDone: 8, focusDone: 15, slowblink: 2, knead: 2, greet: 2, returned: 3 };

const ACHIEVEMENTS = [
  { id: 'adopt', icon: '🏠', title: 'New best friend', desc: 'Adopt your first cat', test: (c) => c.adopted >= 1 },
  { id: 'clowder', icon: '🐈‍⬛', title: 'Clowder', desc: 'Have three cats at once', test: (c, st) => st.pets.length >= 3 },
  { id: 'photo', icon: '📸', title: 'Mirror image', desc: 'Create a cat from a photo', test: (c) => c.photoPets >= 1 },
  { id: 'first-meal', icon: '🐟', title: 'Dinner is served', desc: 'Feed a cat', test: (c) => c.ate >= 1 },
  { id: 'chef', icon: '👨‍🍳', title: 'Private chef', desc: 'Feed your cats 50 times', test: (c) => c.ate >= 50 },
  { id: 'pets-10', icon: '💞', title: 'Chin scratches', desc: 'Pet a cat 10 times', test: (c) => c.petted >= 10 },
  { id: 'pets-100', icon: '💗', title: 'Purr machine', desc: 'Pet a cat 100 times', test: (c) => c.petted >= 100 },
  { id: 'fetch-25', icon: '⚾', title: 'Good sport', desc: 'Play fetch 25 times', test: (c) => c.fetched >= 25 },
  { id: 'trick-3', icon: '🎓', title: 'Show-off', desc: 'Teach one cat 3 tricks', test: (c, st) => st.pets.some((p) => Species.TRICKS.filter((t) => (p.skills[t.id] || {}).prof >= Species.LEARNED).length >= 3) },
  { id: 'level-5', icon: '⭐', title: 'Rising star', desc: 'Reach level 5', test: (c, st) => st.pets.some((p) => p.level >= 5) },
  { id: 'level-10', icon: '🌟', title: 'Superstar', desc: 'Reach level 10', test: (c, st) => st.pets.some((p) => p.level >= 10) },
  { id: 'chat-50', icon: '💬', title: 'Chatterbox', desc: 'Have 50 conversations', test: (c) => c.chat >= 50 },
  { id: 'reminders-10', icon: '✅', title: 'On top of things', desc: 'Complete 10 reminders', test: (c) => c.reminderDone >= 10 },
  { id: 'focus-5', icon: '🎯', title: 'In the zone', desc: 'Finish 5 focus sessions', test: (c) => c.focusDone >= 5 },
  { id: 'focus-25', icon: '🧠', title: 'Deep worker', desc: 'Finish 25 focus sessions', test: (c) => c.focusDone >= 25 },
  { id: 'climber', icon: '🧗', title: 'Up the curtains', desc: 'A cat reached the ceiling', test: (c) => c.ceiling >= 1 },
  { id: 'yeet', icon: '🚀', title: 'Air mail', desc: 'Throw a cat really hard (it landed on its feet)', test: (c) => c.thrownHard >= 1 },
  { id: 'explorer', icon: '🗺️', title: 'Explorer', desc: 'A cat walked to another screen', test: (c) => c.transfer >= 1 },
  { id: 'streak-7', icon: '📅', title: 'Week together', desc: 'Spend 7 days in a row with your cat', test: (c) => (c.streak || 0) >= 7 },
  { id: 'night-owl', icon: '🦉', title: 'Night owl', desc: 'Chat after midnight', test: (c) => c.nightChat >= 1 },
  { id: 'slowblink', icon: '😌', title: 'I love you too', desc: 'Get a slow blink from your cat', test: (c) => c.slowblink >= 1 },
];

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

class Pets {
  constructor(store, emit) {
    this.store = store;
    this.emit = emit || (() => {});
    this.runtime = {}; // petId -> {state, surface} reported by overlays
    this.lastTick = Date.now();
    this.catchUp();
    this.markDay();
  }

  list() { return this.store.get('pets'); }
  get(id) { return this.list().find((p) => p.id === id); }
  active() { return this.list().filter((p) => p.active !== false); }

  // Builds a new pet config from a companion, a preset, or a photo/sprite asset.
  create(spec) {
    const sp = spec || {};
    const comp = sp.companion != null ? Species.COMPANIONS[sp.companion] : null;
    const id = 'cat_' + crypto.randomBytes(5).toString('hex');
    const pet = {
      id,
      name: (sp.name || (comp && comp.name) || 'Kitty').slice(0, 40),
      kind: sp.kind || 'procedural',
      species: 'cat',
      preset: sp.preset || (comp && comp.preset) || 'ginger-tabby',
      colors: sp.colors || undefined,
      pattern: sp.pattern || undefined,
      ears: sp.ears || undefined,
      fluff: sp.fluff,
      gender: sp.gender || (comp && comp.gender) || '',
      age: sp.age != null ? sp.age : comp ? comp.age : 1,
      nickname: sp.nickname || (comp && comp.nickname) || '',
      story: sp.story || (comp && comp.story) || '',
      personality: Object.assign({}, Species.PERSONALITY_DEFAULT, comp ? comp.personality : {}, sp.personality || {}),
      accessories: Object.assign({ hat: 'none', neck: 'collar', face: 'none', neckColor: '#e8516b', hatColor: '#e8516b' }, sp.accessories || {}),
      size: sp.size || 1,
      voice: Object.assign({ babblePitch: 520, pitch: 1.3, rate: 1.05, name: '' }, sp.voice || {}),
      asset: sp.asset || undefined,
      stats: { fullness: 80, energy: 85, happiness: 85, hygiene: 95, bond: 20 },
      xp: 0, level: 1,
      skills: { sit: { prof: 35 }, slowblink: { prof: 35 } },
      mode: 'roam', active: true,
      adoptedAt: Date.now(),
      treatsGiven: 0,
    };
    const pets = this.list().slice();
    pets.push(pet);
    this.store.set('pets', pets);
    this.count('adopted');
    if (pet.kind !== 'procedural') this.count('photoPets');
    this.checkAchievements();
    this.emit('pets');
    return pet;
  }

  update(id, patch) {
    const pets = this.list().map((p) => {
      if (p.id !== id) return p;
      const next = Object.assign({}, p, patch);
      for (const k of ['stats', 'personality', 'accessories', 'voice', 'skills']) if (patch[k]) next[k] = Object.assign({}, p[k], patch[k]);
      if (patch.asset) next.asset = Object.assign({}, p.asset || {}, patch.asset);
      if (typeof next.name === 'string') next.name = next.name.slice(0, 40) || p.name;
      return next;
    });
    this.store.set('pets', pets);
    this.emit('pets', id);
    return this.get(id);
  }

  remove(id) {
    this.store.set('pets', this.list().filter((p) => p.id !== id));
    const hist = Object.assign({}, this.store.get('memory.history'));
    delete hist[id];
    this.store.set('memory.history', hist);
    this.emit('pets');
  }

  // ------------------------------------------------------------- needs

  // On startup, apply time spent away (gentler than live decay; cats are forgiving).
  catchUp() {
    const last = this.store.get('app.lastSeen') || Date.now();
    const hours = Math.min(48, Math.max(0, (Date.now() - last) / 3600000));
    if (hours > 0.05) this.decay(hours * 0.35, false);
    this.store.set('app.lastSeen', Date.now());
  }

  decay(hours, live) {
    const pets = this.list().map((p) => {
      const st = Object.assign({}, p.stats);
      const sleeping = live && this.runtime[p.id] && this.runtime[p.id].state === 'sleep';
      st.fullness = clamp(st.fullness - DECAY_PER_HOUR.fullness * hours, 5, 100);
      st.hygiene = clamp(st.hygiene - DECAY_PER_HOUR.hygiene * hours, 10, 100);
      st.energy = sleeping ? clamp(st.energy + 22 * hours, 0, 100) : clamp(st.energy - DECAY_PER_HOUR.energy * hours, 8, 100);
      const hungerPenalty = st.fullness < 30 ? 2 : 1;
      st.happiness = clamp(st.happiness - DECAY_PER_HOUR.happiness * hours * hungerPenalty, 10, 100);
      return Object.assign({}, p, { stats: st });
    });
    this.store.set('pets', pets);
  }

  tick() {
    const now = Date.now();
    const hours = (now - this.lastTick) / 3600000;
    this.lastTick = now;
    if (hours > 0) this.decay(hours, true);
    this.store.set('app.lastSeen', now);
    this.markDay();
    this.emit('stats');
  }

  bump(id, delta, xp) {
    const p = this.get(id);
    if (!p) return null;
    const st = Object.assign({}, p.stats);
    for (const [k, v] of Object.entries(delta || {})) st[k] = clamp((st[k] || 0) + v, 0, 100);
    const nextXp = (p.xp || 0) + (xp || 0);
    const level = Species.levelForXp(nextXp);
    const leveled = level > (p.level || 1);
    this.update(id, { stats: st, xp: nextXp, level });
    if (leveled) {
      const unlocked = Species.TRICKS.filter((t) => t.minLevel === level).map((t) => t.label);
      this.emit('levelUp', { petId: id, level, unlocked });
    }
    return this.get(id);
  }

  // Overlay events -> care effects.
  onEvents(events) {
    for (const ev of events || []) {
      const id = ev.petId;
      switch (ev.type) {
        case 'petted': this.bump(id, { happiness: 6, bond: 2 }, XP.petted); this.count('petted'); break;
        case 'clicked': this.bump(id, { happiness: 1 }, XP.clicked); break;
        case 'ate': {
          const food = Species.FOODS[ev.food] || Species.FOODS.fish;
          this.bump(id, { fullness: food.fullness, happiness: food.happiness, bond: 1 }, XP.ate);
          this.count('ate');
          break;
        }
        case 'fetched': this.bump(id, { happiness: 8, energy: -4, bond: 1 }, XP.fetched); this.count('fetched'); break;
        case 'trickDone': this.bump(id, { happiness: 3, energy: -2 }, XP.trickDone); this.count('tricks'); this.practice(id, ev.trick, 2); break;
        case 'swat': this.bump(id, { happiness: 2, energy: -1 }, 1); break;
        case 'slowblink': this.bump(id, { bond: 2 }, XP.slowblink); this.count('slowblink'); break;
        case 'knead': this.bump(id, { happiness: 3 }, XP.knead); break;
        case 'greet': this.bump(id, { happiness: 3 }, XP.greet); break;
        case 'returned': this.bump(id, { happiness: 4, energy: -6 }, XP.returned); break;
        case 'thrownHard': this.count('thrownHard'); this.bump(id, { happiness: -3 }, 0); break;
        case 'hiss': this.bump(id, { happiness: -4 }, 0); break;
        case 'ceiling': this.count('ceiling'); break;
        case 'transfer': this.count('transfer'); break;
        default: break;
      }
    }
    this.checkAchievements();
  }

  setRuntime(states) { Object.assign(this.runtime, states || {}); }

  // ------------------------------------------------------------ training

  // Practising a trick: success chance grows with proficiency; level gates what can be learned.
  train(id, trickId) {
    const p = this.get(id);
    const t = Species.trick(trickId);
    if (!p || !t) return { ok: false, reason: 'Unknown trick' };
    if ((p.level || 1) < t.minLevel) return { ok: false, reason: `${p.name} needs level ${t.minLevel} for ${t.label}` };
    if ((p.stats.energy || 0) < 12) return { ok: false, reason: `${p.name} is too tired to practise. Let them nap first.` };
    const prof = (p.skills[trickId] || {}).prof || 0;
    const success = Math.random() < 0.35 + prof / 140;
    const gain = success ? 9 + Math.round(Math.random() * 6) : 3;
    const next = this.practice(id, trickId, gain);
    this.bump(id, { energy: -4, happiness: success ? 3 : -1 }, XP.train);
    const learnedNow = prof < Species.LEARNED && next >= Species.LEARNED;
    return { ok: true, success, prof: next, learnedNow, trick: t };
  }

  practice(id, trickId, gain) {
    const p = this.get(id);
    if (!p || !trickId) return 0;
    const cur = (p.skills[trickId] || {}).prof || 0;
    const prof = clamp(cur + gain, 0, 100);
    this.update(id, { skills: { [trickId]: { prof, last: Date.now() } } });
    return prof;
  }

  knownTricks(p) { return Species.TRICKS.filter((t) => ((p.skills || {})[t.id] || {}).prof >= Species.LEARNED); }

  // -------------------------------------------------------------- treats

  treats() { return this.store.get('treats') || 0; }
  earnTreats(n, why) {
    const total = this.treats() + n;
    this.store.set('treats', total);
    this.emit('treats', { total, earned: n, why });
    return total;
  }
  spendTreat() {
    const t = this.treats();
    if (t <= 0) return false;
    this.store.set('treats', t - 1);
    this.emit('treats', { total: t - 1 });
    return true;
  }

  // -------------------------------------------------------- achievements

  count(name, n) {
    const c = Object.assign({}, this.store.get('achievements.counters'));
    c[name] = (c[name] || 0) + (n || 1);
    this.store.set('achievements.counters', c);
  }

  markDay() {
    const days = (this.store.get('achievements.days') || []).slice();
    const d = today();
    if (days[days.length - 1] === d) return;
    days.push(d);
    while (days.length > 400) days.shift();
    this.store.set('achievements.days', days);
    // Consecutive-day streak, counted backwards from today.
    let streak = 1;
    for (let i = days.length - 1; i > 0; i--) {
      const a = new Date(days[i]); const b = new Date(days[i - 1]);
      if (Math.round((a - b) / 86400000) === 1) streak++; else break;
    }
    const c = Object.assign({}, this.store.get('achievements.counters'), { streak });
    this.store.set('achievements.counters', c);
  }

  checkAchievements() {
    const ach = this.store.get('achievements');
    const unlocked = Object.assign({}, ach.unlocked);
    const st = { pets: this.list() };
    const fresh = [];
    for (const a of ACHIEVEMENTS) {
      if (unlocked[a.id]) continue;
      let ok = false;
      try { ok = a.test(ach.counters || {}, st); } catch (_) { ok = false; }
      if (ok) { unlocked[a.id] = Date.now(); fresh.push(a); }
    }
    if (fresh.length) {
      this.store.set('achievements.unlocked', unlocked);
      for (const a of fresh) { this.earnTreats(2, 'achievement'); this.emit('achievement', a); }
    }
    return fresh;
  }

  achievementList() {
    const unlocked = this.store.get('achievements.unlocked') || {};
    return ACHIEVEMENTS.map((a) => ({ id: a.id, icon: a.icon, title: a.title, desc: a.desc, unlockedAt: unlocked[a.id] || null }));
  }

  mood(p) {
    const s = p.stats || {};
    if (s.fullness < 25) return 'hungry';
    if (s.energy < 20) return 'sleepy';
    if (s.hygiene < 25) return 'scruffy';
    if (s.happiness > 80) return 'delighted';
    if (s.happiness > 55) return 'content';
    if (s.happiness > 30) return 'a bit bored';
    return 'lonely';
  }
}

module.exports = { Pets, ACHIEVEMENTS, XP };
