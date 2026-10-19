#!/usr/bin/env node
/* =====================================================================
   LS Attendance Tracker – "Ask Claude" bridge to the Claude CLI on this PC.

   Run:   node tools/claude-bridge.mjs          (keep the window open)
   Needs: Node 18+, and Claude Code installed and signed in
          (npm install -g @anthropic-ai/claude-code, then run `claude` once).

   The tracker page posts the question with a snapshot of its data. The
   bridge writes the snapshot to a private temp folder and runs
   `claude -p` there. Claude can only run `node analyse.mjs`, which runs
   its read-only analysis over the snapshot (same helpers as the page);
   only the analysis results go to Claude. Listens on 127.0.0.1 only.

   Options (environment): LS_BRIDGE_PORT (default 8787),
   LS_ORIGINS (extra allowed page origins, comma separated),
   CLAUDE_BIN (path to the claude command).
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

/* runs one analysis: the page's own worker code (helpers H) in an isolated context, code from stdin */
const ANALYSE = `import fs from 'node:fs'; import vm from 'node:vm';
const code = fs.readFileSync(0, 'utf8');
const out = []; const self = {}; const ctx = vm.createContext({ self, postMessage: m => out.push(m), console: { log() {} } });
vm.runInContext(fs.readFileSync(new URL('./worker.js', import.meta.url), 'utf8'), ctx);
ctx.__snap = JSON.parse(fs.readFileSync(new URL('./data.json', import.meta.url), 'utf8'));
vm.runInContext('self.onmessage({ data: { snapshot: __snap } })', ctx);
ctx.__code = code;
try { vm.runInContext('self.onmessage({ data: { id: 1, code: __code } })', ctx, { timeout: 20000 }); }
catch (e) { out.push({ ok: false, result: 'Stopped: ' + (e.message || e) + ' – make the analysis simpler.' }); }
const r = out[0] || { ok: false, result: 'No result' };
process.stdout.write((r.ok ? '' : 'ERROR: ') + r.result + '\\n'); process.exitCode = r.ok ? 0 : 1;
`;

const sessions = new Map();          // chat id → { dir, claudeSession }
const q = a => WIN && /[\s"()&|<>^*]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;

function ask(req, res, body) {
  const { chat, question, model, system, worker, snapshot } = body;
  if (!question || !worker || !snapshot) { res.writeHead(400); return res.end('question, worker and snapshot are needed'); }
  let s = sessions.get(chat);
  if (!s) { s = { dir: fs.mkdtempSync(path.join(ROOT, 'chat-')) }; sessions.set(chat || crypto.randomUUID(), s); }
  fs.writeFileSync(path.join(s.dir, 'data.json'), JSON.stringify(snapshot));
  fs.writeFileSync(path.join(s.dir, 'worker.js'), worker);
  fs.writeFileSync(path.join(s.dir, 'analyse.mjs'), ANALYSE);
  fs.writeFileSync(path.join(s.dir, 'CLAUDE.md'), system || '');

  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--strict-mcp-config',
    '--allowedTools', 'Bash(node analyse.mjs:*)', '--disallowedTools', 'WebFetch', 'WebSearch', 'Edit', 'Write', 'NotebookEdit', 'Task'];
  if (model) args.push('--model', model);
  if (s.claudeSession) args.push('--resume', s.claudeSession);
  const child = spawn(CLAUDE, args.map(q), { cwd: s.dir, shell: WIN, env: process.env });
  child.stdin.end(question);

  res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
  const send = o => res.write(JSON.stringify(o) + '\n');
  let buf = '', err = '', done = false;
  child.stdout.on('data', d => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.session_id) s.claudeSession = m.session_id;
      if (m.type === 'stream_event' && m.event?.type === 'content_block_delta' && m.event.delta?.type === 'text_delta') send({ t: 'text', d: m.event.delta.text });
      else if (m.type === 'assistant') for (const b of m.message?.content || []) {
        if (b.type === 'tool_use') send({ t: 'step', id: b.id, purpose: b.input?.description || b.name, code: String(b.input?.command || JSON.stringify(b.input)).replace(/^node analyse\.mjs\s*<<-?\s*'?(\w+)'?\n([\s\S]*)\n\1\s*$/, '$2') });
        else if (b.type === 'text') send({ t: 'turn' });
      }
      else if (m.type === 'user') for (const b of m.message?.content || []) {
        if (b.type === 'tool_result') send({ t: 'result', id: b.tool_use_id, ok: !b.is_error, result: (Array.isArray(b.content) ? b.content.map(c => c.text || '').join('') : String(b.content || '')).slice(0, 4000) });
      }
      else if (m.type === 'result') { done = true; send({ t: 'done', ok: !m.is_error, text: m.result || '', error: m.is_error ? (m.result || m.subtype) : '' }); }
    }
  });
  child.stderr.on('data', d => { err += d; });
  child.on('error', e => { send({ t: 'done', ok: false, error: e.code === 'ENOENT' ? `The "claude" command was not found. Install Claude Code (npm install -g @anthropic-ai/claude-code) and sign in, or set CLAUDE_BIN.` : e.message }); done = true; res.end(); });
  child.on('close', code => { if (!done) send({ t: 'done', ok: false, error: (err.trim() || `claude exited with code ${code}`).slice(-800) }); res.end(); });
  res.on('close', () => { if (child.exitCode === null) child.kill(); });
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
  if (req.method === 'POST' && req.url === '/ask') {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > 300e6) req.destroy(); else chunks.push(c); });
    req.on('end', () => { let body; try { body = JSON.parse(Buffer.concat(chunks)); } catch { res.writeHead(400); return res.end('bad JSON'); } ask(req, res, body); });
    return;
  }
  res.writeHead(404); res.end();
}).listen(PORT, '127.0.0.1', () => console.log(`Assistant bridge ready on http://localhost:${PORT} – keep this window open. (Ctrl+C to stop)`));

const clean = () => { try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { } process.exit(); };
process.on('SIGINT', clean); process.on('SIGTERM', clean);
