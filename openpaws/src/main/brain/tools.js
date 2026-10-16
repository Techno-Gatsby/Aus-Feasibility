'use strict';
/*
 * Tools the cat can use while chatting. Provider-neutral JSON Schema definitions plus one
 * executor, shared by Claude, OpenAI-compatible models and the offline brain.
 * No tool can touch files, run programs or send anything on your behalf.
 */
const Species = require('../../renderer/shared/species.js');

const ACTIONS = ['sit', 'wave', 'slowblink', 'knead', 'beg', 'spin', 'zoomies', 'rollover', 'highfive', 'dance', 'playdead', 'backflip', 'jump', 'sleep', 'loaf', 'groom', 'stretch', 'scratch', 'walk_off', 'celebrate'];

const DEFS = [
  { name: 'get_weather', description: 'Current weather and the next days\' forecast. Without a location it uses the user\'s home city.', parameters: { type: 'object', properties: { location: { type: 'string', description: 'City name, optional' } }, additionalProperties: false } },
  { name: 'create_reminder', description: 'Set a reminder. "when" is natural language, e.g. "in 20 minutes", "tomorrow at 9am", "friday 3pm", "every weekday at 9:30", "every 45 minutes".', parameters: { type: 'object', properties: { text: { type: 'string', description: 'What to remind about, short' }, when: { type: 'string' } }, required: ['text', 'when'], additionalProperties: false } },
  { name: 'list_reminders', description: 'List upcoming reminders and timers.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'complete_reminder', description: 'Mark a reminder done, by id or by words from its text.', parameters: { type: 'object', properties: { id_or_text: { type: 'string' } }, required: ['id_or_text'], additionalProperties: false } },
  { name: 'cancel_reminder', description: 'Delete a reminder, by id or by words from its text.', parameters: { type: 'object', properties: { id_or_text: { type: 'string' } }, required: ['id_or_text'], additionalProperties: false } },
  { name: 'snooze_reminder', description: 'Push a reminder back by some minutes.', parameters: { type: 'object', properties: { id_or_text: { type: 'string' }, minutes: { type: 'number' } }, required: ['id_or_text'], additionalProperties: false } },
  { name: 'start_timer', description: 'Start a countdown timer.', parameters: { type: 'object', properties: { minutes: { type: 'number' }, label: { type: 'string' } }, required: ['minutes'], additionalProperties: false } },
  { name: 'start_focus', description: 'Start a focus session (Pomodoro). The cat sits quietly with the user.', parameters: { type: 'object', properties: { minutes: { type: 'number' }, label: { type: 'string' } }, additionalProperties: false } },
  { name: 'stop_focus', description: 'End the current focus session.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'remember', description: 'Save a lasting fact about the user (name, preferences, people, pets, important dates, goals). Not for one-off chit-chat.', parameters: { type: 'object', properties: { fact: { type: 'string', description: 'One short sentence, third person, e.g. "Jay\'s sister is called Priya"' } }, required: ['fact'], additionalProperties: false } },
  { name: 'forget', description: 'Remove a saved fact the user asks you to forget.', parameters: { type: 'object', properties: { fact_or_id: { type: 'string' } }, required: ['fact_or_id'], additionalProperties: false } },
  { name: 'add_todo', description: 'Add an item to the user\'s to-do list.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } },
  { name: 'list_todos', description: 'Show the to-do list.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'complete_todo', description: 'Tick off a to-do, by id or words from it.', parameters: { type: 'object', properties: { id_or_text: { type: 'string' } }, required: ['id_or_text'], additionalProperties: false } },
  { name: 'get_calendar', description: 'Upcoming calendar events (Outlook and any connected calendars).', parameters: { type: 'object', properties: { hours: { type: 'number', description: 'How far ahead, default 24' } }, additionalProperties: false } },
  { name: 'search_email', description: 'Search the user\'s connected inbox (read-only). Returns subjects, senders, dates and short previews.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } },
  { name: 'pet_action', description: 'Do a cat move on screen: ' + ACTIONS.join(', ') + '. Tricks only work if learned.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ACTIONS } }, required: ['action'], additionalProperties: false } },
  { name: 'get_status', description: 'Date and time, focus session state, today\'s focus minutes, and how the cat is feeling (needs).', parameters: { type: 'object', properties: {}, additionalProperties: false } },
];

function fmtTime(ms) { return new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' }); }

// ctx: { petId, services: { weather, scheduler, memory, calendar, wellness, pets, microsoft, google }, actions: [] }
async function execute(name, input, ctx) {
  const sv = ctx.services;
  const a = input || {};
  switch (name) {
    case 'get_weather': {
      let w;
      if (a.location) {
        const found = await sv.weather.search(a.location);
        if (!found.length) return { error: `I couldn't find "${a.location}"` };
        w = await sv.weather.current(true, found[0]);
      } else w = await sv.weather.current(false);
      if (!w) return { error: 'No home location set. Ask the user for their city, or they can set it in Settings.' };
      return { place: w.place, now: `${w.temp}${w.unit}, ${w.label}`, feels_like: `${w.feels}${w.unit}`, wind: `${w.wind} ${w.windUnit}`, forecast: w.days.map((d) => ({ date: d.date, condition: d.condition, high: d.max, low: d.min, rain_chance: d.rainChance })) };
    }
    case 'create_reminder': {
      const res = sv.scheduler.add({ input: `${a.text} ${a.when}` });
      if (!res.ok) {
        const alt = sv.scheduler.add({ input: `remind me to ${a.text} ${a.when}` });
        if (!alt.ok) return { error: `I couldn't understand the time "${a.when}". Try something like "in 20 minutes" or "tomorrow at 9am".` };
        ctx.actions.push({ type: 'trick', trick: 'sit' });
        return { ok: true, id: alt.reminder.id, text: alt.reminder.text, when: alt.when };
      }
      return { ok: true, id: res.reminder.id, text: res.reminder.text, when: res.when, repeats: !!res.reminder.rule };
    }
    case 'list_reminders': {
      const list = sv.scheduler.list().filter((r) => !r.done).slice(0, 15);
      return { reminders: list.map((r) => ({ id: r.id, text: r.text, when: fmtTime(r.due), repeats: !!r.rule, kind: r.kind })) };
    }
    case 'complete_reminder': { const r = sv.scheduler.complete(a.id_or_text); return r ? { ok: true, text: r.text } : { error: 'No matching reminder' }; }
    case 'cancel_reminder': { const r = sv.scheduler.find(a.id_or_text); if (!r) return { error: 'No matching reminder' }; sv.scheduler.remove(r.id); return { ok: true, removed: r.text }; }
    case 'snooze_reminder': { const r = sv.scheduler.snooze(a.id_or_text, a.minutes || 10); return r ? { ok: true, text: r.text, until: fmtTime(r.due) } : { error: 'No matching reminder' }; }
    case 'start_timer': {
      const m = Number(a.minutes);
      if (!(m > 0 && m <= 24 * 60)) return { error: 'Timers can be 1 minute to 24 hours' };
      const res = sv.scheduler.addTimer(m, a.label);
      return { ok: true, ends: fmtTime(res.reminder.due) };
    }
    case 'start_focus': { const f = sv.wellness.startFocus(a.minutes, a.label); ctx.actions.push({ type: 'focus' }); return { ok: true, until: fmtTime(f.endsAt) }; }
    case 'stop_focus': { const f = sv.wellness.stopFocus(false); return f ? { ok: true } : { error: 'No focus session running' }; }
    case 'remember': { const f = sv.memory.add(a.fact, 'chat', ctx.petId); return f ? { ok: true, saved: f.text } : { ok: true, note: 'Already known' }; }
    case 'forget': { const f = sv.memory.forget(a.fact_or_id); return f ? { ok: true, forgot: f.text } : { error: 'Nothing matching to forget' }; }
    case 'add_todo': { const t = sv.scheduler.addTodo(a.text); return { ok: true, id: t.id, text: t.text }; }
    case 'list_todos': return { todos: sv.scheduler.todos().filter((t) => !t.done).map((t) => ({ id: t.id, text: t.text })) };
    case 'complete_todo': { const t = sv.scheduler.completeTodo(a.id_or_text); return t ? { ok: true, done: t.text } : { error: 'No matching to-do' }; }
    case 'get_calendar': {
      const evs = sv.calendar.upcoming(a.hours || 24);
      if (!evs.length && !sv.calendar.feeds().length && !(sv.microsoft && sv.microsoft.connected())) return { error: 'No calendar connected. The user can add one under Integrations.' };
      return { events: evs.slice(0, 20).map((e) => ({ title: e.title, start: e.allDay ? 'all day' : fmtTime(e.start), location: e.location || undefined, source: e.source })) };
    }
    case 'search_email': {
      const out = [];
      if (sv.microsoft && sv.microsoft.connected()) out.push(...await sv.microsoft.searchMail(a.query, 6));
      if (sv.google && sv.google.connected()) out.push(...await sv.google.searchMail(a.query, 6));
      if (!out.length && !(sv.microsoft && sv.microsoft.connected()) && !(sv.google && sv.google.connected())) return { error: 'No inbox connected. The user can connect Outlook or Gmail under Integrations.' };
      return { results: out.slice(0, 10).map((m) => ({ subject: m.subject, from: m.from, date: m.date, preview: m.preview })) };
    }
    case 'pet_action': {
      const act = String(a.action || '');
      if (!ACTIONS.includes(act)) return { error: 'Unknown move' };
      const trick = Species.trick(act);
      if (trick) {
        const p = sv.pets.get(ctx.petId);
        const prof = p && p.skills && p.skills[act] ? p.skills[act].prof : 0;
        if (prof < Species.LEARNED) return { error: `Not learned yet (needs training in the Control Center, level ${trick.minLevel}+).` };
        ctx.actions.push({ type: 'trick', trick: act });
      } else if (act === 'walk_off') ctx.actions.push({ type: 'walkOff' });
      else ctx.actions.push({ type: act });
      return { ok: true };
    }
    case 'get_status': {
      const p = sv.pets.get(ctx.petId);
      const f = sv.wellness.focusState();
      return {
        now: new Date().toString(),
        focus: f ? { phase: f.phase, ends: fmtTime(f.endsAt) } : null,
        focus_minutes_today: sv.wellness.focusStats().today,
        cat: p ? { mood: sv.pets.mood(p), needs: p.stats, level: p.level, treats: sv.pets.treats() } : null,
      };
    }
    default: return { error: 'Unknown tool ' + name };
  }
}

function available(services) {
  const mailOn = (services.microsoft && services.microsoft.connected()) || (services.google && services.google.connected());
  return DEFS.filter((d) => d.name !== 'search_email' || mailOn);
}

module.exports = { DEFS, ACTIONS, execute, available };
