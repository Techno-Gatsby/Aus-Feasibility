'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseReminder, nextOccurrence } = require('../src/main/services/reminders-core.js');

// Thursday 2026-10-15 10:00 local time
const NOW = new Date(2026, 9, 15, 10, 0, 0).getTime();
const at = (d) => new Date(d);

test('relative time: in 20 minutes', () => {
  const r = parseReminder('remind me to stretch in 20 minutes', NOW);
  assert.equal(r.text, 'stretch');
  assert.equal(r.due, NOW + 20 * 60000);
  assert.equal(r.rule, null);
});

test('tomorrow at 6pm', () => {
  const r = parseReminder('Remind me to call mum tomorrow at 6pm', NOW);
  assert.equal(r.text, 'call mum');
  const d = at(r.due);
  assert.equal(d.getDate(), 16);
  assert.equal(d.getHours(), 18);
  assert.match(r.when, /tomorrow at 6pm/);
});

test('date without time defaults to 9am', () => {
  const r = parseReminder('book the vet on friday', NOW);
  const d = at(r.due);
  assert.equal(d.getDay(), 5);
  assert.equal(d.getHours(), 9);
  assert.equal(r.text, 'book the vet');
});

test('every 45 minutes', () => {
  const r = parseReminder('drink water every 45 minutes', NOW);
  assert.deepEqual(r.rule, { type: 'interval', minutes: 45 });
  assert.equal(r.due, NOW + 45 * 60000);
  assert.equal(r.text, 'drink water');
});

test('every weekday at 9:30', () => {
  const r = parseReminder('standup every weekday at 9:30am', NOW);
  assert.equal(r.rule.type, 'weekly');
  assert.deepEqual(r.rule.days, [1, 2, 3, 4, 5]);
  const d = at(r.due);
  assert.equal(d.getDate(), 16); // 9:30 today has passed, next is Friday
  assert.equal(d.getHours(), 9); assert.equal(d.getMinutes(), 30);
  assert.equal(r.text, 'standup');
});

test('every monday and wednesday at 5pm', () => {
  const r = parseReminder('gym every monday and wednesday at 5pm', NOW);
  assert.deepEqual(r.rule.days, [1, 3]);
  const d = at(r.due);
  assert.equal(d.getDay(), 1);
  assert.equal(d.getHours(), 17);
});

test('every morning means 9am daily', () => {
  const r = parseReminder('take vitamins every morning', NOW);
  assert.equal(r.rule.type, 'daily');
  assert.equal(at(r.due).getHours(), 9);
  assert.equal(at(r.due).getDate(), 16);
});

test('no time found asks for one', () => {
  const r = parseReminder('remind me to buy cat food', NOW);
  assert.equal(r.due, null);
  assert.equal(r.needsTime, true);
  assert.equal(r.text, 'buy cat food');
});

test('nextOccurrence rolls daily and weekly rules forward', () => {
  const daily = { type: 'daily', hour: 8, minute: 0 };
  assert.equal(at(nextOccurrence(daily, NOW)).getDate(), 16);
  const weekly = { type: 'weekly', days: [4], hour: 11, minute: 0 };
  assert.equal(at(nextOccurrence(weekly, NOW)).getDate(), 15);
  assert.equal(at(nextOccurrence(weekly, NOW + 2 * 3600000)).getDate(), 22);
  const monthly = { type: 'monthly', day: 31, hour: 9, minute: 0 };
  assert.equal(at(nextOccurrence(monthly, NOW)).getDate(), 31);
});
