/* =====================================================================
   Client emails: up to 10 To and 10 CC contacts per client (name,
   designation, email), each preset for which emails they get –
   Timesheet, Reminder, Custom. You write the message; To/CC come from
   the preset and the ticked timesheets / invoice packs of the client's
   projects are attached. It opens in Outlook as a ready draft (.eml) or
   in the default mail app (mailto, no attachments).
   ===================================================================== */
const MAIL_MAX = 10;
const MAIL_TYPES = [['ts', 'Timesheet'], ['rem', 'Reminder'], ['custom', 'Custom']];
const emailOk = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

/* ---------- contacts in the client editor ---------- */
function mailContactRow(kind, x = {}) {
  const g = x.gets || { ts: true, rem: true, custom: true };
  return `<div class="mc-row" data-mc="${kind}"><input type="text" data-mk="name" placeholder="Name" value="${esc(x.name || '')}"><input type="text" data-mk="title" placeholder="Designation" value="${esc(x.title || '')}"><input type="email" data-mk="email" placeholder="email@company.com" value="${esc(x.email || '')}">
    <span class="mc-gets" title="Which emails this person gets by default">${MAIL_TYPES.map(([k, l]) => `<label><input type="checkbox" data-mg="${k}"${g[k] !== false ? ' checked' : ''}>${l}</label>`).join('')}</span><button type="button" class="btn sm bad" data-mcdel title="Remove">✕</button></div>`;
}
function mailContactsHTML(c) {
  const m = c.mail || {}, box = kind => `<div class="mc-box"><div class="mc-h"><b>${kind === 'to' ? 'To' : 'CC'}</b><span class="muted small" data-mcn="${kind}"></span><span class="spacer"></span><button type="button" class="btn sm" data-mcadd="${kind}">+ Add ${kind === 'to' ? 'To' : 'CC'}</button></div><div data-mcl="${kind}">${(m[kind] || []).map(x => mailContactRow(kind, x)).join('')}</div></div>`;
  return `<h3 style="margin:16px 0 4px">Emails</h3><p class="muted small" style="margin:0 0 6px">Up to ${MAIL_MAX} in To and ${MAIL_MAX} in CC. The ticks set who gets each kind of email by default – you can still change it when sending.</p>${box('to')}${box('cc')}`;
}
function bindMailContacts(m) {
  const count = () => ['to', 'cc'].forEach(k => { const n = m.querySelectorAll(`[data-mcl="${k}"] .mc-row`).length; m.querySelector(`[data-mcn="${k}"]`).textContent = n ? `${n} of ${MAIL_MAX}` : 'none yet'; m.querySelector(`[data-mcadd="${k}"]`).disabled = n >= MAIL_MAX; });
  m.querySelectorAll('[data-mcadd]').forEach(b => b.onclick = () => { const l = m.querySelector(`[data-mcl="${b.dataset.mcadd}"]`); l.insertAdjacentHTML('beforeend', mailContactRow(b.dataset.mcadd)); l.lastElementChild.querySelector('[data-mk="name"]').focus(); count(); });
  m.addEventListener('click', e => { const d = e.target.closest('[data-mcdel]'); if (d) { d.closest('.mc-row').remove(); count(); } });
  count();
}
/** read the rows back; false (with a message) when an email is not valid */
function readMailContacts(m) {
  const out = {};
  for (const k of ['to', 'cc']) {
    out[k] = [];
    for (const r of m.querySelectorAll(`[data-mcl="${k}"] .mc-row`)) {
      const v = f => r.querySelector(`[data-mk="${f}"]`).value.trim(), email = v('email').toLowerCase();
      if (!email && !v('name')) continue;
      if (!emailOk(email)) { toast(`Check the email of ${v('name') || 'a ' + k.toUpperCase() + ' contact'}`); r.querySelector('[data-mk="email"]').focus(); return false; }
      out[k].push({ name: v('name'), title: v('title'), email, gets: Object.fromEntries(MAIL_TYPES.map(([t]) => [t, r.querySelector(`[data-mg="${t}"]`).checked])) });
    }
  }
  return out;
}

