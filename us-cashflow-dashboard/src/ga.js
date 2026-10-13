// G&A tab: the overhead budget 2026–2030 from the G&A workbook (datasets ga_lines and
// ga_components, built by derive-ga.js). Consol / Landowner (Sobha Developers, H) /
// Homebuilder (Sobha Homes, V); every head opens to its split and its components.
(function () {
  'use strict';
  const G = { ent: 'consol', meas: 'oh', open: new Set(), unbudgeted: false };
  const ENTS = [['consol', 'Consol'], ['lo', 'Landowner (H)'], ['hb', 'Homebuilder (V)']];
  const MEAS = [['oh', 'Overhead'], ['cost', 'Full cost'], ['proj', 'Project share']];
  const ENT_NAME = { consol: 'Sobha LLC USA', lo: 'Sobha Developers (Landowner, H)', hb: 'Sobha Homes (Homebuilder, V)' };
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const fm = (v) => (!isNum(v) ? '' : Math.abs(v) < 0.5 ? '–' : (v < 0 ? '(' : '') + Math.round(Math.abs(v)).toLocaleString('en-US') + (v < 0 ? ')' : ''));
  const mn = (v) => (!isNum(v) ? '—' : '$' + (v / 1e6).toFixed(2) + 'M');
  const pc = (v) => (!isNum(v) ? '' : Math.round(v * 100) + '%');
  const sum = (a) => a.reduce((s, v) => s + (isNum(v) ? v : 0), 0);
  let sec = null;

  function years(rows) {
    const ys = new Set();
    rows.forEach((r) => Object.keys(r).forEach((k) => { const m = k.match(/^oh (\d{4})$/); if (m) ys.add(+m[1]); }));
    return [...ys].sort((a, b) => a - b);
  }
  const field = () => (G.ent === 'consol' ? G.meas : G.ent);
  const val = (r, y, f = field()) => r[f + ' ' + y];
  const hbPct = (r, y) => (isNum(r['lo_pct ' + y]) ? 1 - r['lo_pct ' + y] : null);
  // Heads the workbook has no figures for yet ('Not considered yet', all zero).
  const unbudgeted = (r, Y) => r.kind === 'head' && !r.plug && Y.every((y) => !r['cost ' + y] && !r['oh ' + y]);
  const shareText = (r, Y, which) => {
    if (r.plug) return 'typed';
    const p = Y.map((y) => (which === 'lo' ? r['lo_pct ' + y] : hbPct(r, y)));
    if (!p.some(isNum)) return '';
    return p[0] === p[p.length - 1] ? pc(p[0]) : pc(p[0]) + ' → ' + pc(p[p.length - 1]);
  };

  function render(s) {
    sec = s || sec;
    if (!sec) return;
    const L = (window.dash.data('ga_lines').data || []).slice().sort((a, b) => a.ord - b.ord);
    const C = window.dash.data('ga_components').data || [];
    sec.replaceChildren();
    if (!L.length) {
      sec.appendChild(el('p', 'take', 'No G&A budget loaded yet. Use Update from models and add the G&A workbook (Sobha USA - GA …xlsx).'));
      return;
    }
    const Y = years(L);
    const cap = L.find((r) => r.kind === 'cap'), total = L.find((r) => r.kind === 'total'), plug = L.find((r) => r.plug);
    const body = L.filter((r) => r.kind !== 'cap');
    if (G.ent !== 'consol') G.meas = 'oh';

    // controls
    const ctl = el('div', 'ctl');
    const seg = (opts, cur, set, label) => {
      const g = el('div', 'seg'); g.setAttribute('role', 'group'); g.setAttribute('aria-label', label);
      opts.forEach(([k, t]) => { const b = el('button', k === cur ? 'on' : '', t); b.type = 'button'; b.setAttribute('aria-pressed', String(k === cur)); b.onclick = () => { set(k); render(); }; g.appendChild(b); });
      return g;
    };
    ctl.appendChild(seg(ENTS, G.ent, (k) => { G.ent = k; }, 'Entity'));
    if (G.ent === 'consol') ctl.appendChild(seg(MEAS, G.meas, (k) => { G.meas = k; }, 'Measure'));
    const hint = { oh: 'Overhead: the share of each cost charged to the company (OH %). Click a head for its split and the lines behind it.',
      cost: 'Full cost of each head before the overhead / project split.',
      proj: 'Project share = full cost × Proj. %, calculated here: the workbook does not multiply it out. It is charged to project budgets, not to G&A.' };
    ctl.appendChild(el('span', 'hint', G.ent === 'consol' ? hint[G.meas] : `${ENT_NAME[G.ent]}: its share of the overhead. Shared heads split by the yearly ratio; home-only heads go 100% to Homebuilder.`));
    ctl.appendChild(el('span', 'unit', 'USD'));
    sec.appendChild(ctl);

    // tiles: 2026–2030 totals for the entity
    const tf = (r) => sum(Y.map((y) => val(r, y, G.ent === 'consol' ? 'oh' : G.ent)));
    const tot = total ? tf(total) : 0, cont = plug ? tf(plug) : 0;
    const kp = el('div', 'kpis');
    const tile = (label, v, sub) => { const k = el('div', 'kpi'); k.append(el('span', null, label), el('b', null, v)); if (sub) k.appendChild(el('small', 'ksub', sub)); kp.appendChild(k); };
    const span = Y[0] + '–' + String(Y[Y.length - 1]).slice(2);
    const all = total ? sum(Y.map((y) => total['oh ' + y])) : 0;
    tile(`Overhead ${span}`, mn(tot), G.ent === 'consol' ? ENT_NAME.consol : all ? pc(tot / all) + ' of total overhead' : '');
    tile('Planned spend', mn(tot - cont), 'overhead without the contingency');
    tile('Contingency (not to be spent)', mn(cont), tot ? pc(cont / tot) + ' of overhead' : '');
    if (G.ent === 'consol') {
      tile('Project share (calculated)', mn(total ? sum(Y.map((y) => total['proj ' + y])) : null), 'charged to project budgets');
      if (cap) tile('Allowed (cap)', mn(sum(Y.map((y) => cap['oh ' + y]))), Y.map((y) => '$' + (cap['oh ' + y] / 1e6).toFixed(1) + 'M').join(' · '));
    }
    sec.appendChild(kp);
    sec.appendChild(splitChart(Y, total, plug, cap));

    // table
    const tw = el('div', 'tw'), t = el('table', 'stmt gat');
    const thr = el('tr');
    const th = (x, c) => { const h = el('th', c || 'n', x); thr.appendChild(h); };
    th('Expense head', 'l');
    th(G.ent === 'consol' ? (G.meas === 'proj' ? 'Proj. %' : G.meas === 'oh' ? 'OH %' : 'OH / Proj.') : G.ent === 'lo' ? 'Landowner share' : 'Homebuilder share');
    Y.forEach((y) => th(String(y)));
    th('Total');
    const thead = el('thead'); thead.appendChild(thr); t.appendChild(thead);
    const tb = el('tbody');
    const ncol = Y.length + 3;
    const hidden = body.filter((r) => unbudgeted(r, Y));
    body.forEach((r) => {
      if (!G.unbudgeted && unbudgeted(r, Y)) return;
      const tr = el('tr', r.kind === 'header' ? 'g' : r.kind === 'total' ? 't' : r.kind === 'subtotal' ? 't st' : unbudgeted(r, Y) ? 'm' : '');
      const first = el('td');
      const open = G.open.has(r.key), canOpen = r.kind !== 'header';
      if (canOpen) { tr.classList.add('k'); tr.tabIndex = 0; tr.setAttribute('aria-expanded', String(open)); if (open) tr.classList.add('open'); first.appendChild(el('span', 'chev', '▸')); }
      if (r.level) first.style.paddingLeft = '28px';
      first.appendChild(document.createTextNode(r.line.replace(/:$/, '')));
      if (r.plug) first.appendChild(el('span', 'edtag', 'buffer'));
      if (unbudgeted(r, Y) && r.note) first.appendChild(el('small', 'ganote', ' ' + r.note));
      first.title = r.line;
      tr.appendChild(first);
      if (r.kind === 'header') { for (let i = 1; i < ncol; i++) tr.appendChild(el('td')); tb.appendChild(tr); return; }
      const pctCell = G.ent === 'consol' ? (r.kind !== 'head' ? '' : G.meas === 'proj' ? pc(r.proj_pct) : G.meas === 'oh' ? pc(r.oh_pct) : (isNum(r.oh_pct) ? pc(r.oh_pct) + ' / ' + pc(r.proj_pct) : '')) : r.kind === 'head' ? shareText(r, Y, G.ent) : '';
      tr.appendChild(el('td', 'pct', pctCell));
      Y.forEach((y) => tr.appendChild(el('td', null, fm(val(r, y)))));
      const vs = Y.map((y) => val(r, y));
      tr.appendChild(el('td', 'tot', vs.some(isNum) ? fm(sum(vs)) : ''));
      if (canOpen) {
        const toggle = () => { if (G.open.has(r.key)) G.open.delete(r.key); else G.open.add(r.key); render(); const n = sec.querySelector(`tr[data-key="${CSS.escape(r.key)}"]`); if (n) n.focus(); };
        tr.dataset.key = r.key;
        tr.onclick = toggle;
        tr.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
      }
      tb.appendChild(tr);
      if (open) {
        const dr = el('tr', 'dr'), td = el('td'); td.colSpan = ncol;
        td.appendChild(detail(r, Y, C.filter((c) => c.head === r.key)));
        dr.appendChild(td); tb.appendChild(dr);
      }
    });
    if (hidden.length) {
      const tr = el('tr', 'more'), td = el('td', null, G.unbudgeted ? `Hide the ${hidden.length} heads with no budget yet` : `Show ${hidden.length} heads with no budget yet (${[...new Set(hidden.map((r) => r.note).filter(Boolean))].join(', ') || 'zero'})`);
      td.colSpan = ncol; tr.appendChild(td); tr.tabIndex = 0;
      const go = () => { G.unbudgeted = !G.unbudgeted; render(); };
      tr.onclick = go; tr.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
      tb.appendChild(tr);
    }
    // Under the total: the cap and the check (Consol overhead), or the entity's share.
    const foot = (label, cells, cls) => { const tr = el('tr', cls || 'b'); tr.appendChild(el('td', null, label)); tr.appendChild(el('td')); cells.forEach((c) => tr.appendChild(el('td', null, c))); tb.appendChild(tr); };
    if (G.ent === 'consol' && G.meas === 'oh' && cap && total) {
      foot('Allowed overhead (cap)', [...Y.map((y) => fm(cap['oh ' + y])), fm(sum(Y.map((y) => cap['oh ' + y])))]);
      foot('Difference (total − cap)', [...Y.map((y) => fm(total['oh ' + y] - cap['oh ' + y])), fm(sum(Y.map((y) => total['oh ' + y] - cap['oh ' + y])))]);
    } else if (G.ent !== 'consol' && total) {
      foot('Share of total overhead', [...Y.map((y) => pc(total[G.ent + ' ' + y] / total['oh ' + y])), pc(sum(Y.map((y) => total[G.ent + ' ' + y])) / sum(Y.map((y) => total['oh ' + y])))]);
    }
    t.appendChild(tb); tw.appendChild(t); sec.appendChild(tw);
    sec.appendChild(notes(L, C, Y, total, plug, cap));
  }

  // Per year: Landowner and Homebuilder overhead, planned spend and contingency, to scale.
  function splitChart(Y, total, plug, cap) {
    const box = el('div', 'card gasplit');
    box.appendChild(el('h3', null, 'Overhead split by year'));
    box.appendChild(el('p', 'sub', 'Landowner (Sobha Developers, H) and Homebuilder (Sobha Homes, V). Lighter parts are contingency, a buffer that is not planned spend.'));
    if (!total) return box;
    const max = Math.max(...Y.map((y) => Math.max(total['oh ' + y] || 0, cap ? cap['oh ' + y] || 0 : 0))) || 1;
    Y.forEach((y) => {
      const row = el('div', 'gasr');
      row.appendChild(el('span', 'gay', String(y)));
      const bar = el('div', 'gabar');
      const part = (v, cls, label) => { if (!(v > 0)) return; const i = el('i', cls); i.style.width = (v / max * 100) + '%'; i.title = label + ': ' + mn(v); bar.appendChild(i); };
      const lo = total['lo ' + y] || 0, hb = total['hb ' + y] || 0, lc = plug ? plug['lo ' + y] || 0 : 0, hc = plug ? plug['hb ' + y] || 0 : 0;
      part(lo - lc, 'galo', 'Landowner planned'); part(lc, 'galo gac', 'Landowner contingency');
      part(hb - hc, 'gahb', 'Homebuilder planned'); part(hc, 'gahb gac', 'Homebuilder contingency');
      if (cap && cap['oh ' + y]) { const m = el('b', 'gacap'); m.style.left = (cap['oh ' + y] / max * 100) + '%'; m.title = 'Cap ' + mn(cap['oh ' + y]); bar.appendChild(m); }
      row.appendChild(bar);
      row.appendChild(el('span', 'gav', `LO ${mn(lo)} (${pc(lo / (lo + hb))}) · HB ${mn(hb)}`));
      box.appendChild(row);
    });
    const lg = el('div', 'legend');
    [['galo', 'Landowner'], ['galo gac', 'contingency'], ['gahb', 'Homebuilder'], ['gahb gac', 'contingency']].forEach(([c, t]) => { const s = el('span'); s.appendChild(el('i', 'gasw ' + c)); s.appendChild(document.createTextNode(t)); lg.appendChild(s); });
    if (cap) { const s = el('span'); s.appendChild(el('i', 'gasw cap')); s.appendChild(document.createTextNode('allowed (cap)')); lg.appendChild(s); }
    box.appendChild(lg);
    return box;
  }

  // One head opened: the split by year, how its figures are built, and its components.
  function detail(r, Y, comps) {
    const d = el('div', 'dx');
    d.appendChild(el('h4', null, r.line.replace(/:$/, '') + (r.kind === 'head' ? ': how it splits' : '')));
    const tw = el('div', 'tw2'), t = el('table');
    const hr = el('tr');
    ['Year', 'Full cost', 'OH %', 'Overhead', 'Project share (calc.)', 'Landowner %', 'Landowner (H)', 'Homebuilder (V)'].forEach((x, i) => hr.appendChild(el('th', i ? 'n' : 'l', x)));
    const th = el('thead'); th.appendChild(hr); t.appendChild(th);
    const tb = el('tbody');
    const line = (label, cells, cls) => { const tr = el('tr', cls || ''); tr.appendChild(el('td', 'l', label)); cells.forEach((c) => tr.appendChild(el('td', null, c))); tb.appendChild(tr); };
    const isHead = r.kind === 'head';
    Y.forEach((y) => line(String(y), [fm(r['cost ' + y]), isHead ? pc(r.oh_pct) : '', fm(r['oh ' + y]), fm(r['proj ' + y]), isHead ? (r.plug ? 'typed' : pc(r['lo_pct ' + y])) : (r['oh ' + y] ? pc(r['lo ' + y] / r['oh ' + y]) : ''), fm(r['lo ' + y]), fm(r['hb ' + y])]));
    const S = (f) => { const v = Y.map((y) => r[f + ' ' + y]); return v.some(isNum) ? fm(sum(v)) : ''; };
    line('Total', [S('cost'), '', S('oh'), S('proj'), '', S('lo'), S('hb')], 'tt');
    t.appendChild(tb); tw.appendChild(t);
    const nest = el('div', 'nest'); nest.appendChild(tw); d.appendChild(nest);

    const dl = el('dl', 'src');
    const dd = (k, v) => { if (!v) return; dl.append(el('dt', null, k), el('dd', null, v)); };
    if (r.plug) dd('What it is', 'A balancing figure typed in so that overhead meets the cap and the fixed Landowner / Homebuilder targets. It is a buffer, not planned spend.');
    dd(Y[0] + ' figure', r.src);
    dd(Y[1] + '–' + Y[Y.length - 1], r.rule_cost);
    dd('Overhead', r.rule_oh);
    if (isHead && !r.plug) {
      const gap = Y.map((y) => (isNum(r['cost ' + y]) && isNum(r['oh ' + y]) && isNum(r['proj ' + y]) ? r['cost ' + y] - r['oh ' + y] - r['proj ' + y] : 0));
      const bad = Y.filter((y, i) => Math.abs(gap[i]) > 1);
      if (bad.length) dd('Check', `Overhead + project share ≠ full cost in ${bad.join(', ')} (by ${fm(gap[Y.indexOf(bad[0])])} in ${bad[0]}): overhead is not set as full cost × OH % there.`);
      if (isNum(r.oh_pct)) dd('Split rule', r.oh_pct === 1 ? 'All overhead (corporate, not tied to a project).' : r.oh_pct === 0 ? 'All project cost: nothing is charged to G&A.' : `${pc(r.oh_pct)} overhead, ${pc(r.proj_pct)} project cost.`);
      const lp = Y.map((y) => r['lo_pct ' + y]);
      if (lp.every((p) => p === 0) && r['oh ' + Y[0]]) dd('Landowner / Homebuilder', 'Home-specific: 100% to Homebuilder.');
      else if (lp.some(isNum) && r['oh ' + Y[0]] != null) dd('Landowner / Homebuilder', 'Shared: Landowner ' + Y.map((y, i) => pc(lp[i])).join(' → ') + ' of the overhead, Homebuilder the rest.');
    }
    dd('Note', r.note);
    dd('In the workbook', r.source);
    d.appendChild(dl);

    if (comps.length) {
      const asset = comps.some((c) => c.kind === 'asset');
      const cw = el('div', 'nest');
      cw.appendChild(el('h4', null, asset ? 'Depreciation by purchase batch (5 years, straight line)' : `What the ${Y[0]} figure is made of`));
      const tw2 = el('div', 'tw2'), t2 = el('table');
      const h2 = el('tr');
      const cols = asset ? ['Batch', 'Bought', ...Y.map(String), 'Note'] : ['Line', 'Where', `Counted in ${Y[0]}`, 'OPEX full year', 'Note'];
      cols.forEach((x, i) => h2.appendChild(el('th', i < (asset ? 1 : 2) || x === 'Note' ? 'l' : 'n', x)));
      const th2 = el('thead'); th2.appendChild(h2); t2.appendChild(th2);
      const tb2 = el('tbody');
      comps.slice().sort((a, b) => a.ord - b.ord).forEach((c) => {
        const tr = el('tr', c.flags ? 'flag' : '');
        if (asset) {
          tr.append(el('td', null, c.line), el('td', null, fm(c.amount)));
          Y.forEach((y) => tr.appendChild(el('td', null, fm(c['v ' + y]))));
        } else {
          const lc = el('td', 'galine', c.line);
          if (c.group) lc.appendChild(el('small', null, c.group));
          tr.append(lc, el('td', 'l', c.ref), el('td', null, fm(c['v ' + Y[0]] != null ? c['v ' + Y[0]] : c.amount)), el('td', null, fm(c.opex_total)));
        }
        tr.appendChild(el('td', 'l gaflag', c.flags || ''));
        tb2.appendChild(tr);
      });
      const tr = el('tr', 'tt');
      if (asset) { tr.append(el('td', null, 'Total'), el('td', null, fm(sum(comps.map((c) => c.amount))))); Y.forEach((y) => tr.appendChild(el('td', null, fm(sum(comps.map((c) => c['v ' + y])))))); tr.appendChild(el('td')); }
      else { tr.append(el('td', null, 'Total'), el('td'), el('td', null, fm(sum(comps.map((c) => (c['v ' + Y[0]] != null ? c['v ' + Y[0]] : c.amount))))), el('td'), el('td')); }
      tb2.appendChild(tr);
      t2.appendChild(tb2); tw2.appendChild(t2); cw.appendChild(tw2);
      if (!asset && comps.some((c) => c.kind === 'opex')) cw.appendChild(el('p', 'note', `"Counted" is what the 'Cal.' sheet adds for ${Y[0]}; "OPEX full year" is the line's own budget. They differ where a line is counted twice or taken from another month.`));
      d.appendChild(cw);
    }
    return d;
  }

  // Points worth knowing, worked out from the figures.
  function notes(L, C, Y, total, plug, cap) {
    const box = el('div', 'card ganotes');
    box.appendChild(el('h3', null, 'Worth knowing'));
    const ul = el('ul');
    const li = (t) => ul.appendChild(el('li', null, t));
    if (plug && total) li(`Contingency (not to be spent) is ${Y.map((y) => pc(plug['oh ' + y] / total['oh ' + y]) + ' in ' + y).join(', ')} of overhead. It fills the gap between the calculated overhead and the cap, so a large part of the totals is buffer.`);
    const shared = L.find((r) => r.kind === 'head' && !r.plug && Y.some((y) => r['lo_pct ' + y] > 0));
    if (shared && total) li(`Shared costs split Landowner ${Y.map((y) => pc(shared['lo_pct ' + y])).join(' → ')}, but the final Landowner share is ${Y.map((y) => pc(total['lo ' + y] / total['oh ' + y])).join(' → ')}, because the contingency is set to hit fixed targets.`);
    L.filter((r) => r.rule_oh && !r.plug).forEach((r) => li(`${r.line}: ${r.rule_oh.charAt(0).toLowerCase() + r.rule_oh.slice(1)}.`));
    const head = Object.fromEntries(L.map((r) => [r.key, r.line]));
    const short = (t) => (t.length > 48 ? t.slice(0, 46).replace(/[\s;,:-]+$/, '') + '…' : t);
    C.filter((c) => c.flags).forEach((c) => li(`${head[c.head]}, ${c.ref} (${short(c.line)}): ${c.flags}.`));
    const nb = L.filter((r) => unbudgeted(r, Y));
    if (nb.length) li(`${nb.length} heads have no budget yet: ${nb.map((r) => r.line).join(', ')}.`);
    if (cap && total) { const off = Y.filter((y) => Math.abs(total['oh ' + y] - cap['oh ' + y]) > 1); li(off.length ? `Overhead differs from the cap in ${off.join(', ')}.` : 'Overhead equals the cap in every year.'); }
    box.appendChild(ul);
    return box;
  }

  window.SobhaGA = { render };
})();
