// derive-exposure: the projected exposure statements — Consol ('Cons Exposure' in the Consol
// model), Landowner ('HS Exposure') and Homebuilder ('Cons Exposure' in the Homebuilder model).
//   exposure        every section (Assets, Equity & Liabilities, annual figures, equity statement,
//                   …) as laid out in the sheet: period headers h1..hN (hk1..hkN normalised for
//                   matching across entities), lines with values p1..pN. A period spans two
//                   columns: sub-items sit in the first, the lines they add up to in the second.
//   exposure_parts  what a line is made of: the rows behind each sheet it refers to (e.g. working
//                   capital per project from the inventory and land sheets), summed per row label.
(function (X) {
  'use strict';
  const { isNum, clean, lower } = X.lib;
  const XL = (typeof window !== 'undefined' ? window : globalThis).XLSXLite;
  const ENTS = [['consol', 'consol', 'Cons Exposure'], ['lo', 'landowner', 'HS Exposure'], ['hb', 'homebuilder', 'Cons Exposure']];
  ENTS.forEach(([e, model, sheet]) => { X.SHEETS['exposure_' + e] = [[model, sheet]]; });
  const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const r2 = (v) => (isNum(v) ? Math.round(v * 100) / 100 : null);
  const iso = (v) => XL.serialToISO(v);
  // A period header: 'As at 31 Dec 2026', a date, "Till Aug'26", 'FY 2026'. -> [label, key] or null.
  function period(v) {
    if (isNum(v)) return v > 40000 && v < 60000 ? [short(iso(v)), iso(v)] : null;
    const t = clean(v);
    let m = t.match(/^as at\s+(\d{1,2})\s+([a-z]+)\s+(\d{4})$/i);
    if (m) { const mi = MON.indexOf(m[2].slice(0, 3).toLowerCase()); if (mi < 0) return null; const k = m[3] + '-' + String(mi + 1).padStart(2, '0') + '-' + m[1].padStart(2, '0'); return [short(k), k]; }
    m = t.match(/^till\s+([a-z]{3})[a-z]*\s*'(\d{2})$/i);
    if (m) return [t, 'till-20' + m[2] + '-' + String(MON.indexOf(m[1].toLowerCase()) + 1).padStart(2, '0')];
    m = t.match(/^fy\s*(\d{4}|\d{2})$/i);
    if (m) { const y = m[1].length === 2 ? '20' + m[1] : m[1]; return ['FY' + y.slice(2), y + '-12-31']; }
    return null;
  }
  // 'Dec\'26' for a balance date; an 'FY' column shares the key of its 31 December.
  const short = (k) => { const [y, mo] = k.split('-'); return MON[+mo - 1].replace(/^./, (c) => c.toUpperCase()) + "'" + y.slice(2); };
  const secKey = (t) => { const l = lower(t); return /assets/.test(l) ? 'assets' : /liabilit/.test(l) ? 'liabilities' : /annual/.test(l) ? 'annual' : /^equity/.test(l) ? 'equity' : /profit|p&l/.test(l) ? 'pl' : l.replace(/[^a-z0-9]+/g, '-'); };

  function readSheet(s, ent) {
    const out = [], heads = [];
    // One table per 'Particulars' header row, the leftmost (blocks further right compare versions).
    for (const r of s.rowNums()) { const c = Object.keys(s.row(r)).map(Number).sort((x, y) => x - y).find((k) => lower(s.get(r, k)) === 'particulars'); if (c) heads.push({ r, c }); }
    heads.forEach((h, i) => {
      // periods: header cells right of the label; a span runs to the next header (max 2 columns)
      // and the block stops where a header repeats (later columns compare versions).
      const cols = Object.keys(s.row(h.r)).map(Number).filter((c) => c > h.c).sort((a, b) => a - b);
      const P = [], seen = new Set();
      for (const c of cols) { const p = period(s.get(h.r, c)); if (!p) continue; if (seen.has(p[1])) break; seen.add(p[1]); P.push({ c, label: p[0], key: p[1] }); }
      P.forEach((p, j) => { p.c2 = j + 1 < P.length ? Math.min(P[j + 1].c - 1, p.c + 1) : p.c + 1; });
      if (!P.length) return;
      let title = null;
      for (let r = h.r - 1; r >= Math.max(1, h.r - 3) && !title; r--) { const t = clean(s.get(r, h.c - 1)) || clean(s.get(r, h.c)); if (t && !/^sr\.?\s*no/i.test(t) && !Object.values(s.row(r)).some(isNum)) title = t; }
      title = title || 'Section ' + (i + 1);
      const sk = ent + '|' + secKey(title) + '|' + (i + 1);
      const sec = { key: sk, entity: ent, sec: secKey(title), ord: out.length + 1, kind: 'section', code: null, line: title, level: 0, row: h.r };
      P.forEach((p, j) => { sec['h' + (j + 1)] = p.label; sec['hk' + (j + 1)] = p.key; });
      out.push(sec);
      const end = i + 1 < heads.length ? heads[i + 1].r - 1 : s.maxRow;
      const rows = [];
      let lastCode = -9;
      for (let r = h.r + 1; r <= end; r++) {
        const line = clean(s.get(r, h.c)), code = s.get(r, h.c - 1);
        if (code != null && clean(code)) lastCode = r;
        if (!line) continue;
        // A line without a Sr No right under a numbered one (Consol 'Sundry Creditors (Others)') too.
        const hasNums = P.some((p) => isNum(s.get(r, p.c)) || (p.c2 > p.c && isNum(s.get(r, p.c2))));
        const keep = (code != null && clean(code)) || (/^total/i.test(line) && r - lastCode <= 2) || /^return on equity/i.test(line)
          || (hasNums && r - lastCode === 1 && !/^(check|diff)/i.test(line));
        if (!keep) { if (rows.length && /^(sr\.?\s*no|assets|equity)/i.test(line)) break; continue; }
        let nf = 0, ns = 0, anyF = false, anyS = false;
        const vals = P.map((p) => {
          const a = s.get(r, p.c), b = p.c2 > p.c ? s.get(r, p.c2) : null;
          if (isNum(a)) { anyF = true; if (a) nf++; }
          if (isNum(b)) { anyS = true; if (b) ns++; }
          return isNum(b) && b ? { v: b, c: p.c2 } : isNum(a) && a ? { v: a, c: p.c } : isNum(b) ? { v: 0, c: p.c2 } : isNum(a) ? { v: 0, c: p.c } : { v: null, c: null };
        });
        rows.push({ r, line, code, vals, first: (nf > 0 && ns === 0) || (nf === 0 && ns === 0 && anyF && !anyS), ns });
      }
      // Two levels only where the section uses both columns: sub-items in the first.
      const twoLevel = rows.some((x) => x.ns > 0) && rows.some((x) => x.first);
      rows.forEach((x) => {
        const row = { key: sk + '|' + String(x.r).padStart(3, '0'), entity: ent, sec: secKey(title), ord: out.length + 1, kind: /^total/i.test(x.line) ? 'total' : /^return on equity/i.test(x.line) ? 'pct' : 'line', code: x.code == null ? null : String(x.code), line: x.line, level: twoLevel && x.first ? 1 : 0, row: x.r, parent: sk };
        x.vals.forEach((o, j) => { row['p' + (j + 1)] = o.v == null ? null : row.kind === 'pct' ? o.v : r2(o.v); });
        row._cells = x.vals.map((o) => o.c);
        out.push(row);
      });
      // A line over sub-items left blank (or 0) in the sheet while its sub-items are not, e.g.
      // the first period's 'Total bank and cash balance' and 'Total Equity': their sum, as in
      // the Executive Report.
      const lines = out.filter((r) => r.parent === sk);
      lines.forEach((r, i) => {
        if (r.level || r.kind === 'pct') return;
        const kids = [];
        for (let k = i - 1; k >= 0 && lines[k].level; k--) kids.push(lines[k]);
        if (!kids.length) return;
        P.forEach((p, j) => {
          const f = 'p' + (j + 1), sum = kids.reduce((t, x) => t + (isNum(x[f]) ? x[f] : 0), 0);
          if (!r[f] && Math.abs(sum) >= 0.5 && kids.some((x) => isNum(x[f]))) r[f] = r2(sum);
        });
      });
    });
    return out;
  }

  // Rows behind one cell's references to other sheets of the same workbook: a SUM/SUBTOTAL
  // over a range gives its rows; anything else is the referenced row itself.
  const REF = /([+-]?)\s*(?:'([^'!]+)'|([A-Za-z][\w .&-]*?))!\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?/g;
  const rowLabel = (t, r) => { for (let c = 1; c <= 8; c++) { const v = t.get(r, c); if (typeof v === 'string' && clean(v) && !/^\d+(\.\d+)?$/.test(clean(v))) return clean(v); } return null; };
  const groupName = (n) => clean(n.replace(/\b(new|hs|cons)\b/gi, '').replace(/[-_]+$/, '').replace(/\s*-\s*$/, '')).replace(/^./, (c) => c.toUpperCase());
  async function partsOf(ctx, model, f) {
    const out = [];
    if (!f || /\[\d+\]/.test(f)) return out;
    let m;
    REF.lastIndex = 0;
    while ((m = REF.exec(f))) {
      const name = m[2] || m[3], sign = m[1] === '-' ? -1 : 1;
      const t = await ctx.sheetOf(model, name.trim());
      if (!t) continue;
      const c1 = XL.colNum(m[4]), r1 = +m[5], r2_ = m[7] ? +m[7] : r1;
      for (let r = r1; r <= r2_; r++) {
        const tf = t.formula(r, c1) || '';
        const sm = tf.match(/^(?:SUM|SUBTOTAL\(\s*9\s*,)\(?\s*\$?([A-Z]{1,3})\$?(\d+):\$?([A-Z]{1,3})\$?(\d+)\s*\)$/i);
        if (sm && XL.colNum(sm[1]) === c1) {
          for (let x = +sm[2]; x <= +sm[4]; x++) { const v = t.get(x, c1), lab = rowLabel(t, x); if (isNum(v) && lab && !/^sub-?total|^total/i.test(lab)) out.push({ group: groupName(name), line: lab, v: sign * v }); }
        } else { const v = t.get(r, c1), lab = rowLabel(t, r); if (isNum(v) && lab) out.push({ group: groupName(name), line: lab, v: sign * v }); }
      }
    }
    return out;
  }

  X.step('exposure', async (ctx) => {
    const out = [], parts = [], got = [];
    for (const [e, model] of ENTS) {
      const s = await ctx.sheet('exposure_' + e);
      if (!s) { out.push(...(ctx.prev.exposure || []).filter((r) => r.entity === e)); parts.push(...(ctx.prev.exposure_parts || []).filter((r) => r.entity === e)); continue; }
      got.push(e);
      const rows = readSheet(s, e);
      for (const row of rows) {
        const cells = row._cells; delete row._cells;
        out.push(row);
        if (!cells || row.kind === 'pct') continue;
        const acc = new Map();
        for (let j = 0; j < cells.length; j++) {
          if (cells[j] == null) continue;
          for (const p of await partsOf(ctx, model, s.formula(row.row, cells[j]))) {
            const k = p.group + '|' + p.line;
            const a = acc.get(k) || { group: p.group, line: p.line, v: {} };
            a.v[j + 1] = (a.v[j + 1] || 0) + p.v;
            acc.set(k, a);
          }
        }
        // Worth showing only when it breaks the line down; whatever the parts don't cover is 'Other'.
        if (acc.size < 2) continue;
        const other = { group: null, line: 'Other', v: {} };
        for (let j = 1; j <= cells.length; j++) {
          const got = [...acc.values()].reduce((t, a) => t + (a.v[j] || 0), 0), want = row['p' + j];
          if (isNum(want) && Math.abs(want - got) > 1) other.v[j] = want - got;
        }
        if (Object.keys(other.v).length) acc.set('|other', other);
        [...acc.values()].forEach((a, i) => {
          const pr = { key: row.key + '|' + String(i + 1).padStart(2, '0'), entity: e, row: row.key, ord: i + 1, group: a.group, line: a.line };
          for (let j = 1; j <= cells.length; j++) pr['p' + j] = r2(a.v[j] != null ? a.v[j] : null);
          if (Object.keys(pr).some((k) => /^p\d+$/.test(k) && pr[k])) parts.push(pr);
        });
      }
    }
    if (!got.length) throw new Error("needs 'Cons Exposure' or 'HS Exposure'");
    ctx.data.exposure_parts = parts;
    return out;
  });
  X.step('exposure_parts', async (ctx) => {
    if (!ctx.fresh('exposure')) throw new Error("needs 'Cons Exposure' or 'HS Exposure'");
    return ctx.data.exposure_parts;
  });
})(typeof window !== 'undefined' ? window.SobhaExtract : globalThis.SobhaExtract);
