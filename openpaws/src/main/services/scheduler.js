'use strict';
/*
 * Reminders, timers and to-dos. Checks every 10 seconds; fires through the pet (speech
 * bubble with Done / Snooze), a system notification and a chime. Missed one-off reminders
 * (the app was closed) fire once on startup, marked as missed.
 */
const crypto = require('crypto');
const { parseReminder, nextOccurrence, describe } = require('./reminders-core.js');

class Scheduler {
  constructor(store, hooks) {
    this.store = store;
    this.hooks = hooks || {};
    this.interval = null;
  }

  start() {
    this.check(true);
    this.interval = setInterval(() => this.check(false), 10000);
  }
  stop() { clearInterval(this.interval); }

  list() { return (this.store.get('reminders') || []).slice().sort((a, b) => (a.done - b.done) || ((a.due || 0) - (b.due || 0))); }

  parse(text) { return parseReminder(text, Date.now()); }

  add(spec) {
    let r = spec;
    if (typeof spec === 'string' || (spec && spec.input)) {
      const parsed = parseReminder(typeof spec === 'string' ? spec : spec.input, Date.now());
      if (!parsed || !parsed.due) return { ok: false, needsTime: true, text: parsed ? parsed.text : '' };
      r = { text: parsed.text, due: parsed.due, rule: parsed.rule };
    }
    if (!r.text || !r.due) return { ok: false, reason: 'A reminder needs text and a time' };
    const rem = {
      id: 'r_' + crypto.randomBytes(4).toString('hex'),
      text: String(r.text).slice(0, 200), due: Number(r.due), rule: r.rule || null,
      kind: r.kind || 'reminder', createdAt: Date.now(), done: false, firedAt: 0,
      source: r.source || 'user', petId: r.petId || null,
    };
    this.store.set('reminders', [...(this.store.get('reminders') || []), rem]);
    this.hooks.changed && this.hooks.changed();
    return { ok: true, reminder: rem, when: describe(rem.due, rem.rule) };
  }

  addTimer(minutes, label) {
    return this.add({ text: label || `${minutes}-minute timer`, due: Date.now() + minutes * 60000, kind: 'timer' });
  }

  update(id, patch) {
    const list = (this.store.get('reminders') || []).map((r) => (r.id === id ? Object.assign({}, r, patch) : r));
    this.store.set('reminders', list);
    this.hooks.changed && this.hooks.changed();
    return list.find((r) => r.id === id);
  }

  remove(id) {
    this.store.set('reminders', (this.store.get('reminders') || []).filter((r) => r.id !== id));
    this.hooks.changed && this.hooks.changed();
  }

  // Finds by id or a loose text match ("cancel the vet reminder").
  find(idOrText) {
    const list = this.store.get('reminders') || [];
    const byId = list.find((r) => r.id === idOrText);
    if (byId) return byId;
    const q = String(idOrText || '').toLowerCase();
    return list.find((r) => !r.done && r.text.toLowerCase().includes(q));
  }

  complete(id) {
    const r = this.find(id);
    if (!r) return null;
    if (r.rule) {
      // Recurring: "done" means done for this occurrence.
      this.update(r.id, { due: nextOccurrence(r.rule, Date.now()), firedAt: 0, snoozed: false });
    } else this.update(r.id, { done: true, doneAt: Date.now() });
    this.hooks.completed && this.hooks.completed(r);
    return r;
  }

  snooze(id, minutes) {
    const r = this.find(id);
    if (!r) return null;
    return this.update(r.id, { due: Date.now() + (minutes || 10) * 60000, firedAt: 0, snoozed: true, done: false });
  }

  upcoming(hours) {
    const until = Date.now() + (hours || 24) * 3600000;
    return this.list().filter((r) => !r.done && r.due && r.due <= until);
  }

  check(startup) {
    const now = Date.now();
    const list = this.store.get('reminders') || [];
    let changed = false;
    const next = list.map((r) => {
      if (r.done || !r.due || r.due > now || r.firedAt) return r;
      const missed = now - r.due > 5 * 60000;
      changed = true;
      // Interval reminders that fell far behind skip ahead instead of firing a backlog.
      if (r.rule) {
        this.hooks.fire && this.hooks.fire(r, { missed: missed && startup });
        return Object.assign({}, r, { due: nextOccurrence(r.rule, now), lastFired: now });
      }
      this.hooks.fire && this.hooks.fire(r, { missed: missed && startup });
      return Object.assign({}, r, { firedAt: now });
    });
    if (changed) { this.store.set('reminders', next); this.hooks.changed && this.hooks.changed(); }
    // A fired one-off that nobody acknowledged gets one gentle nudge after 10 minutes.
    for (const r of next) {
      if (!r.done && r.firedAt && !r.nudged && !r.rule && now - r.firedAt > 10 * 60000 && r.kind !== 'timer') {
        this.update(r.id, { nudged: true });
        this.hooks.fire && this.hooks.fire(r, { nudge: true });
      }
    }
  }

  // ------------------------------------------------------------- todos

  todos() { return this.store.get('todos') || []; }
  addTodo(text) {
    const t = { id: 't_' + crypto.randomBytes(4).toString('hex'), text: String(text).slice(0, 200), done: false, createdAt: Date.now() };
    this.store.set('todos', [...this.todos(), t]);
    return t;
  }
  completeTodo(idOrText) {
    const q = String(idOrText || '').toLowerCase();
    let hit = null;
    const list = this.todos().map((t) => {
      if (!hit && !t.done && (t.id === idOrText || t.text.toLowerCase().includes(q))) { hit = t; return Object.assign({}, t, { done: true, doneAt: Date.now() }); }
      return t;
    });
    this.store.set('todos', list);
    if (hit && this.hooks.completed) this.hooks.completed(hit, 'todo');
    return hit;
  }
  removeTodo(id) { this.store.set('todos', this.todos().filter((t) => t.id !== id)); }
}

module.exports = { Scheduler };
