'use strict';
/*
 * Claude via the official Anthropic SDK, with a manual tool-use loop.
 * Defaults: claude-opus-5-5 at low effort (chat replies are short), server-side refusal
 * fallbacks enabled on models that support them.
 */
const Anthropic = require('@anthropic-ai/sdk');

const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
const NO_EFFORT = /haiku-4|sonnet-4-5|claude-3/;

function client(apiKey, fetchImpl) { return new Anthropic(Object.assign({ apiKey, maxRetries: 2, timeout: 120000 }, fetchImpl ? { fetch: fetchImpl, maxRetries: 0 } : {})); }

function baseParams(model, effort) {
  const p = { model, max_tokens: 16000 };
  if (!NO_EFFORT.test(model)) p.output_config = { effort: effort || 'low' };
  return p;
}

async function create(c, params) {
  if (FALLBACK_MODELS.has(params.model)) {
    return c.beta.messages.create(Object.assign({}, params, { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }));
  }
  return c.messages.create(params);
}

function friendlyError(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'Your Claude API key was rejected. Check it in Settings > AI.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'This Claude API key is not allowed to use that model.';
  if (e instanceof Anthropic.NotFoundError) return 'That Claude model name was not found. Check Settings > AI.';
  if (e instanceof Anthropic.RateLimitError) return 'Claude is rate-limiting us right now. Try again in a moment.';
  if (e instanceof Anthropic.BadRequestError) return 'Claude rejected the request: ' + (e.message || 'bad request');
  if (e instanceof Anthropic.APIConnectionError) return 'Could not reach Claude. Are you online?';
  if (e instanceof Anthropic.APIError) return `Claude error ${e.status || ''}: ${e.message}`;
  return e && e.message ? e.message : String(e);
}

// messages: [{role, content: string}] ; tools: provider-neutral defs ; run(name, input) -> object
async function chat({ apiKey, model, effort, system, messages, tools, run, maxTurns, fetchImpl }) {
  const c = client(apiKey, fetchImpl);
  const conv = messages.map((m) => ({ role: m.role, content: m.content }));
  const toolDefs = (tools || []).map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  let text = '';
  for (let turn = 0; turn < (maxTurns || 6); turn++) {
    const params = Object.assign(baseParams(model, effort), {
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: conv,
    });
    if (toolDefs.length) params.tools = toolDefs;
    let resp;
    try { resp = await create(c, params); } catch (e) { throw new Error(friendlyError(e)); }
    const blocks = resp.content || [];
    const said = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (said) text = said;
    if (resp.stop_reason === 'refusal') return { text: text || '[calm] Mrrp, let\'s talk about something else.', refused: true };
    if (resp.stop_reason === 'pause_turn') { conv.push({ role: 'assistant', content: blocks }); continue; }
    const uses = blocks.filter((b) => b.type === 'tool_use');
    if (resp.stop_reason !== 'tool_use' || !uses.length) return { text };
    conv.push({ role: 'assistant', content: blocks });
    const results = [];
    for (const u of uses) {
      let out;
      try { out = await run(u.name, u.input || {}); } catch (e) { out = { error: e.message || String(e) }; }
      results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out), is_error: !!(out && out.error) });
    }
    conv.push({ role: 'user', content: results });
  }
  return { text: text || '[thinking] Hmm, that took a lot of thinking. Ask me again?' };
}

// One-shot structured JSON (inbox suggestions, summaries).
async function json({ apiKey, model, prompt, schema, fetchImpl }) {
  const c = client(apiKey, fetchImpl);
  const params = Object.assign(baseParams(model, 'low'), { messages: [{ role: 'user', content: prompt }] });
  params.output_config = Object.assign({}, params.output_config || {}, { format: { type: 'json_schema', schema } });
  let resp;
  try { resp = await create(c, params); } catch (e) { throw new Error(friendlyError(e)); }
  if (resp.stop_reason === 'refusal') return null;
  const t = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(t);
}

async function text({ apiKey, model, prompt, system, fetchImpl }) {
  const c = client(apiKey, fetchImpl);
  const params = Object.assign(baseParams(model, 'low'), { messages: [{ role: 'user', content: prompt }] });
  if (system) params.system = system;
  let resp;
  try { resp = await create(c, params); } catch (e) { throw new Error(friendlyError(e)); }
  return (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}

module.exports = { chat, json, text, friendlyError, FALLBACK_MODELS };
