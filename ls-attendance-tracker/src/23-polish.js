/* =====================================================================
   Visual polish (after the Sobha dashboards): an icon chip on every
   figure tile, figures that count up when a page opens, a thin progress
   bar at the top while long work runs (Excel, PDF, sync, libraries).
   ===================================================================== */
const PIC = {
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  building: '<path d="M3 21h18M5 21V5l7-3 7 3v16"/><path d="M9 9h1M14 9h1M9 13h1M14 13h1M9 17h1M14 17h1"/>',
  pin: '<path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  cal: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  sync: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
  wallet: '<path d="M20 7H5a2 2 0 0 1 0-4h13v4"/><path d="M3 5v14a2 2 0 0 0 2 2h15V7"/><circle cx="16" cy="14" r="1"/>',
  trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
  print: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14 9l2 2"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>',
  face: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
  sign: '<path d="M3 21h18"/><path d="M14.5 4.5l5 5L9 20H4v-5z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  tree: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'
};
const pic = (k, s = 15) => `<svg class="pi-ic" viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true">${PIC[k] || PIC.grid}</svg>`;
/** which icon and tint a figure gets, from its label */
const KPI_IC = [[/unusual|outside|absent|lop|missing/i, 'alert', 'neg'], [/not checked|no check|review|pending/i, 'clock', 'warn'], [/on duty|checked in|on time|coverage|accepted/i, 'check', 'pos'],
  [/checked out|left/i, 'out', ''], [/zone|location/i, 'target', ''], [/sync|roster/i, 'sync', ''], [/personnel|people|worker|added/i, 'users', ''], [/project/i, 'building', ''], [/site/i, 'pin', ''],
  [/day|attendance|month/i, 'cal', ''], [/invoice|paid|outstanding|amount/i, 'receipt', ''], [/app|phone/i, 'phone', ''], [/hour|ot\b/i, 'clock', ''], [/./, 'trend', '']];
const NOANIM = () => navigator.webdriver || matchMedia('(prefers-reduced-motion: reduce)').matches;
/** a figure counts up from 0 (numbers only; text, dates and "—" stay as they are) */
function countUp(el) {
  const tn = [...el.childNodes].find(n => n.nodeType === 3 && /\d/.test(n.textContent)); if (!tn || NOANIM()) return;
  const raw = tn.textContent, m = raw.match(/^(\s*)([\d,]+(?:\.\d+)?)(\s*%?\s*)$/); if (!m) return;
  const to = +m[2].replace(/,/g, ''), dec = (m[2].split('.')[1] || '').length, comma = m[2].includes(','); if (!(to > 0)) return;
  const t0 = performance.now(), D = 600, fmt = x => { const s = x.toFixed(dec); return comma ? (+s).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : s; };
  const step = t => { const k = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - k, 3); tn.textContent = m[1] + fmt(to * e) + m[3]; if (k < 1 && tn.isConnected) requestAnimationFrame(step); else tn.textContent = raw; };
  requestAnimationFrame(step);
}
/** give figure tiles their icon chip once; count up when the page has just been opened */
function decorateKpis(root = document) {
  const fresh = Date.now() - (decorateKpis.opened || 0) < 1200;
  root.querySelectorAll('.kpi:not([data-kd])').forEach(k => {
    k.dataset.kd = '1'; const lab = k.querySelector('.l,.k')?.textContent || '';
    const [, ic, tint] = KPI_IC.find(([re]) => re.test(lab));
    if (!k.closest('.lv-k')) k.insertAdjacentHTML('beforeend', `<span class="kic${tint ? ' ' + tint : ''}">${pic(ic, 14)}</span>`);
    if (fresh) { const v = k.querySelector('.v'); if (v) countUp(v); }
  });
}
new MutationObserver(() => decorateKpis()).observe(document.getElementById('body') || document.body, { childList: true, subtree: true });
/** thin progress bar while long work runs */
function busy(p) {
  const bar = document.getElementById('topload'); busy.n = (busy.n || 0) + 1; bar?.classList.add('go');
  const done = () => { if (--busy.n <= 0) { busy.n = 0; bar?.classList.remove('go'); } };
  return Promise.resolve(p).finally(done);
}
for (const k of ['loadScript', 'exportPayrollXlsx', 'exportTrackerXlsx', 'exportTimesheetsXlsx', 'syncApp', 'mergeReports'])
  if (typeof window[k] === 'function') { const f = window[k]; window[k] = function (...a) { return busy(f.apply(this, a)); }; }
