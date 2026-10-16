'use strict';
/*
 * Natural-language reminders: "remind me to stretch in 20 minutes", "call mum tomorrow at 6pm",
 * "water the plants every monday at 9", "drink water every 45 minutes", "standup every weekday at 9:30".
 * Dates are parsed with chrono-node (MIT); recurrence is ours.
 */
const chrono = require('chrono-node');

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_RE = '(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(day|nesday|rsday|urday)?s?';

function dayIndex(word) {
  const w = word.toLowerCase().slice(0, 3);
  return DAYS.findIndex((d) => d.startsWith(w));
}

// Recurrence rules:
//   { type: 'interval', minutes }   every N minutes/hours
//   { type: 'daily', hour, minute }
//   { type: 'weekly', days: [0..6], hour, minute }
//   { type: 'monthly', day, hour, minute }
function parseRecurrence(text) {
  const t = text.toLowerCase();
  let m = /\bevery\s+(\d+|an?|one|two|three|four|five|six|ten|fifteen|twenty|thirty|forty[- ]five|ninety)?\s*(min(ute)?s?|hours?|hrs?)\b/.exec(t);
  if (m) {
    const words = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, ten: 10, fifteen: 15, twenty: 20, thirty: 30, 'forty-five': 45, 'forty five': 45, ninety: 90 };
    const n = m[1] ? (words[m[1]] || parseInt(m[1], 10)) : 1;
    const minutes = /^h/.test(m[2]) ? n * 60 : n;
    if (minutes >= 1) return { rule: { type: 'interval', minutes }, matched: m[0] };
  }
  if ((m = /\b(hourly|every hour)\b/.exec(t))) return { rule: { type: 'interval', minutes: 60 }, matched: m[0] };
  if ((m = /\b(every\s+weekday|on\s+weekdays|weekdays)\b/.exec(t))) return { rule: { type: 'weekly', days: [1, 2, 3, 4, 5] }, matched: m[0] };
  if ((m = /\b(every\s+weekend|on\s+weekends|weekends)\b/.exec(t))) return { rule: { type: 'weekly', days: [0, 6] }, matched: m[0] };
  const multi = new RegExp(`\\b(?:every|on)\\s+(${DAY_RE}(?:\\s*(?:,|and|&)\\s*${DAY_RE})*)`, 'i').exec(t);
  if (multi) {
    const names = multi[1].split(/\s*(?:,|and|&)\s*/).map(dayIndex).filter((d) => d >= 0);
    if (names.length) return { rule: { type: 'weekly', days: [...new Set(names)].sort() }, matched: multi[0] };
  }
  if ((m = /\b(every\s+(day|morning|evening|night)|daily|each\s+day)\b/.exec(t))) {
    const part = m[2];
    const def = part === 'morning' ? 9 : part === 'evening' ? 18 : part === 'night' ? 21 : null;
    return { rule: { type: 'daily', defaultHour: def }, matched: m[0] };
  }
  if ((m = /\b(every\s+week|weekly)\b/.exec(t))) return { rule: { type: 'weekly', days: null }, matched: m[0] };
  if ((m = /\b(every\s+month|monthly)\b/.exec(t))) return { rule: { type: 'monthly' }, matched: m[0] };
  return null;
}

