'use strict';
/*
 * Focus sessions (Pomodoro), healthy-habit nudges (water, stretch, 20-20-20 eye breaks),
 * quiet hours, and awareness of you: idle/away detection, screen lock, battery, late nights
 * and the first hello of the day.
 */

function minutesOfDay(hhmm) { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); }
function dayKey(d) { const x = d || new Date(); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; }

class Wellness {
  constructor(store, hooks, power) {
    this.store = store;
    this.hooks = hooks || {};
    this.power = power; // Electron powerMonitor (or a stub in tests)
    this.timer = null;
    this.away = false;
    this.awaySince = 0;
    this.activeMs = { hydration: 0, stretch: 0, eyes: 0 };
    this.lastTick = Date.now();
    this.lateNightShown = '';
    this.greetedDay = this.store.get('app.greetedDay') || '';
  }

  start() {
    this.timer = setInterval(() => this.tick(), 15000);
    if (this.power && this.power.on) {
      this.power.on('lock-screen', () => this.setAway(true, 'locked'));
      this.power.on('unlock-screen', () => this.setAway(false, 'unlocked'));
      this.power.on('suspend', () => this.setAway(true, 'sleep'));
      this.power.on('resume', () => this.setAway(false, 'wake'));
    }
    setTimeout(() => this.maybeGreet(), 4000);
  }
  stop() { clearInterval(this.timer); }

  inQuietHours(now) {
    const q = this.store.get('wellness.quietHours');
    if (!q || !q.on) return false;
    const d = now ? new Date(now) : new Date();
    const m = d.getHours() * 60 + d.getMinutes();
    const a = minutesOfDay(q.start); const b = minutesOfDay(q.end);
    return a <= b ? m >= a && m < b : m >= a || m < b;
  }

  dnd() { return !!this.store.get('wellness.dnd') || this.inQuietHours(); }

  setAway(away, why) {
    if (away === this.away) return;
    this.away = away;
    if (away) this.awaySince = Date.now();
    const awayMin = away ? 0 : (Date.now() - this.awaySince) / 60000;
    this.hooks.mood && this.hooks.mood();
    if (!away && awayMin >= 15) this.hooks.welcomeBack && this.hooks.welcomeBack(awayMin, why);
    if (!away) this.maybeGreet();
  }

  tick() {
    const now = Date.now();
    const dt = now - this.lastTick;
    this.lastTick = now;
    let idleSec = 0;
    try { idleSec = this.power && this.power.getSystemIdleTime ? this.power.getSystemIdleTime() : 0; } catch (_) { idleSec = 0; }
    if (idleSec >= 300 && !this.away) this.setAway(true, 'idle');
    else if (idleSec < 60 && this.away && this.awaySince && !this.lockedOrAsleep()) this.setAway(false, 'active');

    const focus = this.store.get('focus.active');
    if (focus && now >= focus.endsAt) this.advanceFocus();

    if (!this.away) {
      for (const k of Object.keys(this.activeMs)) this.activeMs[k] += dt;
      if (!this.dnd() && !(focus && focus.phase === 'work')) this.habitNudges();
    }
    this.lateNight();
  }

  lockedOrAsleep() { return false; }

  habitNudges() {
    const w = this.store.get('wellness');
    const msgs = {
      hydration: ['Water break! 💧 A sip for you, a sip for me.', 'Hydration check 💧 When did you last drink some water?'],
      stretch: ['Stretch with me! 🙆 Roll your shoulders and stand up for a minute.', 'Time for a big cat stretch 🐈 Up you get!'],
      eyes: ['Eye break 👀 Look at something 20 feet away for 20 seconds.', '20-20-20 time 👀 Rest those eyes for a moment.'],
    };
    for (const k of ['hydration', 'stretch', 'eyes']) {
      const cfg = w[k];
      if (!cfg || !cfg.on) continue;
      if (this.activeMs[k] >= cfg.everyMin * 60000) {
        this.activeMs[k] = 0;
        const list = msgs[k];
        this.hooks.nudge && this.hooks.nudge(k, list[Math.floor(Math.random() * list.length)]);
      }
    }
  }

  lateNight() {
    if (!this.store.get('wellness.lateNight') || this.away) return;
    const d = new Date();
    const key = dayKey(d);
    if ((d.getHours() === 23 && d.getMinutes() >= 30) || (d.getHours() >= 0 && d.getHours() < 3)) {
      if (this.lateNightShown !== key) {
        this.lateNightShown = key;
        this.hooks.lateNight && this.hooks.lateNight();
      }
    }
  }

  maybeGreet() {
    if (!this.store.get('wellness.morningBrief')) return;
    const d = new Date();
    const key = dayKey(d);
    if (this.greetedDay === key || d.getHours() < 5) return;
    this.greetedDay = key;
    this.store.set('app.greetedDay', key);
    this.hooks.greet && this.hooks.greet(d.getHours());
  }

  // ------------------------------------------------------------- focus

  focusState() { return this.store.get('focus.active'); }

  startFocus(minutes, label) {
    const f = this.store.get('focus');
    const work = minutes || f.workMin;
    const active = { phase: 'work', startedAt: Date.now(), endsAt: Date.now() + work * 60000, cycle: 1, workMin: work, label: label || '' };
    this.store.update('focus', { active });
    this.hooks.focus && this.hooks.focus('start', active);
    this.hooks.mood && this.hooks.mood();
    return active;
  }

  stopFocus(finished) {
    const active = this.store.get('focus.active');
    if (!active) return null;
    if (active.phase === 'work') this.logFocus(Math.round((Date.now() - active.startedAt) / 60000));
    this.store.update('focus', { active: null });
    this.hooks.focus && this.hooks.focus(finished ? 'done' : 'stop', active);
    this.hooks.mood && this.hooks.mood();
    return active;
  }

  advanceFocus() {
    const f = this.store.get('focus');
    const a = f.active;
    if (!a) return;
    if (a.phase === 'work') {
      this.logFocus(a.workMin || f.workMin);
      const long = a.cycle % (f.cyclesBeforeLong || 4) === 0;
      const br = long ? f.longBreakMin : f.breakMin;
      const next = Object.assign({}, a, { phase: 'break', startedAt: Date.now(), endsAt: Date.now() + br * 60000, long });
      this.store.update('focus', { active: next });
      this.hooks.focus && this.hooks.focus('break', next);
    } else {
      const next = Object.assign({}, a, { phase: 'work', startedAt: Date.now(), endsAt: Date.now() + (a.workMin || f.workMin) * 60000, cycle: a.cycle + 1 });
      this.store.update('focus', { active: next });
      this.hooks.focus && this.hooks.focus('work', next);
    }
    this.hooks.mood && this.hooks.mood();
  }

  logFocus(minutes) {
    if (!minutes || minutes < 1) return;
    const hist = Object.assign({}, this.store.get('focus.history'));
    const k = dayKey();
    hist[k] = (hist[k] || 0) + minutes;
    this.store.update('focus', { history: hist });
    if (minutes >= 10) this.hooks.focusDone && this.hooks.focusDone(minutes);
  }

  focusStats() {
    const hist = this.store.get('focus.history') || {};
    const days = [];
    for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); const k = dayKey(d); days.push({ day: k, minutes: hist[k] || 0 }); }
    return { today: hist[dayKey()] || 0, week: days.reduce((a, b) => a + b.minutes, 0), days };
  }
}

module.exports = { Wellness, minutesOfDay, dayKey };
