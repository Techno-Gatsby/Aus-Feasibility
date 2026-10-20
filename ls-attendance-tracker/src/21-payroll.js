/* =====================================================================
   Payroll → 1 Payroll sheet: the monthly payroll attendance sheet in the
   layout of "Latinem Securities Monthly Payroll Attendance" (21 → 20):
   per person per day the hours (shift hours for a worked day) or a code
   (OFF, A, AL, SL, EL…, New Joinee before joining, the leaving reason
   after the last day), then the workbook's totals – weeks, leave, LOP,
   Sunday / holiday / normal OT. Day values come from Attendance (read
   only here); the payroll-only columns are typed in S.payroll[ym][empId].
   ===================================================================== */
const PAY_DEF_CODES = { OFF: 'OFF', WO: 'OFF', PH: 'HD' };            // anything else billable → shift hours; others as written
const PAY_END = { RESIGNED: 'Resigned', TERMINATED: 'Terminated', ABSCONDED: 'Absconding', TRANSFERRED: 'Transfer Out', 'CONTRACT END': 'Exited', OTHER: 'Exited' };
const PAY_LWD = ['NVR', 'Terminated', 'Resigned', 'Medical Unfit', 'Absconding', 'Deportation', 'Death Case', 'UPC', 'Exited', 'OSCC', 'Transfer Out'];
const PAY_MAN = [['prod', 'Productivity\n Hours'], ['norest', 'No Rest/Lunch Hour'], ['arrN', 'Arrears - N OT'], ['arrSH', 'Arrears - S/H OT']];
const PV_ = { ym: null, q: '', app: false, proj: '' };
/** hours a worked day counts for this person: set per person (Hrs/day), else 16 for drivers and the shift hours (12) for others */
const empHours = e => +e.payHours || (/DRIVER/i.test(`${e.trade || ''} ${e.hr?.designation || ''}`) ? +S.settings.driverHours || 16 : +S.settings.shiftHours || 12);
/** hours worked that day from the phone app (check-in → check-out), rounded to a quarter hour; null when there are none */
function appHours(e, d) {
  let h = 0; for (const p of Object.values(S.punches || {})) if (p.wid === e.id && p.workDate === d && p.type === 'out' && p.status !== 'rejected' && +p.hours > 0) h += +p.hours;
  return h ? Math.round(h * 4) / 4 : null;
}
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const payHolidays = () => new Set(String(S.settings.holidays || '').split(/[\s,;]+/).map(trkParseDate).filter(Boolean));
/** the code → payroll value table (Settings → Payroll); 'H' = shift hours */
function payCodeMap() {
  const m = {}; for (const c of S.codes) m[c.code] = S.settings.payCodes?.[c.code] ?? (PAY_DEF_CODES[c.code] || (c.billable ? 'H' : c.code));
  return m;
}
/** days of the cycle with their weekday name ('HD' on public holidays) */
function payDays(ym) {
  const { start, end } = payrollCycle(ym), hol = payHolidays();
  return datesBetween(start, end).map(d => ({ d, dn: hol.has(d) ? 'HD' : DOW[new Date(d + 'T00:00:00Z').getUTCDay()], sun: new Date(d + 'T00:00:00Z').getUTCDay() === 0 }));
}
/** weeks Mon…Sun as index ranges into days (week 1 may be short), at most 5 like the workbook (a 6th part joins week 5) */
function payWeeks(days) {
  const w = [[]]; days.forEach((x, i) => { w[w.length - 1].push(i); if (x.sun && i < days.length - 1) w.push([]); });
  while (w.length > 5) { const a = w.pop(); w[w.length - 1].push(...a); }
  while (w.length < 5) w.push([]);
  return w;
}
function payRows(ym, all) {
  const { start, end } = payrollCycle(ym), days = payDays(ym), map = payCodeMap(), q = norm(PV_.q), out = [];
  const punchesBy = PV_.app ? new Map() : null; if (punchesBy) for (const p of Object.values(S.punches || {})) if (p.type === 'out' && p.status !== 'rejected' && +p.hours > 0) { const k = p.wid + '|' + p.workDate; punchesBy.set(k, (punchesBy.get(k) || 0) + +p.hours); }
  for (const e of S.employees) {
    if (!((!e.doj || e.doj <= end) && (!e.end || e.end >= start))) continue;
    if (q && !norm(e.name).includes(q) && !norm(e.empCode).includes(q)) continue;
    const H = empHours(e), ov = S.payroll[ym]?.[e.id]?.h || {}, src = [];
    let last = null; const v = days.map(({ d }, i) => {
      if (e.doj && d < e.doj) return 'New Joinee';
      if (e.end && d > e.end) return PAY_END[e.endReason] || 'Resigned';
      const s = siteOn(e, d); if (s) last = s;
      const c = getCell(e.id, d)?.c; if (!c) return '';
      const m = map[c]; if (m !== 'H') return /^\d+(\.\d+)?$/.test(m) ? +m : m;
      if (ov[d] > 0) { src[i] = 'o'; return ov[d]; }                       // typed in Payroll
      const a = punchesBy?.get(e.id + '|' + d); if (a) { src[i] = 'a'; return Math.round(a * 4) / 4; }
      src[i] = 'h'; return H;
    });
    if (!last) last = assignOn(e, end)?.site || e.assign?.[0]?.site || null;
    const p = projOfSite(last), site = IX.site.get(last);
    if (SEL.site && last !== SEL.site) continue;
    if (SEL.project && p?.id !== SEL.project) continue;
    if (SEL.client && p?.clientId !== SEL.client) continue;
    if (!all && PV_.proj && (p?.id || '-') !== PV_.proj) continue;
    out.push({ e, v, src, H, pid: p?.id || '-', site: site?.name || '', cost: site?.costCode || p?.orderCode || '', shift: assignOn(e, end)?.shift || e.shift || '' });
  }
  return out.sort((a, b) => (a.e.empCode || 'zz').localeCompare(b.e.empCode || 'zz'));
}
/** the workbook's totals for one row */
function payTotals(v, days, man = {}) {
  const num = x => typeof x === 'number' ? x : 0, cnt = f => v.filter(f).length, weeks = payWeeks(days).map(w => w.filter(i => days[i].dn !== 'SUN' && days[i].dn !== 'HD' && num(v[i]) > 0).length);
  const t = { hours: v.reduce((a, x) => a + num(x), 0), weeks, present: weeks.reduce((a, b) => a + b, 0),
    sl: cnt(x => x === 'SL'), al: cnt(x => x === 'AL'), ph: v.filter((x, i) => days[i].dn === 'HD' && (num(x) > 0 || x === 'HD')).length, sun: v.filter((x, i) => days[i].dn === 'SUN' && (x === 'S' || num(x) > 0)).length,
    lop: cnt(x => x === 'A'), el: cnt(x => x === 'EL'), nj: cnt(x => x === 'New Joinee'), pa: cnt(x => x === 'PA'), lwd: cnt(x => PAY_LWD.includes(x)),
    sot: v.reduce((a, x, i) => a + (days[i].dn === 'SUN' ? num(x) : 0), 0), hot: v.reduce((a, x, i) => a + (days[i].dn === 'HD' ? num(x) : 0), 0) };
  t.total = t.present + t.sl + t.al + t.ph + t.sun + t.lop + t.el + t.nj + t.pa + t.lwd;
  t.not = t.hours - t.sot - t.hot - t.present * 8;
  t.payNot = t.not + (+man.prod || 0) + (+man.norest || 0) + (+man.arrN || 0); t.paySot = t.sot + (+man.arrSH || 0);
  return t;
}
/** whose sheet it is: the chosen project, else the client / project picked in the tree, else the company */
const payWho = () => PV_.proj ? (PV_.proj === '-' ? 'UNASSIGNED' : IX.proj.get(PV_.proj)?.name || '') : SEL.project ? IX.proj.get(SEL.project)?.name || '' : SEL.client ? IX.client.get(SEL.client)?.name || '' : S.settings.companyShort || 'LATINEM SECURITIES';
const payTitle = ym => { const { start, end } = payrollCycle(ym), f = d => `${+d.slice(8, 10)} ${MONTH_FULL[+d.slice(5, 7) - 1]}`; return `${payWho().toUpperCase()} ${S.settings.payTitleTail || 'MONTHLY ATTENDANCE SHEET'} - ${f(start)} to ${f(end)} ${end.slice(0, 4)}`; };
/** projects that have personnel in this payroll month, grouped by client, with the head count */
function payProjOptions(ym) {
  const n = new Map(); for (const r of payRows(ym, true)) n.set(r.pid, (n.get(r.pid) || 0) + 1);
  const by = new Map(); for (const id of n.keys()) { const p = IX.proj.get(id), c = p && IX.client.get(p.clientId)?.name || 'Other'; if (!by.has(c)) by.set(c, []); by.get(c).push([id, p?.name || 'Not on a project']); }
  let h = `<option value="">All projects (${[...n.values()].reduce((a, b) => a + b, 0)})</option>`;
  for (const [c, ps] of [...by].sort((a, b) => a[0].localeCompare(b[0]))) h += `<optgroup label="${esc(c)}">` + ps.sort((a, b) => a[1].localeCompare(b[1])).map(([id, nm]) => `<option value="${id}"${id === PV_.proj ? ' selected' : ''}>${esc(nm)} (${n.get(id)})</option>`).join('') + '</optgroup>';
  return h;
}
const PAY_TOT_H = ['TOTAL \nHOURS', 'DAYS \nPRESENT', 'WEEK 1', 'WEEK 2', 'WEEK 3', 'WEEK 4', 'WEEK 5', 'Sick Leave', 'Annual Leave', 'Public \nHoilday', 'Sunday', 'LOP', 'Emergency \nLeave', 'Days- Prior to joining', 'Days - Prov. Attendance', 'Days - after LWD', 'TOTAL', 'Normal OT', 'Sunday OT', ...PAY_MAN.map(x => x[1]), 'Total Payable NOT Hours', 'Total Payable\n Sunday OT', 'Holiday OT', 'Remarks', 'Source'];
const payTotVals = (t, man) => [t.hours, t.present, ...t.weeks, t.sl, t.al, t.ph, t.sun, t.lop, t.el, t.nj, t.pa, t.lwd, t.total, t.not, t.sot, ...PAY_MAN.map(([k]) => man[k] ?? ''), t.payNot, t.paySot, t.hot, man.remarks || '', man.src || 'Tracker'];

