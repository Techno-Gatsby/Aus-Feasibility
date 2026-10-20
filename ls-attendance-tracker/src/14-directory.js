/* =====================================================================
   Security Personnel directory: the HR details of the LS "EMPLOYEE LIST"
   and "RESIGNATION" workbook – edited by hand, imported from that Excel,
   exported back in the same layout. Details live in e.hr; Emp ID, name,
   agency, DOJ, shift, end date and project come from the person record.
   ===================================================================== */
/** k: key in e.hr · h: column heading (spelling corrected) · m: matches the heading in an imported sheet (letters only)
    t: text | date | sel · g: editor group · o: choices · calc: worked out, not typed */
const HR_FIELDS = [
  { k: 'category', h: 'CATEGORY (A / B)', m: /^CATEGORY/, t: 'sel', o: ['', 'A', 'B', '1', '2'], g: 'Job' },
  { k: 'designation', h: 'DESIGNATION', m: /^DESIGNATION(?!AFTER)/, g: 'Job' },
  { k: 'group', h: 'LIST SECTION (BLUE BAND)', m: /^LISTSECTION/, g: 'Job' },
  { k: 'gender', h: 'GENDER', m: /GENDER|^SEX$/, t: 'sel', o: ['', 'M', 'F'], g: 'Job' },
  { k: 'dob', h: 'DOB', m: /^DOB|DATEOFBIRTH|BIRTHDATE/, t: 'date', g: 'Personal' },
  { k: 'blood', h: 'BLOOD GROUP', m: /BLOOD/, t: 'sel', o: ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'], g: 'Personal' },
  { k: 'health', h: 'HEALTH CONDITION (MAJOR ISSUES, IF ANY)', m: /^HE?A?LTH/, g: 'Personal' },
  { k: 'degree', h: 'HIGHEST QUALIFICATION', m: /DEGREE|QUALIFICATION|EDUCATION/, g: 'Personal' },
  { k: 'activities', h: 'EXTRACURRICULAR ACTIVITIES', m: /EXTRA/, g: 'Personal' },
  { k: 'licence', h: 'DRIVING LICENCE', m: /DRIVING|LICEN[CS]E/, t: 'sel', o: ['', 'YES', 'NO'], g: 'Personal' },
  { k: 'nationality', h: 'NATIONALITY', m: /NATIONAL/, g: 'Personal' },
  { k: 'languages', h: 'LANGUAGES', m: /LANGUAGE/, g: 'Personal' },
  { k: 'state', h: 'STATE', m: /^STATE/, g: 'Personal' },
  { k: 'homeAddress', h: 'HOME COUNTRY ADDRESS', m: /ADDRESS/, g: 'Personal' },
  { k: 'eid', h: 'EMIRATES ID NO.', m: /^EID|EMIRATESID/, g: 'Documents & contacts' },
  { k: 'passport', h: 'PASSPORT NO.', m: /PAS+PORT/, g: 'Documents & contacts' },
  { k: 'siraExpiry', h: 'SIRA EXPIRY DATE', m: /SIRA/, t: 'date', g: 'Documents & contacts' },
  { k: 'visaExpiry', h: 'VISA EXPIRY DATE', m: /VISA/, t: 'date', g: 'Documents & contacts' },
  { k: 'phone', h: 'CONTACT NO.', m: /^CONTACTN|^MOBILEN?O?$|^PHONE/, g: 'Documents & contacts' },
  { k: 'phone2', h: 'ADDITIONAL MOBILE NUMBERS', m: /ADDITIONALMOBILE/, g: 'Documents & contacts' },
  { k: 'altContact', h: 'ALTERNATE CONTACT / HOME COUNTRY NUMBERS', m: /ALTERNATE/, g: 'Documents & contacts' },
  { k: 'status', h: 'STATUS', m: /^STATUS/, t: 'sel', o: ['', 'ACTIVE', 'ON LEAVE', 'RESIGNED', 'TERMINATED', 'ABSCONDED', 'TRANSFERRED'], g: 'Career & discipline' },
  { k: 'promotedOn', h: 'PROMOTED ON', m: /PROMOTEDDATE|PROMOTEDON|PROMOTIONDATE/, t: 'date', g: 'Career & discipline' },
  { k: 'promotedTo', h: 'DESIGNATION AFTER PROMOTION', m: /AFTERPROMOTION/, g: 'Career & discipline' },
  { k: 'warnings', h: 'WARNING LETTERS', m: /WARNING/, g: 'Career & discipline' },
  { k: 'fines', h: 'FINES', m: /^FINE/, g: 'Career & discipline' },
  { k: 'remarks', h: 'ADDITIONAL REMARKS', m: /REMARK/, g: 'Career & discipline' }
];
const HRF = Object.fromEntries(HR_FIELDS.map(f => [f.k, f]));
/** Ranks used to order the directory's designation groups (as in the LS list); others follow alphabetically */
const HR_RANKS = ['CHIEF HSSE OFFICER', 'BUSINESS HEAD', 'VICE PRESIDENT', 'VP', 'SENIOR MANAGER', 'MANAGER', 'ASSISTANT MANAGER', 'DOCUMENT CONTROLLER', 'ADMIN', 'ACCOUNTANT', 'HR', 'OPERATIONS', 'SECURITY SUPERVISOR', 'SUPERVISOR', 'TEAM LEADER', 'CCTV OPERATOR', 'SECURITY OFFICER', 'SECURITY GUARD', 'DRIVER', 'CLEANER'];
const hrRank = d => { const n = norm(d); if (!n) return 999; const i = HR_RANKS.findIndex(r => n === r || n.startsWith(r + ' ') || n.startsWith(r + '/') || n.startsWith(r + '-')); return i < 0 ? 500 : i; };

/* ---------- worked-out values ---------- */
function fullMonthsBetween(a, b) { if (!a || !b || b < a) return null; const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number); return (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0); }
const serviceEnd = e => e.end && e.end < todayISO() ? e.end : todayISO();
const serviceYears = e => { const m = fullMonthsBetween(e.doj, serviceEnd(e)); return m == null ? '' : Math.floor(m / 12); };
const serviceText = e => { const m = fullMonthsBetween(e.doj, serviceEnd(e)); if (m == null) return ''; const y = Math.floor(m / 12), r = m % 12; return `${y} year${y === 1 ? '' : 's'} ${r} month${r === 1 ? '' : 's'}`; };
const ageOf = e => { const m = fullMonthsBetween(e.hr?.dob, todayISO()); return m == null ? '' : Math.floor(m / 12); };
const RESIGN_RE = /RESIGN|TERMINAT|ABSCOND|TRANSFER|LEFT|CANCEL/;
/** Status shown: typed one, else from the end date */
function hrStatus(e) { const s = norm(e.hr?.status); if (s) return s; if (e.end && e.end < todayISO()) return norm(e.endReason) || 'LEFT'; return 'ACTIVE'; }
/** Left the company: end date passed, or marked resigned / terminated without a date yet */
const hasLeft = e => (e.end && e.end < todayISO()) || RESIGN_RE.test(hrStatus(e));
const daysTo = d => d ? Math.round((new Date(d + 'T00:00:00') - new Date(todayISO() + 'T00:00:00')) / 86400000) : null;
const projectNameOf = e => { const a = assignOn(e, todayISO()) || e.assign?.[e.assign.length - 1]; return projOfSite(a?.site)?.name || ''; };
const shiftOf = e => (assignOn(e, todayISO()) || e.assign?.[e.assign.length - 1])?.shift || e.shift || '';

