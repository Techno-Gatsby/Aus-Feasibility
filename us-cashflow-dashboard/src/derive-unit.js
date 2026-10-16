// derive-unit: unit economics per entity and project (see extract.js for the step API).
//   unit_economics  one row per entity and project: units, areas, sales and the cost build-up,
//                   full life, as amounts; the Unit economics view (unit.js) divides them by
//                   units, area or sales.
// Sources, each model's project budget ('Projections Budgeted cost sheet'):
//   landowner    'HS Budget costs1': acres, home SBA on the lots, lots, lot sales, land, infra,
//                PID processing and reimbursement, real property tax, finance and loan fees;
//   homebuilder  'Cons Budgetd Costs': SBA, homes, home sales, lot cost (bought from the
//                Landowner), construction, design & supervision, authority, finance;
//   consol       'Cons Budgetd Costs new': the same, its land cost being the Landowner's whole
//                budget for the project (split here into land, infra net of PID, and the
//                Landowner's property tax and finance), the acreage from the Landowner budget.
// Brokerage, sales & marketing and the Homebuilder's real property tax come from the per-project
// consolidated P&L (consol_project_pl, full life), so a project's direct cost and gross profit are
// those of its P&L (and of the project cards).
(function (X) {
  'use strict';
  const { isNum, num, r2, clean, lower, concept } = X.lib;

  X.SHEETS.hb_budget = [['homebuilder', 'Cons Budgetd Costs']];

  // Budget columns by header ('SBA\r\n(Sqft)' reads 'sba (sqft)').
  const COLS = [
    ['acres', /^land plot area/], ['sba', /^sba\b/], ['units', /^estimated homes/], ['sales', /^project sale value/],
    ['land', /^land cost/], ['infra', /^infra cost$/], ['pid_processing', /pid.*processing/], ['pid_reimb', /pid reimbursement/],
    ['construction', /^construction cost/], ['dns', /^design .*supervision/], ['authority', /^authority cost/],
    ['rpt', /^real property tax/], ['finance', /^finance cost/], ['loan_fees', /^loan processing/], ['total', /^total budg/],
  ];
  // One row per project under the 'Project Name' header, to the 'Total' row.
  function readBudget(s) {
    let hr = null, H = null;
    for (const r of s.rowNums()) { const row = s.row(r); if (Object.values(row).some((v) => /^project name$/i.test(clean(v)))) { hr = r; H = row; break; } }
    if (!hr) throw new Error(`no 'Project Name' header in '${s.name}'`);
    const col = (re) => { for (const [c, v] of Object.entries(H)) if (typeof v === 'string' && re.test(lower(v))) return +c; return null; };
    const nc = col(/^project name$/), cols = COLS.map(([k, re]) => [k, col(re)]).filter(([, c]) => c != null);
    const out = new Map();
    for (const r of s.rowNums()) {
      if (r <= hr) continue;
      const row = s.row(r), name = clean(row[nc]);
      if (!name) continue;
      if (/^total$/i.test(name)) break;
      const o = { row: r };
      for (const [k, c] of cols) o[k] = isNum(row[c]) ? row[c] : 0;
      if (!out.has(name)) out.set(name, o);
    }
    return { rows: out, has: new Set(cols.map(([k]) => k)) };
  }

  X.step('unit_economics', async (ctx) => {
    const sh = { landowner: await ctx.sheet('landowner_budget'), homebuilder: await ctx.sheet('hb_budget'), consol: await ctx.sheet('consol_budget') };
    if (!sh.landowner && !sh.homebuilder && !sh.consol) throw new Error("needs 'HS Budget costs1', 'Cons Budgetd Costs' or 'Cons Budgetd Costs new'");
    const B = {};
    for (const [ent, s] of Object.entries(sh)) if (s) B[ent] = await ctx.memo('unit:' + ent, async () => readBudget(s));
    // Full-life brokerage, marketing and real property tax per project from its consolidated P&L.
    const pl = ctx.get('consol_project_pl'), plTotal = (p, c) => {
      const r = pl.find((x) => x.project === p && x.kind !== 'header' && concept(x.line) === c);
      return r && isNum(r.Total) ? r.Total : 0;
    };
    const prev = (ctx.prev.unit_economics || []);
    const out = [];
    const order = B.consol ? [...B.consol.rows.keys()] : [...new Set([...(B.homebuilder ? B.homebuilder.rows.keys() : []), ...(B.landowner ? B.landowner.rows.keys() : [])])];
    for (const ent of ['consol', 'landowner', 'homebuilder']) {
      // Without this entity's model, its rows are kept as they were.
      if (!B[ent]) { out.push(...prev.filter((r) => r.entity === ent)); continue; }
      const rows = B[ent].rows, lo = B.landowner ? B.landowner.rows : new Map();
      const names = order.filter((p) => rows.has(p)).concat([...rows.keys()].filter((p) => !order.includes(p)));
      for (const p of names) {
        const b = rows.get(p);
        const o = { key: ent + '|' + p, entity: ent, project: p, units: Math.round(num(b.units)), acres: null, sba: num(b.sba) ? Math.round(b.sba) : null };
        if (ent === 'landowner') {
          Object.assign(o, {
            acres: num(b.acres) ? r2(b.acres) : null, sales: r2(num(b.sales)), land: r2(num(b.land)), infra: r2(num(b.infra)),
            pid_processing: r2(num(b.pid_processing)), pid_reimb: r2(num(b.pid_reimb)), rpt: r2(num(b.rpt)), finance: r2(num(b.finance) + num(b.loan_fees)),
          });
          o.direct = r2(o.land + o.infra + o.pid_processing + o.pid_reimb);
          o.total = r2(o.direct + o.rpt + o.finance);
        } else {
          const brokerage = plTotal(p, 'brokerage'), marketing = plTotal(p, 'marketing');
          Object.assign(o, {
            sales: r2(num(b.sales)), construction: r2(num(b.construction)), dns: r2(num(b.dns)), authority: r2(num(b.authority)),
            brokerage: r2(brokerage), marketing: r2(marketing), finance: r2(num(b.finance)),
            // The budgets leave real property tax blank for the Homebuilder: the P&L's charge.
            rpt: r2(num(b.rpt) || plTotal(p, 'rpt')),
          });
          if (ent === 'homebuilder') o.land = r2(num(b.land));
          else {
            // Consol's land cost is the Landowner's whole budget for the project; split it when the
            // Landowner budget has the project and adds up to it.
            const l = lo.get(p), lt = num(b.land);
            o.lo_total = r2(lt);
            const parts = l ? [num(l.land), num(l.infra) + num(l.pid_processing) + num(l.pid_reimb), num(l.rpt) + num(l.finance) + num(l.loan_fees)] : null;
            if (parts && Math.abs(parts[0] + parts[1] + parts[2] - lt) <= 1) { o.land = r2(parts[0]); o.infra_net = r2(parts[1]); o.lo_other = r2(parts[2]); o.acres = num(l.acres) ? r2(l.acres) : null; }
            else { o.land = r2(lt); o.infra_net = null; o.lo_other = null; }
          }
          const land = ent === 'consol' ? o.lo_total : o.land;
          o.dev = r2(land + o.construction + o.dns + o.authority);
          o.direct = r2(o.dev + o.brokerage);
          o.total = r2(o.direct + o.marketing + o.rpt + o.finance);
        }
        o.gross_profit = r2(o.sales - o.direct);
        o.profit = r2(o.sales - o.total);
        if (!o.units && !o.sales && !o.total) continue;
        o.source = `${sh[ent].file} › ${sh[ent].name}, row ${b.row}` + (ent === 'landowner' ? '' : '; brokerage, marketing, property tax: consol_project_pl');
        out.push(o);
      }
    }
    // The budgets' own totals must be what the rows add up to.
    for (const [ent, s] of Object.entries(sh)) {
      if (!s || !B[ent].has.has('total')) continue;
      const off = [...B[ent].rows.entries()].filter(([, b]) => {
        const sum = ent === 'landowner' ? ['land', 'infra', 'pid_processing', 'pid_reimb', 'rpt', 'finance', 'loan_fees'] : ['land', 'construction', 'dns', 'authority', 'rpt', 'finance'];
        return Math.abs(sum.reduce((t, k) => t + num(b[k]), 0) - num(b.total)) > 1;
      }).map(([p]) => p);
      if (off.length) ctx.report.warnings.push(`unit_economics: '${s.name}' total budgeted cost is not the sum of its columns for ${off.join(', ')}`);
    }
    ctx.report.sources.unit_economics = Object.values(sh).filter(Boolean).map((s) => `${s.file} › ${s.name}`).join('; ') + '; consol_project_pl';
    return out;
  });
})(typeof window !== 'undefined' ? window.SobhaExtract : globalThis.SobhaExtract);
