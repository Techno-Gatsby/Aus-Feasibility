'use strict';
/*
 * Gmail, read-only (gmail.readonly scope), for memory and reminder suggestions.
 * Desktop OAuth with PKCE and a one-shot loopback redirect on 127.0.0.1 (Google's
 * recommended flow for installed apps). Bring your own OAuth client: Google Cloud Console >
 * APIs & Services > Credentials > Create OAuth client ID > Desktop app, and enable the Gmail API.
 */
const http = require('http');
const crypto = require('crypto');

const SCOPE = 'openid email https://www.googleapis.com/auth/gmail.readonly';

function b64url(buf) { return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

class Google {
  constructor(store, secrets, opts) {
    this.store = store;
    this.secrets = secrets;
    this.fetch = (opts && opts.fetch) || globalThis.fetch;
    this.openExternal = opts && opts.openExternal;
    this.access = null; this.accessExp = 0;
  }

  cfg() { return this.store.get('integrations.google'); }
  connected() { return !!this.secrets.get('google.refresh'); }

  async connect() {
    const clientId = (this.cfg().clientId || '').trim();
    const clientSecret = this.secrets.get('google.clientSecret');
    if (!clientId) throw new Error('Paste your Google OAuth client ID first.');
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(12));
    const { code, redirectUri } = await new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (u.pathname !== '/') { res.writeHead(404); res.end(); return; }
        const ok = u.searchParams.get('state') === state && u.searchParams.get('code');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<html><body style="font:16px system-ui;padding:40px;text-align:center">${ok ? '🐾 Connected! You can close this tab and go back to OpenPaws.' : 'Sign-in was cancelled.'}</body></html>`);
        server.close();
        if (ok) resolve({ code: u.searchParams.get('code'), redirectUri: `http://127.0.0.1:${server.address().port}` });
        else reject(new Error(u.searchParams.get('error') || 'Sign-in was cancelled'));
      });
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
          client_id: clientId, redirect_uri: `http://127.0.0.1:${port}`, response_type: 'code', scope: SCOPE,
          code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent',
        });
        if (this.openExternal) this.openExternal(url);
      });
      setTimeout(() => { try { server.close(); } catch (_) { /* already closed */ } reject(new Error('Google sign-in timed out')); }, 5 * 60000);
    });
    const body = { code, client_id: clientId, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier };
    if (clientSecret) body.client_secret = clientSecret;
    const res = await this.fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error_description || j.error || 'Google sign-in failed');
    this.save(j);
    const prof = await this.api('/gmail/v1/users/me/profile');
    this.store.update('integrations.google', { account: { email: prof.emailAddress }, connectedAt: Date.now() });
    return prof;
  }

  save(j) {
    this.access = j.access_token;
    this.accessExp = Date.now() + ((j.expires_in || 3600) - 60) * 1000;
    if (j.refresh_token) this.secrets.set('google.refresh', j.refresh_token);
  }

  async token() {
    if (this.access && Date.now() < this.accessExp) return this.access;
    const refresh = this.secrets.get('google.refresh');
    if (!refresh) throw new Error('Gmail is not connected');
    const body = { grant_type: 'refresh_token', refresh_token: refresh, client_id: this.cfg().clientId };
    const secret = this.secrets.get('google.clientSecret');
    if (secret) body.client_secret = secret;
    const res = await this.fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
    const j = await res.json();
    if (!res.ok) { if (j.error === 'invalid_grant') this.disconnect(); throw new Error('Gmail sign-in expired. Connect again.'); }
    this.save(j);
    return this.access;
  }

  async api(path) {
    const tok = await this.token();
    const res = await this.fetch('https://gmail.googleapis.com' + path, { headers: { authorization: 'Bearer ' + tok } });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((j.error && j.error.message) || `Gmail error ${res.status}`);
    return j;
  }

  disconnect() {
    this.secrets.set('google.refresh', '');
    this.access = null;
    this.store.update('integrations.google', { account: null, connectedAt: 0 });
  }

  async messages(q, limit) {
    const list = await this.api(`/gmail/v1/users/me/messages?maxResults=${limit || 20}&q=${encodeURIComponent(q)}`);
    const out = [];
    for (const m of (list.messages || []).slice(0, limit || 20)) {
      const full = await this.api(`/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`);
      const h = Object.fromEntries((full.payload && full.payload.headers ? full.payload.headers : []).map((x) => [x.name.toLowerCase(), x.value]));
      out.push({
        id: 'g:' + m.id, provider: 'gmail', subject: h.subject || '(no subject)', from: (h.from || '').replace(/<.*>/, '').trim(),
        fromAddress: (/<([^>]+)>/.exec(h.from || '') || [])[1] || h.from || '', date: h.date ? new Date(h.date).toISOString() : null,
        preview: (full.snippet || '').slice(0, 400), unread: (full.labelIds || []).includes('UNREAD'), important: (full.labelIds || []).includes('IMPORTANT'),
        link: `https://mail.google.com/mail/u/0/#all/${m.id}`,
      });
    }
    return out;
  }

  recentMail(days, limit) { return this.messages(`newer_than:${days || 3}d -category:promotions -category:social`, limit || 20); }
  searchMail(query, limit) { return this.messages(query, limit || 8); }
}

module.exports = { Google, SCOPE };
