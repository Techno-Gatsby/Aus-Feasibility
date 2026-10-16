'use strict';
/*
 * Calendar awareness. Sources:
 *   - any iCalendar (.ics) feed: Google Calendar "secret address in iCal format", Outlook
 *     "publish calendar" ICS link, iCloud public calendars, Teams/Zoom exports...
 *   - Microsoft 365 calendar through Graph when connected.
 * ICS parsing, time zones and recurrence expansion by node-ical (Apache-2.0).
 * The cat gives you a heads-up a few minutes before each event.
 */
const crypto = require('crypto');
const ical = require('node-ical');

class Calendar {
  constructor(store, hooks, deps) {
    this.store = store;
    this.hooks = hooks || {};
    this.ms = deps && deps.microsoft;
    this.fetch = (deps && deps.fetch) || globalThis.fetch;
    this.timer = null;
  }

  start() {
    this.refresh().catch(() => {});
    this.timer = setInterval(() => this.refresh().catch(() => {}), 15 * 60000);
    this.alertTimer = setInterval(() => this.checkAlerts(), 30000);
  }
  stop() { clearInterval(this.timer); clearInterval(this.alertTimer); }

  feeds() { return this.store.get('calendar.feeds') || []; }

  addFeed(name, url) {
    let u = String(url || '').trim().replace(/^webcal:\/\//i, 'https://');
    if (!/^https?:\/\//i.test(u)) throw new Error('That does not look like a calendar link (it should start with https:// or webcal://)');
    const feed = { id: 'f_' + crypto.randomBytes(4).toString('hex'), name: name || 'Calendar', url: u, enabled: true };
    this.store.update('calendar', { feeds: [...this.feeds(), feed] });
    return feed;
  }

  removeFeed(id) { this.store.update('calendar', { feeds: this.feeds().filter((f) => f.id !== id) }); }

  // Parses ICS text into events in [from, to], expanding recurring events.
  static parseIcs(text, sourceName, from, to) {
    const data = ical.sync.parseICS(text);
    const out = [];
    for (const ev of Object.values(data)) {
      if (!ev || ev.type !== 'VEVENT' || !ev.start) continue;
      const allDay = ev.datetype === 'date';
      const title = typeof ev.summary === 'string' ? ev.summary : (ev.summary && ev.summary.val) || '(event)';
      const location = typeof ev.location === 'string' ? ev.location : (ev.location && ev.location.val) || '';
      if (ev.rrule) {
        let instances = [];
        try { instances = ical.expandRecurringEvent(ev, { from, to }); } catch (_) { instances = []; }
        for (const inst of instances) {
          const s = new Date(inst.start).getTime();
          const e = inst.end ? new Date(inst.end).getTime() : s + 3600000;
          out.push({ id: `${ev.uid}@${s}`, source: sourceName, title: (inst.summary && (inst.summary.val || inst.summary)) || title, start: s, end: e, allDay, location });
        }
      } else {
        const s = new Date(ev.start).getTime();
        const e = ev.end ? new Date(ev.end).getTime() : s + 3600000;
        if (e >= from.getTime() && s <= to.getTime()) out.push({ id: `${ev.uid}@${s}`, source: sourceName, title, start: s, end: e, allDay, location });
      }
    }
    return out;
  }

  async refresh() {
    const from = new Date(Date.now() - 3600000);
    const to = new Date(Date.now() + 7 * 86400000);
    const all = [];
    const errors = [];
    for (const f of this.feeds().filter((x) => x.enabled !== false)) {
      try {
        const res = await this.fetch(f.url, { headers: { accept: 'text/calendar, */*' } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        all.push(...Calendar.parseIcs(await res.text(), f.name, from, to));
      } catch (e) { errors.push(`${f.name}: ${e.message}`); }
    }
    if (this.ms && this.ms.connected() && this.store.get('integrations.microsoft.readCalendar') !== false) {
      try { all.push(...await this.ms.events(7)); } catch (e) { errors.push('Outlook: ' + e.message); }
    }
    all.sort((a, b) => a.start - b.start);
    const seen = new Set();
    const events = all.filter((e) => { const k = e.title + e.start; if (seen.has(k)) return false; seen.add(k); return true; });
    this.store.update('calendar', { events, fetchedAt: Date.now(), errors });
    this.hooks.changed && this.hooks.changed();
    return { events, errors };
  }

  upcoming(hours) {
    const now = Date.now(); const until = now + (hours || 24) * 3600000;
    return (this.store.get('calendar.events') || []).filter((e) => e.end > now && e.start < until);
  }

  today() {
    const s = new Date(); s.setHours(0, 0, 0, 0);
    const e = new Date(s); e.setDate(e.getDate() + 1);
    return (this.store.get('calendar.events') || []).filter((ev) => ev.start < e.getTime() && ev.end > s.getTime());
  }

  checkAlerts() {
    const lead = (this.store.get('calendar.leadMin') || 10) * 60000;
    const now = Date.now();
    const announced = Object.assign({}, this.store.get('calendar.announced'));
    let changed = false;
    for (const e of this.store.get('calendar.events') || []) {
      if (e.allDay || announced[e.id]) continue;
      if (e.start - now <= lead && e.start - now > -60000) {
        announced[e.id] = now; changed = true;
        this.hooks.alert && this.hooks.alert(e, Math.max(0, Math.round((e.start - now) / 60000)));
      }
    }
    if (changed) {
      for (const k of Object.keys(announced)) if (now - announced[k] > 3 * 86400000) delete announced[k];
      this.store.update('calendar', { announced });
    }
  }
}

module.exports = { Calendar };
