/* =====================================================================
   "Tour this page": highlights the parts of the open page one by one with a
   short explanation. Starts only from the ? button or Help → Tour this page.
   ===================================================================== */
const TOUR = (() => {
  const V = id => '#v-' + id;
  const TABS = { sel: '#tabs', t: 'Tabs', d: '<b>Live · Insights · App &amp; review</b> – field work from the phones. <b>Security Personnel · Projects &amp; sites · Settings</b> – your master data. <b>Attendance → Client timesheets → Invoice</b> – the monthly documents, in that order.' };
  const STEPS = {
    live: [TABS,
      { sel: '#lv-site', t: 'Pick a site', d: 'Show one site only, or all sites.' },
      { sel: V('live') + ' .kpis', t: 'Right now', d: 'On duty, checked out, not checked in yet, and anyone outside their zone – from the last sync.' },
      { sel: '#lv-map', t: 'Map', d: 'Green = on duty, amber = on duty but waiting for review, grey = checked out. Click a dot for name, time and distance from the pin.' },
      { sel: V('live') + ' .ppl', t: 'Personnel today', d: 'Click a name to zoom to them on the map. Double-click to open their Insights (route, punctuality, face check).' },
      { sel: '#toolbar', t: 'Sync now', d: 'Fetches the newest check-ins and positions from the phones. It also runs every 5 minutes by itself.' }],
    insights: [TABS,
      { sel: V('insights') + ' .ins-f', t: 'Filters', d: 'Choose dates, project, site, shift or one person. 7 / 30 / 90 days are quick ranges.' },
      { sel: V('insights') + ' .kpis', t: 'Headline numbers', d: 'Coverage, on-time %, average lateness, inside-zone %, face check results, relievers and anything unusual for the filter above.' },
      { sel: '[data-sec="in-map"]', t: 'Route and hotspots', d: 'Red circles = where personnel spent most time on shift (bigger = longer). Pick one person to see their route for a day.' },
      { sel: '[data-sec="in-hs"]', t: 'Top hotspots', d: 'Time spent, how many people, the nearest site and whether the spot is inside the zone. Click a row to zoom.' },
      { sel: '[data-sec="in-cov"]', t: 'Coverage', d: 'Present ÷ planned per site from the attendance grid; short days are days with fewer people than allocated.' },
      { sel: '[data-sec="in-pun"]', t: 'Punctuality', d: 'Weekly on-time trend and who is late most often. Click a name to open their profile.' },
      { sel: '[data-sec="in-zone"]', t: 'Zone compliance', d: 'How many check-ins are inside the zone, the typical distance and GPS accuracy per site.' },
      { sel: '[data-sec="in-pin"]', t: 'Pin check', d: 'If accurate check-ins cluster away from a pin, the pin is probably misplaced – one click moves it there.' },
      { sel: '[data-sec="in-odd"]', t: 'Unusual activity', d: 'Shared phones, a different face, impossible travel, a wrong phone clock. Details opens the punch.' },
      { sel: '#toolbar', t: 'Face check and export', d: 'Run face check compares new check-in photos with personnel photos now. Export Excel saves every table above.' }],
    app: [TABS,
      { sel: '#toolbar', t: 'Sync and publish', d: '<b>Sync now</b> brings in check-ins and supervisor marks. <b>Publish roster</b> sends personnel, PINs, sites and zones to the phones – do it after changes.' },
      { sel: V('app') + ' .kpis', t: 'Status', d: 'People on the app, sites with a location, punches to review, days with no check-in, last sync and publish.' },
      { sel: '[data-sec="ap-rev"]', t: 'Punches to review', d: 'Check-ins outside the zone, with weak GPS, too early, or a failed face check. Details shows photos and map; Approve makes the day P, Reject leaves it blank.' },
      { sel: '[data-sec="ap-today"]', t: 'Today on site', d: 'Checked in, checked out and still on site, per site.' },
      { sel: '[data-sec="ap-miss"]', t: 'No check-in', d: 'People allocated to a site who did not check in. Decide the day: A, OFF, leave… Supervisors can do the same on their phone.' },
      { sel: '[data-sec="ap-set"]', t: 'Settings', d: 'Azure address, zone radius, GPS limit, check-in window, photo, one phone per person, and the face check switches.' }],
    employees: [TABS,
      { sel: '#ev-q', t: 'Find', d: 'Search by name or Emp ID; the filters next to it narrow by status and type.' },
      { sel: V('employees') + ' .tw', t: 'Security personnel', d: 'Click a name to edit: photos for the face check (up to 3), site allocation history, app access and PIN.' },
      { sel: '#ev-all', t: 'Tick for bulk changes', d: 'Tick several people, then use the toolbar: assign to site, change shift, end date, app access…' },
      { sel: '#toolbar', t: 'Toolbar', d: '<b>Upload photos…</b> adds many reference photos at once – name each file by Emp ID, e.g. C52392.jpg.' }],
    projects: [TABS,
      { sel: '#pv-q', t: 'Find', d: 'Search clients, projects and sites.' },
      { sel: '[data-sec="projects"]', t: 'Projects', d: 'Each card shows the client, sites, rate and documents. Click Edit to change details, the location pin and zone, or the WOI.' },
      { sel: '[data-sec="locations"]', t: 'Locations for the phones', d: 'Sites need a pin and a zone (on the site or its project) before check-ins can be accepted automatically.' },
      { sel: '#toolbar', t: 'Add and upload', d: 'Add a client, project or site. <b>Upload documents in bulk</b> matches Work Order Instructions to projects by WOI / PO number.' }],
    data: [TABS,
      { sel: '[data-sec="data"]', t: 'Backup', d: 'Data is saved in this browser. Download a backup regularly and keep it in LS_Documents; Restore brings it back on any PC.' },
      { sel: '[data-sec="rates"]', t: 'Rate card', d: 'AED per person per month by trade – used for invoices (pro-rata on calendar days).' },
      { sel: '[data-sec="codes"]', t: 'Attendance codes', d: 'P, R, A, OFF, leave types… which are billable and which appear on client timesheets.' },
      { sel: '[data-sec="sign"]', t: 'Signatories', d: 'Names printed in the signature boxes of the timesheets.' }],
    attendance: [TABS,
      { sel: '#av-ym', t: 'Period', d: 'Payroll cycle or calendar month; the arrows move one period.' },
      { sel: '#av-filt', t: 'Filters', d: 'Narrow by name, trade, shift or status. The tree on the left limits to a client, project or site.' },
      { sel: '#av-kpis', t: 'Totals', d: 'Personnel, billable days (P + R), absent, off, leave and days not marked yet.' },
      { sel: '#grid-wrap', t: 'Attendance grid', d: 'Click or drag to select days, then type a code (P, A, O…). Right-click for punch details from the phone app. A dot = came from the app.' },
      { sel: '#toolbar', t: 'Toolbar', d: 'Set site / shift for relievers, Undo, Lock month when payroll is closed, and Export the master sheet to Excel.' }],
    timesheets: [TABS,
      { sel: '#tv-ym', t: 'Month and client', d: 'Pick the month (and a client) – one LS/DO/F-026 sheet per project.' },
      { sel: V('timesheets') + ' .tw', t: 'Projects', d: 'Click a row to preview its sheet. Tick projects to print or export them together.' },
      { sel: '#tv-sheets', t: 'Sheet preview', d: 'Exactly what prints: shifts, names, days and totals, reliever rows, grand total and signatures.' },
      { sel: '#toolbar', t: 'Print and Excel', d: 'Print / PDF or Export Excel for the ticked projects.' }],
    invoices: [TABS,
      { sel: V('invoices') + ' .dh', t: 'Invoices', d: 'Tax invoice break-up per client and period, built from the attendance and the rate card.' },
      { sel: '[data-sec="iv1"]', t: 'Invoice details', d: 'Client, projects and period – the lines fill from attendance.' },
      { sel: '[data-sec="ivp"]', t: 'Invoice pack', d: 'The PDF pack in the client\'s order: SAP invoice, break-up, signed timesheets and the project\'s Work Order Instruction.' },
      { sel: '#toolbar', t: 'Toolbar', d: 'New invoice, Download pack PDF, identify an existing PDF\'s pages, and save.' }]
  };
  let steps = [], i = 0, hole = null, tip = null;
  const visible = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 && !el.closest('[hidden]'); };
  function place() {
    const s = steps[i], el = s && $(s.sel); if (!el) return;
    const r = el.getBoundingClientRect(), pad = 6, vw = innerWidth, vh = innerHeight;
    const top = Math.max(4, r.top - pad), left = Math.max(4, r.left - pad), w = Math.min(vw - 8, r.width + pad * 2), h = Math.min(vh - top - 4, r.height + pad * 2);
    Object.assign(hole.style, { top: top + 'px', left: left + 'px', width: w + 'px', height: h + 'px' });
    const tw = Math.min(360, vw - 24); tip.style.width = tw + 'px';
    const th = tip.offsetHeight, below = top + h + 12, above = top - th - 12;
    tip.style.top = (below + th < vh - 8 ? below : above > 8 ? above : Math.max(8, vh - th - 8)) + 'px';
    tip.style.left = Math.min(vw - tw - 12, Math.max(12, left)) + 'px';
  }
  function show(n) {
    i = n; const s = steps[i], el = $(s.sel);
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    tip.innerHTML = `<button class="tour-x" data-tx aria-label="Close">✕</button><div class="tour-n">${i + 1} of ${steps.length}</div><b>${s.t}</b><p>${s.d}</p>
      <div class="tour-b">${i ? '<button class="btn sm" data-tb>Back</button>' : ''}<span class="spacer"></span><button class="btn sm pri" data-tn>${i < steps.length - 1 ? 'Next' : 'Done'}</button></div>`;
    tip.querySelector('[data-tx]').onclick = stop;
    tip.querySelector('[data-tn]').onclick = () => i < steps.length - 1 ? show(i + 1) : stop();
    if (tip.querySelector('[data-tb]')) tip.querySelector('[data-tb]').onclick = () => show(i - 1);
    requestAnimationFrame(place); tip.querySelector('[data-tn]').focus();
  }
  const key = e => { if (!tip) return; if (e.key === 'Escape') { e.stopPropagation(); stop(); } else if (e.key === 'ArrowRight') { i < steps.length - 1 ? show(i + 1) : stop(); } else if (e.key === 'ArrowLeft' && i) show(i - 1); };
  function start(view = curView) {
    stop(); closeMenu?.();
    steps = (STEPS[view] || [TABS]).filter(s => visible($(s.sel)));
    if (!steps.length) return toast('Nothing to show on this page yet');
    hole = document.createElement('div'); hole.className = 'tour-hole';
    tip = document.createElement('div'); tip.className = 'tour-tip'; tip.setAttribute('role', 'dialog');
    document.body.append(hole, tip);
    addEventListener('resize', place); addEventListener('scroll', place, true); document.addEventListener('keydown', key, true);
    show(0);
  }
  function stop() {
    hole?.remove(); tip?.remove(); hole = tip = null;
    removeEventListener('resize', place); removeEventListener('scroll', place, true); document.removeEventListener('keydown', key, true);
  }
  return { start, stop, get on() { return !!tip; }, STEPS };
})();
