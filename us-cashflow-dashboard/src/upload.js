// "Update from models": read the workbooks in the browser, show what would change, apply.
// Also the bar under the tabs that says which figures are showing, with revert and download.
(function () {
  'use strict';
  const X = window.SobhaExtract, ST = window.SobhaStore;
  const panel = document.getElementById('upd-panel'), openBtn = document.getElementById('upd-open'), bar = document.getElementById('src-bar');
  const U = { open: false, busy: '', result: null, error: '', msg: '', applying: false, confirmRevert: false, names: {}, books: [] };
  // The three V5 models go together: the Consol model reads the other two, and the equity IRR,
  // profit, equity and ROE come from the Landowner model's Summary val.
  const V5 = [['consol', 'Consol model'], ['landowner', 'Landowner model'], ['homebuilder', 'Homebuilder model']];
  const missingV5 = (report) => { const m = new Set(report.files.map((f) => f.model)); return V5.some(([k]) => m.has(k)) ? V5.filter(([k]) => !m.has(k)).map(([, l]) => l) : []; };

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const money = (v) => (v == null ? '–' : (v < 0 ? '−$' : '$') + nf0.format(Math.abs(v)));
  const when = (iso) => { try { return new Date(iso).toLocaleString('en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } };
  const NAMES = {
    consol_cf: 'Consol cashflow', landowner_cf: 'Landowner cashflow', homebuilder_cf: 'Homebuilder cashflow',
    consol_pl: 'Consol P&L', landowner_pl: 'Landowner P&L', homebuilder_pl: 'Homebuilder P&L',
    consol_co_cf: 'Consol company cash flow', landowner_co_cf: 'Landowner company cash flow', homebuilder_co_cf: 'Homebuilder company cash flow',
    consol_components: 'Consol line breakdown', consol_project_pl: 'Consolidated P&L per project',
    project_summary: 'Profit, equity and ROE tiles', project_roe: 'Return on equity', project_irr: 'Equity IRR',
    kpi_extra: 'Units, cost and debt tiles', project_timeline: 'Timeline', project_profile: 'Project details',
    project_entity: 'Milestones and returns', project_sales: 'Sales timeline', actuals_plan: 'Plan columns on the Actuals tab',
    project_photos: 'Photos', ga_lines: 'G&A', ga_oh: 'G&A tables', ga_components: 'G&A lines (OPEX, CAPEX)',
    exposure: 'Exposure', exposure_parts: 'Exposure breakdown',
  };
  const NEEDS = [['consol', 'Consol model'], ['landowner', 'Landowner model'], ['homebuilder', 'Homebuilder model'], ['bpinput', 'BP Input Sheets'], ['ga', 'G&A budget']];

  // ---- reading ---------------------------------------------------------------------------
  async function read(files) {
    files = [...files].filter((f) => /\.xlsx$/i.test(f.name) && !f.name.startsWith('~$'));
    if (!files.length) { U.error = 'Choose .xlsx files: the Consol, Landowner and Homebuilder models and the BP Input Sheets.'; render(); return; }
    U.error = ''; U.result = null; U.busy = 'Reading ' + files.length + (files.length === 1 ? ' file…' : ' files…'); render();
    try {
      // Files add to those already chosen; a file of the same name or model replaces the earlier one.
      for (const f of files) {
        let wb;
        try { wb = await XLSXLite.open(await f.arrayBuffer()); }
        catch (e) { throw new Error(f.name + ': ' + e.message); }
        const model = X.detect(wb);
        U.books = U.books.filter((b) => b.name !== f.name && !(model && X.detect(b.wb) === model));
        U.books.push({ name: f.name, wb });
      }
      const books = U.books.slice();
      U.busy = 'Building the figures…'; render();
      const before = ST.modelData();
      const { data, report } = await X.build(books, before);
      U.result = { data, report, before, checks: checks(data, report), deltas: deltas(before, data), missing: missingV5(report) };
    } catch (e) { U.error = 'Could not read the files. ' + (e.message || e); }
    U.busy = ''; render();
  }

  // ---- what changes ----------------------------------------------------------------------
  const find = (rows, project, re) => (rows || []).find((r) => r.project === project && re.test(String(r.line || '').trim()));
  const gaYears = (r) => Object.keys(r || {}).filter((k) => /^oh \d{4}$/.test(k)).map((k) => k.slice(3));
  // Total overhead, all years: the Consol OHcost table's total, else the G&A sheet's.
  function gaTotal(d) {
    const o = (d.ga_oh || []).find((r) => r.entity === 'consol' && r.part === 'main' && r.kind === 'total');
    if (o) return Object.keys(o).filter((k) => /^v \d{4}$/.test(k)).reduce((s, k) => s + (o[k] || 0), 0);
    const t = (d.ga_lines || []).find((r) => r.kind === 'total');
    return t ? gaYears(t).reduce((s, y) => s + (t['oh ' + y] || 0), 0) : null;
  }
  function headline(d) {
    const cf = d.consol_cf || [], pl = (d.consol_pl || []).filter((r) => !r.parent);
    const npat = pl.find((r) => /^net profit( after tax|\s*\/\s*\(loss\))/i.test(r.line));
    const irr = (d.project_irr || []).find((r) => r.entity === 'consol' && r.project === 'All Projects');
    const k = (d.kpi_extra || []).find((r) => r.entity === 'consol' && r.project === 'All Projects');
    const tot = (re) => { const r = find(cf, 'All Projects', re); return r ? r.Total : null; };
    return [
      ['Sales (topline)', tot(/^sales$/i), money],
      ['Units', tot(/^sales unit$/i), (v) => (v == null ? '–' : nf0.format(v))],
      ['Equity infused', tot(/^equity infusion$/i), money],
      ['Net profit after tax', npat ? npat.Total : null, money],
      ['Equity IRR (pre-tax)', irr ? irr.pretax_equity_irr : null, (v) => (v == null ? '–' : (v * 100).toFixed(2) + '%')],
      ['Peak debt', k ? k.peak_debt : null, money],
      ['Projects', new Set(cf.map((r) => r.project).filter((p) => p !== 'All Projects')).size, (v) => String(v)],
      ['G&A overhead (all years)', gaTotal(d), money],
    ];
  }
  function deltas(a, b) {
    const A = headline(a), B = headline(b);
    return A.map(([label, va, f], i) => {
      const vb = B[i][1];
      const d = va != null && vb != null ? vb - va : null;
      const same = d == null ? va == null && vb == null : Math.abs(d) < (label.includes('IRR') ? 1e-6 : 0.5);
      if (d == null && !same) return { label, was: f(va), now: f(vb), change: vb == null ? 'Not given' : 'New', dir: 'same' };
      return { label, was: f(va), now: f(vb), change: same ? 'No change' : label.includes('IRR') ? (d > 0 ? '+' : '−') + Math.abs(d * 100).toFixed(2) + ' pts' : (d > 0 ? '+' : '−') + f(Math.abs(d)).replace(/^[−$]+/, label === 'Units' || label === 'Projects' ? '' : '$'), dir: same ? 'same' : d > 0 ? 'up' : 'down' };
    });
  }

  // ---- checks: does the uploaded data hang together? ---------------------------------------
  function checks(d, report) {
    const out = [];
    const ENTS = [['consol_cf', 'Consol'], ['landowner_cf', 'Landowner'], ['homebuilder_cf', 'Homebuilder']];
    for (const [ds, name] of ENTS) {
      if (!report.refreshed.includes(ds)) continue;
      const rows = d[ds], P = rows.length ? Object.keys(rows[0]).filter((c) => !['key', 'project', 'ord', 'line', 'kind', 'Budget', 'Total'].includes(c)) : [];
      const bad = [], badTot = [];
      for (const p of new Set(rows.map((r) => r.project))) {
        const r = (re) => find(rows, p, re);
        const op = r(/^opening balance$/i), cl = r(/^closing balance$/i), ti = r(/^total inflows$/i), to = r(/^total outflows$/i);
        if (op && cl && ti && to) P.forEach((q, i) => {
          const diff = (op[q] || 0) + (ti[q] || 0) - (to[q] || 0) - (cl[q] || 0);
          if (Math.abs(diff) > 1) bad.push(`${p}, ${q} (off by ${money(diff)})`);
          if (i > 0 && Math.abs((op[q] || 0) - (cl[P[i - 1]] || 0)) > 1) bad.push(`${p}, ${q} opening ≠ previous closing`);
        });
        // Totals equal the lines between their section header and themselves.
        const prow = rows.filter((x) => x.project === p);
        for (const t of prow.filter((x) => /^total (inflows|outflows)$/i.test(x.line))) {
          const hdr = prow.filter((x) => x.kind === 'header' && x.ord < t.ord).pop();
          const items = prow.filter((x) => x.kind === 'item' && hdr && x.ord > hdr.ord && x.ord < t.ord);
          const diff = items.reduce((s, x) => s + (x.Total || 0), 0) - (t.Total || 0);
          if (Math.abs(diff) > 1) badTot.push(`${p}, ${t.line} (off by ${money(diff)})`);
        }
      }
      out.push({ ok: !bad.length, label: `${name} cashflow: closing balance = opening + inflows − outflows`, detail: bad.slice(0, 3).join('; ') + (bad.length > 3 ? ` and ${bad.length - 3} more` : '') });
      out.push({ ok: !badTot.length, label: `${name} cashflow: inflow and outflow totals add up`, detail: badTot.slice(0, 3).join('; ') + (badTot.length > 3 ? ` and ${badTot.length - 3} more` : '') });
      const s = find(rows, 'All Projects', /^sales$/i), rv = find(rows, 'All Projects', /^revenue$/i);
      if (s && rv && Math.abs((s.Total || 0) - (rv.Total || 0)) > 1) out.push({ ok: false, warn: true, label: `${name} cashflow: revenue total differs from sales total`, detail: `by ${money((rv.Total || 0) - (s.Total || 0))}` });
    }
    // The companies' own cash flow statements (All Projects).
    for (const [ds, name] of [['consol_co_cf', 'Consol'], ['landowner_co_cf', 'Landowner'], ['homebuilder_co_cf', 'Homebuilder']]) {
      if (!report.refreshed.includes(ds)) continue;
      const rows = d[ds], P = report.periods[ds] || [], r = (re) => find(rows, 'All Projects', re);
      const op = r(/^opening balance$/i), cl = r(/^closing balance$/i), ti = r(/^total inflows$/i), to = r(/^total outflows$/i), bad = [];
      if (cl && ti && to) P.forEach((q) => { const diff = (op ? op[q] || 0 : 0) + (ti[q] || 0) - (to[q] || 0) - (cl[q] || 0); if (Math.abs(diff) > 1) bad.push(`${q} (off by ${money(diff)})`); });
      out.push({ ok: !bad.length, label: `${name} company cash flow: closing balance = opening + inflows − outflows`, detail: bad.slice(0, 3).join('; ') + (bad.length > 3 ? ` and ${bad.length - 3} more` : '') });
    }
    const cs = find(d.consol_cf, 'All Projects', /^sales$/i), hs = find(d.homebuilder_cf, 'All Projects', /^sales$/i);
    if (cs && hs) out.push({ ok: Math.abs(cs.Total - hs.Total) <= 1, label: 'Consol sales equal Homebuilder sales', detail: Math.abs(cs.Total - hs.Total) > 1 ? `Consol ${money(cs.Total)}, Homebuilder ${money(hs.Total)}` : '' });
    const sv = (d.project_summary || []).find((r) => r.entity === 'consol' && r.project === 'All Projects');
    const top = sv ? (sv.topline != null ? sv.topline : sv.revenue) : null;
    if (sv && cs && top != null) out.push({ ok: Math.abs(top - cs.Total) <= 1, label: 'Executive summary topline matches the Consol cashflow sales', detail: Math.abs(top - cs.Total) > 1 ? `summary ${money(top)}, cashflow ${money(cs.Total)}` : '' });
    for (const [ds, name] of [['consol_pl', 'Consol'], ['landowner_pl', 'Landowner'], ['homebuilder_pl', 'Homebuilder']]) {
      if (!report.refreshed.includes(ds)) continue;
      const top = d[ds].filter((r) => !r.parent);
      const np = top.find((r) => /^net profit before tax/i.test(r.line)), tx = top.find((r) => /^corporate tax/i.test(r.line)), na = top.find((r) => /^net profit( after tax|\s*\/\s*\(loss\))/i.test(r.line));
      if (np && tx && na) { const diff = np.Total - tx.Total - na.Total; out.push({ ok: Math.abs(diff) <= 1, label: `${name} P&L: profit after tax = profit before tax − tax`, detail: Math.abs(diff) > 1 ? `off by ${money(diff)}` : '' }); }
    }
    if (report.refreshed.includes('exposure')) {
      const ex = d.exposure || [], bad = [];
      for (const [e, n] of [['consol', 'Consol'], ['lo', 'Landowner'], ['hb', 'Homebuilder']]) {
        const tot = (sec) => ex.filter((r) => r.entity === e && r.sec === sec && r.kind === 'total' && /exposure/i.test(r.line)).pop();
        const a = tot('assets'), l = tot('liabilities');
        if (a && l && Object.keys(a).some((k) => /^p\d+$/.test(k) && Math.abs((a[k] || 0) - (l[k] || 0)) > 1)) bad.push(n);
      }
      out.push({ ok: !bad.length, label: 'Exposure: assets equal equity and liabilities', detail: bad.join(', ') });
    }
    if (report.refreshed.includes('ga_oh')) {
      // Each Consol head = its Landowner + Homebuilder rows, every year.
      const O = d.ga_oh || [], by = Object.fromEntries(O.map((r) => [r.key, r])), bad = [];
      for (const r of O.filter((x) => x.entity === 'consol' && x.part === 'main' && (x.twin_lo || x.twin_hb))) {
        const lo = by[r.twin_lo] || {}, hb = by[r.twin_hb] || {};
        const ys = Object.keys(r).filter((k) => /^v \d{4}$/.test(k) && Math.abs((r[k] || 0) - (lo[k] || 0) - (hb[k] || 0)) > 1);
        if (ys.length) bad.push(`${r.line} (${ys.map((k) => 'FY ' + k.slice(4)).join(', ')})`);
      }
      out.push({ ok: !bad.length, label: 'G&A: Landowner + Homebuilder tables = Consol table', detail: bad.slice(0, 3).join('; ') + (bad.length > 3 ? ` and ${bad.length - 3} more` : '') });
    }
    if (report.refreshed.includes('ga_lines') && (d.ga_lines || []).length) {
      const L = d.ga_lines, C = d.ga_components || [], tot = L.find((r) => r.kind === 'total'), cap = L.find((r) => r.kind === 'cap'), Y = gaYears(tot);
      if (tot) {
        const bad = Y.filter((y) => Math.abs((tot['lo ' + y] || 0) + (tot['hb ' + y] || 0) - (tot['oh ' + y] || 0)) > 1);
        out.push({ ok: !bad.length, label: 'G&A: Landowner + Homebuilder overhead = total overhead', detail: bad.join(', ') });
      }
      if (tot && cap) {
        const bad = Y.filter((y) => Math.abs((tot['oh ' + y] || 0) - (cap['oh ' + y] || 0)) > 1);
        out.push({ ok: !bad.length, warn: !!bad.length, label: 'G&A: overhead equals the allowed cap', detail: bad.map((y) => `${y} off by ${money(tot['oh ' + y] - cap['oh ' + y])}`).join('; ') });
      }
      const oh = d.ga_oh || [], badOh = [];
      for (const [e, f, n] of [['consol', 'oh', 'Consol'], ['lo', 'lo', 'Landowner'], ['hb', 'hb', 'Homebuilder']]) {
        const t = oh.find((r) => r.entity === e && r.part === 'main' && r.kind === 'total');
        if (t && tot && Y.some((y) => Math.abs((t['v ' + y] || 0) - (tot[f + ' ' + y] || 0)) > 1)) badOh.push(n);
      }
      if (oh.length) out.push({ ok: !badOh.length, label: 'G&A: OHcost tables equal the G&A sheet', detail: badOh.join(', ') });
      const by = {};
      C.forEach((c) => { if (c['v ' + Y[0]] != null) by[c.head] = (by[c.head] || 0) + c['v ' + Y[0]]; });
      const off = L.filter((r) => by[r.key] != null && Math.abs(by[r.key] - (r['cost ' + Y[0]] || 0)) > 1);
      out.push({ ok: !off.length, label: `G&A: each head's ${Y[0]} cost equals the lines behind it`, detail: off.slice(0, 3).map((r) => r.line).join('; ') });
      const fl = C.filter((c) => c.flags);
      if (fl.length) out.push({ ok: false, warn: true, label: `G&A: ${fl.length} lines in 'Cal.' are counted twice, taken from another month or mislabelled`, detail: fl.slice(0, 3).map((c) => c.line).join('; ') + (fl.length > 3 ? ` and ${fl.length - 3} more` : '') + '. See the G&A tab.' });
    }
    return out;
  }

  // ---- panel -----------------------------------------------------------------------------
  function render() {
    const canEdit = ST.mode !== 'init' && ST.canWrite;
    openBtn.hidden = !canEdit;
    openBtn.setAttribute('aria-expanded', String(U.open));
    renderBar();
    panel.hidden = !U.open || !canEdit;
    if (panel.hidden) return;
    panel.replaceChildren();
    panel.appendChild(el('h2', null, 'Update from models'));
    panel.appendChild(el('p', 'lead', 'Add the latest model workbooks. The three V5 models (Consol, Landowner, Homebuilder) go together; the BP Input Sheets and the G&A budget can be added on their own. Anything you leave out keeps its current figures. The workbooks are read in this browser and nothing changes until you apply.'));
    const drop = el('div', 'drop');
    const t = el('p', null, 'Drop the .xlsx files here');
    t.appendChild(el('small', null, 'Consol, Landowner and Homebuilder V5 models, the BP Input Sheets (timeline) and the G&A budget.'));
    const pick = el('label', 'btn', 'Choose files');
    const fi = el('input'); fi.type = 'file'; fi.accept = '.xlsx'; fi.multiple = true; fi.hidden = true; fi.id = 'upd-files';
    fi.addEventListener('change', () => { const f = [...fi.files]; fi.value = ''; read(f); });
    pick.appendChild(fi);
    drop.append(t, pick);
    ['dragenter', 'dragover'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((e) => drop.addEventListener(e, () => drop.classList.remove('over')));
    drop.addEventListener('drop', (ev) => { ev.preventDefault(); read(ev.dataTransfer.files); });
    panel.appendChild(drop);
    const got = new Set(U.result ? U.result.report.files.map((f) => f.model).filter(Boolean) : []);
    const need = el('div', 'need');
    NEEDS.forEach(([m, label]) => need.appendChild(el('span', got.has(m) ? 'on' : '', label)));
    panel.appendChild(need);
    if (U.busy) panel.appendChild(el('div', 'busy', U.busy));
    if (U.error) { const w = el('ul', 'warns'); w.appendChild(el('li', null, U.error)); panel.appendChild(w); }
    if (U.result) panel.appendChild(review(U.result));
    const acts = el('div', 'rvacts');
    if (U.result) {
      const nothing = !U.result.report.refreshed.length, missing = U.result.missing || [];
      const apply = el('button', 'btn primary', U.applying ? 'Applying…' : ST.mode === 'shared' ? 'Apply for everyone' : 'Apply to dashboard');
      apply.type = 'button'; apply.disabled = U.applying || nothing || !!missing.length;
      if (missing.length) { U.msg = 'Add the ' + missing.join(' and ') + ' to apply.'; } else if (/^Add the /.test(U.msg)) U.msg = '';
      apply.addEventListener('click', applyResult);
      acts.appendChild(apply);
    }
    const cancel = el('button', 'btn quiet', U.result ? 'Discard' : 'Close'); cancel.type = 'button';
    cancel.addEventListener('click', () => { U.open = false; U.result = null; U.error = ''; U.books = []; U.msg = ''; render(); });
    acts.appendChild(cancel);
    acts.appendChild(el('span', 'msg', U.msg || (U.result && ST.mode === 'shared' ? 'Applying updates the dashboard for everyone with the link.' : '')));
    panel.appendChild(acts);
  }

  function review(res) {
    const { report } = res;
    const wrap = el('div', 'rv');
    const left = el('div'), right = el('div');
    // headline changes
    const c1 = el('div', 'rvcard'); c1.appendChild(el('h3', null, 'Headline figures, all projects'));
    const t = el('table', 'delta'); const hr = el('tr');
    ['', 'Now', 'After update', 'Change'].forEach((h) => hr.appendChild(el('th', null, h)));
    const th = el('thead'); th.appendChild(hr); t.appendChild(th);
    const tb = el('tbody');
    res.deltas.forEach((d) => { const tr = el('tr'); tr.append(el('td', null, d.label), el('td', null, d.was), el('td', null, d.now), el('td', d.dir, d.change)); tb.appendChild(tr); });
    t.appendChild(tb); const tw = el('div'); tw.style.overflowX = 'auto'; tw.appendChild(t); c1.appendChild(tw);
    left.appendChild(c1);
    // checks
    const c2 = el('div', 'rvcard');
    if ((res.missing || []).length) {
      const m = res.missing.join(' and ');
      res = Object.assign({}, res, { checks: [{ ok: false, label: `Add the ${m}`, detail: `The three V5 models go together: the equity IRR, net profit, equity and ROE come from the Landowner model's Summary val, and the Consol model reads the other two. Without the ${m} the dashboard would mix these figures with the earlier models'.` }].concat(res.checks) });
    }
    const nbad = res.checks.filter((c) => !c.ok).length;
    c2.appendChild(el('h3', null, nbad ? `Checks: ${nbad} of ${res.checks.length} need a look` : `Checks: all ${res.checks.length} pass`));
    const ul = el('ul', 'checks');
    res.checks.forEach((c) => {
      const li = el('li'); li.appendChild(el('span', 'mark' + (c.ok ? '' : c.warn ? ' warn' : ' bad'), c.ok ? '✓' : '!'));
      const tx = el('div', null, c.label); if (c.detail) tx.appendChild(el('small', null, c.detail)); li.appendChild(tx); ul.appendChild(li);
    });
    if (!res.checks.length) ul.appendChild(el('li', null, 'No cashflow or P&L in these files to check.'));
    c2.appendChild(ul); left.appendChild(c2);
    // files
    const c3 = el('div', 'rvcard'); c3.appendChild(el('h3', null, 'Files'));
    const fl = el('ul', 'files');
    report.files.forEach((f) => {
      const li = el('li'); li.appendChild(el('span', 'mark' + (f.model ? '' : ' bad'), f.model ? '✓' : '!'));
      const fn = el('span', 'fn', f.name); fn.title = f.name; li.appendChild(fn);
      li.appendChild(el('span', 'as', f.model ? f.label : 'not recognised')); fl.appendChild(li);
    });
    c3.appendChild(fl); right.appendChild(c3);
    // datasets
    const c4 = el('div', 'rvcard'); c4.appendChild(el('h3', null, 'What gets updated'));
    const nm = (k) => NAMES[k] || k;
    const upd = el('p', 'dsl'); upd.appendChild(el('b', null, 'Updated: ')); upd.append(report.refreshed.length ? report.refreshed.map(nm).join(', ') : 'nothing; none of the files is a recognised model.');
    c4.appendChild(upd);
    const kept = report.kept.filter((k) => k !== 'project_photos');
    if (kept.length) { const kp = el('p', 'dsl'); kp.style.marginTop = '6px'; kp.appendChild(el('b', null, 'Kept as they are: ')); kp.append(kept.map(nm).join(', ') + '.'); c4.appendChild(kp); }
    const ed = Object.keys(ST.details).length;
    if (ed) { const ep = el('p', 'dsl'); ep.style.marginTop = '6px'; ep.textContent = `Project details edited on the dashboard (${ed} ${ed === 1 ? 'project' : 'projects'}) keep their edits.`; c4.appendChild(ep); }
    if (report.warnings.length) {
      const w = el('ul', 'warns');
      report.warnings.slice(0, 8).forEach((x) => w.appendChild(el('li', null, x)));
      if (report.warnings.length > 8) w.appendChild(el('li', null, `and ${report.warnings.length - 8} more`));
      c4.appendChild(w);
    }
    right.appendChild(c4);
    wrap.append(left, right);
    return wrap;
  }

  async function applyResult() {
    const res = U.result; if (!res) return;
    U.applying = true; U.msg = ST.mode === 'shared' ? 'Saving the figures for everyone…' : ''; render();
    try {
      await ST.savePlan(res.data, { files: res.report.files.filter((f) => f.model).map((f) => ({ name: f.name, model: f.model })), refreshed: res.report.refreshed, kept: res.report.kept });
      U.open = false; U.result = null; U.msg = ''; U.books = [];
    } catch (e) { U.msg = ST.message || 'Could not save the figures.'; }
    U.applying = false; render();
  }

  // ---- bar under the tabs ------------------------------------------------------------------
  function renderBar() {
    const plan = ST.plan, edits = Object.keys(ST.details).length + ST.photos.length;
    const show = plan || ST.planLoading || ST.message || (edits && ST.canDownload());
    bar.hidden = !show;
    if (!show) return;
    bar.replaceChildren();
    bar.classList.toggle('err', !!ST.message);
    bar.appendChild(el('span', 'dot'));
    const txt = el('span', 'srctext');
    if (ST.message) txt.textContent = ST.message;
    else if (ST.planLoading) txt.textContent = 'Loading the latest uploaded figures…';
    else if (plan) {
      const m = plan.meta || {}, files = m.files || [];
      txt.append('Figures from ');
      const b = el('b', null, files.length === 1 ? files[0].name : files.length + ' model files'); b.title = files.map((f) => f.name).join('\n'); txt.appendChild(b);
      const who = m.by && U.names[m.by];
      txt.append(m.at ? ', uploaded ' + when(m.at) + (who ? ' by ' + who : '') : '');
      if (m.by && !(m.by in U.names)) ST.names([m.by]).then((n) => { Object.assign(U.names, n); if (n[m.by]) renderBar(); });
    } else txt.textContent = 'Figures from the models built into this page.';
    bar.appendChild(txt);
    const link = (label, fn) => { const b = el('button', 'link', label); b.type = 'button'; b.addEventListener('click', fn); bar.appendChild(b); return b; };
    if (U.confirmRevert) {
      bar.appendChild(el('span', null, ST.mode === 'shared' ? 'Go back to the figures built into the page, for everyone?' : 'Go back to the figures built into the page?'));
      link('Yes, go back', async () => { U.confirmRevert = false; try { await ST.revertPlan(); } catch (e) { /* message shown by the store */ } renderBar(); });
      link('Keep these figures', () => { U.confirmRevert = false; renderBar(); });
      return;
    }
    if (ST.message) link('Dismiss', () => { ST.message = ''; renderBar(); });
    if (plan && ST.canWrite) link('Go back to original figures', () => { U.confirmRevert = true; renderBar(); });
    if (ST.canDownload()) link('Download updated dashboard', download);
  }

  // A standalone copy of the page with the figures, edits and photos in use built in.
  async function download() {
    const data = ST.effective();
    const json = JSON.stringify(data).replace(/<\/(script)/gi, '<\\/$1').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    const scripts = [...document.querySelectorAll('script[data-sb]')].map((s) => s.outerHTML).join('\n');
    const html = '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n'
      + '<title>' + document.title.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</title>\n'
      + '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">\n'
      + '<style>html,body{margin:0;background:#fff}#dash-root{min-height:100vh}</style>\n</head><body>\n'
      + window.__PRISTINE + '\n<script id="baseline-data" type="application/json">' + json + '<\/script>\n' + scripts + '\n</body></html>\n';
    try { await ST.saveFile('Sobha_USA_Cashflow_Dashboard_' + new Date().toISOString().slice(0, 10) + '.html', html); }
    catch (e) { if (e && e.code !== 'declined') { ST.message = 'Could not download the file' + (e.message ? ': ' + e.message : '') + '.'; renderBar(); } }
  }

  openBtn.addEventListener('click', () => { U.open = !U.open; render(); if (U.open) panel.scrollIntoView({ block: 'nearest' }); });
  ST.onChange(render);
  render();
})();
