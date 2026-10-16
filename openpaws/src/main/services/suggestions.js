'use strict';
/*
 * Inbox suggestions: scans recent Outlook / Gmail messages (subject, sender, preview only)
 * and proposes reminders and memories. Nothing is saved until you accept it.
 *
 * With an AI provider configured the brain extracts suggestions; otherwise a local
 * heuristic finds dated items (meetings, deadlines, deliveries, bills, appointments).
 */
const crypto = require('crypto');
const chrono = require('chrono-node');

const SIGNALS = /\b(meeting|call|interview|appointment|deadline|due|submit|renew(al)?|expires?|invoice|bill|payment|rsvp|reservation|booking|flight|check-?in|delivery|deliver(ed|ing)|pick ?up|webinar|event|reminder|review|exam|vet|doctor|dentist|birthday|anniversary)\b/i;
const NOISE = /\b(unsubscribe|newsletter|% off|sale|deal|promo|no-?reply)\b/i;

function heuristic(messages, now) {
  const ref = new Date(now || Date.now());
  const out = [];
  for (const m of messages) {
    const text = `${m.subject}. ${m.preview || ''}`;
    if (NOISE.test(text) && !SIGNALS.test(m.subject)) continue;
    if (!SIGNALS.test(text)) continue;
    const results = chrono.parse(text, ref, { forwardDate: true });
    const r = results.find((x) => x.start.date().getTime() > ref.getTime());
    if (!r) continue;
    const d = r.start.date();
    if (!r.start.isCertain('hour')) d.setHours(9, 0, 0, 0);
    // Remind a little before timed things, the morning of all-day things.
    let due = d.getTime();
    if (r.start.isCertain('hour')) due -= 15 * 60000;
    if (due - ref.getTime() > 60 * 86400000) continue;
    out.push({ kind: 'reminder', text: m.subject.replace(/^(re|fw|fwd):\s*/i, '').slice(0, 120), due, source: m, confidence: 0.55 });
  }
  return out;
}

class Suggestions {
  constructor(store, deps) {
    this.store = store;
    this.deps = deps || {};
  }

  list() { return (this.store.get('integrations.suggestions') || []).filter((s) => s.status === 'pending'); }

  async scan(opts) {
    const o = opts || {};
    const cfg = this.store.get('integrations.scan');
    const seen = Object.assign({}, cfg.seen);
    const days = o.lookbackDays || cfg.lookbackDays || 3;
    const mail = [];
    const errors = [];
    const { microsoft, google, brain } = this.deps;
    if (microsoft && microsoft.connected() && this.store.get('integrations.microsoft.scanMail') !== false) {
      try { mail.push(...await microsoft.recentMail(days, 30)); } catch (e) { errors.push('Outlook: ' + e.message); }
    }
    if (google && google.connected()) {
      try { mail.push(...await google.recentMail(days, 25)); } catch (e) { errors.push('Gmail: ' + e.message); }
    }
    const fresh = mail.filter((m) => !seen[m.id]);
    let found = [];
    if (fresh.length) {
      if (brain && brain.canUseCloud()) {
        try { found = await brain.extractFromMail(fresh); } catch (e) { errors.push('AI: ' + e.message); found = heuristic(fresh); }
      } else found = heuristic(fresh);
    }
    for (const m of fresh) seen[m.id] = Date.now();
    for (const k of Object.keys(seen)) if (Date.now() - seen[k] > 30 * 86400000) delete seen[k];
    const existing = this.store.get('integrations.suggestions') || [];
    const add = found.map((f) => ({
      id: 's_' + crypto.randomBytes(4).toString('hex'), kind: f.kind, text: f.text, due: f.due || null, status: 'pending', createdAt: Date.now(),
      source: f.source ? { provider: f.source.provider, subject: f.source.subject, from: f.source.from, date: f.source.date, link: f.source.link } : null,
    })).filter((s) => !existing.some((e) => e.text === s.text && e.kind === s.kind));
    this.store.update('integrations', { suggestions: [...existing, ...add].slice(-200) });
    this.store.update('integrations.scan', { seen, lastScan: Date.now() });
    return { scanned: mail.length, fresh: fresh.length, added: add, errors };
  }

  resolve(id, accept, edits) {
    const list = this.store.get('integrations.suggestions') || [];
    const s = list.find((x) => x.id === id);
    if (!s) return null;
    const next = list.map((x) => (x.id === id ? Object.assign({}, x, edits || {}, { status: accept ? 'accepted' : 'dismissed' }) : x));
    this.store.update('integrations', { suggestions: next });
    return Object.assign({}, s, edits || {});
  }
}

module.exports = { Suggestions, heuristic };
