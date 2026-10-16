'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { backend } = require('./helpers.js');
const anthropic = require('../src/main/brain/anthropic.js');
const openai = require('../src/main/brain/openai.js');
const Tools = require('../src/main/brain/tools.js');
const P = require('../src/main/brain/prompts.js');

test('offline: reminders, timers, todos, memory, tricks, jokes', async () => {
  const b = backend();
  let r = await b.brain.chat(b.cat.id, 'remind me to feed the cat in 15 minutes');
  assert.match(r.text, /remind you to feed the cat in 15 minutes/);
  assert.equal(b.scheduler.list().length, 1);
  r = await b.brain.chat(b.cat.id, 'set a timer for 5 minutes');
  assert.match(r.text, /Timer set/);
  assert.equal(b.scheduler.list().filter((x) => x.kind === 'timer').length, 1);
  r = await b.brain.chat(b.cat.id, 'todo: buy litter');
  assert.equal(b.scheduler.todos()[0].text, 'buy litter');
  r = await b.brain.chat(b.cat.id, 'my name is Jay');
  assert.equal(b.store.get('user.name'), 'Jay');
  r = await b.brain.chat(b.cat.id, 'remember that my sister is called Priya');
  assert.ok(b.memory.facts().some((f) => /Priya/.test(f.text)));
  r = await b.brain.chat(b.cat.id, 'what do you remember about me?');
  assert.match(r.text, /Priya/);
  r = await b.brain.chat(b.cat.id, 'can you slow blink?');
  assert.deepEqual(r.actions[0], { type: 'trick', trick: 'slowblink' });
  r = await b.brain.chat(b.cat.id, 'roll over');
  assert.match(r.text, /Not learned yet/);
  r = await b.brain.chat(b.cat.id, 'tell me a joke');
  assert.equal(r.emotion, 'playful');
  assert.equal(b.memory.history(b.cat.id).length, 18);
});

test('emotion tags are stripped and become cat moves', () => {
  assert.deepEqual(P.splitEmotion('[love] You are the best.'), { emotion: 'love', text: 'You are the best.' });
  assert.deepEqual(P.splitEmotion('No tag here'), { emotion: null, text: 'No tag here' });
  assert.equal(P.EMOTION_ACTION.love.type, 'slowblink');
});

test('system prompt carries persona and memory, context carries the volatile bits', () => {
  const b = backend();
  b.memory.add('Jay likes jazz', 'chat');
  const pet = b.pets.get(b.cat.id);
  const sys = P.systemPrompt({ pet, user: { name: 'Jay' }, facts: b.memory.facts(), summary: '' });
  assert.match(sys, /You are Clementine/);
  assert.match(sys, /Jay likes jazz/);
  assert.match(sys, /\[happy\]/);
  assert.doesNotMatch(sys, /Now:/);
  const ctx = P.contextBlock({ pet, mood: 'content' });
  assert.match(ctx, /^<context>/);
});

test('claude tool loop through the SDK: request shape, tools, fallbacks and results', async () => {
  const b = backend();
  const bodies = [];
  const replies = [
    { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: 'text', text: 'Let me set that.' }, { type: 'tool_use', id: 'tu_1', name: 'create_reminder', input: { text: 'stretch', when: 'in 20 minutes' } }] },
    { id: 'msg_2', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: 'text', text: '[proud] Done! I will nudge you in 20 minutes.' }] },
  ];
  const fetchImpl = async (url, init) => {
    bodies.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(replies.shift()), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const ctx = { petId: b.cat.id, services: b.services, actions: [] };
  const out = await anthropic.chat({
    apiKey: 'sk-test', model: 'claude-opus-5-5', effort: 'low', system: 'sys', fetchImpl,
    messages: [{ role: 'user', content: 'remind me to stretch in 20 minutes' }],
    tools: Tools.available(b.services), run: (n, i) => Tools.execute(n, i, ctx),
  });
  assert.equal(out.text, '[proud] Done! I will nudge you in 20 minutes.');
  assert.equal(b.scheduler.list().length, 1);
  const first = bodies[0];
  assert.match(first.url, /\/v1\/messages/);
  assert.equal(first.body.model, 'claude-opus-5-5');
  assert.equal(first.body.fallbacks, 'default');
  assert.deepEqual(first.body.output_config, { effort: 'low' });
  const beta = (first.headers instanceof Headers ? first.headers.get('anthropic-beta') : first.headers['anthropic-beta']) || '';
  assert.match(String(beta), /server-side-fallback-2026-07-01/);
  assert.ok(first.body.tools.some((t) => t.name === 'create_reminder' && t.input_schema));
  const second = bodies[1].body;
  const last = second.messages[second.messages.length - 1];
  assert.equal(last.role, 'user');
  assert.equal(last.content[0].type, 'tool_result');
  assert.equal(last.content[0].tool_use_id, 'tu_1');
});

test('openai-compatible tool loop (works for OpenAI, Gemini, Ollama, LM Studio)', async () => {
  const b = backend();
  const replies = [
    { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'add_todo', arguments: '{"text":"vet appointment"}' } }] } }] },
    { choices: [{ message: { role: 'assistant', content: '[happy] Added it!' } }] },
  ];
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push(JSON.parse(init.body)); return new Response(JSON.stringify(replies.shift()), { status: 200 }); };
  const ctx = { petId: b.cat.id, services: b.services, actions: [] };
  const out = await openai.chat({ baseUrl: 'http://localhost:11434/v1', model: 'llama3.2', system: 's', messages: [{ role: 'user', content: 'add vet appointment to my todos' }], tools: Tools.available(b.services), run: (n, i) => Tools.execute(n, i, ctx), fetchImpl });
  assert.equal(out.text, '[happy] Added it!');
  assert.equal(b.scheduler.todos()[0].text, 'vet appointment');
  assert.equal(seen[1].messages[seen[1].messages.length - 1].role, 'tool');
});

test('cloud errors fall back to the offline brain with a note', async () => {
  const b = backend();
  b.store.set('ai.provider', 'anthropic');
  const r = await b.brain.chat(b.cat.id, 'hello');
  assert.match(r.error, /key/i);
  assert.ok(r.text.length > 0);
});
