/*
 * OpenPaws renderer bridge. In Electron, preload exposes window.paws. In a plain browser
 * (the demo page and tests) a small in-memory stand-in is installed instead so every
 * renderer page can run without the app.
 */
(function () {
  'use strict';
  if (window.paws) return;
  const listeners = {};
  const sent = [];
  const handlers = {};
  window.paws = {
    demo: true,
    platform: 'web',
    on(ch, cb) { (listeners[ch] = listeners[ch] || []).push(cb); return () => { listeners[ch] = listeners[ch].filter((f) => f !== cb); }; },
    send(ch, data) { sent.push([ch, data]); if (handlers[ch]) handlers[ch](data); },
    invoke(ch, ...args) { return Promise.resolve(handlers[ch] ? handlers[ch](...args) : null); },
    // Demo helpers
    _emit(ch, data) { (listeners[ch] || []).forEach((f) => f(data)); },
    _handle(ch, fn) { handlers[ch] = fn; },
    _sent: sent,
  };
})();
