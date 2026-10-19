#!/usr/bin/env node
/* =====================================================================
   LS Attendance Tracker – "Ask Claude" bridge to the Claude CLI on this PC.

   Run:   node tools/claude-bridge.mjs          (keep the window open)
   Needs: Node 18+, and Claude Code installed and signed in
          (npm install -g @anthropic-ai/claude-code, then run `claude` once).

   The tracker page posts the question with a snapshot of its data. The
   bridge writes the snapshot to a private temp folder and keeps one
   `claude -p` engine per chat running there. The engine's only tool is
   run_analysis (a small built-in MCP server): a read-only analysis over
   the snapshot with the page's own helpers; only the analysis results go
   to Claude. Listens on 127.0.0.1 only.

   Options (environment): LS_BRIDGE_PORT (default 8787),
   LS_ORIGINS (extra allowed page origins, comma separated),
   CLAUDE_BIN (path to the claude command), LS_DEBUG=1 (log the engine).
   ===================================================================== */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const PORT = +process.env.LS_BRIDGE_PORT || 8787;
const CLAUDE = process.env.CLAUDE_BIN || 'claude';
const WIN = process.platform === 'win32';
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-ask-claude-'));
const EXTRA = (process.env.LS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
// the tracker opened from a file (origin "null"), from localhost, or from the Azure site
const allowed = o => !o || o === 'null' || EXTRA.includes(o) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o) || /^https:\/\/[\w.-]+\.azurestaticapps\.net$/.test(o);

/* the engine's only tool: a tiny MCP server (stdio, JSON-RPC) whose run_analysis runs Claude's read-only
   analysis with the page's own helpers (D, H) in an isolated context; the snapshot is reloaded when it changes */
const MCP = `import fs from 'node:fs'; import vm from 'node:vm'; import readline from 'node:readline';
const here = f => new URL('./' + f, import.meta.url);
let ctx = null, stamp = 0;
function load() {
  const m = fs.statSync(here('data.json')).mtimeMs; if (ctx && m === stamp) return; stamp = m;
  ctx = vm.createContext({ self: {}, postMessage: x => ctx.__out.push(x), console: { log() {} }, __out: [] });
  vm.runInContext(fs.readFileSync(here('worker.js'), 'utf8'), ctx);
  ctx.__snap = JSON.parse(fs.readFileSync(here('data.json'), 'utf8'));
  vm.runInContext('self.onmessage({ data: { snapshot: __snap } }); __snap = null;', ctx);
}
function run(code) {
  load(); ctx.__out = []; ctx.__code = String(code || '');
  try { vm.runInContext('self.onmessage({ data: { id: 1, code: __code } })', ctx, { timeout: 20000 }); }
  catch (e) { ctx = null; return { ok: false, result: 'Stopped: ' + (e.message || e) + ' – make the analysis simpler.' }; }
  return ctx.__out[0] || { ok: false, result: 'No result' };
}
const TOOL = { name: 'run_analysis', description: 'Run a read-only JavaScript analysis over the tracker data. code is the body of function(D, H) and must return a small JSON-serialisable value. Returns the JSON result or the error.',
  inputSchema: { type: 'object', properties: { purpose: { type: 'string', description: 'One short line shown to the user, e.g. "Visas expiring in November"' }, code: { type: 'string', description: 'Function body using D and H; must end with a return statement' } }, required: ['purpose', 'code'] } };
const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', l => {
  let m; try { m = JSON.parse(l); } catch { return; } if (m.id === undefined) return;
  if (m.method === 'initialize') send(m.id, { protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'ls', version: '1' } });
  else if (m.method === 'tools/list') send(m.id, { tools: [TOOL] });
  else if (m.method === 'tools/call') { const r = run(m.params?.arguments?.code); send(m.id, { content: [{ type: 'text', text: r.result }], isError: !r.ok }); }
  else if (m.method === 'ping') send(m.id, {});
  else process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'not supported' } }) + '\\n');
});
`;
const TOOL_NAME = 'mcp__ls__run_analysis';

