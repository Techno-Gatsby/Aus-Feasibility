/* =====================================================================
   Who is using the tracker, signing client timesheets, and notices.
   - whoAmI(): the signed-in email. On Azure it comes from the built-in
     login (/.auth/me); until SSO is set up, the email typed once in
     "Your email" (kept in this browser). Only this function changes
     when SSO is added.
   - Signing: Settings → Timesheet signatories lists the emails allowed
     to sign each box. A signature is stored on the sheet's saved
     version; saving a new version later notifies everyone who signed.
   - Notices: shown under the bell for the email they are addressed to;
     shared through the API when it is connected.
   ===================================================================== */
const ME = { email: '', verified: false };
const whoAmI = () => ME.email;
async function initMe() {
  try { ME.email = (localStorage.getItem('ls.me') || '').toLowerCase(); } catch (e) { }
  if (location.protocol.startsWith('http')) try {
    const r = await fetch('/.auth/me', { cache: 'no-store' });
    const u = r.ok ? (await r.json()).clientPrincipal : null;
    if (u?.userDetails?.includes('@')) { ME.email = u.userDetails.toLowerCase(); ME.verified = true; }
  } catch (e) { }
  renderMe();
}
function askMe(then) {
  openModal('Sign in', `<label class="f">Your work email (used for signing timesheets and notifications)<input type="email" id="me-e" value="${esc(ME.email)}" placeholder="name@company.com"></label>
    <p class="muted small">Until company sign-in (SSO) is switched on, this is remembered in this browser. Signing is allowed only for emails listed in Settings → Timesheet signatories.</p>`,
    [{ label: 'Cancel' }, { label: 'Save', cls: 'pri', onClick: m => {
      const v = $('#me-e', m).value.trim().toLowerCase(); if (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { toast('Enter a valid email'); return false; }
      ME.email = v; try { v ? localStorage.setItem('ls.me', v) : localStorage.removeItem('ls.me'); } catch (e) { } renderMe(); if (curView === 'timesheets') renderTimesheets(); then?.();
    } }]);
}
/** menubar: your email + the bell with unread notices */
function renderMe() {
  const box = $('#me-box'); if (!box) return;
  const mine = myNotices(), unread = mine.filter(n => !n.read).length;
  box.innerHTML = `<button class="me-chip" id="me-chip" title="${ME.verified ? 'Signed in' : ME.email ? 'Your email (not verified until company sign-in is set up) – click to change' : 'Sign in with your email to sign timesheets and get notifications'}">${ME.email ? esc(ME.email) : 'Sign in'}</button>
    <button class="tour-btn ico" id="bell-btn" title="Notifications" aria-label="Notifications"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 22a2.2 2.2 0 0 0 2.2-2.2H9.8A2.2 2.2 0 0 0 12 22Zm6.5-6.3V11a6.5 6.5 0 0 0-5.1-6.4V4a1.4 1.4 0 0 0-2.8 0v.6A6.5 6.5 0 0 0 5.5 11v4.7L3.6 17.6v1h16.8v-1Z"/></svg>${unread ? `<span class="bell-n">${unread}</span>` : ''}</button>`;
  $('#me-chip').onclick = e => ME.email ? openMeMenu(e.currentTarget) : askMe();
  $('#bell-btn').onclick = e => openBell(e.currentTarget);
}
function openMeMenu(btn) {
  const dd = $('#dropdown'), pre = sigPreset();
  dd.innerHTML = `<button data-mm="sig"><span>My signature…<br><span class="muted small">${pre ? 'saved – used when you sign' : 'upload or draw it once'}</span></span>${pre ? `<img class="mm-sig" src="${pre.image}" alt="">` : ''}</button><button data-mm="email"><span>Change email…</span></button>`;
  const r = btn.getBoundingClientRect(); dd.style.left = Math.max(8, Math.min(r.left, innerWidth - 268)) + 'px'; dd.style.top = r.bottom + 4 + 'px'; dd.style.width = '260px'; dd.hidden = false;
  dd.querySelector('[data-mm="sig"]').onclick = () => { closeMenu(); dd.style.width = ''; mySignatureDialog(); };
  dd.querySelector('[data-mm="email"]').onclick = () => { closeMenu(); dd.style.width = ''; askMe(); };
}
const myNotices = () => Object.values(S?.notices || {}).filter(n => ME.email && n.to === ME.email).sort((a, b) => b.at < a.at ? -1 : 1);
function openBell(btn) {
  const dd = $('#dropdown'), list = myNotices();
  dd.innerHTML = list.length ? list.slice(0, 30).map(n => `<button data-nt="${n.id}" class="${n.read ? '' : 'unread'}"><span>${esc(n.text)}<br><span class="muted small">${esc(new Date(n.at).toLocaleString())}</span></span></button>`).join('')
    : `<div class="muted small" style="padding:10px 12px;max-width:260px">${ME.email ? 'No notifications.' : 'Set your email (left of the bell) to see notifications meant for you.'}</div>`;
  const r = btn.getBoundingClientRect(); dd.style.left = Math.max(8, r.right - 340) + 'px'; dd.style.top = r.bottom + 4 + 'px'; dd.style.width = '340px'; dd.hidden = false;
  dd.querySelectorAll('[data-nt]').forEach(b => b.onclick = () => {
    const n = S.notices[b.dataset.nt]; n.read = true; markDirty(); closeMenu(); dd.style.width = ''; renderMe();
    if (n.key) { const [pid, from, to] = n.key.split('|'); if (from.endsWith('-01') && to === `${from.slice(0, 7)}-${pad(dim(from.slice(0, 7)))}`) { TV.mode = 'month'; TV.ym = from.slice(0, 7); } else { TV.mode = 'range'; TV.from = from; TV.to = to; } TV.preview = pid; TV.q = ''; TV.all = true; showView('timesheets'); }
  });
}
/** a notice to one email; email delivery can be added here together with SSO */
function notify(to, text, key) {
  const id = uid('n'); S.notices[id] = { id, to, text, key, at: new Date().toISOString(), read: false };
  apiPushNotice?.(S.notices[id]);
}

/* ---------- signing ---------- */
const signerEmails = i => String(S.settings.signatories[i]?.emails || '').split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
const canSign = i => !!ME.email && signerEmails(i).includes(ME.email);
/** Save the sheet as a new version; signers of earlier versions are told it changed */
function tsSaveVersion(base, rows, edited) {
  const key = tsKey(base), prev = S.tsDocs[key], p = IX.proj.get(base.projectId);
  const doc = { projectId: base.projectId, from: base.from, to: base.to, rows, version: (prev?.version || 0) + 1, savedAt: new Date().toISOString(), savedBy: ME.email || '', edited: edited || !!prev?.edited, basis: tsBasis(base), sigs: prev?.sigs || [] };
  S.tsDocs[key] = doc;
  for (const email of new Set(doc.sigs.map(g => g.email))) {
    const g = doc.sigs.filter(x => x.email === email).sort((a, b) => b.version - a.version)[0];
    notify(email, `Timesheet ${p?.name || ''} ${tsLabel(base)} was changed after you signed it (v${g.version} → v${doc.version})${ME.email ? ' by ' + ME.email : ''}. Please review and sign again.`, key);
  }
  apiPushTsDoc?.(doc); markDirty(); renderMe();
  return doc;
}
function tsDropVersion(base) {
  const key = tsKey(base), prev = S.tsDocs[key], p = IX.proj.get(base.projectId); if (!prev) return;
  for (const email of new Set((prev.sigs || []).map(g => g.email))) notify(email, `Timesheet ${p?.name || ''} ${tsLabel(base)} you signed was reset to the attendance${ME.email ? ' by ' + ME.email : ''}; your signature was removed.`, key);
  delete S.tsDocs[key]; apiPushTsDoc?.({ projectId: base.projectId, from: base.from, to: base.to, deleted: true, savedAt: new Date().toISOString() }); markDirty(); renderMe();
}
/** Sign one box with your saved signature, by drawing, or with an uploaded image (background removed); stored on the current version (a version is saved first if the sheet was only generated) */
function signTimesheet(base, slot) {
  if (!ME.email) return askMe(() => signTimesheet(base, slot));
  if (!canSign(slot)) return toast(`${ME.email} is not allowed to sign “${S.settings.signatories[slot].label}”. An admin can add it in Settings → Timesheet signatories.`, 6000);
  const s = S.settings.signatories[slot], pre = sigPreset();
  PTAB.sign = pre ? 'saved' : PTAB.sign && PTAB.sign !== 'saved' ? PTAB.sign : 'draw';
  const m = openModal(`Sign – ${s.label}`, `<p class="muted small" style="margin-top:0">Signing as <b>${esc(ME.email)}</b>${ME.verified ? '' : ' (not verified until company sign-in is set up)'}.</p>
    <label class="f">Name<input type="text" id="sg-n" value="${esc(s.name || '')}"></label>
    <div data-tab="saved" class="sg-saved">${pre ? `<div class="sig-prev"><img src="${pre.image}" alt="Your saved signature"></div><div class="row"><button type="button" class="btn sm" id="sg-my">Change my saved signature…</button></div>`
      : `<p class="muted small">No saved signature for ${esc(ME.email)} yet. Upload a photo of it once (the background is removed) or draw it, and it is used every time you sign.</p><button type="button" class="btn sm pri" id="sg-my">Set up my signature…</button>`}</div>
    <div data-tab="draw">${sigDrawHTML('sg')}<div class="muted small" style="margin-top:4px">Leave empty to sign with your typed name.</div></div>
    <div data-tab="upload">${sigUploadHTML('su')}<label class="sg-keep"><input type="checkbox" id="sg-keep" checked> Save as my signature for next time</label></div>`,
    [{ label: 'Cancel' }, { label: 'Sign', cls: 'pri', onClick: mm => {
      const name = $('#sg-n', mm).value.trim(); if (!name) { toast('Type your name'); return false; }
      const tab = PTAB.sign; let image = '';
      if (tab === 'saved') { image = sigPreset()?.image || ''; if (!image) { toast('No saved signature yet – set it up, or use Draw / Upload'); return false; } }
      else if (tab === 'upload') { image = up.get(); if (!image) { toast('Choose a photo of your signature first'); return false; } if ($('#sg-keep', mm).checked) sigSavePreset(image); }
      else image = dr.get();
      let doc = S.tsDocs[tsKey(base)]; if (!doc) doc = tsSaveVersion(base, docRows(base), false);
      doc.sigs = doc.sigs.filter(g => g.slot !== slot);
      doc.sigs.push({ slot, email: ME.email, name, at: new Date().toISOString(), version: doc.version, image });
      apiPushTsDoc?.(doc); markDirty(); renderTimesheets(); toast('Signed');
    } }], { width: '640px' });
  editorTabs(m, 'sign', [['saved', 'My saved signature'], ['draw', 'Draw'], ['upload', 'Upload image']]);
  const dr = sigBindDraw(m, 'sg'), up = sigBindUpload(m, 'su');
  $('#sg-my', m).onclick = () => mySignatureDialog(() => signTimesheet(base, slot));
  if (!pre) sigFetchPreset().then(() => { if (sigPreset() && m.isConnected && $('#sg-n', m)) { closeModal(); signTimesheet(base, slot); } });
}

/* ---------- month picker: every <input type="month"> shows "July 2026" and opens a small month grid ----------
   The native input stays (hidden) and gets the value + a change event, so existing handlers keep working. */
function enhanceMonthInput(inp) {
  if (inp.dataset.mp) return; inp.dataset.mp = '1';
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'mp-btn';
  const paint = () => { const v = inp.value; btn.innerHTML = `${v ? `${MONTH_FULL[+v.slice(5, 7) - 1][0]}${MONTH_FULL[+v.slice(5, 7) - 1].slice(1).toLowerCase()} ${v.slice(0, 4)}` : 'Pick month'}<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M7 2v2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2Zm-2 7h14v10H5Z"/></svg>`; };
  paint(); inp.hidden = true; inp.after(btn);
  btn.onclick = e => {
    e.stopPropagation(); document.querySelector('.mp-pop')?.remove();
    let y = +(inp.value || todayISO()).slice(0, 4);
    const pop = document.createElement('div'); pop.className = 'mp-pop';
    const draw = () => { pop.innerHTML = `<div class="mp-h"><button type="button" data-y="-1">◀</button><b>${y}</b><button type="button" data-y="1">▶</button></div><div class="mp-g">${MON.map((m, i) => { const v = `${y}-${pad(i + 1)}`; return `<button type="button" data-m="${v}" class="${v === inp.value ? 'on' : ''}${v === todayISO().slice(0, 7) ? ' now' : ''}">${m}</button>`; }).join('')}</div>`;
      pop.querySelectorAll('[data-y]').forEach(b => b.onclick = ev => { ev.stopPropagation(); y += +b.dataset.y; draw(); });
      pop.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { inp.value = b.dataset.m; paint(); pop.remove(); inp.dispatchEvent(new Event('change', { bubbles: true })); }); };
    draw(); document.body.appendChild(pop);
    const r = btn.getBoundingClientRect(); pop.style.left = Math.min(r.left, innerWidth - 230) + 'px'; pop.style.top = r.bottom + 4 + 'px';
    setTimeout(() => document.addEventListener('mousedown', function off(ev) { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', off); } }), 0);
  };
}
new MutationObserver(() => document.querySelectorAll('input[type="month"]:not([data-mp])').forEach(enhanceMonthInput)).observe(document.documentElement, { childList: true, subtree: true });

/* ---------- Getting started: the steps in the order they are done, with what is already set up ---------- */
function guideSteps() {
  const sites = S.sites.length, located = S.sites.filter(x => sitePins(x).length).length, onApp = S.employees.filter(e => e.app?.on).length, c = appCfg();
  const ym = addMonths(ymOf(todayISO()), -1), docs = Object.values(S.tsDocs || {}), signed = docs.filter(d => d.from.startsWith(ym) && d.sigs?.length).length;
  return [
    ['Projects & sites', `${S.projects.length} projects · ${sites} sites`, S.projects.length > 0, 'Add clients, projects and their sites (or import the attendance Excel – it creates them).', () => showView('projects')],
    ['Site locations', `${located} of ${sites} sites have a location`, located > 0, 'Pin each site on the map (or let a supervisor send it from the phone) – check-ins inside the zone are accepted automatically.', () => showView('projects')],
    ['Security personnel', `${S.employees.filter(e => !hasLeft(e)).length} current`, S.employees.length > 0, 'Import the Employee List Excel or add people; allocate each to a site and shift.', () => showView('employees')],
    ['Phone app access', `${onApp} on the app`, onApp > 0, 'Security Personnel → tick people → App access… gives each a PIN and prints a slip with the phone link.', () => showView('employees')],
    ['Publish roster', c.lastPublish ? 'last ' + new Date(c.lastPublish).toLocaleDateString() : 'not yet', !!c.lastPublish, 'Sends people, PINs, sites and zones to the phones. Do it again after changes.', () => showView('app')],
    ['Every day', 'check-ins, review, attendance', null, 'Today shows who is on site; Review lists exceptions to approve; Attendance is filled in from the phones.', () => showView('attendance')],
    ['Month end', `${signed} timesheet(s) signed for ${fmtMonYY(ym)}`, null, 'Billing → Client timesheets: check, edit if needed, sign, print / PDF; then 2 Invoice builds the invoice pack.', () => showView('timesheets')]
  ];
}
const guideHidden = () => { try { return localStorage.getItem('ls.guide') === 'off'; } catch (e) { return false; } };
function guideHTML() {
  if (guideHidden()) return '';
  return `<div class="guide"><div class="guide-h"><b>Getting started</b><span class="muted small">the order to set up and use the tracker – click a step to go there</span><span class="spacer"></span><button class="btn sm" data-guide-off>Hide</button></div>
    <ol class="guide-l">${guideSteps().map(([t, st, ok, tip], i) => `<li data-gs="${i}" title="${esc(tip)}" class="${ok === true ? 'ok' : ok === false ? 'todo' : ''}"><span class="n">${ok === true ? '✓' : i + 1}</span><span><b>${esc(t)}</b><small>${esc(st)}</small></span></li>`).join('')}</ol></div>`;
}
function bindGuide(v) {
  const steps = guideSteps();
  v.querySelectorAll('[data-gs]').forEach(li => li.onclick = () => steps[+li.dataset.gs][4]());
  v.querySelector('[data-guide-off]')?.addEventListener('click', () => { try { localStorage.setItem('ls.guide', 'off'); } catch (e) { } toast('Hidden – Help → Getting started shows it again'); renderAll(); });
}
