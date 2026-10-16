// derive-consol-pl: derived datasets (see extract.js for the step API).
//   consol_project_pl  per-project consolidated P&L (project panel), FY2026 to the last cashflow year
//   consol_pl          'Cons P&L' with each line split into projects and 'Corporate level & differences'
// The consol model only has project P&L blocks for a few projects and only to FY 33, so the
// project P&L is rebuilt the way those blocks are calculated:
// - revenue: the cashflow's 'Revenue' line (recognised on handover, a year after 'Sales');
// - land, construction, D&S, authority and finance costs: the project budget ('Cons Budgetd Costs
//   new'), brokerage and marketing: the cashflow totals; all spread over the years by revenue;
// - real property tax: 'RPT transfer to Cost of revenue' by year ('Real property tax V2 - updated');
//   what is still deferred after its last year is spread over the later revenue years;
// - finance income: the cashflow's 'Interest income on bank deposit' in the year it is earned
//   (as in the Executive Report's project P&L pages);
// - franchise tax on gross profit and corporate tax on profit before tax, at the rates in 'Cons Assumption'.
(function (X) {
  'use strict';
  const { num, r2, clean, lower, periodLabel, readCF, readPLBlocks, topLines, plChildren, concept, nameKey, CORP } = X.lib;

  // Consolidated figures only: the Homebuilder model's budget sheet has its own (intercompany) land cost.
  X.SHEETS.consol_budget = [['consol', 'Cons Budgetd Costs new']];
  X.SHEETS.consol_rpt = [['consol', 'Real property tax V2 - updated']];
  X.SHEETS.consol_assumptions = [['consol', 'Cons Assumption']];

  // [concept, line, kind]: the layout of a project P&L. The concepts also place each line under
  // the matching 'Cons P&L' line (extract.js CONCEPTS), so the names must keep matching those.
  const LINES = [
    ['revenue', 'Total Revenue', 'total'], [null, 'Direct costs', 'header'],
    ['land', 'Land costs', 'item'], ['construction', 'Construction costs', 'item'],
    ['dns', 'Design & Supervision costs', 'item'], ['authority', 'Authority costs', 'item'],
    ['brokerage', 'Brokerage costs', 'item'], ['totaldirect', 'Total direct costs', 'total'],
    ['gp', 'Gross Profit', 'total'], [null, 'Indirect costs', 'header'],
    ['marketing', 'Marketing & Selling Expenses (2%)', 'item'], ['rpt', 'Real property tax', 'item'],
    ['finance', 'Finance costs', 'item'], ['interest', 'Finance income', 'item'], ['franchise', 'Franchise tax', 'item'],
    ['toverhead', 'Total overheads', 'total'], ['npbt', 'Net Profit before tax', 'total'],
    ['corptax', 'Corporate tax', 'total'], ['npat', 'Net Profit after tax', 'total'],
  ];
  // Subtotals 'Cons P&L' shows that the project layout leaves out.
  const EXTRA = [['netfinance', 'Total Net Finance costs'], ['statetax', 'Total State taxes']];
  const BUDGET = [['land', /^land cost/], ['construction', /^construction cost/], ['dns', /^design .*supervision/], ['authority', /^authority cost/], ['finance', /^finance cost/]];
  const CF_TOTALS = [['brokerage', /^brokerage$/], ['marketing', /^sales & marketing/]];

  // Cashflow periods to P&L years: "Till Aug'26" and "Sep-Dec'26" are both FY2026.
  const fyOf = (p) => { const m = String(p).match(/^FY(\d{4})$/) || String(p).match(/'(\d{2})$/); return m ? 'FY' + (m[1].length === 2 ? '20' + m[1] : m[1]) : null; };
  // Same project in another sheet: exact name, else the short key used for the timeline.
  const finder = (names) => { const m = new Map(), k = new Map(); for (const n of names) { m.set(lower(n), n); if (!k.has(nameKey(n))) k.set(nameKey(n), n); } return (p) => m.get(lower(p)) || k.get(nameKey(p)); };

  // Project budget: one row per project under the 'Project Name' header.
  function readBudget(s) {
    let hr = null, H = null;
    for (const r of s.rowNums()) { const row = s.row(r); if (Object.values(row).some((v) => /^project name$/i.test(clean(v)))) { hr = r; H = row; break; } }
    if (!hr) throw new Error(`no 'Project Name' header in '${s.name}'`);
    const col = (re) => { for (const [c, v] of Object.entries(H)) if (re.test(lower(v))) return +c; return null; };
    const nc = col(/^project name$/), cols = BUDGET.map(([k, re]) => [k, col(re)]);
    const out = {};
    for (const r of s.rowNums()) {
      if (r <= hr) continue;
      const row = s.row(r), name = clean(row[nc]);
      if (!name) continue;
      if (/^total$/i.test(name)) break;
      out[name] = {};
      for (const [k, c] of cols) out[name][k] = c ? num(row[c]) : 0;
    }
    return out;
  }

  // Real property tax charged to P&L by year, and what is still deferred at the end of the table.
  function readRPT(s) {
    for (const r of s.rowNums()) {
      const row = s.row(r);
      const tc = Object.keys(row).map(Number).filter((c) => /^rpt transfer to cost of revenue$/i.test(clean(row[c])));
      if (!tc.length) continue;
      const above = s.row(r - 1), nc = +(Object.entries(row).find(([, v]) => /^particulars$/i.test(clean(v))) || [2])[0];
      const years = tc.map((c) => ({ c, fy: periodLabel(above[c]) })).filter((x) => x.fy);
      const closing = Object.keys(row).map(Number).filter((c) => /^closing balance$/i.test(clean(row[c]))).sort((a, b) => a - b).pop();
      const out = {};
      for (const q of s.rowNums().filter((q) => q > r)) {
        const x = s.row(q), name = clean(x[nc]);
        if (!name) continue;
        if (/^total$/i.test(name)) break;
        const o = { byYear: {}, deferred: closing ? num(x[closing]) : 0 };
        for (const { c, fy } of years) o.byYear[fy] = (o.byYear[fy] || 0) + num(x[c]);
        out[name] = o;
      }
      return { years: years.map((x) => x.fy), projects: out };
    }
    throw new Error(`no 'RPT transfer to Cost of revenue' columns in '${s.name}'`);
  }

  // Tax rates as stated in the assumptions ('… Franchise tax … 0.75% of gross margin', 'Corporate tax … 21%').
  function readRates(s) {
    const rates = { franchise: 0.0075, corptax: 0.21 };
    if (!s) return rates;
    for (const r of s.rowNums()) for (const v of Object.values(s.row(r))) {
      if (typeof v !== 'string') continue;
      const f = v.match(/franchise tax[^%]*?(\d+(?:\.\d+)?)\s*%/i), t = v.match(/corporate tax[^%]*?(\d+(?:\.\d+)?)\s*%/i);
      if (f) rates.franchise = f[1] / 100;
      if (t) rates.corptax = t[1] / 100;
    }
    return rates;
  }

  async function projectPL(ctx) {
    return ctx.memo('consol_project_pl', async () => {
      const cs = await ctx.need('consol_cf'), bs = await ctx.need('consol_budget'), rs = await ctx.need('consol_rpt');
      const cf = await ctx.memo('cf:consol', async () => readCF(cs));
      const budget = readBudget(bs), rpt = readRPT(rs), rates = readRates(await ctx.sheet('consol_assumptions'));
      const years = [...new Set(cf.periods.map(fyOf).filter(Boolean))];
      const bOf = finder(Object.keys(budget)), rOf = finder(Object.keys(rpt.projects));
      const lastRpt = rpt.years[rpt.years.length - 1];
      const out = [], missing = [];
      for (const p of [...new Set(cf.rows.map((r) => r.project))]) {
        if (p === 'All Projects') continue;
        const line = (re) => cf.rows.find((r) => r.project === p && re.test(lower(r.line)));
        const revLine = line(/^revenue$/);
        if (!revLine) continue;
        const rev = {}, intr = {}; for (const y of years) rev[y] = intr[y] = 0;
        const intLine = line(/^interest income/);
        for (const per of cf.periods) { rev[fyOf(per)] += num(revLine[per]); intr[fyOf(per)] += intLine ? num(intLine[per]) : 0; }
        const total = years.reduce((s, y) => s + rev[y], 0);
        if (Math.abs(total) < 0.5) continue; // no sales, no P&L (e.g. land held for later)
        const b = budget[bOf(p)], t = rpt.projects[rOf(p)];
        if (!b || !t) missing.push(p);
        // Totals spread over the years by revenue.
        const tot = Object.assign({ land: 0, construction: 0, dns: 0, authority: 0, finance: 0 }, b);
        for (const [k, re] of CF_TOTALS) { const l = line(re); tot[k] = l ? num(l.Total) : 0; }
        const later = years.filter((y) => lastRpt && y > lastRpt), laterRev = later.reduce((s, y) => s + rev[y], 0);
        const v = {};
        for (const y of years) {
          const share = rev[y] / total, o = (v[y] = { revenue: rev[y] });
          for (const k of ['land', 'construction', 'dns', 'authority', 'brokerage', 'marketing', 'finance']) o[k] = tot[k] * share;
          o.rpt = !t ? 0 : later.includes(y) ? (laterRev ? t.deferred * rev[y] / laterRev : 0) : num(t.byYear[y]);
          o.totaldirect = o.land + o.construction + o.dns + o.authority + o.brokerage;
          o.gp = o.revenue - o.totaldirect;
          o.franchise = o.gp * rates.franchise;
          o.interest = -intr[y];
          o.netfinance = o.finance + o.interest;
          o.statetax = o.rpt + o.franchise;
          o.toverhead = o.marketing + o.rpt + o.finance + o.interest + o.franchise;
          o.npbt = o.gp - o.toverhead;
          o.corptax = o.npbt * rates.corptax;
          o.npat = o.npbt - o.corptax;
        }
        out.push({ project: p, years, v });
      }
      if (missing.length) ctx.report.warnings.push(`consol_project_pl: no budget or real property tax row for ${missing.join(', ')}; those costs are taken as 0`);
      ctx.report.sources.consol_project_pl = `${cs.file} › ${cs.name}, ${bs.name}, ${rs.name}`;
      return out;
    });
  }

  X.step('consol_project_pl', async (ctx) => {
    const out = [];
    for (const { project, years, v } of await projectPL(ctx)) {
      LINES.forEach(([k, line, kind], i) => {
        const o = { key: project + '|' + String(i + 1).padStart(2, '0'), project, line, kind };
        let sum = 0;
        for (const y of years) { o[y] = k ? r2(v[y][k]) : null; sum += k ? v[y][k] : 0; }
        o.Total = k ? r2(sum) : null;
        out.push(o);
      });
    }
    return out;
  });

  // 'Cons P&L': the statement as the sheet has it; the project rows come from the project P&L
  // above (cut to the statement's years) and the corporate rows hold the rest (overheads,
  // finance income, timing differences) on the lines that have project rows.
  X.step('consol_pl', async (ctx) => {
    const s = await ctx.need('consol_pl');
    const { blocks, periods } = readPLBlocks(s, { labelCol: 2 });
    if (!blocks[0] || !blocks[0].lines.length) throw new Error(`no P&L found in '${s.name}'`);
    const top = topLines(blocks[0].lines, periods);
    const projects = (await projectPL(ctx)).map(({ project, v }) => ({
      project,
      lines: LINES.filter(([k]) => k).concat(EXTRA).map(([k, label]) => {
        const vals = {}; for (const p of periods) vals[p] = v[p] ? v[p][k] : 0;
        return { label, vals, total: null, hasNums: true };
      }),
    }));
    ctx.report.sources.consol_pl = `${s.file} › ${s.name}`;
    // Each line followed by its project and corporate rows.
    const kids = plChildren(top, projects, periods, { corporateOnlyWithKids: true });
    // Revenue and direct costs are all project figures, so a corporate difference there means the
    // project P&L above no longer follows the model.
    const off = kids.filter((k) => k.project === CORP && ['revenue', 'totaldirect'].includes(concept(k.line))).map((k) => k.line);
    if (off.length) ctx.report.warnings.push(`consol_pl: the project P&Ls do not add up to '${s.name}' on ${off.join(', ')}`);
    return top.flatMap((t) => [t, ...kids.filter((k) => k.parent === t.key)]);
  });
})(typeof window !== 'undefined' ? window.SobhaExtract : globalThis.SobhaExtract);