function cleanTask(text, removals) {
  let t = ' ' + text + ' ';
  for (const r of removals) if (r) t = t.replace(r, ' ');
  t = t.replace(/^\s*(hey\s+\w+,?\s*)?(please\s+)?(can you\s+|could you\s+)?(remind me|set (a )?reminder|reminder|remember|don'?t let me forget)\s*(to|that|about|of)?\s*/i, '');
  t = t.replace(/\b(at|on|in|by|for)\s*$/i, '').replace(/\s+(at|on|in|by)\s+$/i, ' ');
  t = t.replace(/\s{2,}/g, ' ').replace(/^[\s,.-]+|[\s,.!?-]+$/g, '');
  return t;
}

// Returns { text, due (ms), rule|null, when (human) } or null if no time could be found.
function parseReminder(input, now, opts) {
  const ref = now ? new Date(now) : new Date();
  const text = String(input || '').trim();
  if (!text) return null;
  const rec = parseRecurrence(text);
  const removals = [];
  if (rec) removals.push(rec.matched);
  const results = chrono.parse(rec ? text.replace(rec.matched, ' ') : text, ref, { forwardDate: true });
  const r = results[0];
  let due = null;
  if (r) {
    removals.push(r.text);
    const d = r.start.date();
    // A date without a time ("tomorrow") means 9am; a past time today rolls to tomorrow.
    if (!r.start.isCertain('hour') && !/\bin\s+\d/.test(r.text)) d.setHours((rec && rec.rule.defaultHour) || 9, 0, 0, 0);
    due = d.getTime();
    if (due <= ref.getTime() && !r.start.isCertain('day')) due += 86400000;
  }
  let rule = rec ? Object.assign({}, rec.rule) : null;
  if (rule) {
    const anchor = due ? new Date(due) : null;
    if (rule.type === 'daily' || rule.type === 'weekly' || rule.type === 'monthly') {
      rule.hour = anchor ? anchor.getHours() : (rule.defaultHour != null ? rule.defaultHour : 9);
      rule.minute = anchor ? anchor.getMinutes() : 0;
      if (rule.type === 'weekly' && !rule.days) rule.days = [anchor ? anchor.getDay() : ref.getDay()];
      if (rule.type === 'monthly') rule.day = anchor ? anchor.getDate() : ref.getDate();
      delete rule.defaultHour;
      due = nextOccurrence(rule, ref.getTime() - 1);
    } else if (rule.type === 'interval') {
      if (!due) due = ref.getTime() + rule.minutes * 60000;
    }
  }
  if (!due && opts && opts.defaultMinutes) due = ref.getTime() + opts.defaultMinutes * 60000;
  if (!due) return { text: cleanTask(text, removals), due: null, rule: null, needsTime: true };
  const task = cleanTask(text, removals) || 'Reminder';
  return { text: task, due, rule, when: describe(due, rule, ref) };
}

function nextOccurrence(rule, after) {
  const a = new Date(after);
  if (!rule) return null;
  if (rule.type === 'interval') return after + rule.minutes * 60000;
  if (rule.type === 'daily') {
    const d = new Date(a); d.setHours(rule.hour, rule.minute || 0, 0, 0);
    if (d.getTime() <= after) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  if (rule.type === 'weekly') {
    const days = rule.days && rule.days.length ? rule.days : [a.getDay()];
    for (let i = 0; i < 8; i++) {
      const d = new Date(a); d.setDate(d.getDate() + i); d.setHours(rule.hour, rule.minute || 0, 0, 0);
      if (days.includes(d.getDay()) && d.getTime() > after) return d.getTime();
    }
  }
  if (rule.type === 'monthly') {
    for (let i = 0; i < 3; i++) {
      const d = new Date(a.getFullYear(), a.getMonth() + i, 1, rule.hour, rule.minute || 0, 0, 0);
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(rule.day || 1, last));
      if (d.getTime() > after) return d.getTime();
    }
  }
  return null;
}

function pad(n) { return String(n).padStart(2, '0'); }
function timeStr(d) {
  let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return m ? `${h}:${pad(m)}${ap}` : `${h}${ap}`;
}

function describe(due, rule, ref) {
  const d = new Date(due); const now = ref ? new Date(ref) : new Date();
  if (rule) {
    if (rule.type === 'interval') return rule.minutes % 60 === 0 ? `every ${rule.minutes / 60 === 1 ? 'hour' : rule.minutes / 60 + ' hours'}` : `every ${rule.minutes} minutes`;
    if (rule.type === 'daily') return `every day at ${timeStr(d)}`;
    if (rule.type === 'weekly') {
      const ds = rule.days || [];
      const names = ds.join() === '1,2,3,4,5' ? 'weekday' : ds.join() === '0,6' ? 'weekend day' : ds.map((i) => DAYS[i][0].toUpperCase() + DAYS[i].slice(1, 3)).join(', ');
      return `every ${names} at ${timeStr(d)}`;
    }
    if (rule.type === 'monthly') return `monthly on the ${d.getDate()}${['th', 'st', 'nd', 'rd'][(d.getDate() % 10 > 3 || [11, 12, 13].includes(d.getDate() % 100)) ? 0 : d.getDate() % 10]} at ${timeStr(d)}`;
  }
  const mins = Math.round((due - now.getTime()) / 60000);
  if (mins < 60 && mins >= 0) return mins <= 1 ? 'in a minute' : `in ${mins} minutes`;
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  if (sameDay) return `today at ${timeStr(d)}`;
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow at ${timeStr(d)}`;
  const days = (due - now.getTime()) / 86400000;
  if (days < 7) return `${DAYS[d.getDay()][0].toUpperCase() + DAYS[d.getDay()].slice(1)} at ${timeStr(d)}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${timeStr(d)}`;
}

module.exports = { parseReminder, parseRecurrence, nextOccurrence, describe, timeStr };