if (typeof PDFX !== 'undefined' && PDFX.build) { const b = PDFX.build; PDFX.build = (...a) => busy(b.apply(PDFX, a)); }
/* a page that has just been opened rises in and its figures count up */
{ const sv = showView; window.showView = function (v) { const was = curView; decorateKpis.opened = Date.now(); const r = sv.call(this, v); const d = $('#v-' + v); if (d && was !== v && !NOANIM()) { d.classList.remove('enter'); void d.offsetWidth; d.classList.add('enter'); setTimeout(() => d.classList.remove('enter'), 700); } return r; }; }
/* icons on the main tabs */
for (const [v, k] of [['live', 'grid'], ['insights', 'trend'], ['employees', 'users'], ['projects', 'building'], ['attendance', 'cal'], ['timesheets', 'receipt'], ['payroll', 'wallet']]) { const b = document.querySelector(`#tabs .doctab[data-view="${v}"]`); if (b && !b.querySelector('.pi-ic')) b.insertAdjacentHTML('afterbegin', pic(k, 14)); }

/* toolbar: an icon in front of each action */
const TB_IC = [[/sync|refresh/i, 'sync'], [/download|export|backup$/i, 'download'], [/upload|import|restore/i, 'upload'], [/^add|^new/i, 'plus'], [/print|pdf/i, 'print'], [/email/i, 'mail'], [/publish/i, 'send'],
  [/pin/i, 'key'], [/undo/i, 'undo'], [/lock/i, 'lock'], [/save/i, 'save'], [/generate/i, 'sparkle'], [/face/i, 'face'], [/sign/i, 'sign'], [/client|template|directory/i, 'file'], [/site|link/i, 'link'], [/report/i, 'file']];
{ const rt = renderToolbar; window.renderToolbar = function () { const r = rt.apply(this, arguments);
  document.querySelectorAll('#toolbar button').forEach(b => { if (b.querySelector('.pi-ic')) return; if (b.dataset.cmd === 'tree') { b.innerHTML = pic('tree', 14) + 'Projects &amp; sites'; return; } const m = TB_IC.find(([re]) => re.test(b.textContent.trim())); if (m) b.insertAdjacentHTML('afterbegin', pic(m[1], 14)); });
  return r; }; }
/* page titles carry the icon of their tab; clients in the tree get an initials badge */
const VIEW_IC = { live: 'grid', app: 'phone', insights: 'trend', employees: 'users', projects: 'building', attendance: 'cal', timesheets: 'file', invoices: 'receipt', tracker: 'cal', payroll: 'wallet', reports: 'file', data: 'grid' };
function decorateChrome() {
  document.querySelectorAll('.doc>.dh:not([data-hi])').forEach(h => { h.dataset.hi = '1'; const v = h.parentElement.id.slice(2), t = h.querySelector('h2'); if (t && VIEW_IC[v]) t.insertAdjacentHTML('beforebegin', `<span class="dh-ic">${pic(VIEW_IC[v], 16)}</span>`); });
  document.querySelectorAll('.tree .grp>.node:not([data-hi])').forEach(n => { n.dataset.hi = '1'; const nm = n.querySelector('.nm'); if (!nm) return; const w = nm.textContent.trim().split(/\s+/).filter(x => /^[A-Za-z]/.test(x)); nm.insertAdjacentHTML('beforebegin', `<span class="ini">${esc((w[0]?.[0] || '?') + (w[1]?.[0] || ''))}</span>`); });
}
new MutationObserver(decorateChrome).observe(document.body, { childList: true, subtree: true });
/* segmented controls: a white pill that slides to the chosen option (the control itself is unchanged) */
function segPills(root = document) {
  root.querySelectorAll('.seg').forEach(seg => {
    let pill = seg.querySelector(':scope>.seg-pill'); if (!pill) { pill = document.createElement('i'); pill.className = 'seg-pill'; seg.prepend(pill); }
    const on = seg.querySelector(':scope>button.on'); if (!on) { pill.style.width = '0'; return; }
    pill.style.left = on.offsetLeft + 'px'; pill.style.width = on.offsetWidth + 'px';
  });
}
new MutationObserver(() => segPills()).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
addEventListener('resize', () => segPills()); segPills();
