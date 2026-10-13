// derive-ga: the G&A (overhead) budget from the G&A workbook ('Sobha USA - GA …').
//   ga_lines       each row of the 'G&A' sheet, 2026–2030: full cost, overhead (OH %), the
//                  project share (Proj. %; calculated here, the workbook never multiplies it
//                  out) and the overhead's split between Sobha Developers (Landowner, H) and
//                  Sobha Homes (Homebuilder, V); then the allowed overhead (the cap).
//   ga_components  what each head is made of: the OPEX lines its 'Cal.' row adds up (lines
//                  counted twice or taken from another month are flagged), outside files,
//                  and the depreciation batches.
// Layout is read from the headers ('Expense Head', 'TOTAL OH', 'Sobha Developers', 'Sobha
// Homes', 'OH', 'Proj.', the year row), so new heads, rows and years are picked up.
(function (X) {
  'use strict';
  const { isNum, clean, lower } = X.lib;
  const XL = (typeof window !== 'undefined' ? window : globalThis).XLSXLite;
  X.MODELS.ga = { label: 'G&A budget', need: ['G&A', 'Cal.', 'OPEX'] };
  Object.assign(X.SHEETS, { ga: [['ga', 'G&A']], ga_cal: [['ga', 'Cal.']], ga_opex: [['ga', 'OPEX']], ga_capex: [['ga', 'CAPEX']],
    ga_oh_consol: [['ga', 'OHcost-H+V']], ga_oh_lo: [['ga', 'OHcost-H']], ga_oh_hb: [['ga', 'OHcost-V']] });

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const isYear = (v) => isNum(v) && v > 1990 && v < 2200;
  const r2 = (v) => (isNum(v) ? Math.round(v * 100) / 100 : null);
  const find = (s, re, from = 1, to = Infinity) => {
    for (const r of s.rowNums()) {
      if (r < from || r > to) continue;
      for (const [c, v] of Object.entries(s.row(r))) if (typeof v === 'string' && re.test(lower(v))) return { r, c: +c };
    }
    return null;
  };
  // Cell references to one sheet in a formula, ranges expanded: [{row, col}] (a cell
  // written twice appears twice).
  function refsTo(f, sheet) {
    const out = [], re = new RegExp("(?:'" + sheet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'|\\b" + sheet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ")!\\$?([A-Z]{1,3})\\$?(\\d+)(?::\\$?([A-Z]{1,3})\\$?(\\d+))?", 'g');
    let m;
    while ((m = re.exec(f))) {
      const c1 = XL.colNum(m[1]), r1 = +m[2], c2 = m[3] ? XL.colNum(m[3]) : c1, r2_ = m[4] ? +m[4] : r1;
      for (let r = r1; r <= r2_; r++) for (let c = c1; c <= c2; c++) out.push({ row: r, col: c });
    }
    return out;
  }
  // Rows a same-sheet SUM/+ formula adds up in one column (for subtotals).
  function rowsIn(f) {
    const out = [];
    f.replace(/('[^']*'|"[^"]*")|(?<![A-Za-z0-9_.!])\$?[A-Z]{1,3}\$?(\d+)(?::\$?[A-Z]{1,3}\$?(\d+))?(?![\d(A-Za-z_])/g, (m, q, a, b) => {
      if (!q) for (let r = +a; r <= +(b || a); r++) out.push(r);
      return m;
    });
    return out;
  }

  // ---- the G&A sheet -------------------------------------------------------------------
  function layout(s) {
    const h = find(s, /^expense head$/);
    if (!h) throw new Error("the 'G&A' sheet has no 'Expense Head' column");
    const above = (re) => { const x = find(s, re, 1, h.r - 1); return x ? x.c : null; };
    const cOH = above(/^total oh$/), cLO = above(/^sobha developers/), cHB = above(/^sobha homes/);
    if (!cOH || !cLO || !cHB) throw new Error("the 'G&A' sheet is missing the 'TOTAL OH', 'Sobha Developers' or 'Sobha Homes' columns");
    const sub = s.row(h.r + 1);
    const at = (re) => +(Object.keys(sub).find((c) => typeof sub[c] === 'string' && re.test(lower(sub[c]))) || 0);
    const cOHp = at(/^oh$/), cPp = at(/^proj/);
    const yearAt = (c) => { for (let r = h.r - 1; r >= 1; r--) if (isYear(s.get(r, c))) return s.get(r, c); return null; };
    const B = { cost: {}, oh: {}, lo: {}, hb: {}, lo_pct: {}, hb_pct: {} };
    for (const [k, v] of Object.entries(sub)) {
      const c = +k;
      if (lower(v) === 'amount') {
        const y = yearAt(c - 1) || yearAt(c);
        if (y) B[c < cOHp ? 'cost' : c < cLO ? 'oh' : c < cHB ? 'lo' : 'hb'][y] = c;
      } else if (isYear(v) && c >= cLO) B[c < cHB ? 'lo_pct' : 'hb_pct'][v] = c;
    }
    const years = Object.keys(B.oh).map(Number).sort((a, b) => a - b);
    if (!years.length) throw new Error("the 'G&A' sheet has no year columns under 'TOTAL OH'");
    return { h, cCode: h.c - 1, cNote: cOHp - 1, cOHp, cPp, cOH, B, years };
  }

  // How the projected years are worked out, from the first projected year's formulas.
  function costRule(s, L, r) {
    const y = L.years[1], c = L.B.cost[y];
    if (!c) return null;
    const f = s.formula(r, c), v = s.get(r, c);
    if (f == null) return isNum(v) && v ? 'Typed into the G&A sheet' : null;
    let m = f.match(/ROUNDUP\(.*\(\s*\w+\$(\d+)\s*\/\s*\w+\$\1\s*\)\s*,\s*-3\s*\)/i);
    if (m) return `Previous year × growth in ${clean(s.get(+m[1], L.h.c)).replace(/\s*\(.*$/, '').toLowerCase() || 'row ' + m[1]}, rounded up to the nearest $1,000`;
    if (/\[\d+\]/.test(f)) return 'From an outside file (' + f.replace(/^=/, '') + ')';
    if (/Cal\./.test(f)) return "From the 'Cal.' sheet (" + f.replace(/^=/, '') + ')';
    m = f.match(/^\$?([A-Z]{1,3})\$?(\d+)$/);
    if (m && +m[2] === r) return 'Held at the ' + L.years[0] + ' figure';
    return '=' + f;
  }
  function ohRule(s, L, r) {
    const y = L.years[1], c = L.B.oh[y];
    const f = c ? s.formula(r, c) : null;
    if (f == null || /^\$?[A-Z]{1,3}\$?\d+\s*\*\s*\$?[A-Z]{1,3}\$?\d+$/.test(f) && new RegExp('\\$?' + XL.colName(L.cOHp) + '\\$?' + r).test(f)) return null;
    const m = f.match(/^\$?([A-Z]{1,3})\$?(\d+)\s*\*\s*([\d.]+)$/);
    if (m && XL.colNum(m[1]) === L.B.oh[L.years[0]] && +m[2] === r) return `Overhead from ${y} = ${L.years[0]} overhead × ${m[3]}, not full cost × OH %`;
    return 'Overhead: =' + f;
  }

  // ---- Cal. and OPEX -------------------------------------------------------------------
  function calLayout(cal) {
    const jan = find(cal, /^jan$/);
    if (!jan) return null;
    const cols = [];
    for (let i = 0; i < 12; i++) if (lower(cal.get(jan.r, jan.c + i)) === lower(MONTHS[i])) cols.push(jan.c + i);
    const assets = find(cal, /^asset purchase amount$/);
    return { cols, label: jan.c - 1, assets };
  }
  function opexLayout(op) {
    const d = find(op, /^description$/);
    if (!d) return null;
    // Month columns: the header row of date serials; the 'Amount' column is the year's total.
    let months = [], total = null;
    for (let r = d.r; r <= d.r + 6 && months.length < 12; r++) {
      const cs = Object.entries(op.row(r)).filter(([, v]) => isNum(v) && v > 30000 && v < 80000).map(([c]) => +c);
      if (cs.length >= 12) months = cs.slice(0, 12);
      const a = Object.entries(op.row(r)).find(([, v]) => lower(v) === 'amount');
      if (a) total = +a[0];
    }
    const name = (c) => (c === total ? 'the full-year total' : months.includes(c) ? MONTHS[months.indexOf(c)] : 'column ' + XL.colName(c));
    // The group a line sits in: the nearest row above that is a subtotal or a bare title.
    const group = (r) => {
      for (let g = r - 1; g > d.r; g--) {
        const lab = clean(op.get(g, d.c)), f = op.formula(g, months[0]);
        if (lab && ((f && /^SUBTOTAL\(/i.test(f)) || !Object.values(op.row(g)).some(isNum))) return lab;
      }
      return null;
    };
    const sr = find(op, /^sr\.?\s*no/, d.r, d.r);
    return { label: d.c, sr: sr ? sr.c : d.c - 1, months, total, name, group };
  }

  // The OPEX lines one Cal. row adds up over the 12 months. Each month should take that
  // month's column once; anything else (a cell added twice, another month's column, the
  // full-year total) is flagged.
  function calComponents(cal, C, op, O, cr) {
    const by = new Map();
    let other = 0, outside = null;
    C.cols.forEach((cc, m) => {
      const f = cal.formula(cr, cc), v = cal.get(cr, cc);
      if (f == null) { if (isNum(v)) other += v; return; }
      if (/\[\d+\]/.test(f)) outside = f;
      let counted = 0;
      for (const ref of refsTo(f, 'OPEX')) {
        const x = op.get(ref.row, ref.col), val = isNum(x) ? x : 0;
        const o = by.get(ref.row) || { row: ref.row, v: 0, uses: Array.from({ length: 12 }, () => []) };
        o.v += val; counted += val;
        const next = m < 11 ? O.months[m + 1] : O.total;
        o.uses[m].push(ref.col === O.months[m] ? 'own' : ref.col === next ? 'next' : O.name(ref.col));
        by.set(ref.row, o);
      }
      if (isNum(v)) other += v - counted;
    });
    const NEXT = { next: "every month takes the next month's figure (December takes the full-year total)",
      'next+own': "every month adds its own and the next month's figure (December adds the full-year total)",
      'own+own': 'counted twice' };
    const out = [...by.values()].sort((a, b) => a.row - b.row).map((o) => {
      const sig = o.uses.map((u) => u.slice().sort().join('+'));
      let flags = null;
      if (sig.every((x) => x === sig[0])) flags = sig[0] === 'own' ? null : NEXT[sig[0]] || 'each month uses ' + sig[0].replace(/\+/g, ' + ');
      else {
        const odd = sig.map((x, m) => (x === 'own' || x === '' ? null : MONTHS[m] + ' uses ' + o.uses[m].map((u) => (u === 'own' ? MONTHS[m] : u === 'next' ? (m < 11 ? MONTHS[m + 1] : 'the full-year total') : u)).join(' + '))).filter(Boolean);
        flags = odd.join('; ') || null;
      }
      const c = { kind: 'opex', group: O.group(o.row), sr: op.get(o.row, O.sr), line: clean(op.get(o.row, O.label)), ref: 'OPEX row ' + o.row, amount: o.v, opex_total: O.total ? op.get(o.row, O.total) : null, flags };
      O.months.forEach((mc, i) => { c[MONTHS[i]] = r2(op.get(o.row, mc)); });
      return c;
    });
    if (Math.abs(other) > 0.5) out.push(outside
      ? { kind: 'outside', group: null, line: 'Set outside this budget', ref: outside.replace(/^=/, ''), amount: other, opex_total: null, flags: null }
      : { kind: 'typed', group: null, line: 'Other amounts', ref: "'Cal.' row " + cr, amount: other, opex_total: null, flags: null });
    return out;
  }

  // CAPEX: the item lines behind a total cell, following SUBTOTAL / SUM / + down to the items.
  function capexLayout(cx) {
    const d = find(cx, /^description$/);
    if (!d) return null;
    const sr = find(cx, /^sr\.?\s*no/, d.r, d.r), unit = find(cx, /^unit cost/, d.r, d.r);
    let months = [];
    for (let r = d.r; r <= d.r + 6 && !months.length; r++) {
      const cs = Object.entries(cx.row(r)).filter(([, v]) => isNum(v) && v > 30000 && v < 80000).map(([c]) => +c);
      if (cs.length >= 12) months = cs.slice(0, 12);
    }
    const srC = sr ? sr.c : d.c - 1;
    const group = (r) => {
      for (let g = r - 1; g > d.r; g--) {
        const t = cx.get(g, srC);
        if (typeof t === 'string' && clean(t) && !/^(sub-?total|grand total)/i.test(clean(t)) && !Object.values(cx.row(g)).some(isNum)) return clean(t);
      }
      return null;
    };
    return { d, sr: srC, unit: unit ? unit.c : null, months, group };
  }
  function capexLeaves(cx, r, c, seen) {
    if (seen.has(r)) return [];
    seen.add(r);
    const f = cx.formula(r, c);
    if (f && /^SUBTOTAL\(/i.test(f)) return rowsIn(f).filter((x) => x !== r && !/^SUBTOTAL\(/i.test(cx.formula(x, c) || '')).flatMap((x) => capexLeaves(cx, x, c, seen));
    if (f && /^(SUM\(|[\s$A-Z]*\d+\s*\+)/i.test(f) && /^[\s$A-Z0-9:+,()]+$/i.test(f)) return rowsIn(f).filter((x) => x !== r).flatMap((x) => capexLeaves(cx, x, c, seen));
    const v = cx.get(r, c);
    return isNum(v) && v ? [r] : [];
  }
  function capexLines(cx, K, f, batch) {
    const out = [];
    for (const ref of refsTo(f || '', 'CAPEX')) for (const r of capexLeaves(cx, ref.row, ref.col, new Set())) {
      const c = { kind: 'capex', batch, group: K.group(r), sr: cx.get(r, K.sr), line: clean(cx.get(r, K.d.c)), ref: 'CAPEX row ' + r, unit: K.unit ? r2(cx.get(r, K.unit)) : null, amount: cx.get(r, ref.col), opex_total: null, flags: null };
      K.months.forEach((mc, i) => { c[MONTHS[i]] = isNum(cx.get(r, mc)) ? cx.get(r, mc) : null; });
      out.push(c);
    }
    return out;
  }

  // Depreciation: one batch of assets per purchase year, written off straight-line.
  function assetComponents(cal, C, years, cx) {
    const a = C.assets;
    if (!a) return [];
    const ycol = {};
    for (const [c, v] of Object.entries(cal.row(a.r))) if (isYear(v)) ycol[v] = +c;
    const yearLabelCol = +Object.keys(cal.row(a.r)).find((c) => lower(cal.get(a.r, +c)) === 'year');
    const out = [];
    let prev = null;
    for (let r = a.r + 1; r <= cal.maxRow; r++) {
      const amt = cal.get(r, a.c), y = cal.get(r, yearLabelCol);
      if (!isNum(amt) || !isYear(y)) { if (out.length) break; continue; }
      const flags = prev != null && y <= prev ? `labelled ${y}, but it follows the ${prev} batch (probably ${prev + 1})` : null;
      const f = cal.formula(r, a.c);
      const row = { kind: 'asset', group: 'Depreciation schedule', line: `Assets bought in ${flags ? prev + 1 : y}`, ref: "'Cal.' row " + r + (f ? ' (' + f + ')' : ''), amount: amt, opex_total: amt, flags };
      for (const yy of years) row['v ' + yy] = ycol[yy] ? r2(cal.get(r, ycol[yy])) : null;
      out.push(row);
      const K = cx && capexLayout(cx);
      if (K) out.push(...capexLines(cx, K, f, row.line.replace(/^Assets bought in /, '')));
      prev = flags ? prev + 1 : y;
    }
    return out;
  }

  X.step('ga_lines', async (ctx) => {
    const s = await ctx.need('ga');
    const L = layout(s), Y = L.years;
    const cal = await ctx.sheet('ga_cal'), op = await ctx.sheet('ga_opex');
    const C = cal && calLayout(cal), O = op && opexLayout(op), cx = await ctx.sheet('ga_capex');
    const lines = [], comps = [], byRow = {};
    let ord = 0, section = null, last = null;
    const labelled = s.rowNums().filter((r) => r > L.h.r + 1 && clean(s.get(r, L.h.c)));
    for (const r of labelled) {
      const line = clean(s.get(r, L.h.c)), code = s.get(r, L.cCode);
      const pick = (b) => Object.fromEntries(Y.map((y) => [y, L.B[b][y] ? s.get(r, L.B[b][y]) : null]));
      const v = { cost: pick('cost'), oh: pick('oh'), lo: pick('lo'), hb: pick('hb'), lo_pct: pick('lo_pct'), hb_pct: pick('hb_pct') };
      const any = Object.values(v).some((o) => Object.values(o).some(isNum));
      const kind = /^sub[\s-]*total/i.test(line) ? 'subtotal' : !isNum(code) && !any ? 'header' : 'head';
      const level = isNum(code) ? 1 : 0;
      if (kind === 'header') section = 'ga|' + String(++ord).padStart(2, '0');
      else if (level === 0) section = null;
      const key = kind === 'header' ? section : 'ga|' + String(++ord).padStart(2, '0');
      const ohp = s.get(r, L.cOHp), pp = s.get(r, L.cPp);
      const row = {
        key, ord, code: code == null ? null : String(code), line, kind, level, parent: level ? section : null,
        note: clean(s.get(r, L.cNote)) || null,
        oh_pct: isNum(ohp) ? ohp : isNum(pp) ? r2(1 - pp) : null, proj_pct: isNum(pp) ? pp : isNum(ohp) ? r2(1 - ohp) : null,
        plug: false, rule_cost: null, rule_oh: null, src: null, source: `G&A, row ${r}`, row: r,
      };
      for (const y of Y) {
        row['cost ' + y] = r2(v.cost[y]); row['oh ' + y] = r2(v.oh[y]);
        row['lo ' + y] = r2(v.lo[y]); row['hb ' + y] = r2(v.hb[y]);
        row['lo_pct ' + y] = isNum(v.lo_pct[y]) ? v.lo_pct[y] : null;
        row['proj ' + y] = null;
      }
      if (kind === 'head') {
        for (const y of Y) if (isNum(v.cost[y]) && isNum(row.proj_pct)) row['proj ' + y] = r2(v.cost[y] * row.proj_pct);
        // A balancing figure: overhead with no cost behind it (the contingency plug).
        row.plug = Y.every((y) => !isNum(v.cost[y])) && Y.some((y) => isNum(v.oh[y]) && v.oh[y] !== 0);
        const zero = Y.every((y) => !v.cost[y]);
        row.rule_cost = zero ? null : costRule(s, L, r);
        row.rule_oh = ohRule(s, L, r);
        // What the first year is built from.
        const f = L.B.cost[Y[0]] ? s.formula(r, L.B.cost[Y[0]]) : null, fv = L.B.cost[Y[0]] ? s.get(r, L.B.cost[Y[0]]) : null;
        const calRefs = f ? refsTo(f, 'Cal.') : [];
        let cs = [];
        if (f && /\[\d+\]/.test(f)) {
          row.src = 'From an outside file (' + f + ')';
          const o = { kind: 'outside', group: null, line: 'Set outside this budget', ref: f, amount: fv, opex_total: null, flags: null };
          for (const y of Y) o['v ' + y] = row['cost ' + y];
          cs = [o];
        } else if (calRefs.length && cal) {
          const cr = calRefs[0].row, lv = cal.get(cr, C ? C.label : 2), lab = typeof lv === 'string' ? clean(lv) : '';
          row.src = /^'?Cal\.'?!\$?[A-Z]+\$?\d+$/.test(f) ? `'Cal.' row ${cr}` + (lab ? ` (${lab})` : '') : `=${f}` + (lab ? ` ('Cal.' row ${cr}: ${lab})` : '');
          if (C && C.assets && cr > C.assets.r) cs = assetComponents(cal, C, Y, cx);
          else if (C && O && /^'?Cal\.'?!\$?[A-Z]+\$?\d+$/.test(f)) cs = calComponents(cal, C, op, O, cr);
        } else if (f == null && isNum(fv) && fv) row.src = 'Typed into the G&A sheet';
        else if (f) row.src = '=' + f;
        cs.forEach((c, i) => {
          if (c.kind === 'opex' || c.kind === 'typed') { c['v ' + Y[0]] = r2(c.amount); }
          comps.push(Object.assign({ key: key + '|' + String(i + 1).padStart(2, '0'), head: key, ord: i + 1 }, c, { amount: r2(c.amount), opex_total: r2(c.opex_total) }));
        });
      }
      byRow[r] = row; lines.push(row); last = row;
    }
    if (last && last.kind === 'subtotal') last.kind = 'total';
    // Project share of subtotals: the same rows the subtotal's overhead formula adds.
    for (const r of labelled) {
      const row = byRow[r];
      if (row.kind !== 'subtotal' && row.kind !== 'total') continue;
      const f = s.formula(r, L.B.oh[Y[0]]);
      if (!f) continue;
      const kids = rowsIn(f).filter((x) => byRow[x] && x !== r);
      for (const y of Y) {
        const vals = kids.map((x) => byRow[x]['proj ' + y]).filter(isNum);
        row['proj ' + y] = vals.length ? r2(vals.reduce((a, b) => a + b, 0)) : null;
      }
    }
    // The cap: 'Allowed' under TOTAL OH.
    const al = find(s, /^allowed$/, L.h.r);
    if (al) {
      const row = { key: 'ga|cap', ord: ++ord, code: null, line: 'Allowed overhead (cap)', kind: 'cap', level: 0, parent: null, note: null, oh_pct: null, proj_pct: null, plug: false, rule_cost: null, rule_oh: null, src: s.formula(al.r, L.B.oh[Y[0]]) ? '=' + s.formula(al.r, L.B.oh[Y[0]]) : null, source: `G&A, row ${al.r}` };
      for (const y of Y) { row['cost ' + y] = null; row['oh ' + y] = r2(s.get(al.r, L.B.oh[y])); row['lo ' + y] = null; row['hb ' + y] = null; row['lo_pct ' + y] = null; row['proj ' + y] = null; }
      lines.push(row);
    }
    ctx.data.ga_components = comps;
    ctx.report.sources.ga_lines = `'G&A' (${s.file})`;
    return lines;
  });
  // The three presentation sheets: OHcost-H+V (Consol), OHcost-H (Landowner), OHcost-V
  // (Homebuilder). The table as laid out there, each head linked to its G&A row, then the
  // rows below it (Landowner / Homebuilder split, cost categories, G&A provision per project).
  const fyOf = (v) => { if (isYear(v)) return v; const m = clean(v).match(/^FY\s*'?(\d{2}|\d{4})$/i); return m ? (m[1].length === 2 ? 2000 + +m[1] : +m[1]) : null; };
  function ohRows(s, ent, link) {
    const h = find(s, /^expense head$/);
    if (!h) throw new Error(`'${s.name}' has no 'Expense Head' column`);
    const cols = {};
    for (const [k, v] of Object.entries(s.row(h.r + 1))) {
      if (lower(v) !== 'amount') continue;
      for (let r = h.r - 1; r >= 1; r--) { const y = fyOf(s.get(r, +k - 1)) || fyOf(s.get(r, +k)); if (y) { cols[y] = +k; break; } }
    }
    const Y = Object.keys(cols).map(Number).sort((a, b) => a - b);
    const out = [], rows = s.rowNums().filter((r) => r > h.r + 1);
    const noteAt = rows.find((r) => /^notes?:?$/i.test(clean(s.get(r, h.c - 1))));
    let ord = 0, project = null, part = 'main', last = null;
    rows.forEach((r, i) => {
      if (noteAt && r >= noteAt) part = 'below';
      const line = clean(s.get(r, h.c)), code = s.get(r, h.c - 1);
      const v = Y.map((y) => s.get(r, cols[y]));
      const any = v.some(isNum);
      if (part === 'below' && !line) {
        // An unlabelled row of ratios belongs to the row above it; other unlabelled rows are checks.
        if (last && any && v.every((x) => !isNum(x) || Math.abs(x) <= 1.5)) Y.forEach((y, j) => { if (isNum(v[j])) last['p ' + y] = v[j]; });
        return;
      }
      if (!line) return;
      const row = { key: `oh|${ent}|${String(++ord).padStart(3, '0')}`, entity: ent, ord, part, code: code == null || part === 'below' ? null : String(code), line, kind: null, level: 0, parent: null, ga: null, source: `${s.name}, row ${r}` };
      if (part === 'main') {
        row.kind = /^sub[\s-]*total/i.test(line) ? 'subtotal' : !isNum(code) && !any ? 'header' : 'head';
        row.level = isNum(code) ? 1 : 0;
        const f = s.formula(r, cols[Y[0]]), gr = f ? refsTo(f, 'G&A')[0] : null;
        row.ga = (gr && link.byRow[gr.row]) || link.byLabel[lower(line)] || null;
      } else {
        const next = rows.slice(i + 1).map((x) => clean(s.get(x, h.c))).find(Boolean) || '';
        if (!any) { row.kind = 'section'; project = null; }
        else if (/^g&a provision$/i.test(next)) { row.kind = /total/i.test(line) ? 'total' : 'project'; project = row.key; }
        else if (project && i > 0 && clean(s.get(rows[i - 1], h.c))) { row.kind = 'child'; row.parent = project; }
        else { row.kind = /^(total|check)/i.test(line) ? 'total' : 'line'; project = null; }
      }
      Y.forEach((y, j) => {
        row['v ' + y] = r2(v[j]);
        const p = s.get(r, cols[y] - 1);
        if (part === 'below' && isNum(p) && Math.abs(p) <= 1.5) row['p ' + y] = p;
      });
      out.push(row); last = row;
    });
    const mainRows = out.filter((x) => x.part === 'main');
    if (mainRows.length) mainRows[mainRows.length - 1].kind = 'total';
    return out;
  }
  X.step('ga_oh', async (ctx) => {
    if (!ctx.fresh('ga_lines')) throw new Error("needs 'G&A'");
    const link = { byRow: {}, byLabel: {} };
    for (const r of ctx.data.ga_lines) { if (r.row) link.byRow[r.row] = r.key; if (r.kind !== 'cap') link.byLabel[lower(r.line)] = link.byLabel[lower(r.line)] || r.key; }
    const out = [];
    for (const ent of ['consol', 'lo', 'hb']) {
      const s = await ctx.sheet('ga_oh_' + ent);
      if (s) out.push(...ohRows(s, ent, link));
    }
    if (!out.length) throw new Error("needs 'OHcost-H+V', 'OHcost-H', 'OHcost-V'");
    return out;
  });

  // Built together with ga_lines; registered so uploads report it as refreshed.
  X.step('ga_components', async (ctx) => {
    if (!ctx.fresh('ga_lines')) throw new Error("needs 'G&A'");
    return ctx.data.ga_components;
  });
})(typeof window !== 'undefined' ? window.SobhaExtract : globalThis.SobhaExtract);
