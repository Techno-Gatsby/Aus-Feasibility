'use strict';
/*
 * OpenPaws: an open-source AI desktop cat. Main process entry.
 */
const path = require('path');
const fs = require('fs');
const { app, protocol, safeStorage, powerMonitor, Notification, globalShortcut, Tray, Menu, nativeImage, shell, screen, net } = require('electron');

const { Store } = require('./store.js');
const { Secrets } = require('./secrets.js');
const { Assets } = require('./assets.js');
const { Pets } = require('./pets.js');
const { Windows } = require('./windows.js');
const { Scheduler } = require('./services/scheduler.js');
const { Weather } = require('./services/weather.js');
const { Wellness } = require('./services/wellness.js');
const { Calendar } = require('./services/calendar.js');
const { Microsoft } = require('./services/microsoft.js');
const { Google } = require('./services/google.js');
const { Suggestions } = require('./services/suggestions.js');
const { Cutout } = require('./services/cutout.js');
const { Memory } = require('./brain/memory.js');
const { Brain } = require('./brain/index.js');
const Species = require('../renderer/shared/species.js');
const { registerIpc } = require('./ipc.js');

const SMOKE = process.argv.includes('--smoke');
const SMOKE_OUT = (process.argv.find((a) => a.startsWith('--smoke-out=')) || '').split('=')[1] || path.join(process.cwd(), 'smoke-shots');
if (process.argv.includes('--user-data-dir-temp') || SMOKE) app.setPath('userData', path.join(app.getPath('temp'), 'openpaws-smoke-' + process.pid));