/* ---------- directory columns (on screen and in the Excel) ---------- */
// v(e): value · x: shaded (worked out) · w: width (Excel) · d: date
const DIR_COLS = resigned => [
  { h: 'EMP. CODE', v: e => e.empCode || '', w: 11, pin: 1 },
  { h: 'CATEGORY (A / B)', v: e => e.hr?.category || '', w: 10 },
  { h: 'NAME', v: e => e.name, w: 34, pin: 2, name: 1 },
  { h: 'DESIGNATION', v: e => e.hr?.designation || e.trade || '', w: 24 },
  { h: 'GENDER', v: e => e.hr?.gender || '', w: 9 },
  { h: 'DOJ', v: e => e.doj || '', d: 1, w: 12 },
  { h: 'YEARS OF SERVICE', v: serviceYears, x: 1, w: 10 },
  { h: 'SERVICE DURATION', v: serviceText, x: 1, w: 20 },
  { h: 'DOB', v: e => e.hr?.dob || '', d: 1, w: 12 },
  { h: 'AGE', v: ageOf, x: 1, w: 7 },
  ...['blood', 'health', 'degree', 'activities', 'licence'].map(k => ({ h: HRF[k].h, v: e => e.hr?.[k] || '', w: 16 })),
  { h: 'PROJECT', v: projectNameOf, w: 24 },
  { h: 'SHIFT (DAY / NIGHT)', v: shiftOf, w: 10 },
  ...['nationality', 'languages', 'state', 'homeAddress', 'eid', 'passport', 'phone', 'phone2', 'altContact'].map(k => ({ h: HRF[k].h, v: e => e.hr?.[k] || '', w: k === 'homeAddress' ? 28 : 16 })),
  { h: 'STATUS', v: hrStatus, w: 12, st: 1 },
  { h: 'SIRA EXPIRY DATE', v: e => e.hr?.siraExpiry || '', d: 1, exp: 1, w: 12 },
  { h: 'VISA EXPIRY DATE', v: e => e.hr?.visaExpiry || '', d: 1, exp: 1, w: 12 },
  ...(resigned ? [{ h: 'LWD', v: e => e.end || '', d: 1, w: 12 }]
    : [{ h: 'PROMOTED ON', v: e => e.hr?.promotedOn || '', d: 1, w: 12 }, { h: 'DESIGNATION AFTER PROMOTION', v: e => e.hr?.promotedTo || '', w: 20 },
      { h: 'WARNING LETTERS', v: e => e.hr?.warnings || '', w: 14 }, { h: 'FINES', v: e => e.hr?.fines || '', w: 10 }]),
  { h: 'AGENCY', v: e => e.agency || '', w: 14 },
  { h: resigned ? 'REMARKS' : 'ADDITIONAL REMARKS', v: e => e.hr?.remarks || '', w: 26 }
];
/** Designation groups in rank order: [[designation, [people]]] */
function dirGroups(list) {
  const g = new Map();
  for (const e of list) { const d = norm(e.hr?.group || e.hr?.designation || e.trade) || 'NOT SET'; (g.get(d) || g.set(d, []).get(d)).push(e); }
  return [...g].sort((a, b) => hrRank(a[0]) - hrRank(b[0]) || a[0].localeCompare(b[0])).map(([d, l]) => [d, l.sort((a, b) => (a.doj || '9') < (b.doj || '9') ? -1 : (a.doj || '9') > (b.doj || '9') ? 1 : a.name.localeCompare(b.name))]);
}
function directoryHTML(list, resigned) {
  const cols = DIR_COLS(resigned), N = cols.length + 1;
  const cell = (c, e) => {
    const v = c.v(e); let cls = c.x ? 'calc' : '', t = c.d ? fmtDMY(v) : v;
    if (c.exp && v) { const n = daysTo(v); cls += n < 0 ? ' expd' : n <= 30 ? ' soon' : ''; }
    if (c.st) cls += RESIGN_RE.test(v) ? ' neg' : v === 'ACTIVE' ? ' pos' : '';
    return `<td class="${cls}${c.pin ? ' pin p' + c.pin : ''}">${c.name ? `<a href="#" data-edit="${e.id}">${esc(t)}</a>` : esc(String(t ?? ''))}</td>`;
  };
  const groups = dirGroups(list);
  return `<div class="dirhead"><b>${resigned ? 'Resigned' : 'Current'}</b><span>${list.length} security personnel · grouped by designation</span></div>
    <table class="dir"><thead><tr><th class="pin p0">SL NO.</th>${cols.map(c => `<th class="${c.pin ? 'pin p' + c.pin : ''}">${esc(c.h)}</th>`).join('')}</tr></thead><tbody>
    ${groups.map(([d, l]) => `<tr class="band"><td colspan="${N}"><span>${esc(d)}</span></td></tr>${l.map((e, i) => `<tr><td class="pin p0">${i + 1}</td>${cols.map(c => cell(c, e)).join('')}</tr>`).join('')}`).join('')
      || `<tr><td colspan="${N}" class="muted">No security personnel match.</td></tr>`}</tbody></table>`;
}

