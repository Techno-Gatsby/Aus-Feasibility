// Local stand-in for Azure Static Web Apps: serves azure/web and runs the API core in memory.
//   node azure/dev-server.mjs [port]      → http://localhost:4280/  (admin)   /worker/  (phone)
// Roles: every /api/admin and /api/supervisor call is treated as DEV_ROLE (default admin).
// Data is kept in azure/.dev-data-<port>.json between runs. Not for production.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url); const LSAPI = require('../shared/lsapi.js');
const port = +process.argv[2] || 4280, role = process.env.DEV_ROLE || 'admin';
const root = path.join(path.dirname(new URL(import.meta.url).pathname), 'web'), dataFile = path.join(path.dirname(root), `.dev-data-${port}.json`);
const init = fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile, 'utf8')) : null;
let t = null; const store = LSAPI.memoryStore(init, snap => { clearTimeout(t); t = setTimeout(() => fs.writeFileSync(dataFile, JSON.stringify(snap)), 300); });
const api = LSAPI.create({ store, secret: process.env.LS_TOKEN_SECRET || 'dev-secret-dev-secret-dev-secret!' });
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/.auth/me') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ clientPrincipal: { userRoles: ['anonymous', 'authenticated', role], userDetails: 'dev ' + role } })); }
  if (u.pathname.startsWith('/api/')) {
    let raw = ''; for await (const c of req) raw += c;
    const p = u.pathname.slice(5), priv = /^(admin|supervisor)\//.test(p);
    const r = await api.handle({ method: req.method, path: p, query: Object.fromEntries(u.searchParams), body: raw ? JSON.parse(raw) : null, headers: { authorization: req.headers.authorization || '' }, principal: priv ? { userRoles: [role], userDetails: 'dev ' + role } : null });
    if (r.bytes) { res.writeHead(r.status, { 'Content-Type': r.type }); return res.end(Buffer.from(r.bytes)); }
    res.writeHead(r.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(r.body));
  }
  let f = path.join(root, decodeURIComponent(u.pathname)); if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { if (u.pathname === '/worker') { res.writeHead(301, { Location: '/worker/' }); return res.end(); } res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log(`LS dev server: http://localhost:${port}/  ·  worker: http://localhost:${port}/worker/  ·  role ${role}`));
