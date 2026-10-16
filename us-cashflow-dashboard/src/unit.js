// Unit economics view: per project, the sales and cost build-up of an entity (dataset
// unit_economics, built by derive-unit.js) on one basis at a time: total, per unit (lot or home),
// per sq ft of saleable area (SBA), per sq ft of plotted lot (Landowner), per acre, or as a share
// of sales. Projects across, All projects last.
(function () {
  'use strict';
  const U = { basis: { consol: 'unit', lo: 'unit', hb: 'unit' } };
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const ENT = { consol: 'consol', lo: 'landowner', hb: 'homebuilder' };
  const ALL = 'All projects';

  // Areas and counts (on every basis): [label, field or [numerator, denominator], format]. A ratio
  // for All projects is over the projects that have both.
  const SIZE = {
    lo: [['Land area (acres)', 'acres', 'ac'], ['Lots', 'units', 'n'], ['Lots per acre', ['units', 'acres'], 'd1'],
      ['Plotted lot area (sq ft)', 'plotted', 'n'], ['Average lot size (sq ft)', ['plotted', 'units'], 'n'],
      ['Home SBA on the lots (sq ft)', 'sba', 'n'], ['Average home size (sq ft)', ['sba', 'units'], 'n']],
    hb: [['Homes', 'units', 'n'], ['Saleable area, SBA (sq ft)', 'sba', 'n'], ['Average home size (sq ft)', ['sba', 'units'], 'n']],
    consol: [['Land area (acres)', 'acres', 'ac'], ['Homes', 'units', 'n'], ['Homes per acre', ['units', 'acres'], 'd1'],
      ['Saleable area, SBA (sq ft)', 'sba', 'n'], ['Average home size (sq ft)', ['sba', 'units'], 'n']],
  };
  const sizeOf = (rows, f) => {
    const ok = (r, k) => isNum(r[k]) && r[k];
    if (!Array.isArray(f)) return rows.reduce((s, r) => s + (ok(r, f) ? r[f] : 0), 0);
    const has = rows.filter((r) => ok(r, f[0]) && ok(r, f[1])), d = has.reduce((s, r) => s + r[f[1]], 0);
    return d ? has.reduce((s, r) => s + r[f[0]], 0) / d : null;
  };
  // [field, label, row kind]: 'rev' sales, '' a cost, 'st' a subtotal, 't' a total, 'p' profit, 'm' margin of the profit above.
  const LINES = {
    lo: [['sales', 'Lot sales', 'rev'], ['land', 'Land', ''], ['infra', 'Infrastructure', ''], ['pid_processing', 'PID / debt processing', ''], ['pid_reimb', 'PID reimbursement', ''],
      ['direct', 'Total direct cost', 'st'], ['gross_profit', 'Gross profit', 'p'], ['gross_profit', 'Gross margin', 'm'],
      ['rpt', 'Real property tax', ''], ['finance', 'Finance cost (incl. loan fees)', ''], ['total', 'Total cost', 't'],
      ['profit', 'Profit before overheads and tax', 'p'], ['profit', 'Margin', 'm']],
    hb: [['sales', 'Home sales', 'rev'], ['land', 'Lot cost (from the Landowner)', ''], ['construction', 'Construction', ''], ['dns', 'Design & supervision', ''], ['authority', 'Authority', ''],
      ['dev', 'Development cost', 'st'], ['brokerage', 'Brokerage', ''], ['direct', 'Total direct cost', 'st'], ['gross_profit', 'Gross profit', 'p'], ['gross_profit', 'Gross margin', 'm'],
      ['marketing', 'Sales & marketing', ''], ['rpt', 'Real property tax', ''], ['finance', 'Finance cost', ''], ['total', 'Total cost', 't'],
      ['profit', 'Profit before overheads and tax', 'p'], ['profit', 'Margin', 'm']],
    consol: [['sales', 'Home sales', 'rev'], ['land', 'Raw land (lots, for lot-buying projects)', ''], ['infra_net', 'Infrastructure, net of PID', ''], ['lo_other', 'Landowner property tax & finance', ''],
      ['lo_total', 'Land & infrastructure (Landowner cost)', 'st'], ['construction', 'Construction', ''], ['dns', 'Design & supervision', ''], ['authority', 'Authority', ''],
      ['dev', 'Development cost', 'st'], ['brokerage', 'Brokerage', ''], ['direct', 'Total direct cost', 'st'], ['gross_profit', 'Gross profit', 'p'], ['gross_profit', 'Gross margin', 'm'],
      ['marketing', 'Sales & marketing', ''], ['rpt', 'Real property tax (Homebuilder)', ''], ['finance', 'Finance cost (Homebuilder)', ''], ['total', 'Total cost', 't'],
      ['profit', 'Profit before overheads and tax', 'p'], ['profit', 'Margin', 'm']],
  };
  // Bases: [key, button, what a figure is, divisor].
  const unitWord = (e) => (e === 'lo' ? 'lot' : 'home');
  const BASES = (e) => [
    ['total', 'Total', 'USD, full life', () => 1],
    ['unit', 'Per ' + unitWord(e), 'USD per ' + unitWord(e), (r) => r.units],
    ['sqft', 'Per sq ft', e === 'lo' ? 'USD per sq ft of home SBA on the lots' : 'USD per sq ft of saleable area (SBA)', (r) => r.sba],
  ].concat(e === 'lo' ? [['lotsqft', 'Per sq ft of lot', 'USD per sq ft of plotted lot area', (r) => r.plotted]] : [])
    .concat(e === 'hb' ? [] : [['acre', 'Per acre', 'USD per acre of land', (r) => r.acres]])
    .concat([['pct', '% of sales', 'share of sales', (r) => r.sales]]);

  const n0 = (v) => Math.round(v).toLocaleString('en-US');
  const money = (v, dp) => { if (!isNum(v)) return '–'; if (Math.abs(v) < (dp ? 0.005 : 0.5)) return '–'; const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }); return v < 0 ? '(' + s + ')' : s; };
  const SIZEF = { n: (v) => (isNum(v) && v ? n0(v) : '–'), ac: (v) => (isNum(v) && v ? (+v.toFixed(2)).toLocaleString('en-US') : '–'), d1: (v) => (isNum(v) && v ? v.toFixed(1) : '–') };

  let box = null;
  function render(container, ent, col) {
    box = container || box;
    if (ent) U.ent = ent;
    if (col) col.hidden = true;
    if (!box) return;
    draw();
  }
  function draw() {
    box.replaceChildren();
    const e = U.ent, D = (window.dash.data('unit_economics').data || []).filter((r) => r.entity === ENT[e]);
    if (!D.length) { box.appendChild(el('p', 'note', 'No project budget in the models for this entity.')); return; }
    const prof = window.dash.data('project_profile').data || [];
    const P = (p) => prof.find((x) => x.project === p) || {};
    // Plotted lot area (Landowner) from the project details, where they give it.
    const rows = D.map((r) => Object.assign({}, r, { plotted: e === 'lo' && isNum(P(r.project).plotted_sqft) && P(r.project).plotted_sqft ? P(r.project).plotted_sqft : null }));
    const bases = BASES(e);
    if (!bases.some((b) => b[0] === U.basis[e])) U.basis[e] = 'unit';
    const [bk, , bwhat, div] = bases.find((b) => b[0] === U.basis[e]);

    const bar = el('div', 'uebar');
    const seg = el('div', 'seg ueseg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Basis');
    bases.forEach(([k, label]) => {
      const b = el('button', k === bk ? 'on' : '', label); b.type = 'button'; b.setAttribute('aria-pressed', String(k === bk));
      b.onclick = () => { U.basis[e] = k; draw(); };
      seg.appendChild(b);
    });
    bar.appendChild(seg);
    bar.appendChild(el('span', 'uewhat', bwhat));
    box.appendChild(bar);

    // All projects: amounts added up; a ratio over the projects that have its basis.
    const sum = (f) => rows.reduce((s, r) => s + (isNum(f(r)) ? f(r) : 0), 0);
    const sales = sum((r) => r.sales);
    const allVal = (k) => {
      if (bk === 'total') return sum((r) => r[k]);
      const has = rows.filter((r) => isNum(div(r)) && div(r));
      const d = has.reduce((s, r) => s + div(r), 0);
      return d ? has.reduce((s, r) => s + (isNum(r[k]) ? r[k] : 0), 0) / d : null;
    };
    const left = bk === 'total' ? [] : rows.filter((r) => !(isNum(div(r)) && div(r)) && (r.total || r.sales));

    const tw = el('div', 'tw uetw'), t = el('table', 'stmt uet');
    t.setAttribute('data-source', 'unit_economics'); t.setAttribute('data-row-key', 'key');
    const hr = el('tr');
    hr.appendChild(el('th', 'l', ''));
    rows.forEach((r) => {
      const p = P(r.project), th = el('th', 'n');
      th.title = r.project; th.dataset.key = r.key;
      th.appendChild(el('span', 'uenm', p.report_name || r.project.replace(/\s*[@(].*$/, '')));
      if (p.status) th.appendChild(el('small', 'uest', p.status));
      hr.appendChild(th);
    });
    const tha = el('th', 'n uall'); tha.appendChild(el('span', 'uenm', ALL)); hr.appendChild(tha);
    const thead = el('thead'); thead.appendChild(hr); t.appendChild(thead);
    const tb = el('tbody');
    const head = (label) => { const tr = el('tr', 'g'); const c = el('td', null, label); tr.appendChild(c); for (let i = 0; i <= rows.length; i++) tr.appendChild(el('td')); tb.appendChild(tr); };
    head('Size');
    SIZE[e].forEach(([label, f, fm]) => {
      const tr = el('tr'); tr.appendChild(el('td', null, label));
      rows.forEach((r) => tr.appendChild(el('td', null, SIZEF[fm](sizeOf([r], f)))));
      tr.appendChild(el('td', 'uall', SIZEF[fm](sizeOf(rows, f)))); tb.appendChild(tr);
    });
    head(bk === 'total' ? 'Sales and costs (USD)' : bk === 'pct' ? 'Sales and costs (% of sales)' : 'Sales and costs (' + bwhat + ')');
    const fmtV = (v) => (bk === 'pct' ? (isNum(v) ? (v * 100).toFixed(1) + '%' : '–') : money(v, bk === 'sqft' || bk === 'lotsqft' ? 2 : 0));
    LINES[e].forEach(([k, label, kind]) => {
      // A line no project has (e.g. infrastructure split for a model without the Landowner budget).
      if (!rows.some((r) => isNum(r[k]) && Math.abs(r[k]) >= 0.5)) return;
      if (kind === 'm' && bk === 'pct') return; // the profit line above already is its margin
      const tr = el('tr', kind === 't' || kind === 'p' ? 't' : kind === 'st' ? 'st' : kind === 'm' ? 'uem' : kind === 'rev' ? 'uerev' : '');
      tr.appendChild(el('td', null, label));
      const cell = (r, v, all) => {
        const c = el('td', all ? 'uall' : null);
        if (kind === 'm') c.textContent = isNum(r[k]) && r.sales ? ((r[k] / r.sales) * 100).toFixed(1) + '%' : '–';
        else { c.textContent = fmtV(v); if (isNum(v) && v < -0.005) c.classList.add('neg'); }
        if (!all) { c.setAttribute('data-field', k); c.setAttribute('data-where', 'key=' + r.key); }
        return c;
      };
      rows.forEach((r) => { const d = div(r); tr.appendChild(cell(r, isNum(r[k]) && isNum(d) && d ? r[k] / d : null)); });
      const all = { sales }; all[k] = sum((r) => r[k]);
      tr.appendChild(cell(all, allVal(k), true));
      tb.appendChild(tr);
    });
    t.appendChild(tb); tw.appendChild(t); box.appendChild(tw);
    const notes = ['Full life, from each model’s project budget (' + (e === 'lo' ? '‘HS Budget costs1’' : e === 'hb' ? '‘Cons Budgetd Costs’' : '‘Cons Budgetd Costs new’ and ‘HS Budget costs1’') + ')' +
      (e === 'lo' ? '; plotted lot area from the project details.' : '; brokerage, sales & marketing and real property tax from the project P&L, so direct cost and gross profit are the project P&L’s.')];
    if (left.length) notes.push(ALL + ' ' + bwhat.replace(/^USD /, '').replace(/^share of sales/, 'as a share of sales') + ': over the projects that have it (not ' + left.map((r) => P(r.project).report_name || r.project).join(', ') + ').');
    box.appendChild(el('p', 'note', notes.join(' ')));
  }

  window.SobhaUnit = { render };
})();