/* ---------- editor section ---------- */
function hrFormHTML(e) {
  const hr = e.hr || {}, groups = [...new Set(HR_FIELDS.map(f => f.g))];
  const inp = f => f.t === 'sel' ? `<select data-hr="${f.k}">${[...new Set([...f.o, hr[f.k] || ''])].map(o => `<option value="${esc(o)}" ${o === (hr[f.k] || '') ? 'selected' : ''}>${esc(o || '—')}</option>`).join('')}</select>`
    : f.t === 'date' ? `<input type="date" data-hr="${f.k}" value="${hr[f.k] || ''}">` : `<input type="text" data-hr="${f.k}" value="${esc(hr[f.k] || '')}">`;
  const label = f => f.h.charAt(0) + f.h.slice(1).toLowerCase().replace(/\bsira\b/, 'SIRA').replace(/\bid\b/, 'ID').replace(/\b(a|b)\b/g, m => m.toUpperCase()).replace(/\bdob\b/, 'DOB');
  return `<h3 style="margin:14px 0 4px">HR details</h3>
    <p class="muted small" style="margin:0 0 6px">Years of service, service duration and age are worked out from the joining date and date of birth.${e.doj ? ` Service: <b>${esc(serviceText(e))}</b>.` : ''}${e.hr?.dob ? ` Age: <b>${ageOf(e)}</b>.` : ''}</p>
    ${groups.map(g => `<div class="hrg"><div class="hrgh">${g}</div><div class="form">${HR_FIELDS.filter(f => f.g === g).map(f => `<label class="f${f.k === 'homeAddress' || f.k === 'remarks' || f.k === 'health' ? ' wide' : ''}">${label(f)}${inp(f)}</label>`).join('')}</div></div>`).join('')}`;
}
function readHrForm(m, e) {
  const hr = { ...(e.hr || {}) };
  m.querySelectorAll('[data-hr]').forEach(i => { const v = i.value.trim(); if (v) hr[i.dataset.hr] = i.type === 'date' ? v : v.toUpperCase(); else delete hr[i.dataset.hr]; });
  e.hr = hr;
}

