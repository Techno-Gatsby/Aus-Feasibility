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
