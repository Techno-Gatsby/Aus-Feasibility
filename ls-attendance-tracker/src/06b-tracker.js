/* =====================================================================
   Billing → 3 Tracker: the Tax Invoice Tracker, laid out like the
   workbook – one row per project grouped by client (A, B, C…), and per
   month Timesheet (submitted / approved), Tax Invoice (submitted,
   processing, invoice no, SPC no, amount) and Payment received.
   - Rows are built from the projects every time (nothing stored), so a
     new, renamed, moved or deleted project shows here at once.
   - A month covered by a saved invoice reads and writes that invoice
     (no, amount, and its Track dates); other months keep their own
     entries in S.billTrack["projectId|YYYY-MM"].
   ===================================================================== */
const TRK_SECT = [['Timesheet', 2], ['Tax Invoice', 5], ['Payment', 1]];
const TRK_F = [['tsSent', 'Submission to Client - Date', 'date'], ['tsApproved', 'Approval From Client - Date', 'date'], ['invSent', 'Invoice Submission to Client - Date', 'date'], ['invProcessed', 'Invoice Processing - Date', 'date'],
  ['invNo', 'Invoice No', 'text'], ['spcNo', 'SPC No', 'text'], ['amount', 'Amount', 'number'], ['paidOn', 'Payment Received Date', 'date']];
