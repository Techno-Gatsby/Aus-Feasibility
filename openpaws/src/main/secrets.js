'use strict';
/*
 * API keys and OAuth refresh tokens, encrypted with the OS keychain via Electron safeStorage
 * (Keychain on macOS, DPAPI on Windows, libsecret/kwallet on Linux). Kept out of the main
 * data file so backups and exports never contain them.
 */
const fs = require('fs');
const path = require('path');

class Secrets {
  constructor(dir, safeStorage) {
    this.file = path.join(dir, 'openpaws-secrets.json');
    this.safe = safeStorage;
    this.cache = {};
    try { this.raw = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (_) { this.raw = {}; }
  }

  canEncrypt() {
    try { return !!(this.safe && this.safe.isEncryptionAvailable()); } catch (_) { return false; }
  }

  get(key) {
    if (key in this.cache) return this.cache[key];
    const v = this.raw[key];
    if (!v) return '';
    try {
      const val = v.enc && this.canEncrypt()
        ? this.safe.decryptString(Buffer.from(v.data, 'base64'))
        : Buffer.from(v.data, 'base64').toString('utf8');
      this.cache[key] = val;
      return val;
    } catch (_) {
      return '';
    }
  }

  has(key) { return !!this.get(key); }

  set(key, value) {
    delete this.cache[key];
    if (!value) { delete this.raw[key]; this.write(); return; }
    const enc = this.canEncrypt();
    const data = enc ? this.safe.encryptString(String(value)).toString('base64') : Buffer.from(String(value), 'utf8').toString('base64');
    this.raw[key] = { enc, data };
    this.cache[key] = String(value);
    this.write();
  }

  clear(prefix) {
    for (const k of Object.keys(this.raw)) if (!prefix || k.startsWith(prefix)) { delete this.raw[k]; delete this.cache[k]; }
    this.write();
  }

  // Which keys exist, never their values.
  list() { return Object.keys(this.raw); }

  write() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.raw), { mode: 0o600 });
    } catch (_) { /* surfaced by the settings page when a save fails */ }
  }
}

module.exports = { Secrets };
