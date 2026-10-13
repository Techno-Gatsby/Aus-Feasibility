// derive-components: derived datasets (see extract.js for the step API).
(function (X) {
  'use strict';
  const { clean, lower, isNum, num, r2, pad2 } = X.lib;

  // consol_components: the Landowner and Homebuilder cashflow lines each consol cashflow
  // line is made of. In 'Consol Projectwise cash PRT' every such cell is a SUMIFS over the
  // landowner / homebuilder PRT sheets by project and line name; this is that table.
  // Names are spelt as in those formulas and matched case-insensitively, like SUMIFS.
  // Lines not listed (sales, escrow, brokerage, marketing, taxes) are worked out on the
  // consol sheet from its own revenue, so they have no components.
  const L = 'Landowner', H = 'Homebuilder', MINUS = '\u2212'; // U+2212, as the page shows it
  const both = (lo, hb) => [[L, lo], [H, hb || lo]];
  // [entity, line, sign, only on projects without a landowner block]
  const COMPONENTS = {
    'sales unit': [[H, 'Sales unit']],
    'equity infusion': both('Equity infusion'),
    'interest income on bank deposit': both('Interest income on bank deposit'),
    'deposit released': both('Deposit released'),
    'external debt raised': both('External Debt raised'),
    // The homebuilder's land cost counts only on lot-buying projects: elsewhere it buys
    // its lots from our own landowner, which consolidation eliminates.
    'land purchase cost': [
      [L, 'Land purchase cost'], [L, 'Infra cost'], [L, 'INFRA - PID / DEBT - Processing'], [L, 'Infra PID Reimbursement', MINUS],
      [L, 'Real property tax'], [L, 'Internal Finance cost'], [L, 'External Finance (loan processing fees)'],
      [L, 'External Finance cost (processing fees)'], [L, 'External Finance cost'], [H, 'Land purchase cost', '+', true],
    ],
    'construction cost': [[H, 'Construction Cost']],
    'design & supervision cost': [[H, 'Design & Supervision Cost']],
    'authority cost': [[H, 'Authority Cost']],
    'external finance cost (processing fees)': [[H, 'External Finance cost (processing fees)']],
    'external finance cost': [[H, 'External finance cost']],
    'deposit with bank': both('Deposit with bank'),
    'external debt repayment': both('External Debt repayment'),
    'equity release': both('Equity Release', 'Equity release'),
  };

  const META = new Set(['key', 'project', 'ord', 'line', 'kind', 'Budget', 'Total']);
  const periodsOf = (rows) => { const r = rows.find((x) => x.kind !== 'header'); return r ? Object.keys(r).filter((k) => !META.has(k)) : []; };
  // The consol formulas read the same column of the source sheet, whatever its header says:
  // the homebuilder sheet heads its first two columns FY2025 / FY2026 where the consol sheet
  // has Till Aug'26 / Sep-Dec'26. Columns line up from the first period both sheets name.
  function align(src, dst) {
    const i = src.findIndex((p) => dst.includes(p)), off = i < 0 ? 0 : dst.indexOf(src[i]) - i, m = {};
    src.forEach((p, k) => { if (k + off >= 0 && k + off < dst.length) m[p] = k + off; });
    return m;
  }
  // Values of a cashflow dataset by 'project|line' (lower case) in consol periods; repeated
  // lines add up, as in SUMIFS.
  function byLine(rows, P) {
    const m = align(periodsOf(rows), P), out = {};
    for (const r of rows) {
      if (r.kind === 'header' || r.kind === 'balance') continue;
      const k = r.project + '|' + lower(r.line), v = out[k] || (out[k] = P.map(() => 0));
      for (const [p, i] of Object.entries(m)) v[i] += num(r[p]);
    }
    return out;
  }

  // Which mapped consol cells the consol sheet works out itself: a formula that does not read
  // the landowner / homebuilder sheets (e.g. Reserve's equity release plug) or a typed figure.
  // Returns {consol_cf key: [true per such period]}, or {} when the sheet carries no
  // formulas (an older reader, or a copy saved as values): then only figures are compared.
  function ownCells(s, cf, P) {
    if (typeof s.formula !== 'function') return {};
    const L = X.lib.layout(X.lib.headerCols(s, (row) => row[2] === 'Sr.no' || clean(row[3]) === 'Particular'));
    const col = {}; L.periods.forEach((x) => { col[x.label] = x.col; });
    // Sheet row of each consol_cf key, numbered the way readCF numbers them.
    const at = {}, seen = {};
    for (const r of s.rowNums()) {
      const row = s.row(r), p = clean(row[1]);
      if (p && isNum(row[2]) && clean(row[3])) at[p + '|' + pad2((seen[p] = (seen[p] || 0) + 1))] = r;
    }
    const names = ['landowner_cf', 'homebuilder_cf'].flatMap((k) => X.SHEETS[k].map((x) => lower(x[1])));
    const out = {}; let reads = false;
    for (const c of cf) {
      const r = at[c.key];
      if (!COMPONENTS[lower(c.line)] || !r || lower(s.get(r, 3)) !== lower(c.line)) continue;
      out[c.key] = P.map((p) => {
        if (col[p] == null) return false;
        const f = s.formula(r, col[p]);
        if (f && names.some((n) => lower(f).includes(n))) { reads = true; return false; }
        return f !== ''; // '' = a formula that could not be read: leave it to the figures
      });
    }
    return reads ? out : {};
  }

  X.step('consol_components', async (ctx) => {
    const src = [];
    let s = null;
    for (const k of ['consol_cf', 'landowner_cf', 'homebuilder_cf']) {
      const x = await ctx.need(k);
      if (!ctx.fresh(k)) throw new Error(`${k} could not be read from ${x.file}`);
      src.push(`${x.file} › ${x.name}`); s = s || x;
    }
    const cf = ctx.get('consol_cf'), P = periodsOf(cf), own = ownCells(s, cf, P);
    const vals = { [L]: byLine(ctx.get('landowner_cf'), P), [H]: byLine(ctx.get('homebuilder_cf'), P) };
    const hasLand = new Set(ctx.get('landowner_cf').map((r) => r.project));
    const put = (o, v) => { let t = 0; P.forEach((p, i) => { o[p] = v[i]; t += v[i]; }); o.Total = r2(t); return o; };
    const out = [], odd = [];
    for (const c of cf) {
      const map = COMPONENTS[lower(c.line)];
      if (!map || c.project === 'All Projects') continue;
      // In a period the consol sheet works out itself the components add nothing.
      const mine = own[c.key] || P.map(() => false);
      const left = P.map((p, i) => (mine[i] ? 0 : num(c[p])));
      for (const [ent, line, sign, lotsOnly] of map) {
        const v = vals[ent][c.project + '|' + lower(line)];
        if (!v || (lotsOnly && hasLand.has(c.project))) continue;
        const w = v.map((x, i) => (mine[i] ? 0 : r2(sign === MINUS ? -x : x)));
        w.forEach((x, i) => { left[i] -= x; });
        if (w.some((x) => x)) out.push(put({ key: [c.project, c.line, ent, line].join('|'), project: c.project, consol_line: c.line, entity: ent, component: line, sign: sign || '+' }, w));
      }
      // Override: those periods' consol figures, plus whatever the components do not explain
      // elsewhere (typed over, or uploaded Landowner / Homebuilder models that differ from
      // the copies inside the consol model).
      const gap = left.map((x) => (Math.abs(x) < 0.5 ? 0 : r2(x)));
      const adj = gap.map((x, i) => (mine[i] ? r2(num(c[P[i]])) : x));
      if (gap.some((x) => x)) odd.push(`${c.project} › ${c.line}`);
      if (adj.some((x) => x)) out.push(put({ key: [c.project, c.line, 'Consol', 'Adjustment'].join('|'), project: c.project, consol_line: c.line, entity: 'Consol', component: 'Consol-sheet override', sign: '+' }, adj));
    }
    if (odd.length) ctx.report.warnings.push(`consol_components: ${odd.length} consol line(s) not fully explained by their Landowner and Homebuilder lines, shown as 'Consol-sheet override': ${odd.slice(0, 5).join('; ')}${odd.length > 5 ? ' …' : ''}`);
    ctx.report.sources.consol_components = src.join(' + ');
    return out;
  });
})(typeof window !== 'undefined' ? window.SobhaExtract : globalThis.SobhaExtract);