const TR = { y: +todayISO().slice(0, 4), m0: 0, m1: 11, q: '', inact: false, hint: true };
const trkDate = iso => iso ? `${iso.slice(8, 10)}-${MON[+iso.slice(5, 7) - 1]}-${iso.slice(2, 4)}` : '';
const trkLetter = i => colL(i);
/** the saved invoice that bills this project for this month (latest saved wins) */
function invFor(pid, ym) {
  let best = null;
  for (const x of S.invoices) if (x.projectIds?.includes(pid) && x.from <= ym && ym <= x.to && (!best || (x.savedAt || '') > (best.savedAt || ''))) best = x;
  return best;
}
/** this project's share of the invoice for the month, incl. VAT */
function invShare(x, pid, ym) {
  let a = 0, hit = false;
  for (const l of x.lines || []) if (l.src?.pid === pid && l.src?.m === ym) { a += (+l.amount || 0) * (1 + (+l.vat || 0) / 100); hit = true; }
  if (!hit && x.projectIds.length === 1 && x.from === x.to) return round2(invTotals(x).inc);
  return hit ? round2(a) : null;
}
/** values of one project-month: { v: {field: value}, inv } */
function trackCell(pid, ym) {
  const inv = invFor(pid, ym), man = S.billTrack[`${pid}|${ym}`] || {}, v = {};
  for (const [k] of TRK_F) v[k] = man[k] ?? '';
  if (inv) {
    const t = inv.track || {};
    for (const k of ['tsSent', 'tsApproved', 'invSent', 'invProcessed', 'spcNo', 'paidOn']) if (t[k]) v[k] = t[k];
    if (inv.no) v.invNo = inv.no;
    const a = invShare(inv, pid, ym); if (a != null) v.amount = a;
  }
  return { v, inv };
}
function trackSet(pid, ym, k, val) {
  const inv = invFor(pid, ym);
  if (inv && !['invNo', 'amount'].includes(k)) {
    inv.track ||= {}; if (val === '') delete inv.track[k]; else inv.track[k] = val;
    if (IV.draft?.id === inv.id) { IV.draft.track ||= {}; IV.draft.track[k] = inv.track[k]; }
  } else {
    const key = `${pid}|${ym}`, r = S.billTrack[key] ||= {};
    if (val === '') delete r[k]; else r[k] = k === 'amount' ? round2(+val) : val;
    if (!Object.keys(r).length) delete S.billTrack[key];
  }
  markDirty();
}
const trkHasData = (pid, y) => Array.from({ length: 12 }, (_, i) => `${y}-${pad(i + 1)}`).some(ym => { const { v, inv } = trackCell(pid, ym); return inv || TRK_F.some(([k]) => v[k] !== ''); });
/** groups of rows, from the live clients and projects */
function trackerRows() {
  const q = TR.q.trim().toLowerCase(), groups = [];
  const show = p => (!SEL.client || p.clientId === SEL.client) && (!SEL.project || p.id === SEL.project) && (TR.inact || p.active !== false || trkHasData(p.id, TR.y))
    && (!q || `${p.trackerName || ''} ${p.name} ${p.code || ''}`.toLowerCase().includes(q));
  const byName = (a, b) => (a.trackerName || a.name).localeCompare(b.trackerName || b.name);
  for (const c of [...S.clients].sort((a, b) => a.name.localeCompare(b.name))) {
    const ps = S.projects.filter(p => p.clientId === c.id && show(p)).sort(byName); if (ps.length) groups.push({ name: c.name, ps });
  }
  const other = S.projects.filter(p => !IX.client.get(p.clientId) && show(p)).sort(byName); if (other.length) groups.push({ name: 'Other (no client)', ps: other });
  return groups;
}
function renderTracker() {
  const v = $('#v-tracker'), groups = trackerRows(), months = Array.from({ length: TR.m1 - TR.m0 + 1 }, (_, i) => `${TR.y}-${pad(TR.m0 + i + 1)}`);
  let inv = 0, paid = 0, nP = 0;
  for (const g of groups) for (const p of g.ps) { nP++; for (let m = 1; m <= 12; m++) { const { v: x } = trackCell(p.id, `${TR.y}-${pad(m)}`); if (+x.amount) { inv += +x.amount; if (x.paidOn) paid += +x.amount; } } }
  const terms = parseInt(S.settings.payTerms) || 30, today = todayISO();
  const mOpt = sel => MON.map((m, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${m}</option>`).join('');
  let n = 0;
  const body = groups.map((g, gi) => `<tr class="tk-g"><td class="tk-sl">${trkLetter(gi)}</td><td class="tk-d">${esc(g.name)}</td>${months.map(() => `<td class="tk-sp"></td><td colspan="8"></td>`).join('')}</tr>`
    + g.ps.map(p => `<tr><td class="tk-sl">${++n}</td><td class="tk-d" title="${esc(p.name)}${p.code ? ' · ' + esc(p.code) : ''}">${esc(p.trackerName || p.name)}</td>${months.map(ym => {
      const { v: x, inv: iv } = trackCell(p.id, ym), st = TR.hint ? x.paidOn ? ' pd' : x.invSent && daysBetween(x.invSent, today) > terms ? ' od' : '' : '';
      return '<td class="tk-sp"></td>' + TRK_F.map(([k, , t]) => {
        const val = x[k], ro = iv && (k === 'invNo' || k === 'amount');
        return `<td class="tk-c${t === 'number' ? ' n' : ''}${st}${ro ? ' ro' : ''}" data-tk="${p.id}|${ym}|${k}"${iv ? ` title="${ro ? 'From saved invoice ' + esc(iv.no || '(no number)') + ' – click to open it' : 'Saved on invoice ' + esc(iv.no || '(no number)') + ' (shared by all its months and projects)'}"` : ''}>${val === '' || val == null ? '' : t === 'date' ? trkDate(val) : t === 'number' ? money(val) : esc(val)}</td>`;
      }).join('');
    }).join('')}</tr>`).join('')).join('');
  v.innerHTML = docHead('Tax Invoice Tracker', `${nP} projects · ${TR.y} invoiced ${money(inv)} · paid ${money(paid)}`, `
      <span class="seg"><button id="tk-prev" title="Previous year">◀</button><button class="on" disabled>${TR.y}</button><button id="tk-next" title="Next year">▶</button></span>
      <label class="small">Months <select id="tk-m0">${mOpt(TR.m0)}</select> – <select id="tk-m1">${mOpt(TR.m1)}</select></label>
      <input type="search" id="tk-q" placeholder="Find project" value="${esc(TR.q)}" style="width:150px">
      <label class="small"><input type="checkbox" id="tk-in"${TR.inact ? ' checked' : ''}> Show inactive</label>
      <label class="small" title="Green: payment received · amber: invoice sent more than ${terms} days ago and not paid"><input type="checkbox" id="tk-hint"${TR.hint ? ' checked' : ''}> Colours</label>
      <button class="btn sm pri" id="tk-xl">Download Excel</button>`)
    + `<div class="dc tk-dc"><div class="tw tk-w"><table class="tk"><thead>
      <tr class="h1"><th class="tk-sl" rowspan="3">Sl.No</th><th class="tk-d" rowspan="3">Description</th>${months.map(ym => `<th class="tk-sp" rowspan="3"></th><th colspan="8">${fmtMonYY(ym)}</th>`).join('')}</tr>
      <tr class="h2">${months.map(() => TRK_SECT.map(([l, c]) => `<th colspan="${c}">${l}</th>`).join('')).join('')}</tr>
      <tr class="h3">${months.map(() => TRK_F.map(([, l]) => `<th>${l}</th>`).join('')).join('')}</tr>
    </thead><tbody>${body || `<tr><td colspan="${2 + months.length * 9}" class="muted" style="padding:20px">No projects${TR.q || SEL.client || SEL.project ? ' match' : ' yet – add them in Projects & sites'}.</td></tr>`}</tbody></table></div>
    <div class="muted small" style="margin-top:6px">Click a cell to fill it in. Months billed by a saved invoice show its number and amount, and their dates are saved on that invoice (Invoice → 5 · Track). New projects appear here automatically.</div></div>`;
  $('#tk-prev', v).onclick = () => { TR.y--; renderTracker(); };
  $('#tk-next', v).onclick = () => { TR.y++; renderTracker(); };
  $('#tk-m0', v).onchange = e => { TR.m0 = +e.target.value; if (TR.m1 < TR.m0) TR.m1 = TR.m0; renderTracker(); };
  $('#tk-m1', v).onchange = e => { TR.m1 = +e.target.value; if (TR.m0 > TR.m1) TR.m0 = TR.m1; renderTracker(); };
  let qt; $('#tk-q', v).oninput = e => { clearTimeout(qt); qt = setTimeout(() => { TR.q = e.target.value; renderTracker(); const q = $('#tk-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 250); };
  $('#tk-in', v).onchange = e => { TR.inact = e.target.checked; renderTracker(); };
  $('#tk-hint', v).onchange = e => { TR.hint = e.target.checked; renderTracker(); };
  $('#tk-xl', v).onclick = () => exportTrackerXlsx().catch(e => toast(e.message, 6000));
  $('.tk', v).onclick = e => { const td = e.target.closest('td[data-tk]'); if (td && !td.querySelector('input')) trackEdit(td); };
}
/** inline editor in one cell; Enter / Tab / leaving the cell saves, Esc cancels */
function trackEdit(td) {
  const [pid, ym, k] = td.dataset.tk.split('|'), f = TRK_F.find(x => x[0] === k), { v, inv } = trackCell(pid, ym);
  if (inv && (k === 'invNo' || k === 'amount')) { IV.draft = JSON.parse(JSON.stringify(inv)); showView('invoices'); return; }
  const inp = document.createElement('input'); inp.type = f[2]; inp.className = 'tk-in'; inp.value = v[k] ?? ''; if (f[2] === 'number') inp.step = '0.01';
  td.textContent = ''; td.appendChild(inp); inp.focus();
  let done = false;
  const finish = (save, move) => {
    if (done) return; done = true;
    if (save && String(inp.value) !== String(v[k] ?? '')) trackSet(pid, ym, k, inp.value.trim());
    const pos = td.dataset.tk; renderTracker();
    if (move) { const cells = [...document.querySelectorAll('#v-tracker td[data-tk]')], i = cells.findIndex(c => c.dataset.tk === pos), nx = cells[i + move]; if (nx && !nx.classList.contains('ro')) trackEdit(nx); }
  };
  inp.onkeydown = e => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); else if (e.key === 'Tab') { e.preventDefault(); finish(true, e.shiftKey ? -1 : 1); } };
  inp.onblur = () => finish(true);
}
/** the same sheet as the workbook: B Sl.No, C Description, then per month 8 columns and a narrow gap */
async function exportTrackerXlsx() {
  await loadScript(LIB.exceljs);
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Tax Invoice Tracker', { views: [{ state: 'frozen', xSplit: 3, ySplit: 4, zoomScale: 85 }] });
  const blue = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }, W = [13.1, 17.6, 15, 13.1, 12, 12, 13, 12];
  const hdr = c => { c.fill = blue; c.font = { bold: true, size: 10 }; c.border = thin; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; };
  ws.getColumn(1).width = 2.7; ws.getColumn(2).width = 7.9; ws.getColumn(3).width = 54.3;
  const groups = trackerRows(), last = 4 + groups.reduce((a, g) => a + 1 + g.ps.length, 0);
  ws.mergeCells('B2:B4'); ws.getCell('B2').value = 'Sl.No'; ws.mergeCells('C2:C4'); ws.getCell('C2').value = 'Description';
  for (const a of ['B', 'C']) for (let r = 2; r <= 4; r++) hdr(ws.getCell(a + r));
  const col0 = m => 5 + m * 9;                                               // E for January, N for February… (gap before each month)
  for (let m = 0; m < 12; m++) {
    const c = col0(m); ws.getColumn(c - 1).width = 1.3; W.forEach((w, i) => ws.getColumn(c + i).width = w);
    ws.mergeCells(2, c, 2, c + 7); const mh = ws.getCell(2, c); mh.value = new Date(Date.UTC(TR.y, m, 1)); mh.numFmt = 'mmm-yy';
    let s = c; for (const [l, n] of TRK_SECT) { if (n > 1) ws.mergeCells(3, s, 3, s + n - 1); ws.getCell(3, s).value = l; s += n; }
    TRK_F.forEach(([, l], i) => ws.getCell(4, c + i).value = l);
    for (let r = 2; r <= 4; r++) for (let i = 0; i < 8; i++) hdr(ws.getCell(r, c + i));
  }
  ws.getRow(4).height = 51;
  let r = 5, n = 0;
  groups.forEach((g, gi) => {
    ws.getCell(r, 2).value = trkLetter(gi); ws.getCell(r, 3).value = g.name;
    for (let c = 2; c <= col0(11) + 7; c++) if (c === 2 || c === 3 || (c >= 5 && (c - 5) % 9 !== 8)) hdr(ws.getCell(r, c));
    ws.getCell(r, 3).alignment = { horizontal: 'left', vertical: 'middle' }; r++;
    for (const p of g.ps) {
      const sl = ws.getCell(r, 2), d = ws.getCell(r, 3); sl.value = ++n; d.value = p.trackerName || p.name;
      for (const c of [sl, d]) { c.border = thin; c.font = { size: 10 }; } sl.alignment = { horizontal: 'center' };
      for (let m = 0; m < 12; m++) {
        const { v } = trackCell(p.id, `${TR.y}-${pad(m + 1)}`);
        TRK_F.forEach(([k, , t], i) => {
          const c = ws.getCell(r, col0(m) + i), x = v[k]; c.border = thin; c.font = { size: 10 }; c.alignment = { horizontal: 'center', vertical: 'middle' };
          if (x === '' || x == null) return;
          if (t === 'date') { c.value = new Date(x + 'T00:00:00Z'); c.numFmt = 'dd-mmm-yy'; }
          else if (t === 'number') { c.value = +x; c.numFmt = '#,##0.00'; c.alignment = { horizontal: 'right' }; }
          else c.value = String(x);
        });
      }
      r++;
    }
  });
  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '2:4' };
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Tax Invoice Tracker ${TR.y}.xlsx`);
  toast(`Tracker ${TR.y} downloaded · ${n} projects`);
  return last;
}
