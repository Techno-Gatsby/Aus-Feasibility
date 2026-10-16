/*
 * Photo cat creator: turn photos (and short videos) of your own cat into a photo-real
 * desktop cat. On-device AI cutout, one photo per pose, video clips become animations,
 * and a living-photo rig makes even a single still breathe, look around and walk.
 */
(function () {
  'use strict';
  const P = window.__panel; const Photo = window.PawsPhoto; const PV = window.PawsPreview; const SPC = window.PawsSpecies;
  const { h, call, toast } = P;

  const POSES = [
    { id: 'stand', label: 'Standing', hint: 'Required. Side view works best for walking.', required: true },
    { id: 'sit', label: 'Sitting', hint: 'Used for sitting, grooming, tricks' },
    { id: 'lie', label: 'Lying / loaf', hint: 'Resting and loafing' },
    { id: 'sleep', label: 'Sleeping', hint: 'Curled up asleep' },
    { id: 'walk', label: 'Walking', hint: 'Mid-stride, side view' },
    { id: 'happy', label: 'Playful', hint: 'Happy, playing, excited' },
    { id: 'beg', label: 'Begging / up', hint: 'Standing up, reaching' },
  ];
  const CLIPS = [['walk', 'Walking'], ['idle', 'Idle'], ['happy', 'Playing'], ['sleep', 'Sleeping'], ['sit', 'Sitting'], ['eat', 'Eating']];
  const MOODS = [
    { id: 'lounger', label: 'Lazy lounger', personality: { energy: 0.2, playful: 0.4, curious: 0.4, affection: 0.8 } },
    { id: 'playful', label: 'Playful', personality: { energy: 0.85, playful: 0.95, curious: 0.7, affection: 0.6 } },
    { id: 'explorer', label: 'Curious explorer', personality: { energy: 0.7, playful: 0.6, curious: 1, affection: 0.5 } },
    { id: 'cuddler', label: 'Cuddle bug', personality: { energy: 0.45, playful: 0.5, curious: 0.5, affection: 1 } },
  ];

  // Creator state survives re-renders of the page.
  const st = { slots: {}, clips: {}, model: 'fast', name: '', gender: '', age: 2, mood: 'cuddler', outline: false, editing: null, busy: false };

  function resetIfNeeded(nav) {
    const editing = nav && nav.petId && P.S.data.pets.find((p) => p.id === nav.petId && p.kind === 'photo') ? nav.petId : null;
    if (editing !== st.editing) { st.slots = {}; st.clips = {}; st.editing = editing; }
  }

  // --------------------------------------------------------- cutout core

  async function ensureModel(status) {
    const s = await call('cutout:status');
    if (!s || !s.available) return false;
    const m = s.models.find((x) => x.id === st.model);
    if (m && !m.installed) {
      status && (status.textContent = `Downloading the ${m.label} model (${(m.bytes / 1e6).toFixed(0)} MB, one time)…`);
      const r = await call('cutout:download', st.model);
      if (!r) return false;
    }
    return true;
  }

  async function cutoutCanvas(src, opts) {
    const o = opts || {};
    const canvas = Photo.toCanvas(src, o.maxSide || 900);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let mask = o.mask || null;
    let method = 'ai';
    if (!mask) {
      const ok = o.aiOk !== undefined ? o.aiOk : await ensureModel(o.status);
      if (ok) {
        const buf = await call('cutout:segment', id.data.buffer.slice(0), canvas.width, canvas.height, o.model || st.model);
        if (buf) mask = new Uint8Array(buf);
      }
    }
    let out;
    if (mask) {
      out = Photo.applyMask(canvas, mask, { seed: o.seed || null });
    } else {
      method = 'classic';
      out = Photo.removeBackground(canvas, { tolerance: o.tolerance != null ? o.tolerance : 45 }).canvas;
    }
    return { original: canvas, mask, cut: out, method };
  }

  async function finishSlot(slot) {
    let c = Photo.trim(slot.cut, 3);
    slot.trim = c._trim || null;
    slot.rig = Photo.autoRig(c);
    if (st.outline) c = Photo.sticker(c, { outline: Math.max(3, Math.round(c.height / 110)) });
    slot.dataUrl = await Photo.toDataUrl(c);
    slot.aspect = c.width / c.height;
    if (st.outline) slot.rig = Photo.autoRig(c);
  }

  async function processSlot(poseId, file, status) {
    const slot = st.slots[poseId] = { file, busy: true };
    rerender();
    try {
      const img = await Photo.loadImageFromUrl(file.url);
      const r = await cutoutCanvas(img, { status });
      Object.assign(slot, r);
      await finishSlot(slot);
      if (r.method === 'classic') toast('On-device AI is not available here, so the classic background remover was used. Plain backgrounds work best.');
    } catch (e) { console.error('cutout failed', e && (e.name + ': ' + e.message)); toast(e.message, true); delete st.slots[poseId]; }
    slot.busy = false;
    rerender();
  }

  async function reseed(poseId, x, y) {
    const slot = st.slots[poseId];
    if (!slot || !slot.mask) return;
    slot.cut = Photo.applyMask(slot.original, slot.mask, { seed: { x, y } });
    await finishSlot(slot);
    rerender();
  }

  // ------------------------------------------------------------- video

  async function processVideo(file, clip, opts, status) {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous'; v.src = file.url;
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('Could not read that video')); });
    const fps = opts.fps || 12;
    const dur = Math.min(opts.seconds || 3, Math.max(0.5, v.duration - (opts.start || 0)));
    const n = Math.max(4, Math.min(48, Math.round(dur * fps)));
    const aiOk = await ensureModel(status);
    const frames = [];
    for (let i = 0; i < n; i++) {
      v.currentTime = (opts.start || 0) + (i / n) * dur;
      await new Promise((res) => { v.onseeked = res; });
      const cv = document.createElement('canvas');
      const k = Math.min(1, 420 / Math.max(v.videoWidth, v.videoHeight));
      cv.width = Math.round(v.videoWidth * k); cv.height = Math.round(v.videoHeight * k);
      cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height);
      const r = await cutoutCanvas(cv, { aiOk, model: 'fast', maxSide: 420 });
      frames.push(r.cut);
      if (status) status.textContent = `Cutting out frame ${i + 1} of ${n}…`;
    }
    // Crop every frame to the union box so the cat does not jump around.
    let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1;
    for (const f of frames) {
      const w = f.width; const hgt = f.height;
      const d = f.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, hgt).data;
      for (let y = 0; y < hgt; y += 2) for (let x = 0; x < w; x += 2) if (d[(y * w + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) throw new Error('No cat found in that clip');
    const pad = 4; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    const cw = Math.min(frames[0].width, x1 + pad) - x0; const ch = Math.min(frames[0].height, y1 + pad) - y0;
    const urls = [];
    for (const f of frames) {
      const c = document.createElement('canvas'); c.width = cw; c.height = ch;
      c.getContext('2d').drawImage(f, x0, y0, cw, ch, 0, 0, cw, ch);
      urls.push(c.toDataURL('image/png'));
    }
    st.clips[clip] = { frames: urls, fps, aspect: cw / ch };
  }

  // ------------------------------------------------------------ render

  let root = null;
  function rerender() { if (root && document.body.contains(root)) P.render(); }

  function createTab(container) {
    resetIfNeeded(P.nav);
    root = container;
    const editingPet = st.editing ? P.S.data.pets.find((p) => p.id === st.editing) : null;
    const status = h('span', { class: 'small muted' });
    container.appendChild(h('div', { class: 'page-head' }, h('div', { class: 'grow' }, h('h1', {}, editingPet ? `Add photos to ${editingPet.name}` : 'Make a cat from your photos'),
      h('p', {}, 'Your photos stay on this computer. On-device AI cuts your cat out of the background; more poses and a short video make it come alive.'))));

    const ai = P.S.cutout || { available: false, models: [] };
    container.appendChild(h('div', { class: 'card row wrap' },
      h('span', {}, ai.available ? '🧠 On-device AI cutout' : '✂️ Classic cutout (on-device AI unavailable on this computer)'),
      ai.available ? h('div', { class: 'seg' }, ai.models.map((m) => h('button', { class: st.model === m.id ? 'on' : '', onclick: () => { st.model = m.id; rerender(); } }, `${m.label}${m.installed ? '' : ` · ${(m.bytes / 1e6).toFixed(0)} MB`}`))) : null,
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: st.outline, onchange: async (e) => { st.outline = e.target.checked; for (const s of Object.values(st.slots)) if (s.cut) await finishSlot(s); rerender(); } }), 'Sticker outline'),
      h('span', { class: 'spacer' }), status));

    // Pose slots
    container.appendChild(h('div', { class: 'card', style: { marginTop: '16px' } }, h('h3', {}, '1 · Photos'),
      h('p', { class: 'small muted', style: { marginBottom: '12px' } }, 'One photo is enough. Each extra pose makes your cat more expressive. Tap the cutout to choose which animal to keep if the AI picked something else.'),
      h('div', { class: 'slots' }, POSES.map((pose) => slotEl(pose, status)))));

    // Video clips
    const clipSel = h('select', {}, CLIPS.map(([v, l]) => h('option', { value: v }, l)));
    const startIn = h('input', { type: 'number', min: 0, step: 0.5, value: 0, style: { width: '80px' } });
    const secIn = h('input', { type: 'number', min: 1, max: 4, step: 0.5, value: 2.5, style: { width: '80px' } });
    const vstatus = h('span', { class: 'small muted' });
    container.appendChild(h('div', { class: 'card col', style: { marginTop: '16px' } }, h('h3', {}, '2 · Video clips (optional)'),
      h('p', { class: 'small muted' }, 'A few seconds of your cat walking, playing or napping becomes a real animation (up to 48 frames, 12 fps). Steady camera, cat in full view.'),
      h('div', { class: 'row wrap' }, h('span', { class: 'small' }, 'Clip'), clipSel, h('span', { class: 'small' }, 'start at (s)'), startIn, h('span', { class: 'small' }, 'length (s)'), secIn,
        h('button', { class: 'btn', disabled: st.busy, onclick: async () => {
          const files = await call('asset:pick', 'video');
          if (!files || !files.length) return;
          st.busy = true; rerender();
          try { await processVideo(files[0], clipSel.value, { start: Number(startIn.value), seconds: Number(secIn.value), fps: 12 }, vstatus); toast(`🎬 ${clipSel.value} animation ready`); } catch (e) { toast(e.message, true); }
          st.busy = false; rerender();
        } }, '🎬 Choose video'), vstatus),
      Object.keys(st.clips).length ? h('div', { class: 'row wrap' }, Object.entries(st.clips).map(([k, c]) => h('div', { class: 'slot filled', style: { width: '150px' } },
        h('div', { class: 'img checker' }, animImg(c)), h('div', { class: 'row' }, h('span', { class: 'name grow' }, k), h('span', { class: 'small muted' }, c.frames.length + ' frames'),
          h('button', { class: 'btn small ghost', onclick: () => { delete st.clips[k]; rerender(); } }, '✕'))))) : null));

    // Community sprite packs
    container.appendChild(h('div', { class: 'card row wrap', style: { marginTop: '16px' } },
      h('div', { class: 'grow' }, h('h3', {}, 'Have a Shimeji pack?'), h('p', { class: 'small muted' }, 'Pick a folder with shime1.png … shime46.png and OpenPaws maps the standard poses (walk, sit, fall, dragged, climb, ceiling…). Only use art you have the rights to.')),
      h('button', { class: 'btn', onclick: async () => {
        const r = await call('import:shimeji', null);
        if (!r) return;
        const frames = window.PawsSprites.shimejiFrames(r.files);
        if (!frames.idle) return toast('That pack has no shime1.png', true);
        const pet = await call('pet:create', { kind: 'sprite', name: r.name || 'Shimeji', asset: { frames, fps: 6, facing: 'left', aspect: 1, url: frames.idle[0] }, accessories: { hat: 'none', neck: 'none', face: 'none' } });
        if (pet) { toast(`${pet.name} imported`); P.selectedPet = pet.id; await P.refresh(); P.go('pets'); }
      } }, '📦 Import Shimeji folder')));

    // Preview + details
    const stand = st.slots.stand && st.slots.stand.dataUrl ? st.slots.stand : null;
    const cfg = stand || editingPet ? buildCfg(editingPet) : null;
    const nameIn = h('input', { type: 'text', value: st.name || (editingPet ? editingPet.name : ''), placeholder: 'Your cat\'s name', oninput: (e) => { st.name = e.target.value; } });
    container.appendChild(h('div', { class: 'grid two', style: { marginTop: '16px' } },
      h('div', { class: 'card col' }, h('h3', {}, '3 · Preview'),
        cfg ? previewStage(cfg) : h('div', { class: 'empty' }, 'Add a standing photo to see your cat come alive.'),
        cfg ? h('div', { class: 'row wrap' }, ['walk', 'sit', 'sleep', 'happy', 'held'].map((s) => h('button', { class: 'btn small', onclick: () => window.__creatorPreview && window.__creatorPreview.state(s === 'walk' ? 'walk' : s, s === 'walk' ? { tx: 9999 } : {}) }, s))) : null),
      h('div', { class: 'card col' }, h('h3', {}, editingPet ? '4 · Save' : '4 · About your cat'),
        editingPet ? null : [h('label', { class: 'field' }, 'Name', nameIn),
          h('div', { class: 'row' }, h('label', { class: 'field grow' }, 'Gender', h('select', { onchange: (e) => { st.gender = e.target.value; } }, [['', '—'], ['girl', 'Girl'], ['boy', 'Boy']].map(([v, l]) => h('option', { value: v, selected: st.gender === v }, l)))),
            h('label', { class: 'field grow' }, 'Age', h('input', { type: 'number', min: 0, max: 30, value: st.age, onchange: (e) => { st.age = Number(e.target.value); } }))),
          h('div', { class: 'small muted' }, 'Personality'),
          h('div', { class: 'acc-row' }, MOODS.map((m) => h('button', { class: 'chip-btn' + (st.mood === m.id ? ' on' : ''), onclick: () => { st.mood = m.id; rerender(); } }, m.label)))],
        h('div', { class: 'row wrap', style: { marginTop: '8px' } },
          h('button', { class: 'btn primary', disabled: !(stand || (editingPet && (Object.keys(st.slots).length || Object.keys(st.clips).length))) || st.busy, onclick: () => save(editingPet) }, editingPet ? 'Save to ' + editingPet.name : '🐾 Bring my cat to life'),
          stand && !editingPet ? h('button', { class: 'btn', onclick: () => lookalike(stand) }, '🎨 Make a cartoon look-alike instead') : null))));
  }

  function slotEl(pose, status) {
    const slot = st.slots[pose.id];
    const pick = async () => {
      const files = await call('asset:pick', 'image');
      if (files && files.length) processSlot(pose.id, files[0], status);
    };
    let img = null;
    if (slot && slot.dataUrl) {
      img = h('img', { src: slot.dataUrl, title: 'Tap the cat to keep it if something else was picked', style: { cursor: slot.mask ? 'crosshair' : 'default' }, onclick: (e) => {
        if (!slot.mask) return;
        const r = e.target.getBoundingClientRect();
        // Map the tap on the trimmed cutout back to the original photo.
        const t = slot.trim || { x0: 0, y0: 0, w: 1, h: 1, srcW: 1, srcH: 1 };
        const u = (t.x0 + ((e.clientX - r.left) / r.width) * t.w) / t.srcW;
        const v = (t.y0 + ((e.clientY - r.top) / r.height) * t.h) / t.srcH;
        reseed(pose.id, u, v);
      } });
    }
    return h('div', { class: 'slot' + (slot ? ' filled' : '') },
      h('div', { class: 'img checker' }, img || h('span', { class: 'faint', style: { fontSize: '32px' } }, '🐈'), slot && slot.busy ? h('div', { class: 'busy' }, 'Cutting out…') : null),
      h('div', { class: 'row' }, h('span', { class: 'name grow' }, pose.label, pose.required ? ' *' : ''), slot && slot.rig ? h('span', { class: 'pill', title: 'Which way the cat faces' }, slot.rig.facing < 0 ? '← faces left' : slot.rig.facing > 0 ? 'faces right →' : 'front') : null),
      h('div', { class: 'small faint' }, pose.hint),
      h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: pick }, slot ? 'Replace' : 'Choose photo'),
        slot && slot.rig ? h('button', { class: 'btn small ghost', title: 'Flip facing', onclick: () => { slot.rig.facing = slot.rig.facing < 0 ? 1 : -1; rerender(); } }, '⇄') : null,
        slot ? h('button', { class: 'btn small ghost', onclick: () => { delete st.slots[pose.id]; rerender(); } }, '✕') : null));
  }

  function animImg(clip) {
    const img = h('img', { src: clip.frames[0] });
    let i = 0;
    const t = setInterval(() => { if (!document.body.contains(img)) return clearInterval(t); i = (i + 1) % clip.frames.length; img.src = clip.frames[i]; }, 1000 / clip.fps);
    return img;
  }

  function buildCfg(editingPet) {
    const base = editingPet ? editingPet.asset || {} : {};
    const poses = Object.assign({}, base.poses || {}); const rigs = Object.assign({}, base.rigs || {});
    for (const [k, s] of Object.entries(st.slots)) if (s.dataUrl) { poses[k] = s.dataUrl; rigs[k] = s.rig; }
    const frames = Object.assign({}, base.frames || {});
    for (const [k, c] of Object.entries(st.clips)) frames[k] = c.frames;
    const stand = st.slots.stand;
    const fps = Object.values(st.clips)[0] ? Object.values(st.clips)[0].fps : base.fps || 12;
    return {
      id: 'creator-preview', kind: 'photo', name: st.name || 'Preview',
      asset: { url: poses.stand || base.url, poses, rigs, rig: rigs.stand || base.rig, aspect: stand ? stand.aspect : base.aspect || 1, facing: rigs.stand && rigs.stand.facing < 0 ? 'left' : 'right', frames, fps, living: true },
    };
  }

  function previewStage(cfg) {
    const c = h('canvas');
    const wrap = h('div', { class: 'stage', style: { height: '280px' } }, c, h('div', { class: 'floor' }));
    requestAnimationFrame(() => { window.__creatorPreview = PV.mount(c, cfg, { interactive: true, roam: true }); });
    return wrap;
  }

  async function save(editingPet) {
    st.busy = true; rerender();
    const folder = editingPet ? editingPet.id : 'photo_' + Math.random().toString(36).slice(2, 10);
    try {
      const poses = {}; const rigs = {}; const frames = {};
      for (const [k, s] of Object.entries(st.slots)) {
        if (!s.dataUrl) continue;
        poses[k] = await call('asset:save', folder, `${k}.png`, s.dataUrl);
        rigs[k] = s.rig;
      }
      for (const [k, c] of Object.entries(st.clips)) {
        frames[k] = [];
        for (let i = 0; i < c.frames.length; i++) frames[k].push(await call('asset:save', folder, `${k}-${String(i).padStart(2, '0')}.png`, c.frames[i]));
      }
      const fps = Object.values(st.clips)[0] ? Object.values(st.clips)[0].fps : 12;
      if (editingPet) {
        const a = editingPet.asset || {};
        const asset = { poses: Object.assign({}, a.poses, poses), rigs: Object.assign({}, a.rigs, rigs), frames: Object.assign({}, a.frames, frames), fps };
        if (poses.stand) { asset.url = poses.stand; asset.rig = rigs.stand; asset.aspect = st.slots.stand.aspect; asset.facing = rigs.stand && rigs.stand.facing < 0 ? 'left' : 'right'; }
        await call('pet:update', editingPet.id, { asset });
        toast(`📸 ${editingPet.name} updated`);
      } else {
        const mood = MOODS.find((m) => m.id === st.mood) || MOODS[3];
        const stand = st.slots.stand;
        const pet = await call('pet:create', {
          kind: 'photo', name: st.name || 'My cat', gender: st.gender, age: st.age, personality: mood.personality, nickname: mood.label,
          story: 'A one-of-a-kind cat, straight from a real photo.',
          accessories: { hat: 'none', neck: 'none', face: 'none' },
          asset: { url: poses.stand, poses, rigs, rig: rigs.stand, aspect: stand.aspect, facing: rigs.stand && rigs.stand.facing < 0 ? 'left' : 'right', frames, fps, living: true },
        });
        if (pet) { toast(`🎉 ${pet.name} just walked onto your desktop!`); P.selectedPet = pet.id; st.slots = {}; st.clips = {}; st.name = ''; }
      }
      await P.refresh();
      st.busy = false;
      P.go('pets');
    } catch (e) { toast(e.message, true); st.busy = false; rerender(); }
  }

  async function lookalike(stand) {
    const img = await Photo.loadImageFromUrl(stand.dataUrl);
    const c = Photo.toCanvas(img, 400);
    const pal = Photo.palette(c, 5);
    const look = Photo.lookalike(pal, 'cat');
    if (!look) return toast('Could not read the colours from that photo', true);
    const closest = SPC.PRESETS.map((pr) => ({ pr, d: colorDist(pr.colors.base, look.colors.base) })).sort((a, b) => a.d - b.d)[0].pr;
    const pet = await call('pet:create', {
      name: st.name || 'Look-alike', preset: closest.id, pattern: look.pattern, colors: Object.assign({}, closest.colors, look.colors),
      personality: (MOODS.find((m) => m.id === st.mood) || MOODS[3]).personality, gender: st.gender, age: st.age,
    });
    if (pet) { toast(`🎨 ${pet.name} is a cartoon twin of your cat`); P.selectedPet = pet.id; await P.refresh(); P.go('pets'); }
  }

  function colorDist(a, b) {
    const x = window.PawsDraw.hexToRgb(a); const y = window.PawsDraw.hexToRgb(b);
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
  }

  P.TABS.create = createTab;
  // Used by the app's smoke test to drive the creator without a file dialog.
  window.__creator = { st, processSlot, save };
})();
