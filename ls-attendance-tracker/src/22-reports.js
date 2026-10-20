/* =====================================================================
   Payroll → 2 Reports: each person's monthly report PDFs – attendance
   sheet, vehicle attendance (trip sheets), security violation, mispunch,
   medical – kept against the person and the payroll month, then filtered
   and downloaded as one merged PDF.
   How files come in:
   - named files, in bulk: <EmpCode>_<TYPE>_<YYYY-MM>.pdf (e.g.
     C14761_ATT_2026-09.pdf; words such as "medical", "Sep-26" also work)
   - a merged scan, split here: type the Emp ID on each page
   - the phone: supervisors scan any report, personnel send their medical
     report; they arrive with the sync (S.empDocs, bytes in Files)
   ===================================================================== */
const DOC_TYPES = [['ATT', 'Attendance sheet', /\b(att|attendance|log ?sheet)\b/i], ['VEH', 'Vehicle attendance', /\b(veh|vehicle|trip|driver)/i], ['SVR', 'Security violation', /\b(svr|violation|penalty|fine)/i],
  ['MPR', 'Mispunch', /\b(mpr|mis-?s?punch|miss ?punch|biometric)/i], ['MED', 'Medical', /\b(med|medical|discharge|sick|hospital)/i]];
const docTypeName = k => DOC_TYPES.find(t => t[0] === k)?.[1] || k;
const RV = { ym: null, type: '', q: '', only: false, order: 'type', checked: new Set() };
const empByCode = code => S.employees.find(e => norm(e.empCode) === norm(code)) || null;
/** what a file name says: person, type, payroll month */
function docParseName(name) {
  const s = name.replace(/\.[a-z0-9]+$/i, ''), out = {};
  const byCode = new Map(S.employees.filter(e => e.empCode).map(e => [norm(e.empCode), e]));
  for (const w of s.split(/[^A-Za-z0-9]+/)) { const e = byCode.get(norm(w)); if (e) { out.emp = e; break; } }
  const t = s.match(/(?:^|[^A-Z])(ATT|VEH|SVR|MPR|MED)(?:[^A-Z]|$)/i); out.type = t ? t[1].toUpperCase() : DOC_TYPES.find(x => x[2].test(s.replace(/[_.-]+/g, ' ')))?.[0];
  let m = s.match(/(20\d\d)[-_. ]?(0[1-9]|1[0-2])(?!\d)/); if (m) out.ym = `${m[1]}-${m[2]}`;
  else { const ms = [...s.matchAll(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-_ .']*(\d{2,4})?/gi)]; const last = ms.at(-1);
    if (last) { const y = (last[2] || ms.find(x => x[2])?.[2] || todayISO().slice(0, 4)); out.ym = `${y.length === 2 ? '20' + y : y}-${pad(MON.findIndex(x => x.toLowerCase() === last[1].slice(0, 3).toLowerCase()) + 1)}`; } }
  return out;
}
/** any image the browser can show → JPEG blob, at most 2000 px */
async function docImg(file) {
  const bmp = await createImageBitmap(file), k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
}
async function docPdf(files) {
  const parts = []; for (const f of files) parts.push(/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name || '') ? { pdf: f } : { img: await docImg(f) });
  return parts.length === 1 && parts[0].pdf ? parts[0].pdf : PDFX.build(parts);
}
async function pdfPages(blob) { await loadScript(LIB.pdflib); return (await PDFLib.PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true })).getPageCount(); }
/** store one report for a person */
async function addEmpDoc(empId, type, ym, blob, meta = {}) {
  const e = IX.emp.get(empId), id = uid('ed'), fileId = 'doc-' + id, pages = await pdfPages(blob);
  await Files.put(fileId, blob);
  S.empDocs[id] = { id, empId, code: e?.empCode || '', type, ym, pages, fileId, name: meta.name || `${e?.empCode || 'X'}_${type}_${ym}.pdf`, addedAt: new Date().toISOString(), by: meta.by || ME.email || '', src: meta.src || 'upload', ...(meta.remote ? { remote: meta.remote } : {}) };
  markDirty(); return S.empDocs[id];
}
const empOpts = () => `<datalist id="rp-emps">${S.employees.map(e => `<option value="${esc(e.empCode || '')} – ${esc(e.name)}">`).join('')}</datalist>`;
const empFromInput = v => empByCode(String(v || '').split(/\s+–\s+|\s+/)[0]);

