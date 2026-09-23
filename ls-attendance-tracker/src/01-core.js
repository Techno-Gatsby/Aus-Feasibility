'use strict';
/* =====================================================================
   LS Attendance Tracker - core: utilities, dates, state, persistence
   ===================================================================== */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = p => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const norm = s => String(s ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
const pad = n => String(n).padStart(2, '0');
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const money = n => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = n => (Math.round(n * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });

/* ---------- dates (ISO 'YYYY-MM-DD', computed in UTC to avoid DST/timezone drift) ---------- */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const toDate = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const isoOf = dt => `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
const addDays = (iso, n) => { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return isoOf(d); };
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dim = ym => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const addMonths = (ym, n) => { let [y, m] = ym.split('-').map(Number); m += n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${pad(m)}`; };
const ymOf = iso => iso.slice(0, 7);
const weekday = iso => toDate(iso).getUTCDay();
const fmtDMY = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '';
const fmtDotDMY = iso => iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '';
const fmtMonYY = ym => `${MON[+ym.slice(5, 7) - 1]}-${ym.slice(2, 4)}`;
const fmtMonthName = ym => `${MONTH_FULL[+ym.slice(5, 7) - 1]}-${ym.slice(0, 4)}`;
function datesBetween(a, b) { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; }
function monthDates(ym) { return datesBetween(ym + '-01', `${ym}-${pad(dim(ym))}`); }
function monthsBetween(a, b) { const out = []; for (let m = a; m <= b; m = addMonths(m, 1)) out.push(m); return out; }

/** Payroll cycle named after the month it ends in, e.g. 2026-07 => 21/06/2026 - 20/07/2026 */
function payrollCycle(ym) {
  const sd = +S.settings.cycleStartDay || 1;
  if (sd <= 1) return { start: ym + '-01', end: `${ym}-${pad(dim(ym))}` };
  const prev = addMonths(ym, -1);
  const start = `${prev}-${pad(Math.min(sd, dim(prev)))}`;
  const end = addDays(`${ym}-${pad(Math.min(sd, dim(ym)))}`, -1);
  return { start, end };
}
function cycleOfDate(iso) {
  const sd = +S.settings.cycleStartDay || 1;
  if (sd <= 1) return ymOf(iso);
  return (+iso.slice(8, 10) >= sd) ? addMonths(ymOf(iso), 1) : ymOf(iso);
}

