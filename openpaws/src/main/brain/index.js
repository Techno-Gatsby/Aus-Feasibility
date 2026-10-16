'use strict';
/*
 * The cat's brain: routes a chat message to Claude, an OpenAI-compatible model, or the
 * offline brain; runs tools; keeps history and memory; turns [emotion] tags into moves.
 */
const anthropic = require('./anthropic.js');
const openai = require('./openai.js');
const offline = require('./offline.js');
const Tools = require('./tools.js');
const P = require('./prompts.js');

const PROVIDERS = {
  offline: { label: 'Offline (built-in, no key)' },
  anthropic: { label: 'Claude (Anthropic)', key: 'anthropic.key' },
  openai: { label: 'OpenAI', key: 'openai.key' },
  gemini: { label: 'Google Gemini', key: 'gemini.key' },
  ollama: { label: 'Ollama (local)', key: null },
  custom: { label: 'Custom OpenAI-compatible (LM Studio, OpenRouter, Groq...)', key: 'custom.key' },
};

class Brain {
  constructor(deps) {
    this.d = deps; // { store, secrets, memory, pets, services }
  }

  provider() { return this.d.store.get('ai.provider') || 'offline'; }

  canUseCloud(prov) {
    const p = prov || this.provider();
    if (p === 'offline') return false;
    if (p === 'ollama') return true;
    if (p === 'custom') return !!this.d.store.get('ai.custom.baseUrl');
    return !!this.d.secrets.get(PROVIDERS[p].key);
  }

  cfg(p) {
    const ai = this.d.store.get('ai');
    if (p === 'anthropic') return { model: ai.anthropic.model || 'claude-opus-5-5', effort: ai.anthropic.effort || 'low', apiKey: this.d.secrets.get('anthropic.key') };
    const c = ai[p] || {};
    return { model: c.model, baseUrl: c.baseUrl, apiKey: PROVIDERS[p].key ? this.d.secrets.get(PROVIDERS[p].key) : '' };
  }

  buildContext(pet) {
    const sv = this.d.services;
    const reminders = sv.scheduler.upcoming(24);
    const events = sv.calendar.upcoming(24);
    return P.contextBlock({
      pet, mood: this.d.pets.mood(pet), weather: sv.weather.cache || null, focus: sv.wellness.focusState(),
      nextReminder: reminders[0], nextEvent: events.find((e) => !e.allDay),
    });
  }

  // Returns { text, emotion, actions, provider, error? }
  async chat(petId, message, opts) {
    const o = opts || {};
    const pet = this.d.pets.get(petId);
    if (!pet) throw new Error('No such cat');
    const user = this.d.store.get('user');
    const actions = [];
    const ctx = { petId, services: this.d.services, actions };
    const run = (name, input) => Tools.execute(name, input, ctx);
    const prov = this.provider();
    let result;
    let error = null;
    if (prov !== 'offline' && this.canUseCloud(prov)) {
      try {
        result = await this.cloudChat(prov, pet, user, message, run);
      } catch (e) {
        error = e.message || String(e);
      }
    } else if (prov !== 'offline') {
      error = `Add your ${PROVIDERS[prov].label} key in Settings > AI to chat about anything.`;
    }
    if (!result) result = await this.offlineChat(pet, user, message, run, o);
    const { emotion, text } = P.splitEmotion(result.text);
    if (emotion && P.EMOTION_ACTION[emotion] && !actions.length) actions.push(P.EMOTION_ACTION[emotion]);
    if (!o.ephemeral) {
      this.d.memory.addTurn(petId, 'user', message);
      this.d.memory.addTurn(petId, 'assistant', text);
    }
    const hour = new Date().getHours();
    this.d.pets.count('chat');
    if (hour >= 0 && hour < 4) this.d.pets.count('nightChat');
    this.d.pets.bump(petId, { bond: 1, happiness: 2 }, 2);
    this.d.pets.checkAchievements();
    if (this.d.memory.summaryStale() && this.canUseCloud()) this.refreshSummary().catch(() => {});
    return { text, emotion, actions, provider: result.provider, error };
  }

  async cloudChat(prov, pet, user, message, run) {
    const facts = this.d.memory.relevant(message, 40);
    const system = P.systemPrompt({ pet, user, facts, summary: this.d.memory.summary() });
    const turns = this.d.store.get('ai.historyTurns') || 16;
    const hist = this.d.memory.history(pet.id).slice(-turns).map((h) => ({ role: h.role, content: h.text }));
    // Keep the history valid: it must start with a user turn and alternate.
    while (hist.length && hist[0].role !== 'user') hist.shift();
    const messages = [...hist, { role: 'user', content: `${this.buildContext(pet)}\n\n${message}` }];
    const tools = Tools.available(this.d.services);
    const c = this.cfg(prov);
    let out;
    if (prov === 'anthropic') out = await anthropic.chat({ apiKey: c.apiKey, model: c.model, effort: c.effort, system, messages, tools, run });
    else out = await openai.chat({ baseUrl: c.baseUrl, apiKey: c.apiKey, model: c.model, system, messages, tools, run });
    return { text: out.text, provider: prov };
  }

