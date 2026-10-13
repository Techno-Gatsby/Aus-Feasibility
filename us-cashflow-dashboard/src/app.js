(function () {
  const ENT = {
    consol: { ds: 'consol_cf', comp: 'consol_components' },
    landowner: { ds: 'landowner_cf' },
    homebuilder: { ds: 'homebuilder_cf' },
  };
  const NONPER = new Set(['key', 'project', 'ord', 'line', 'kind', 'Budget', 'Total', 'Sheet', 'Rows', 'Cells', 'Formula (FY2027 cell)', 'Basis', 'parent', 'level', 'stmt', 'role', 'rule']);
  const TEAL = '#0D9488', PURPLE = '#7C3AED', NAVY = '#1A2B6B';
  const S = { tab: 'consol', ent: {}, editing: null, draft: null };
  let rendering = false, again = false; // see render()
  Object.keys(ENT).forEach((k) => (S.ent[k] = { proj: 'All Projects', mix: 'out', lines: new Set(), projs: new Set(), zero: new Set(), comps: new Set(), stmt: 'cf', pl: new Set(), detail: null, detailTop: false }));

  const root = document.querySelector('.sb');
  const enc = (s) => String(s).replace(/%/g, '%25').replace(/&/g, '%26').replace(/=/g, '%3D');
  const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
  const isUnits = (line) => norm(line) === 'sales unit';
  const fM = d3.format(',.1f'), f0 = d3.format(',.0f'), f1 = d3.format(',.2~f');
  const cmp = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
  const projLabel = (p) => (p === 'All Projects' ? 'All projects' : p);
  const isZero = (r, P) => P.every((p) => Math.abs(+r[p] || 0) < 0.5);

  function fmt(v, line) {
    if (v == null || v === '') return '';
    v = +v;
    if (Math.abs(v) < 0.5) return '–';
    if (isUnits(line)) return f1(v);
    const s = f0(Math.abs(v));
    return v < 0 ? '(' + s + ')' : s;
  }
  function money(v, line) {
    if (v == null || v === '') return '–';
    v = +v;
    if (isUnits(line)) return f0(v) + ' units';
    if (Math.abs(v) < 0.5) return '$0';
    return (v < 0 ? '−$' : '$') + f0(Math.abs(v));
  }
  function full(v, line) {
    if (v == null || v === '') return 'n/a';
    v = +v;
    if (isUnits(line)) return f0(v) + ' units';
    return (v < 0 ? '−$' : '$') + f0(Math.abs(v));
  }
  const axisMoney = (v) => (v === 0 ? '0' : (v < 0 ? '−$' : '$') + cmp.format(Math.abs(v)));
  function periodsOf(d) {
    const cols = d.columns && d.columns.length ? d.columns : Object.keys((d.data || [])[0] || {});
    return cols.filter((c) => !NONPER.has(c));
  }
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function td(tr, text, cls) { const c = el('td', cls, text); tr.appendChild(c); return c; }
  function mark(node, ds, field, key) { node.setAttribute('data-source', ds); node.setAttribute('data-field', field); node.setAttribute('data-where', 'key=' + enc(key)); return node; }
  function numCells(tr, r, P, line) {
    const noTot = r.kind === 'balance' || r.kind === 'header';
    const t = td(tr, noTot ? '' : fmt(r.Total, line), 'tot'); if (+r.Total < -0.5) t.classList.add('neg');
    P.forEach((p) => { const c = td(tr, fmt(r[p], line)); if (+r[p] < -0.5) c.classList.add('neg'); });
  }
  function clickable(tr, fn, open) {
    tr.classList.add('k');
    tr.tabIndex = 0;
    tr.setAttribute('aria-expanded', String(!!open));
    if (open) tr.classList.add('open');
    tr.addEventListener('click', fn);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } });
  }
  function firstCell(tr, text, chev) {
    const c = el('td'); c.title = text;
    if (chev) c.appendChild(el('span', 'chev', '▶'));
    c.appendChild(el('span', 'nm', text));
    tr.appendChild(c);
    return c;
  }
  function toggle(set, k) { set.has(k) ? set.delete(k) : set.add(k); render(); }
  function fail(n) { n.replaceChildren(el('div', 'fail', 'Failed to load')); }
  // ---------- tooltip ----------
  function tipFor(box) {
    let t = box.querySelector(':scope > .tip');
    if (!t) { t = document.createElement('div'); t.className = 'tip'; t.hidden = true; box.appendChild(t); }
    return t;
  }
  function showTip(box, t, ev, head, lines) {
    t.replaceChildren();
    const h = document.createElement('div'); h.className = 'h'; h.textContent = head; t.appendChild(h);
    lines.forEach(([color, name, val]) => {
      const row = document.createElement('div');
      if (color) { const s = document.createElement('span'); s.className = 'sw'; s.style.background = color; if (color === 'line') { s.style.background = NAVY; s.style.height = '2px'; s.style.verticalAlign = 'middle'; } row.appendChild(s); }
      row.appendChild(document.createTextNode(name + '  '));
      const b = document.createElement('b'); b.textContent = val; row.appendChild(b);
      t.appendChild(row);
    });
    t.hidden = false;
    const r = box.getBoundingClientRect();
    let x = ev.clientX - r.left + 12, y = ev.clientY - r.top + 12;
    const tw = t.offsetWidth, th = t.offsetHeight;
    if (x + tw > r.width) x = Math.max(0, ev.clientX - r.left - tw - 12);
    if (y + th > r.height) y = Math.max(0, r.height - th);
    t.style.left = x + 'px'; t.style.top = y + 'px';
  }

  function measure(svg, strings) {
    const g = svg.append('g').attr('opacity', 0);
    let w = 0;
    strings.forEach((s) => { const t = g.append('text').text(s); w = Math.max(w, t.node().getComputedTextLength()); });
    g.remove();
    return w;
  }

  // ---------- flow chart (in vs out vs closing) ----------
  function drawFlow(el, P, rin, rout, rcl, onPick) {
    el.querySelectorAll('svg,.legend,.fail').forEach((n) => n.remove());
    const W = Math.max(280, el.clientWidth || 600), H = 250;
    const svg = d3.select(el).insert('svg', ':first-child').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`);
    const val = (r, p) => (r ? +r[p] || 0 : 0);
    const all = P.flatMap((p) => [val(rin, p), val(rout, p), val(rcl, p)]);
    const y = d3.scaleLinear([Math.min(0, d3.min(all)), Math.max(1, d3.max(all))], [H - 30, 10]).nice();
    const ticks = y.ticks(5);
    const ml = measure(svg, ticks.map(axisMoney)) + 12;
    const x0 = d3.scaleBand(P, [ml, W - 8]).padding(0.22);
    const x1 = d3.scaleBand(['in', 'out'], [0, x0.bandwidth()]).padding(0.08);
    const lw = measure(svg, P);
    const rotate = lw > x0.step() - 4;
    const mb = rotate ? lw * 0.6 + 16 : 22;
    y.range([H - mb, 10]);
    svg.append('g').selectAll('line').data(ticks).join('line')
      .attr('x1', ml).attr('x2', W - 8).attr('y1', (d) => y(d)).attr('y2', (d) => y(d))
      .style('stroke', (v) => (v === 0 ? '#C9CED8' : '#EEF0F4'));
    svg.append('g').selectAll('text').data(ticks).join('text')
      .attr('x', ml - 6).attr('y', (v) => y(v)).attr('dy', '0.32em').attr('text-anchor', 'end').text(axisMoney);
    svg.append('line').attr('x1', ml).attr('x2', W - 8).attr('y1', y(0)).attr('y2', y(0)).style('stroke', '#C9CED8');
    const xl = svg.append('g').selectAll('text').data(P).join('text').text((p) => p);
    if (rotate) xl.attr('transform', (p) => `translate(${x0(p) + x0.bandwidth() / 2},${H - mb + 12}) rotate(-35)`).attr('text-anchor', 'end');
    else xl.attr('x', (p) => x0(p) + x0.bandwidth() / 2).attr('y', H - 6).attr('text-anchor', 'middle');

    const tip = tipFor(el);
    const groups = svg.append('g').selectAll('g').data(P).join('g').attr('transform', (p) => `translate(${x0(p)},0)`);
    groups.append('rect').attr('x', 0).attr('width', x0.bandwidth()).attr('y', 0).attr('height', H - mb).style('fill', 'transparent');
    [['in', rin, TEAL, 'Total inflows'], ['out', rout, PURPLE, 'Total outflows']].forEach(([k, r, c, line]) => {
      groups.append('rect')
        .attr('x', x1(k)).attr('width', x1.bandwidth())
        .attr('y', (p) => y(Math.max(0, val(r, p)))).attr('height', (p) => Math.abs(y(val(r, p)) - y(0)))
        .attr('rx', 3).style('fill', c).style('cursor', 'pointer')
        .on('click', () => onPick(line));
    });
    groups.on('mousemove', (ev, p) => showTip(el, tip, ev, p, [
      [TEAL, 'Inflows', money(val(rin, p))], [PURPLE, 'Outflows', money(val(rout, p))], ['line', 'Closing cash', money(val(rcl, p))],
    ])).on('mouseleave', () => (tip.hidden = true));
    if (rcl) {
      const line = d3.line().x((p) => x0(p) + x0.bandwidth() / 2).y((p) => y(val(rcl, p)));
      svg.append('path').datum(P).attr('d', line).style('fill', 'none').style('stroke', NAVY)
        .style('stroke-width', 2).style('stroke-linecap', 'round').style('stroke-linejoin', 'round').style('pointer-events', 'none');
      svg.append('g').selectAll('circle').data(P).join('circle').attr('r', 3)
        .attr('cx', (p) => x0(p) + x0.bandwidth() / 2).attr('cy', (p) => y(val(rcl, p)))
        .style('fill', '#fff').style('stroke', NAVY).style('stroke-width', 1.5).style('pointer-events', 'none');
    }
    const lg = document.createElement('div'); lg.className = 'legend';
    [[TEAL, 'Inflows'], [PURPLE, 'Outflows'], [NAVY, 'Closing cash (line)']].forEach(([c, n]) => {
      const s = document.createElement('span'); const i = document.createElement('i'); i.style.background = c; s.append(i, n); lg.appendChild(s);
    });
    el.appendChild(lg);
  }

  // ---------- horizontal bars ----------
  function hbars(el, items, cls, onPick) {
    el.replaceChildren();
    const max = d3.max(items, (i) => Math.abs(i.v)) || 1;
    items.forEach((it) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hb ' + (cls || '') + (it.v < 0 ? ' neg' : '');
      const lb = document.createElement('span'); lb.className = 'lb'; lb.textContent = it.label; lb.title = it.label;
      const tr = document.createElement('span'); tr.className = 'tr';
      const i = document.createElement('i'); i.style.width = (Math.abs(it.v) / max) * 100 + '%'; tr.appendChild(i);
      const v = document.createElement('span'); v.className = 'v'; v.textContent = money(it.v, it.line);
      b.append(lb, tr, v);
      b.addEventListener('click', () => onPick(it));
      el.appendChild(b);
    });
    if (!items.length) { const p = document.createElement('p'); p.className = 'note'; p.textContent = 'No amounts on this line for the selection.'; el.appendChild(p); }
  }


  // ---------- detail row (where a figure comes from) ----------
  function compsFor(r) {
    const cd = dash.data('consol_components');
    if (cd.status !== 'ok' || r.project === 'All Projects') return [];
    return cd.data.filter((c) => c.project === r.project && norm(c.consol_line) === norm(r.line));
  }
  function detailRow(tb, r, E, st, P, width, ncols) {
    const tr = el('tr', 'dr');
    const c = el('td'); c.colSpan = ncols;
    const dx = el('div', 'dx'); dx.style.width = width + 'px';
    dx.appendChild(components(r, st, P));
    c.appendChild(dx); tr.appendChild(c); tb.appendChild(tr);
  }

  function components(r, st, P) {
    const box = el('div', 'nest');
    const comps = compsFor(r);
    box.appendChild(el('h4', null, 'Built from these Landowner and Homebuilder lines'));
    const w = el('div', 'tw2');
    const t = el('table'); t.setAttribute('data-source', 'consol_components'); t.setAttribute('data-row-key', 'key');
    const hr = el('tr');
    [['component', 'Component', 'l'], ['entity', 'Model', 'l'], ['sign', '+/−', ''], ['Total', 'Total', 'n']].concat(P.map((p) => [p, p.replace('-', '–'), 'n']))
      .forEach(([f, l, cls]) => { const th = el('th', cls, l); th.setAttribute('data-field', f); hr.appendChild(th); });
    const th = el('thead'); th.appendChild(hr); t.appendChild(th);
    const tb = el('tbody');
    comps.forEach((c) => {
      const tr = el('tr'); tr.dataset.key = c.key;
      firstCell(tr, c.component, false); td(tr, c.entity, 'l'); td(tr, c.sign);
      const tt = td(tr, fmt(c.Total, c.component), 'tot'); if (+c.Total < -0.5) tt.classList.add('neg');
      P.forEach((p) => { const x = td(tr, fmt(c[p], c.component)); if (+c[p] < -0.5) x.classList.add('neg'); });
      tb.appendChild(tr);
    });
    t.appendChild(tb); w.appendChild(t); box.appendChild(w);
    return box;
  }

  // ---------- statement ----------
  // Column headers follow the data, so a model rolled forward a year shows its own periods.
  function setHead(table, P) {
    const sig = P.join('|');
    if (!table || table.dataset.cols === sig) return;
    table.dataset.cols = sig;
    const tr = table.querySelector('thead tr');
    const th = (f, t) => { const h = el('th', f === 'line' ? 'l' : 'n', t); h.setAttribute('data-field', f); tr.appendChild(h); };
    tr.replaceChildren(); th('line', 'Particular'); th('Total', 'Total'); P.forEach((p) => th(p, p.replace('-', '–')));
  }
  function renderTable(sec, E, st, rows, P) {
    setHead(sec.querySelector('.view-cf .stmt'), P);
    const tw = sec.querySelector('.tw');
    const width = Math.max(260, tw.clientWidth - 2);
    const ncols = P.length + 2;
    const tb = sec.querySelector('.stmt tbody');
    tb.replaceChildren();
    const order = [...new Set(rows.map((r) => r.project))];
    const prow = rows.filter((r) => r.project === st.proj).sort((a, b) => a.ord - b.ord);
    prow.forEach((r) => {
      const tr = el('tr', ({ header: 'g', total: 't', balance: 'b', memo: 'm', item: '' }[r.kind] || '') + ' l0');
      tr.dataset.key = r.key;
      if (r.kind === 'header') { firstCell(tr, r.line.replace(/:$/, ''), false); for (let i = 0; i < P.length + 1; i++) td(tr, ''); tb.appendChild(tr); return; }
      const lk = norm(r.line), open = st.lines.has(lk);
      const single = st.proj !== 'All Projects';
      const can = !single || (E.comp && compsFor(r).length);
      firstCell(tr, r.line, !!can); numCells(tr, r, P, r.line);
      if (can) clickable(tr, () => toggle(st.lines, lk), open);
      tb.appendChild(tr);
      if (!open || !can) return;
      if (single) { detailRow(tb, r, E, st, P, width, ncols); return; }
      const pr = rows.filter((x) => x.project !== 'All Projects' && norm(x.line) === lk)
        .sort((a, b) => order.indexOf(a.project) - order.indexOf(b.project));
      pr.forEach((x) => {
        const ptr = el('tr', 'p' + (isZero(x, P) ? ' zero' : ''));
        ptr.dataset.key = x.key;
        const pk = lk + '|' + x.project, popen = st.projs.has(pk);
        const pcan = E.comp && compsFor(x).length;
        const fc = firstCell(ptr, x.project, !!pcan); detailsBtn(fc, x.project, x.key, st); numCells(ptr, x, P, x.line);
        if (pcan) clickable(ptr, () => toggle(st.projs, pk), popen);
        tb.appendChild(ptr);
        if (st.detail === x.key) detailsRow(tb, x.project, width, ncols);
        if (popen && pcan) detailRow(tb, x, E, st, P, width, ncols);
      });
    });
    const col = sec.querySelector('.collapse');
    col.hidden = !st.lines.size;
    col.onclick = () => { st.lines.clear(); st.projs.clear(); st.comps.clear(); render(); };
  }

  function between(rows, a, b) {
    const s = rows.find((r) => norm(r.line) === norm(a)), e = rows.find((r) => norm(r.line) === norm(b));
    return s && e ? rows.filter((r) => r.ord > s.ord && r.ord < e.ord && r.kind === 'item') : [];
  }

  function openLine(line) {
    const st = S.ent[S.tab], sec = document.getElementById(S.tab);
    st.lines.add(norm(line));
    render();
    const d = dash.data(ENT[S.tab].ds);
    const r = d.status === 'ok' && d.data.find((x) => x.project === st.proj && norm(x.line) === norm(line));
    const tr = r && sec.querySelector(`.stmt tr[data-key="${CSS.escape(r.key)}"]`);
    if (tr) tr.scrollIntoView({ block: 'center' });
  }

  function renderSummary(sec, E, st, rows, P) {
    const prow = rows.filter((r) => r.project === st.proj);
    const find = (l) => prow.find((r) => norm(r.line) === norm(l));
    { const kb = sec.querySelector('.view-cf .irrk'); const b = kb.querySelector('b'); const ir = dash.data('project_irr');
      b.classList.remove('dash-skeleton');
      const row = ir.status === 'ok' ? ir.data.find((x) => x.entity === S.tab && x.project === st.proj) : null;
      if (row) { b.setAttribute('data-where', 'key=' + enc(row.key)); b.textContent = row.pretax_equity_irr == null ? 'n/a' : (row.pretax_equity_irr * 100).toFixed(2) + '%'; } else b.textContent = '—';
      kb.onclick = null; kb.style.cursor = 'default'; }
    { const sd = dash.data('project_summary');
      const row = sd.status === 'ok' ? sd.data.find((x) => x.entity === S.tab && x.project === st.proj) : null;
      const F = { money: (v) => money(v), pct: (v) => (v * 100).toFixed(1) + '%', x: (v) => v.toFixed(2) + 'x' };
      sec.querySelectorAll('.view-cf .sumk').forEach((kb) => {
        const b = kb.querySelector('b'), f = kb.dataset.f; b.classList.remove('dash-skeleton'); kb.style.cursor = 'default';
        const v = row ? row[f] : null;
        if (row && v != null) { b.setAttribute('data-where', 'key=' + enc(row.key)); b.textContent = F[kb.dataset.fmt](v); } else b.textContent = 'n/a';
        const sb = kb.querySelector('.ksub');
        if (sb) { const sv = row ? row[kb.dataset.sub] : null; if (row && sv != null) { sb.setAttribute('data-where', 'key=' + enc(row.key)); sb.textContent = (sv * 100).toFixed(1) + '% margin'; } else sb.textContent = ''; }
      }); }
    { const xd = dash.data('kpi_extra');
      const row = xd.status === 'ok' ? xd.data.find((x) => x.entity === S.tab && x.project === st.proj) : null;
      sec.querySelectorAll('.view-cf .xk').forEach((kb) => {
        const b = kb.querySelector('b'), f = kb.dataset.f; b.classList.remove('dash-skeleton'); kb.style.cursor = 'default';
        const v = row ? row[f] : null;
        if (row && v != null && !(f === 'peak_debt' && !v)) { b.setAttribute('data-where', 'key=' + enc(row.key)); b.textContent = kb.dataset.fmt === 'sqft' ? f0(v) + ' sqft' : kb.dataset.fmt === 'date' ? mon(v) : money(v); }
        else b.textContent = f === 'peak_debt' && row ? 'No debt' : 'n/a';
        const sb = kb.querySelector('.ksub');
        if (sb) { const pv = row ? row[kb.dataset.sub] : null; if (pv) { sb.setAttribute('data-where', 'key=' + enc(row.key)); sb.textContent = kb.dataset.sub === 'start' ? 'from ' + mon(pv) : 'peak in ' + pv.replace('FY20', 'FY'); } else sb.textContent = ''; }
      }); }
    { const xd = dash.data('kpi_extra'); const kb = sec.querySelector('.view-cf .pk'); const b = kb.querySelector('b'), sb = kb.querySelector('.ksub');
      b.classList.remove('dash-skeleton'); kb.style.cursor = 'default';
      const row = xd.status === 'ok' ? xd.data.find((x) => x.entity === S.tab && x.project === st.proj) : null;
      if (!row) { b.textContent = 'n/a'; sb.textContent = ''; }
      else if (st.proj === 'All Projects') { b.setAttribute('data-where', 'key=' + enc(row.key)); b.textContent = String(row.n_projects);
        sb.textContent = [row.n_confirmed + ' confirmed', row.n_consider ? row.n_consider + ' under consideration' : '', row.n_pipeline ? row.n_pipeline + ' pipeline' : ''].filter(Boolean).join(', '); }
      else { b.setAttribute('data-where', 'key=' + enc(row.key)); b.setAttribute('data-field', 'status'); b.textContent = row.status || 'n/a'; sb.textContent = ''; } }
    sec.querySelectorAll('.view-cf .kpi:not(.irrk):not(.sumk):not(.xk):not(.pk)').forEach((btn) => {
      const line = btn.dataset.line, r = find(line), b = btn.querySelector('b');
      b.classList.remove('dash-skeleton');
      if (r) { b.setAttribute('data-where', 'key=' + enc(r.key)); b.textContent = money(r.Total, line); } else b.textContent = '–';
      btn.onclick = () => openLine(line);
    });
  }


  // ---------- project details panel ----------
  const PD_SETS = ['kpi_extra', 'project_summary', 'actuals_plan', 'project_irr', 'project_profile', 'project_entity', 'project_sales', 'project_timeline', 'consol_project_pl', 'project_photos'];
  const mon = (s) => { if (!s) return ''; const d = new Date(s + 'T00:00:00Z'); return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }); };
  const pct = (v) => (v == null ? 'N/A' : (v * 100).toFixed(1) + '%');
  const mn = (v, dp) => (v == null ? 'N/A' : (v < 0 ? '(' : '') + '$' + Math.abs(v).toFixed(dp == null ? 2 : dp) + ' Mn' + (v < 0 ? ')' : ''));
  const num0 = (v, suf) => (v == null ? 'N/A' : f0(v) + (suf || ''));
  const mk = (node, ds, field, col, val) => { node.setAttribute('data-source', ds); node.setAttribute('data-field', field); node.setAttribute('data-where', col + '=' + enc(val)); return node; };
  function hasDetails(project) {
    const d = dash.data('project_profile');
    if (d.status === 'ok' && d.data.some((r) => r.project === project)) return true;
    // A project new in the models has no details yet; editors can add them.
    return ST().canWrite && project !== 'All Projects' && !/^(Corporate level|Eliminations)/.test(project);
  }
  function detailsBtn(td, project, rowKey, st) {
    if (!hasDetails(project)) return;
    const on = st.detail === rowKey;
    const b = el('button', 'pdbtn' + (on ? ' on' : ''));
    b.append(el('span', 'pd-long', on ? 'Hide details' : 'Project details'), el('span', 'pd-short', on ? 'Hide' : 'Details'));
    td.classList.add('hasbtn');
    b.type = 'button';
    b.addEventListener('click', (e) => { e.stopPropagation(); st.detail = st.detail === rowKey ? null : rowKey; render(); });
    b.addEventListener('keydown', (e) => e.stopPropagation());
    td.appendChild(b);
  }
  function detailsRow(tb, project, width, ncols) {
    const tr = el('tr', 'dr pdr'); const c = el('td'); c.colSpan = ncols;
    const box = makeDetails(project); box.style.width = width + 'px'; box.classList.add('sticky');
    c.appendChild(box); tr.appendChild(c); tb.appendChild(tr);
  }
  function tile(grid, label, text, ds, field, project) {
    const t = el('div', 'tile');
    t.appendChild(mk(el('b', null, text), ds, field, 'project', project));
    t.appendChild(el('span', null, label));
    grid.appendChild(t);
  }
  function makeDetails(project) {
    const box = el('div', 'pdx');
    const prof = dash.data('project_profile'), ent = dash.data('project_entity'), sal = dash.data('project_sales'), tl = dash.data('project_timeline'), pl = dash.data('consol_project_pl');
    if (prof.status !== 'ok') { box.appendChild(el('p', 'note', prof.status === 'error' ? 'Failed to load' : '')); return box; }
    if (S.editing === project && S.draft) return makeEditor(project);
    const p = prof.data.find((r) => r.project === project);
    const editBtn = () => { const b = el('button', 'btn quiet pdedit', p ? 'Edit details' : 'Add details'); b.type = 'button'; b.addEventListener('click', () => startEdit(project)); return b; };
    if (!p) {
      box.appendChild(el('p', 'note', 'No details for ' + project + ' yet. It is in the uploaded models but not in the project details.'));
      if (ST().canWrite) box.appendChild(editBtn());
      return box;
    }
    const head = el('div', 'pdh');
    head.appendChild(mk(el('h3', null, p.report_name + (p.location ? ', ' + p.location : '')), 'project_profile', 'report_name', 'project', project));
    if (p.status) head.appendChild(mk(el('span', 'chip ' + norm(p.status).replace(/\s+/g, '-'), p.status), 'project_profile', 'status', 'project', project));
    if (ST().details[project]) { const t = el('span', 'edtag', 'Edited'); t.title = 'Some details were changed on the dashboard'; head.appendChild(t); }
    if (ST().canWrite) head.appendChild(editBtn());
    box.appendChild(head);
    if (p.note) box.appendChild(mk(el('p', 'note', p.note), 'project_profile', 'note', 'project', project));

    // metrics
    const g = el('div', 'pdgrid');
    const c1 = el('div', 'pdcard'); c1.appendChild(el('h4', null, 'Development metrics'));
    const t1 = el('div', 'tiles');
    tile(t1, 'Land area', p.acreage == null ? 'N/A' : p.acreage + ' acres', 'project_profile', 'acreage', project);
    tile(t1, 'Net saleable area / BUA', num0(p.nsa_sqft, ' sqft'), 'project_profile', 'nsa_sqft', project);
    tile(t1, 'Proposed plotted area', num0(p.plotted_sqft, ' sqft'), 'project_profile', 'plotted_sqft', project);
    tile(t1, 'Number of lots', num0(p.units), 'project_profile', 'units', project);
    tile(t1, 'Plotting efficiency', p.plotting_eff == null ? 'N/A' : (p.plotting_eff * 100).toFixed(2) + '%', 'project_profile', 'plotting_eff', project);
    tile(t1, 'Average home size', num0(p.avg_home_sqft, ' sqft'), 'project_profile', 'avg_home_sqft', project);
    c1.appendChild(t1);
    const c2 = el('div', 'pdcard'); c2.appendChild(el('h4', null, 'Finance metrics'));
    const t2 = el('div', 'tiles');
    tile(t2, 'Gross revenue', mn(p.gross_revenue_m), 'project_profile', 'gross_revenue_m', project);
    tile(t2, 'Net profit after tax', mn(p.npat_m), 'project_profile', 'npat_m', project);
    tile(t2, 'Gross profit', mn(p.gross_profit_m), 'project_profile', 'gross_profit_m', project);
    tile(t2, 'Equity required', mn(p.equity_required_m), 'project_profile', 'equity_required_m', project);
    tile(t2, 'Average home price', mn(p.avg_home_price_m), 'project_profile', 'avg_home_price_m', project);
    tile(t2, 'Pre-tax IRR', pct(p.pretax_irr), 'project_profile', 'pretax_irr', project);
    tile(t2, 'Land cost', mn(p.land_cost_m), 'project_profile', 'land_cost_m', project);
    tile(t2, 'Infrastructure cost', mn(p.infra_cost_m), 'project_profile', 'infra_cost_m', project);
    tile(t2, 'Total direct cost', mn(p.total_direct_cost_m), 'project_profile', 'total_direct_cost_m', project);
    c2.appendChild(t2);
    g.append(c1, c2); box.appendChild(g);
    let photoCard = null;
    const ph = dash.data('project_photos');
    const pics = ph.status === 'ok' ? ph.data.filter((r) => r.project === project).sort((a, b) => a.order - b.order) : [];
    if (pics.length) {
      const pcard = el('div', 'pdcard'); pcard.appendChild(el('h4', null, 'Photos'));
      const gal = el('div', 'gal' + (pics.length === 1 ? ' one' : '')); gal.setAttribute('data-source', 'project_photos');
      pics.forEach((r) => {
        const fig = el('figure', 'ph ' + r.kind);
        const img = el('img'); img.src = String(r.image).startsWith('data:image/') ? r.image : ''; img.alt = r.caption; img.loading = 'lazy';
        img.addEventListener('click', () => fig.classList.toggle('big'));
        const cap = el('figcaption', null, r.caption);
        fig.append(img, cap); gal.appendChild(fig);
      });
      pcard.appendChild(gal);
      photoCard = pcard;
    }

    // timeline (input sheet)
    const tc = el('div', 'pdcard'); tc.appendChild(el('h4', null, 'Timeline'));
    const rows = tl.status === 'ok' ? tl.data.filter((r) => r.project === project) : [];
    const gantt = el('div', 'tw2'); gantt.setAttribute('data-source', 'project_timeline');
    if (rows.length) {
      const acts = [...new Set(rows.map((r) => r.activity))];
      const phases = [...new Set(rows.map((r) => r.phase))];
      const t = el('table', 'mini tl ctr'); const hr = el('tr'); hr.appendChild(el('th', 'l', phases.length > 1 ? 'Phase' : ''));
      acts.forEach((a) => hr.appendChild(el('th', 'n', a)));
      const th = el('thead'); th.appendChild(hr); t.appendChild(th); const tb = el('tbody');
      phases.forEach((ph) => {
        const tr = el('tr'); const pr = rows.find((r) => r.phase === ph);
        td(tr, ph === 'Project' ? 'Dates' : ph + (pr && pr.units ? ' (' + f0(pr.units) + ' units)' : ''), 'l ent');
        acts.forEach((a) => { const r = rows.find((x) => x.phase === ph && x.activity === a); td(tr, !r ? '–' : (a.startsWith('Close-out') ? mon(r.start) : mon(r.start) + ' – ' + mon(r.finish))); });
        tb.appendChild(tr);
      });
      t.appendChild(tb); gantt.appendChild(t);
    } else gantt.appendChild(el('p', 'note', 'No dates in the input sheet for this project yet.'));
    tc.appendChild(gantt);
    // milestones (PDF)
    const ents = ent.status === 'ok' ? ent.data.filter((r) => r.project === project) : [];
    if (ents.length) {
      tc.appendChild(el('h5', null, 'Key milestones'));
      tc.appendChild(etable(ents, [['entity', 'Type'], ['timeline', 'Timeline'], ['land_parcel_receipt', 'Land parcel receipt'], ['sales_commencement', 'Sales commencement'], ['development_completion', 'Development completion'], ['hand_over', 'Hand over']], (r, f) => r[f] || '–', 'ctr'));
    }
    box.appendChild(tc);

    // sales + equity
    const sc = el('div', 'pdcard'); sc.appendChild(el('h4', null, 'Sales timeline'));
    const srows = sal.status === 'ok' ? sal.data.filter((r) => r.project === project) : [];
    const sw = el('div', 'tw2'); sw.setAttribute('data-source', 'project_sales');
    if (srows.length) {
      const yrs = [...new Set(srows.map((r) => r.year))].sort();
      const t = el('table', 'mini'); const hr = el('tr'); ['', '', 'Total'].concat(yrs.map(String)).forEach((h, i) => hr.appendChild(el('th', i > 1 ? 'n' : 'l', h)));
      const th = el('thead'); th.appendChild(hr); t.appendChild(th); const tb = el('tbody');
      [...new Set(srows.map((r) => r.entity))].forEach((e) => {
        const er = srows.filter((r) => r.entity === e);
        const er0 = ents.find((x) => x.entity === e);
        const tot = er0 && er0.net_revenue_m != null ? er0.net_revenue_m : d3.sum(er, (r) => r.sales_value_m);
        const totu = p.units != null ? p.units : d3.sum(er, (r) => r.units);
        [['Sales value ($Mn)', 'sales_value_m', (v) => v.toFixed(1), tot.toFixed(1)], ['No. of units', 'units', (v) => f0(v), f0(totu)], ['% of sales', null, null, '100%']].forEach(([lab, f, fm, tv], i) => {
          const tr = el('tr', i === 0 ? 'first' : '');
          td(tr, i === 0 ? e : '', 'l ent'); td(tr, lab, 'l'); td(tr, tv, 'tot');
          yrs.forEach((y) => { const r = er.find((x) => x.year === y); td(tr, r ? (f ? fm(r[f]) : Math.round((r.sales_value_m / tot) * 100) + '%') : '–'); });
          tb.appendChild(tr);
        });
      });
      t.appendChild(tb); sw.appendChild(t);
    } else sw.appendChild(el('p', 'note', 'Not in the Executive Report.'));
    sc.appendChild(sw);
    const rc = el('div', 'pdcard'); rc.appendChild(el('h4', null, 'Returns'));
    const ec = el('div', 'pdcard'); ec.appendChild(el('h4', null, 'Equity schedule ($Mn)'));
    if (ents.length) {
      rc.appendChild(etable(ents, [['entity', 'Type'], ['pretax_irr', 'Pre-tax IRR'], ['net_revenue_m', 'Net revenue ($Mn)'], ['gp_margin', 'GP margin'], ['net_margin', 'Net margin'], ['equity_release', 'Equity release']],
        (r, f) => { const v = r[f]; if (v == null) return '–'; if (/irr|margin/.test(f)) return pct(v); return typeof v === 'number' ? v.toFixed(1) : v; }));
      const ys = Object.keys(ents[0]).filter((k) => k.startsWith('equity ')).map((k) => k.slice(7));
      const m2 = (v) => (Math.abs(v) < 0.005 ? '–' : v < 0 ? '(' + Math.abs(v).toFixed(2) + ')' : v.toFixed(2));
      const w = el('div', 'tw2'); w.setAttribute('data-source', 'project_entity');
      const t = el('table', 'mini eqs'); const hr = el('tr');
      ['', '', 'Total'].concat(ys.map((y) => y.replace('FY20', 'FY'))).forEach((h, i) => hr.appendChild(el('th', i > 1 ? 'n' : 'l', h)));
      const th = el('thead'); th.appendChild(hr); t.appendChild(th); const tb = el('tbody');
      ents.forEach((r) => {
        const vals = ys.map((y) => +r['equity ' + y] || 0);
        const inf = vals.map((v) => Math.max(v, 0)), rf = vals.map((v) => Math.min(v, 0));
        const eqT = d3.sum(inf), rfT = d3.sum(rf);
        const lines = [['Equity infusion', inf, ''], ['Revenue funding', rf, 'rf']];
        if (rfT < -0.005) {
          const share = rf.map((v) => (rfT ? v / rfT : 0));
          lines.push(['Equity returned', share.map((w) => -eqT * w), 'sub'], ['Net profit after tax', share.map((w) => (rfT + eqT) * w), 'sub']);
        }
        lines.forEach(([lab, arr, cls], i) => {
          const tr = el('tr', (i === 0 ? 'first ' : '') + cls);
          td(tr, i === 0 ? r.entity : '', 'l ent'); td(tr, lab, 'l');
          const tot = d3.sum(arr); const c = td(tr, m2(tot), 'tot'); if (tot < -0.005) c.classList.add('neg');
          arr.forEach((v) => { const x = td(tr, m2(v)); if (v < -0.005) x.classList.add('neg'); });
          tb.appendChild(tr);
        });
      });
      t.appendChild(tb); w.appendChild(t); ec.appendChild(w);
    }
    box.append(sc, rc, ec);

    // consolidated P&L (calculated)
    const prow = pl.status === 'ok' ? pl.data.filter((r) => r.project === project) : [];
    if (prow.length) {
      const pc = el('div', 'pdcard'); pc.appendChild(el('h4', null, 'Projected P&L (consolidated), USD'));
      const yrs = periodsOf(pl).filter((y) => /^FY/.test(y) && prow.some((r) => Math.abs(+r[y] || 0) > 0.5));
      const yr0 = periodsOf(pl).filter((y) => /^FY/.test(y));
      const first = yr0.indexOf(yrs[0]), last = yr0.indexOf(yrs[yrs.length - 1]);
      const show = yr0.slice(Math.max(0, first - 1), last + 1);
      const t = el('table', 'mini plmini'); t.setAttribute('data-source', 'consol_project_pl'); t.setAttribute('data-row-key', 'key');
      const hr = el('tr'); const h0 = el('th', 'l', ''); h0.setAttribute('data-field', 'line'); hr.appendChild(h0);
      const ht = el('th', 'n', 'Total'); ht.setAttribute('data-field', 'Total'); hr.appendChild(ht);
      show.forEach((y) => { const h = el('th', 'n', y); h.setAttribute('data-field', y); hr.appendChild(h); });
      const th = el('thead'); th.appendChild(hr); t.appendChild(th);
      const tb = el('tbody');
      prow.forEach((r) => {
        const tr = el('tr', { header: 'g', total: 't' }[r.kind] || ''); tr.dataset.key = r.key;
        td(tr, r.line, 'l');
        const c = td(tr, r.kind === 'header' ? '' : fmt(r.Total, r.line), 'tot'); if (+r.Total < -0.5) c.classList.add('neg');
        show.forEach((y) => { const x = td(tr, r.kind === 'header' ? '' : fmt(r[y], r.line)); if (+r[y] < -0.5) x.classList.add('neg'); });
        tb.appendChild(tr);
      });
      t.appendChild(tb); const w = el('div', 'tw2'); w.appendChild(t); pc.appendChild(w); box.appendChild(pc);
    }
    if (photoCard) box.appendChild(photoCard);
    return box;
  }
  function etable(rows, cols, fmtc, cls) {
    const w = el('div', 'tw2');
    const t = el('table', 'mini' + (cls ? ' ' + cls : '')); t.setAttribute('data-source', 'project_entity'); t.setAttribute('data-row-key', 'key');
    const hr = el('tr'); cols.forEach(([f, l], i) => { const h = el('th', i ? 'n' : 'l', l); h.setAttribute('data-field', f); hr.appendChild(h); });
    const th = el('thead'); th.appendChild(hr); t.appendChild(th); const tb = el('tbody');
    rows.forEach((r) => { const tr = el('tr'); tr.dataset.key = r.key; cols.forEach(([f], i) => td(tr, fmtc(r, f), i ? '' : 'l ent')); tb.appendChild(tr); });
    t.appendChild(tb); w.appendChild(t); return w;
  }

  // ---------- project details: editing ----------
  // Edits are saved as overrides on top of the model figures (store.js), field by field, so
  // a later model upload still refreshes every field nobody changed.
  const ST = () => window.SobhaStore || { canWrite: false, details: {}, photos: [], modelData: () => window.__DATA };
  const PF = [ // [field, label, type, group]
    ['report_name', 'Report name', 'text', 'Overview'], ['location', 'Location', 'text', 'Overview'], ['status', 'Status', 'status', 'Overview'], ['note', 'Note', 'note', 'Overview'],
    ['acreage', 'Land area (acres)', 'num', 'Development metrics'], ['nsa_sqft', 'Net saleable area / BUA (sqft)', 'num', 'Development metrics'],
    ['plotted_sqft', 'Proposed plotted area (sqft)', 'num', 'Development metrics'], ['units', 'Number of lots', 'num', 'Development metrics'],
    ['plotting_eff', 'Plotting efficiency (%)', 'pct', 'Development metrics'], ['avg_home_sqft', 'Average home size (sqft)', 'num', 'Development metrics'],
    ['gross_revenue_m', 'Gross revenue ($Mn)', 'num', 'Finance metrics'], ['npat_m', 'Net profit after tax ($Mn)', 'num', 'Finance metrics'],
    ['gross_profit_m', 'Gross profit ($Mn)', 'num', 'Finance metrics'], ['equity_required_m', 'Equity required ($Mn)', 'num', 'Finance metrics'],
    ['avg_home_price_m', 'Average home price ($Mn)', 'num', 'Finance metrics'], ['pretax_irr', 'Pre-tax IRR (%)', 'pct', 'Finance metrics'],
    ['land_cost_m', 'Land cost ($Mn)', 'num', 'Finance metrics'], ['infra_cost_m', 'Infrastructure cost ($Mn)', 'num', 'Finance metrics'],
    ['total_direct_cost_m', 'Total direct cost ($Mn)', 'num', 'Finance metrics'],
  ];
  const EF = [
    ['land_parcel_receipt', 'Land parcel receipt', 'month'], ['sales_commencement', 'Sales commencement', 'month'],
    ['development_completion', 'Development completion', 'month'], ['hand_over', 'Hand over', 'month'], ['equity_release', 'Equity release', 'month'],
    ['pretax_irr', 'Pre-tax IRR (%)', 'pct'], ['net_revenue_m', 'Net revenue ($Mn)', 'num'], ['gp_margin', 'GP margin (%)', 'pct'], ['net_margin', 'Net margin (%)', 'pct'],
  ];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // "Aug'25" <-> "2025-08" for <input type=month>.
  const monthIn = (s) => { const m = String(s || '').match(/^([A-Za-z]{3})'(\d{2})$/); const i = m ? MONTHS.indexOf(m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()) : -1; return i < 0 ? '' : '20' + m[2] + '-' + String(i + 1).padStart(2, '0'); };
  const monthOut = (v) => { const m = String(v || '').match(/^(\d{4})-(\d{2})$/); return m ? MONTHS[+m[2] - 1] + "'" + m[1].slice(2) : null; };
  const show = (v, type) => (v == null || v === '' ? '' : type === 'pct' ? String(+(v * 100).toFixed(2)) : type === 'month' ? monthIn(v) : String(v));
  const parse = (s, type) => {
    if (type === 'text' || type === 'note' || type === 'status') return s;
    if (type === 'month') return s === '' ? null : monthOut(s);
    s = String(s).replace(/[,\s$%]/g, ''); if (s === '') return null;
    const n = Number(s); if (!isFinite(n)) return NaN;
    return type === 'pct' ? Math.round(n * 1e4) / 1e6 : n;
  };
  const sameVal = (a, b) => (a == null || a === '' ? b == null || b === '' : typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : a === b);
  const hint = (v, type) => (v == null || v === '' ? 'blank' : type === 'pct' ? (v * 100).toFixed(1) + '%' : type === 'month' ? v : type === 'num' ? (Math.abs(v) >= 1000 ? f0(v) : String(+(+v).toFixed(4))) : String(v).slice(0, 60));

  function startEdit(project) {
    const d = ST().details[project] || {};
    const clone = (o) => JSON.parse(JSON.stringify(o || {}));
    S.editing = project;
    S.draft = { project, fields: clone(d.fields), entities: clone(d.entities), photoCaptions: clone(d.photoCaptions), hiddenPhotos: (d.hiddenPhotos || []).slice(), addPhotos: [], dropAdded: [], addedCaptions: {}, msg: '', bad: {} };
    render();
  }
  const endEdit = () => { S.editing = null; S.draft = null; render(); };

  function makeEditor(project) {
    const D = S.draft, model = ST().modelData();
    const mp = (model.project_profile || []).find((r) => r.project === project) || {};
    const ments = (model.project_entity || []).filter((r) => r.project === project);
    const box = el('div', 'pdx editing');
    const head = el('div', 'pdh');
    head.appendChild(el('h3', null, 'Edit details · ' + (mp.report_name || project)));
    box.appendChild(head);
    box.appendChild(el('p', 'note', 'Changed fields are highlighted. Each shows the value from the uploaded models underneath; clear a change with ↺ to go back to it.'));
    const field = (id, label, type, cur, mv, onVal, opts) => {
      const edited = !sameVal(cur, mv);
      const f = el('label', 'fld' + (edited ? ' ed' : '') + (D.bad[id] ? ' bad' : '') + (type === 'note' ? ' wide' : ''));
      const top = el('span', null, label);
      if (edited) { const r = el('button', 'link', '↺'); r.type = 'button'; r.title = 'Use the model value'; r.addEventListener('click', (e) => { e.preventDefault(); onVal(undefined); delete D.bad[id]; render(); }); top.appendChild(r); }
      f.appendChild(top);
      let inp;
      if (type === 'status') {
        inp = el('select');
        const opts2 = [...new Set(['Confirmed', 'Under consideration', 'Pipeline'].concat((model.project_profile || []).map((r) => r.status)).concat([cur]).filter(Boolean))];
        opts2.forEach((o) => inp.appendChild(new Option(o, o)));
        inp.value = cur || '';
      } else if (type === 'note') { inp = el('textarea'); inp.value = cur || ''; }
      else { inp = el('input'); inp.type = type === 'month' ? 'month' : 'text'; if (type === 'num' || type === 'pct') inp.inputMode = 'decimal'; inp.value = show(cur, type); }
      inp.id = 'pde-' + id.replace(/[^\w-]/g, '_');
      inp.addEventListener('change', () => {
        const v = parse(inp.value, type);
        if (Number.isNaN(v)) { D.bad[id] = true; f.classList.add('bad'); return; }
        delete D.bad[id]; f.classList.remove('bad');
        onVal(sameVal(v, mv) ? undefined : v);
        render();
      });
      f.appendChild(inp);
      f.appendChild(el('small', null, 'Model: ' + hint(mv, type)));
      return f;
    };
    const set = (obj, k) => (v) => { if (v === undefined) delete obj[k]; else obj[k] = v; };
    // profile fields, grouped
    [...new Set(PF.map((x) => x[3]))].forEach((g) => {
      const fs = el('fieldset', 'fset'); fs.appendChild(el('legend', null, g));
      const grid = el('div', 'fgrid' + (g === 'Overview' ? ' wide' : ''));
      PF.filter((x) => x[3] === g).forEach(([k, label, type]) => {
        const cur = k in D.fields ? D.fields[k] : mp[k];
        grid.appendChild(field('p-' + k, label, type, cur, mp[k], set(D.fields, k)));
      });
      fs.appendChild(grid); box.appendChild(fs);
    });
    // milestones and returns per entity
    if (ments.length) {
      const fs = el('fieldset', 'fset'); fs.appendChild(el('legend', null, 'Milestones and returns'));
      ments.forEach((me) => {
        const ov = (D.entities[me.entity] = D.entities[me.entity] || {});
        fs.appendChild(el('div', 'ent', me.entity));
        const grid = el('div', 'fgrid');
        EF.forEach(([k, label, type]) => {
          const cur = k in ov ? ov[k] : me[k];
          grid.appendChild(field('e-' + me.entity + '-' + k, label, type, cur, me[k], (v) => {
            set(ov, k)(v);
            // The timeline text reads "land parcel receipt – hand over".
            if (k === 'land_parcel_receipt' || k === 'hand_over') {
              const a = 'land_parcel_receipt' in ov ? ov.land_parcel_receipt : me.land_parcel_receipt, b = 'hand_over' in ov ? ov.hand_over : me.hand_over;
              const t = a && b ? a + ' – ' + b : a || b || '';
              if (sameVal(t, me.timeline)) delete ov.timeline; else ov.timeline = t;
            }
          }));
        });
        fs.appendChild(grid);
      });
      box.appendChild(fs);
    }
    // photos
    const fs = el('fieldset', 'fset'); fs.appendChild(el('legend', null, 'Photos'));
    const grid = el('div', 'phedit');
    const base = (model.project_photos || window.__BASELINE.project_photos || []).filter((r) => r.project === project);
    const photoTile = (src, caption, gone, onCap, onToggle, toggleLabel, id) => {
      const fig = el('figure', gone ? 'gone' : '');
      const img = el('img'); img.src = String(src).startsWith('data:image/') || String(src).startsWith('blob:') ? src : ''; img.alt = caption || 'Project photo'; fig.appendChild(img);
      const cap = el('input'); cap.type = 'text'; cap.value = caption || ''; cap.placeholder = 'Caption'; cap.id = 'pde-ph-' + id; cap.setAttribute('aria-label', 'Photo caption');
      cap.addEventListener('change', () => onCap(cap.value));
      const row = el('div', 'row'); row.appendChild(cap);
      const b = el('button', 'btn quiet', toggleLabel); b.type = 'button'; b.addEventListener('click', onToggle); row.appendChild(b);
      fig.appendChild(row); return fig;
    };
    base.forEach((r) => {
      const gone = D.hiddenPhotos.includes(r.key);
      grid.appendChild(photoTile(r.image, r.key in D.photoCaptions ? D.photoCaptions[r.key] : r.caption, gone,
        (v) => { if (v === r.caption) delete D.photoCaptions[r.key]; else D.photoCaptions[r.key] = v; },
        () => { if (gone) D.hiddenPhotos = D.hiddenPhotos.filter((k) => k !== r.key); else D.hiddenPhotos.push(r.key); render(); }, gone ? 'Restore' : 'Remove', 'b' + r.order));
    });
    ST().photos.filter((p) => p.project === project).forEach((p) => {
      const gone = D.dropAdded.includes(p.id);
      grid.appendChild(photoTile(p.image, p.id in D.addedCaptions ? D.addedCaptions[p.id] : p.caption, gone,
        (v) => { D.addedCaptions[p.id] = v; },
        () => { if (gone) D.dropAdded = D.dropAdded.filter((k) => k !== p.id); else D.dropAdded.push(p.id); render(); }, gone ? 'Restore' : 'Remove', 'a' + p.id));
    });
    D.addPhotos.forEach((p, i) => grid.appendChild(photoTile(p.image, p.caption, false, (v) => { p.caption = v; }, () => { D.addPhotos.splice(i, 1); render(); }, 'Remove', 'n' + i)));
    const add = el('label', 'phadd', 'Add photo (JPEG or PNG)');
    const fi = el('input'); fi.type = 'file'; fi.accept = 'image/*'; fi.multiple = true; fi.hidden = true; fi.id = 'pde-addphoto';
    fi.addEventListener('change', async () => {
      const files = [...fi.files]; fi.value = '';
      for (const f of files) {
        try { D.addPhotos.push({ caption: f.name.replace(/\.[^.]+$/, ''), kind: base.length || D.addPhotos.length ? 'model' : 'site', image: await shrinkImage(f) }); }
        catch (e) { D.msg = 'Could not read ' + f.name + ': ' + e.message; }
      }
      render();
    });
    add.appendChild(fi); grid.appendChild(add);
    fs.appendChild(grid); box.appendChild(fs);
    // actions
    const acts = el('div', 'edacts');
    acts.appendChild(el('span', 'msg', D.msg || (ST().mode === 'shared' ? 'Saved changes are shown to everyone with the link.' : 'Changes are saved in this browser.')));
    const btn = (label, cls, fn) => { const b = el('button', 'btn ' + cls, label); b.type = 'button'; b.addEventListener('click', fn); acts.appendChild(b); return b; };
    const has = Object.keys(ST().details[project] || {}).length;
    if (has) btn('Undo all edits', 'danger', async () => { D.fields = {}; D.entities = {}; D.photoCaptions = {}; D.hiddenPhotos = []; render(); });
    btn('Cancel', 'quiet', endEdit);
    const save = btn('Save details', 'primary', async () => {
      if (Object.keys(D.bad).length) { D.msg = 'Fix the highlighted fields first.'; render(); return; }
      save.disabled = true; D.msg = 'Saving…'; render();
      try {
        const st = ST();
        await st.saveDetails(project, { fields: D.fields, entities: D.entities, photoCaptions: D.photoCaptions, hiddenPhotos: D.hiddenPhotos });
        for (const p of D.addPhotos) await st.addPhoto(project, p);
        for (const id of D.dropAdded) await st.removePhoto(id);
        for (const [id, caption] of Object.entries(D.addedCaptions)) if (!D.dropAdded.includes(id)) await st.updatePhoto(id, { caption });
        endEdit();
      } catch (e) { D.msg = ST().message || 'Could not save.'; save.disabled = false; render(); }
    });
    box.appendChild(acts);
    return box;
  }

  // Photos are stored inside the dashboard's own data, so keep them small: at most 1600 px
  // wide and about 180 KB as JPEG.
  function shrinkImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        let w = img.naturalWidth, h = img.naturalHeight;
        const c = document.createElement('canvas'), g = c.getContext('2d');
        for (let max = 1600; max >= 400; max -= 300) {
          const k = Math.min(1, max / w); c.width = Math.round(w * k); c.height = Math.round(h * k);
          g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
          for (const q of [0.82, 0.7, 0.58]) { const d = c.toDataURL('image/jpeg', q); if (d.length < 185000) return resolve(d); }
        }
        reject(new Error('the image is too large even after shrinking'));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not an image this browser can read')); };
      img.src = url;
    });
  }

  // ---------- P&L ----------
  const CORP = 'Corporate level & differences', ELIM = 'Eliminations & consolidation adjustments';
  function renderPL(sec, key, st) {
    const ds = key + '_pl', d = dash.data(ds);
    const tb = sec.querySelector('.plt tbody');
    const plw = Math.max(260, sec.querySelector('.view-pl .tw').clientWidth - 2);
    const projl = sec.querySelector('.projl');
    projl.hidden = false;
    if (d.status !== 'ok') { tb.replaceChildren(); return; }
    const rows = d.data, P = periodsOf(d);
    setHead(sec.querySelector('.plt'), P);
    const order = [...new Set(rows.map((r) => r.project))];
    const rank = (p) => (p === CORP || p === ELIM ? 1e6 : order.indexOf(p));
    const kids = (k) => rows.filter((r) => r.parent === k).sort((a, b) => rank(a.project) - rank(b.project));
    const proj = st.proj;
    const tops = rows.filter((r) => r.level === 0);
    const find = (l) => {
      const t = tops.find((r) => norm(r.line) === norm(l));
      if (!t) return null;
      return proj === 'All Projects' ? t : rows.find((r) => r.parent === t.key && r.project === proj) || null;
    };
    sec.querySelectorAll('.view-pl .kpi').forEach((btn) => {
      const line = btn.dataset.line, r = find(line), b = btn.querySelector('b');
      b.classList.remove('dash-skeleton');
      if (r) { b.setAttribute('data-where', 'key=' + enc(r.key)); b.textContent = money(r.Total, line); } else b.textContent = '–';
      btn.onclick = () => {
        const t = tops.find((x) => norm(x.line) === norm(line));
        if (t && proj === 'All Projects') { st.pl.add(t.key); render(); const tr = sec.querySelector(`.plt tr[data-key="${CSS.escape(t.key)}"]`); if (tr) tr.scrollIntoView({ block: 'center' }); }
      };
    });
    tb.replaceChildren();
    const cells = (tr, r) => {
      const t = td(tr, r.kind === 'header' ? '' : fmt(r.Total, r.line), 'tot'); if (+r.Total < -0.5) t.classList.add('neg');
      P.forEach((p) => { const c = td(tr, r.kind === 'header' ? '' : fmt(r[p], r.line)); if (+r[p] < -0.5) c.classList.add('neg'); });
    };
    const zero = (r) => P.every((p) => Math.abs(+r[p] || 0) < 0.5);
    function add(r, depth) {
      const ch = kids(r.key);
      const cls = depth === 0 ? (({ header: 'g', total: 't' }[r.kind] || '') + ' l0') : (depth === 1 ? 'p' : 'p2');
      const tr = el('tr', cls + (depth && zero(r) ? ' zero' : '') + (r.project === CORP || r.project === ELIM ? ' corp' : ''));
      tr.dataset.key = r.key;
      const label = depth === 0 ? r.line.replace(/:$/, '') : r.project;
      const fc = firstCell(tr, label, ch.length > 0 && r.kind !== 'header');
      if (depth > 0) detailsBtn(fc, r.project, r.key, st);
      cells(tr, r);
      const open = st.pl.has(r.key);
      if (ch.length && r.kind !== 'header') clickable(tr, () => toggle(st.pl, r.key), open);
      tb.appendChild(tr);
      if (depth > 0 && st.detail === r.key) detailsRow(tb, r.project, plw, P.length + 2);
      if (open) ch.forEach((c) => add(c, depth + 1));
    }
    if (proj === 'All Projects') tops.forEach((r) => add(r, 0));
    else tops.forEach((t) => {
      if (t.kind === 'header') { add(t, 0); return; }
      const r = rows.find((x) => x.parent === t.key && x.project === proj);
      if (!r) return;
      const tr = el('tr', ({ total: 't' }[t.kind] || '') + ' l0'); tr.dataset.key = r.key;
      firstCell(tr, t.line, false); cells(tr, r); tb.appendChild(tr);
    });
  }

  function renderIRR(sec, key, st) {
    const ir = dash.data('project_irr'); const tb = sec.querySelector('.irrt tbody'); tb.replaceChildren();
    if (ir.status !== 'ok') return;
    const rows = ir.data.filter((r) => r.entity === key);
    const all = rows.find((r) => r.project === 'All Projects');
    const list = rows.filter((r) => r.project !== 'All Projects');
    const f$ = (v) => (v == null ? '–' : Math.abs(v) < 0.5 ? '–' : (v < 0 ? '(' + f0(-v) + ')' : f0(v)));
    const add = (r, total) => {
      const tr = el('tr', total ? 't' : 'p' + (st.proj === r.project ? ' open' : '')); tr.dataset.key = r.key;
      const fc = firstCell(tr, total ? 'All projects (total)' : r.project, false);
      if (!total) detailsBtn(fc, r.project, 'irr|' + r.key, st);
      td(tr, r.pretax_equity_irr == null ? 'n/a' : (r.pretax_equity_irr * 100).toFixed(2) + '%', 'tot');
      td(tr, f$(r.equity_infused)); td(tr, f$(r.equity_released)); const n = td(tr, f$(r.net_return)); if (r.net_return < 0) n.classList.add('neg');
      td(tr, !r.multiple ? '–' : r.multiple.toFixed(2) + 'x');
      tb.appendChild(tr);
      if (!total && st.detail === 'irr|' + r.key) detailsRow(tb, r.project, Math.max(260, sec.querySelector('.view-irr .tw').clientWidth - 2), 6);
    };
    list.forEach((r) => add(r, false));
    if (all) add(all, true);
  }


  // ---------- Actuals ----------
  const AST = { vals: {}, mode: 'init', db: null, timers: {}, msg: '' };
  const docId = (stmt, p) => (stmt + '~' + p).replace(/[^A-Za-z0-9_\-.~:@+]/g, '_');
  const aget = (stmt, p, line, per) => { const v = ((AST.vals[stmt] || {})[p] || {})[line + '|' + per]; return typeof v === 'number' ? v : null; };
  function aput(stmt, p, line, per, v) {
    AST.vals[stmt] = AST.vals[stmt] || {}; AST.vals[stmt][p] = AST.vals[stmt][p] || {};
    const k = line + '|' + per;
    if (v == null) delete AST.vals[stmt][p][k]; else AST.vals[stmt][p][k] = v;
    schedule(stmt, p);
  }
  function schedule(stmt, p) {
    const id = docId(stmt, p);
    clearTimeout(AST.timers[id]);
    AST.timers[id] = setTimeout(() => saveDoc(stmt, p), 500);
  }
  async function saveDoc(stmt, p) {
    const values = Object.assign({}, (AST.vals[stmt] || {})[p] || {});
    if (AST.mode === 'db') {
      try { await AST.db.collection('actuals').doc(docId(stmt, p)).set({ stmt, project: p, values, updated_at: new Date().toISOString() }); AST.msg = 'Saved'; }
      catch (e) { AST.mode = 'ro'; AST.msg = (e && e.code === 'invalid_argument') ? 'View only: you can see actuals but not change them.' : 'Could not save: ' + ((e && e.message) || 'unavailable'); }
    } else if (AST.mode === 'local') {
      try { localStorage.setItem('sobha_actuals', JSON.stringify(AST.vals)); AST.msg = 'Saved in this browser'; } catch (e) { AST.msg = 'Not saved (storage blocked)'; }
    }
    render();
  }
  (async function initActuals() {
    try {
      const c = window.claude;
      const db = c && c.use ? await c.use('db') : null;
      if (db) {
        AST.db = db; AST.mode = 'db';
        db.collection('actuals').onSnapshot((snap) => {
          const v = {};
          snap.docs.forEach((d) => { const x = d.data(); if (x && x.stmt && x.project) { v[x.stmt] = v[x.stmt] || {}; v[x.stmt][x.project] = Object.assign({}, x.values || {}); } });
          // keep local unsaved edits for docs with pending timers
          Object.keys(AST.timers).forEach((id) => { /* pending saves will overwrite on write */ });
          AST.vals = v; render();
        }, () => { AST.mode = 'ro'; AST.msg = 'Actuals could not be loaded.'; render(); });
        return;
      }
    } catch (e) { /* fall through */ }
    try { const s = localStorage.getItem('sobha_actuals'); AST.vals = s ? JSON.parse(s) : {}; AST.mode = 'local'; } catch (e) { AST.mode = 'memory'; }
    render();
  })();

  // A statement's plan periods: the period columns that hold figures for it.
  const actPeriods = (rows) => (rows.length ? Object.keys(rows[0]).filter((c) => !NONPER.has(c) && rows.some((r) => r[c] != null)) : []);
  function evalActuals(stmt, rows, P) {
    const byProj = {};
    rows.forEach((r) => { (byProj[r.project] = byProj[r.project] || []).push(r); });
    Object.values(byProj).forEach((a) => a.sort((x, y) => x.ord - y.ord));
    const memo = new Map();
    const lab = (p, l) => (byProj[p] || []).find((r) => r.role !== 'header' && norm(r.line) === l);
    const add = (a, b) => (a == null && b == null ? null : (a || 0) + (b || 0));
    function A(r, pi) {
      const mk = r.key + '#' + pi; if (memo.has(mk)) return memo.get(mk);
      memo.set(mk, null);
      const per = P[pi], p = r.project, rr = byProj[p]; let v = null;
      const isAll = p === 'All Projects';
      const sumProj = () => { let s = null; Object.keys(byProj).forEach((q) => { if (q === 'All Projects') return; const x = lab(q, norm(r.line)); if (x) s = add(s, A(x, pi)); }); return s; };
      switch (r.role) {
        case 'input': v = aget(stmt, p, r.line, per); break;
        case 'sumifs': v = sumProj(); break;
        case 'expr': JSON.parse(r.rule).forEach(([s, l]) => { const x = lab(p, l); if (x) { const y = A(x, pi); if (y != null) v = (v || 0) + s * y; } }); break;
        case 'sec': { const i0 = rr.findIndex((x) => norm(x.line) === r.rule); const i1 = rr.indexOf(r);
          for (let i = i0 + 1; i < i1; i++) if (rr[i].role !== 'header') v = add(v, A(rr[i], pi)); break; }
        case 'close': case 'eclose': {
          if (r.role === 'close') { const o = lab(p, 'opening balance'), ti = lab(p, 'total inflows'), to = lab(p, 'total outflows');
            const a = A(o, pi), b = A(ti, pi), c = A(to, pi); v = a == null && b == null && c == null ? null : (a || 0) + (b || 0) - (c || 0); }
          else { ['opening escrow balance', 'collected in escrow', 'less: released from escrow'].forEach((l) => { const x = lab(p, l); if (x) v = add(v, A(x, pi)); }); }
          break; }
        case 'open': case 'eopen':
          if (pi === 0) v = isAll ? sumProj() : aget(stmt, p, r.line, per);
          else v = A(lab(p, r.role === 'open' ? 'closing balance' : 'closing escrow balance'), pi - 1);
          break;
      }
      memo.set(mk, v); return v;
    }
    return A;
  }
  const isEditable = (r, pi) => r.role === 'input' || ((r.role === 'open' || r.role === 'eopen') && pi === 0 && r.project !== 'All Projects');
  function parseNum(s) {
    s = String(s || '').trim(); if (!s) return null;
    const neg = /^\(.*\)$/.test(s) || s.startsWith('-');
    const n = Number(s.replace(/[(),\s$]/g, '').replace(/^-/, ''));
    return isFinite(n) ? (neg ? -n : n) : NaN;
  }
  function renderActuals(sec, key, st) {
    st.act = st.act || 'cf';
    sec.querySelectorAll('.actseg button').forEach((b) => { b.classList.toggle('on', b.dataset.a === st.act); b.onclick = () => { st.act = b.dataset.a; render(); }; });
    const stmt = key + '_' + st.act, d = dash.data('actuals_plan');
    const msg = sec.querySelector('.actmsg');
    const modeTxt = { db: 'Actuals are saved for everyone with access.', local: 'Actuals are saved in this browser.', memory: 'Actuals are kept for this session only.', ro: '', init: 'Loading actuals…' }[AST.mode];
    msg.textContent = AST.msg ? AST.msg : modeTxt;
    const upl = sec.querySelector('.upl'); upl.hidden = AST.mode === 'ro';
    const fi = sec.querySelector('.actfile');
    fi.onchange = async () => { const f = fi.files[0]; fi.value = ''; if (f) { AST.msg = 'Reading ' + f.name + '…'; render(); try { const n = await importXlsx(f); AST.msg = 'Read ' + n.read + ' actual values from ' + f.name + (n.changed ? ': ' + n.changed + ' changed.' : ': no changes.'); } catch (e) { AST.msg = 'Could not read ' + f.name + ': ' + e.message; } render(); } };
    const dl = sec.querySelector('.actdl');
    dl.hidden = d.status !== 'ok' || !window.XLSXWrite || !(window.SobhaStore && SobhaStore.canDownload());
    dl.onclick = () => downloadActuals(dl);
    const thr = sec.querySelector('.actt thead tr'), tb = sec.querySelector('.actt tbody');
    if (d.status !== 'ok') { tb.replaceChildren(); return; }
    const rows = d.data.filter((r) => r.stmt === stmt);
    const P = actPeriods(rows);
    const A = evalActuals(stmt, rows, P);
    // header
    thr.replaceChildren();
    const th = (t, f, c) => { const h = el('th', c || 'n', t); if (f) h.setAttribute('data-field', f); thr.appendChild(h); };
    th('Particular', 'line', 'l'); th('Total BP', 'Total'); th('Total actual', null, 'n act');
    P.forEach((y) => { th(y.replace('FY20', 'FY') + ' BP', y); th(y.replace('FY20', 'FY') + ' actual', null, 'n act'); });
    const proj = st.proj;
    const show = rows.filter((r) => r.project === proj).sort((a, b) => a.ord - b.ord);
    const focusK = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.k : null;
    tb.replaceChildren();
    const ro = AST.mode === 'ro' || AST.mode === 'init';
    show.forEach((r) => {
      const tr = el('tr', ({ header: 'g', total: 't', balance: 'b' }[r.kind] || '')); tr.dataset.key = r.key;
      firstCell(tr, r.kind === 'header' ? r.line.replace(/:$/, '') : r.line, false);
      if (r.kind === 'header') { for (let i = 0; i < 2 + P.length * 2; i++) td(tr, ''); tb.appendChild(tr); return; }
      const fm = (v) => (v == null ? '' : fmt(v, r.line));
      const noT = r.kind === 'balance';
      td(tr, noT ? '' : fm(r.Total), 'tot');
      let tA = null; if (!noT) P.forEach((y, pi) => { const v = A(r, pi); if (v != null) tA = (tA || 0) + v; });
      td(tr, noT ? '' : fm(tA), 'tot act');
      P.forEach((y, pi) => {
        td(tr, fm(r[y]));
        const c = el('td', 'act');
        if (isEditable(r, pi) && !ro) {
          const inp = el('input', 'ai'); inp.type = 'text'; inp.inputMode = 'decimal';
          const v = aget(stmt, r.project, r.line, y); inp.value = v == null ? '' : fmt(v, r.line).replace(/^–$/, '0');
          inp.dataset.k = r.key + '#' + y; inp.setAttribute('aria-label', r.line + ' ' + y + ' actual');
          inp.addEventListener('change', () => { const n = parseNum(inp.value); if (Number.isNaN(n)) { inp.classList.add('bad'); return; } aput(stmt, r.project, r.line, y, n); render(); });
          c.appendChild(inp);
        } else { const v = A(r, pi); c.textContent = fm(v); }
        tr.appendChild(c);
      });
      tb.appendChild(tr);
    });
    if (focusK) { const f = tb.querySelector(`input[data-k="${CSS.escape(focusK)}"]`); if (f) f.focus(); }
  }

  // ---------- Excel: download (BP vs Actuals) and upload ----------
  // The workbook has two sheets with the same rows. 'Actuals': every plan line of the six
  // statements; the yellow cells take actuals and every other figure is a formula that adds up
  // as the tab does (evalActuals). 'BP vs Actuals': the plan figures beside links to them.
  const ACT_STMTS = ['consol_cf', 'landowner_cf', 'homebuilder_cf', 'consol_pl', 'landowner_pl', 'homebuilder_pl'];
  // The earlier upload layout: one sheet per statement, periods in row 4, 'BP' / 'Actual' in row 5.
  const SHEETS = { 'Consol CF': 'consol_cf', 'Landowner CF': 'landowner_cf', 'Homebuilder CF': 'homebuilder_cf', 'Consol P&L': 'consol_pl', 'Landowner P&L': 'landowner_pl', 'Homebuilder P&L': 'homebuilder_pl' };
  const stmtLabel = (s) => { const [e, k] = s.split('_'); return e[0].toUpperCase() + e.slice(1) + ' · ' + (k === 'pl' ? 'P&L' : 'Cash flow'); };
  const loose = (s) => norm(s).replace(/[^a-z&]/g, ''); // 'Consol · P&L', 'Consol P&L' -> 'consolp&l'
  const STMT_IDS = {};
  ACT_STMTS.forEach((id) => [id, stmtLabel(id)].forEach((n) => (STMT_IDS[loose(n)] = id)));
  Object.entries(SHEETS).forEach(([n, id]) => (STMT_IDS[loose(n)] = id));
  const perYear = (p) => { const m = String(p).match(/(\d{4})\s*$/) || String(p).match(/'(\d{2})\s*$/); return m ? +(m[1].length === 2 ? '20' + m[1] : m[1]) : 9999; };
  const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

  // What a computed cell adds up, as evalActuals does: {terms: [[sign, row, period index]]},
  // plus range (a section's rows, summed as one range) or carry (last year's closing balance).
  function actTerms(rows) {
    const byProj = {};
    rows.forEach((r) => { (byProj[r.project] = byProj[r.project] || []).push(r); });
    Object.values(byProj).forEach((a) => a.sort((x, y) => x.ord - y.ord));
    const lab = (p, l) => (byProj[p] || []).find((r) => r.role !== 'header' && norm(r.line) === l);
    const sumProj = (r, pi) => Object.keys(byProj).filter((q) => q !== 'All Projects').map((q) => lab(q, norm(r.line))).filter(Boolean).map((x) => [1, x, pi]);
    const of = (p, pi, list) => list.map(([s, l]) => [s, lab(p, l), pi]).filter((t) => t[1]);
    return (r, pi) => {
      const p = r.project, rr = byProj[p];
      switch (r.role) {
        case 'sumifs': return { terms: sumProj(r, pi) };
        case 'expr': return { terms: of(p, pi, JSON.parse(r.rule)) };
        case 'sec': { const span = rr.slice(rr.findIndex((x) => norm(x.line) === r.rule) + 1, rr.indexOf(r));
          return { terms: span.filter((x) => x.role !== 'header').map((x) => [1, x, pi]), range: span }; }
        case 'close': return { terms: of(p, pi, [[1, 'opening balance'], [1, 'total inflows'], [-1, 'total outflows']]) };
        case 'eclose': return { terms: of(p, pi, [[1, 'opening escrow balance'], [1, 'collected in escrow'], [1, 'less: released from escrow']]) };
        case 'open': case 'eopen':
          if (pi === 0) return p === 'All Projects' ? { terms: sumProj(r, 0) } : null;
          return { terms: of(p, pi - 1, [[1, r.role === 'open' ? 'closing balance' : 'closing escrow balance']]), carry: true };
      }
      return null;
    };
  }
  // Excel formula for terms: blank when every term is blank (evalActuals' null), else the signed
  // sum. SUM and COUNT skip blanks and "" where + and - would fail.
  function actFormula(t, ref) {
    if (!t || !t.terms.length) return null;
    const R = (x) => ref(x[1], x[2]);
    if (t.carry) { const a = R(t.terms[0]); return 'IF(' + a + '="","",' + a + ')'; }
    if (t.range) { const pi = t.terms[0][2], a = ref(t.range[0], pi) + ':' + ref(t.range[t.range.length - 1], pi); return 'IF(COUNT(' + a + ')=0,"",SUM(' + a + '))'; }
    const by = (f) => t.terms.filter(f).map(R).join(',');
    const pos = by((x) => x[0] === 1), neg = by((x) => x[0] === -1);
    let e = (pos ? 'SUM(' + pos + ')' : '') + (neg ? '-SUM(' + neg + ')' : '');
    t.terms.filter((x) => Math.abs(x[0]) !== 1).forEach((x) => (e += (x[0] < 0 ? '-' : '+') + Math.abs(x[0]) + '*SUM(' + R(x) + ')'));
    return 'IF(COUNT(' + t.terms.map(R).join(',') + ')=0,"",' + e.replace(/^\+/, '') + ')';
  }

  // plan: the actuals_plan rows; actuals as they are on the tab now. -> .xlsx bytes
  function actualsWorkbook(plan, when) {
    const NUM = '#,##0;(#,##0);"–"', UNITS = '#,##0.00;(#,##0.00);"–"', H = 2; // H: header row
    const X = { title: { b: 1, sz: 12, color: '1A2B6B' }, head: { b: 1, wrap: 1, va: 'top', fill: 'DDE3F3' }, headA: { b: 1, wrap: 1, va: 'top', fill: 'E4DDF8' }, bold: { b: 1 } };
    const sts = ACT_STMTS.map((id) => { const rows = plan.filter((r) => r.stmt === id); return { id, rows, P: actPeriods(rows) }; }).filter((s) => s.rows.length);
    const U = [...new Set(sts.flatMap((s) => s.P))].map((p, i) => [p, i]).sort((a, b) => perYear(a[0]) - perYear(b[0]) || a[1] - b[1]).map((x) => x[0]);
    const C = XLSXWrite.colName, col = (y) => C(4 + U.indexOf(y)), totC = C(4 + U.length);
    // Sheet rows: statements in order, then projects as listed, lines by ord.
    const at = new Map(); let n = H;
    sts.forEach((s) => { const by = new Map(); s.rows.forEach((r) => { if (!by.has(r.project)) by.set(r.project, []); by.get(r.project).push(r); });
      s.order = [...by.values()].flatMap((a) => a.sort((x, y) => x.ord - y.ord)); s.order.forEach((r) => at.set(r.key, ++n)); });
    const m = window.SobhaStore && SobhaStore.plan && SobhaStore.plan.meta, d = ymd(when);
    const src = m ? 'uploaded models' + ((m.files || []).length ? ' (' + m.files.map((f) => f.name).join(', ') + ')' : '') + (m.at ? ', uploaded ' + String(m.at).slice(0, 10) : '') : 'the models built into the dashboard';
    const A = [], B = [];
    A[0] = [{ v: 'Actuals as on the dashboard on ' + d + '. Type actuals in the yellow cells (blank = none yet); every other figure is a formula. Dashboard › Actuals › Upload Excel reads this file back.', s: X.title }];
    B[0] = [{ v: 'Sobha USA · BP vs Actuals · ' + d + ' · BP from ' + src + ' · Actuals from the Actuals sheet (as on the dashboard on ' + d + '; type them there)', s: X.title }];
    A[H - 1] = ['Statement', 'Project', 'Particular', ...U, 'Total'].map((v) => ({ v, s: X.head }));
    B[H - 1] = ['Statement', 'Project', 'Particular', 'Total BP', 'Total actual'].map((v, i) => ({ v, s: i === 4 ? X.headA : X.head }))
      .concat(U.flatMap((y) => [{ v: y + ' BP', s: X.head }, { v: y + ' Actual', s: X.headA }]));
    const link = (c, v, s) => ({ f: 'IF(Actuals!' + c + '="","",Actuals!' + c + ')', v: v == null ? '' : v, s });
    sts.forEach((s) => {
      const V = evalActuals(s.id, s.rows, s.P), T = actTerms(s.rows), label = stmtLabel(s.id);
      const ref = (x, pi) => col(s.P[pi]) + at.get(x.key);
      // A cell that would refer back to itself keeps its figure instead of a formula.
      const loop = new Set(), seen = new Map();
      const visit = (r, pi) => {
        const k = r.key + '#' + pi, z = seen.get(k); if (z) return z === 1;
        seen.set(k, 1);
        const t = isEditable(r, pi) ? null : T(r, pi);
        if (t) t.terms.forEach(([, x, q]) => { if (visit(x, q)) loop.add(k); });
        seen.set(k, 2); return false;
      };
      const first = new Map(); // a line typed in twice shares one figure (aget reads by line)
      s.order.forEach((r) => {
        const i = at.get(r.key), hdr = r.kind === 'header' || r.role === 'header', tot = r.kind === 'total';
        const fmt = isUnits(r.line) ? UNITS : NUM, nm = tot ? { fmt, b: 1 } : { fmt }, act = Object.assign({ fill: 'F3F0FC' }, nm);
        const name = { v: hdr ? r.line.replace(/:$/, '') : r.line, s: hdr || tot ? X.bold : null };
        const a = A[i - 1] = [label, r.project, name], b = B[i - 1] = [label, r.project, name];
        if (hdr) return;
        let tA = null;
        s.P.forEach((y, pi) => {
          const u = U.indexOf(y), v = V(r, pi), k = r.key + '#' + pi;
          if (v != null) tA = (tA || 0) + v;
          if (isEditable(r, pi)) {
            const fk = r.project + '\u0000' + r.line + '|' + y, f0 = first.get(fk);
            if (f0) a[3 + u] = { f: 'IF(' + f0 + '="","",' + f0 + ')', v: v == null ? '' : v, s: nm };
            else { first.set(fk, col(y) + i); a[3 + u] = { v, s: Object.assign({ fill: 'FFF2CC' }, nm) }; }
          } else {
            visit(r, pi);
            const f = loop.has(k) ? null : actFormula(T(r, pi), ref);
            a[3 + u] = f ? { f, v: v == null ? '' : v, s: nm } : { v, s: nm };
          }
          b[5 + 2 * u] = { v: r[y], s: nm };
          b[6 + 2 * u] = link(col(y) + i, v, act);
        });
        if (r.kind === 'balance') return;
        const rg = 'D' + i + ':' + C(3 + U.length) + i;
        a[3 + U.length] = { f: 'IF(COUNT(' + rg + ')=0,"",SUM(' + rg + '))', v: tA == null ? '' : tA, s: nm };
        b[3] = { v: r.Total, s: nm }; b[4] = link(totC + i, tA, act);
      });
    });
    const last = (cols) => C(cols) + Math.max(n, H);
    return XLSXWrite.build({ active: 0, sheets: [
      { name: 'BP vs Actuals', rows: B, cols: [20, 30, 44, 15, 15, ...U.flatMap(() => [14, 14])], freeze: { rows: H, cols: 3 }, filter: 'A' + H + ':' + last(5 + 2 * U.length) },
      { name: 'Actuals', rows: A, cols: [20, 30, 44, ...U.map(() => 14), 15], freeze: { rows: H, cols: 3 }, filter: 'A' + H + ':' + last(4 + U.length) },
    ] });
  }
  async function downloadActuals(btn) {
    const d = dash.data('actuals_plan'); if (d.status !== 'ok') return;
    const now = new Date(), name = 'Sobha USA - BP vs Actuals - ' + ymd(now) + '.xlsx';
    btn.disabled = true;
    try { const bytes = await actualsWorkbook(d.data, now); await SobhaStore.saveFile(name, new Blob([bytes], { type: XLSXWrite.MIME })); AST.msg = 'Downloaded ' + name + '.'; }
    catch (e) { if (!e || e.code !== 'declined') AST.msg = 'Could not create the Excel file' + (e && e.message ? ': ' + e.message : '') + '.'; }
    btn.disabled = false; render();
  }

  // The downloaded layout: an 'Actuals' sheet whose header row names Statement, Project and
  // Particular, then the periods. Only figures typed into cells the tab takes are read.
  function readActuals(s, plan, put) {
    const key = (v) => norm(v).replace(/[‘’]/g, "'");
    let hr = 0, hc = {};
    for (const r of s.rowNums()) {
      const c = {}; Object.entries(s.row(r)).forEach(([k, v]) => { if (typeof v === 'string' && !(key(v) in c)) c[key(v)] = +k; });
      if (c.statement && c.project && c.particular) { hr = r; hc = c; break; }
    }
    if (!hr) return false;
    const info = {};
    ACT_STMTS.forEach((id) => {
      const rows = plan.filter((r) => r.stmt === id), at = new Map(); // project + line -> first row (as lab())
      rows.slice().sort((a, b) => a.ord - b.ord).forEach((r) => { const k = norm(r.project) + '\u0000' + norm(r.line); if (r.role !== 'header' && !at.has(k)) at.set(k, r); });
      info[id] = { P: actPeriods(rows), at };
    });
    s.rowNums().filter((r) => r > hr).forEach((r) => {
      const I = info[STMT_IDS[loose(s.get(r, hc.statement))]]; if (!I) return;
      const x = I.at.get(norm(s.get(r, hc.project)) + '\u0000' + norm(s.get(r, hc.particular))); if (!x) return;
      I.P.forEach((y, pi) => {
        const c = hc[key(y)], v = c ? s.get(r, c) : null;
        if (c && isEditable(x, pi) && s.formula(r, c) == null && typeof v === 'number' && isFinite(v)) put(x.stmt, x.project, x.line, y, v);
      });
    });
    return true;
  }
  // Typed figures replace the tab's; blank cells keep what it has. -> {read, changed}
  async function importXlsx(file) {
    const wb = await XLSXLite.open(await file.arrayBuffer());
    const d = dash.data('actuals_plan'), plan = d.status === 'ok' ? d.data : [];
    let read = 0, changed = 0, known = false; const touched = new Set();
    const put = (stmt, p, line, per, v) => {
      read++; if (aget(stmt, p, line, per) === v) return;
      AST.vals[stmt] = AST.vals[stmt] || {}; AST.vals[stmt][p] = AST.vals[stmt][p] || {};
      AST.vals[stmt][p][line + '|' + per] = v; touched.add(stmt + '\u0000' + p); changed++;
    };
    const sh = wb.has('Actuals') ? await wb.sheet('Actuals') : null;
    if (sh) known = readActuals(sh, plan, put);
    for (const name of wb.sheetNames) {
      const stmt = SHEETS[name], s = stmt ? await wb.sheet(name) : null; if (!s) continue;
      known = true;
      const h4 = s.row(4), h5 = s.row(5), per = {}; let cur = null;
      const maxc = Math.max(0, ...Object.keys(h5).map(Number));
      for (let c = 3; c <= maxc; c++) { if (h4[c]) cur = String(h4[c]); if (h5[c] === 'Actual' && cur && cur !== 'Total') per[c] = cur.replace('–', '-'); }
      s.rowNums().filter((r) => r > 5).forEach((r) => {
        const p = s.get(r, 1), line = s.get(r, 2); if (!p || !line || p === line) return;
        Object.keys(per).forEach((c) => { const v = s.get(r, +c); if (s.formula(r, +c) == null && typeof v === 'number' && isFinite(v)) put(stmt, p, String(line), per[c], v); });
      });
    }
    if (!known) throw new Error('it has no Actuals sheet (use the workbook from Download Excel)');
    // Save each changed project with the values read now: a db snapshot may land between saves.
    const docs = [...touched].map((k) => { const [s, p] = k.split('\u0000'); return [s, p, AST.vals[s][p]]; });
    for (const [s, p, v] of docs) { (AST.vals[s] = AST.vals[s] || {})[p] = v; await saveDoc(s, p); }
    return { read, changed };
  }

  // Removing a focused input fires blur/change, which can ask for another render mid-render:
  // run that one afterwards instead of nesting it.
  function render() {
    if (rendering) { again = true; return; }
    rendering = true;
    const fid = document.activeElement && document.activeElement.id;
    try { renderAll(); } finally { rendering = false; }
    if (fid) { const f = document.getElementById(fid); if (f && f !== document.activeElement) f.focus(); }
    if (again) { again = false; render(); }
  }
  function renderAll() {
    root.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.t === S.tab)));
    root.querySelectorAll('section.tab').forEach((s) => (s.hidden = s.id !== S.tab));
    const sec = document.getElementById(S.tab), E = ENT[S.tab], st = S.ent[S.tab];
    const pl = st.stmt === 'pl', act = st.stmt === 'act', ga = st.stmt === 'ga', ex = st.stmt === 'exp';
    sec.querySelector('.view-cf').hidden = pl || act || ga || ex; sec.querySelector('.view-pl').hidden = !pl; sec.querySelector('.view-act').hidden = !act; sec.querySelector('.view-ga').hidden = !ga; sec.querySelector('.view-exp').hidden = !ex;
    sec.querySelector('.hint-cf').hidden = pl || act || ga || ex; sec.querySelector('.hint-pl').hidden = !pl;
    sec.querySelectorAll('.stmtseg button').forEach((b) => {
      b.classList.toggle('on', b.dataset.s === st.stmt);
      b.onclick = () => { st.stmt = b.dataset.s; render(); };
    });
    const col = sec.querySelector('.collapse');
    sec.querySelectorAll('.tw').forEach((x) => x.classList.toggle('free', !!st.detail));
    const d = dash.data(E.ds);
    PD_SETS.forEach((id) => dash.data(id));
    if (E.comp) { dash.data(E.comp); dash.data('landowner_cf'); dash.data('homebuilder_cf'); }
    const sel = sec.querySelector('.proj');
    if (d.status === 'ok') {
      const projects = [...new Set(d.data.map((r) => r.project))];
      if (sel.dataset.sig !== projects.join('\n')) {
        sel.dataset.sig = projects.join('\n');
        sel.replaceChildren(...projects.map((p) => new Option(projLabel(p), p)));
        sel.onchange = () => { st.proj = sel.value; st.projs.clear(); st.zero.clear(); st.comps.clear(); render(); };
      }
      if (!projects.includes(st.proj)) st.proj = 'All Projects';
      sel.value = st.proj;
    }
    const pdb = sec.querySelector('.pdtop'), pdt = sec.querySelector('.pd-top');
    const canTop = st.proj !== 'All Projects' && hasDetails(st.proj);
    pdb.hidden = !canTop;
    pdb.textContent = st.detailTop ? 'Hide project details' : 'Project details';
    pdb.classList.toggle('on', !!st.detailTop);
    pdb.onclick = () => { st.detailTop = !st.detailTop; render(); };
    pdt.replaceChildren();
    pdt.hidden = !(canTop && st.detailTop);
    if (canTop && st.detailTop) pdt.appendChild(makeDetails(st.proj));
    if (ga || ex) {
      sec.querySelector('.projl').hidden = true; pdb.hidden = true; pdt.hidden = true; col.hidden = true;
      const ent = { consol: 'consol', landowner: 'lo', homebuilder: 'hb' }[S.tab], V = ga ? window.SobhaGA : window.SobhaExposure;
      if (V) V.render(sec.querySelector(ga ? '.view-ga' : '.view-exp'), ent, col);
      return;
    }
    if (act) { sec.querySelector('.projl').hidden = false; renderActuals(sec, S.tab, st); col.hidden = true; return; }
    if (pl) {
      renderPL(sec, S.tab, st);
      col.hidden = !st.pl.size;
      col.onclick = () => { st.pl.clear(); render(); };
      return;
    }
    sec.querySelector('.projl').hidden = false;
    if (d.status !== 'ok') { sec.querySelector('.stmt tbody').replaceChildren(); return; }
    const rows = d.data, P = periodsOf(d);
    renderTable(sec, E, st, rows, P);
    renderSummary(sec, E, st, rows, P);
  }

  root.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => { S.tab = b.dataset.t; dash.setLink(S.tab); render(); }));
  const h = location.hash.slice(1);
  if (ENT[h]) S.tab = h;
  dash.onData(render);
})();