/** Parse the many date shapes found in the Excel sheets. Returns ISO or null. */
function parseAnyDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null;                  // Excel serial window ~1954-2119
    return isoOf(new Date(Math.round((v - 25569) * 86400000)));
  }
  const s = String(v).trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/))) {
    let a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000;
    let mo = a, d = b;                              // the master sheet shows M/D/YYYY
    if (a > 12) { d = a; mo = b; }                  // unambiguous D/M/Y
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${pad(mo)}-${pad(d)}`;
  }
  return null;
}
/** 'Jun-26', 'June 2026', 'JUN 2026', Excel serial, Date -> 'YYYY-MM' */
function parseAnyMonth(v) {
  const iso = parseAnyDate(v); if (iso) return ymOf(iso);
  const s = norm(v); const m = s.match(/^([A-Z]{3,9})[\s\-']*(\d{2,4})$/);
  if (!m) return null;
  const mi = MON.findIndex(x => m[1].startsWith(x.toUpperCase()));
  if (mi < 0) return null;
  let y = +m[2]; if (y < 100) y += 2000;
  return `${y}-${pad(mi + 1)}`;
}

/* ---------- state ---------- */
let S = null;               // the whole data model
const IX = { site: new Map(), proj: new Map(), client: new Map(), emp: new Map(), code: new Map() };

function defaultState() {
  return {
    version: 1,
    savedAt: null,
    settings: {
      company: 'Latinem Securities L.L.C.',
      companyShort: 'LATINEM SECURITIES',
      address: 'PO BOX 125250\nDUBAI\nUNITED ARAB EMIRATES',
      tel: '+971 44238064',
      trn: '100551377300003',
      formNo: 'LS/DO/F-026', revNo: '00', formDate: '06.01.2021',
      tsTitle: 'SECURITY GUARD - MONTHLY BILLING TIME SHEET',
      cycleStartDay: 21,
      preparedBy: 'MUHAMMAD ALI',
      shiftHours: 12,
      shifts: ['DAY', 'NIGHT'],
      trades: ['SECURITY GUARD', 'CCTV OPERATOR', 'TEAM LEADER', 'ASST. SUPERVISOR', 'SUPERVISOR', 'SENIOR SUPERVISOR', 'TRAINING SUP'],
      signatories: [
        { label: 'PREPARED BY:', name: 'Sandeep.C50984 SANDEEP TK', title: 'DOCUMENT CONTROLLER - HSSE' },
        { label: 'ACKNOWLEDGE BY:', name: 'C14732 SHAHZAD MUHAMMAD', title: 'MANAGER - LS' },
        { label: 'VERIFIED BY:', name: 'C10143 MUHAMMED NISAR SAYED', title: 'VP - HSSE' },
        { label: 'APPROVED BY:', name: 'Dr. MANOJ GOPALAKRISHNAN', title: 'CHIEF HSSE OFFICER & BUSINESS HEAD - LATINEM SECURITIES LLC' },
        { label: 'ACCEPTED BY:', name: '', title: 'CLIENT' }
      ]
    },
    // billable = counted in client totals & invoices; client = printed on the client timesheet
    codes: [
      { code: 'P', label: 'Present', color: '#c9efd3', billable: true, client: true, key: 'p' },
      { code: 'R', label: 'Reliever', color: '#cfe0ff', billable: true, client: true, key: 'r' },
      { code: 'A', label: 'Absent', color: '#ffd0cc', billable: false, client: false, key: 'a' },
      { code: 'OFF', label: 'Day off', color: '#e4e7ec', billable: false, client: false, key: 'o' },
      { code: 'AL', label: 'Annual leave', color: '#ffeaa8', billable: false, client: false, key: 'l' },
      { code: 'SL', label: 'Sick leave', color: '#fcd9b6', billable: false, client: false, key: 's' },
      { code: 'EL', label: 'Emergency leave', color: '#f5d0fe', billable: false, client: false, key: 'e' },
      { code: 'SIRA', label: 'SIRA exam / training', color: '#d5f3f7', billable: false, client: false, key: 't' }
    ],
    clients: [],      // {id,name,trn,customerCode,address}
    projects: [],     // {id,clientId,code,name,entityName,poNo,woiNo,billing:{basis,rate,vat,posts},active}
    sites: [],        // {id,projectId|null,name}
    employees: [],    // {id,empCode,name,agency,trade,shift,doj,end,endReason,assign:[{from,site,shift}]}
    att: {},          // att[empId][iso] = 'P' | {c:'R', s:siteId, sh:'NIGHT'}
    locks: {},        // locks['2026-07'] = true  (payroll month)
    invoices: []
  };
}

function reindex() {
  IX.site = new Map(S.sites.map(x => [x.id, x]));
  IX.proj = new Map(S.projects.map(x => [x.id, x]));
  IX.client = new Map(S.clients.map(x => [x.id, x]));
  IX.emp = new Map(S.employees.map(x => [x.id, x]));
  IX.code = new Map(S.codes.map(x => [x.code, x]));
}
function migrate(st) {
  const d = defaultState();
  st.settings = Object.assign({}, d.settings, st.settings || {});
  for (const k of ['codes', 'clients', 'projects', 'sites', 'employees', 'invoices']) if (!Array.isArray(st[k])) st[k] = d[k];
  st.att = st.att || {}; st.locks = st.locks || {};
  for (const e of st.employees) { e.assign = (e.assign || []).sort((a, b) => a.from < b.from ? -1 : 1); }
  st.version = 1;
  return st;
}

/* ---------- attendance helpers ---------- */
function getCell(empId, d) { const v = S.att[empId]?.[d]; if (!v) return null; return typeof v === 'string' ? { c: v } : v; }
function putCell(empId, d, val) {
  if (!val || !val.c) { if (S.att[empId]) { delete S.att[empId][d]; } return; }
  (S.att[empId] ||= {});
  S.att[empId][d] = (val.s || val.sh) ? { c: val.c, ...(val.s ? { s: val.s } : {}), ...(val.sh ? { sh: val.sh } : {}) } : val.c;
}
function assignOn(emp, d) { let a = null; for (const x of emp.assign || []) { if (x.from <= d) a = x; else break; } return a; }
function siteOn(emp, d) { const c = getCell(emp.id, d); return c?.s || assignOn(emp, d)?.site || null; }
function shiftOn(emp, d) { const c = getCell(emp.id, d); return c?.sh || assignOn(emp, d)?.shift || emp.shift || ''; }
function employedOn(emp, d) { return (!emp.doj || d >= emp.doj) && (!emp.end || d <= emp.end); }
function isLocked(d) { return !!S.locks[cycleOfDate(d)]; }
function codeDef(c) { return IX.code.get(c) || { code: c, label: c, color: '#f2f4f7', billable: false, client: false }; }
function empCodeLabel(e) { return e.empCode || (e.agency ? `SUBCON (${e.agency})` : ''); }
function siteName(id) { return IX.site.get(id)?.name || ''; }
function projOfSite(id) { const s = IX.site.get(id); return s ? IX.proj.get(s.projectId) || null : null; }
function sitesOfProject(pid) { return S.sites.filter(s => s.projectId === pid); }
function setAssignment(emp, from, site, shift) {
  emp.assign = (emp.assign || []).filter(a => a.from !== from);
  emp.assign.push({ from, site, shift: shift || emp.shift || '' });
  emp.assign.sort((a, b) => a.from < b.from ? -1 : 1);
  // collapse consecutive identical entries
  emp.assign = emp.assign.filter((a, i, arr) => i === 0 || a.site !== arr[i - 1].site || a.shift !== arr[i - 1].shift);
}

/* ---------- small UI helpers ---------- */
const pageHead = (t, d, act = '') => `<div class="ph-row"><div class="grow"><h2 class="ph">${t}</h2><p class="pd">${d}</p></div>${act}</div>`;
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast._t); toast._t = setTimeout(() => t.style.display = 'none', ms); }
function openModal(title, bodyHTML, buttons = [], opts = {}) {
  const m = $('#modal');
  m.style.width = opts.width || '';
  m.innerHTML = `<div class="mh"><h3>${esc(title)}</h3><button class="btn sm" data-x>✕</button></div>
    <div class="mb">${bodyHTML}</div>
    <div class="mf">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-b="${i}">${esc(b.label)}</button>`).join('')}</div>`;
  $('#modal-bg').classList.add('on');
  m.querySelector('[data-x]').onclick = closeModal;
  buttons.forEach((b, i) => m.querySelector(`[data-b="${i}"]`).onclick = async () => { const r = await b.onClick?.(m); if (r !== false) closeModal(); });
  setTimeout(() => { if (!m.contains(document.activeElement)) m.querySelector('input,select,textarea')?.focus(); }, 30);
  return m;
}
function closeModal() { $('#modal-bg').classList.remove('on'); $('#modal').innerHTML = ''; }
function confirmBox(msg, okLabel = 'OK', cls = 'pri') {
  return new Promise(res => openModal('Please confirm', `<p style="white-space:pre-line">${esc(msg)}</p>`, [
    { label: 'Cancel', onClick: () => res(false) }, { label: okLabel, cls, onClick: () => res(true) }]));
}
function opts(list, sel, blank) {
  return (blank != null ? `<option value="">${esc(blank)}</option>` : '') +
    list.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}"${String(v) === String(sel ?? '') ? ' selected' : ''}>${esc(l)}</option>`; }).join('');
}
function siteOptions(sel, blank = '— none —') {
  let h = blank != null ? `<option value="">${esc(blank)}</option>` : '';
  const groups = [...S.projects].sort((a, b) => a.name.localeCompare(b.name)).map(p => [p.name, sitesOfProject(p.id)]);
  const unm = S.sites.filter(s => !s.projectId || !IX.proj.has(s.projectId));
  if (unm.length) groups.push(['(Unmapped sites)', unm]);
  for (const [g, ss] of groups) {
    if (!ss.length) continue;
    h += `<optgroup label="${esc(g)}">` + ss.map(s => `<option value="${s.id}"${s.id === sel ? ' selected' : ''}>${esc(s.name)}</option>`).join('') + '</optgroup>';
  }
  return h;
}

