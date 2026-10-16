/* OpenPaws chat window. */
(function () {
  'use strict';
  const paws = window.paws;
  if (paws.platform === 'darwin') document.body.classList.add('mac');
  const log = document.getElementById('log');
  const input = document.getElementById('input');
  const form = document.getElementById('form');
  const sel = document.getElementById('petSel');
  const chipsBox = document.getElementById('chips');
  let petId = decodeURIComponent(location.hash.slice(1) || '');
  let pets = [];
  let avatar = null;

  const CHIPS = ['What\'s the weather?', 'Remind me to stretch in 30 minutes', 'Start a focus session', 'What\'s on my calendar?', 'Tell me a joke', 'Do a trick!', 'How are you feeling?'];

  function add(cls, text) {
    const el = document.createElement('div');
    el.className = 'msg ' + cls;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  async function load() {
    const s = await paws.invoke('state:get');
    if (!s || s.error) return;
    pets = s.data.pets;
    if (!pets.find((p) => p.id === petId)) petId = (pets[0] || {}).id;
    sel.innerHTML = '';
    for (const p of pets) { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; o.selected = p.id === petId; sel.appendChild(o); }
    sel.style.display = pets.length > 1 ? '' : 'none';
    const p = pets.find((x) => x.id === petId);
    if (!p) { add('note', 'Adopt a cat first in the Control Center.'); return; }
    document.getElementById('name').textContent = p.name;
    const prov = s.data.ai.provider;
    document.getElementById('sub').textContent = prov === 'offline' ? 'offline brain · connect an AI in Settings for open chat' : `${s.providers[prov].label}`;
    document.title = 'Chat with ' + p.name;
    input.placeholder = `Message ${p.name}…`;
    if (avatar) avatar.destroy();
    avatar = window.PawsPreview.mount(document.getElementById('avatar'), p, { state: 'loaf', lockState: true, scale: 0.5, floorPad: 3 });
    log.innerHTML = '';
    const hist = await paws.invoke('chat:history', petId);
    if (Array.isArray(hist) && hist.length) for (const m of hist.slice(-40)) add(m.role === 'user' ? 'me' : 'cat', m.text);
    else add('cat', `Mrrp! It's me, ${p.name}. Ask me anything, or tell me to remind you about something. 🐾`);
  }

  function chips() {
    chipsBox.innerHTML = '';
    for (const c of CHIPS) { const b = document.createElement('button'); b.type = 'button'; b.textContent = c; b.onclick = () => send(c); chipsBox.appendChild(b); }
  }

  let busy = false;
  async function send(text) {
    const t = String(text || '').trim();
    if (!t || busy || !petId) return;
    busy = true;
    add('me', t);
    input.value = ''; grow();
    const typing = document.createElement('div'); typing.className = 'typing'; typing.innerHTML = '<i></i><i></i><i></i>';
    log.appendChild(typing); log.scrollTop = log.scrollHeight;
    const r = await paws.invoke('chat:send', petId, t);
    typing.remove();
    if (!r || r.error && !r.text) add('err', (r && r.error) || 'Something went wrong');
    else {
      if (r.error) add('err', r.error);
      add('cat', r.text);
    }
    busy = false;
    input.focus();
  }

  function grow() { input.style.height = 'auto'; input.style.height = Math.min(140, input.scrollHeight) + 'px'; }
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); } });
  form.addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });
  sel.addEventListener('change', () => { petId = sel.value; load(); });

  // Push-to-talk: hold the mic, release to transcribe and send.
  const mic = document.getElementById('mic');
  let rec = null; let chunks = [];
  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '' });
      chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        mic.classList.remove('rec');
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        if (blob.size < 2000) return;
        const note = add('note', 'Listening…');
        const text = await paws.invoke('stt:transcribe', await blob.arrayBuffer(), blob.type);
        note.remove();
        if (text && text.error) add('err', text.error);
        else if (text) send(text);
      };
      rec.start();
      mic.classList.add('rec');
    } catch (e) { add('err', 'Microphone not available: ' + e.message); }
  }
  mic.addEventListener('pointerdown', startRec);
  for (const ev of ['pointerup', 'pointerleave']) mic.addEventListener(ev, () => { if (rec && rec.state === 'recording') rec.stop(); });

  paws.on('chat:open', (m) => { if (m && m.petId && m.petId !== petId) { petId = m.petId; load(); } input.focus(); });
  paws.on('state:changed', (m) => { if (m && m.section === 'pets') { const keep = petId; load().then(() => { petId = keep; }); } });

  chips();
  load().then(() => input.focus());
})();
