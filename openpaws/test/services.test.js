'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Calendar } = require('../src/main/services/calendar.js');
const { heuristic } = require('../src/main/services/suggestions.js');
const { toTensorData, resizeRGBA, MODELS } = require('../src/main/services/cutout.js');
const Photo = require('../src/renderer/shared/photo.js');
const { backend } = require('./helpers.js');

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:standup-1
DTSTART;TZID=Australia/Sydney:20261015T093000
DTEND;TZID=Australia/Sydney:20261015T094500
RRULE:FREQ=DAILY;COUNT=5
SUMMARY:Team standup
LOCATION:Teams
END:VEVENT
BEGIN:VEVENT
UID:vet-1
DTSTART:20261017T013000Z
DTEND:20261017T023000Z
SUMMARY:Vet appointment for Clementine
END:VEVENT
END:VCALENDAR`;

test('ICS parsing expands recurring events with time zones', () => {
  const from = new Date('2026-10-14T00:00:00Z'); const to = new Date('2026-10-30T00:00:00Z');
  const evs = Calendar.parseIcs(ICS, 'Work', from, to);
  const standups = evs.filter((e) => e.title === 'Team standup');
  assert.equal(standups.length, 5);
  // 09:30 in Sydney (UTC+11 in October) is 22:30 UTC the previous day.
  assert.equal(new Date(standups[0].start).toISOString(), '2026-10-14T22:30:00.000Z');
  assert.ok(evs.some((e) => e.title.startsWith('Vet appointment')));
});

test('calendar heads-up fires once per event', () => {
  const b = backend();
  const fired = [];
  const cal = new Calendar(b.store, { alert: (e, m) => fired.push([e.title, m]) }, {});
  b.store.update('calendar', { events: [{ id: 'x', title: 'Design review', start: Date.now() + 5 * 60000, end: Date.now() + 65 * 60000 }] });
  cal.checkAlerts(); cal.checkAlerts();
  assert.equal(fired.length, 1);
  assert.equal(fired[0][0], 'Design review');
});

test('inbox heuristic finds dated, actionable mail and skips promotions', () => {
  const now = new Date(2026, 9, 15, 10, 0).getTime();
  const out = heuristic([
    { id: '1', subject: 'Interview confirmed for Friday at 2pm', preview: 'Looking forward to meeting you', from: 'HR' },
    { id: '2', subject: '50% off everything this weekend', preview: 'Unsubscribe here', from: 'Shop' },
    { id: '3', subject: 'Your invoice is due on October 30', preview: 'Please pay by the due date', from: 'Billing' },
    { id: '4', subject: 'Lunch?', preview: 'Hey, how are you', from: 'Sam' },
  ], now);
  assert.equal(out.length, 2);
  const interview = out.find((x) => /Interview/.test(x.text));
  assert.equal(new Date(interview.due).getHours(), 13); // 15 minutes before 2pm
  assert.equal(new Date(interview.due).getMinutes(), 45);
});

test('segmentation preprocessing matches the model input layout', () => {
  const w = 40; const h = 30;
  const rgba = new Uint8ClampedArray(w * h * 4).fill(200);
  for (const m of Object.values(MODELS)) {
    const t = toTensorData(rgba, w, h, m);
    assert.equal(t.length, 3 * m.size * m.size);
    assert.ok(Number.isFinite(t[0]));
  }
  const small = resizeRGBA(rgba, w, h, 10, 8);
  assert.equal(small.length, 10 * 8 * 4);
});

test('mask refinement keeps the subject and drops stray blobs', () => {
  const w = 60; const h = 40;
  const d = new Uint8ClampedArray(w * h * 4).fill(255);
  const mask = new Uint8Array(w * h);
  for (let y = 10; y < 34; y++) for (let x = 18; x < 42; x++) mask[y * w + x] = 255; // the cat
  for (let y = 2; y < 5; y++) for (let x = 2; x < 5; x++) mask[y * w + x] = 255; // a speck
  Photo.applyMaskData(d, w, h, mask);
  assert.equal(d[(20 * w + 30) * 4 + 3], 255);
  assert.equal(d[(3 * w + 3) * 4 + 3], 0);
  assert.equal(d[(0 * w + 0) * 4 + 3], 0);
});
