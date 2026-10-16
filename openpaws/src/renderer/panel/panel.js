/* OpenPaws Control Center. */
(function () {
  'use strict';
  const paws = window.paws; const SPC = window.PawsSpecies; const PV = window.PawsPreview;
  const main = document.getElementById('main');
  if (paws.platform === 'darwin') document.body.classList.add('mac');

  let S = null; // state snapshot
  let tab = 'home';
  let nav = {};
  let selectedPet = null;
  let dirty = false;

  // ------------------------------------------------------------ helpers

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
    }
    return el;
  }
  const esc = (s) => String(s == null ? '' : s);
  function toast(msg, err) {
    const t = h('div', { class: 'toast' + (err ? ' err' : '') }, msg);
    document.getElementById('toasts').appendChild(t);
    setTimeout(() => t.remove(), err ? 6000 : 3200);
  }
  async function call(ch, ...args) {
    let r;
    try { r = await paws.invoke(ch, ...args); } catch (e) { toast(e.message, true); return null; }
    if (r && typeof r === 'object' && !Array.isArray(r) && r.error) { toast(r.error, true); return null; }
    return r;
  }
  async function refresh() { const s = await call('state:get'); if (s) S = s; renderSide(); return S; }
  const D = () => S.data;
  const pets = () => D().pets || [];
  const petById = (id) => pets().find((p) => p.id === id);
  function fmtWhen(ms) {
    const d = new Date(ms); const now = new Date();
    const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return 'Today ' + t;
    const tm = new Date(now); tm.setDate(now.getDate() + 1);
    if (d.toDateString() === tm.toDateString()) return 'Tomorrow ' + t;
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ' ' + t;
  }
  function stage(cfg, opts) {
    const c = h('canvas');
    const wrap = h('div', { class: 'stage' }, c, h('div', { class: 'floor' }));
    requestAnimationFrame(() => PV.mount(c, cfg, Object.assign({ interactive: true, roam: true }, opts || {})));
    return wrap;
  }
  function miniCanvas(cfg, state, opts) {
    const c = h('canvas');
    requestAnimationFrame(() => PV.mount(c, cfg, Object.assign({ state: state || 'sit', lockState: true }, opts || {})));
    return c;
  }
  function needBar(label, v, cls) {
    return [h('span', { class: 'lbl' }, label), h('div', { class: 'bar ' + (cls || '') }, h('i', { style: { width: Math.round(v) + '%' } })), h('span', { class: 'val' }, Math.round(v))];
  }
  function sw(label, checked, onchange, hint) {
    return h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!checked, onchange: (e) => onchange(e.target.checked) }), h('span', {}, label, hint ? h('span', { class: 'small faint' }, ' ' + hint) : null));
  }
  async function setSection(section, patch) { const s = await call('state:update', section, patch); if (s) S = s; }
  function seg(options, value, onpick) {
    return h('div', { class: 'seg' }, options.map(([v, l]) => h('button', { class: v === value ? 'on' : '', onclick: () => onpick(v) }, l)));
  }

  // ------------------------------------------------------------ chrome

  function renderSide() {
    if (!S) return;
    document.getElementById('treats').textContent = `🍪 ${D().treats || 0} treats`;
    for (const b of document.querySelectorAll('#nav button')) b.classList.toggle('on', b.dataset.tab === tab);
    const box = document.getElementById('sideCats');
    const ids = pets().map((p) => p.id).join();
    if (box.dataset.ids !== ids) {
      box.dataset.ids = ids; box.innerHTML = '';
      for (const p of pets()) {
        const b = h('button', { class: 'mini', title: p.name, onclick: () => { selectedPet = p.id; go('pets'); } }, miniCanvas(p, 'loaf', { scale: 0.45, floorPad: 3 }));
        box.appendChild(b);
      }
    }
    document.getElementById('hideBtn').textContent = D().app.petsHidden ? '👀 Show cats' : '🙈 Hide cats';
  }

  document.getElementById('nav').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) go(b.dataset.tab); });
  document.getElementById('hideBtn').onclick = async () => { await call('app:hidePets', !D().app.petsHidden); await refresh(); };
  document.getElementById('chatBtn').onclick = () => call('app:openChat', selectedPet || (pets()[0] || {}).id);

  function go(t, extra) {
    tab = t || 'home'; nav = extra || {};
    if (nav.petId) selectedPet = nav.petId;
    render();
  }

  function render() {
    if (!S) return;
    renderSide();
    main.innerHTML = '';
    const fn = TABS[tab] || TABS.home;
    try { fn(main); } catch (e) { main.appendChild(h('div', { class: 'card' }, 'Something went wrong drawing this page: ' + e.message)); console.error(e); }
    main.scrollTop = 0;
    dirty = false;
  }

  // ------------------------------------------------------------- HOME

  function homeTab(root) {
    const p = petById(selectedPet) || pets()[0];
    const user = D().user;
    const hour = new Date().getHours();
    const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    root.appendChild(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, `${hello}${user.name ? ', ' + user.name : ''} 👋`), h('p', {}, p ? `${p.name} is ${moodOf(p)} today.` : 'Adopt a cat to get started.'))));
    if (nav.tab === 'welcome' || D().app.firstRun) root.appendChild(welcomeCard());
    if (!p) { root.appendChild(h('div', { class: 'card empty' }, h('p', {}, 'No cats yet.'), h('button', { class: 'btn primary', onclick: () => go('adopt') }, 'Adopt a cat'))); return; }
    const st = p.stats;
    const xpNext = SPC.xpForLevel((p.level || 1) + 1); const xpCur = SPC.xpForLevel(p.level || 1);
    root.appendChild(h('div', { class: 'hero' },
      h('div', { class: 'col' }, stage(p, { state: 'sit', scale: 1.8 }), h('div', { class: 'quick' },
        h('button', { class: 'btn', onclick: () => act(p.id, 'feed') }, '🐟 Feed'),
        h('button', { class: 'btn', onclick: () => act(p.id, 'treat') }, '🍪 Treat'),
        h('button', { class: 'btn', onclick: () => act(p.id, 'wand') }, '🪶 Play'),
        h('button', { class: 'btn', onclick: () => act(p.id, 'brush') }, '🪮 Brush'),
        h('button', { class: 'btn primary', onclick: () => call('app:openChat', p.id) }, '💬 Chat'),
      )),
      h('div', { class: 'col' },
        h('div', { class: 'card' },
          h('div', { class: 'row' }, h('h2', {}, p.name), h('span', { class: 'pill accent' }, 'Lv ' + (p.level || 1)), p.nickname ? h('span', { class: 'pill' }, p.nickname) : null, h('span', { class: 'spacer' }), h('span', { class: 'small muted' }, `${(p.xp || 0) - xpCur} / ${xpNext - xpCur} XP`)),
          h('div', { class: 'bar amber', style: { margin: '8px 0 14px' } }, h('i', { style: { width: Math.min(100, (((p.xp || 0) - xpCur) / (xpNext - xpCur)) * 100) + '%' } })),
          h('div', { class: 'needs' }, needBar('Fullness', st.fullness, 'amber'), needBar('Energy', st.energy, 'blue'), needBar('Happiness', st.happiness), needBar('Grooming', st.hygiene, 'green'), needBar('Bond', st.bond)),
        ),
        h('div', { class: 'grid three' }, weatherMini(), nextUpMini(), focusMini()),
      ),
    ));
    const sugg = S.suggestions || [];
    if (sugg.length) root.appendChild(h('div', { class: 'card', style: { marginTop: '16px' } }, h('div', { class: 'row' }, h('h3', {}, `📬 ${sugg.length} suggestion${sugg.length > 1 ? 's' : ''} from your inbox`), h('span', { class: 'spacer' }), h('button', { class: 'btn small', onclick: () => go('integrations') }, 'Review'))));
  }

  function moodOf(p) {
    const s = p.stats || {};
    if (s.fullness < 25) return 'hungry 🍖'; if (s.energy < 20) return 'sleepy 😴'; if (s.hygiene < 25) return 'a little scruffy';
    if (s.happiness > 80) return 'delighted 😻'; if (s.happiness > 55) return 'content 😺'; return 'a bit bored';
  }

  function welcomeCard() {
    return h('div', { class: 'card', style: { marginBottom: '18px', background: 'linear-gradient(135deg, var(--accent-soft), var(--surface))' } },
      h('h2', {}, 'Welcome to OpenPaws 🐾'),
      h('p', { class: 'muted', style: { margin: '6px 0 12px' } }, 'Your cat lives on your dock or taskbar. Click it for the action orb, drag and throw it, rub the cursor over it to pet it, double-click to chat. Everything works offline. Add an AI in Settings to chat about anything.'),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn primary', onclick: () => go('create') }, '📸 Make a cat from your photo'),
        h('button', { class: 'btn', onclick: () => go('adopt') }, '💝 Adopt more cats'),
        h('button', { class: 'btn', onclick: () => go('settings', { section: 'ai' }) }, '🧠 Connect an AI'),
        h('button', { class: 'btn ghost', onclick: async () => { await setSection('app', { firstRun: false }); nav = {}; render(); } }, 'Got it'),
      ));
  }

  function weatherMini() {
    const w = S.weather;
    return h('div', { class: 'card' }, h('div', { class: 'small muted' }, 'Weather'),
      w ? [h('div', { class: 'stat' }, h('b', {}, `${w.icon} ${w.temp}${w.unit}`), h('span', {}, `${w.label} · ${w.place}`))]
        : [h('p', { class: 'small muted', style: { margin: '6px 0' } }, 'Set your city so your cat can dress for the weather.'), h('button', { class: 'btn small', onclick: () => go('integrations') }, 'Set location')]);
  }
  function nextUpMini() {
    const r = (D().reminders || []).filter((x) => !x.done && x.due).sort((a, b) => a.due - b.due)[0];
    const e = (D().calendar.events || []).find((x) => x.end > Date.now());
    return h('div', { class: 'card' }, h('div', { class: 'small muted' }, 'Next up'),
      r ? h('div', { class: 'stat' }, h('b', { style: { fontSize: '15px' } }, '⏰ ' + r.text), h('span', {}, fmtWhen(r.due))) : null,
      e ? h('div', { class: 'stat', style: { marginTop: '6px' } }, h('b', { style: { fontSize: '15px' } }, '📅 ' + e.title), h('span', {}, e.allDay ? 'All day' : fmtWhen(e.start))) : null,
      !r && !e ? h('p', { class: 'small muted', style: { marginTop: '6px' } }, 'Nothing scheduled. Purrfect.') : null);
  }
  function focusMini() {
    const f = D().focus.active;
    return h('div', { class: 'card' }, h('div', { class: 'small muted' }, 'Focus today'),
      h('div', { class: 'stat' }, h('b', {}, (S.focusStats.today || 0) + ' min'), h('span', {}, f ? `In a ${f.phase} session` : `${S.focusStats.week || 0} min this week`)),
      h('button', { class: 'btn small', style: { marginTop: '8px' }, onclick: async () => { if (f) await call('focus:stop'); else await call('focus:start', D().focus.workMin); await refresh(); render(); } }, f ? 'Stop' : '▶ Start 25 min'));
  }

  async function act(id, action, data) {
    const r = await call('pet:action', id, action, data);
    if (r && r.ok === false && r.reason) toast(r.reason, true);
  }

  // ------------------------------------------------------------- PETS

  function petsTab(root) {
    root.appendChild(h('div', { class: 'page-head' }, h('div', { class: 'grow' }, h('h1', {}, 'My cats'), h('p', {}, 'Customise looks, personality, tricks and voice.')), h('button', { class: 'btn primary', onclick: () => go('adopt') }, '+ Adopt')));
    const list = pets();
    if (!list.length) { root.appendChild(h('div', { class: 'card empty' }, 'No cats yet.')); return; }
    if (!petById(selectedPet)) selectedPet = list[0].id;
    root.appendChild(h('div', { class: 'petcards' }, list.map((p) => h('div', { class: 'card petcard' + (p.id === selectedPet ? ' on' : ''), onclick: () => { selectedPet = p.id; render(); } },
      miniCanvas(p, 'sit', { scale: 0.85 }),
      h('div', { class: 'meta' }, h('b', {}, p.name), h('span', { class: 'pill accent' }, 'Lv ' + (p.level || 1))),
      h('div', { class: 'small muted' }, p.kind === 'procedural' ? SPC.preset(p.preset).label : 'Photo cat', p.active === false ? ' · resting' : '')))));
    root.appendChild(petEditor(petById(selectedPet)));
    if (nav.section === 'tricks') setTimeout(() => { const el = document.getElementById('tricks'); if (el) el.scrollIntoView({ behavior: 'smooth' }); }, 200);
  }

  function petEditor(p) {
    let preview = null;
    const c = h('canvas');
    const wrap = h('div', { class: 'stage' }, c, h('div', { class: 'floor' }));
    requestAnimationFrame(() => { preview = PV.mount(c, p, { interactive: true, roam: true, scale: 1.7 }); });
    const save = async (patch, quiet) => {
      Object.assign(p, patch);
      if (preview) preview.update(patch);
      const r = await call('pet:update', p.id, patch);
      if (r && !quiet) toast('Saved');
    };
    const isProc = !p.kind || p.kind === 'procedural';
    const acc = p.accessories || {};
    const COLORS = ['#e8516b', '#5b7fd6', '#3fae7a', '#e7a33c', '#8e5bd6', '#2b2b30', '#f2f2ee', '#ff8fb7'];
    const accRow = (slot, colorKey) => h('div', { class: 'col', style: { gap: '6px' } },
      h('div', { class: 'small muted' }, { hat: 'Head', neck: 'Neck', face: 'Face' }[slot]),
      h('div', { class: 'acc-row' }, SPC.ACCESSORIES[slot].map((a) => h('button', { class: 'chip-btn' + ((acc[slot] || 'none') === a.id ? ' on' : ''), onclick: () => { acc[slot] = a.id; save({ accessories: Object.assign({}, acc) }, true); render(); } }, a.label))),
      colorKey ? h('div', { class: 'acc-row' }, COLORS.map((col) => h('button', { class: 'colorsw' + (acc[colorKey] === col ? ' on' : ''), style: { background: col }, title: col, onclick: () => { acc[colorKey] = col; save({ accessories: Object.assign({}, acc) }, true); render(); } }))) : null);
    const per = Object.assign({}, SPC.PERSONALITY_DEFAULT, p.personality || {});
    const slider = (key, label) => [h('span', {}, label), h('input', { type: 'range', min: 0, max: 100, value: Math.round(per[key] * 100), onchange: (e) => { per[key] = e.target.value / 100; save({ personality: Object.assign({}, per) }, true); } })];
    const known = new Set(SPC.TRICKS.filter((t) => ((p.skills || {})[t.id] || {}).prof >= SPC.LEARNED).map((t) => t.id));

    return h('div', { class: 'editor' },
      h('div', { class: 'col' }, wrap,
        h('div', { class: 'card col' },
          h('label', { class: 'field' }, 'Name', h('input', { type: 'text', value: p.name, onchange: (e) => save({ name: e.target.value }) })),
          h('label', { class: 'field' }, 'Nickname', h('input', { type: 'text', value: p.nickname || '', placeholder: 'e.g. Sunbeam Collector', onchange: (e) => save({ nickname: e.target.value }) })),
          h('label', { class: 'field' }, 'Story', h('textarea', { rows: 3, onchange: (e) => save({ story: e.target.value }) }, p.story || '')),
          h('div', { class: 'row' },
            h('label', { class: 'field grow' }, 'Gender', h('select', { onchange: (e) => save({ gender: e.target.value }) }, [['', '—'], ['girl', 'Girl'], ['boy', 'Boy']].map(([v, l]) => h('option', { value: v, selected: (p.gender || '') === v }, l)))),
            h('label', { class: 'field grow' }, 'Age', h('input', { type: 'number', min: 0, max: 30, value: p.age || 1, onchange: (e) => save({ age: Number(e.target.value) }) }))),
          h('div', { class: 'row wrap' },
            sw('On screen', p.active !== false, (v) => save({ active: v })),
            h('span', { class: 'spacer' }),
            h('button', { class: 'btn small', onclick: () => certificate(p) }, '📜 Certificate'),
            h('button', { class: 'btn small danger', onclick: async () => { if (confirm(`Say goodbye to ${p.name}? This removes the cat and its chat history.`)) { await call('pet:delete', p.id); selectedPet = null; await refresh(); render(); } } }, 'Remove')),
        )),
      h('div', { class: 'col' },
        isProc ? h('div', { class: 'card' }, h('h3', {}, 'Coat'), coatPicker(p, (preset) => { save({ preset, colors: undefined, pattern: undefined }, true); render(); })) : photoInfo(p),
        h('div', { class: 'card col' }, h('h3', {}, 'Accessories'), accRow('hat', 'hatColor'), accRow('neck', 'neckColor'), accRow('face')),
        h('div', { class: 'card' }, h('h3', {}, 'Personality & behaviour'),
          h('div', { class: 'sliders' }, slider('energy', 'Energy'), slider('playful', 'Playfulness'), slider('curious', 'Curiosity'), slider('affection', 'Affection'),
            h('span', {}, 'Size'), h('input', { type: 'range', min: 60, max: 180, value: Math.round((p.size || 1) * 100), onchange: (e) => save({ size: e.target.value / 100 }, true) }),
            h('span', {}, 'Mode'), seg([['roam', 'Roam'], ['follow', 'Follow cursor'], ['stay', 'Stay put']], p.mode || 'roam', (m) => { save({ mode: m }, true); render(); }),
            h('span', {}, 'Voice pitch'), h('input', { type: 'range', min: 250, max: 900, value: (p.voice && p.voice.babblePitch) || 520, onchange: (e) => save({ voice: Object.assign({}, p.voice, { babblePitch: Number(e.target.value) }) }, true) }))),
        h('div', { class: 'card', id: 'tricks' }, h('div', { class: 'row' }, h('h3', { class: 'grow' }, 'Tricks'), h('span', { class: 'small muted' }, `Level ${p.level || 1} · energy ${Math.round(p.stats.energy)}`)),
          h('p', { class: 'small muted', style: { marginBottom: '10px' } }, 'Practise to raise proficiency. At 30% a trick is learned and your cat will show it off by itself.'),
          h('div', { class: 'tricks' }, SPC.TRICKS.map((t) => {
            const prof = ((p.skills || {})[t.id] || {}).prof || 0;
            const locked = (p.level || 1) < t.minLevel;
            return h('div', { class: 'trick' + (locked ? ' locked' : '') }, h('span', { class: 'em' }, t.emoji),
              h('div', { class: 'grow' }, h('div', { class: 'row' }, h('b', { class: 'grow' }, t.label), known.has(t.id) ? h('span', { class: 'pill green' }, 'learned') : locked ? h('span', { class: 'pill' }, 'Lv ' + t.minLevel) : null),
                h('div', { class: 'bar green', style: { marginTop: '5px' } }, h('i', { style: { width: prof + '%' } }))),
              locked ? null : h('button', { class: 'btn small', onclick: async () => {
                const r = await call('pet:train', p.id, t.id);
                if (!r) return;
                if (!r.ok) return toast(r.reason, true);
                toast(r.success ? `${t.emoji} Nailed it! ${r.prof}%` : `Almost! ${r.prof}%`);
                if (preview) preview.command(r.success ? { type: 'trick', trick: t.id } : { type: 'sit' });
                await refresh(); if (tab === 'pets') render();
              } }, known.has(t.id) ? 'Do it' : 'Train'));
          }))),
      ));
  }

  function coatPicker(p, onPick) {
    const box = h('div', { class: 'coats' });
    for (const pr of SPC.PRESETS) {
      const img = h('img', { alt: pr.label, src: PV.snapshot({ preset: pr.id, size: 0.95, stats: { happiness: 90 } }, 90, 70, 'sit', 0.3) });
      box.appendChild(h('button', { class: 'coat' + (p.preset === pr.id ? ' on' : ''), onclick: () => onPick(pr.id) }, img, pr.label));
    }
    return box;
  }

  function photoInfo(p) {
    const a = p.asset || {};
    const poses = Object.keys(a.poses || {});
    const clips = Object.keys(a.frames || {});
    return h('div', { class: 'card col' }, h('h3', {}, '📸 Photo cat'),
      h('p', { class: 'small muted' }, `Poses: ${poses.length ? poses.join(', ') : 'standing'}${clips.length ? ' · animated: ' + clips.join(', ') : ''}. Living-photo motion: ${a.living === false ? 'off' : 'on'}.`),
      h('div', { class: 'row wrap' },
        sw('Living-photo motion (breathing, head, tail, walk)', a.living !== false, (v) => call('pet:update', p.id, { asset: { living: v } })),
        h('button', { class: 'btn small', onclick: () => go('create', { petId: p.id }) }, 'Add poses or video')));
  }

  // Adoption certificate rendered on a canvas, downloadable as PNG.
  function certificate(p) {
    const W = 900; const H = 620;
    const c = document.createElement('canvas'); c.width = W * 2; c.height = H * 2;
    const x = c.getContext('2d'); x.scale(2, 2);
    const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#fff8f0'); g.addColorStop(1, '#fde8ec');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.strokeStyle = '#e8516b'; x.lineWidth = 6; x.strokeRect(22, 22, W - 44, H - 44);
    x.strokeStyle = '#f5b3c0'; x.lineWidth = 2; x.strokeRect(36, 36, W - 72, H - 72);
    x.fillStyle = '#b8304a'; x.textAlign = 'center';
    x.font = '700 40px Georgia, serif'; x.fillText('Certificate of Adoption', W / 2, 108);
    x.fillStyle = '#6b5a55'; x.font = '18px Georgia, serif'; x.fillText('This certifies that', W / 2, 150);
    x.fillStyle = '#2a2321'; x.font = '700 48px Georgia, serif'; x.fillText(p.name, W / 2, 208);
    x.fillStyle = '#6b5a55'; x.font = 'italic 18px Georgia, serif';
    x.fillText(`${p.nickname ? '"' + p.nickname + '" · ' : ''}${p.kind === 'procedural' ? SPC.preset(p.preset).label : 'one of a kind'}${p.gender ? ' · ' + p.gender : ''}${p.age ? ' · ' + p.age + (p.age === 1 ? ' year' : ' years') : ''}`, W / 2, 240);
    const img = new Image();
    img.onload = () => {
      x.drawImage(img, W / 2 - 150, 250, 300, 240);
      x.fillStyle = '#6b5a55'; x.font = '17px Georgia, serif';
      x.fillText(`found a forever home on ${D().user.name ? D().user.name + "'s" : 'your'} desktop on ${new Date(p.adoptedAt || Date.now()).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}`, W / 2, 530);
      x.font = '700 15px Georgia, serif'; x.fillStyle = '#b8304a'; x.fillText('🐾  OpenPaws  🐾', W / 2, 568);
      const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = `${p.name}-adoption-certificate.png`; a.click();
      toast('Certificate saved');
    };
    img.src = PV.snapshot(p, 300, 240, 'sit', 0.5);
  }

  // ------------------------------------------------------------- ADOPT

  function adoptTab(root) {
    root.appendChild(h('div', { class: 'page-head' }, h('div', { class: 'grow' }, h('h1', {}, 'Adopt a cat'), h('p', {}, 'Every cat has their own personality. Or make one from a photo of your own cat.')), h('button', { class: 'btn primary', onclick: () => go('create') }, '📸 From my photo')));
    const have = new Set(pets().map((p) => p.name));
    root.appendChild(h('div', { class: 'gallery' }, SPC.COMPANIONS.map((cpn, i) => {
      const pr = SPC.preset(cpn.preset);
      const pic = h('div', { class: 'pic' }, miniCanvas({ preset: cpn.preset, personality: cpn.personality, stats: { happiness: 90 } }, 'sit', { scale: 1.15, interactive: true }), h('span', { class: 'pill g ' + (cpn.gender === 'girl' ? 'accent' : 'blue') }, cpn.gender === 'girl' ? '♀ girl' : '♂ boy'));
      return h('div', { class: 'card adopt' }, pic, h('div', { class: 'body' },
        h('div', { class: 'row' }, h('h3', { class: 'grow' }, cpn.name), h('span', { class: 'small muted' }, `${cpn.age} yr`)),
        h('div', { class: 'nick' }, cpn.nickname + ' · ' + pr.label),
        h('p', { class: 'story' }, cpn.story),
        h('button', { class: 'btn ' + (have.has(cpn.name) ? '' : 'primary'), onclick: async () => {
          const p = await call('pet:create', { companion: i });
          if (p) { toast(`🎉 ${p.name} moved onto your desktop!`); selectedPet = p.id; await refresh(); render(); }
        } }, have.has(cpn.name) ? 'Adopt another ' + cpn.name : 'Adopt ' + cpn.name)));
    })));
    root.appendChild(h('div', { class: 'card', style: { marginTop: '18px' } }, h('h3', {}, 'Design your own'),
      h('p', { class: 'small muted', style: { marginBottom: '10px' } }, 'Pick a coat; fine-tune everything later under My cats.'),
      coatPicker({ preset: '' }, async (preset) => {
        const name = prompt('Name your cat', 'Kitty');
        if (!name) return;
        const p = await call('pet:create', { preset, name });
        if (p) { selectedPet = p.id; await refresh(); go('pets'); }
      })));
  }

  // --------------------------------------------------------- REMINDERS

  function remindersTab(root) {
    root.appendChild(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Reminders & to-dos'), h('p', {}, 'Type it like you\'d say it. Your cat will nudge you on time.'))));
    const parse = h('div', { class: 'parse' }, 'Try "stretch in 20 minutes", "call mum tomorrow at 6pm" or "standup every weekday at 9:30".');
    let t = null;
    const input = h('input', { type: 'text', placeholder: 'Remind me to…', oninput: () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        if (!input.value.trim()) { parse.textContent = ''; return; }
        const r = await call('reminder:parse', input.value);
        parse.innerHTML = '';
        if (r && r.due) parse.append('→ ', h('b', {}, r.text), ' · ', r.when);
        else parse.textContent = 'When? Add a time like "at 3pm" or "in 10 minutes".';
      }, 160);
    }, onkeydown: (e) => { if (e.key === 'Enter') add(); } });
    const add = async () => {
      if (!input.value.trim()) return;
      const r = await call('reminder:add', { input: input.value });
      if (!r) return;
      if (!r.ok) { toast('Add a time, like "at 3pm" or "in 10 minutes"', true); return; }
      toast(`⏰ ${r.reminder.text} · ${r.when}`);
      input.value = ''; parse.textContent = '';
      await refresh(); render();
    };
    root.appendChild(h('div', { class: 'card' }, h('div', { class: 'row' }, input, h('button', { class: 'btn primary', onclick: add }, 'Add')), parse));
    if (nav.focusInput) setTimeout(() => input.focus(), 50);

    const rems = (D().reminders || []).slice().sort((a, b) => (a.done - b.done) || (a.due - b.due));
    const upcoming = rems.filter((r) => !r.done); const done = rems.filter((r) => r.done).slice(-15).reverse();
    root.appendChild(h('div', { class: 'grid two', style: { marginTop: '16px' } },
      h('div', { class: 'card' }, h('h3', {}, `Upcoming (${upcoming.length})`),
        upcoming.length ? h('div', { class: 'list' }, upcoming.map((r) => h('div', { class: 'item' },
          h('span', {}, r.kind === 'timer' ? '⏱️' : r.rule ? '🔁' : '⏰'),
          h('div', { class: 'grow' }, h('div', {}, r.text), h('div', { class: 'rem-when' }, fmtWhen(r.due), r.rule ? ' · repeats' : '', r.source === 'mail' ? ' · from email' : '')),
          h('button', { class: 'btn small', title: 'Done', onclick: async () => { await call('reminder:complete', r.id); await refresh(); render(); } }, '✓'),
          h('button', { class: 'btn small ghost', title: 'Snooze 10 minutes', onclick: async () => { await call('reminder:snooze', r.id, 10); await refresh(); render(); } }, '💤'),
          h('button', { class: 'btn small ghost', title: 'Delete', onclick: async () => { await call('reminder:delete', r.id); await refresh(); render(); } }, '✕'))))
          : h('div', { class: 'empty' }, 'No reminders. Enjoy the quiet. 😺'),
        done.length ? h('details', { style: { marginTop: '10px' } }, h('summary', {}, `Done (${done.length})`), h('div', { class: 'list' }, done.map((r) => h('div', { class: 'item' }, h('span', {}, '✅'), h('div', { class: 'grow muted' }, r.text))))) : null),
      todoCard()));
  }

  function todoCard() {
    const todos = D().todos || [];
    const open = todos.filter((t) => !t.done); const done = todos.filter((t) => t.done);
    const input = h('input', { type: 'text', placeholder: 'Add a to-do…', onkeydown: async (e) => { if (e.key === 'Enter' && input.value.trim()) { await call('todo:add', input.value.trim()); await refresh(); render(); } } });
    return h('div', { class: 'card' }, h('h3', {}, `To-do (${open.length})`), input,
      h('div', { class: 'list', style: { marginTop: '8px' } }, open.map((t) => h('div', { class: 'item' },
        h('input', { type: 'checkbox', onchange: async () => { await call('todo:complete', t.id); await refresh(); render(); } }),
        h('div', { class: 'grow' }, t.text),
        h('button', { class: 'btn small ghost', onclick: async () => { await call('todo:delete', t.id); await refresh(); render(); } }, '✕')))),
      done.length ? h('details', {}, h('summary', {}, `Completed (${done.length})`), h('div', { class: 'list' }, done.slice(-20).map((t) => h('div', { class: 'item muted' }, '✓ ', t.text)))) : null);
  }

  // ------------------------------------------------------------- FOCUS

  let focusTick = null;
  function focusTab(root) {
    clearInterval(focusTick);
    const f = D().focus; const w = D().wellness; const a = f.active;
    const clock = h('div', { class: 'timer' }, '25:00');
    const upd = () => {
      if (!a) { clock.textContent = `${String(f.workMin).padStart(2, '0')}:00`; return; }
      const left = Math.max(0, Math.round((a.endsAt - Date.now()) / 1000));
      clock.textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
    };
    upd(); focusTick = setInterval(() => { if (!document.body.contains(clock)) return clearInterval(focusTick); upd(); }, 1000);
    root.appendChild(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Focus & wellness'), h('p', {}, 'Your cat settles down and works next to you, then makes you take breaks.'))));
    const stats = S.focusStats || { days: [] };
    const max = Math.max(30, ...stats.days.map((d) => d.minutes));
    root.appendChild(h('div', { class: 'grid two' },
      h('div', { class: 'card col', style: { alignItems: 'center', textAlign: 'center' } },
        h('span', { class: 'pill ' + (a ? (a.phase === 'work' ? 'accent' : 'green') : '') }, a ? (a.phase === 'work' ? `Focus · round ${a.cycle}` : 'Break') : 'Ready'),
        clock,
        h('div', { class: 'row' },
          a ? h('button', { class: 'btn', onclick: async () => { await call('focus:stop'); await refresh(); render(); } }, '■ Stop')
            : [25, 50, 90].map((m) => h('button', { class: 'btn ' + (m === 25 ? 'primary' : ''), onclick: async () => { await call('focus:start', m); await refresh(); render(); } }, `▶ ${m} min`))),
        h('div', { class: 'sliders', style: { width: '100%', marginTop: '10px' } },
          h('span', {}, 'Focus length'), h('input', { type: 'number', min: 5, max: 180, value: f.workMin, onchange: (e) => setSection('focus', { workMin: Number(e.target.value) }) }),
          h('span', {}, 'Short break'), h('input', { type: 'number', min: 1, max: 60, value: f.breakMin, onchange: (e) => setSection('focus', { breakMin: Number(e.target.value) }) }),
          h('span', {}, 'Long break'), h('input', { type: 'number', min: 5, max: 90, value: f.longBreakMin, onchange: (e) => setSection('focus', { longBreakMin: Number(e.target.value) }) }))),
      h('div', { class: 'card' }, h('h3', {}, 'Last 7 days'),
        h('div', { class: 'row' }, h('div', { class: 'stat grow' }, h('b', {}, stats.today + ' min'), h('span', {}, 'today')), h('div', { class: 'stat grow' }, h('b', {}, stats.week + ' min'), h('span', {}, 'this week'))),
        h('div', { class: 'chart' }, stats.days.map((d) => h('div', { class: 'b' }, h('span', {}, d.minutes || ''), h('i', { style: { height: Math.round((d.minutes / max) * 90) + 'px' } }), new Date(d.day + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' })))))));
    const habit = (key, label, unit) => h('div', { class: 'row' }, sw(label, w[key].on, (v) => setSection('wellness', { [key]: Object.assign({}, w[key], { on: v }) })), h('span', { class: 'spacer' }), h('span', { class: 'small muted' }, 'every'), h('input', { type: 'number', min: 5, max: 240, value: w[key].everyMin, style: { width: '76px' }, onchange: (e) => setSection('wellness', { [key]: Object.assign({}, w[key], { everyMin: Number(e.target.value) }) }) }), h('span', { class: 'small muted' }, unit));
    root.appendChild(h('div', { class: 'grid two', style: { marginTop: '16px' } },
      h('div', { class: 'card col' }, h('h3', {}, 'Healthy habits'), h('p', { class: 'small muted' }, 'Counted in active time only, never during focus or quiet hours.'),
        habit('hydration', '💧 Drink water', 'min'), habit('stretch', '🙆 Stretch & posture', 'min'), habit('eyes', '👀 20-20-20 eye break', 'min')),
      h('div', { class: 'card col' }, h('h3', {}, 'Quiet & awareness'),
        h('div', { class: 'row' }, sw('Quiet hours', w.quietHours.on, (v) => setSection('wellness', { quietHours: Object.assign({}, w.quietHours, { on: v }) })), h('span', { class: 'spacer' }),
          h('input', { type: 'time', value: w.quietHours.start, style: { width: '120px' }, onchange: (e) => setSection('wellness', { quietHours: Object.assign({}, w.quietHours, { start: e.target.value }) }) }), '–',
          h('input', { type: 'time', value: w.quietHours.end, style: { width: '120px' }, onchange: (e) => setSection('wellness', { quietHours: Object.assign({}, w.quietHours, { end: e.target.value }) }) })),
        sw('Do not disturb', w.dnd, (v) => setSection('wellness', { dnd: v })),
        sw('Morning hello with weather & agenda', w.morningBrief, (v) => setSection('wellness', { morningBrief: v })),
        sw('Late-night "go to bed" nudge', w.lateNight, (v) => setSection('wellness', { lateNight: v })),
        h('p', { class: 'small muted' }, 'Your cat naps when you step away for 5 minutes and says hello when you come back.'))));
  }

  // ------------------------------------------------------- INTEGRATIONS

  function integrationsTab(root) {
    root.appendChild(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Connections'), h('p', {}, 'Weather, calendars and read-only email so your cat can give you heads-ups.'))));
    root.appendChild(h('div', { class: 'grid two' }, weatherCard(), calendarCard()));
    root.appendChild(h('div', { class: 'grid two', style: { marginTop: '16px' } }, microsoftCard(), googleCard()));
    root.appendChild(suggestionsCard());
  }

  function weatherCard() {
    const u = D().user; const w = S.weather;
    const results = h('div', { class: 'list' });
    const q = h('input', { type: 'search', placeholder: 'Search your city…', onkeydown: async (e) => {
      if (e.key !== 'Enter') return;
      const r = await call('weather:search', q.value); results.innerHTML = '';
      for (const loc of r || []) results.appendChild(h('div', { class: 'item' }, h('div', { class: 'grow' }, `${loc.name}, ${loc.admin ? loc.admin + ', ' : ''}${loc.country}`), h('button', { class: 'btn small', onclick: async () => { await call('weather:setLocation', loc); toast('Location saved'); await refresh(); render(); } }, 'Use')));
      if (r && !r.length) results.appendChild(h('div', { class: 'empty' }, 'No matches'));
    } });
    return h('div', { class: 'card col' }, h('h3', {}, '🌤 Weather'),
      w ? h('p', {}, `${w.icon} ${w.temp}${w.unit}, ${w.label} in ${w.place}`) : h('p', { class: 'muted' }, u.location ? 'Loading…' : 'No location yet.'),
      h('div', { class: 'row' }, q, h('button', { class: 'btn', onclick: async () => { const loc = await call('weather:detect'); if (loc) { await call('weather:setLocation', loc); toast(`📍 ${loc.name}`); await refresh(); render(); } } }, '📍 Detect')),
      results,
      h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Units'), seg([['metric', '°C'], ['imperial', '°F']], u.units || 'metric', async (v) => { await setSection('user', { units: v }); render(); })),
      h('p', { class: 'small faint' }, 'Weather by Open-Meteo.com (free, no key). Detect uses your IP via ipwho.is only when you press it.'));
  }

  function calendarCard() {
    const cal = D().calendar;
    const name = h('input', { type: 'text', placeholder: 'Name (e.g. Work)' });
    const url = h('input', { type: 'url', placeholder: 'https://…/basic.ics or webcal://…' });
    const evs = (cal.events || []).filter((e) => e.end > Date.now()).slice(0, 6);
    return h('div', { class: 'card col' }, h('h3', {}, '📅 Calendars'),
      h('p', { class: 'small muted' }, 'Paste any iCal link: Google Calendar ("Secret address in iCal format"), Outlook ("Publish calendar"), iCloud, Teams. Connected Outlook calendars are read automatically.'),
      h('div', { class: 'row' }, name, url, h('button', { class: 'btn', onclick: async () => { const r = await call('calendar:addFeed', name.value || 'Calendar', url.value); if (r) { toast('Calendar added'); await refresh(); render(); } } }, 'Add')),
      cal.feeds.length ? h('div', { class: 'list' }, cal.feeds.map((f) => h('div', { class: 'item' }, h('span', {}, '🗓'), h('div', { class: 'grow' }, h('b', {}, f.name), h('div', { class: 'small faint' }, f.url.replace(/^(https?:\/\/[^/]+).*$/, '$1/…'))), h('button', { class: 'btn small ghost', onclick: async () => { await call('calendar:removeFeed', f.id); await refresh(); render(); } }, '✕')))) : null,
      h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Heads-up'), h('input', { type: 'number', min: 1, max: 60, value: cal.leadMin, style: { width: '70px' }, onchange: (e) => setSection('calendar', { leadMin: Number(e.target.value) }) }), h('span', { class: 'small muted' }, 'minutes before'), h('span', { class: 'spacer' }), h('button', { class: 'btn small', onclick: async () => { const r = await call('calendar:refresh'); if (r) { toast(`${r.events.length} events`); await refresh(); render(); } } }, '↻ Refresh')),
      evs.length ? h('div', { class: 'list' }, evs.map((e) => h('div', { class: 'item' }, h('div', { class: 'grow' }, e.title), h('span', { class: 'small muted' }, e.allDay ? 'all day' : fmtWhen(e.start))))) : h('p', { class: 'small faint' }, 'No upcoming events.'),
      (cal.errors || []).length ? h('p', { class: 'small', style: { color: 'var(--accent-ink)' } }, cal.errors.join(' · ')) : null);
  }

  function microsoftCard() {
    const ms = D().integrations.microsoft;
    const connected = S.microsoft.connected;
    const codeBox = h('div');
    const clientId = h('input', { type: 'text', value: ms.clientId || '', placeholder: 'Application (client) ID', onchange: (e) => setSection('integrations.microsoft', { clientId: e.target.value.trim() }) });
    const tenant = h('input', { type: 'text', value: ms.tenant || 'common', placeholder: 'common', onchange: (e) => setSection('integrations.microsoft', { tenant: e.target.value.trim() || 'common' }) });
    return h('div', { class: 'card col' }, h('div', { class: 'row' }, h('h3', { class: 'grow' }, '📧 Microsoft 365 / Outlook'), connected ? h('span', { class: 'pill green' }, 'connected') : h('span', { class: 'pill' }, 'off')),
      h('p', { class: 'small muted' }, 'Read-only access to your Outlook inbox and calendar. Your cat suggests reminders and memories from recent email. It cannot send, move or delete anything.'),
      connected ? [h('p', {}, `Signed in as ${(ms.account && (ms.account.email || ms.account.name)) || 'your account'}.`),
        sw('Suggest reminders from email', ms.scanMail !== false, (v) => setSection('integrations.microsoft', { scanMail: v })),
        sw('Read my Outlook calendar', ms.readCalendar !== false, (v) => setSection('integrations.microsoft', { readCalendar: v })),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: async () => { const r = await call('mail:scan'); if (r) { toast(`Scanned ${r.scanned} emails, ${r.added.length} new suggestions`); await refresh(); render(); } } }, '🔍 Scan inbox now'), h('button', { class: 'btn ghost danger', onclick: async () => { await call('ms:disconnect'); await refresh(); render(); } }, 'Disconnect'))]
        : [h('div', { class: 'row' }, h('label', { class: 'field grow' }, 'Client ID', clientId), h('label', { class: 'field', style: { width: '140px' } }, 'Tenant', tenant)),
          h('button', { class: 'btn blue', onclick: async () => {
            await setSection('integrations.microsoft', { clientId: clientId.value.trim(), tenant: tenant.value.trim() || 'common' });
            const r = await call('ms:connect');
            if (!r) return;
            codeBox.innerHTML = '';
            codeBox.append(h('p', { class: 'small muted' }, 'A Microsoft sign-in page opened. Enter this code there:'), h('div', { class: 'code-box' }, r.userCode), h('p', { class: 'small faint' }, r.verificationUri));
          } }, 'Connect Microsoft 365'),
          codeBox,
          h('details', {}, h('summary', {}, 'How to get a client ID (5 minutes, free)'), h('ol', {},
            h('li', {}, 'Go to entra.microsoft.com → App registrations → New registration. Name it "OpenPaws".'),
            h('li', {}, 'Supported account types: "Accounts in any organizational directory and personal Microsoft accounts".'),
            h('li', {}, 'Authentication → Advanced settings → "Allow public client flows": Yes.'),
            h('li', {}, 'API permissions → Microsoft Graph → Delegated: User.Read, Mail.Read, Calendars.Read, offline_access.'),
            h('li', {}, 'Copy the Application (client) ID here. Work accounts may need an admin to approve the permissions.')))]);
  }

  function googleCard() {
    const g = D().integrations.google;
    const connected = S.google.connected;
    const has = (k) => S.secrets.includes(k);
    return h('div', { class: 'card col' }, h('div', { class: 'row' }, h('h3', { class: 'grow' }, '✉️ Gmail'), connected ? h('span', { class: 'pill green' }, 'connected') : h('span', { class: 'pill' }, 'off')),
      h('p', { class: 'small muted' }, 'Read-only Gmail access (gmail.readonly) for reminder and memory suggestions. For Google Calendar, add its iCal link under Calendars.'),
      connected ? [h('p', {}, `Signed in as ${(g.account && g.account.email) || 'your account'}.`), h('button', { class: 'btn ghost danger', onclick: async () => { await call('google:disconnect'); await refresh(); render(); } }, 'Disconnect')]
        : [h('label', { class: 'field' }, 'OAuth client ID (Desktop app)', h('input', { type: 'text', value: g.clientId || '', onchange: (e) => setSection('integrations.google', { clientId: e.target.value.trim() }) })),
          h('label', { class: 'field' }, 'Client secret', h('input', { type: 'password', placeholder: has('google.clientSecret') ? '•••••• saved' : 'paste client secret', onchange: (e) => call('secret:set', 'google.clientSecret', e.target.value) })),
          h('button', { class: 'btn blue', onclick: async () => { toast('Opening Google sign-in in your browser…'); const r = await call('google:connect'); if (r) { toast('Gmail connected'); await refresh(); render(); } } }, 'Connect Gmail'),
          h('details', {}, h('summary', {}, 'How to get a Google client'), h('ol', {},
            h('li', {}, 'console.cloud.google.com → create a project → enable the Gmail API.'),
            h('li', {}, 'OAuth consent screen: External, add yourself as a test user, scope gmail.readonly.'),
            h('li', {}, 'Credentials → Create credentials → OAuth client ID → Desktop app. Paste the ID and secret here.')))]);
  }

  function suggestionsCard() {
    const list = S.suggestions || [];
    return h('div', { class: 'card', style: { marginTop: '16px' } }, h('div', { class: 'row' }, h('h3', { class: 'grow' }, `📬 Inbox suggestions (${list.length})`),
      sw('Scan automatically', D().integrations.scan.auto, (v) => setSection('integrations.scan', { auto: v })), h('span', { class: 'small muted' }, 'every'),
      h('input', { type: 'number', min: 1, max: 48, value: D().integrations.scan.everyHours, style: { width: '64px' }, onchange: (e) => setSection('integrations.scan', { everyHours: Number(e.target.value) }) }), h('span', { class: 'small muted' }, 'hours')),
      list.length ? h('div', { class: 'list' }, list.map((s) => h('div', { class: 'item' },
        h('span', {}, s.kind === 'memory' ? '🧠' : '⏰'),
        h('div', { class: 'grow' }, h('div', {}, s.text), h('div', { class: 'small muted' }, s.due ? fmtWhen(s.due) + ' · ' : '', s.source ? `from "${s.source.subject}" (${s.source.from})` : '')),
        h('button', { class: 'btn small primary', onclick: async () => { await call('suggestion:accept', s.id); toast(s.kind === 'memory' ? 'Remembered' : 'Reminder added'); await refresh(); render(); } }, s.kind === 'memory' ? 'Remember' : 'Add reminder'),
        h('button', { class: 'btn small ghost', onclick: async () => { await call('suggestion:dismiss', s.id); await refresh(); render(); } }, 'Dismiss'))))
        : h('div', { class: 'empty' }, 'Nothing to review. Connect Outlook or Gmail and your cat will look for dates and deadlines.'));
  }

  // ------------------------------------------------------------ MEMORY

  async function memoryTab(root) {
    root.appendChild(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Memory'), h('p', {}, 'What your cat remembers about you. You are always in control: edit or delete anything.'))));
    const m = await call('memory:list') || { facts: [], summary: '' };
    const sum = h('textarea', { rows: 4, placeholder: 'A short "about me" your cat writes from what it knows.' }, m.summary || '');
    root.appendChild(h('div', { class: 'card col' }, h('div', { class: 'row' }, h('h3', { class: 'grow' }, 'About you'),
      h('button', { class: 'btn small', onclick: async () => { const s = await call('memory:summary'); if (typeof s === 'string') { sum.value = s; toast('Summary refreshed'); } } }, '✨ Refresh summary'),
      h('button', { class: 'btn small', onclick: async () => { await call('memory:setSummary', sum.value); toast('Saved'); } }, 'Save')), sum));
    const add = h('input', { type: 'text', placeholder: 'Add something to remember, e.g. "My sister\'s birthday is 12 March"', onkeydown: async (e) => { if (e.key === 'Enter' && add.value.trim()) { await call('memory:add', add.value.trim()); render(); } } });
    root.appendChild(h('div', { class: 'card', style: { marginTop: '16px' } }, h('h3', {}, `Facts (${m.facts.length})`), add,
      m.facts.length ? h('div', { class: 'list', style: { marginTop: '8px' } }, m.facts.slice().reverse().map((f) => h('div', { class: 'item' },
        h('span', { title: f.source }, f.source === 'mail' ? '📧' : f.source === 'chat' ? '💬' : '✍️'),
        h('input', { type: 'text', value: f.text, onchange: (e) => call('memory:update', f.id, e.target.value) }),
        h('span', { class: 'small faint', style: { whiteSpace: 'nowrap' } }, new Date(f.createdAt).toLocaleDateString()),
        h('button', { class: 'btn small ghost', onclick: async () => { await call('memory:delete', f.id); render(); } }, '✕'))))
        : h('div', { class: 'empty' }, 'Nothing yet. Tell your cat about yourself in chat.'),
      h('div', { class: 'row', style: { marginTop: '12px' } }, h('span', { class: 'spacer' }), h('button', { class: 'btn small danger', onclick: async () => { if (confirm('Clear all chat history? Saved facts stay.')) { await call('chat:clear'); toast('Chat history cleared'); } } }, 'Clear chat history'))));
  }

  // ------------------------------------------------------ ACHIEVEMENTS

  function achievementsTab(root) {
    const list = S.achievements || [];
    const got = list.filter((a) => a.unlockedAt).length;
    root.appendChild(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Achievements'), h('p', {}, `${got} of ${list.length} unlocked · each one earns 2 treats. Treats also come from finishing reminders and focus sessions.`))));
    root.appendChild(h('div', { class: 'badges' }, list.map((a) => h('div', { class: 'card badge-card' + (a.unlockedAt ? '' : ' locked') }, h('div', { class: 'ic' }, a.icon),
      h('div', {}, h('b', {}, a.title), h('div', { class: 'small muted' }, a.desc), a.unlockedAt ? h('div', { class: 'small faint' }, new Date(a.unlockedAt).toLocaleDateString()) : null)))));
  }

  // ---------------------------------------------------------- SETTINGS

  function settingsTab(root) {
    root.appendChild(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Settings'))));
    root.appendChild(aiCard());
    root.appendChild(h('div', { class: 'grid two', style: { marginTop: '16px' } }, behaviorCard(), voiceCard()));
    root.appendChild(h('div', { class: 'grid two', style: { marginTop: '16px' } }, appCard(), dataCard()));
    root.appendChild(aboutCard());
    if (nav.section === 'ai') setTimeout(() => root.querySelector('#ai').scrollIntoView(), 50);
  }

  function aiCard() {
    const ai = D().ai;
    const prov = ai.provider || 'offline';
    const has = (k) => S.secrets.includes(k);
    const desc = {
      offline: 'Built-in. Reminders, timers, weather, tricks and simple chat. No key, nothing leaves your computer.',
      anthropic: 'Claude by Anthropic: warm, smart, great with tools.', openai: 'GPT models via the OpenAI API.',
      gemini: 'Google Gemini via its OpenAI-compatible endpoint.', ollama: 'Free local models on your machine (ollama.com).',
      custom: 'LM Studio, OpenRouter, Groq, Mistral… any OpenAI-compatible server.',
    };
    const out = h('div', { class: 'small muted' });
    const keyField = (k, label) => h('label', { class: 'field grow' }, label, h('input', { type: 'password', placeholder: has(k) ? '•••••••• saved (paste to replace)' : 'paste your API key', onchange: async (e) => { await call('secret:set', k, e.target.value); e.target.value = ''; await refresh(); toast('Key saved to your OS keychain'); render(); } }));
    const modelField = (section, placeholder) => h('label', { class: 'field grow' }, 'Model', h('input', { type: 'text', value: (ai[section] || {}).model || '', placeholder, onchange: (e) => setSection('ai.' + section, { model: e.target.value.trim() }) }));
    const urlField = (section) => h('label', { class: 'field grow' }, 'Server URL', h('input', { type: 'url', value: (ai[section] || {}).baseUrl || '', onchange: (e) => setSection('ai.' + section, { baseUrl: e.target.value.trim() }) }));
    const conf = {
      offline: null,
      anthropic: h('div', { class: 'row' }, keyField('anthropic.key', 'Claude API key (console.anthropic.com)'), modelField('anthropic', 'claude-opus-5-5'),
        h('label', { class: 'field' }, 'Effort', h('select', { onchange: (e) => setSection('ai.anthropic', { effort: e.target.value }) }, ['low', 'medium', 'high'].map((v) => h('option', { value: v, selected: (ai.anthropic.effort || 'low') === v }, v))))),
      openai: h('div', { class: 'row' }, keyField('openai.key', 'OpenAI API key'), modelField('openai', 'gpt-5-mini')),
      gemini: h('div', { class: 'row' }, keyField('gemini.key', 'Gemini API key (aistudio.google.com)'), modelField('gemini', 'gemini-2.5-flash')),
      ollama: h('div', { class: 'row' }, urlField('ollama'), modelField('ollama', 'llama3.2')),
      custom: h('div', { class: 'col' }, h('div', { class: 'row' }, urlField('custom'), modelField('custom', 'model name')), keyField('custom.key', 'API key (if needed)')),
    };
    return h('div', { class: 'card col', id: 'ai' }, h('h3', {}, '🧠 Brain'),
      h('div', { class: 'prov' }, Object.entries(S.providers).map(([id, p]) => h('button', { class: id === prov ? 'on' : '', onclick: async () => { await setSection('ai', { provider: id }); render(); } }, h('b', {}, p.label), h('span', {}, desc[id])))),
      conf[prov],
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: async () => { out.textContent = 'Testing…'; const r = await call('ai:test', prov); out.textContent = r ? (r.ok ? '✅ ' + r.reply : '❌ ' + r.error) : ''; } }, 'Test'), out, h('span', { class: 'spacer' }),
        h('span', { class: 'small muted' }, 'Chattiness'), seg([['quiet', 'Quiet'], ['normal', 'Normal'], ['chatty', 'Chatty']], ai.chatterLevel || 'normal', async (v) => { await setSection('ai', { chatterLevel: v }); render(); })),
      h('p', { class: 'small faint' }, S.encryption ? 'Keys are encrypted with your OS keychain and never leave this computer except to call the provider you choose.' : 'Your OS keychain is not available, so keys are stored obfuscated (not encrypted) in your user folder.'));
  }

  function behaviorCard() {
    const b = D().behavior;
    const set = (patch) => setSection('behavior', patch);
    return h('div', { class: 'card col' }, h('h3', {}, '🐈 Behaviour'),
      h('div', { class: 'row' }, h('span', { class: 'small muted grow' }, 'Walk on'), seg([['dock', 'Dock / taskbar'], ['bottom', 'Screen bottom']], b.walkOn, async (v) => { await set({ walkOn: v }); render(); })),
      h('div', { class: 'sliders' },
        h('span', {}, 'Cat size'), h('input', { type: 'range', min: 60, max: 220, value: Math.round(b.scale * 100), onchange: (e) => set({ scale: e.target.value / 100 }) }),
        h('span', {}, 'Speed'), h('input', { type: 'range', min: 40, max: 200, value: Math.round(b.speed * 100), onchange: (e) => set({ speed: e.target.value / 100 }) }),
        h('span', {}, 'Gravity'), h('input', { type: 'range', min: 40, max: 200, value: Math.round(b.gravity * 100), onchange: (e) => set({ gravity: e.target.value / 100 }) }),
        h('span', {}, 'Volume'), h('input', { type: 'range', min: 0, max: 100, value: Math.round(b.volume * 100), onchange: (e) => set({ volume: e.target.value / 100 }) })),
      sw('Climb walls', b.climb, (v) => set({ climb: v })), sw('Walk on the ceiling', b.ceiling, (v) => set({ ceiling: v })),
      sw('Roam across monitors', b.roamDisplays, (v) => set({ roamDisplays: v })), sw('Chase the cursor', b.chaseCursor, (v) => set({ chaseCursor: v })),
      sw('Cats play together', b.petInteractions, (v) => set({ petInteractions: v })), sw('Wander off screen sometimes', b.walkOff, (v) => set({ walkOff: v })),
      sw('Rain & snow on screen', b.weatherEffects, (v) => set({ weatherEffects: v })), sw('Umbrella when it rains', b.weatherGear, (v) => set({ weatherGear: v })),
      sw('Sounds', b.sounds, (v) => set({ sounds: v })), sw('Name tag on hover', b.showNames, (v) => set({ showNames: v })), sw('Calm mode (less running around)', b.quiet, (v) => set({ quiet: v })));
  }

  function voiceCard() {
    const b = D().behavior; const stt = D().ai.stt;
    const voices = (window.PawsSound.voices() || []);
    const sel = h('select', { onchange: (e) => { const p = petById(selectedPet) || pets()[0]; if (p) call('pet:update', p.id, { voice: Object.assign({}, p.voice, { name: e.target.value }) }); } },
      h('option', { value: '' }, 'System default'), voices.map((v) => h('option', { value: v.name }, `${v.name} (${v.lang})`)));
    return h('div', { class: 'card col' }, h('h3', {}, '🔊 Voice'),
      h('div', { class: 'row' }, h('span', { class: 'small muted grow' }, 'Speech bubbles'), seg([['animalese', 'Cat babble'], ['tts', 'Read aloud'], ['off', 'Silent']], b.voice || 'animalese', async (v) => { await setSection('behavior', { voice: v }); render(); })),
      b.voice === 'tts' ? h('label', { class: 'field' }, 'Voice for the selected cat', sel) : null,
      h('button', { class: 'btn small', onclick: () => { if (b.voice === 'tts') window.PawsSound.speak('Mrrp! Hello, human. I have opinions about your snacks.'); else window.PawsSound.babble('Mrrp! Hello, human. I have opinions about your snacks.'); } }, '▶ Preview'),
      h('hr', { style: { border: 0, borderTop: '1px solid var(--line)', width: '100%' } }),
      h('h3', {}, '🎙 Push-to-talk'),
      h('p', { class: 'small muted' }, 'Hold the mic button in chat to talk. Speech-to-text runs through any OpenAI-compatible transcription server: OpenAI, Groq, or a local Whisper server.'),
      h('div', { class: 'row' }, seg([['none', 'Off'], ['openai', 'OpenAI'], ['custom', 'Custom']], stt.provider || 'none', async (v) => { await setSection('ai.stt', { provider: v, baseUrl: v === 'openai' ? 'https://api.openai.com/v1' : stt.baseUrl }); render(); })),
      stt.provider === 'custom' ? h('label', { class: 'field' }, 'Server URL', h('input', { type: 'url', value: stt.baseUrl || '', placeholder: 'http://localhost:8000/v1', onchange: (e) => setSection('ai.stt', { baseUrl: e.target.value.trim() }) })) : null,
      stt.provider !== 'none' ? h('div', { class: 'row' }, h('label', { class: 'field grow' }, 'Model', h('input', { type: 'text', value: stt.model || 'whisper-1', onchange: (e) => setSection('ai.stt', { model: e.target.value.trim() }) })),
        h('label', { class: 'field grow' }, 'API key', h('input', { type: 'password', placeholder: S.secrets.includes('stt.key') ? '•••• saved' : (stt.provider === 'openai' ? 'uses your OpenAI key if empty' : 'optional'), onchange: (e) => call('secret:set', 'stt.key', e.target.value) }))) : null);
  }

  function appCard() {
    const a = D().app; const u = D().user;
    const sc = a.shortcuts || {};
    const scField = (k, label) => h('div', { class: 'row' }, h('span', { class: 'small grow' }, label), h('input', { type: 'text', value: sc[k] || '', style: { width: '220px' }, onchange: (e) => setSection('app', { shortcuts: Object.assign({}, sc, { [k]: e.target.value.trim() }) }) }));
    return h('div', { class: 'card col' }, h('h3', {}, '🖥 App'),
      h('label', { class: 'field' }, 'Your name (so your cat can greet you)', h('input', { type: 'text', value: u.name || '', onchange: (e) => setSection('user', { name: e.target.value.trim() }) })),
      paws.platform !== 'linux' ? sw('Start with my computer', a.launchAtLogin, (v) => setSection('app', { launchAtLogin: v })) : null,
      paws.platform === 'darwin' ? sw('Hide the Dock icon (menu bar only)', a.hideDockIcon, (v) => setSection('app', { hideDockIcon: v })) : null,
      h('div', { class: 'small muted' }, 'Global shortcuts'),
      scField('toggle', 'Show / hide cats'), scField('chat', 'Quick chat'), scField('feed', 'Feed everyone'),
      h('p', { class: 'small faint' }, 'Use Electron accelerator names, e.g. CommandOrControl+Shift+P.'));
  }

  function dataCard() {
    return h('div', { class: 'card col' }, h('h3', {}, '💾 Your data'),
      h('p', { class: 'small muted' }, 'Everything stays on this computer in your user folder. Backups never include API keys or sign-in tokens.'),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn', onclick: async () => { const r = await call('data:export'); if (r) toast('Saved ' + r); } }, '⬇ Export backup'),
        h('button', { class: 'btn', onclick: async () => { const r = await call('data:import'); if (r) { S = r; toast('Backup restored'); render(); } } }, '⬆ Import backup'),
        h('button', { class: 'btn danger', onclick: async () => { if (confirm('Reset OpenPaws? All cats, reminders and memory will be erased.')) { const r = await call('data:reset'); if (r) { S = r; render(); } } } }, 'Reset everything')));
  }

  function aboutCard() {
    return h('div', { class: 'card col', style: { marginTop: '16px' } }, h('h3', {}, '🐾 About OpenPaws ' + (S.version || '')),
      h('p', { class: 'small muted' }, 'An open-source (MIT) AI desktop cat. All artwork is drawn in code. Built with Electron, ONNX Runtime (U²-Net / IS-Net cutouts, Apache-2.0), chrono-node, node-ical, Open-Meteo and the Anthropic SDK. See NOTICE.md for full credits.'),
      h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => call('app:quit') }, 'Quit OpenPaws')));
  }

  const TABS = { home: homeTab, welcome: homeTab, pets: petsTab, adopt: adoptTab, reminders: remindersTab, focus: focusTab, integrations: integrationsTab, memory: memoryTab, achievements: achievementsTab, settings: settingsTab };
  // The photo creator lives in creator.js and registers itself here.
  window.__panel = { h, call, toast, refresh, go, render, TABS, get S() { return S; }, get nav() { return nav; }, set selectedPet(v) { selectedPet = v; } };

  // ------------------------------------------------------------- live

  let refreshT = null;
  paws.on('state:changed', () => {
    clearTimeout(refreshT);
    refreshT = setTimeout(async () => {
      await refresh();
      const typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if (tab === 'create') return; // the creator keeps its own in-progress state
      if (typing) dirty = true; else render();
    }, 250);
  });
  document.addEventListener('focusout', () => { if (dirty) setTimeout(() => { if (!document.activeElement || !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) render(); }, 300); });
  paws.on('panel:navigate', (m) => go(m.tab === 'welcome' ? 'home' : m.tab, m));
  paws.on('ms:status', async (m) => { if (m.error) toast(m.error, true); else { toast('Microsoft 365 connected 🎉'); await refresh(); if (tab === 'integrations') render(); } });

  (async function boot() {
    await refresh();
    let start = {};
    try { start = location.hash ? JSON.parse(decodeURIComponent(location.hash.slice(1))) : {}; } catch (_) { start = {}; }
    go(start.tab === 'welcome' ? 'home' : (start.tab || 'home'), start);
  })();
})();