/* ---------- compose: you write the message; ticked timesheets / invoice packs are attached ---------- */
/** ctx: { clientId?, projectId?, ym?, base? (a timesheet shown in Billing), type? } */
function emailClient(ctx = {}) {
  const pr = ctx.projectId ? IX.proj.get(ctx.projectId) : null;
  const st = { cid: ctx.clientId || pr?.clientId || SEL.client || '', type: ctx.type || 'ts', ym: ctx.base?.from?.slice(0, 7) || ctx.ym || addMonths(ymOf(todayISO()), -1), base: ctx.base || null,
    ts: new Set(pr ? [pr.id] : []), inv: new Set(), edited: false };
  if (!S.clients.length) return toast('Add clients first (Projects & sites → Clients)');
  const clients = [...S.clients].sort((a, b) => a.name.localeCompare(b.name));
  const m = openModal('Email', `<div class="form"><label class="f">Client<select id="ml-c">${opts(clients.map(c => [c.id, c.name]), st.cid, '— choose client —')}</select></label>
      <label class="f">Month<input type="month" id="ml-ym" value="${st.ym}"></label>
      <label class="f">Recipients for<span class="seg mail-types">${MAIL_TYPES.map(([k, l]) => `<button type="button" data-mt="${k}">${l}</button>`).join('')}</span></label></div>
    <div id="ml-people"></div>
    <label class="f" style="margin-top:8px">Other emails <span class="muted small">(comma separated, To)</span><input type="text" id="ml-extra"></label>
    <div class="ml-att"><div class="row"><b>Attachments</b><span class="muted small" id="ml-attn"></span><span class="spacer"></span><button type="button" class="btn sm" data-all="ts">All timesheets</button><button type="button" class="btn sm" data-all="inv">All invoices</button><button type="button" class="btn sm" data-all="none">Clear</button></div><div id="ml-projs"></div></div>
    <label class="f">Subject<input type="text" id="ml-s"></label>
    <label class="f">Message<textarea id="ml-b" rows="8" placeholder="Write your message…"></textarea></label>
    <div class="row small" style="gap:14px;margin-top:6px"><label><input type="checkbox" id="ml-mts" checked> Set “Submission to client” in the Tracker for the timesheets</label><label><input type="checkbox" id="ml-mi" checked> Set “Invoice submission to client” for the invoices</label></div>`,
    [{ label: 'Cancel' }, { label: 'Mail app (no attachments)', onClick: mm => send(mm, false) }, { label: 'Open in Outlook', cls: 'pri', onClick: mm => send(mm, true) }], { width: '820px' });
  const q = s => $(s, m);
  let people = [];
  const projs = () => S.projects.filter(p => p.clientId === st.cid).sort((a, b) => a.name.localeCompare(b.name));
  const invOf = pid => invFor(pid, st.ym);
  const subject = () => {
    const ps = projs().filter(p => st.ts.has(p.id) || st.inv.has(p.id)), c = IX.client.get(st.cid);
    const what = [st.ts.size ? 'Timesheet' : '', st.inv.size ? 'Invoice' : ''].filter(Boolean).join(' & ') || (st.type === 'rem' ? 'Timesheet' : '');
    const who = ps.length === 1 ? ps[0].trackerName || ps[0].name : c?.name || '';
    return `${st.type === 'rem' ? 'Reminder: ' : ''}${what ? what + ' – ' : ''}${who}${st.type === 'custom' && !what ? '' : ' – ' + fmtMonYY(st.ym)}`;
  };
  const drawPeople = () => {
    const c = IX.client.get(st.cid);
    people = c ? [...(c.mail?.to || []).map(x => ({ ...x, cc: false })), ...(c.mail?.cc || []).map(x => ({ ...x, cc: true }))] : [];
    q('#ml-people').innerHTML = !c ? '' : people.length ? `<div class="tw mail-people"><table><thead><tr><th>Name</th><th>Designation</th><th>Email</th><th class="c">To</th><th class="c">CC</th></tr></thead><tbody>
      ${people.map((x, i) => { const on = (x.gets || {})[st.type] !== false; return `<tr><td>${esc(x.name)}</td><td class="muted">${esc(x.title || '')}</td><td>${esc(x.email)}</td><td class="c"><input type="checkbox" data-to="${i}"${on && !x.cc ? ' checked' : ''}></td><td class="c"><input type="checkbox" data-cc="${i}"${on && x.cc ? ' checked' : ''}></td></tr>`; }).join('')}</tbody></table></div>`
      : `<p class="muted small">No email contacts for ${esc(c.name)} yet. <button type="button" class="btn sm" id="ml-setup">Add contacts…</button></p>`;
    m.querySelectorAll('[data-to],[data-cc]').forEach(x => x.onchange = () => { const i = x.dataset.to ?? x.dataset.cc, o = q(x.dataset.to != null ? `[data-cc="${i}"]` : `[data-to="${i}"]`); if (x.checked) o.checked = false; });
    q('#ml-setup')?.addEventListener('click', () => { closeModal(); editClient(c.id); });
  };
  const drawProjs = () => {
    const ps = projs();
    q('#ml-projs').innerHTML = !st.cid ? '<p class="muted small">Choose the client.</p>' : ps.length ? `<div class="tw" style="max-height:220px"><table><thead><tr><th>Project</th><th class="c">Timesheet</th><th class="c">Invoice pack</th></tr></thead><tbody>
      ${ps.map(p => { const iv = invOf(p.id); return `<tr><td>${esc(p.name)}</td><td class="c"><input type="checkbox" data-at="${p.id}"${st.ts.has(p.id) ? ' checked' : ''}></td><td class="c">${iv ? `<label class="small"><input type="checkbox" data-ai="${p.id}"${st.inv.has(p.id) ? ' checked' : ''}> ${esc(iv.no || 'saved invoice')}</label>` : '<span class="muted small">no saved invoice</span>'}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="muted small">This client has no projects.</p>';
    m.querySelectorAll('[data-at]').forEach(x => x.onchange = () => { x.checked ? st.ts.add(x.dataset.at) : st.ts.delete(x.dataset.at); upd(); });
    m.querySelectorAll('[data-ai]').forEach(x => x.onchange = () => { x.checked ? st.inv.add(x.dataset.ai) : st.inv.delete(x.dataset.ai); upd(); });
    upd();
  };
  const upd = () => {
    const files = attList(); q('#ml-attn').textContent = files.length ? `${files.length} file(s): ${files.map(f => f.name).join(', ')}` : 'none ticked';
    if (!st.edited) q('#ml-s').value = subject();
  };
  /** the files to attach: one timesheet per ticked project, one pack per ticked invoice (an invoice covering several projects only once) */
  const attList = () => {
    const out = [], seen = new Set();
    for (const p of projs()) {
      if (st.ts.has(p.id)) out.push({ kind: 'ts', p, name: mailAttName(p, { base: st.base?.projectId === p.id ? st.base : null, ym: st.ym }) });
      const iv = st.inv.has(p.id) && invOf(p.id); if (iv && !seen.has(iv.id)) { seen.add(iv.id); out.push({ kind: 'inv', iv, p, name: defaultPackName(iv) }); }
    }
    return out;
  };
  const paintType = () => m.querySelectorAll('[data-mt]').forEach(b => b.classList.toggle('on', b.dataset.mt === st.type));
  m.querySelectorAll('[data-mt]').forEach(b => b.onclick = () => { st.type = b.dataset.mt; paintType(); drawPeople(); upd(); });
  q('#ml-c').onchange = e => { st.cid = e.target.value; st.ts.clear(); st.inv.clear(); st.base = null; drawPeople(); drawProjs(); };
  q('#ml-ym').onchange = e => { st.ym = e.target.value; if (st.base && st.base.from.slice(0, 7) !== st.ym) st.base = null; st.inv.clear(); drawProjs(); };
  m.querySelectorAll('[data-all]').forEach(b => b.onclick = () => { const k = b.dataset.all; if (k === 'none') { st.ts.clear(); st.inv.clear(); } else for (const p of projs()) if (k === 'ts') st.ts.add(p.id); else if (invOf(p.id)) st.inv.add(p.id); drawProjs(); });
  q('#ml-s').oninput = () => st.edited = true;
  paintType(); drawPeople(); drawProjs();
  async function send(mm, outlook) {
    const to = people.filter((x, i) => q(`[data-to="${i}"]`)?.checked), cc = people.filter((x, i) => q(`[data-cc="${i}"]`)?.checked);
    const extra = q('#ml-extra').value.split(/[,;\s]+/).filter(Boolean); if (extra.some(e => !emailOk(e))) { toast('Check the other emails'); return false; }
    to.push(...extra.map(email => ({ email })));
    if (!to.length) { toast('Tick at least one person in To'); return false; }
    const mail = { to, cc, subject: q('#ml-s').value.trim(), body: q('#ml-b').value }, files = attList();
    if (!mail.body.trim() && !confirm('The message is empty. Continue?')) return false;
    try {
      if (outlook) {
        const atts = []; let n = 0;
        for (const f of files) {
          toast(`Preparing attachment ${++n} / ${files.length}…`, 60000);
          if (f.kind === 'ts') atts.push({ name: f.name, type: 'application/pdf', blob: await PDFX.build([{ html: tsSheetHTML(tsView(st.base?.projectId === f.p.id ? st.base : buildTimesheet(f.p.id, st.ym), '')), land: true }]) });
          else atts.push({ name: f.name, type: 'application/pdf', blob: await packBlob(f.iv) });
        }
        downloadBlob(new Blob([await emlFile(mail, atts)], { type: 'message/rfc822' }), `${(mail.subject || 'Email').replace(/[\\/:*?"<>|]/g, '').slice(0, 80)}.eml`);
        toast(`Draft ready${atts.length ? ` with ${atts.length} attachment(s)` : ''} – open the downloaded file; Outlook shows it ready to send`, 7000);
      } else {
        location.href = `mailto:${to.map(x => x.email).join(',')}?${[cc.length ? 'cc=' + encodeURIComponent(cc.map(x => x.email).join(',')) : '', 'subject=' + encodeURIComponent(mail.subject), 'body=' + encodeURIComponent(mail.body)].filter(Boolean).join('&')}`;
        if (files.length) toast('The mail app cannot attach files – use Open in Outlook for attachments', 6000);
      }
    } catch (e) { toast('Could not prepare the email: ' + e.message, 6000); return false; }
    const today = todayISO();
    if (q('#ml-mts').checked) for (const f of files) if (f.kind === 'ts' && !trackCell(f.p.id, st.ym).v.tsSent) trackSet(f.p.id, st.ym, 'tsSent', today);
    if (q('#ml-mi').checked) for (const f of files) if (f.kind === 'inv' && !f.iv.track?.invSent) { f.iv.track ||= {}; f.iv.track.invSent = today; markDirty(); }
    if (curView === 'tracker') renderTracker();
  }
}
const mailAttName = (p, st) => `Timesheet_${(p.trackerName || p.name).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_')}_${st.base && st.base.from.slice(0, 7) === st.ym ? tsLabel(st.base).replace(/[^\w-]+/g, '_') : fmtMonYY(st.ym)}.pdf`;
/** a draft email file: Outlook opens it as a new message (X-Unsent) with the attachments */
async function emlFile(mail, atts = []) {
  const b64u = s => btoa(unescape(encodeURIComponent(s))), word = s => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64u(s)}?=`;
  const addr = xs => xs.map(x => x.name ? `"${word(x.name.replace(/"/g, ''))}" <${x.email}>` : x.email).join(', ');
  const wrap = s => s.replace(/.{1,76}/g, '$&\r\n'), B = 'ls_' + Math.random().toString(36).slice(2);
  const h = [`To: ${addr(mail.to)}`, ...(mail.cc.length ? [`Cc: ${addr(mail.cc)}`] : []), `Subject: ${word(mail.subject)}`, 'X-Unsent: 1', 'MIME-Version: 1.0'];
  const text = ['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(b64u(mail.body.replace(/\r?\n/g, '\r\n')))].join('\r\n');
  if (!atts.length) return [...h, text].join('\r\n');
  const parts = []; for (const a of atts) parts.push(`--${B}`, `Content-Type: ${a.type}; name="${word(a.name)}"`, `Content-Disposition: attachment; filename="${word(a.name)}"`, 'Content-Transfer-Encoding: base64', '', wrap(await b64.enc(a.blob)));
  return [...h, `Content-Type: multipart/mixed; boundary="${B}"`, '', `--${B}`, text, ...parts, `--${B}--`, ''].join('\r\n');
}
