'use strict';
/*
 * Microsoft 365 (Outlook mail + calendar), read-only, through Microsoft Graph.
 *
 * Sign-in uses the OAuth 2.0 device code flow, so no browser redirect or local server is
 * needed: the app shows a short code, you enter it at microsoft.com/devicelogin, done.
 * You register your own app (free) in Entra ID and paste its Application (client) ID:
 *   App registrations > New > "Accounts in any organizational directory and personal
 *   Microsoft accounts" > Authentication > Allow public client flows: Yes >
 *   API permissions > Microsoft Graph (delegated): User.Read, Mail.Read, Calendars.Read, offline_access.
 * Tokens are stored encrypted by the OS keychain. OpenPaws never sends, moves or deletes mail.
 */

const SCOPES = 'offline_access User.Read Mail.Read Calendars.Read';
const GRAPH = 'https://graph.microsoft.com/v1.0';

class Microsoft {
  constructor(store, secrets, opts) {
    this.store = store;
    this.secrets = secrets;
    this.fetch = (opts && opts.fetch) || globalThis.fetch;
    this.access = null;
    this.accessExp = 0;
    this.pending = null;
  }

  cfg() { return this.store.get('integrations.microsoft'); }
  authority() { return `https://login.microsoftonline.com/${encodeURIComponent(this.cfg().tenant || 'common')}/oauth2/v2.0`; }
  connected() { return !!this.secrets.get('ms.refresh'); }

  // Step 1: get a device code to show the user. Step 2 (poll) runs in the background.
  async begin(onDone) {
    const clientId = (this.cfg().clientId || '').trim();
    if (!clientId) throw new Error('Paste your Microsoft app (client) ID first. The guide is right below the field.');
    const res = await this.fetch(this.authority() + '/devicecode', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, scope: SCOPES }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error_description || j.error || 'Microsoft sign-in failed to start');
    this.pending = { device: j.device_code, interval: (j.interval || 5) * 1000, expires: Date.now() + (j.expires_in || 900) * 1000 };
    this.poll(clientId, onDone);
    return { userCode: j.user_code, verificationUri: j.verification_uri, message: j.message, expiresIn: j.expires_in };
  }

  async poll(clientId, onDone) {
    const p = this.pending;
    if (!p) return;
    while (this.pending === p && Date.now() < p.expires) {
      await new Promise((r) => setTimeout(r, p.interval));
      if (this.pending !== p) return;
      try {
        const res = await this.fetch(this.authority() + '/token', {
          method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: clientId, device_code: p.device }),
        });
        const j = await res.json();
        if (res.ok) {
          this.saveTokens(j);
          this.pending = null;
          const me = await this.graph('/me?$select=displayName,mail,userPrincipalName');
          this.store.update('integrations.microsoft', { account: { name: me.displayName, email: me.mail || me.userPrincipalName }, connectedAt: Date.now() });
          onDone && onDone(null, me);
          return;
        }
        if (j.error === 'authorization_pending') continue;
        if (j.error === 'slow_down') { p.interval += 5000; continue; }
        this.pending = null;
        onDone && onDone(new Error(j.error_description || j.error));
        return;
      } catch (e) {
        // Network blip: keep polling until the code expires.
      }
    }
    if (this.pending === p) { this.pending = null; onDone && onDone(new Error('The sign-in code expired. Try again.')); }
  }

  cancel() { this.pending = null; }

  saveTokens(j) {
    this.access = j.access_token;
    this.accessExp = Date.now() + ((j.expires_in || 3600) - 60) * 1000;
    if (j.refresh_token) this.secrets.set('ms.refresh', j.refresh_token);
  }

  async token() {
    if (this.access && Date.now() < this.accessExp) return this.access;
    const refresh = this.secrets.get('ms.refresh');
    if (!refresh) throw new Error('Microsoft 365 is not connected');
    const res = await this.fetch(this.authority() + '/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: this.cfg().clientId, refresh_token: refresh, scope: SCOPES }),
    });
    const j = await res.json();
    if (!res.ok) {
      if (j.error === 'invalid_grant') this.disconnect();
      throw new Error(j.error_description || 'Microsoft sign-in expired. Connect again in Integrations.');
    }
    this.saveTokens(j);
    return this.access;
  }

  async graph(path, headers) {
    const tok = await this.token();
    const res = await this.fetch(GRAPH + path, { headers: Object.assign({ authorization: 'Bearer ' + tok }, headers || {}) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((j.error && j.error.message) || `Microsoft Graph error ${res.status}`);
    return j;
  }

  disconnect() {
    this.secrets.set('ms.refresh', '');
    this.access = null;
    this.store.update('integrations.microsoft', { account: null, connectedAt: 0 });
  }

  // Recent mail, newest first: subject, sender, received time and a short preview only.
  async recentMail(days, limit) {
    const since = new Date(Date.now() - (days || 3) * 86400000).toISOString();
    const q = `/me/mailFolders/inbox/messages?$top=${limit || 25}&$orderby=receivedDateTime desc&$filter=receivedDateTime ge ${since}`
      + '&$select=id,subject,from,receivedDateTime,bodyPreview,importance,isRead,webLink';
    const j = await this.graph(q);
    return (j.value || []).map((m) => ({
      id: 'ms:' + m.id, provider: 'outlook', subject: m.subject || '(no subject)',
      from: m.from && m.from.emailAddress ? (m.from.emailAddress.name || m.from.emailAddress.address) : '',
      fromAddress: m.from && m.from.emailAddress ? m.from.emailAddress.address : '',
      date: m.receivedDateTime, preview: (m.bodyPreview || '').slice(0, 400), important: m.importance === 'high', unread: !m.isRead, link: m.webLink,
    }));
  }

  async searchMail(query, limit) {
    const j = await this.graph(`/me/messages?$top=${limit || 8}&$search="${encodeURIComponent(String(query).replace(/"/g, ''))}"&$select=id,subject,from,receivedDateTime,bodyPreview,webLink`, { ConsistencyLevel: 'eventual' });
    return (j.value || []).map((m) => ({ provider: 'outlook', subject: m.subject, from: m.from && m.from.emailAddress ? m.from.emailAddress.name : '', date: m.receivedDateTime, preview: (m.bodyPreview || '').slice(0, 240), link: m.webLink }));
  }

  async events(days) {
    const start = new Date().toISOString();
    const end = new Date(Date.now() + (days || 2) * 86400000).toISOString();
    const j = await this.graph(`/me/calendarView?startDateTime=${start}&endDateTime=${end}&$top=50&$orderby=start/dateTime&$select=id,subject,start,end,location,isAllDay,onlineMeeting,webLink`, { Prefer: 'outlook.timezone="UTC"' });
    return (j.value || []).map((e) => ({
      id: 'ms:' + e.id, source: 'Outlook', title: e.subject || '(busy)',
      start: Date.parse(e.start.dateTime + 'Z'), end: Date.parse(e.end.dateTime + 'Z'), allDay: !!e.isAllDay,
      location: e.location && e.location.displayName, link: (e.onlineMeeting && e.onlineMeeting.joinUrl) || e.webLink,
    }));
  }
}

module.exports = { Microsoft, SCOPES };