/* ---------- 1. named files in bulk ---------- */
function uploadReports(files) {
  const ym0 = RV.ym, rows = files.map(f => ({ f, ...docParseName(f.name) }));
  const m = openModal(`Upload ${files.length} report file(s)`, `${empOpts()}<p class="muted small" style="margin-top:0">Name files <b>EmpCode_TYPE_YYYY-MM</b>, e.g. <b>C14761_ATT_2026-09.pdf</b> (TYPE: ${DOC_TYPES.map(t => `${t[0]} ${t[1].toLowerCase()}`).join(', ')}). Anything not recognised can be set below.</p>
    <div class="tw" style="max-height:52vh"><table><thead><tr><th>File</th><th>Security personnel</th><th>Report</th><th>Payroll month</th></tr></thead><tbody>
    ${rows.map((r, i) => `<tr class="${r.emp && r.type ? '' : 'warnrow'}"><td class="small">${esc(r.f.name)}</td><td><input list="rp-emps" data-ue="${i}" value="${r.emp ? esc(r.emp.empCode + ' – ' + r.emp.name) : ''}" placeholder="Emp ID or name" style="width:240px"></td>
      <td><select data-ut="${i}">${opts(DOC_TYPES.map(t => [t[0], t[1]]), r.type || '', '— choose —')}</select></td><td><input type="month" data-um="${i}" value="${r.ym || ym0}"></td></tr>`).join('')}</tbody></table></div>`,
    [{ label: 'Cancel' }, { label: 'Save', cls: 'pri', onClick: async mm => {
      const todo = rows.map((r, i) => ({ r, e: empFromInput($(`[data-ue="${i}"]`, mm).value), t: $(`[data-ut="${i}"]`, mm).value, ym: $(`[data-um="${i}"]`, mm).value }));
      const bad = todo.filter(x => !x.e || !x.t || !x.ym); if (bad.length) { toast(`${bad.length} file(s) still need a person, report type and month`); return false; }
      let n = 0; for (const x of todo) { toast(`Saving ${++n} / ${todo.length}…`, 30000); await addEmpDoc(x.e.id, x.t, x.ym, await docPdf([x.r.f]), { name: x.r.f.name }); }
      toast(`${todo.length} report(s) saved`); renderReports();
    } }], { width: '860px' });
  return m;
}
/* ---------- 2. split a merged scan ---------- */
async function splitReports(file) {
  toast('Reading pages…', 60000);
  const { pages } = await PDFX.pages(file, { thumbs: true, scale: 0.3 }); toast('');
  const m = openModal(`Split “${file.name}” – ${pages.length} pages`, `${empOpts()}<div class="form"><label class="f">Report<select id="sp-t">${opts(DOC_TYPES.map(t => [t[0], t[1]]), docParseName(file.name).type || '', '— choose —')}</select></label><label class="f">Payroll month<input type="month" id="sp-ym" value="${docParseName(file.name).ym || RV.ym}"></label></div>
    <p class="muted small">Type the Emp ID on the first page of each person and press Enter to go to the next page. Leave a page empty when it belongs to the person before it (e.g. a 4-page medical report).</p>
    <div class="sp-grid">${pages.map((p, i) => `<div class="sp-pg"><img src="${p.thumb}" alt="Page ${i + 1}"><div class="row"><b>${i + 1}</b><input list="rp-emps" data-sp="${i}" placeholder="${i ? '↑ same person' : 'Emp ID'}"></div><div class="small muted" data-spn="${i}"></div></div>`).join('')}</div>`,
    [{ label: 'Cancel' }, { label: 'Save', cls: 'pri', onClick: async mm => {
      const t = $('#sp-t', mm).value, ym = $('#sp-ym', mm).value; if (!t || !ym) { toast('Choose the report and month'); return false; }
      const groups = []; let cur = null;
      for (let i = 0; i < pages.length; i++) { const v = $(`[data-sp="${i}"]`, mm).value.trim(); if (v) { const e = empFromInput(v); if (!e) { toast(`Page ${i + 1}: “${v}” is not a known Emp ID`); return false; } groups.push(cur = { e, idx: [] }); } if (!cur) { toast('Page 1 needs an Emp ID'); return false; } cur.idx.push(i); }
      let n = 0; for (const g of groups) { toast(`Saving ${++n} / ${groups.length}…`, 30000); await addEmpDoc(g.e.id, t, ym, await PDFX.subset(file, g.idx), { src: 'split', name: `${g.e.empCode}_${t}_${ym}.pdf` }); }
      toast(`${groups.length} report(s) saved from ${pages.length} pages`); renderReports();
    } }], { width: '1000px' });
  const show = () => { let who = ''; pages.forEach((_, i) => { const v = $(`[data-sp="${i}"]`, m).value.trim(); if (v) { const e = empFromInput(v); who = e ? e.name : '?'; } $(`[data-spn="${i}"]`, m).textContent = who; }); };
  m.querySelectorAll('[data-sp]').forEach(inp => { inp.oninput = show; inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const v = inp.value.trim(), x = empFromInput(v); if (v && x) inp.value = `${x.empCode} – ${x.name}`; show(); m.querySelector(`[data-sp="${+inp.dataset.sp + 1}"]`)?.focus(); } }; });
}
/* ---------- the matrix ---------- */
function reportDocs() { return Object.values(S.empDocs || {}).filter(d => d.ym === RV.ym && (!RV.type || d.type === RV.type)); }
function renderReports() {
  const v = $('#v-reports'); RV.ym ||= PV_.ym || AV.ym || cycleOfDate(todayISO());
  const docs = reportDocs(), by = new Map(); for (const d of docs) { const k = d.empId; (by.get(k) || by.set(k, {}).get(k))[d.type] = [...((by.get(k)[d.type]) || []), d]; }
  const q = norm(RV.q), types = RV.type ? DOC_TYPES.filter(t => t[0] === RV.type) : DOC_TYPES;
  const people = payRows(RV.ym).map(r => r.e); for (const id of by.keys()) if (!people.some(e => e.id === id) && IX.emp.get(id)) people.push(IX.emp.get(id));
  const list = people.filter(e => (!RV.only || by.has(e.id)) && (!q || norm(e.name).includes(q) || norm(e.empCode).includes(q))).sort((a, b) => (by.has(b.id) - by.has(a.id)) || (a.empCode || '').localeCompare(b.empCode || ''));
  const tot = Object.fromEntries(DOC_TYPES.map(t => [t[0], docs.filter(d => d.type === t[0]).length]));
  const LIM = 300, shown = list.slice(0, RV.all ? list.length : LIM);
  v.innerHTML = docHead('Reports', `${docs.length} report(s) for payroll month ${fmtMonYY(RV.ym)} · ${by.size} personnel`, `
      <label class="small">Payroll month <input type="month" id="rp-ym" value="${RV.ym}"></label>
      <select id="rp-t">${opts(DOC_TYPES.map(t => [t[0], `${t[1]} (${tot[t[0]]})`]), RV.type, 'All reports')}</select>
      <input type="search" id="rp-q" placeholder="Find name / code" value="${esc(RV.q)}" style="width:140px">
      <label class="small"><input type="checkbox" id="rp-only"${RV.only ? ' checked' : ''}> Only with reports</label>
      <button class="btn sm" id="rp-up">Upload named files…</button><button class="btn sm" id="rp-split">Split a merged PDF…</button>
      <select id="rp-ord" title="Order of the merged PDF"><option value="type"${RV.order === 'type' ? ' selected' : ''}>Merge by report, then person</option><option value="emp"${RV.order === 'emp' ? ' selected' : ''}>Merge by person, then report</option></select>
      <button class="btn sm pri" id="rp-merge">Download merged PDF${RV.checked.size ? ` (${RV.checked.size})` : ''}</button>`)
    + `<div class="dc"><div class="tw tall"><table class="rp"><thead><tr><th><input type="checkbox" id="rp-all"></th><th>Emp ID</th><th>Name</th><th>Site</th>${types.map(t => `<th class="c">${t[1]}</th>`).join('')}</tr></thead><tbody>
      ${shown.map(e => `<tr><td><input type="checkbox" data-rc="${e.id}"${RV.checked.has(e.id) ? ' checked' : ''}></td><td class="mono">${esc(e.empCode || '')}</td><td>${esc(e.name)}</td><td class="small">${esc(siteName(assignOn(e, payrollCycle(RV.ym).end)?.site || e.assign?.[0]?.site))}</td>
        ${types.map(t => { const ds = by.get(e.id)?.[t[0]] || []; return `<td class="c">${ds.length ? `<button class="btn sm rp-has" data-rd="${e.id}|${t[0]}" title="${ds.map(d => esc(d.name)).join('\n')}">✓ ${ds.reduce((a, d) => a + d.pages, 0)} p</button>` : '<span class="muted">–</span>'}</td>`; }).join('')}</tr>`).join('') || '<tr><td colspan="9" class="muted" style="padding:16px">Nobody matches.</td></tr>'}
      </tbody></table></div>${list.length > shown.length ? `<div class="row" style="margin-top:6px"><span class="muted small">Showing ${shown.length} of ${list.length}.</span><button class="btn sm" id="rp-more">Show all</button></div>` : ''}
      <div class="muted small" style="margin-top:6px">Tick people (none ticked = everyone with reports in this list) and download one PDF. Supervisors can scan reports on the phone, and personnel can send their own medical report – they arrive here with the sync.</div></div>`;
  $('#rp-ym', v).onchange = e => { RV.ym = e.target.value; RV.checked.clear(); renderReports(); };
  $('#rp-t', v).onchange = e => { RV.type = e.target.value; renderReports(); };
  let qt; $('#rp-q', v).oninput = e => { clearTimeout(qt); qt = setTimeout(() => { RV.q = e.target.value; renderReports(); const q = $('#rp-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 300); };
  $('#rp-only', v).onchange = e => { RV.only = e.target.checked; renderReports(); };
  $('#rp-ord', v).onchange = e => { RV.order = e.target.value; };
  $('#rp-up', v).onclick = () => pickFiles('application/pdf,image/*', true, uploadReports);
  $('#rp-split', v).onclick = () => pickFiles('application/pdf', false, fs => splitReports(fs[0]).catch(e => toast(e.message, 6000)));
  $('#rp-merge', v).onclick = () => mergeReports(list).catch(e => toast(e.message, 6000));
  $('#rp-more', v)?.addEventListener('click', () => { RV.all = true; renderReports(); });
  $('#rp-all', v).onchange = e => { shown.forEach(x => e.target.checked ? RV.checked.add(x.id) : RV.checked.delete(x.id)); renderReports(); };
  v.querySelectorAll('[data-rc]').forEach(c => c.onchange = () => { c.checked ? RV.checked.add(c.dataset.rc) : RV.checked.delete(c.dataset.rc); $('#rp-merge').textContent = `Download merged PDF${RV.checked.size ? ` (${RV.checked.size})` : ''}`; });
  v.querySelectorAll('[data-rd]').forEach(b => b.onclick = () => { const [id, t] = b.dataset.rd.split('|'); docsDialog(by.get(id)[t]); });
}
/** the reports in one cell: open, move to another person / month, delete */
function docsDialog(ds) {
  const e = IX.emp.get(ds[0].empId);
  const m = openModal(`${docTypeName(ds[0].type)} – ${e?.empCode || ''} ${e?.name || ''}`, `${empOpts()}<div class="tw"><table><thead><tr><th>File</th><th class="num">Pages</th><th>Added</th><th></th></tr></thead><tbody>
    ${ds.map(d => `<tr><td>${esc(d.name)}<div class="muted small">${d.src === 'phone' ? 'scanned on the phone' : d.src === 'split' ? 'split from a merged PDF' : 'uploaded'}${d.by ? ' · ' + esc(d.by) : ''}</div></td><td class="num">${d.pages}</td><td class="mono small">${fmtDMY(d.addedAt.slice(0, 10))}</td>
      <td style="white-space:nowrap"><button class="btn sm" data-do="${d.id}">Open</button> <button class="btn sm" data-dm="${d.id}">Move…</button> <button class="btn sm bad" data-dx="${d.id}">✕</button></td></tr>`).join('')}</tbody></table></div>`, [{ label: 'Close', cls: 'pri' }]);
  m.querySelectorAll('[data-do]').forEach(b => b.onclick = () => PDFX.open(S.empDocs[b.dataset.do].fileId));
  m.querySelectorAll('[data-dx]').forEach(b => b.onclick = async () => { const d = S.empDocs[b.dataset.dx]; if (!await confirmBox(`Delete ${d.name}?`, 'Delete', 'bad')) return; await Files.del(d.fileId); delete S.empDocs[d.id]; markDirty(); renderReports(); });
  m.querySelectorAll('[data-dm]').forEach(b => b.onclick = () => { const d = S.empDocs[b.dataset.dm];
    openModal(`Move ${d.name}`, `${empOpts()}<div class="form"><label class="f">Security personnel<input list="rp-emps" id="mv-e" value="${esc((IX.emp.get(d.empId)?.empCode || '') + ' – ' + (IX.emp.get(d.empId)?.name || ''))}"></label><label class="f">Report<select id="mv-t">${opts(DOC_TYPES.map(t => [t[0], t[1]]), d.type)}</select></label><label class="f">Payroll month<input type="month" id="mv-ym" value="${d.ym}"></label></div>`,
      [{ label: 'Cancel' }, { label: 'Move', cls: 'pri', onClick: mm => { const e = empFromInput($('#mv-e', mm).value); if (!e) { toast('Choose a person'); return false; } Object.assign(d, { empId: e.id, code: e.empCode, type: $('#mv-t', mm).value, ym: $('#mv-ym', mm).value }); markDirty(); renderReports(); } }]); });
}
async function mergeReports(list) {
  const ids = RV.checked.size ? list.filter(e => RV.checked.has(e.id)) : list, rank = new Map(ids.map((e, i) => [e.id, (e.empCode || '') + '|' + i]));
  const ti = Object.fromEntries(DOC_TYPES.map((t, i) => [t[0], i]));
  const docs = reportDocs().filter(d => rank.has(d.empId)).sort((a, b) => RV.order === 'emp' ? rank.get(a.empId).localeCompare(rank.get(b.empId)) || ti[a.type] - ti[b.type] || a.addedAt.localeCompare(b.addedAt) : ti[a.type] - ti[b.type] || rank.get(a.empId).localeCompare(rank.get(b.empId)) || a.addedAt.localeCompare(b.addedAt));
  if (!docs.length) return toast('No reports for the chosen people and filters');
  const parts = []; for (const d of docs) { const b = await Files.get(d.fileId); if (!b) return toast(`${d.name} is missing in this browser`, 6000); parts.push({ pdf: b }); }
  toast('Merging…', 60000);
  const blob = await PDFX.build(parts, (n, t) => toast(`Merging ${n} / ${t}…`, 60000)), people = new Set(docs.map(d => d.empId)).size;
  const label = RV.type ? `${docTypeName(RV.type)} reports` : 'Reports';
  downloadBlob(blob, `${label} - ${fmtMonthName(RV.ym).replace('-', ' ')} (${people}).pdf`);
  toast(`Merged PDF · ${docs.length} report(s) · ${docs.reduce((a, d) => a + d.pages, 0)} pages · ${people} personnel`);
}
/* ---------- from the phone: pages (JPEG) stored by the API, turned into a PDF here during the sync ---------- */
async function pullPhoneDocs(cl, since) {
  const r = await cl.call('GET', 'admin/docs', null, { query: { since } }); if (r.status !== 200) return null;
  let n = 0;
  for (const x of r.body.docs) {
    if (Object.values(S.empDocs).some(d => d.remote === x.id)) continue;
    const e = empByCode(x.code); if (!e) continue;
    const imgs = []; for (let i = 0; i < x.pages; i++) { const b = await cl.call('GET', 'admin/doc', null, { query: { id: x.id, page: i } }); if (b.status === 200 && (b.blob || b.bytes)) imgs.push({ img: b.blob || new Blob([b.bytes], { type: b.type || 'image/jpeg' }) }); }
    if (!imgs.length) continue;
    await addEmpDoc(e.id, x.type, x.ym, await PDFX.build(imgs), { src: 'phone', remote: x.id, by: x.by, name: `${x.code}_${x.type}_${x.ym}_${x.id.slice(-4)}.pdf` }); n++;
  }
  return { now: r.body.now, n };
}
