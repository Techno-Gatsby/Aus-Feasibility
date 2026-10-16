'use strict';
/*
 * Long-term memory: facts about you that the cat should remember across chats, plus a
 * short "about you" summary. Everything is visible and editable in the Memory tab.
 */
const crypto = require('crypto');

function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }

class Memory {
  constructor(store) { this.store = store; }

  facts() { return this.store.get('memory.facts') || []; }

  add(text, source, petId) {
    const t = String(text || '').trim().replace(/\s+/g, ' ').slice(0, 300);
    if (t.length < 3) return null;
    const n = norm(t);
    if (this.facts().some((f) => norm(f.text) === n)) return null;
    const fact = { id: 'm_' + crypto.randomBytes(4).toString('hex'), text: t, source: source || 'manual', petId: petId || null, createdAt: Date.now() };
    this.store.set('memory.facts', [...this.facts(), fact].slice(-500));
    return fact;
  }

  update(id, text) {
    this.store.set('memory.facts', this.facts().map((f) => (f.id === id ? Object.assign({}, f, { text: String(text).slice(0, 300) }) : f)));
  }

  remove(id) { this.store.set('memory.facts', this.facts().filter((f) => f.id !== id)); }

  forget(idOrText) {
    const list = this.facts();
    const q = norm(idOrText);
    const hit = list.find((f) => f.id === idOrText) || list.find((f) => norm(f.text).includes(q)) || list.find((f) => q.split(' ').filter((w) => w.length > 3).every((w) => norm(f.text).includes(w)));
    if (hit) this.remove(hit.id);
    return hit || null;
  }

  // Relevant facts first: overlap with the current message, then the most recent.
  relevant(message, limit) {
    const words = new Set(norm(message).split(' ').filter((w) => w.length > 3));
    const scored = this.facts().map((f, i) => {
      const fw = norm(f.text).split(' ');
      const overlap = fw.filter((w) => words.has(w)).length;
      return { f, score: overlap * 10 + i / 1000 };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit || 40).map((x) => x.f);
  }

  history(petId) { return (this.store.get('memory.history') || {})[petId] || []; }

  addTurn(petId, role, text) {
    const all = Object.assign({}, this.store.get('memory.history'));
    const list = (all[petId] || []).concat([{ role, text: String(text).slice(0, 4000), at: Date.now() }]);
    all[petId] = list.slice(-80);
    this.store.set('memory.history', all);
  }

  clearHistory(petId) {
    const all = Object.assign({}, this.store.get('memory.history'));
    if (petId) delete all[petId]; else for (const k of Object.keys(all)) delete all[k];
    this.store.set('memory.history', all);
  }

  summary() { return this.store.get('user.summary') || ''; }
  setSummary(text) { this.store.update('user', { summary: String(text || '').slice(0, 1200), summaryUpdatedAt: Date.now(), summaryFactCount: this.facts().length }); }
  summaryStale() { return this.facts().length - (this.store.get('user.summaryFactCount') || 0) >= 5; }
}

module.exports = { Memory, norm };