  async offlineChat(pet, user, message, run, o) {
    const intent = offline.interpret(message, { pet, user, facts: this.d.memory.facts(), mood: this.d.pets.mood(pet) });
    let text = intent.text || '';
    if (intent.tool) {
      const out = await run(intent.tool.name, intent.tool.input);
      if (intent.render) text = offline.render(intent.render, out);
      else if (out && out.error) text = out.error;
      if (intent.tool.name === 'create_reminder' && out && out.when) text = `Okay! I'll remind you to ${out.text} ${out.when}. ⏰`;
    }
    if (intent.setName) this.d.store.update('user', { name: intent.setName });
    void o;
    return { text: `[${intent.emotion || 'happy'}] ${text}`, provider: 'offline' };
  }

  // A one-line pet remark (morning hello, welcome back, reminder flavour) via the AI if
  // available, otherwise the given fallback.
  async remark(petId, situation, fallback) {
    const pet = this.d.pets.get(petId);
    if (!pet || !this.canUseCloud() || this.d.store.get('ai.chatterLevel') === 'quiet') return fallback;
    try {
      const out = await this.simple(`${P.systemPrompt({ pet, user: this.d.store.get('user'), facts: this.d.memory.facts().slice(-15), summary: this.d.memory.summary() })}\n\n${this.buildContext(pet)}`,
        `Write one short line (max 22 words) to say out loud right now. Situation: ${situation}. Start with an emotion tag. If useful, weave in this information: ${fallback}`);
      return out ? P.splitEmotion(out).text : fallback;
    } catch (_) { return fallback; }
  }

  async simple(system, prompt) {
    const prov = this.provider();
    const c = this.cfg(prov);
    if (prov === 'anthropic') return anthropic.text({ apiKey: c.apiKey, model: c.model, prompt, system });
    return openai.text({ baseUrl: c.baseUrl, apiKey: c.apiKey, model: c.model, prompt, system });
  }

  async extractFromMail(messages) {
    const prov = this.provider();
    const c = this.cfg(prov);
    const prompt = P.mailPrompt(messages, this.d.store.get('user'));
    const out = prov === 'anthropic'
      ? await anthropic.json({ apiKey: c.apiKey, model: c.model, prompt, schema: P.MAIL_SCHEMA })
      : await openai.json({ baseUrl: c.baseUrl, apiKey: c.apiKey, model: c.model, prompt, schema: P.MAIL_SCHEMA });
    const items = (out && out.items) || [];
    return items.map((it) => ({
      kind: it.kind === 'memory' ? 'memory' : 'reminder', text: String(it.text || '').slice(0, 200),
      due: it.kind === 'reminder' && it.due_iso ? Date.parse(it.due_iso) || null : null,
      source: messages[it.message_index] || null,
    })).filter((x) => x.text && (x.kind === 'memory' || (x.due && x.due > Date.now())));
  }

  async refreshSummary() {
    const facts = this.d.memory.facts();
    if (!facts.length) return this.d.memory.summary();
    if (!this.canUseCloud()) {
      const text = facts.slice(-12).map((f) => f.text).join(' ');
      this.d.memory.setSummary(text);
      return text;
    }
    const text = await this.simple('You write brief, warm, factual profiles.',
      `Write a 3-5 sentence summary of the user for their desktop cat companion, using only these facts. No speculation.\n\n${facts.map((f) => '- ' + f.text).join('\n')}`);
    this.d.memory.setSummary(text);
    return text;
  }

  async test(prov) {
    const p = prov || this.provider();
    if (p === 'offline') return { ok: true, reply: 'The offline brain is always ready. Mrrp!' };
    if (!this.canUseCloud(p)) return { ok: false, error: 'Missing API key or server address' };
    const c = this.cfg(p);
    try {
      const reply = p === 'anthropic'
        ? await anthropic.text({ apiKey: c.apiKey, model: c.model, prompt: 'Say hello as a cat in five words.' })
        : await openai.text({ baseUrl: c.baseUrl, apiKey: c.apiKey, model: c.model, prompt: 'Say hello as a cat in five words.' });
      return { ok: true, reply };
    } catch (e) { return { ok: false, error: e.message }; }
  }
}

module.exports = { Brain, PROVIDERS };
