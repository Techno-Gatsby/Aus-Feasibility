'use strict';
/*
 * JSON store for everything OpenPaws remembers: pets, memory, reminders, settings.
 * Writes are debounced and atomic (write to temp file, then rename).
 */
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const VERSION = 1;

function defaults() {
  return {
    version: VERSION,
    user: { name: '', summary: '', summaryUpdatedAt: 0, summaryFactCount: 0, location: null, units: 'metric', timezone: '' },
    pets: [],
    activePetId: null,
    treats: 5,
    memory: { facts: [], history: {} },
    reminders: [],
    todos: [],
    focus: { workMin: 25, breakMin: 5, longBreakMin: 15, cyclesBeforeLong: 4, active: null, history: {} },
    wellness: {
      hydration: { on: false, everyMin: 60, last: 0 },
      stretch: { on: false, everyMin: 50, last: 0 },
      eyes: { on: false, everyMin: 20, last: 0 },
      quietHours: { on: true, start: '22:30', end: '07:30' },
      lateNight: true, morningBrief: true, dnd: false,
    },
    calendar: { feeds: [], leadMin: 10, events: [], fetchedAt: 0, announced: {} },
    integrations: {
      microsoft: { clientId: '', tenant: 'common', account: null, connectedAt: 0, scanMail: true, readCalendar: true },
      google: { clientId: '', account: null, connectedAt: 0 },
      scan: { auto: true, everyHours: 6, lookbackDays: 3, lastScan: 0, seen: {} },
      suggestions: [],
    },
    ai: {
      provider: 'offline',
      anthropic: { model: 'claude-opus-5-5', effort: 'low' },
      openai: { model: 'gpt-5-mini', baseUrl: 'https://api.openai.com/v1' },
      gemini: { model: 'gemini-2.5-flash', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
      ollama: { model: 'llama3.2', baseUrl: 'http://localhost:11434/v1' },
      custom: { model: '', baseUrl: 'http://localhost:1234/v1' },
      image: { provider: 'none', openaiModel: 'gpt-image-1', geminiModel: 'gemini-2.5-flash-image' },
      stt: { provider: 'none', model: 'whisper-1', baseUrl: 'https://api.openai.com/v1' },
      historyTurns: 16,
      chatterLevel: 'normal',
    },
    behavior: {
      walkOn: 'dock', scale: 1.15, speed: 1, gravity: 1, climb: true, ceiling: true, roamDisplays: true,
      chaseCursor: true, petInteractions: true, walkOff: true, weatherEffects: true, weatherGear: true,
      sounds: true, volume: 0.5, voice: 'animalese', showNames: true, quiet: false, hideInFullscreen: false,
    },
    app: {
      launchAtLogin: false, hideDockIcon: false, petsHidden: false, firstRun: true,
      shortcuts: { toggle: 'CommandOrControl+Shift+P', chat: 'CommandOrControl+Shift+Space', feed: 'CommandOrControl+Shift+F' },
    },
    achievements: { unlocked: {}, counters: {}, days: [] },
  };
}

// Deep-merge saved data over defaults so new settings appear after upgrades.
function mergeDefaults(def, saved) {
  if (Array.isArray(def)) return Array.isArray(saved) ? saved : def;
  if (def && typeof def === 'object') {
    const out = {};
    const src = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    for (const k of Object.keys(def)) out[k] = mergeDefaults(def[k], src[k]);
    for (const k of Object.keys(src)) if (!(k in out)) out[k] = src[k];
    return out;
  }
  return saved === undefined ? def : saved;
}

class Store extends EventEmitter {
  constructor(dir, name) {
    super();
    this.dir = dir;
    this.file = path.join(dir, name || 'openpaws-data.json');
    this.data = defaults();
    this.timer = null;
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      this.data = mergeDefaults(defaults(), JSON.parse(raw));
    } catch (e) {
      if (e.code !== 'ENOENT') {
        // Keep the unreadable file for recovery instead of overwriting it.
        try { fs.copyFileSync(this.file, this.file + '.corrupt-' + Date.now()); } catch (_) { /* nothing to keep */ }
      }
      this.data = defaults();
    }
    return this.data;
  }

  get(pathStr) {
    if (!pathStr) return this.data;
    return pathStr.split('.').reduce((o, k) => (o == null ? undefined : o[k]), this.data);
  }

  set(pathStr, value) {
    const keys = pathStr.split('.');
    let o = this.data;
    for (let i = 0; i < keys.length - 1; i++) {
      if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
      o = o[keys[i]];
    }
    o[keys[keys.length - 1]] = value;
    this.changed(keys[0]);
    return value;
  }

  // Shallow-merge an object into a settings section, e.g. update('behavior', {scale: 1.2}).
  update(section, patch) {
    const cur = this.get(section);
    const next = Object.assign({}, cur && typeof cur === 'object' ? cur : {}, patch);
    return this.set(section, next);
  }

  changed(section) {
    this.emit('change', section);
    this.save();
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      this.emit('error', e);
    }
  }

  reset() {
    this.data = defaults();
    this.changed('*');
  }

  export() { return JSON.parse(JSON.stringify(this.data)); }

  import(obj) {
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.pets)) throw new Error('That file is not an OpenPaws backup');
    this.data = mergeDefaults(defaults(), obj);
    this.changed('*');
  }
}

module.exports = { Store, defaults, mergeDefaults, VERSION };
