/*
 * OpenPaws sound: synthesized effects (no audio files), "animalese" babble and text-to-speech.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PawsSound = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  let ac = null;
  let master = null;
  let volume = 0.5;
  let enabled = true;
  const lastPlayed = {};

  function ctx() {
    if (!ac) {
      const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return null;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = volume;
      master.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  }

  function setVolume(v) { volume = Math.max(0, Math.min(1, v)); if (master) master.gain.value = volume; }
  function setEnabled(on) { enabled = !!on; }

  function env(g, t0, a, d, peak) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  function tone(freq, dur, type, peak, glideTo, when) {
    const c = ctx(); if (!c) return;
    const t0 = c.currentTime + (when || 0);
    const o = c.createOscillator(); const g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    env(g, t0, Math.min(0.02, dur * 0.2), dur, peak || 0.25);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  function noise(dur, filterFreq, peak, q, when) {
    const c = ctx(); if (!c) return;
    const t0 = c.currentTime + (when || 0);
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = filterFreq || 1200; f.Q.value = q || 1;
    const g = c.createGain(); env(g, t0, 0.01, dur, peak || 0.2);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }

  // A voice-like vowel: sawtooth through two formant filters, pitch contour from a to b.
  function vowel(a, b, dur, f1, f2, peak, when) {
    const c = ctx(); if (!c) return;
    const t0 = c.currentTime + (when || 0);
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(a, t0); o.frequency.exponentialRampToValueAtTime(b, t0 + dur);
    const g = c.createGain(); env(g, t0, 0.03, dur, peak || 0.18);
    const fa = c.createBiquadFilter(); fa.type = 'bandpass'; fa.frequency.value = f1; fa.Q.value = 5;
    const fb = c.createBiquadFilter(); fb.type = 'bandpass'; fb.frequency.value = f2; fb.Q.value = 8;
    const mixg = c.createGain(); mixg.gain.value = 1.6;
    o.connect(fa); o.connect(fb); fa.connect(mixg); fb.connect(mixg); mixg.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  const SFX = {
    pop: () => tone(520, 0.09, 'sine', 0.22, 880),
    hop: () => tone(300, 0.12, 'triangle', 0.12, 620),
    boing: () => { tone(160, 0.35, 'triangle', 0.25, 420); tone(240, 0.3, 'sine', 0.1, 120, 0.05); },
    land: () => noise(0.08, 300, 0.12, 0.8),
    bounce: () => tone(420, 0.06, 'sine', 0.1, 300),
    munch: () => { noise(0.05, 1800, 0.12, 2); noise(0.05, 1300, 0.1, 2, 0.08); },
    squeak: () => tone(1300, 0.12, 'sine', 0.14, 1900),
    chime: () => { tone(880, 0.5, 'sine', 0.22); tone(1320, 0.6, 'sine', 0.16, null, 0.12); tone(1760, 0.8, 'sine', 0.1, null, 0.24); },
    notify: () => { tone(660, 0.18, 'sine', 0.2); tone(990, 0.3, 'sine', 0.18, null, 0.1); },
    success: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'triangle', 0.16, null, i * 0.08)); },
    sparkle: () => { for (let i = 0; i < 5; i++) tone(1500 + Math.random() * 1500, 0.08, 'sine', 0.06, null, i * 0.04); },
    purr: () => {
      const c = ctx(); if (!c) return;
      const t0 = c.currentTime; const dur = 2.0;
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 26;
      const lfo = c.createOscillator(); lfo.frequency.value = 2.2;
      const lg = c.createGain(); lg.gain.value = 0.06;
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.09, t0 + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
      lfo.connect(lg); lg.connect(g.gain);
      o.connect(f); f.connect(g); g.connect(master);
      o.start(t0); lfo.start(t0); o.stop(t0 + dur); lfo.stop(t0 + dur);
    },
    meow: () => vowel(520, 380, 0.45, 800, 1600, 0.16),
    bark: () => { vowel(260, 180, 0.12, 600, 1200, 0.25); noise(0.1, 900, 0.1, 1.2); },
    yip: () => vowel(700, 900, 0.12, 1000, 2200, 0.16),
    huff: () => noise(0.25, 500, 0.12, 0.7),
  };

  function play(name, opts) {
    if (!enabled) return;
    const fn = SFX[name];
    if (!fn) return;
    const now = Date.now();
    const gap = (opts && opts.minGap) || 60;
    if (lastPlayed[name] && now - lastPlayed[name] < gap) return;
    lastPlayed[name] = now;
    try { fn(); } catch (e) { /* audio is decoration; never break the overlay */ }
  }

  // Animalese: one short pitched blip per letter, like a cartoon creature talking.
  function babble(text, opts) {
    if (!enabled) return 0;
    const o = opts || {};
    const base = o.pitch || 420;
    const chars = String(text).replace(/[^a-z0-9 ]/gi, '').toLowerCase().slice(0, 90);
    let t = 0;
    const step = 0.055 / (o.rate || 1);
    for (const ch of chars) {
      if (ch === ' ') { t += step * 0.8; continue; }
      const k = (ch.charCodeAt(0) * 37) % 12;
      const f = base * Math.pow(2, (k - 6) / 24);
      tone(f, step * 0.9, 'triangle', 0.07, f * 1.05, t);
      t += step;
    }
    return t;
  }

  function voices() {
    if (typeof speechSynthesis === 'undefined') return [];
    return speechSynthesis.getVoices().map((v) => ({ name: v.name, lang: v.lang, local: v.localService }));
  }

  // Text-to-speech through the OS voices that Chromium exposes. Returns a promise.
  function speak(text, opts) {
    const o = opts || {};
    return new Promise((resolve) => {
      if (typeof speechSynthesis === 'undefined' || !text) return resolve(false);
      const u = new SpeechSynthesisUtterance(String(text).replace(/[*_#`>]/g, '').slice(0, 600));
      const vs = speechSynthesis.getVoices();
      if (o.voice) { const v = vs.find((x) => x.name === o.voice); if (v) u.voice = v; }
      u.pitch = o.pitch != null ? o.pitch : 1.3;
      u.rate = o.rate != null ? o.rate : 1.05;
      u.volume = Math.min(1, volume * 1.6);
      u.onend = () => resolve(true);
      u.onerror = () => resolve(false);
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    });
  }

  return { play, babble, speak, voices, setVolume, setEnabled, SFX: Object.keys(SFX) };
});
