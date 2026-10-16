'use strict';
/*
 * Windows: one transparent, always-on-top, click-through overlay per display (cats walk on
 * the dock/taskbar and can stroll between monitors), plus the Control Center and chat.
 */
const path = require('path');
const { BrowserWindow, screen, nativeTheme } = require('electron');

const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, 'preload.js');

function overlap(a0, a1, b0, b1) { return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)); }

class Windows {
  constructor(app) {
    this.app = app; // { store, pets, onOverlayReady, smoke }
    this.overlays = new Map(); // displayId -> { win, display, ready }
    this.location = new Map(); // petId -> displayId
    this.panel = null;
    this.chat = null;
    this.cursorTimer = null;
    this.lastCursor = null;
    this.cursorIn = null;
    this.hidden = !!app.store.get('app.petsHidden');
  }

  webPrefs() {
    return { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false };
  }

  // ------------------------------------------------------------ overlays

  geometry(d) {
    const b = d.bounds; const wa = d.workArea;
    const walkOn = this.app.store.get('behavior.walkOn') || 'dock';
    const all = screen.getAllDisplays();
    const edges = { left: false, right: false };
    for (const o of all) {
      if (o.id === d.id) continue;
      const v = overlap(o.bounds.y, o.bounds.y + o.bounds.height, b.y, b.y + b.height);
      if (v < 60) continue;
      if (Math.abs(o.bounds.x + o.bounds.width - b.x) <= 2) edges.left = true;
      if (Math.abs(b.x + b.width - o.bounds.x) <= 2) edges.right = true;
    }
    return {
      displayId: d.id, width: b.width, height: b.height,
      floor: walkOn === 'bottom' ? b.height - 1 : wa.y + wa.height - b.y,
      ceiling: wa.y - b.y, left: wa.x - b.x, right: wa.x + wa.width - b.x, edges,
    };
  }