/* ---------- import: EMPLOYEE LIST / RESIGNATION sheets ---------- */
const hkey = v => norm(v).replace(/[^A-Z0-9]/g, '');
const IMPORT_EXTRA = [['code', /^EMPCODE|^EMPID|^EMPNO|^EMPLOYEECODE|^EMPLOYEEID/], ['name', /^NAME$|^EMPLOYEENAME|^FULLNAME/], ['doj', /^DOJ|DATEOFJOIN|JOININGDATE/], ['lwd', /^LWD|LASTWORKING/],
  ['project', /^PROJECT/], ['shift', /^SHIFT/], ['agency', /AGENCY/], ['sl', /^SLNO|^SNO/], ['calc', /DAYSSERVICE|YEARSOFSERVICE|PROBATION|SERVICEDURATION|^AGE$/]];
function hrValue(k, v) {
  if (v == null) return '';
  if (typeof v === 'number' && ['dob', 'siraExpiry', 'visaExpiry', 'promotedOn', 'doj', 'lwd'].includes(k)) return xlDate(v);
  let s = String(v).replace(/\s+/g, ' ').trim();
  if (!s || /^#(REF|N\/A|VALUE|NAME|DIV)/i.test(s) || /^#+$/.test(s) || s === '-' || s === '0') return '';
  if (['dob', 'siraExpiry', 'visaExpiry', 'promotedOn', 'doj', 'lwd'].includes(k)) return textDate(s);
  s = s.toUpperCase();
  if (k === 'nationality') s = s.replace(/^EM[AI]R[AI]T?H?I?$|^EMIRATI$|^UAE$/, 'EMIRATI').replace(/^PAKISTAN$/, 'PAKISTANI').replace(/^INDIA$/, 'INDIAN').replace(/^NEPAL$/, 'NEPALI').replace(/^BANGLADESH$/, 'BANGLADESHI').replace(/^PHILIPPINES$|^FILIPINO$/, 'FILIPINO').replace(/^SRILANKA$|^SRI LANKA$/, 'SRI LANKAN');
  if (k === 'blood') { const m = s.replace(/\s/g, '').match(/^(AB|A|B|O)(\+|-|\+VE|-VE|POS|NEG|POSITIVE|NEGATIVE)/); if (m) s = m[1] + (/^-|NEG/.test(m[2]) ? '-' : '+'); }
  if (k === 'gender') s = /^M/.test(s) ? 'M' : /^F/.test(s) ? 'F' : s;
  if (k === 'licence') s = /^Y/.test(s) ? 'YES' : /^N/.test(s) ? 'NO' : s;
  if (k === 'altContact' || k === 'phone' || k === 'phone2') s = s.replace(/^\/+\s*/, '').replace(/,\s*$/, '');
  if (k === 'shift') s = /NIGHT|^N$/.test(s) ? 'NIGHT' : /DAY|^D$/.test(s) ? 'DAY' : s;
  return s;
}
const xlDate = n => n > 20000 && n < 80000 ? new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10) : '';
function textDate(s) {
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/))) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }   // UAE: day first
  if ((m = s.match(/^(\d{1,2})[\s\-\/]([A-Za-z]{3,})[\s\-\/,]*(\d{2,4})$/))) { const mo = MON.findIndex(x => x.toUpperCase() === m[2].slice(0, 3).toUpperCase()); if (mo >= 0) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${String(mo + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`; } }
  return '';
}
/** Recognise an employee list (or resignation list): header row with EMP CODE + NAME and at least 3 HR columns */
function parseEmployeeList(rows, sheetName) {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const keys = (rows[r] || []).map(hkey), col = {};
    keys.forEach((h, c) => {
      if (!h) return;
      const x = IMPORT_EXTRA.find(([, re]) => re.test(h)); if (x) { col[x[0]] ??= c; return; }
      const f = HR_FIELDS.find(f => f.m.test(h)); if (f) col[f.k] ??= c;
    });
    if (col.code == null || col.name == null) continue;
    const hrCols = HR_FIELDS.filter(f => col[f.k] != null).length; if (hrCols < 3) continue;
    const tail = keys.length; // unnamed columns after the last heading may hold "RESIGNED"
    const resignSheet = /RESIGN|LEFT|EXIT|CANCEL/i.test(sheetName) || col.lwd != null;
    const out = []; let group = '';
    for (let i = r + 1; i < rows.length; i++) {
      const row = rows[i] || [], get = k => col[k] == null ? null : row[col[k]];
      const code = norm(get('code')), name = norm(get('name'));
      if (!code && !name) {                                   // blue band: designation group
        const t = row.find(v => v != null && String(v).trim()); if (t && typeof t === 'string' && t.trim().length > 2) group = norm(t).replace(/\s*-\s*LATINEM SECURITIES LLC$/, '').replace(/\s*-\s*$/, '');
        continue;
      }
      if (!name) continue;
      const hr = {}; for (const f of HR_FIELDS) { const v = hrValue(f.k, get(f.k)); if (v) hr[f.k] = v; }
      if (group) { hr.group = group; if (!hr.designation) hr.designation = group; }
      const lwdRaw = get('lwd'), lwd = hrValue('lwd', lwdRaw), extra = row.slice(tail).concat(row.filter((v, c) => !keys[c])).map(v => norm(v)).join(' ');
      const left = resignSheet || RESIGN_RE.test(norm(lwdRaw)) || RESIGN_RE.test(hr.status || '') || /RESIGN/.test(extra);
      if (left && !hr.status) hr.status = /TERMINAT/.test(norm(lwdRaw) + extra) ? 'TERMINATED' : 'RESIGNED';
      out.push({ code: splitIdAgency(code).empCode || code, name, hr, doj: hrValue('doj', get('doj')), lwd, left, shift: hrValue('shift', get('shift')), agency: norm(get('agency')), project: norm(get('project')) });
    }
    return out.length ? { rows: out, resign: resignSheet, cols: HR_FIELDS.filter(f => col[f.k] != null).length } : null;
  }
  return null;
}
/** Apply one imported list. Empty cells never wipe what is already entered. */
function applyEmployeeListImport(p) {
  const st = { updated: 0, created: 0, resigned: 0, noDate: [], fixed: 0 };
  for (const r of p.rows) {
    let e = findEmployee(r.code, r.name, r.agency);
    if (!e) {
      e = { id: uid('e'), empCode: r.code, name: r.name, agency: r.agency || '', trade: normTrade(r.hr.designation || 'SECURITY GUARD'), shift: r.shift || 'DAY', doj: r.doj || null, end: null, endReason: '', assign: [] };
      S.employees.push(e); IX.emp.set(e.id, e); st.created++;
    } else st.updated++;
    if (typeof IMP_TOUCH !== 'undefined') IMP_TOUCH.add(e.id);
    e.hr = { ...(e.hr || {}), ...r.hr };
    if (r.doj && !e.doj) e.doj = r.doj;
    if (r.agency && !e.agency) e.agency = r.agency;
    if (r.shift && !e.assign?.length) e.shift = r.shift;
    if (r.left) {
      st.resigned++;
      const last = Object.keys(S.att[e.id] || {}).sort().pop();
      const end = r.lwd || e.end || last || null;
      if (end) { e.end = end; e.endReason = /TERMINAT/.test(r.hr.status) ? 'TERMINATED' : /ABSCOND/.test(r.hr.status) ? 'ABSCONDED' : 'RESIGNED'; }
      else { e.endReason = 'RESIGNED'; st.noDate.push(`${e.name} ${e.empCode || ''}`.trim()); }
    }
  }
  reindex(); markDirty();
  return st;
}

/* ---------- Excel: EMPLOYEE LIST + RESIGNATION in the LS layout ---------- */
async function exportDirectoryXlsx(blank = false) {
  await loadScript(LIB.exceljs);
  const wb = new ExcelJS.Workbook(), logo = wb.addImage({ base64: LOGO.split(',')[1], extension: 'png' });
  const peach = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4D6' } }, blue = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5BC8F0' } };
  for (const resigned of [false, true]) {
    const ws = wb.addWorksheet(resigned ? 'RESIGNATION' : 'EMPLOYEE LIST', { views: [{ state: 'frozen', xSplit: 4, ySplit: 4 }], pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    const cols = DIR_COLS(resigned), heads = ['SL NO.', ...cols.map(c => c.h)];
    ws.columns = [{ width: 7 }, ...cols.map(c => ({ width: c.w }))];
    ws.mergeCells(1, 1, 3, 3); ws.addImage(logo, { tl: { col: 0.3, row: 0.3 }, ext: { width: 120, height: 60 } });
    ws.getCell(1, 4).value = (S.settings.companyShort || 'LATINEM SECURITIES') + ' LLC'; ws.getCell(3, 4).value = resigned ? 'RESIGNATION' : 'EMPLOYEE LIST';
    [ws.getCell(1, 4), ws.getCell(3, 4)].forEach(c => c.font = { bold: true, size: 12 });
    ws.getRow(1).height = 22; ws.getRow(2).height = 14; ws.getRow(3).height = 22;
    const hr = ws.getRow(4); hr.height = 42;
    heads.forEach((h, i) => { const c = hr.getCell(i + 1); c.value = h; c.font = { bold: true, size: 9 }; c.fill = peach; c.border = thin; c.alignment = { horizontal: 'center', vertical: 'bottom', wrapText: true }; });
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: heads.length } };
    let r = 5;
    const list = blank ? [] : S.employees.filter(e => hasLeft(e) === resigned);
    for (const [d, l] of dirGroups(list)) {
      const b = ws.getRow(r++); b.height = 20; b.getCell(1).value = d; b.getCell(1).font = { bold: true, size: 10 };
      for (let c = 1; c <= heads.length; c++) { b.getCell(c).fill = blue; b.getCell(c).border = thin; }
      l.forEach((e, i) => {
        const row = ws.getRow(r++); row.getCell(1).value = i + 1;
        cols.forEach((c, j) => { let v = c.v(e); if (c.d && v) v = new Date(v + 'T00:00:00Z'); const cell = row.getCell(j + 2); cell.value = v === '' ? null : v; if (c.d) cell.numFmt = 'dd-mmm-yyyy'; });
        for (let c = 1; c <= heads.length; c++) { const cell = row.getCell(c); cell.border = thin; cell.font = { size: 9 }; cell.alignment = { vertical: 'bottom', wrapText: true, horizontal: c === 1 || c === 3 ? 'center' : 'left' }; }
      });
    }
    if (blank) for (let k = 0; k < 20; k++) { const row = ws.getRow(r++); for (let c = 1; c <= heads.length; c++) row.getCell(c).border = thin; }
  }
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), blank ? 'LS EMPLOYEE LIST - TEMPLATE.xlsx' : `LS EMPLOYEE LIST ${todayISO()}.xlsx`);
}
