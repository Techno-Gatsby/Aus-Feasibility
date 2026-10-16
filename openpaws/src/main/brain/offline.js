'use strict';
/*
 * The offline brain: no API key, no network (apart from weather). Pattern-matches the
 * common things people ask a desktop cat and uses the same tools as the AI brain.
 */
const { parseReminder } = require('../services/reminders-core.js');

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const JOKES = [
  'Why did the cat sit on the computer? To keep an eye on the mouse.',
  'What do you call a pile of kittens? A meowntain.',
  'Why are cats bad storytellers? They only have one tale.',
  'What\'s a cat\'s favourite colour? Purr-ple.',
  'How does a cat end a fight? It hiss-solves it.',
  'What do cats like to eat on a hot day? Mice cream.',
];

const HELLO = ['Mrrp! Hi there!', 'Hello, hello! 🐾', 'Oh, it\'s you! My favourite human.', 'Hiya! I was just thinking about snacks. And you.'];
const LOVE = ['I love you too! *slow blink*', 'Purrrr. You\'re my favourite.', '*headbutts your cursor affectionately*'];
const FALLBACK = [
  'Mrrp? I\'m not sure, but I\'m listening. Try "remind me to stretch in 20 minutes" or "what\'s the weather".',
  'Hmm, my cat brain didn\'t catch that. I can do reminders, timers, focus sessions, weather, to-dos and tricks!',
  'I only speak a little human without an AI connected. Want a reminder, a timer, the weather, or a joke?',
];

function moodLine(pet, mood) {
  const s = pet.stats || {};
  if (s.fullness < 25) return 'Honestly? Hungry. Very hungry. Is that a fish I see in your future?';
  if (s.energy < 20) return 'Sleepy... so sleepy. A nap would fix everything.';
  if (s.happiness > 80) return 'Fantastic! Purring at full volume.';
  return `I'm feeling ${mood}. Thanks for asking!`;
}