  createOverlay(d) {
    const b = d.bounds;
    const win = new BrowserWindow({
      x: b.x, y: b.y, width: b.width, height: b.height,
      transparent: true, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: true, hasShadow: false, focusable: false, alwaysOnTop: true, show: false,
      enableLargerThanScreen: true, backgroundColor: '#00000000', roundedCorners: false, title: 'OpenPaws',
      type: process.platform === 'darwin' ? 'panel' : undefined,
      webPreferences: Object.assign(this.webPrefs(), { backgroundThrottling: false }),
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    win.setIgnoreMouseEvents(true, { forward: true });
    win.loadFile(path.join(RENDERER, 'overlay', 'overlay.html'));
    const entry = { win, display: d, ready: false, interactive: false };
    win.webContents.on('did-finish-load', () => { if (!this.hidden && !this.app.smokeHidden) win.showInactive(); });
    win.on('closed', () => { if (this.overlays.get(d.id) === entry) this.overlays.delete(d.id); });
    this.overlays.set(d.id, entry);
    return entry;
  }

  createOverlays() {
    const roam = this.app.store.get('behavior.roamDisplays') !== false;
    const displays = roam ? screen.getAllDisplays() : [screen.getPrimaryDisplay()];
    for (const d of displays) if (!this.overlays.has(d.id)) this.createOverlay(d);
    if (!this.displayListener) {
      this.displayListener = () => { clearTimeout(this.rebuildT); this.rebuildT = setTimeout(() => this.rebuild(), 600); };
      screen.on('display-added', this.displayListener);
      screen.on('display-removed', this.displayListener);
      screen.on('display-metrics-changed', this.displayListener);
    }
    this.startCursor();
  }

  rebuild() {
    const roam = this.app.store.get('behavior.roamDisplays') !== false;
    const displays = roam ? screen.getAllDisplays() : [screen.getPrimaryDisplay()];
    const ids = new Set(displays.map((d) => d.id));
    const primary = screen.getPrimaryDisplay().id;
    for (const [id, e] of this.overlays) {
      if (!ids.has(id)) {
        for (const [pid, did] of this.location) if (did === id) this.location.set(pid, primary);
        e.win.destroy();
        this.overlays.delete(id);
      }
    }
    for (const d of displays) {
      const e = this.overlays.get(d.id);
      if (!e) this.createOverlay(d);
      else {
        e.display = d;
        e.win.setBounds(d.bounds);
        if (e.ready) e.win.webContents.send('overlay:bounds', this.geometry(d));
      }
    }
    this.syncPets();
  }

  entryFor(webContents) {
    for (const e of this.overlays.values()) if (e.win.webContents === webContents) return e;
    return null;
  }

  onReady(webContents) {
    const e = this.entryFor(webContents);
    if (!e) return;
    e.ready = true;
    const g = this.geometry(e.display);
    webContents.send('overlay:init', Object.assign(g, {
      settings: this.overlaySettings(), pets: this.petsFor(e.display.id), weather: this.app.weatherNow || null, mood: this.app.mood ? this.app.mood() : null,
    }));
  }

  overlaySettings() {
    const b = this.app.store.get('behavior');
    return Object.assign({}, b, { scale: b.scale || 1 });
  }

  petsFor(displayId) {
    const primary = screen.getPrimaryDisplay().id;
    const active = this.app.pets.active();
    return active.filter((p) => {
      let loc = this.location.get(p.id);
      if (loc == null || !this.overlays.has(loc)) { loc = this.overlays.has(primary) ? primary : [...this.overlays.keys()][0]; this.location.set(p.id, loc); }
      return loc === displayId;
    }).map((p) => this.cfgFor(p));
  }

  cfgFor(p) { return Object.assign({}, p, { story: undefined }); }

  syncPets(spawnId) {
    for (const [id, e] of this.overlays) {
      if (!e.ready) continue;
      const list = this.petsFor(id).map((c) => (c.id === spawnId ? Object.assign({}, c, { _spawnFromTop: true }) : c));
      e.win.webContents.send('overlay:pets', list);
    }
  }

  broadcast(ch, data) {
    for (const e of this.overlays.values()) if (e.ready) e.win.webContents.send(ch, data);
  }

  toPet(petId, ch, data) {
    const loc = this.location.get(petId);
    const e = loc != null ? this.overlays.get(loc) : null;
    if (e && e.ready) { e.win.webContents.send(ch, data); return true; }
    const first = [...this.overlays.values()].find((x) => x.ready);
    if (first) first.win.webContents.send(ch, data);
    return !!first;
  }

  command(petId, cmd) { return this.toPet(petId, 'overlay:command', { petId, cmd }); }
  say(petId, msg) { return this.toPet(petId, 'overlay:say', Object.assign({ petId }, msg)); }

  setInteractive(webContents, on) {
    const e = this.entryFor(webContents);
    if (!e || e.interactive === on) return;
    e.interactive = on;
    e.win.setIgnoreMouseEvents(!on, { forward: true });
  }

  transfer(webContents, msg) {
    const from = this.entryFor(webContents);
    if (!from || !msg || !msg.cfg) return;
    const b = from.display.bounds;
    let best = null; let bestV = 0;
    for (const e of this.overlays.values()) {
      if (e === from) continue;
      const o = e.display.bounds;
      const adj = msg.side === 'right' ? Math.abs(b.x + b.width - o.x) <= 2 : Math.abs(o.x + o.width - b.x) <= 2;
      const v = overlap(o.y, o.y + o.height, b.y, b.y + b.height);
      if (adj && v > bestV) { best = e; bestV = v; }
    }
    const target = best || from; // nowhere to go: walk back in
    this.location.set(msg.petId, target.display.id);
    const pet = this.app.pets.get(msg.petId);
    target.win.webContents.send('overlay:arrive', { cfg: pet ? this.cfgFor(pet) : msg.cfg, side: target === from ? msg.side : (msg.side === 'right' ? 'left' : 'right') });
    if (best) this.app.pets.onEvents([{ type: 'transfer', petId: msg.petId }]);
  }

  setHidden(h) {
    this.hidden = h;
    this.app.store.update('app', { petsHidden: h });
    for (const e of this.overlays.values()) { if (h) e.win.hide(); else e.win.showInactive(); }
  }

  // The overlays need the cursor even when they let clicks through (cats chase it, look at
  // it and get petted by it), and Linux cannot forward mouse moves, so poll it here.
  startCursor() {
    if (this.cursorTimer) return;
    this.cursorTimer = setInterval(() => {
      if (this.hidden) return;
      const pt = screen.getCursorScreenPoint();
      if (this.lastCursor && pt.x === this.lastCursor.x && pt.y === this.lastCursor.y) return;
      this.lastCursor = pt;
      let inside = null;
      for (const e of this.overlays.values()) {
        const b = e.display.bounds;
        if (pt.x >= b.x && pt.x < b.x + b.width && pt.y >= b.y && pt.y < b.y + b.height) { inside = e; break; }
      }
      if (this.cursorIn && this.cursorIn !== inside && this.cursorIn.ready && !this.cursorIn.win.isDestroyed()) this.cursorIn.win.webContents.send('overlay:cursor', { inside: false });
      this.cursorIn = inside;
      if (inside && inside.ready) {
        const b = inside.display.bounds;
        inside.win.webContents.send('overlay:cursor', { x: pt.x - b.x, y: pt.y - b.y, inside: true });
      }
    }, 33);
  }

  displayOf(petId) {
    const e = this.overlays.get(this.location.get(petId));
    return e ? e.display : screen.getPrimaryDisplay();
  }

  // --------------------------------------------------------------- panel

  openPanel(tab, extra) {
    if (this.panel && !this.panel.isDestroyed()) {
      if (this.panel.isMinimized()) this.panel.restore();
      this.panel.show(); this.panel.focus();
      if (tab) this.panel.webContents.send('panel:navigate', Object.assign({ tab }, extra || {}));
      return this.panel;
    }
    this.panel = new BrowserWindow({
      width: 1180, height: 800, minWidth: 940, minHeight: 640, show: false, title: 'OpenPaws',
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1b1f' : '#f7f3ee',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default', autoHideMenuBar: true,
      webPreferences: this.webPrefs(),
    });
    const hash = tab ? '#' + encodeURIComponent(JSON.stringify(Object.assign({ tab }, extra || {}))) : '';
    this.panel.loadFile(path.join(RENDERER, 'panel', 'panel.html'), { hash: hash.slice(1) || undefined });
    this.panel.once('ready-to-show', () => this.panel.show());
    this.panel.on('closed', () => { this.panel = null; });
    return this.panel;
  }

  openChat(petId) {
    const d = petId ? this.displayOf(petId) : screen.getPrimaryDisplay();
    const wa = d.workArea;
    if (this.chat && !this.chat.isDestroyed()) {
      this.chat.webContents.send('chat:open', { petId });
      this.chat.show(); this.chat.focus();
      return this.chat;
    }
    const w = 400; const h = 600;
    this.chat = new BrowserWindow({
      width: w, height: h, minWidth: 320, minHeight: 420, x: wa.x + wa.width - w - 24, y: wa.y + wa.height - h - 24,
      show: false, title: 'Chat', alwaysOnTop: false, autoHideMenuBar: true,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1b1f' : '#fbf8f4',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      webPreferences: this.webPrefs(),
    });
    this.chat.loadFile(path.join(RENDERER, 'chat', 'chat.html'), { hash: petId ? encodeURIComponent(petId) : undefined });
    this.chat.once('ready-to-show', () => this.chat.show());
    this.chat.on('closed', () => { this.chat = null; });
    return this.chat;
  }

  toPanels(ch, data) {
    for (const w of [this.panel, this.chat]) if (w && !w.isDestroyed()) w.webContents.send(ch, data);
  }
}

module.exports = { Windows };
