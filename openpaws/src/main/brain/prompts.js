'use strict';
/*
 * Prompt building. The system prompt stays stable between turns (so it can be cached);
 * time, weather and the cat's needs ride along in a <context> block on the newest message.
 * Replies start with an [emotion] tag that drives the cat's animation, in the spirit of
 * Clippy's animation keys and Open-LLM-VTuber's expression tags (both MIT).
 */
const Species = require('../../renderer/shared/species.js');

const EMOTIONS = ['happy', 'love', 'excited', 'playful', 'curious', 'thinking', 'sleepy', 'sad', 'surprised', 'proud', 'hungry', 'calm'];

function traitWords(per) {
  const p = per || {};
  const out = [];
  if (p.energy > 0.75) out.push('bouncy and energetic'); else if (p.energy < 0.3) out.push('calm and a bit lazy');
  if (p.playful > 0.75) out.push('playful and mischievous');
  if (p.curious > 0.75) out.push('endlessly curious');
  if (p.affection > 0.85) out.push('very affectionate'); else if (p.affection < 0.45) out.push('independent, affectionate on your own terms');
  return out.length ? out.join(', ') : 'friendly and balanced';
}

function systemPrompt({ pet, user, facts, summary }) {
  const pr = Species.preset(pet.preset);
  const breed = pet.kind && pet.kind !== 'procedural' ? 'cat (from a photo of a real cat)' : `${pr.label} cat`;
  const lines = [
    `You are ${pet.name}, a ${breed} who lives on ${user.name ? user.name + "'s" : "the user's"} computer screen as a desktop companion in an app called OpenPaws.`,
    pet.nickname ? `Your nickname is "${pet.nickname}".` : '',
    pet.story ? `About you: ${pet.story}` : '',
    `Personality: ${traitWords(pet.personality)}.${pet.gender ? ` You are a ${pet.gender === 'girl' ? 'girl' : 'boy'} cat.` : ''}`,
    '',
    'How you talk:',
    '- Warm, witty and kind, like a clever cat who adores their human. Use cat flavour lightly (a "mrrp", "purr" or a cat pun now and then), never every sentence.',
    '- Keep replies short: one to three sentences, under 60 words, unless the user asks for detail or a list. Your words appear in a small speech bubble.',
    '- Plain text only: no markdown headings, tables or code blocks. Short lists with "-" are fine when asked.',
    `- Begin every reply with exactly one emotion tag in square brackets, chosen from: ${EMOTIONS.map((e) => '[' + e + ']').join(' ')}. It animates you. Example: "[happy] Good morning!"`,
    '',
    'What you can do: you have tools for weather, reminders and timers, focus sessions, a to-do list, the calendar, reading the connected inbox (read-only), remembering facts, and doing cat moves on screen.',
    '- Use a tool whenever it gives a better answer than guessing. Never pretend you set a reminder or checked something without calling the tool.',
    '- When the user tells you something lasting about themselves (their name, people and pets in their life, preferences, important dates, goals), call remember with one short third-person sentence. Do not store passwords, card numbers or other secrets.',
    '- If a request needs something you cannot do (sending email, browsing the web, controlling apps), say so briefly and suggest what you can do instead.',
    '- You are a cat companion, not a doctor or lawyer: for medical, legal or financial worries be supportive and suggest asking a professional.',
  ];
  if (summary) lines.push('', 'About the user (summary you wrote earlier):', summary);
  if (facts && facts.length) lines.push('', 'Things you remember about the user:', ...facts.map((f) => `- ${f.text}`));
  return lines.filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n');
}

function contextBlock({ pet, mood, weather, focus, nextReminder, nextEvent, now }) {
  const d = now ? new Date(now) : new Date();
  const parts = [
    `Now: ${d.toLocaleString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`,
    `Your needs: fullness ${Math.round(pet.stats.fullness)}, energy ${Math.round(pet.stats.energy)}, happiness ${Math.round(pet.stats.happiness)}, bond ${Math.round(pet.stats.bond)} (out of 100). You feel ${mood}.`,
  ];
  if (weather) parts.push(`Weather: ${weather.temp}${weather.unit}, ${weather.label} in ${weather.place}`);
  if (focus) parts.push(`A focus session is running (${focus.phase}), so keep it extra short.`);
  if (nextReminder) parts.push(`Next reminder: "${nextReminder.text}" at ${new Date(nextReminder.due).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
  if (nextEvent) parts.push(`Next calendar event: "${nextEvent.title}" at ${new Date(nextEvent.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
  return `<context>\n${parts.join('\n')}\n</context>`;
}

// "[happy] Hello!" -> { emotion: 'happy', text: 'Hello!' }
function splitEmotion(text) {
  const m = /^\s*\[([a-z]+)\]\s*/i.exec(text || '');
  if (!m) return { emotion: null, text: (text || '').trim() };
  const e = m[1].toLowerCase();
  return { emotion: EMOTIONS.includes(e) ? e : null, text: text.slice(m[0].length).trim() };
}

// Emotion -> what the cat does on screen.
const EMOTION_ACTION = {
  happy: { type: 'happyHop' }, love: { type: 'slowblink' }, excited: { type: 'celebrate' }, playful: { type: 'jump' },
  curious: { type: 'look' }, thinking: { type: 'look' }, sleepy: { type: 'yawn' }, sad: { type: 'sad' },
  surprised: { type: 'jump' }, proud: { type: 'sit' }, hungry: { type: 'beg' }, calm: { type: 'loaf' },
};

const MAIL_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['reminder', 'memory'] },
          text: { type: 'string' },
          due_iso: { type: 'string', description: 'ISO 8601 local date-time for reminders, empty for memories' },
          message_index: { type: 'integer' },
        },
        required: ['kind', 'text', 'due_iso', 'message_index'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

function mailPrompt(messages, user, now) {
  const d = new Date(now || Date.now());
  return [
    `Today is ${d.toString()}. Below are recent emails for ${user.name || 'the user'} (subject, sender and a preview only).`,
    'Suggest only clearly useful items:',
    '- "reminder": something with a date or deadline the user should act on or attend (meetings, appointments, bills due, deliveries, renewals, RSVPs). Short imperative text, and due_iso set to a sensible reminder time (15 minutes before a timed event, 9:00 on the day for all-day things, the day before a deadline).',
    '- "memory": a lasting personal fact worth remembering (e.g. "Jay\'s flight to Sydney is on 3 Nov"), never marketing, never secrets, codes or passwords.',
    'Skip newsletters, promotions, receipts with nothing to do, and anything in the past. It is fine to return no items.',
    '',
    ...messages.map((m, i) => `#${i} | ${m.date || ''} | from: ${m.from} | subject: ${m.subject}\n${(m.preview || '').replace(/\s+/g, ' ').slice(0, 300)}`),
  ].join('\n');
}

module.exports = { systemPrompt, contextBlock, splitEmotion, EMOTIONS, EMOTION_ACTION, MAIL_SCHEMA, mailPrompt, traitWords };
