// Exposure view: the projected exposure statement of each entity (dataset exposure, built by
// derive-exposure.js) as laid out in the sheet. A line opens to Landowner and Homebuilder (on
// Consol) and to the rows behind it (exposure_parts), e.g. working capital per project.
(function () {
  'use strict';
  const X = { open: new Set() };
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const fm = (v) => (!isNum(v) ? '' : Math.abs(v) < 0.5 ? '–' : (v < 0 ? '(' : '') + Math.round(Math.abs(v)).toLocaleString('en-US') + (v < 0 ? ')' : ''));
  const pct = (v) => (isNum(v) ? (v * 100).toFixed(1) + '%' : '');
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/s$/, '');
  const cols = (r, p) => Object.keys(r).filter((k) => new RegExp('^' + p + '\\d+$').test(k)).sort((a, b) => a.slice(p.length) - b.slice(p.length));
  let box = null;

  function render(container, ent) {
    box = container || box;
    if (ent) X.ent = ent;
    if (!box) return;
    box.replaceChildren();
    const E = window.dash.data('exposure').data || [], P = window.dash.data('exposure_parts').data || [];
    const mine = E.filter((r) => r.entity === X.ent).sort((a, b) => a.ord - b.ord);
    if (!mine.length) return;
    const secs = mine.filter((r) => r.kind === 'section');
    // On Consol: the same line in the Landowner and Homebuilder statements, by section and label.
    const twin = (r, e) => {
      const c = E.filter((x) => x.entity === e && x.sec === r.sec && x.kind !== 'section' && norm(x.line) === norm(r.line));
      return c.find((x) => x.level === r.level) || c[0] || null;
    };
    secs.forEach((s) => {
      const H = cols(s, 'h'), n = H.length;
      const tw = el('div', 'tw gaexp'), t = el('table', 'stmt gat');
      const thead = el('thead'), hr = el('tr');
      hr.appendChild(el('th', 'l', s.line.replace(/'s$/, 's')));
      H.forEach((h) => hr.appendChild(el('th', 'n', s[h])));
      thead.appendChild(hr); t.appendChild(thead);
      const tb = el('tbody');
      const at = (other, i) => {
        // value of `other` (a row of another entity) in this section's period i, by period key
        const os = E.find((x) => x.key === other.parent);
        const j = os ? cols(os, 'hk').findIndex((k) => os[k] === s['hk' + (i + 1)]) : -1;
        return j < 0 ? null : other['p' + (j + 1)];
      };
      mine.filter((r) => r.parent === s.key).forEach((r) => {
        const isPct = r.kind === 'pct';
        const vals = H.map((h, i) => r['p' + (i + 1)]);
        const parts = P.filter((p) => p.row === r.key);
        const lo = X.ent === 'consol' && !isPct ? twin(r, 'lo') : null, hb = X.ent === 'consol' && !isPct ? twin(r, 'hb') : null;
        const tr = el('tr', r.kind === 'total' ? 't' : '');
        const lab = el('td', 'l');
        lab.appendChild(el('span', 'sl', r.code || ''));
        if (r.level) lab.style.paddingLeft = '22px';
        const canOpen = parts.length || lo || hb;
        if (canOpen) {
          lab.appendChild(el('span', 'chev', '▸'));
          tr.classList.add('k'); tr.tabIndex = 0; tr.dataset.k = r.key;
          const open = X.open.has(r.key);
          tr.setAttribute('aria-expanded', String(open)); if (open) tr.classList.add('open');
          const go = () => { if (X.open.has(r.key)) X.open.delete(r.key); else X.open.add(r.key); render(); const f = box.querySelector(`[data-k="${CSS.escape(r.key)}"]`); if (f) f.focus(); };
          tr.onclick = go; tr.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
        }
        lab.appendChild(document.createTextNode(r.line));
        tr.appendChild(lab);
        vals.forEach((v) => tr.appendChild(el('td', null, isPct ? pct(v) : fm(v))));
        tb.appendChild(tr);
        if (!canOpen || !X.open.has(r.key)) return;
        const sub = (label, vs, cls) => { const x = el('tr', 'p' + (cls ? ' ' + cls : '')); x.appendChild(el('td', 'l', label)); vs.forEach((v) => x.appendChild(el('td', null, fm(v)))); tb.appendChild(x); };
        if (lo || hb) {
          const lv = H.map((h, i) => (lo ? at(lo, i) : null)), hv = H.map((h, i) => (hb ? at(hb, i) : null));
          if (lo) sub('Landowner', lv);
          if (hb) sub('Homebuilder', hv);
          const diff = vals.map((v, i) => (isNum(v) ? v - (lv[i] || 0) - (hv[i] || 0) : null));
          if (diff.some((d) => isNum(d) && Math.abs(d) >= 1)) sub('Difference', diff, 'gadiff');
        }
        let grp;
        parts.slice().sort((a, b) => a.ord - b.ord).forEach((p) => {
          if (p.group && p.group !== grp) { grp = p.group; const g = el('tr', 'p gagrp'); const c = el('td', 'l', grp); c.colSpan = n + 1; g.appendChild(c); tb.appendChild(g); }
          if (!p.group) grp = null;
          sub(p.line, H.map((h, i) => p['p' + (i + 1)]), 'gapart');
        });
      });
      t.appendChild(tb); tw.appendChild(t); box.appendChild(tw);
    });
  }

  window.SobhaExposure = { render };
})();
