/*
 * OpenPaws cats: body plan, breeds and coats, accessories, tricks, foods and the adoptable
 * companions. Shared between the Electron main process (CommonJS) and the renderers.
 * Cartoon cats are drawn procedurally from these parameters; no bitmap art ships.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PawsSpecies = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Base cat body plan in pixels at size 1. (0,0) is where the feet touch the floor.
  const CAT = {
    label: 'Cat', bodyLen: 44, bodyH: 21, legLen: 15, legW: 6.4, headR: 17, headX: 19, headY: 7,
    ears: 'pointy', earSize: 11, face: 'round', tail: 'long', tailLen: 34, tailW: 5.4, eye: 4.6,
    walk: 46, run: 170, jump: 1.0, climb: 1.0, fluff: 0, build: 1, food: 'fish',
  };
  const SPECIES = { cat: CAT };

  // Coats and breeds. colors: base, belly, accent (pattern), accent2, nose, eye, eye2 (odd eyes), inner (ear), pad.
  const PRESETS = [
    { id: 'ginger-tabby', label: 'Ginger Tabby', pattern: 'tabby', colors: { base: '#f0a656', belly: '#fde7cc', accent: '#cf7426', nose: '#e8908c', eye: '#86b94a', inner: '#f5b9ad' } },
    { id: 'grey-tabby', label: 'Grey Tabby', pattern: 'tabby', colors: { base: '#9a948c', belly: '#e6e0d8', accent: '#4f4a45', nose: '#c98a86', eye: '#d6b23f', inner: '#e3aca6' } },
    { id: 'silver-tabby', label: 'Silver Tabby', pattern: 'tabby', colors: { base: '#d3d5d6', belly: '#f4f4f2', accent: '#3d3f44', nose: '#d9908e', eye: '#5fae5b', inner: '#efb6b3' } },
    { id: 'tuxedo', label: 'Tuxedo', pattern: 'tuxedo', colors: { base: '#29292e', belly: '#f8f7f4', accent: '#f8f7f4', nose: '#e8a3a8', eye: '#cfb23a', inner: '#e3a3a8' } },
    { id: 'bombay', label: 'Bombay', pattern: 'solid', colors: { base: '#1f1f23', belly: '#2a2a30', accent: '#141417', nose: '#33333a', eye: '#e8ae2c', inner: '#4a3a40' } },
    { id: 'snow', label: 'Snow White', pattern: 'solid', colors: { base: '#fbfaf7', belly: '#ffffff', accent: '#ebe7e0', nose: '#f2a7b1', eye: '#6ea7e8', eye2: '#e3b23c', inner: '#f6c1c8' } },
    { id: 'calico', label: 'Calico', pattern: 'calico', colors: { base: '#faf6f0', belly: '#ffffff', accent: '#e38f45', accent2: '#3a3434', nose: '#f0a7a3', eye: '#b8a03a', inner: '#f3bab4' } },
    { id: 'tortie', label: 'Tortoiseshell', pattern: 'tortie', colors: { base: '#3b2c26', belly: '#4a372e', accent: '#c4762f', accent2: '#e2a35a', nose: '#5a3f3a', eye: '#d29a2c', inner: '#a8786e' } },
    { id: 'siamese', label: 'Siamese', pattern: 'points', face: 'wedge', ears: 'big', colors: { base: '#f3e7d4', belly: '#f9f2e6', accent: '#4e3a30', nose: '#3e2f2a', eye: '#4d9fe0', inner: '#7a5e50' } },
    { id: 'ragdoll', label: 'Ragdoll', pattern: 'mitted', fluff: 0.8, colors: { base: '#f5efe7', belly: '#ffffff', accent: '#8d7464', nose: '#e8a6a6', eye: '#5aa2e6', inner: '#c79e8c' } },
    { id: 'russian-blue', label: 'Russian Blue', pattern: 'solid', build: 0.95, colors: { base: '#8c96a4', belly: '#a1aab7', accent: '#77808e', nose: '#6f6878', eye: '#61c25a', inner: '#b49ca8' } },
    { id: 'british-shorthair', label: 'British Shorthair', pattern: 'solid', face: 'chubby', build: 1.12, ears: 'small', colors: { base: '#8d94a0', belly: '#a3a9b4', accent: '#78808c', nose: '#6e6874', eye: '#e59a33', inner: '#b49ca8' } },
    { id: 'maine-coon', label: 'Maine Coon', pattern: 'tabby', fluff: 1, ears: 'tufted', size: 1.18, colors: { base: '#8b6748', belly: '#efe2cf', accent: '#3d2a1e', nose: '#b47a6a', eye: '#c9a43a', inner: '#e6b9a4' } },
    { id: 'scottish-fold', label: 'Scottish Fold', pattern: 'tabby', ears: 'fold', face: 'chubby', colors: { base: '#c9b29a', belly: '#f2e8dc', accent: '#8a6c52', nose: '#d29890', eye: '#e2a23a', inner: '#e6b5a8' } },
    { id: 'persian', label: 'Persian', pattern: 'solid', face: 'flat', fluff: 1, ears: 'small', colors: { base: '#f3e2c8', belly: '#fbf3e6', accent: '#e2c9a6', nose: '#e7a19b', eye: '#d9862c', inner: '#f0c4b4' } },
    { id: 'bengal', label: 'Bengal', pattern: 'rosettes', build: 0.95, colors: { base: '#dca45c', belly: '#f6e2bf', accent: '#3e2614', accent2: '#8a5a2a', nose: '#c47b68', eye: '#7cae3c', inner: '#e8ac9c' } },
    { id: 'sphynx', label: 'Sphynx', pattern: 'sphynx', ears: 'huge', face: 'wedge', build: 0.9, colors: { base: '#f1c7bc', belly: '#f6d6cd', accent: '#d9a294', nose: '#e08f8f', eye: '#8ab84a', inner: '#e9a9a0' } },
    { id: 'ginger-bicolor', label: 'Ginger & White', pattern: 'bicolor', colors: { base: '#ec9b4b', belly: '#ffffff', accent: '#ffffff', nose: '#f1a1a0', eye: '#7fae46', inner: '#f5b9ad' } },
    { id: 'smoke', label: 'Smoke Longhair', pattern: 'solid', fluff: 0.9, colors: { base: '#5d5f66', belly: '#8d9098', accent: '#3e4046', nose: '#5c5258', eye: '#e3b33c', inner: '#a68e98' } },
  ];

  const ACCESSORIES = {
    hat: [
      { id: 'none', label: 'None' }, { id: 'bow', label: 'Hair bow' }, { id: 'flower', label: 'Flower' },
      { id: 'beanie', label: 'Beanie' }, { id: 'party', label: 'Party hat' }, { id: 'crown', label: 'Crown' },
      { id: 'witch', label: 'Witch hat' }, { id: 'santa', label: 'Santa hat' }, { id: 'halo', label: 'Halo' },
    ],
    neck: [
      { id: 'none', label: 'None' }, { id: 'collar', label: 'Collar & tag' }, { id: 'bell', label: 'Bell collar' },
      { id: 'bandana', label: 'Bandana' }, { id: 'scarf', label: 'Scarf' }, { id: 'bowtie', label: 'Bow tie' },
    ],
    face: [
      { id: 'none', label: 'None' }, { id: 'glasses', label: 'Glasses' }, { id: 'sunglasses', label: 'Sunglasses' },
      { id: 'blush', label: 'Rosy cheeks' },
    ],
  };

  // Tricks a cat can learn. minLevel gates training; proficiency >= LEARNED makes it "known".
  const TRICKS = [
    { id: 'sit', label: 'Sit', emoji: '🐈', minLevel: 1, dur: 2.4 },
    { id: 'wave', label: 'Wave', emoji: '👋', minLevel: 1, dur: 2.2 },
    { id: 'slowblink', label: 'Slow blink', emoji: '😌', minLevel: 1, dur: 2.2 },
    { id: 'knead', label: 'Make biscuits', emoji: '🥖', minLevel: 2, dur: 4.0 },
    { id: 'beg', label: 'Beg', emoji: '🥺', minLevel: 2, dur: 2.6 },
    { id: 'spin', label: 'Spin', emoji: '🌀', minLevel: 2, dur: 1.6 },
    { id: 'zoomies', label: 'Zoomies', emoji: '💨', minLevel: 3, dur: 4.5 },
    { id: 'rollover', label: 'Roll over', emoji: '🔄', minLevel: 3, dur: 1.8 },
    { id: 'highfive', label: 'High five', emoji: '🖐️', minLevel: 4, dur: 2.2 },
    { id: 'dance', label: 'Dance', emoji: '💃', minLevel: 5, dur: 4.0 },
    { id: 'playdead', label: 'Play dead', emoji: '💀', minLevel: 6, dur: 3.2 },
    { id: 'backflip', label: 'Backflip', emoji: '🤸', minLevel: 7, dur: 1.3 },
  ];
  const LEARNED = 30;

  const FOODS = {
    fish: { label: 'Fish', emoji: '🐟', fullness: 30, happiness: 8 },
    kibble: { label: 'Kibble', emoji: '🥣', fullness: 25, happiness: 4 },
    tuna: { label: 'Tuna can', emoji: '🥫', fullness: 34, happiness: 10 },
    milk: { label: 'Cat milk', emoji: '🥛', fullness: 12, happiness: 9 },
    cookie: { label: 'Treat', emoji: '🍪', fullness: 8, happiness: 15, treat: true },
  };

  // Adoptable cats. Names, stories and personalities are original to OpenPaws.
  const COMPANIONS = [
    { name: 'Clementine', preset: 'ginger-tabby', gender: 'girl', age: 2, nickname: 'Sunbeam Collector', personality: { energy: 0.5, playful: 0.6, curious: 0.7, affection: 0.85 }, story: 'Follows the warm patch of sunlight across your desk and naps wherever it lands.' },
    { name: 'Oreo', preset: 'tuxedo', gender: 'boy', age: 4, nickname: 'The Gentleman', personality: { energy: 0.4, playful: 0.5, curious: 0.6, affection: 0.7 }, story: 'Always dressed for a meeting, and insists on sitting in on yours.' },
    { name: 'Patches', preset: 'calico', gender: 'girl', age: 3, nickname: 'Patchwork Queen', personality: { energy: 0.6, playful: 0.7, curious: 0.6, affection: 0.6 }, story: 'Has an opinion about every tab you open, and shares all of them.' },
    { name: 'Kumo', preset: 'ragdoll', gender: 'boy', age: 2, nickname: 'Cloud Loaf', personality: { energy: 0.25, playful: 0.4, curious: 0.4, affection: 0.95 }, story: 'Goes completely limp the moment you pick him up. A professional cuddler.' },
    { name: 'Luna', preset: 'bombay', gender: 'girl', age: 1, nickname: 'Night Shift', personality: { energy: 0.75, playful: 0.8, curious: 0.9, affection: 0.5 }, story: 'Most awake after midnight. Reminds you to go to bed, then stays up herself.' },
    { name: 'Sterling', preset: 'russian-blue', gender: 'boy', age: 5, nickname: 'Quiet Supervisor', personality: { energy: 0.3, playful: 0.3, curious: 0.5, affection: 0.7 }, story: 'Watches you work with calm approval and slow-blinks when you do well.' },
    { name: 'Jinx', preset: 'bengal', gender: 'boy', age: 2, nickname: 'Wall Climber', personality: { energy: 0.95, playful: 0.9, curious: 0.95, affection: 0.4 }, story: 'Has never met a screen edge he could not climb.' },
    { name: 'Mochi', preset: 'scottish-fold', gender: 'girl', age: 2, nickname: 'Round Little Owl', personality: { energy: 0.4, playful: 0.6, curious: 0.5, affection: 0.9 }, story: 'Folds her ears back even further when she is pleased with you.' },
    { name: 'Duchess', preset: 'persian', gender: 'girl', age: 6, nickname: 'Her Fluffiness', personality: { energy: 0.15, playful: 0.3, curious: 0.3, affection: 0.75 }, story: 'Accepts compliments, treats and nothing less than the comfiest spot.' },
    { name: 'Bear', preset: 'maine-coon', gender: 'boy', age: 4, nickname: 'Gentle Giant', personality: { energy: 0.5, playful: 0.6, curious: 0.6, affection: 0.9 }, story: 'Twice the size of the other cats and half as fussy.' },
    { name: 'Biscuit', preset: 'british-shorthair', gender: 'boy', age: 3, nickname: 'Snack Monster', personality: { energy: 0.3, playful: 0.5, curious: 0.4, affection: 0.7 }, story: 'Can hear a treat being thought about from three rooms away.' },
    { name: 'Coco', preset: 'siamese', gender: 'girl', age: 2, nickname: 'Chatterbox', personality: { energy: 0.7, playful: 0.7, curious: 0.8, affection: 0.8 }, story: 'Narrates your whole day, with commentary, whether you asked or not.' },
    { name: 'Pickle', preset: 'tortie', gender: 'girl', age: 3, nickname: 'Tiny Tornado', personality: { energy: 0.85, playful: 0.85, curious: 0.7, affection: 0.5 }, story: 'All attitude, all the time. Secretly loves a chin scratch.' },
    { name: 'Ghost', preset: 'snow', gender: 'boy', age: 2, nickname: 'Odd-Eyed Dreamer', personality: { energy: 0.4, playful: 0.5, curious: 0.7, affection: 0.7 }, story: 'One blue eye, one gold, and both fixed on the bird outside.' },
    { name: 'Noodle', preset: 'sphynx', gender: 'boy', age: 2, nickname: 'Warm Peach', personality: { energy: 0.7, playful: 0.8, curious: 0.8, affection: 1 }, story: 'Always cold, always looking for a lap, always delighted to see you.' },
    { name: 'Marmalade', preset: 'ginger-bicolor', gender: 'boy', age: 1, nickname: 'Morning Hype', personality: { energy: 0.8, playful: 0.9, curious: 0.7, affection: 0.8 }, story: 'Ready for breakfast before you are. Every single day.' },
    { name: 'Pepper', preset: 'silver-tabby', gender: 'girl', age: 3, nickname: 'Boss Lady', personality: { energy: 0.6, playful: 0.5, curious: 0.7, affection: 0.6 }, story: 'Convinced she runs the place. She is probably right.' },
    { name: 'Smokey', preset: 'smoke', gender: 'boy', age: 5, nickname: 'Shadow Fluff', personality: { energy: 0.35, playful: 0.4, curious: 0.5, affection: 0.75 }, story: 'Appears silently next to you whenever you open a snack.' },
  ];

  const PERSONALITY_DEFAULT = { energy: 0.55, playful: 0.6, curious: 0.65, affection: 0.7 };

  function preset(id) { return PRESETS.find((p) => p.id === id) || PRESETS[0]; }

  // Full drawing plan for a pet config: base cat + breed + user overrides.
  function plan(cfg) {
    const pr = preset(cfg.preset);
    const out = Object.assign({}, CAT, { species: 'cat' });
    for (const k of ['ears', 'face', 'fluff', 'build', 'tail']) if (pr[k] != null) out[k] = pr[k];
    for (const k of ['ears', 'face', 'fluff', 'build', 'tail']) if (cfg[k] != null) out[k] = cfg[k];
    out.pattern = cfg.pattern || pr.pattern || 'solid';
    out.colors = Object.assign({}, pr.colors, cfg.colors || {});
    const b = out.build || 1;
    out.bodyH *= b; out.legW *= b; out.headR *= (1 + (b - 1) * 0.6);
    if (out.fluff > 0.5) { out.tailW *= 1.7; out.bodyH *= 1.06; }
    return out;
  }

  function breedSize(cfg) { return (cfg.size || 1) * (preset(cfg.preset).size || 1); }

  // Bounding box of a standing cat, scaled. Used for hit tests and physics.
  function dims(cfg, globalScale) {
    const s = breedSize(cfg) * (globalScale || 1);
    if (cfg.kind && cfg.kind !== 'procedural') {
      const h = 92 * s;
      const ar = cfg.asset && cfg.asset.aspect ? cfg.asset.aspect : 1;
      return { w: Math.max(30 * s, h * ar), h, s };
    }
    const p = plan(cfg);
    const w = (p.bodyLen + p.headR * 1.3 + 8) * s;
    const h = (p.legLen + p.bodyH + p.headY + p.headR * 1.25 + p.earSize * 0.55) * s;
    return { w, h, s };
  }

  function trick(id) { return TRICKS.find((t) => t.id === id); }

  // Level curve: level L needs 25*L*(L-1) total XP (L2 = 50, L3 = 150, L5 = 500, L10 = 2250).
  function levelForXp(xp) { return Math.max(1, Math.floor((1 + Math.sqrt(1 + (8 * (xp || 0)) / 50)) / 2)); }
  function xpForLevel(level) { return 25 * level * (level - 1); }
  function foodFor() { return 'fish'; }

  return {
    SPECIES, CAT, PRESETS, ACCESSORIES, TRICKS, LEARNED, FOODS, COMPANIONS, PERSONALITY_DEFAULT,
    preset, plan, dims, trick, levelForXp, xpForLevel, foodFor, breedSize,
  };
});