protocol.registerSchemesAsPrivileged([{ scheme: 'paws-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);

if (!SMOKE && !app.requestSingleInstanceLock()) { app.quit(); }

const ctx = { smoke: SMOKE };

function petName(id) { const p = ctx.pets.get(id); return p ? p.name : 'Your cat'; }
function mainPetId() {
  const active = ctx.pets.active();
  const fav = ctx.store.get('activePetId');
  return (active.find((p) => p.id === fav) || active[0] || {}).id;
}

function notify(title, body) {
  if (ctx.services.wellness.dnd() || SMOKE) return;
  try { if (Notification.isSupported()) new Notification({ title, body, silent: true }).show(); } catch (_) { /* best effort */ }
}

// The cat says something (optionally rewritten in the cat's own voice by the AI).
async function say(petId, text, opts) {
  const o = opts || {};
  const id = petId || mainPetId();
  if (!id) return;
  let line = text;
  if (o.remark) line = await ctx.brain.remark(id, o.remark, text);
  ctx.windows.say(id, Object.assign({ text: line }, o));
  return line;
}

function mood() {
  const w = ctx.services.wellness;
  const f = w.focusState();
  const h = new Date().getHours();
  return { focus: f ? { phase: f.phase, endsAt: f.endsAt } : null, away: w.away, night: h >= 23 || h < 6 };
}

function pushMood() { ctx.windows.broadcast('overlay:mood', mood()); }

function stateChanged(section) { ctx.windows.toPanels('state:changed', { section }); }

async function refreshWeather(force) {
  try {
    const w = await ctx.services.weather.current(force);
    if (w) { ctx.weatherNow = w; ctx.windows.weatherNow = w; ctx.windows.broadcast('overlay:weather', w); }
    return w;
  } catch (_) { return null; }
}

function setupHooks() {
  const { scheduler, wellness, calendar } = ctx.services;

  scheduler.hooks = {
    changed: () => stateChanged('reminders'),
    fire: (r, info) => {
      const pid = r.petId || mainPetId();
      const prefix = info.missed ? 'While you were away: ' : info.nudge ? 'Still on your list: ' : r.kind === 'timer' ? 'Time\'s up! ' : '';
      const text = `${prefix}${r.text}`;
      ctx.windows.say(pid, {
        id: r.id, kind: 'reminder', text, sound: 'chime', ttl: r.kind === 'timer' ? 20000 : 45000,
        actions: r.kind === 'timer' ? [{ id: 'done', label: 'OK' }] : [{ id: 'done', label: 'Done ✓' }, { id: 'snooze', label: 'Snooze 10m' }],
      });
      notify(`${petName(pid)} reminds you`, r.text);
    },
    completed: (r, kind) => {
      ctx.pets.count(kind === 'todo' ? 'todoDone' : 'reminderDone');
      const pid = mainPetId();
      if (pid) ctx.pets.bump(pid, { happiness: 3 }, 8);
      if (kind !== 'todo' && Math.random() < 0.5) ctx.pets.earnTreats(1, 'reminder');
      ctx.pets.checkAchievements();
    },
  };

  wellness.hooks = {
    mood: pushMood,
    nudge: (kind, text) => { say(null, text, { kind: 'wellness', sound: 'notify' }); },
    lateNight: () => { say(null, 'It\'s getting really late... cats nap 16 hours a day, and you need at least 7. Bed soon? 🌙', { remark: 'it is late at night and the user is still at the computer' }); },
    welcomeBack: (minutes) => {
      if (wellness.dnd()) return;
      say(null, minutes > 120 ? 'You\'re back! I missed you. 💛' : 'Welcome back! I kept your spot warm.', { remark: `the user just came back after ${Math.round(minutes)} minutes away` });
    },
    greet: async (hour) => {
      const w = await refreshWeather(true);
      const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
      const name = ctx.store.get('user.name');
      const evs = calendar.today().filter((e) => e.start > Date.now());
      const rem = scheduler.upcoming(16).length;
      let text = `${part}${name ? ', ' + name : ''}! `;
      if (w) text += `${w.icon} ${w.temp}${w.unit} and ${w.label}. `;
      if (evs.length) text += `You have ${evs.length} event${evs.length > 1 ? 's' : ''} today, first up "${evs[0].title}" at ${new Date(evs[0].start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. `;
      if (rem) text += `${rem} reminder${rem > 1 ? 's' : ''} lined up.`;
      say(null, text.trim(), { kind: 'weather', remark: 'first hello of the day' });
    },
    focus: (what, f) => {
      const pid = mainPetId();
      if (what === 'start') { say(pid, `Focus mode! ${f.workMin} minutes. I'll sit right here quietly. 🎯`, { speak: false }); ctx.windows.command('*', { type: 'focus' }); }
      if (what === 'break') { say(pid, f.long ? 'Long break! Go stretch, refill your water, maybe look out a window. ☕' : 'Break time! Stand up and stretch with me. 🙆', { sound: 'chime' }); ctx.windows.command(pid, { type: 'stretch' }); notify('Break time', 'Your focus session is done. Stretch!'); }
      if (what === 'work') { say(pid, 'Back to it! Next focus round starts now. 🎯', { sound: 'notify' }); }
      if (what === 'done' || what === 'stop') pushMood();
      stateChanged('focus');
    },
    focusDone: () => {
      ctx.pets.count('focusDone');
      const pid = mainPetId();
      if (pid) ctx.pets.bump(pid, { happiness: 5, bond: 2 }, 15);
      ctx.pets.earnTreats(1, 'focus');
      ctx.windows.command(pid, { type: 'celebrate' });
      ctx.pets.checkAchievements();
    },
  };

  calendar.hooks = {
    changed: () => stateChanged('calendar'),
    alert: (e, mins) => {
      const text = mins <= 1 ? `"${e.title}" is starting now!` : `Heads up: "${e.title}" starts in ${mins} minutes.${e.location ? ' (' + e.location + ')' : ''}`;
      ctx.windows.say(mainPetId(), { kind: 'event', text, sound: 'chime', actions: e.link ? [{ id: 'join', label: 'Open', data: { url: e.link } }, { id: 'dismiss', label: 'OK' }] : [{ id: 'dismiss', label: 'OK' }] });
      notify('Coming up', `${e.title} in ${mins} min`);
    },
  };
}

function petEmit(kind, data) {
  if (kind === 'pets') { ctx.windows.syncPets(); stateChanged('pets'); }
  else if (kind === 'stats') stateChanged('stats');
  else if (kind === 'levelUp') {
    const p = ctx.pets.get(data.petId);
    ctx.windows.command(data.petId, { type: 'celebrate' });
    ctx.windows.toPet(data.petId, 'overlay:toast', { title: `⭐ ${p ? p.name : 'Your cat'} reached level ${data.level}!`, body: data.unlocked.length ? `New trick to train: ${data.unlocked.join(', ')}` : 'Keep playing together!', confetti: true });
    stateChanged('pets');
  } else if (kind === 'achievement') {
    ctx.windows.toPet(mainPetId(), 'overlay:toast', { title: `${data.icon} ${data.title}`, body: data.desc + ' (+2 treats)', confetti: true });
    stateChanged('achievements');
  } else if (kind === 'treats') stateChanged('treats');
}

function buildTray() {
  const iconPath = path.join(__dirname, '..', '..', 'build', process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png');
  let img = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  if (process.platform === 'darwin' && !img.isEmpty()) img.setTemplateImage(true);
  ctx.tray = new Tray(img);
  ctx.tray.setToolTip('OpenPaws');
  const refresh = () => ctx.tray.setContextMenu(trayMenu());
  ctx.refreshTray = refresh;
  refresh();
  ctx.tray.on('click', () => { if (process.platform !== 'darwin') ctx.windows.openPanel(); });
}

function trayMenu() {
  const focus = ctx.services.wellness.focusState();
  const hidden = ctx.windows.hidden;
  const pid = mainPetId();
  return Menu.buildFromTemplate([
    { label: hidden ? 'Show cats' : 'Hide cats', click: () => { ctx.windows.setHidden(!hidden); ctx.refreshTray(); } },
    { label: 'Chat…', accelerator: ctx.store.get('app.shortcuts.chat'), click: () => ctx.windows.openChat(pid) },
    { label: 'Feed everyone', click: () => { for (const p of ctx.pets.active()) ctx.windows.command(p.id, { type: 'feed', food: 'fish' }); } },
    { type: 'separator' },
    focus ? { label: `Stop focus (${focus.phase})`, click: () => { ctx.services.wellness.stopFocus(false); ctx.refreshTray(); } }
      : { label: 'Start focus (25 min)', click: () => { ctx.services.wellness.startFocus(); ctx.refreshTray(); } },
    { label: 'Do not disturb', type: 'checkbox', checked: !!ctx.store.get('wellness.dnd'), click: (m) => { ctx.store.update('wellness', { dnd: m.checked }); stateChanged('wellness'); } },
    { type: 'separator' },
    { label: 'Control Center…', click: () => ctx.windows.openPanel() },
    { label: 'Adopt a cat…', click: () => ctx.windows.openPanel('adopt') },
    { type: 'separator' },
    { label: 'Quit OpenPaws', role: 'quit' },
  ]);
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  const sc = ctx.store.get('app.shortcuts') || {};
  const tryReg = (acc, fn) => { if (!acc) return; try { globalShortcut.register(acc, fn); } catch (_) { /* taken by another app */ } };
  tryReg(sc.toggle, () => { ctx.windows.setHidden(!ctx.windows.hidden); ctx.refreshTray && ctx.refreshTray(); });
  tryReg(sc.chat, () => ctx.windows.openChat(mainPetId()));
  tryReg(sc.feed, () => { for (const p of ctx.pets.active()) ctx.windows.command(p.id, { type: 'feed', food: 'fish' }); });
}

function applyAppSettings() {
  const a = ctx.store.get('app');
  if (!SMOKE && process.platform !== 'linux') { try { app.setLoginItemSettings({ openAtLogin: !!a.launchAtLogin }); } catch (_) { /* unsupported */ } }
  if (process.platform === 'darwin' && app.dock) { if (a.hideDockIcon) app.dock.hide(); else app.dock.show(); }
  registerShortcuts();
}

async function smokeRun() {
  // Headless check used in CI and development: capture every window, then quit.
  fs.mkdirSync(SMOKE_OUT, { recursive: true });
  ctx.pets.create({ companion: 2 });
  ctx.pets.create({ companion: 3 });
  ctx.windows.syncPets();
  const watch = (win, name) => win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.log(`[${name}] ${message}`); });
  for (const [id, e] of ctx.windows.overlays) watch(e.win, 'overlay-' + id);
  watch(ctx.windows.openPanel(), 'panel');
  watch(ctx.windows.openChat(mainPetId()), 'chat');
  await new Promise((r) => setTimeout(r, 2500));
  ctx.windows.say(mainPetId(), { text: 'Stand-up meeting in 10 minutes! 📅', kind: 'reminder', actions: [{ id: 'done', label: 'Done ✓' }, { id: 'snooze', label: 'Snooze 10m' }], speak: false });
  await new Promise((r) => setTimeout(r, 2500));
  const shots = [];
  for (const [id, e] of ctx.windows.overlays) shots.push(['overlay-' + id, e.win]);
  if (ctx.windows.panel) shots.push(['panel', ctx.windows.panel]);
  if (ctx.windows.chat) shots.push(['chat', ctx.windows.chat]);
  for (const [name, win] of shots) {
    try { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(SMOKE_OUT, name + '.png'), img.toPNG()); } catch (e) { console.error('capture failed', name, e.message); }
  }
  // Every Control Center tab, for visual review.
  if (process.argv.includes('--smoke-tabs') && ctx.windows.panel) {
    for (const tab of ['pets', 'adopt', 'create', 'reminders', 'focus', 'integrations', 'memory', 'achievements', 'settings']) {
      ctx.windows.panel.webContents.send('panel:navigate', { tab });
      await new Promise((r) => setTimeout(r, 1200));
      try { const img = await ctx.windows.panel.webContents.capturePage(); fs.writeFileSync(path.join(SMOKE_OUT, 'tab-' + tab + '.png'), img.toPNG()); } catch (e) { console.error('capture failed', tab, e.message); }
    }
  }
  const photoArg = process.argv.find((x) => x.startsWith('--smoke-photo='));
  if (photoArg && ctx.windows.panel) {
    const url = ctx.assets.copyFile('_imports', photoArg.split('=')[1]);
    const wc = ctx.windows.panel.webContents;
    wc.send('panel:navigate', { tab: 'create' });
    await new Promise((r) => setTimeout(r, 800));
    const t0 = Date.now();
    await wc.executeJavaScript(`window.__creator.processSlot('stand', { name: 'cat.png', url: ${JSON.stringify(url)} }, null)`);
    for (let i = 0; i < 120; i++) {
      const done = await wc.executeJavaScript("!!(window.__creator.st.slots.stand && window.__creator.st.slots.stand.dataUrl && !window.__creator.st.slots.stand.busy)");
      if (done) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const info = await wc.executeJavaScript("JSON.stringify({ method: window.__creator.st.slots.stand && window.__creator.st.slots.stand.method, rig: window.__creator.st.slots.stand && window.__creator.st.slots.stand.rig })");
    console.log('SMOKE photo cutout', Date.now() - t0, 'ms', info);
    try { fs.writeFileSync(path.join(SMOKE_OUT, 'tab-create-filled.png'), (await ctx.windows.panel.webContents.capturePage()).toPNG()); } catch (_) { /* best effort */ }
    await wc.executeJavaScript("window.__creator.st.name = 'Mochi'; window.__creator.save(null)");
    await new Promise((r) => setTimeout(r, 6000));
    const photoPets = ctx.pets.list().filter((p) => p.kind === 'photo');
    console.log('SMOKE photo pets', photoPets.length, photoPets[0] && Object.keys(photoPets[0].asset.poses || {}).join(','));
    for (const [id, e] of ctx.windows.overlays) { try { fs.writeFileSync(path.join(SMOKE_OUT, 'overlay-photo-' + id + '.png'), (await e.win.webContents.capturePage()).toPNG()); } catch (_) { /* best effort */ } }
    try { fs.writeFileSync(path.join(SMOKE_OUT, 'tab-pets-photo.png'), (await ctx.windows.panel.webContents.capturePage()).toPNG()); } catch (_) { /* best effort */ }
  }
  const r = await ctx.brain.chat(mainPetId(), 'remind me to drink water in 30 minutes');
  console.log('SMOKE chat:', r.text);
  console.log('SMOKE ok', shots.map((s) => s[0]).join(','));
  app.exit(0);
}

app.whenReady().then(async () => {
  // All network calls go through Chromium's network stack, so system and corporate
  // proxy settings (including PAC files) apply, unlike Node's built-in fetch.
  globalThis.fetch = (input, init) => net.fetch(input instanceof URL ? input.href : input, init);
  const dir = app.getPath('userData');
  ctx.store = new Store(dir);
  ctx.secrets = new Secrets(dir, safeStorage);
  ctx.assets = new Assets(dir);
  protocol.handle('paws-asset', ctx.assets.handler());
  ctx.pets = new Pets(ctx.store, petEmit);
  ctx.memory = new Memory(ctx.store);
  const services = {};
  ctx.services = services;
  services.scheduler = new Scheduler(ctx.store, {});
  services.weather = new Weather(ctx.store);
  services.wellness = new Wellness(ctx.store, {}, powerMonitor);
  services.microsoft = new Microsoft(ctx.store, ctx.secrets);
  services.google = new Google(ctx.store, ctx.secrets, { openExternal: (u) => shell.openExternal(u) });
  services.calendar = new Calendar(ctx.store, {}, { microsoft: services.microsoft });
  services.memory = ctx.memory;
  services.pets = ctx.pets;
  ctx.brain = new Brain({ store: ctx.store, secrets: ctx.secrets, memory: ctx.memory, pets: ctx.pets, services });
  services.suggestions = new Suggestions(ctx.store, { microsoft: services.microsoft, google: services.google, brain: ctx.brain });
  ctx.cutout = new Cutout(dir);
  ctx.mood = mood;
  ctx.say = say;
  ctx.mainPetId = mainPetId;
  ctx.stateChanged = stateChanged;
  ctx.refreshWeather = refreshWeather;
  ctx.applyAppSettings = applyAppSettings;
  ctx.pushMood = pushMood;
  ctx.notify = notify;
  ctx.windows = new Windows(ctx);
  ctx.Species = Species;

  setupHooks();
  registerIpc(ctx);

  // First run: one cat moves in straight away; the Control Center opens to say hello.
  const firstRun = !ctx.store.get('pets').length;
  if (firstRun && !SMOKE) ctx.pets.create({ companion: 0 });
  if (SMOKE && !ctx.store.get('pets').length) ctx.pets.create({ companion: 0 });

  ctx.windows.createOverlays();
  if (!SMOKE) buildTray();
  applyAppSettings();
  services.scheduler.start();
  services.wellness.start();
  services.calendar.start();
  refreshWeather(false);

  setInterval(() => ctx.pets.tick(), 60000);
  setInterval(() => refreshWeather(false), 30 * 60000);
  setInterval(() => { pushMood(); if (ctx.refreshTray) ctx.refreshTray(); }, 60000);
  // Inbox suggestions every few hours when an inbox is connected.
  setInterval(async () => {
    const scan = ctx.store.get('integrations.scan');
    const connected = services.microsoft.connected() || services.google.connected();
    if (!connected || !scan.auto || Date.now() - (scan.lastScan || 0) < (scan.everyHours || 6) * 3600000) return;
    const res = await services.suggestions.scan().catch(() => null);
    if (res && res.added.length) {
      say(null, `I read through your recent email and found ${res.added.length} thing${res.added.length > 1 ? 's' : ''} you might want a reminder for. Take a look?`, { actions: [{ id: 'open-suggestions', label: 'Show me' }, { id: 'dismiss', label: 'Later' }] });
      stateChanged('integrations');
    }
  }, 10 * 60000);

  if (firstRun && !SMOKE) {
    ctx.windows.openPanel('welcome');
    setTimeout(() => say(null, 'Mrrp! Hi, I\'m Clementine. I just moved onto your screen. 🐾 Click me for a menu, drag me around, or double-click me to chat!', { speak: false }), 2500);
  }
  if (SMOKE) smokeRun();

  powerMonitor.on('resume', () => refreshWeather(true));
  screen.on('display-metrics-changed', () => ctx.windows.syncPets());
});

app.on('second-instance', () => { if (ctx.windows) ctx.windows.openPanel(); });
app.on('activate', () => { if (ctx.windows) ctx.windows.openPanel(); });
// Closing the Control Center or chat keeps the cats running; quit from the tray.
app.on('window-all-closed', (e) => { if (!SMOKE) e.preventDefault && e.preventDefault(); });
app.on('will-quit', () => { globalShortcut.unregisterAll(); if (ctx.store) { ctx.store.set('app.lastSeen', Date.now()); ctx.store.flush(); } });

module.exports = { ctx };
