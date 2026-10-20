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
const RV = { ym: null, type: '', q: '', checked: new Set() };
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
/* ---------- the list: only people who have reports this month; type chips; one download ---------- */
function reportDocs() { return Object.values(S.empDocs || {}).filter(d => d.ym === RV.ym && (!RV.type || d.type === RV.type)); }
const monthLong = ym => `${MONTH_FULL[+ym.slice(5, 7) - 1][0]}${MONTH_FULL[+ym.slice(5, 7) - 1].slice(1).toLowerCase()} ${ym.slice(0, 4)}`;
function renderReports() {
  const v = $('#v-reports'); RV.ym ||= PV_.ym || AV.ym || cycleOfDate(todayISO());
  const month = Object.values(S.empDocs || {}).filter(d => d.ym === RV.ym), cnt = Object.fromEntries(DOC_TYPES.map(t => [t[0], month.filter(d => d.type === t[0]).length]));
  const docs = reportDocs(), q = norm(RV.q), by = new Map();
  for (const d of docs) { const e = IX.emp.get(d.empId); if (!e) continue; const site = assignOn(e, payrollCycle(RV.ym).end)?.site || e.assign?.[0]?.site, p = projOfSite(site);
    if (SEL.client && p?.clientId !== SEL.client || SEL.project && p?.id !== SEL.project || SEL.site && site !== SEL.site) continue;
    if (q && !norm(e.name).includes(q) && !norm(e.empCode).includes(q)) continue;
    (by.get(e.id) || by.set(e.id, { e, site, ds: [] }).get(e.id)).ds.push(d); }
  const list = [...by.values()].sort((a, b) => (a.e.empCode || '').localeCompare(b.e.empCode || '') || a.e.name.localeCompare(b.e.name));
  for (const id of [...RV.checked]) if (!by.has(id)) RV.checked.delete(id);
  const nSel = RV.checked.size, pages = list.filter(x => !nSel || RV.checked.has(x.e.id)).reduce((a, x) => a + x.ds.reduce((b, d) => b + d.pages, 0), 0);
  v.innerHTML = docHead('Reports', `${monthLong(RV.ym)} payroll month`, `<input type="month" id="rp-ym" value="${RV.ym}" title="Payroll month">
      <button class="btn sm" id="rp-add">Add reports…</button>
      <button class="btn sm pri" id="rp-merge"${list.length ? '' : ' disabled'}>Download ${nSel ? nSel + ' selected' : 'all ' + list.length} as one PDF${pages ? ` (${pages} p)` : ''}</button>`)
    + `<div class="dc"><div class="rp-bar"><span class="seg rp-chips"><button data-rt=""${RV.type ? '' : ' class="on"'}>All <b>${month.length}</b></button>${DOC_TYPES.map(t => `<button data-rt="${t[0]}"${RV.type === t[0] ? ' class="on"' : ''}>${t[1]} <b>${cnt[t[0]]}</b></button>`).join('')}</span>
      <input type="search" id="rp-q" placeholder="Find name or Emp ID" value="${esc(RV.q)}"></div>
    ${list.length ? `<div class="tw tall"><table class="rp"><thead><tr><th style="width:28px"><input type="checkbox" id="rp-all"${nSel && nSel === list.length ? ' checked' : ''}></th><th>Emp ID</th><th>Name</th><th>Site</th><th>Reports – click to open</th></tr></thead><tbody>
      ${list.map(x => { const g = {}; for (const d of x.ds) (g[d.type] ||= []).push(d);
        return `<tr><td><input type="checkbox" data-rc="${x.e.id}"${RV.checked.has(x.e.id) ? ' checked' : ''}></td><td class="mono">${esc(x.e.empCode || '')}</td><td>${esc(x.e.name)}</td><td class="small">${esc(siteName(x.site))}</td>
          <td>${DOC_TYPES.filter(t => g[t[0]]).map(t => `<button class="rp-chip" data-rd="${x.e.id}|${t[0]}">${t[1]} · ${g[t[0]].reduce((a, d) => a + d.pages, 0)} p</button>`).join('')}</td></tr>`; }).join('')}</tbody></table></div>`
      : `<div class="rp-empty"><b>No ${RV.type ? docTypeName(RV.type).toLowerCase() + ' ' : ''}reports for ${monthLong(RV.ym)}${RV.q ? ' matching “' + esc(RV.q) + '”' : ''}.</b>
        <p>Reports get here in three ways:</p><ol><li><b>Add reports… → Files</b> – name each file <span class="mono">EmpID_TYPE_YYYY-MM.pdf</span>, e.g. <span class="mono">C14761_MED_2026-09.pdf</span> (TYPE: ${DOC_TYPES.map(t => `<span class="mono">${t[0]}</span> ${t[1].toLowerCase()}`).join(', ')}); they are filed to the right person.</li>
        <li><b>Add reports… → One scanned PDF with many people</b> – type the Emp ID on each person's first page.</li><li><b>Phone</b> – supervisors scan any report; personnel send their own medical report. They arrive with the sync.</li></ol></div>`}</div>`;
  $('#rp-ym', v).onchange = e => { RV.ym = e.target.value; RV.checked.clear(); renderReports(); };
  v.querySelectorAll('[data-rt]').forEach(b => b.onclick = () => { RV.type = b.dataset.rt; RV.checked.clear(); renderReports(); });
  let qt; $('#rp-q', v).oninput = e => { clearTimeout(qt); qt = setTimeout(() => { RV.q = e.target.value; renderReports(); const q = $('#rp-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 300); };
  $('#rp-add', v).onclick = e => addReportsMenu(e.currentTarget);
  $('#rp-merge', v).onclick = () => mergeReports(list.map(x => x.e)).catch(er => toast(er.message, 6000));
  $('#rp-all', v)?.addEventListener('change', e => { list.forEach(x => e.target.checked ? RV.checked.add(x.e.id) : RV.checked.delete(x.e.id)); renderReports(); });
  v.querySelectorAll('[data-rc]').forEach(c => c.onchange = () => { c.checked ? RV.checked.add(c.dataset.rc) : RV.checked.delete(c.dataset.rc); renderReports(); });
  v.querySelectorAll('[data-rd]').forEach(b => b.onclick = () => { const [id, t] = b.dataset.rd.split('|'); docsDialog(by.get(id).ds.filter(d => d.type === t)); });
}
function addReportsMenu(btn) {
  const dd = $('#dropdown');
  dd.innerHTML = `<button data-ar="files"><span><b>Files</b><br><span class="muted small">PDFs or photos named EmpID_TYPE_YYYY-MM – many at once</span></span></button><button data-ar="split"><span><b>One scanned PDF with many people</b><br><span class="muted small">type the Emp ID on each person's first page</span></span></button>`;
  const r = btn.getBoundingClientRect(); dd.style.left = Math.max(8, r.right - 320) + 'px'; dd.style.top = r.bottom + 4 + 'px'; dd.style.width = '320px'; dd.hidden = false;
  dd.querySelector('[data-ar="files"]').onclick = () => { closeMenu(); dd.style.width = ''; pickFiles('application/pdf,image/*', true, uploadReports); };
  dd.querySelector('[data-ar="split"]').onclick = () => { closeMenu(); dd.style.width = ''; pickFiles('application/pdf', false, fs => splitReports(fs[0]).catch(e => toast(e.message, 6000))); };
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
  const docs = reportDocs().filter(d => rank.has(d.empId)).sort((a, b) => ti[a.type] - ti[b.type] || rank.get(a.empId).localeCompare(rank.get(b.empId)) || a.addedAt.localeCompare(b.addedAt));
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
    const imgs = []; for (let i = 0; i < x.pages; i++) { const b = await cl.call('GET', 'admin/doc', null, { query: { id: x.id, page: i } }); if (b.status === 200 && (b.blob || b.bytes)) { const bl = b.blob || new Blob([b.bytes], { type: b.type || 'image/jpeg' }); imgs.push((x.kinds?.[i] === 'pdf' || /pdf/.test(bl.type)) ? { pdf: bl } : { img: bl }); } }
    if (!imgs.length) continue;
    await addEmpDoc(e.id, x.type, x.ym, await PDFX.build(imgs), { src: 'phone', remote: x.id, by: x.by, name: `${x.code}_${x.type}_${x.ym}_${x.id.slice(-4)}.pdf` }); n++;
  }
  return { now: r.body.now, n };
}
