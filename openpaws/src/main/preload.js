'use strict';
/*
 * The only bridge between the sandboxed pages and the app. Pages can call a fixed list of
 * channels and listen to a fixed list of events; nothing else of Node or Electron leaks in.
 */
const { contextBridge, ipcRenderer } = require('electron');

const SEND = new Set([
  'overlay:ready', 'overlay:interactive', 'overlay:events', 'overlay:petStates', 'overlay:transfer', 'overlay:menu',
  'overlay:contextmenu', 'overlay:openChat', 'overlay:bubble', 'overlay:toastClick',
]);
const INVOKE_PREFIXES = ['state:', 'pet:', 'chat:', 'memory:', 'reminder:', 'todo:', 'focus:', 'wellness:', 'weather:', 'calendar:', 'ms:', 'google:', 'mail:', 'suggestion:', 'ai:', 'secret:', 'cutout:', 'asset:', 'stt:', 'data:', 'app:', 'achievements:', 'import:'];
const EVENTS = new Set([
  'overlay:init', 'overlay:pets', 'overlay:settings', 'overlay:weather', 'overlay:mood', 'overlay:bounds', 'overlay:cursor',
  'overlay:command', 'overlay:say', 'overlay:toast', 'overlay:arrive',
  'state:changed', 'chat:message', 'chat:open', 'ms:status', 'cutout:progress', 'panel:navigate', 'toast',
]);

contextBridge.exposeInMainWorld('paws', {
  platform: process.platform,
  send(ch, data) { if (SEND.has(ch)) ipcRenderer.send(ch, data); },
  invoke(ch, ...args) {
    if (!INVOKE_PREFIXES.some((p) => ch.startsWith(p))) return Promise.reject(new Error('Blocked channel ' + ch));
    return ipcRenderer.invoke(ch, ...args);
  },
  on(ch, cb) {
    if (!EVENTS.has(ch)) return () => {};
    const fn = (_e, data) => cb(data);
    ipcRenderer.on(ch, fn);
    return () => ipcRenderer.removeListener(ch, fn);
  },
});