function renderPayroll() {
  const v = $('#v-payroll'); PV_.ym ||= AV.ym || cycleOfDate(todayISO());
  if (PV_.proj && PV_.proj !== '-' && !IX.proj.has(PV_.proj)) PV_.proj = '';
  const ym = PV_.ym, days = payDays(ym), rows = payRows(ym), man = S.payroll[ym] || {}, { start, end } = payrollCycle(ym);
  const col = x => x === '' ? '' : typeof x === 'number' ? codeDef('P').color : x === 'HD' ? codeDef('PH').color : IX.code.has(x) ? codeDef(x).color : '#EEF1F6';   // the attendance colours
  const LIM = 150, shown = rows.slice(0, PV_.all ? rows.length : LIM), fmt = x => typeof x === 'number' ? (Number.isInteger(x) ? x : x.toFixed(2)) : esc(x);
  // the workbook's columns (S.No … Cost Code, the days, every total) in the Attendance grid; S.No / code / name stay fixed
  const W = [40, 76, 210], L = []; W.reduce((a, w, k) => (L[k] = a, a + w), 0);
  const XW = [80, 140, 170, 58, 130, 46, 96], XH = ['DOJ', 'Designation', 'Department/ Sub-Department', 'Division', 'Business Unit', 'Shift', 'Cost Code'];
  const dw = 34, TW = PAY_TOT_H.map(h => /Remarks/.test(h) ? 150 : /Source/.test(h) ? 64 : 54), width = W.reduce((a, b) => a + b, 0) + XW.reduce((a, b) => a + b, 0) + 46 + days.length * dw + TW.reduce((a, b) => a + b, 0);
  const all = { hours: 0, present: 0, lop: 0, off: 0, leave: 0, not: 0, sot: 0, hot: 0 }, perDay = days.map(() => 0);
  const rowsHTML = rows.map((r, i) => {
    const m = man[r.e.id] || {}, t = payTotals(r.v, days, m), tv = payTotVals(t, m);
    all.hours += t.hours; all.present += t.present; all.lop += t.lop; all.off += r.v.filter(x => x === 'OFF').length; all.leave += t.sl + t.al + t.el; all.not += t.not; all.sot += t.sot; all.hot += t.hot;
    r.v.forEach((x, j) => { if (typeof x === 'number') perDay[j] += x; });
    if (i >= shown.length) return '';
    return `<tr><td class="fix r" style="left:${L[0]}px">${i + 1}</td><td class="fix" style="left:${L[1]}px;font-family:var(--font-mono);font-size:11px">${esc(r.e.empCode || '')}</td><td class="fix nm edge" style="left:${L[2]}px">${esc(r.e.name)}</td>`
      + [r.e.doj ? fmtDMY(r.e.doj) : '', r.e.trade || '', r.site, 'LS', S.settings.companyShort || '', r.shift, r.cost].map((x, j) => `<td class="pi"${j === 2 || j === 1 ? ' style="text-align:left"' : ''} title="${esc(x)}">${esc(x)}</td>`).join('') + `
      <td class="py-hd ed" data-hd="${r.e.id}" title="Hours a worked (P) day counts for ${esc(r.e.name)} – click to change">${r.H}</td>`
      + r.v.map((x, j) => `<td class="d${r.src[j] ? ' ed s' + r.src[j] : ''}" style="${x === '' ? '' : `background:${col(x)}`}"${r.src[j] ? ` data-ph="${r.e.id}|${days[j].d}" title="${r.src[j] === 'o' ? 'Typed in Payroll' : r.src[j] === 'a' ? 'From the phone app check-in / check-out' : 'Hrs/day of this person'} – click to change"` : ''}>${esc(x)}</td>`).join('')
      + tv.map((x, j) => { const k = j - 19; const ed = k >= 0 && k < 4 ? PAY_MAN[k][0] : j === tv.length - 2 ? 'remarks' : null; return `<td class="tot${ed ? ' ed' : ''}${j === tv.length - 2 ? ' rm' : ''}"${ed ? ` data-pm="${r.e.id}|${ed}"` : ''}>${fmt(x)}</td>`; }).join('') + '</tr>';
  }).join('');
  const k = (lbl, n, c) => `<span class="st"><b style="color:${c}">${Number(Math.round(n * 100) / 100).toLocaleString()}</b> ${lbl}</span>`;
  v.innerHTML = docHead('Payroll attendance <span class="tk-help" title="Days come from Attendance (change them there). Worked (P) days show each person\'s hours – drivers 16, others 12 by default; click Hrs/day to change a person, or a day to change that day (never 0). Pick a project to get its own sheet – the title, totals and Excel follow it. Codes, public holidays and the title wording are in Settings → Payroll. Productivity, no-rest, arrears and remarks are typed here. The columns are those of the payroll workbook; Hrs/day is only on screen.">?</span>', esc(payTitle(ym)), `
      <label class="small">Payroll month <input type="month" id="py-ym" value="${ym}"></label>
      <select id="py-proj" style="max-width:260px" title="Project – people count on the project of the site they last worked that month">${payProjOptions(ym)}</select>
      <input type="search" id="py-q" placeholder="Name or ID" value="${esc(PV_.q)}" style="width:140px">
      <label class="small" title="Worked days show the hours between check-in and check-out in the phone app, where there are punches"><input type="checkbox" id="py-app"${PV_.app ? ' checked' : ''}> Hours from app punches</label>
      <button class="btn sm pri" id="py-xl">Download Excel</button>`)
    + `<div class="statline">${k('personnel', rows.length, 'var(--heading)')}${k('hours', all.hours, 'var(--pos)')}${k('days present', all.present, 'var(--heading)')}${k('LOP (A)', all.lop, 'var(--neg)')}${k('off', all.off, 'var(--text2)')}${k('leave', all.leave, 'var(--warn)')}${k('normal OT', all.not, 'var(--accent)')}${k('Sunday OT', all.sot, 'var(--accent)')}${k('holiday OT', all.hot, 'var(--accent)')}</div>
    <div class="pywrap"><table class="ag py" style="width:${width}px;--dw:${dw}px"><colgroup>${[...W, ...XW].map(w => `<col style="width:${w}px">`).join('')}<col style="width:46px">${days.map(() => `<col style="width:${dw}px">`).join('')}${TW.map(w => `<col style="width:${w}px">`).join('')}</colgroup><thead>
      <tr>${['S.No', 'Employee Code', 'Employee Name'].map((h, i) => `<th class="fix${i === 2 ? ' edge' : ''}" rowspan="2" style="left:${L[i]}px${i === 2 ? ';text-align:left' : ''}">${h}</th>`).join('')}${XH.map(h => `<th rowspan="2" class="pt">${h}</th>`).join('')}<th rowspan="2" title="Hours a worked (P) day counts for each person (not in the Excel – it sets the day values)">Hrs/ day</th>
        ${days.map(x => `<th class="${x.dn === 'HD' ? 'hd' : x.dn === 'SUN' ? 'we' : ''}">${x.dn === 'HD' ? 'HD' : x.dn.slice(0, 2)}</th>`).join('')}${PAY_TOT_H.map(h => `<th rowspan="2" class="pt">${esc(h)}</th>`).join('')}</tr>
      <tr>${days.map((x, j) => `<th class="${x.dn === 'HD' ? 'hd' : x.dn === 'SUN' ? 'we' : ''}" title="${fmtDMY(x.d)}">${+x.d.slice(8)}${x.d.slice(8) === '01' || !j ? `<span class="mo">${MON[+x.d.slice(5, 7) - 1]}</span>` : ''}</th>`).join('')}</tr>
    </thead><tbody>${rowsHTML || `<tr><td colspan="40" class="muted" style="padding:20px">No personnel in this payroll month.</td></tr>`}</tbody>
    <tfoot><tr><td class="fix edge" colspan="3" style="left:0;text-align:right;padding-right:8px">Hours per day</td><td colspan="${XH.length + 1}"></td>${perDay.map(n => `<td>${n ? Math.round(n) : ''}</td>`).join('')}<td>${Math.round(all.hours)}</td><td colspan="${PAY_TOT_H.length - 1}"></td></tr></tfoot></table>
    ${rows.length > shown.length ? `<div class="row tk-more"><span class="muted small">Showing ${shown.length} of ${rows.length} – totals and the Excel include everyone.</span><button class="btn sm" id="py-all">Show all</button></div>` : ''}</div>`;
  $('#py-ym', v).onchange = e => { PV_.ym = e.target.value; renderPayroll(); };
  let qt; $('#py-q', v).oninput = e => { clearTimeout(qt); qt = setTimeout(() => { PV_.q = e.target.value; renderPayroll(); const q = $('#py-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 300); };
  $('#py-app', v).onchange = e => { PV_.app = e.target.checked; renderPayroll(); };
  $('#py-proj', v).onchange = e => { PV_.proj = e.target.value; PV_.all = false; renderPayroll(); };
  $('#py-xl', v).onclick = () => exportPayrollXlsx(ym).catch(e => toast(e.message, 6000));
  $('#py-all', v)?.addEventListener('click', () => { PV_.all = true; renderPayroll(); });
  $('.py', v).onclick = e => {
    const hd = e.target.closest('td[data-ph],td[data-hd]');
    if (hd && !hd.querySelector('input')) return payHoursEdit(hd, ym);
    const td = e.target.closest('td[data-pm]'); if (!td || td.querySelector('input')) return;
    const [id, k] = td.dataset.pm.split('|'), cur = S.payroll[ym]?.[id]?.[k] ?? '', inp = document.createElement('input');
    inp.type = k === 'remarks' ? 'text' : 'number'; inp.step = '0.5'; inp.className = 'tk-in'; inp.value = cur; td.textContent = ''; td.appendChild(inp); inp.focus();
    let done = false; const fin = save => { if (done) return; done = true; if (save && inp.value !== String(cur)) { const r = ((S.payroll[ym] ||= {})[id] ||= {}); if (inp.value === '') delete r[k]; else r[k] = k === 'remarks' ? inp.value : +inp.value; markDirty(); } renderPayroll(); };
    inp.onkeydown = ev => { if (ev.key === 'Enter') fin(true); else if (ev.key === 'Escape') fin(false); };
    inp.onblur = () => fin(true);
  };
}
/** hours of one worked day (typed in Payroll), or a person's Hrs/day; a worked day can never be 0 hours */
function payHoursEdit(td, ym) {
  const day = td.dataset.ph, [id, d] = (day || td.dataset.hd).split('|'), e = IX.emp.get(id), cur = day ? S.payroll[ym]?.[id]?.h?.[d] ?? '' : e.payHours ?? '';
  const inp = document.createElement('input'); inp.type = 'number'; inp.step = '0.25'; inp.min = '0.25'; inp.className = 'tk-in'; inp.value = cur || td.textContent; inp.placeholder = String(empHours(e));
  td.textContent = ''; td.appendChild(inp); inp.focus(); inp.select();
  let done = false; const fin = save => {
    if (done) return; const x = inp.value.trim();
    if (save && x !== '' && !(+x > 0 && +x <= 24)) { toast('A worked day needs hours between 0.25 and 24 (leave empty for the default)'); inp.focus(); return; }
    done = true;
    if (save) {
      if (day) { const r = ((S.payroll[ym] ||= {})[id] ||= {}), h = r.h ||= {}; if (x === '' || +x === (PV_.app && appHours(e, d)) || (+x === empHours(e) && !(PV_.app && appHours(e, d)))) delete h[d]; else h[d] = +x; }
      else { if (x === '') delete e.payHours; else e.payHours = +x; }
      markDirty();
    }
    renderPayroll();
  };
  inp.onkeydown = ev => { if (ev.key === 'Enter') fin(true); else if (ev.key === 'Escape') { done = true; renderPayroll(); } };
  inp.onblur = () => fin(true);
}
/** the workbook's layout with its formulas: day columns from K, totals after, hidden Abstract sheet */
async function exportPayrollXlsx(ym) {
  await loadScript(LIB.exceljs);
  const days = payDays(ym), rows = payRows(ym), man = S.payroll[ym] || {}, { start, end } = payrollCycle(ym), n = days.length;
  const wb = new ExcelJS.Workbook(), name = `${MON[+start.slice(5, 7) - 1]} - ${MON[+end.slice(5, 7) - 1]}`, ws = wb.addWorksheet(name, { views: [{ state: 'frozen', xSplit: 2, ySplit: 2 }] });
  const L = c => colL(c - 1), D0 = 11, DL = D0 + n - 1, T = DL + 1;               // K = first day; totals from the column after the last day
  const col = Object.fromEntries(['hours', 'present', 'w1', 'w2', 'w3', 'w4', 'w5', 'sl', 'al', 'ph', 'sun', 'lop', 'el', 'nj', 'pa', 'lwd', 'total', 'not', 'sot', 'prod', 'norest', 'arrN', 'arrSH', 'payNot', 'paySot', 'hot', 'remarks', 'src'].map((k, i) => [k, T + i]));
  const head = { font: { name: 'Calibri', size: 10, bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }, border: thin, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } };
  ws.mergeCells(1, 1, 1, D0 - 1); ws.getCell(1, 1).value = payTitle(ym); ws.getCell(1, 1).font = { bold: true, size: 10.5 };
  ws.getCell(1, 1).alignment = { vertical: 'middle', wrapText: true }; ws.getRow(1).height = 30;   // wraps within A–J instead of running over the day names
  days.forEach((x, i) => { const c = ws.getCell(1, D0 + i); c.value = x.dn; Object.assign(c, { font: head.font, alignment: head.alignment }); });
  const H2 = ['S.No', 'Employee Code', 'Employee Name', 'DOJ', 'Designation', 'Department/Sub-Department', 'Division', 'Business Unit', 'Shift', 'COST CODE', ...days.map(x => ' ' + x.d), ...PAY_TOT_H];
  H2.forEach((h, i) => { const c = ws.getCell(2, i + 1); Object.assign(c, head); if (i >= D0 - 1 && i < DL) { c.value = new Date(days[i - D0 + 1].d + 'T00:00:00Z'); c.numFmt = 'dd/mm'; } else c.value = h; });
  ws.getRow(2).height = 45;
  [6, 12, 28, 11, 16, 22, 8, 20, 7, 13].forEach((w, i) => ws.getColumn(i + 1).width = w);
  for (let i = 0; i < n; i++) ws.getColumn(D0 + i).width = 5.5;
  for (let c = T; c <= col.src; c++) ws.getColumn(c).width = 9; ws.getColumn(col.remarks).width = 24;
  const wk = payWeeks(days), rng = (r, idx) => { const parts = []; let a = null, b = null; for (const i of idx) { if (days[i].dn === 'SUN' || days[i].dn === 'HD') { if (a != null) parts.push([a, b]); a = null; continue; } if (a == null) a = i; b = i; } if (a != null) parts.push([a, b]); return parts.map(([x, y]) => `COUNTIF(${L(D0 + x)}${r}${x === y ? '' : ':' + L(D0 + y) + r},">0")`).join('+') || '0'; };
  const R1 = `$${L(D0)}$1:$${L(DL)}$1`;
  rows.forEach((x, i) => {
    const r = i + 3, m = man[x.e.id] || {}, dr = `${L(D0)}${r}:${L(DL)}${r}`, dra = `$${L(D0)}${r}:$${L(DL)}${r}`;
    const vals = [i + 1, x.e.empCode || '', x.e.name, x.e.doj ? new Date(x.e.doj + 'T00:00:00Z') : '', x.e.trade || '', x.site, 'LS', S.settings.companyShort || '', x.shift, x.cost, ...x.v];
    vals.forEach((v, j) => { const c = ws.getCell(r, j + 1); c.value = v === '' ? null : v; c.border = thin; c.font = { name: 'Calibri', size: 10 }; if (j === 3) c.numFmt = 'dd-mmm-yy'; if (j >= 10) c.alignment = { horizontal: 'center' }; });
    const t = payTotals(x.v, days, m), F = (k, f, res) => { const c = ws.getCell(r, col[k]); c.value = { formula: f, result: res }; c.border = thin; c.alignment = { horizontal: 'center' }; };
    F('hours', `SUM(${dr})`, t.hours); F('present', `+SUM(${L(col.w1)}${r}:${L(col.w5)}${r})`, t.present);
    wk.forEach((w, k) => F('w' + (k + 1), rng(r, w), t.weeks[k]));
    F('sl', `COUNTIF(${dr},"=SL")`, t.sl); F('al', `COUNTIF(${dr},"AL")`, t.al);
    F('ph', `COUNTIFS(${R1},"HD",${dra},">0")+COUNTIFS(${R1},"HD",${dra},"HD")`, t.ph); F('sun', `COUNTIFS(${R1},"SUN",${dra},"S")+COUNTIFS(${R1},"SUN",${dra},">0")`, t.sun);
    F('lop', `COUNTIF(${dr},"=A")`, t.lop); F('el', `COUNTIF(${dr},"EL")`, t.el); F('nj', `COUNTIF(${dr},"New Joinee")`, t.nj); F('pa', `COUNTIF(${dr},"PA")`, t.pa);
    F('lwd', PAY_LWD.map(w => `COUNTIF(${dr},"${w}")`).join('+'), t.lwd); F('total', `+SUM(${L(col.w1)}${r}:${L(col.lwd)}${r})`, t.total);
    F('not', `(${L(col.hours)}${r}-${L(col.sot)}${r}-${L(col.hot)}${r})-((SUM(${['w1', 'w2', 'w3', 'w4', 'w5'].map(k => L(col[k]) + r).join(',')})*8))`, t.not);
    F('sot', `SUMIF(${R1},"SUN",${dra})`, t.sot);
    for (const [k] of PAY_MAN) { const c = ws.getCell(r, col[k]); c.value = m[k] ?? null; c.border = thin; }
    F('payNot', `${L(col.not)}${r}+${L(col.prod)}${r}+${L(col.norest)}${r}+${L(col.arrN)}${r}`, t.payNot); F('paySot', `${L(col.sot)}${r}+${L(col.arrSH)}${r}`, t.paySot);
    F('hot', `SUMIF(${R1},"HD",${dra})`, t.hot);
    ws.getCell(r, col.remarks).value = m.remarks || null; ws.getCell(r, col.src).value = m.src || 'Tracker';
    for (const k of ['remarks', 'src']) ws.getCell(r, col[k]).border = thin;
  });
  // Abstract (hidden), as in the workbook
  const ab = wb.addWorksheet('Abstract', { state: 'hidden', views: [{ state: 'frozen', xSplit: 5, ySplit: 2 }] }), q = `'${name}'!`;
  ab.getCell('A1').value = `${payWho()} Monthly Payroll Abstract Summary - ${+start.slice(8, 10)} ${MON[+start.slice(5, 7) - 1].toUpperCase()} to ${+end.slice(8, 10)} ${MON[+end.slice(5, 7) - 1].toUpperCase()} ${end.slice(0, 4)}`;
  const AH = ['S.No', 'EMP. NO', 'NAME', 'Date of Joining', 'Trade', 'Project', 'Division', 'Present Days', 'Weekly Off', 'Public Holiday', 'Paid Leave', 'Sick Leave', 'Days- Prior to joining', 'Days - after LWD', 'Annual Leave', 'Emergency Leave', 'LOP', 'Total', 'Current Month Normal OT', 'Current Month Sunday OT', 'Productivity Hrs(OT)', 'Previous Month NOT Arrears', 'Previous Month HOT/SOT Arrears', 'Total Normal OT', 'Total Sunday OT', 'Holiday OT', 'Remarks'];
  const AS = ['A', 'B', 'C', 'D', 'E', 'G', 'F', L(col.present), L(col.sun), L(col.ph), null, L(col.sl), L(col.nj), L(col.lwd), L(col.al), L(col.el), L(col.lop), L(col.total), L(col.not), L(col.sot), L(col.prod), null, null, L(col.payNot), L(col.paySot), L(col.hot), null];
  AH.forEach((h, i) => { const c = ab.getCell(2, i + 1); c.value = h; Object.assign(c, head); });
  rows.forEach((x, i) => AS.forEach((s, j) => { if (s) ab.getCell(i + 3, j + 1).value = { formula: `${q}${s}${i + 3}` }; }));
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${PV_.proj || SEL.project || SEL.client ? payWho() + ' – ' : ''}Latinem Securities Monthly Payroll Attendance - ${MONTH_FULL[+end.slice(5, 7) - 1][0]}${MONTH_FULL[+end.slice(5, 7) - 1].slice(1).toLowerCase()} ${end.slice(0, 4)} ${+start.slice(8, 10)} to ${+end.slice(8, 10)}.xlsx`);
  toast(`Payroll sheet downloaded · ${rows.length} personnel`);
}
/** Settings → Payroll */
function paySettingsHTML() {
  const m = payCodeMap(), st = S.settings;
  return `<div class="form"><label class="f wide">Sheet title after the project name <span class="muted small">(e.g. ${esc(payTitle(PV_.ym || cycleOfDate(todayISO())))})</span><input type="text" id="ps-title" value="${esc(st.payTitleTail || 'MONTHLY ATTENDANCE SHEET')}"></label>
    <label class="f">Hours for drivers (P day)<input type="number" id="ps-drv" min="1" max="24" value="${+st.driverHours || 16}"></label>
    <label class="f wide">Public holidays <span class="muted small">(dates, comma separated – e.g. 28.08.2026, 02.12.2026)</span><input type="text" id="ps-hol" value="${esc(String(st.holidays || '').split(/[\s,;]+/).filter(Boolean).map(trkDate).join(', '))}"></label></div>
    <div class="muted small" style="margin:8px 0 4px">What each attendance code puts in the payroll sheet – <b>H</b> = the shift hours of the person (Hrs/day: drivers ${+st.driverHours || 16}, others ${+st.shiftHours || 12}), or a number of hours, or text such as OFF.</div>
    <div class="pc-grid">${S.codes.map(c => `<label><span class="pill" style="background:${c.color}">${esc(c.code)}</span><input type="text" data-pc="${esc(c.code)}" value="${esc(m[c.code])}"></label>`).join('')}</div>`;
}
function bindPaySettings(v) {
  $('#ps-title', v).onchange = e => { S.settings.payTitleTail = e.target.value.trim(); markDirty(); };
  $('#ps-drv', v).onchange = e => { S.settings.driverHours = +e.target.value || 16; markDirty(); };
  $('#ps-hol', v).onchange = e => { const ds = e.target.value.split(/[\s,;]+/).filter(Boolean).map(trkParseDate); if (ds.includes(null)) return toast('Type dates as 28.08.2026'); S.settings.holidays = ds.join(','); markDirty(); };
  v.querySelectorAll('[data-pc]').forEach(i => i.onchange = () => { (S.settings.payCodes ||= {})[i.dataset.pc] = i.value.trim().toUpperCase() === 'H' ? 'H' : i.value.trim(); markDirty(); });
}
