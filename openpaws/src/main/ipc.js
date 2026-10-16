'use strict';
/*
 * IPC: everything the Control Center, chat window and overlays can ask the app to do.
 */
const fs = require('fs');
const path = require('path');
const { ipcMain, Menu, dialog, shell, BrowserWindow, app } = require('electron');
const { transcribe } = require('./services/transcribe.js');
const { PROVIDERS } = require('./brain/index.js');
const { describe } = require('./services/reminders-core.js');

const SECRET_KEYS = new Set(['anthropic.key', 'openai.key', 'gemini.key', 'custom.key', 'stt.key', 'google.clientSecret']);
const SECTIONS = new Set(['user', 'ai', 'behavior', 'app', 'wellness', 'focus', 'calendar', 'integrations.microsoft', 'integrations.google', 'integrations.scan', 'ai.anthropic', 'ai.openai', 'ai.gemini', 'ai.ollama', 'ai.custom', 'ai.stt', 'ai.image']);

function registerIpc(ctx) {
  const { store, pets, windows, services, brain, memory, assets, cutout, secrets } = ctx;
  const sv = services;
  const handle = (ch, fn) => ipcMain.handle(ch, async (e, ...args) => {
    try { return await fn(...args, e); } catch (err) { return { error: err && err.message ? err.message : String(err) }; }
  });

  // ---------------------------------------------------------------- state

  function snapshot() {
    const s = store.export();
    delete s.memory.history;
    s.integrations.scan = Object.assign({}, s.integrations.scan, { seen: undefined });
    return {
      data: s,
      version: app.getVersion(),
      platform: process.platform,
      secrets: [...SECRET_KEYS].filter((k) => secrets.has(k)),
      encryption: secrets.canEncrypt(),
      providers: PROVIDERS,
      microsoft: { connected: sv.microsoft.connected() },
      google: { connected: sv.google.connected() },
      cutout: { available: cutout.available(), models: cutout.status() },
      achievements: pets.achievementList(),
      focusStats: sv.wellness.focusStats(),
      weather: ctx.weatherNow || null,
      suggestions: sv.suggestions.list(),
      runtime: pets.runtime,
    };
  }

  handle('state:get', () => snapshot());
  handle('state:update', (section, patch) => {
    if (!SECTIONS.has(section)) throw new Error('Unknown settings section ' + section);
    store.update(section, patch || {});
    if (section === 'behavior') {
      windows.broadcast('overlay:settings', windows.overlaySettings());
      if ('walkOn' in patch || 'roamDisplays' in patch) windows.rebuild();
    }
    if (section === 'app') ctx.applyAppSettings();
    if (section === 'user' && ('location' in patch || 'units' in patch)) { sv.weather.cache = null; ctx.refreshWeather(true); }
    ctx.stateChanged(section);
    return snapshot();
  });

  // ----------------------------------------------------------------- pets

  handle('pet:create', (spec) => {
    const p = pets.create(spec || {});
    windows.syncPets(p.id);
    setTimeout(() => ctx.say(p.id, `Hi! I'm ${p.name}. ${p.nickname ? 'They call me ' + p.nickname + '. ' : ''}So happy to be here! 🐾`, { speak: false }), 1500);
    return p;
  });
  handle('pet:update', (id, patch) => {
    const allowed = ['name', 'preset', 'colors', 'pattern', 'ears', 'fluff', 'accessories', 'size', 'personality', 'voice', 'mode', 'active', 'asset', 'nickname', 'story', 'gender', 'age', 'kind'];
    const clean = {};
    for (const k of allowed) if (patch && k in patch) clean[k] = patch[k];
    const p = pets.update(id, clean);
    if ('mode' in clean) windows.command(id, { type: 'mode', mode: clean.mode });
    return p;
  });
  handle('pet:delete', (id) => { pets.remove(id); assets.removePet(id); windows.syncPets(); return true; });
  handle('pet:action', (id, action, data) => petAction(id, action, data));
  handle('pet:train', (id, trick) => {
    const r = pets.train(id, trick);
    if (r.ok) {
      if (r.success) windows.command(id, { type: 'trick', trick });
      else windows.command(id, { type: 'sit' });
      if (r.learnedNow) ctx.say(id, `I learned ${r.trick.label}! ${r.trick.emoji} Ask me to do it any time.`, { sound: 'success' });
    }
    return r;
  });
  handle('pet:setMain', (id) => { store.set('activePetId', id); return true; });

  function petAction(id, action, data) {
    const d = data || {};
    switch (action) {
      case 'feed': windows.command(id, { type: 'feed', food: d.food || 'fish' }); return { ok: true };
      case 'treat': {
        if (!pets.spendTreat()) {
          ctx.say(id, 'Out of treats! 🍪 Finish a reminder or a focus session and I\'ll earn more.', { speak: false });
          return { ok: false, reason: 'No treats left' };
        }
        windows.command(id, { type: 'feed', food: 'cookie' });
        pets.update(id, { treatsGiven: (pets.get(id).treatsGiven || 0) + 1 });
        return { ok: true, treats: pets.treats() };
      }
      case 'ball': windows.command(id, { type: 'ball' }); return { ok: true };
      case 'wand': windows.command(id, { type: 'toy', kind: 'wand', seconds: 45 }); return { ok: true };
      case 'laser': windows.command(id, { type: 'toy', kind: 'laser', seconds: 30 }); return { ok: true };
      case 'stopToy': windows.broadcast('overlay:command', { petId: id, cmd: { type: 'toy', kind: null } }); return { ok: true };
      case 'brush': case 'bath':
        windows.command(id, { type: 'bath' });
        pets.bump(id, { hygiene: 35, happiness: 4, bond: 1 }, 3);
        return { ok: true };
      case 'trick': windows.command(id, { type: 'trick', trick: d.trick }); return { ok: true };
      case 'nap': windows.command(id, { type: 'sleep' }); return { ok: true };
      case 'wake': windows.command(id, { type: 'wake' }); return { ok: true };
      case 'walk': windows.command(id, { type: 'walkOff' }); return { ok: true };
      case 'comeBack': windows.command(id, { type: 'comeBack' }); return { ok: true };
      case 'mode': pets.update(id, { mode: d.mode }); windows.command(id, { type: 'mode', mode: d.mode }); return { ok: true };
      case 'say': ctx.say(id, d.text, { speak: d.speak }); return { ok: true };
      default: windows.command(id, { type: action }); return { ok: true };
    }
  }

  // ----------------------------------------------------------------- chat

  async function chat(petId, text) {
    const id = petId || ctx.mainPetId();
    const r = await brain.chat(id, text);
    for (const a of r.actions || []) runAction(id, a);
    windows.say(id, { text: r.text, react: !(r.actions && r.actions.length) });
    windows.toPanels('chat:message', { petId: id, role: 'assistant', text: r.text, error: r.error });
    return r;
  }

  function runAction(id, a) {
    if (!a || !a.type) return;
    if (a.type === 'happyHop') return windows.command(id, { type: 'jump' });
    if (a.type === 'look' || a.type === 'sad' || a.type === 'yawn' || a.type === 'beg') return windows.command(id, { type: a.type === 'sad' ? 'sit' : a.type === 'look' ? 'sit' : a.type === 'yawn' ? 'loaf' : 'sit' });
    if (a.type === 'walk_off' || a.type === 'walkOff') return windows.command(id, { type: 'walkOff' });
    if (a.type === 'sleep') return windows.command(id, { type: 'sleep' });
    windows.command(id, a);
  }

  handle('chat:send', (petId, text) => chat(petId, String(text || '').slice(0, 4000)));
  handle('chat:history', (petId) => memory.history(petId || ctx.mainPetId()));
  handle('chat:clear', (petId) => { memory.clearHistory(petId); return true; });

  // --------------------------------------------------------------- memory

  handle('memory:list', () => ({ facts: memory.facts(), summary: memory.summary() }));
  handle('memory:add', (text) => memory.add(text, 'manual'));
  handle('memory:update', (id, text) => { memory.update(id, text); return true; });
  handle('memory:delete', (id) => { memory.remove(id); return true; });
  handle('memory:summary', () => brain.refreshSummary());
  handle('memory:setSummary', (text) => { memory.setSummary(text); return true; });

  // ------------------------------------------------------ reminders, todos

  handle('reminder:list', () => sv.scheduler.list());
  handle('reminder:parse', (text) => { const r = sv.scheduler.parse(text); return r ? Object.assign(r, { when: r.due ? describe(r.due, r.rule) : null }) : null; });
  handle('reminder:add', (spec) => sv.scheduler.add(spec));
  handle('reminder:update', (id, patch) => sv.scheduler.update(id, patch));
  handle('reminder:delete', (id) => { sv.scheduler.remove(id); return true; });
  handle('reminder:complete', (id) => sv.scheduler.complete(id));
  handle('reminder:snooze', (id, min) => sv.scheduler.snooze(id, min));
  handle('todo:list', () => sv.scheduler.todos());
  handle('todo:add', (text) => sv.scheduler.addTodo(text));
  handle('todo:complete', (id) => sv.scheduler.completeTodo(id));
  handle('todo:delete', (id) => { sv.scheduler.removeTodo(id); return true; });

  // ------------------------------------------------------- focus, wellness

  handle('focus:start', (minutes, label) => { const f = sv.wellness.startFocus(minutes, label); ctx.refreshTray && ctx.refreshTray(); return f; });
  handle('focus:stop', () => { const f = sv.wellness.stopFocus(false); ctx.refreshTray && ctx.refreshTray(); return f; });
  handle('focus:stats', () => sv.wellness.focusStats());

  // -------------------------------------------------------------- weather

  handle('weather:get', (force) => ctx.refreshWeather(!!force));
  handle('weather:search', (q) => sv.weather.search(q));
  handle('weather:detect', () => sv.weather.detect());
  handle('weather:setLocation', (loc) => { sv.weather.setLocation(loc); return ctx.refreshWeather(true); });

  // ------------------------------------------------------------- calendar

  handle('calendar:addFeed', (name, url) => { const f = sv.calendar.addFeed(name, url); sv.calendar.refresh().catch(() => {}); return f; });
  handle('calendar:removeFeed', (id) => { sv.calendar.removeFeed(id); return sv.calendar.refresh(); });
  handle('calendar:refresh', () => sv.calendar.refresh());
  handle('calendar:upcoming', (hours) => sv.calendar.upcoming(hours || 72));

  // ----------------------------------------------------- mail integrations

  handle('ms:connect', async () => {
    const info = await sv.microsoft.begin((err, me) => {
      windows.toPanels('ms:status', err ? { error: err.message } : { connected: true, account: me && (me.mail || me.userPrincipalName) });
      if (!err) { sv.calendar.refresh().catch(() => {}); ctx.stateChanged('integrations'); }
    });
    if (info.verificationUri) shell.openExternal(info.verificationUri);
    return info;
  });
  handle('ms:cancel', () => { sv.microsoft.cancel(); return true; });
  handle('ms:disconnect', () => { sv.microsoft.disconnect(); ctx.stateChanged('integrations'); return true; });
  handle('google:connect', async () => { const r = await sv.google.connect(); ctx.stateChanged('integrations'); return r; });
  handle('google:disconnect', () => { sv.google.disconnect(); ctx.stateChanged('integrations'); return true; });
  handle('mail:scan', async () => { const r = await sv.suggestions.scan(); ctx.stateChanged('integrations'); return r; });
  handle('suggestion:accept', (id, edits) => {
    const s = sv.suggestions.resolve(id, true, edits);
    if (!s) throw new Error('Suggestion not found');
    if (s.kind === 'memory') memory.add(s.text, 'mail');
    else sv.scheduler.add({ text: s.text, due: s.due || Date.now() + 3600000, source: 'mail' });
    pets.count('suggestionsAccepted');
    ctx.stateChanged('integrations');
    return true;
  });
  handle('suggestion:dismiss', (id) => { sv.suggestions.resolve(id, false); ctx.stateChanged('integrations'); return true; });

  // ------------------------------------------------------------------- AI

  handle('ai:test', (prov) => brain.test(prov));
  handle('secret:set', (key, value) => {
    if (!SECRET_KEYS.has(key)) throw new Error('Unknown secret');
    secrets.set(key, String(value || '').trim());
    ctx.stateChanged('ai');
    return { ok: true, has: secrets.has(key) };
  });
  handle('stt:transcribe', async (audio, mime) => {
    const cfg = store.get('ai.stt');
    if (!cfg || cfg.provider === 'none') throw new Error('Turn on speech-to-text in Settings > Voice first');
    const key = cfg.provider === 'openai' ? (secrets.get('stt.key') || secrets.get('openai.key')) : secrets.get('stt.key');
    return transcribe({ audio: Buffer.from(audio), mime, baseUrl: cfg.baseUrl, model: cfg.model, apiKey: key });
  });

  // ------------------------------------------------- photo pets and assets

  handle('cutout:status', () => ({ available: cutout.available(), models: cutout.status() }));
  handle('cutout:download', async (id, ev) => {
    const sender = ev && ev.sender;
    await cutout.ensureModel(id, (f) => { if (sender && !sender.isDestroyed()) sender.send('cutout:progress', { id, progress: f }); });
    return cutout.status();
  });
  handle('cutout:segment', async (rgba, w, h, model) => {
    const mask = await cutout.segment(new Uint8Array(rgba), w, h, model || 'fast');
    return mask.buffer;
  });
  handle('asset:save', (petId, name, dataUrl) => assets.save(petId || 'shared', name, dataUrl));
  handle('asset:pick', async (kind, ev) => {
    const win = ev && BrowserWindow.fromWebContents(ev.sender);
    const filters = kind === 'video'
      ? [{ name: 'Videos', extensions: ['mp4', 'mov', 'webm', 'm4v'] }]
      : [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic'] }];
    const r = await dialog.showOpenDialog(win, { properties: kind === 'images' ? ['openFile', 'multiSelections'] : ['openFile'], filters });
    if (r.canceled || !r.filePaths.length) return [];
    // Copied into OpenPaws' asset folder and served as paws-asset:// (no raw file paths in pages).
    return r.filePaths.map((p) => ({ name: path.basename(p), url: assets.copyFile('_imports', p) }));
  });
  handle('import:shimeji', async (petId, ev) => {
    const win = ev && BrowserWindow.fromWebContents(ev.sender);
    const r = await dialog.showOpenDialog(win, { title: 'Choose a Shimeji image folder (with shime1.png ...)', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths.length) return null;
    const dir = r.filePaths[0];
    const files = fs.readdirSync(dir).filter((f) => /^shime\d+\.png$/i.test(f));
    if (!files.length) throw new Error('No shime1.png ... files in that folder. Pick the folder that holds the images.');
    const map = {};
    for (const f of files) map[f.toLowerCase()] = assets.copyFile(petId || '_imports', path.join(dir, f));
    return { files: map, name: path.basename(dir) };
  });

  // ----------------------------------------------------------- data & app

  handle('data:export', async (ev) => {
    const win = ev && BrowserWindow.fromWebContents(ev.sender);
    const r = await dialog.showSaveDialog(win, { defaultPath: 'openpaws-backup.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, JSON.stringify(store.export(), null, 1));
    return r.filePath;
  });
  handle('data:import', async (ev) => {
    const win = ev && BrowserWindow.fromWebContents(ev.sender);
    const r = await dialog.showOpenDialog(win, { filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths.length) return null;
    store.import(JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')));
    windows.syncPets();
    return snapshot();
  });
  handle('data:reset', () => { store.reset(); pets.create({ companion: 0 }); windows.syncPets(); return snapshot(); });
  handle('achievements:list', () => pets.achievementList());
  handle('app:openPanel', (tab, extra) => { windows.openPanel(tab, extra); return true; });
  handle('app:openChat', (petId) => { windows.openChat(petId); return true; });
  handle('app:openExternal', (url) => { if (/^https?:\/\//i.test(String(url))) shell.openExternal(url); return true; });
  handle('app:hidePets', (h) => { windows.setHidden(!!h); ctx.refreshTray && ctx.refreshTray(); return true; });
  handle('app:quit', () => { app.quit(); return true; });

  // ------------------------------------------------------------- overlays

  ipcMain.on('overlay:ready', (e) => windows.onReady(e.sender));
  ipcMain.on('overlay:interactive', (e, on) => windows.setInteractive(e.sender, !!on));
  ipcMain.on('overlay:petStates', (_e, st) => pets.setRuntime(st));
  ipcMain.on('overlay:transfer', (e, msg) => windows.transfer(e.sender, msg));
  ipcMain.on('overlay:openChat', (_e, m) => windows.openChat(m && m.petId));
  ipcMain.on('overlay:events', (_e, evs) => {
    pets.onEvents(evs);
    for (const ev of evs || []) reactTo(ev);
  });
  ipcMain.on('overlay:bubble', (_e, m) => {
    if (!m) return;
    if (m.action === 'done' && m.id) sv.scheduler.complete(m.id);
    else if (m.action === 'snooze' && m.id) { sv.scheduler.snooze(m.id, 10); ctx.say(m.petId, 'Okay, I\'ll remind you again in 10 minutes. 💤', { speak: false }); }
    else if (m.action === 'join' && m.data && m.data.url) { if (/^https?:\/\//i.test(m.data.url)) shell.openExternal(m.data.url); }
    else if (m.action === 'open-suggestions') windows.openPanel('integrations');
    else if (m.action === 'open') windows.openChat(m.petId);
  });
  ipcMain.on('overlay:menu', (_e, m) => orbAction(m.petId, m.action));
  ipcMain.on('overlay:contextmenu', (e, m) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    Menu.buildFromTemplate(contextMenu(m && m.petId)).popup({ window: win });
  });
  ipcMain.on('overlay:toastClick', () => windows.openPanel('achievements'));

  const lastQuip = {};
  function quip(petId, key, text, everyMs) {
    const k = petId + key;
    if (lastQuip[k] && Date.now() - lastQuip[k] < everyMs) return;
    lastQuip[k] = Date.now();
    ctx.say(petId, text, { speak: false });
  }

  function reactTo(ev) {
    const id = ev.petId;
    if (store.get('ai.chatterLevel') === 'quiet' || sv.wellness.dnd()) return;
    switch (ev.type) {
      case 'hungry': quip(id, 'hungry', 'My tummy is rumbling... 🐟 Feed me?', 20 * 60000); break;
      case 'returned': quip(id, 'back', ['I\'m back! I saw a bird. A BIG one.', 'Back from my adventure! Found a sock. 🧦', 'I explored the whole desktop. 10/10.'][Math.floor(Math.random() * 3)], 5 * 60000); break;
      case 'thrownHard': quip(id, 'yeet', 'Wheee! ...okay, maybe not so high next time. 😾', 60000); break;
      case 'ceiling': quip(id, 'ceiling', 'Look at me! I\'m on the ceiling! 🦇', 10 * 60000); break;
      default: break;
    }
  }

  function orbAction(petId, action) {
    switch (action) {
      case 'chat': windows.openChat(petId); break;
      case 'feed': petAction(petId, 'feed', { food: 'fish' }); break;
      case 'treat': petAction(petId, 'treat'); break;
      case 'ball': petAction(petId, 'ball'); break;
      case 'wand': petAction(petId, 'wand'); break;
      case 'nap': petAction(petId, 'nap'); break;
      case 'wake': petAction(petId, 'wake'); break;
      case 'walk': petAction(petId, 'walk'); break;
      case 'remind': windows.openPanel('reminders', { focusInput: true }); break;
      case 'train': windows.openPanel('pets', { petId, section: 'tricks' }); break;
      default:
        if (action && action.startsWith('trick:')) petAction(petId, 'trick', { trick: action.slice(6) });
    }
  }

  function contextMenu(petId) {
    const p = petId ? pets.get(petId) : null;
    const items = [];
    if (p) {
      const known = pets.knownTricks(p);
      items.push(
        { label: `${p.name} · Lv ${p.level} · ${pets.mood(p)}`, enabled: false },
        { type: 'separator' },
        { label: 'Chat…', click: () => windows.openChat(petId) },
        { label: 'Feed', submenu: Object.entries(ctx.Species.FOODS).filter(([, f]) => !f.treat).map(([k, f]) => ({ label: `${f.emoji} ${f.label}`, click: () => petAction(petId, 'feed', { food: k }) })) },
        { label: `Give a treat (${pets.treats()} left)`, enabled: pets.treats() > 0, click: () => petAction(petId, 'treat') },
        { label: 'Play', submenu: [
          { label: '⚾ Throw a ball', click: () => petAction(petId, 'ball') },
          { label: '🪶 Feather wand', click: () => petAction(petId, 'wand') },
          { label: '🔴 Laser pointer', click: () => petAction(petId, 'laser') },
          { label: 'Stop playing', click: () => petAction(petId, 'stopToy') },
        ] },
        { label: 'Tricks', submenu: [
          ...known.map((t) => ({ label: `${t.emoji} ${t.label}`, click: () => petAction(petId, 'trick', { trick: t.id }) })),
          ...(known.length ? [{ type: 'separator' }] : []),
          { label: 'Train new tricks…', click: () => windows.openPanel('pets', { petId, section: 'tricks' }) },
        ] },
        { label: 'Care', submenu: [
          { label: '🪮 Brush', click: () => petAction(petId, 'brush') },
          { label: '😴 Nap', click: () => petAction(petId, 'nap') },
          { label: '☀️ Wake up', click: () => petAction(petId, 'wake') },
          { label: '🍞 Loaf', click: () => petAction(petId, 'loaf') },
          { label: '🐾 Scratch the edge', click: () => petAction(petId, 'scratch') },
        ] },
        { label: 'Behavior', submenu: ['roam', 'follow', 'stay'].map((m) => ({ label: { roam: 'Roam freely', follow: 'Follow my cursor', stay: 'Stay put' }[m], type: 'radio', checked: (p.mode || 'roam') === m, click: () => petAction(petId, 'mode', { mode: m }) })) },
        { label: 'Go for a walk', click: () => petAction(petId, 'walk') },
        { label: 'Come back', click: () => petAction(petId, 'comeBack') },
        { type: 'separator' },
        { label: 'Remind me…', click: () => windows.openPanel('reminders', { focusInput: true }) },
        { label: 'Focus', submenu: [
          { label: '25 minutes', click: () => sv.wellness.startFocus(25) },
          { label: '50 minutes', click: () => sv.wellness.startFocus(50) },
          { label: 'Stop focus', enabled: !!sv.wellness.focusState(), click: () => sv.wellness.stopFocus(false) },
        ] },
        { label: `Customize ${p.name}…`, click: () => windows.openPanel('pets', { petId }) },
      );
    }
    items.push(
      { type: 'separator' },
      { label: 'Adopt another cat…', click: () => windows.openPanel('adopt') },
      { label: 'Hide cats', click: () => { windows.setHidden(true); ctx.refreshTray && ctx.refreshTray(); } },
      { label: 'Control Center…', click: () => windows.openPanel() },
      { label: 'Quit OpenPaws', click: () => app.quit() },
    );
    return items;
  }
}

module.exports = { registerIpc };