// Returns { text, emotion, toolCalls: [{name, input}] } before tools run; respond() runs them.
function interpret(input, ctx) {
  const t = String(input || '').trim();
  const l = t.toLowerCase();
  const pet = ctx.pet;
  const userName = ctx.user && ctx.user.name;

  // Remember / forget
  let m = /^(?:please\s+)?(?:remember|note|keep in mind)\s+(?:that\s+)?(.+)/i.exec(t);
  if (m && !/remind/i.test(l)) return { emotion: 'thinking', tool: { name: 'remember', input: { fact: m[1].replace(/^i\b/i, (userName || 'The user')).replace(/\bmy\b/gi, userName ? userName + "'s" : 'their') } }, text: 'Got it, tucked away in my memory. 🧠' };
  m = /^(?:please\s+)?forget\s+(?:that\s+|about\s+)?(.+)/i.exec(t);
  if (m) return { emotion: 'calm', tool: { name: 'forget', input: { fact_or_id: m[1] } }, text: 'Forgotten. *paws at the memory until it rolls under the sofa*' };
  m = /\bmy name is\s+([A-Z][\w'-]+|[a-z][\w'-]+)/i.exec(t) || /\b(?:call me)\s+([\w'-]+)/i.exec(t);
  if (m) return { emotion: 'happy', tool: { name: 'remember', input: { fact: `The user's name is ${m[1][0].toUpperCase() + m[1].slice(1)}` } }, setName: m[1][0].toUpperCase() + m[1].slice(1), text: `Nice to meet you properly, ${m[1][0].toUpperCase() + m[1].slice(1)}! 🐾` };
  m = /\bi (?:really )?(?:love|like|adore|enjoy)\s+(.+)/i.exec(t);
  if (m && m[1].length < 80 && !/\byou\b/.test(m[1])) return { emotion: 'happy', tool: { name: 'remember', input: { fact: `${userName || 'The user'} likes ${m[1].replace(/[.!]+$/, '')}` } }, text: `Ooh, noted: you like ${m[1].replace(/[.!]+$/, '')}. Good taste.` };
  if (/what do you (remember|know) about me/i.test(l)) {
    const facts = ctx.facts || [];
    return { emotion: 'thinking', text: facts.length ? 'Here\'s what I remember:\n' + facts.slice(-8).map((f) => '- ' + f.text).join('\n') : 'Not much yet! Tell me about yourself and I\'ll remember.' };
  }

  // Reminders, timers, focus
  if (/\b(remind|reminder|don'?t let me forget)\b/.test(l) && !/\b(list|show|what are)\b/.test(l)) {
    const r = parseReminder(t, Date.now());
    if (!r || !r.due) return { emotion: 'curious', text: `When should I remind you${r && r.text ? ' to ' + r.text : ''}? Say something like "in 20 minutes" or "tomorrow at 9am".` };
    return { emotion: 'proud', tool: { name: 'create_reminder', input: { text: r.text, when: r.when } }, text: `Okay! I'll remind you to ${r.text} ${r.when}. ⏰` };
  }
  if (/\b(list|show|what are|what's|any)\b.*\breminders?\b/.test(l) || /^reminders\??$/.test(l)) return { emotion: 'thinking', tool: { name: 'list_reminders', input: {} }, render: 'reminders' };
  m = /\b(?:set\s+(?:a\s+)?)?timer\s+(?:for\s+)?(\d+(?:\.\d+)?)\s*(min|minute|minutes|m|hour|hours|h|sec|seconds|s)\b/i.exec(t) || /\b(\d+(?:\.\d+)?)\s*(min|minute|minutes|hour|hours)\s+timer\b/i.exec(t);
  if (m) {
    let minutes = parseFloat(m[1]);
    if (/^h/.test(m[2])) minutes *= 60;
    if (/^s/.test(m[2])) minutes /= 60;
    return { emotion: 'excited', tool: { name: 'start_timer', input: { minutes, label: `${m[1]} ${m[2]} timer` } }, text: `Timer set for ${m[1]} ${m[2]}! I'll keep watch. ⏱️` };
  }
  if (/\b(start|begin)\b.*\b(focus|pomodoro|work session)\b|\bpomodoro\b|\bfocus mode\b|\blet'?s focus\b/.test(l)) {
    const mm = /(\d+)\s*(min|minute)/.exec(l);
    return { emotion: 'calm', tool: { name: 'start_focus', input: { minutes: mm ? parseInt(mm[1], 10) : undefined } }, text: 'Focus time! I\'ll sit right here quietly. You\'ve got this. 🎯' };
  }
  if (/\b(stop|end|cancel)\b.*\b(focus|pomodoro)\b/.test(l)) return { emotion: 'happy', tool: { name: 'stop_focus', input: {} }, text: 'Focus session ended. Good work! Stretch time?' };

  // To-dos
  m = /^(?:add\s+)?(?:to ?do|task)[:\s]+(.+)/i.exec(t) || /^add\s+(.+?)\s+to\s+(?:my\s+)?(?:to ?do|list|tasks)/i.exec(t);
  if (m) return { emotion: 'proud', tool: { name: 'add_todo', input: { text: m[1] } }, text: `Added "${m[1]}" to your to-do list. ✅` };
  if (/\b(show|list|what'?s on)\b.*\b(to ?dos?|tasks|list)\b/.test(l)) return { emotion: 'thinking', tool: { name: 'list_todos', input: {} }, render: 'todos' };
  m = /^(?:done|finished|completed|tick off|check off)\s+(.+)/i.exec(t);
  if (m) return { emotion: 'excited', tool: { name: 'complete_todo', input: { id_or_text: m[1] } }, text: `Nice! "${m[1]}" is done. 🎉` };

  // Weather, calendar, time
  if (/\b(weather|temperature|rain|raining|snow|forecast|umbrella|hot|cold) ?(today|tomorrow|outside)?\b/.test(l) && /\b(weather|forecast|rain|umbrella|temperature|outside|snow)\b/.test(l)) {
    const loc = /\b(?:in|at|for)\s+([A-Z][\w\s-]{2,30})\??$/.exec(t);
    return { emotion: 'curious', tool: { name: 'get_weather', input: loc ? { location: loc[1].trim() } : {} }, render: 'weather' };
  }
  if (/\b(calendar|schedule|meetings?|agenda|what'?s (on )?(today|next))\b/.test(l)) return { emotion: 'thinking', tool: { name: 'get_calendar', input: { hours: /tomorrow/.test(l) ? 48 : 24 } }, render: 'calendar' };
  if (/\bwhat('?s| is) the time\b|\bwhat time is it\b/.test(l)) return { emotion: 'calm', text: `It's ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Nap o'clock, roughly.` };
  if (/\bwhat('?s| is) (the )?(date|day)( today)?\b|\bwhat day is it\b/.test(l)) return { emotion: 'calm', text: `It's ${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}.` };

  // Cat things
  const trickWords = { 'roll over': 'rollover', 'high five': 'highfive', 'high-five': 'highfive', 'play dead': 'playdead', backflip: 'backflip', dance: 'dance', spin: 'spin', wave: 'wave', beg: 'beg', zoomies: 'zoomies', 'make biscuits': 'knead', knead: 'knead', 'slow blink': 'slowblink', sit: 'sit' };
  for (const [w, act] of Object.entries(trickWords)) {
    if (new RegExp(`\\b${w}\\b`).test(l)) return { emotion: 'playful', tool: { name: 'pet_action', input: { action: act } }, text: pick(['Watch this!', 'Ta-da!', 'For you? Anything.', 'Showtime! ✨']), trickName: w };
  }
  if (/\b(go to sleep|take a nap|nap time|sleep)\b/.test(l)) return { emotion: 'sleepy', tool: { name: 'pet_action', input: { action: 'sleep' } }, text: 'Yawwwn... wake me if snacks happen. 😴' };
  if (/\b(scratch)\b/.test(l)) return { emotion: 'playful', tool: { name: 'pet_action', input: { action: 'scratch' } }, text: 'Don\'t mind if I do. *scritch scritch*' };
  if (/\b(go for a walk|go explore|walk off)\b/.test(l)) return { emotion: 'excited', tool: { name: 'pet_action', input: { action: 'walk_off' } }, text: 'Off on an adventure! Back soon. 🐾' };
  if (/\b(joke|funny|make me laugh)\b/.test(l)) return { emotion: 'playful', text: pick(JOKES) };
  if (/\b(i love you|love you|you'?re (so )?(cute|adorable|the best))\b/.test(l)) return { emotion: 'love', text: pick(LOVE) };
  if (/\b(how are you|how do you feel|you ok|are you hungry|are you tired)\b/.test(l)) return { emotion: pet.stats.fullness < 25 ? 'hungry' : pet.stats.energy < 20 ? 'sleepy' : 'happy', text: moodLine(pet, ctx.mood) };
  if (/\b(who are you|what('?s| is) your name)\b/.test(l)) return { emotion: 'proud', text: `I'm ${pet.name}${pet.nickname ? ', also known as ' + pet.nickname : ''}! ${pet.story || 'I live on your screen and keep you company.'}` };
  if (/\b(what can you do|help|commands)\b/.test(l)) return { emotion: 'happy', text: 'I can set reminders ("remind me to call mum at 6pm"), timers, focus sessions, track to-dos, check the weather and your calendar, remember things about you, tell jokes and do tricks. Connect an AI in Settings and I can chat about anything!' };
  if (/\b(sad|tired|stressed|anxious|lonely|bad day|exhausted)\b/.test(l)) return { emotion: 'love', text: pick(['I\'m right here. *curls up next to you* Want me to set a short break reminder?', 'Sending purrs your way. Maybe a glass of water and a stretch? I\'ll stretch with you.']) };
  if (/^(hi|hey|hello|yo|good (morning|afternoon|evening)|meow|mrrp|hiya)\b/.test(l)) return { emotion: 'happy', text: pick(HELLO) + (userName ? ` Hi ${userName}!` : '') };
  if (/\b(thanks|thank you|ty)\b/.test(l)) return { emotion: 'love', text: pick(['Anytime! *purr*', 'You\'re welcome! Treats accepted as payment.']) };
  if (/\b(bye|goodnight|good night|see you)\b/.test(l)) return { emotion: 'sleepy', text: 'Bye for now! I\'ll keep your desktop warm. 🐾' };
  return { emotion: 'curious', text: pick(FALLBACK) };
}

function render(kind, out) {
  if (out && out.error) return out.error;
  switch (kind) {
    case 'weather': return `${out.place}: ${out.now} (feels like ${out.feels_like}).` + (out.forecast && out.forecast[1] ? ` Tomorrow: ${out.forecast[1].condition}, ${out.forecast[1].low}° to ${out.forecast[1].high}°.` : '');
    case 'reminders': return out.reminders.length ? 'Coming up:\n' + out.reminders.slice(0, 6).map((r) => `- ${r.text} (${r.when})`).join('\n') : 'No reminders! Clear skies ahead. ☀️';
    case 'todos': return out.todos.length ? 'Your to-dos:\n' + out.todos.slice(0, 8).map((t) => '- ' + t.text).join('\n') : 'Your to-do list is empty. Nap time? 😺';
    case 'calendar': return out.events.length ? 'On your calendar:\n' + out.events.slice(0, 6).map((e) => `- ${e.title} (${e.start})`).join('\n') : 'Nothing on your calendar. Free as a cat!';
    default: return '';
  }
}

module.exports = { interpret, render, JOKES };
