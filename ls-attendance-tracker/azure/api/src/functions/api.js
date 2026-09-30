// One HTTP function for the whole API: /api/{*path} → LSAPI core.
// Roles come from Static Web Apps (x-ms-client-principal); worker calls carry a signed PIN token.
const { app } = require('@azure/functions');
const LSAPI = require('../lsapi.js');
const { azureStore } = require('../store-azure.js');

if (!process.env.LS_TOKEN_SECRET || process.env.LS_TOKEN_SECRET.length < 32) console.warn('LS_TOKEN_SECRET is missing or shorter than 32 characters');
const api = LSAPI.create({ store: azureStore(process.env.LS_STORAGE), secret: process.env.LS_TOKEN_SECRET || 'unset' });

function principal(req) {
  const h = req.headers.get('x-ms-client-principal'); if (!h) return null;
  try { return JSON.parse(Buffer.from(h, 'base64').toString('utf8')); } catch (e) { return null; }
}
app.http('api', {
  route: '{*path}', methods: ['GET', 'POST', 'PUT'], authLevel: 'anonymous',
  handler: async (req, ctx) => {
    let body = null;
    if (req.method !== 'GET') { try { body = await req.json(); } catch (e) { body = null; } }
    const r = await api.handle({ method: req.method, path: req.params.path || '', query: Object.fromEntries(req.query.entries()), body, headers: { authorization: req.headers.get('authorization') || '' }, principal: principal(req) });
    if (r.status >= 500) ctx.error(r.body?.error);
    if (r.bytes) return { status: r.status, body: Buffer.from(r.bytes), headers: { 'Content-Type': r.type, 'Cache-Control': 'private, max-age=86400' } };
    return { status: r.status, jsonBody: r.body, headers: { 'Cache-Control': 'no-store' } };
  }
});
