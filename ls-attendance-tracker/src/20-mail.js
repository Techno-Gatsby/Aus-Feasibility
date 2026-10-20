/* =====================================================================
   Client emails: up to 10 To and 10 CC contacts per client (name,
   designation, email), each preset for which emails they get –
   Timesheet, Reminder, Custom. Composing fills To/CC from the preset
   and the subject/body from Settings → Email templates; it opens in
   Outlook as a ready draft (.eml, with the timesheet PDF attached) or in
   the default mail app (mailto, no attachment).
   ===================================================================== */
const MAIL_MAX = 10;
const MAIL_TYPES = [['ts', 'Timesheet'], ['rem', 'Reminder'], ['custom', 'Custom']];
const MAIL_TPL0 = {
  ts: { subject: 'Timesheet – {project} – {period}', body: 'Dear {names},\n\nPlease find attached the security services timesheet for {project} for {period}.\n\nKindly review and approve.\n\nRegards,\n{sender}\n{company}' },
  rem: { subject: 'Reminder: timesheet approval – {project} – {period}', body: 'Dear {names},\n\nThis is a gentle reminder about the timesheet for {project} for {period}, sent to you for approval. We would appreciate your approval at the earliest.\n\nRegards,\n{sender}\n{company}' },
  custom: { subject: '', body: 'Dear {names},\n\n\n\nRegards,\n{sender}\n{company}' }
};
const mailTpl = t => ({ ...MAIL_TPL0[t], ...(S.settings.mailTpl?.[t] || {}) });
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