const libs = {};
function loadScript(url) {
  return libs[url] ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = url; s.onload = res; s.onerror = () => { delete libs[url]; rej(new Error('Could not load ' + url + ' (internet connection needed for Excel/PDF features)')); }; document.head.appendChild(s); });
}
const LIB = {
  xlsx: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  exceljs: 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
  pdflib: 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js'
};
function downloadBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }

/* ---------- persistence: IndexedDB cache + JSON data file in a chosen folder ---------- */
const IDB = {
  db: null,
  open() { return this.db ||= new Promise((res, rej) => { const r = indexedDB.open('ls-attendance-tracker', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  async get(k) { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  async set(k, v) { const db = await this.open(); return new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }
};
const store = { dirty: false, saving: false, last: null, error: null, timer: null };
function markDirty() { store.dirty = true; renderSaveState(); clearTimeout(store.timer); store.timer = setTimeout(saveNow, 500); }
async function saveNow() {
  clearTimeout(store.timer);
  if (store.saving) { store.timer = setTimeout(saveNow, 300); return; }
  store.saving = true;
  try { S.savedAt = new Date().toISOString(); await IDB.set('state', JSON.stringify(S)); store.dirty = false; store.last = new Date(); store.error = null; }
  catch (e) { store.error = e.message; console.error(e); }
  store.saving = false; renderSaveState();
}
function renderSaveState() {
  const el = $('#savestate'); if (!el) return;
  el.innerHTML = store.error ? `<span style="color:#F2B8B5">Not saved – ${esc(store.error)}</span>`
    : store.dirty || store.saving ? 'Saving…'
    : `<b>✓ Saved</b>${store.last ? ' ' + store.last.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}`;
}
function downloadBackup() { downloadBlob(new Blob([JSON.stringify(S)], { type: 'application/json' }), `Attendance Tracker backup ${todayISO()}.json`); }
window.addEventListener('beforeunload', e => { if (store.dirty) { saveNow(); e.preventDefault(); e.returnValue = ''; } });
