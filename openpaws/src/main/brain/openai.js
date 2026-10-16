'use strict';
/*
 * Any OpenAI-compatible chat completions endpoint: OpenAI, Google Gemini (OpenAI-compatible
 * endpoint), Ollama and LM Studio running locally, OpenRouter, Groq, Mistral, and others.
 */

async function post(f, url, apiKey, body, signal) {
  const headers = { 'content-type': 'application/json' };
  if (apiKey) headers.authorization = 'Bearer ' + apiKey;
  const res = await f(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  const raw = await res.text();
  let j = null; try { j = JSON.parse(raw); } catch (_) { j = null; }
  if (!res.ok) {
    const msg = (j && (j.error && (j.error.message || j.error))) || raw.slice(0, 200) || `HTTP ${res.status}`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = res.status;
    throw err;
  }
  return j;
}

function friendly(e, baseUrl) {
  const m = e && e.message ? e.message : String(e);
  if (/ECONNREFUSED|fetch failed|ENOTFOUND/i.test(m)) {
    if (/localhost|127\.0\.0\.1/.test(baseUrl || '')) return `Nothing is answering at ${baseUrl}. Is Ollama / LM Studio running?`;
    return 'Could not reach the AI server. Are you online?';
  }
  if (e && e.status === 401) return 'The API key was rejected. Check it in Settings > AI.';
  if (e && e.status === 404) return 'Model not found. Check the model name in Settings > AI.';
  if (e && e.status === 429) return 'The AI provider is rate-limiting us. Try again shortly.';
  return m;
}

async function chat({ baseUrl, apiKey, model, system, messages, tools, run, maxTurns, fetchImpl }) {
  const f = fetchImpl || globalThis.fetch;
  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const conv = [{ role: 'system', content: system }, ...messages.map((m) => ({ role: m.role, content: m.content }))];
  let toolDefs = (tools || []).map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  let text = '';
  for (let turn = 0; turn < (maxTurns || 6); turn++) {
    const body = { model, messages: conv };
    if (toolDefs.length) { body.tools = toolDefs; body.tool_choice = 'auto'; }
    let j;
    try { j = await post(f, url, apiKey, body); } catch (e) {
      // Some local models do not support tools at all; carry on without them.
      if (toolDefs.length && e.status && e.status >= 400 && e.status < 500 && /tool|function/i.test(e.message)) { toolDefs = []; turn--; continue; }
      throw new Error(friendly(e, baseUrl));
    }
    const msg = j.choices && j.choices[0] && j.choices[0].message;
    if (!msg) throw new Error('The AI server returned an empty answer');
    if (msg.content) text = String(msg.content).trim();
    const calls = msg.tool_calls || [];
    if (!calls.length) return { text };
    conv.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
    for (const call of calls) {
      let args = {};
      try { args = call.function.arguments ? JSON.parse(call.function.arguments) : {}; } catch (_) { args = {}; }
      let out;
      try { out = await run(call.function.name, args); } catch (e) { out = { error: e.message || String(e) }; }
      conv.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(out) });
    }
  }
  return { text: text || '[thinking] Mrrp... I got a bit tangled up. Try again?' };
}

async function json({ baseUrl, apiKey, model, prompt, schema, fetchImpl }) {
  const f = fetchImpl || globalThis.fetch;
  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const body = {
    model,
    messages: [{ role: 'system', content: 'Reply with JSON only, matching the schema you are given.' }, { role: 'user', content: prompt + '\n\nJSON schema:\n' + JSON.stringify(schema) }],
    response_format: { type: 'json_object' },
  };
  let j;
  try { j = await post(f, url, apiKey, body); } catch (e) {
    if (e.status === 400) { delete body.response_format; j = await post(f, url, apiKey, body); } else throw new Error(friendly(e, baseUrl));
  }
  const t = j.choices[0].message.content || '';
  const m = /\{[\s\S]*\}/.exec(t);
  return m ? JSON.parse(m[0]) : null;
}

async function text({ baseUrl, apiKey, model, prompt, system, fetchImpl }) {
  const f = fetchImpl || globalThis.fetch;
  const msgs = []; if (system) msgs.push({ role: 'system', content: system }); msgs.push({ role: 'user', content: prompt });
  try {
    const j = await post(f, baseUrl.replace(/\/+$/, '') + '/chat/completions', apiKey, { model, messages: msgs });
    return (j.choices[0].message.content || '').trim();
  } catch (e) { throw new Error(friendly(e, baseUrl)); }
}

module.exports = { chat, json, text, friendly };