/* ---------- compose ---------- */
function mailFill(s, v) { return String(s || '').replace(/\{(\w+)\}/g, (a, k) => v[k] ?? a); }
/** ctx: { clientId, projectId?, ym? | base?, type? } */
function emailClient(ctx = {}) {
  const pr = ctx.projectId ? IX.proj.get(ctx.projectId) : null, c = IX.client.get(ctx.clientId || pr?.clientId);
  if (!c) return toast('This project has no client – set one in Projects & sites');
  const people = [...(c.mail?.to || []).map(x => ({ ...x, cc: false })), ...(c.mail?.cc || []).map(x => ({ ...x, cc: true }))];
  const projs = S.projects.filter(p => p.clientId === c.id).sort((a, b) => a.name.localeCompare(b.name));
  const st = { type: ctx.type || (ctx.base || pr ? 'ts' : 'custom'), pid: pr?.id || (projs.length === 1 ? projs[0].id : ''), ym: ctx.base?.from?.slice(0, 7) || ctx.ym || addMonths(ymOf(todayISO()), -1), base: ctx.base || null, edited: false };
  const m = openModal(`Email – ${c.name}`, `
    <div class="seg mail-types">${MAIL_TYPES.map(([k, l]) => `<button type="button" data-mt="${k}">${l}</button>`).join('')}</div>
    <div class="form" style="margin-top:10px"><label class="f">Project<select id="ml-p">${opts(projs.map(p => [p.id, p.name]), st.pid, '— choose —')}</select></label><label class="f" id="ml-ymw">Month<input type="month" id="ml-ym" value="${st.ym}"></label></div>
    ${people.length ? `<div class="tw mail-people"><table><thead><tr><th>Name</th><th>Designation</th><th>Email</th><th class="c">To</th><th class="c">CC</th></tr></thead><tbody>
      ${people.map((x, i) => `<tr><td>${esc(x.name)}</td><td class="muted">${esc(x.title || '')}</td><td>${esc(x.email)}</td><td class="c"><input type="checkbox" data-to="${i}"></td><td class="c"><input type="checkbox" data-cc="${i}"></td></tr>`).join('')}</tbody></table></div>`
      : `<p class="muted small">No email contacts for this client yet. <button type="button" class="btn sm" id="ml-setup">Add contacts…</button></p>`}
    <label class="f" style="margin-top:8px">Other emails <span class="muted small">(comma separated, To)</span><input type="text" id="ml-extra"></label>
    <label class="f">Subject<input type="text" id="ml-s"></label>
    <label class="f">Message<textarea id="ml-b" rows="9"></textarea></label>
    <div id="ml-att" class="muted small"></div>
    <label class="small" id="ml-markw" style="display:flex;gap:6px;align-items:center;margin-top:6px"><input type="checkbox" id="ml-mark" checked> Set “Submission to client” in the Tracker to today</label>`,
    [{ label: 'Cancel' }, { label: 'Mail app (no attachment)', onClick: mm => send(mm, false) }, { label: 'Open in Outlook', cls: 'pri', onClick: mm => send(mm, true) }], { width: '760px' });
  const q = s => $(s, m);
  const vars = () => { const p = IX.proj.get(st.pid), to = people.filter((x, i) => q(`[data-to="${i}"]`)?.checked);
    return { client: c.name, project: p?.trackerName || p?.name || '', period: st.base && st.base.from.slice(0, 7) === st.ym ? tsLabel(st.base) : fmtMonth(st.ym), names: to.map(x => x.name).filter(Boolean).join(', ') || 'Sir/Madam', sender: S.settings.preparedBy || ME.email || '', company: S.settings.company || '' }; };
  const fill = () => { const t = mailTpl(st.type), v = vars(); q('#ml-s').value = mailFill(t.subject, v); q('#ml-b').value = mailFill(t.body, v); st.edited = false; };
  const preset = () => people.forEach((x, i) => { const on = (x.gets || {})[st.type] !== false; q(`[data-to="${i}"]`).checked = on && !x.cc; q(`[data-cc="${i}"]`).checked = on && x.cc; });
  const paint = () => {
    m.querySelectorAll('[data-mt]').forEach(b => b.classList.toggle('on', b.dataset.mt === st.type));
    q('#ml-ymw').hidden = st.type === 'custom'; q('#ml-markw').hidden = st.type !== 'ts';
    const p = IX.proj.get(st.pid); q('#ml-att').innerHTML = st.type === 'ts' ? (p ? `📎 ${esc(mailAttName(p, st))} – the timesheet as it prints (latest saved version, with signatures). Outlook only; the mail app cannot attach files.` : 'Choose the project to attach its timesheet.') : '';
  };
  m.querySelectorAll('[data-mt]').forEach(b => b.onclick = () => { if (st.edited && !confirm('Replace your text with the template?')) return; st.type = b.dataset.mt; preset(); fill(); paint(); });
  q('#ml-p').onchange = e => { st.pid = e.target.value; if (st.base?.projectId !== st.pid) st.base = null; if (!st.edited) fill(); paint(); };
  q('#ml-ym').onchange = e => { st.ym = e.target.value; if (st.base && st.base.from.slice(0, 7) !== st.ym) st.base = null; if (!st.edited) fill(); paint(); };
  m.querySelectorAll('[data-to],[data-cc]').forEach(x => x.onchange = () => { const i = x.dataset.to ?? x.dataset.cc, o = q(x.dataset.to != null ? `[data-cc="${i}"]` : `[data-to="${i}"]`); if (x.checked) o.checked = false; if (!st.edited) fill(); });
  q('#ml-s').oninput = q('#ml-b').oninput = () => st.edited = true;
  q('#ml-setup')?.addEventListener('click', () => { closeModal(); editClient(c.id); });
  preset(); fill(); paint();
  async function send(mm, outlook) {
    const to = people.filter((x, i) => q(`[data-to="${i}"]`)?.checked), cc = people.filter((x, i) => q(`[data-cc="${i}"]`)?.checked);
    const extra = q('#ml-extra').value.split(/[,;\s]+/).filter(Boolean); if (extra.some(e => !emailOk(e))) { toast('Check the other emails'); return false; }
    to.push(...extra.map(email => ({ email })));
    if (!to.length) { toast('Tick at least one person in To'); return false; }
    const p = IX.proj.get(st.pid); if (st.type !== 'custom' && !p) { toast('Choose the project'); return false; }
    const mail = { to, cc, subject: q('#ml-s').value.trim(), body: q('#ml-b').value };
    try {
      if (outlook) {
        let att = null;
        if (st.type === 'ts') { toast('Preparing the timesheet PDF…', 30000); const base = st.base || buildTimesheet(p.id, st.ym); att = { name: mailAttName(p, st), type: 'application/pdf', blob: await PDFX.build([{ html: tsSheetHTML(tsView(base, '')), land: true }]) }; }
        downloadBlob(new Blob([await emlFile(mail, att)], { type: 'message/rfc822' }), `${(mail.subject || 'Email').replace(/[\\/:*?"<>|]/g, '').slice(0, 80)}.eml`);
        toast('Opened as a draft – open the downloaded file; Outlook shows it ready to send', 6000);
      } else {
        const u = `mailto:${to.map(x => x.email).join(',')}?${[cc.length ? 'cc=' + encodeURIComponent(cc.map(x => x.email).join(',')) : '', 'subject=' + encodeURIComponent(mail.subject), 'body=' + encodeURIComponent(mail.body)].filter(Boolean).join('&')}`;
        location.href = u;
      }
    } catch (e) { toast('Could not prepare the email: ' + e.message, 6000); return false; }
    if (st.type === 'ts' && q('#ml-mark').checked && !trackCell(p.id, st.ym).v.tsSent) { trackSet(p.id, st.ym, 'tsSent', todayISO()); if (curView === 'tracker') renderTracker(); }
  }
}
const fmtMonth = ym => ym ? `${MONTH_FULL[+ym.slice(5, 7) - 1][0]}${MONTH_FULL[+ym.slice(5, 7) - 1].slice(1).toLowerCase()} ${ym.slice(0, 4)}` : '';
const mailAttName = (p, st) => `Timesheet_${(p.trackerName || p.name).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_')}_${st.base && st.base.from.slice(0, 7) === st.ym ? tsLabel(st.base).replace(/[^\w-]+/g, '_') : fmtMonYY(st.ym)}.pdf`;
/** a draft email file: Outlook opens it as a new message (X-Unsent) with the attachment */
async function emlFile(mail, att) {
  const b64u = s => btoa(unescape(encodeURIComponent(s))), word = s => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64u(s)}?=`;
  const addr = xs => xs.map(x => x.name ? `"${word(x.name.replace(/"/g, ''))}" <${x.email}>` : x.email).join(', ');
  const wrap = s => s.replace(/.{1,76}/g, '$&\r\n'), B = 'ls_' + Math.random().toString(36).slice(2);
  const h = [`To: ${addr(mail.to)}`, ...(mail.cc.length ? [`Cc: ${addr(mail.cc)}`] : []), `Subject: ${word(mail.subject)}`, 'X-Unsent: 1', 'MIME-Version: 1.0'];
  const text = ['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(b64u(mail.body.replace(/\r?\n/g, '\r\n')))].join('\r\n');
  if (!att) return [...h, text].join('\r\n');
  return [...h, `Content-Type: multipart/mixed; boundary="${B}"`, '', `--${B}`, text, `--${B}`, `Content-Type: ${att.type}; name="${att.name}"`, `Content-Disposition: attachment; filename="${att.name}"`, 'Content-Transfer-Encoding: base64', '', wrap(await b64.enc(att.blob)), `--${B}--`, ''].join('\r\n');
}
/** Settings → Email templates */
function mailTplHTML() {
  return `<p class="muted small" style="margin:0 0 8px">Placeholders: {names} (the To names), {client}, {project}, {period}, {sender}, {company}.</p>
    ${MAIL_TYPES.map(([k, l]) => { const t = mailTpl(k); return `<div class="mtpl"><b>${l}</b><label class="f">Subject<input type="text" data-mtk="${k}" data-mtf="subject" value="${esc(t.subject)}"></label><label class="f">Message<textarea rows="6" data-mtk="${k}" data-mtf="body">${esc(t.body)}</textarea></label></div>`; }).join('')}
    <div class="row"><button class="btn sm" id="mt-reset">Restore the default templates</button></div>`;
}
function bindMailTpl(v) {
  v.querySelectorAll('[data-mtk]').forEach(i => i.onchange = () => { const s = S.settings.mailTpl ||= {}; (s[i.dataset.mtk] ||= {})[i.dataset.mtf] = i.value; markDirty(); });
  $('#mt-reset', v)?.addEventListener('click', () => { S.settings.mailTpl = {}; markDirty(); renderData(); });
}
