// G&A tab: the overhead tables of OHcost-H+V (Consol), OHcost-H (Landowner) and OHcost-V
// (Homebuilder) (dataset ga_oh). A head opens to its split by year and the OPEX lines, or for
// depreciation the CAPEX lines, behind it (ga_lines, ga_components; see derive-ga.js).
(function () {
  'use strict';
  const G = { ent: 'consol', open: new Set() };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const fm = (v) => (!isNum(v) ? '' : Math.abs(v) < 0.5 ? '–' : (v < 0 ? '(' : '') + Math.round(Math.abs(v)).toLocaleString('en-US') + (v < 0 ? ')' : ''));
  const pc = (v) => (isNum(v) ? Math.round(v * 100) + '%' : '');
  const sum = (a) => (a.some(isNum) ? a.reduce((s, v) => s + (isNum(v) ? v : 0), 0) : null);
  const fy = (y) => 'FY ' + String(y).slice(2);
  const srf = (v) => (v == null ? '' : isNum(v) ? String(+v.toFixed(4)) : String(v));
  let sec = null;

  const years = (rows) => [...new Set(rows.flatMap((r) => Object.keys(r).map((k) => (k.match(/^v (\d{4})$/) || [])[1]).filter(Boolean)))].map(Number).sort((a, b) => a - b);
  // Without the OHcost sheets: the same table from the G&A sheet.
  const fromLines = (L, ent) => L.filter((r) => r.kind !== 'cap').map((r) => {
    const f = ent === 'consol' ? 'oh' : ent, o = { key: 'l|' + r.key, part: 'main', code: r.code, line: r.line, kind: r.kind, level: r.level, ga: r.key };
    Object.keys(r).forEach((k) => { const m = k.match(/^oh (\d{4})$/); if (m) o['v ' + m[1]] = r[f + ' ' + m[1]]; });
    return o;
  });
  const toggle = (k) => { if (G.open.has(k)) G.open.delete(k); else G.open.add(k); render(); const n = sec.querySelector(`[data-k="${CSS.escape(k)}"]`); if (n) n.focus(); };
  const clickable = (tr, k) => {
    tr.classList.add('k'); tr.tabIndex = 0; tr.dataset.k = k;
    tr.setAttribute('aria-expanded', String(G.open.has(k))); if (G.open.has(k)) tr.classList.add('open');
    tr.onclick = (e) => { e.stopPropagation(); toggle(k); };
    tr.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggle(k); } };
  };
  const head = (cols) => { const t = el('thead'), tr = el('tr'); cols.forEach(([x, c]) => tr.appendChild(el('th', c || 'n', x))); t.appendChild(tr); return t; };
  const nums = (tr, vals) => { vals.forEach((v) => tr.appendChild(el('td', null, fm(v)))); tr.appendChild(el('td', 'tot', fm(sum(vals)))); };
  const groupRow = (tb, text, span) => { const g = el('tr', 'g'), x = el('td', 'l', text); x.colSpan = span; g.appendChild(x); tb.appendChild(g); };
  const flag = (parent, title) => { const f = el('span', 'gaflag', '!'); f.title = title; parent.appendChild(f); };

  function render(s, ent) {
    sec = s || sec;
    if (ent) G.ent = ent;
    if (!sec) return;
    const O = window.dash.data('ga_oh').data || [], L = window.dash.data('ga_lines').data || [], C = window.dash.data('ga_components').data || [];
    sec.replaceChildren();
    const rows = O.some((r) => r.entity === G.ent) ? O.filter((r) => r.entity === G.ent) : fromLines(L, G.ent);
    if (!rows.length) return;
    const Y = years(rows), byKey = Object.fromEntries(L.map((r) => [r.key, r]));
    const ncol = Y.length + 2;

    // the overhead table
    const tw = el('div', 'tw'), t = el('table', 'stmt gat');
    t.appendChild(head([['Expense Head', 'l'], ...Y.map((y) => [fy(y)]), ['Total']]));
    const tb = el('tbody');
    // The yearly split of shared overhead between Landowner and Homebuilder, above the heads.
    const shared = L.find((r) => r.kind === 'head' && !r.plug && Y.some((y) => r['lo_pct ' + y] > 0));
    if (shared) [['LO share', (y) => shared['lo_pct ' + y]], ['HB share', (y) => (isNum(shared['lo_pct ' + y]) ? 1 - shared['lo_pct ' + y] : null)]].forEach(([label, f]) => {
      const tr = el('tr', 'gashare');
      tr.appendChild(el('td', 'l', label));
      Y.forEach((y) => tr.appendChild(el('td', null, pc(f(y)))));
      tr.appendChild(el('td'));
      tb.appendChild(tr);
    });
    rows.filter((r) => r.part === 'main').forEach((r) => {
      const g = byKey[r.ga], comps = g ? C.filter((c) => c.head === g.key) : [];
      const tr = el('tr', r.kind === 'header' ? 'g' : r.kind === 'total' ? 't' : r.kind === 'subtotal' ? 't st' : '');
      const lab = el('td', 'l');
      lab.appendChild(el('span', 'sl', r.code || ''));
      if (r.level) lab.style.paddingLeft = '22px';
      const vals = Y.map((y) => r['v ' + y]);
      const canOpen = r.kind !== 'header' && g && (comps.length || vals.some((v) => v));
      if (canOpen) { lab.appendChild(el('span', 'chev', '▸')); clickable(tr, r.key); }
      lab.appendChild(document.createTextNode(r.line.replace(/:$/, '')));
      if (comps.some((c) => c.flags)) flag(lab, 'Some lines are counted twice or taken from another month');
      tr.appendChild(lab);
      if (r.kind === 'header') { for (let i = 1; i < ncol; i++) tr.appendChild(el('td')); tb.appendChild(tr); return; }
      nums(tr, vals);
      tb.appendChild(tr);
      if (canOpen && G.open.has(r.key)) split(tb, g, Y, comps, ncol);
    });
    t.appendChild(tb); tw.appendChild(t); sec.appendChild(tw);

    // the rows under the table: Landowner / Homebuilder split, cost categories, G&A provision per project
    const below = rows.filter((r) => r.part === 'below');
    if (!below.length) return;
    const tw2 = el('div', 'tw gabelow'), t2 = el('table', 'stmt gat');
    t2.appendChild(head([['Particular', 'l'], ...Y.map((y) => [fy(y)]), ['Total']]));
    const tb2 = el('tbody');
    below.forEach((r) => {
      if (r.kind === 'child' && !G.open.has(r.parent)) return;
      const tr = el('tr', r.kind === 'section' ? 'g' : r.kind === 'total' ? 't' : r.kind === 'child' ? 'p' : '');
      const lab = el('td', 'l');
      if (r.kind === 'project') { lab.appendChild(el('span', 'chev', '▸')); clickable(tr, r.key); }
      lab.appendChild(document.createTextNode(r.line));
      tr.appendChild(lab);
      if (r.kind === 'section') { for (let i = 1; i < ncol; i++) tr.appendChild(el('td')); tb2.appendChild(tr); return; }
      Y.forEach((y) => { const td = el('td', null, fm(r['v ' + y])); if (isNum(r['p ' + y])) td.appendChild(el('small', 'gapct', pc(r['p ' + y]))); tr.appendChild(td); });
      tr.appendChild(el('td', 'tot', fm(sum(Y.map((y) => r['v ' + y])))));
      tb2.appendChild(tr);
    });
    t2.appendChild(tb2); tw2.appendChild(t2); sec.appendChild(tw2);
  }

  // A head opened: full cost, overhead, project share and the entity split by year, then its lines.
  function split(tb, g, Y, comps, ncol) {
    const sub = (label, f) => {
      const vals = Y.map((y) => g[f + ' ' + y]);
      if (!vals.some(isNum)) return;
      const tr = el('tr', 'p');
      tr.appendChild(el('td', 'l', label));
      nums(tr, vals);
      tb.appendChild(tr);
    };
    sub('Full cost', 'cost');
    sub('Overhead' + (isNum(g.oh_pct) ? ' · ' + pc(g.oh_pct) : ''), 'oh');
    sub('Project share (calc.)' + (isNum(g.proj_pct) ? ' · ' + pc(g.proj_pct) : ''), 'proj');
    sub('Landowner (H)', 'lo');
    sub('Homebuilder (V)', 'hb');
    if (!comps.length) return;
    const dr = el('tr', 'dr'), td = el('td'); td.colSpan = ncol;
    const d = el('div', 'dx');
    d.appendChild(comps.some((c) => c.kind === 'asset') ? capex(g, Y, comps) : opex(comps));
    td.appendChild(d); dr.appendChild(td); tb.appendChild(dr);
  }

  // OPEX lines as laid out in OPEX: Sr No, description, the twelve months and the year.
  function opex(comps) {
    const w = el('div', 'nest'), tw = el('div', 'tw2'), t = el('table');
    t.appendChild(head([['Sr No', 'l'], ['Description', 'l'], ...MONTHS.map((m) => [m]), ['Total'], ['Counted']]));
    const tb = el('tbody');
    let grp;
    comps.slice().sort((a, b) => a.ord - b.ord).forEach((c) => {
      if (c.group && c.group !== grp) groupRow(tb, (grp = c.group), MONTHS.length + 4);
      const tr = el('tr', c.flags ? 'flag' : '');
      tr.append(el('td', 'l', srf(c.sr)), el('td', 'galine', c.line));
      MONTHS.forEach((m) => tr.appendChild(el('td', null, fm(c[m]))));
      tr.appendChild(el('td', null, fm(c.opex_total)));
      const n = el('td', 'tot', fm(c.amount));
      if (c.flags) flag(n, c.flags);
      tr.appendChild(n);
      tb.appendChild(tr);
    });
    const tr = el('tr', 'tt');
    tr.append(el('td'), el('td', 'galine', 'Total'));
    MONTHS.forEach((m) => tr.appendChild(el('td', null, fm(sum(comps.map((c) => c[m]))))));
    tr.append(el('td', null, fm(sum(comps.map((c) => c.opex_total)))), el('td', 'tot', fm(sum(comps.map((c) => c.amount)))));
    tb.appendChild(tr);
    t.appendChild(tb); tw.appendChild(t); w.appendChild(tw);
    return w;
  }

  // Depreciation: each purchase batch (5 years straight line) opening to its CAPEX lines.
  function capex(g, Y, comps) {
    const w = el('div', 'nest'), tw = el('div', 'tw2'), t = el('table');
    t.appendChild(head([['Assets bought', 'l'], ['Amount'], ...Y.map((y) => [fy(y)])]));
    const tb = el('tbody');
    comps.filter((c) => c.kind === 'asset').forEach((b) => {
      const batch = b.line.replace(/^Assets bought in /, ''), k = g.key + '|' + batch, tr = el('tr', b.flags ? 'flag' : '');
      const lab = el('td', 'l');
      lab.append(el('span', 'chev', '▸'), document.createTextNode(batch));
      if (b.flags) flag(lab, b.flags);
      tr.appendChild(lab);
      tr.appendChild(el('td', null, fm(b.amount)));
      Y.forEach((y) => tr.appendChild(el('td', null, fm(b['v ' + y]))));
      clickable(tr, k);
      tb.appendChild(tr);
      if (!G.open.has(k)) return;
      const items = comps.filter((c) => c.kind === 'capex' && c.batch === batch);
      const dr = el('tr', 'dr'), td = el('td'); td.colSpan = Y.length + 2;
      const it = el('div', 'tw2'), t2 = el('table');
      t2.appendChild(head([['Sr No', 'l'], ['Description', 'l'], ['Unit cost'], ...MONTHS.map((m) => [m]), ['Amount']]));
      const b2 = el('tbody');
      let grp;
      items.forEach((c) => {
        if (c.group && c.group !== grp) groupRow(b2, (grp = c.group), MONTHS.length + 4);
        const r = el('tr');
        r.append(el('td', 'l', srf(c.sr)), el('td', 'galine', c.line), el('td', null, fm(c.unit)));
        MONTHS.forEach((m) => r.appendChild(el('td', null, isNum(c[m]) && c[m] ? String(+c[m].toFixed(2)) : '')));
        r.appendChild(el('td', 'tot', fm(c.amount)));
        b2.appendChild(r);
      });
      const tt = el('tr', 'tt');
      tt.append(el('td'), el('td', 'galine', 'Total'), el('td'));
      MONTHS.forEach(() => tt.appendChild(el('td')));
      tt.appendChild(el('td', 'tot', fm(sum(items.map((c) => c.amount)))));
      b2.appendChild(tt);
      t2.appendChild(b2); it.appendChild(t2); td.appendChild(it); dr.appendChild(td); tb.appendChild(dr);
    });
    t.appendChild(tb); tw.appendChild(t); w.appendChild(tw);
    return w;
  }

  window.SobhaGA = { render };
})();