const sessions = new Map();          // chat id → { dir, version, model, proc, turn, claudeSession }
const q = a => WIN && /[\s"()&|<>^*]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;
const NOT_FOUND = 'The "claude" command was not found. Install Claude Code (npm install -g @anthropic-ai/claude-code) and sign in, or set CLAUDE_BIN.';

/** One warm engine per chat: `claude -p` reading questions as stream-json, so a question costs no start-up time */
function engine(s) {
  if (s.proc && s.proc.exitCode === null && s.procModel === s.model) return s.proc;
  if (s.proc && s.proc.exitCode === null) s.proc.kill();
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--strict-mcp-config', '--mcp-config', 'mcp.json', '--allowedTools', TOOL_NAME,
    '--disallowedTools', 'Bash', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Edit', 'Write', 'NotebookEdit', 'Task'];
  if (s.model) args.push('--model', s.model);
  if (s.claudeSession) args.push('--resume', s.claudeSession);
  const child = s.proc = spawn(CLAUDE, args.map(q), { cwd: s.dir, shell: WIN, env: { ...process.env, ENABLE_TOOL_SEARCH: 'false' } }); s.procModel = s.model;   // tool loaded up front: no look-up round trip
  let buf = '', err = '';
  child.stdout.on('data', d => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (process.env.LS_DEBUG) console.error('engine:', line.slice(0, 300));
      if (m.session_id) s.claudeSession = m.session_id;
      const send = s.turn?.send; if (!send) continue;
      if (m.type === 'stream_event' && m.event?.type === 'content_block_delta' && m.event.delta?.type === 'text_delta') send({ t: 'text', d: m.event.delta.text });
      else if (m.type === 'assistant') for (const b of m.message?.content || []) {
        if (b.type === 'tool_use' && b.name === TOOL_NAME) send({ t: 'step', id: b.id, purpose: b.input?.purpose || 'Analysing', code: String(b.input?.code ?? JSON.stringify(b.input)) });
        else if (b.type === 'text') send({ t: 'turn' });
      }
      else if (m.type === 'user') for (const b of m.message?.content || []) {
        if (b.type === 'tool_result') send({ t: 'result', id: b.tool_use_id, ok: !b.is_error, result: (Array.isArray(b.content) ? b.content.map(c => c.text || '').join('') : String(b.content || '')).slice(0, 4000) });
      }
      else if (m.type === 'result') s.turn.end({ t: 'done', ok: !m.is_error, text: m.result || '', error: m.is_error ? (m.result || m.subtype) : '' });
    }
  });
  child.stderr.on('data', d => { err = (err + d).slice(-4000); if (process.env.LS_DEBUG) console.error('engine stderr:', String(d).slice(0, 500)); });
  child.on('error', e => s.turn?.end({ t: 'done', ok: false, error: e.code === 'ENOENT' ? NOT_FOUND : e.message }));
  child.on('close', code => { if (s.proc === child) s.proc = null; s.turn?.end({ t: 'done', ok: false, error: (err.trim() || `claude exited with code ${code}`).slice(-800) }); });
  return child;
}

/** POST /data: the page's snapshot + analysis code, once per data version; also starts the engine */
function data(res, { chat, version, model, system, worker, snapshot }) {
  if (!chat || !version || !worker || !snapshot) { res.writeHead(400); return res.end('chat, version, worker and snapshot are needed'); }
  let s = sessions.get(chat);
  if (!s) {
    s = { dir: fs.mkdtempSync(path.join(ROOT, 'chat-')) }; sessions.set(chat, s);
    for (const [k, o] of sessions) if (sessions.size > 3 && k !== chat && !o.turn) { o.proc?.kill(); sessions.delete(k); }   // keep a few chats only
  }
  fs.writeFileSync(path.join(s.dir, 'data.json'), JSON.stringify(snapshot));
  fs.writeFileSync(path.join(s.dir, 'worker.js'), worker);
  fs.writeFileSync(path.join(s.dir, 'mcp.mjs'), MCP);
  fs.writeFileSync(path.join(s.dir, 'mcp.json'), JSON.stringify({ mcpServers: { ls: { command: process.execPath, args: [path.join(s.dir, 'mcp.mjs')] } } }));
  fs.writeFileSync(path.join(s.dir, 'CLAUDE.md'), system || '');
  s.version = version; s.model = model || s.model;
  if (!s.turn) engine(s);
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
}

/** POST /ask: one question to the chat's engine; the answer streams back as NDJSON */
function ask(res, { chat, version, question, model }) {
  const s = sessions.get(chat);
  if (!s || s.version !== version) { res.writeHead(409); return res.end('send the data first'); }
  if (!question) { res.writeHead(400); return res.end('question is needed'); }
  if (s.turn) { res.writeHead(429); return res.end('still answering the previous question'); }
  if (model) s.model = model;
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
  const send = o => res.write(JSON.stringify(o) + '\n');
  s.turn = { send, end: o => { if (process.env.LS_DEBUG) console.error('turn end', s.turn?.send === send, o.t, o.ok); if (s.turn?.send !== send) return; s.turn = null; send(o); res.end(); } };
  res.on('close', () => { if (process.env.LS_DEBUG) console.error('res close', s.turn?.send === send); if (s.turn?.send === send) { s.turn = null; s.proc?.kill(); } });        // page closed mid-answer: stop it
  const child = engine(s);
  child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: question } }) + '\n');
}

http.createServer((req, res) => {
  const o = req.headers.origin;
  if (!allowed(o)) { res.writeHead(403); return res.end('origin not allowed'); }
  res.setHeader('Access-Control-Allow-Origin', o || '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.method === 'GET' && req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true,"bridge":"claude-cli"}'); }
  if (req.method === 'POST' && (req.url === '/ask' || req.url === '/data')) {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > 300e6) req.destroy(); else chunks.push(c); });
    req.on('end', () => { let body; try { body = JSON.parse(Buffer.concat(chunks)); } catch { res.writeHead(400); return res.end('bad JSON'); } (req.url === '/ask' ? ask : data)(res, body); });
    return;
  }
  res.writeHead(404); res.end();
}).listen(PORT, '127.0.0.1', () => console.log(`Assistant bridge ready on http://localhost:${PORT} – keep this window open. (Ctrl+C to stop)`));

const clean = () => { for (const o of sessions.values()) o.proc?.kill(); try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { } process.exit(); };
process.on('SIGINT', clean); process.on('SIGTERM', clean);
