// derive-details: the 'Project details' panel (see extract.js for the step API).
//   project_profile  one row per project: development and finance metrics
//   project_entity   one row per project and entity: milestones, returns, equity schedule
//   project_sales    sales value and units per project, entity and calendar year
// These were first typed in from the Executive Report PDF. Everything the workbooks hold is
// rebuilt from them; the report's own wording (report_name, location, status, note) and the
// plotted area (not in any workbook) are kept from the previous data by project.
(function (X) {
  'use strict';
  const { isNum, num, r2, clean, lower, iso, headerCols, layout, readCF, readSummary, timelineMatch, concept } = X.lib;

  // The models' own cashflow sheets (not the PRT presentation copies) for the equity schedule:
  // their infusions add up to 'Summary val' › Total Equity infused, as in the report.
  X.SHEETS.landowner_cf_own = [['landowner', 'landowner Projectwise cashflow']];
  X.SHEETS.homebuilder_cf_own = [['homebuilder', 'Homebuilde Projectwise cashflow'], ['consol', 'Homebuilde Projectwise cashflow']];
  // Budget sheets: one row per project with its 'Equity release' date.
  X.SHEETS.landowner_budget = [['landowner', 'HS Budget costs1']];

  const ENTS = [['landowner', 'Landowner'], ['homebuilder', 'Homebuilder']];
  const SQFT_PER_ACRE = 43560;
  const EQ_YEARS = 5; // equity schedule: 'Till Dec'<cutoff>' then at least this many calendar years
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mon = (d) => (d ? MON[+d.slice(5, 7) - 1] + "'" + d.slice(2, 4) : null);
  const round = (v, dp) => (v == null ? null : Math.round(v * 10 ** dp) / 10 ** dp);
  const mn = (v, dp = 2) => (isNum(v) && v ? round(v / 1e6, dp) : null); // $ -> $Mn, 0 -> blank
  const nz = (v) => (isNum(v) && v ? v : null);
  // Calendar year a cashflow period ends in: 'FY2027' -> 2027, "Till Aug'26" / "Sep-Dec'26" -> 2026.
  const periodYear = (p) => { const m = p.match(/^FY(\d{4})$/) || p.match(/'(\d{2})$/); return m ? (m[1].length === 2 ? 2000 + +m[1] : +m[1]) : null; };
  const prevBy = (ctx, ds, key) => { const m = {}; for (const r of ctx.prev[ds] || []) m[key(r)] = r; return m; };
  // Input-sheet rows per project, or null when the BP Input Sheets are not uploaded.
  const timeline = (ctx) => timelineMatch(ctx).then((x) => x.match, (e) => { if (/^needs /.test(e.message)) return null; throw e; });

  // 'Summary val' as val(entity, project, field): the shared reader's fields plus two rows it
  // does not keep ('Land costs', 'Infra & PID reimbursement'). Blocks: landowner, homebuilder, consol.
  const EXTRA = [[/^land costs?$/, 'land'], [/^infra/, 'infra']];
  async function summary(ctx) {
    return ctx.memo('details:summary', async () => {
      const sv = await readSummary(ctx), extra = {};
      let ent = null;
      for (const r of sv.s.rowNums()) {
        const row = sv.s.row(r), b = lower(row[2]);
        if (/:$/.test(b)) { ent = /^land/.test(b) ? 'landowner' : /^homebuilder/.test(b) ? 'homebuilder' : /^consolidated/.test(b) ? 'consol' : null; if (ent) extra[ent] = {}; continue; }
        if (!ent) continue;
        for (const [re, f] of EXTRA) if (re.test(b) && !extra[ent][f]) extra[ent][f] = row;
      }
      const val = (ent, project, f) => {
        const c = (sv.cols.find((x) => x.project === project) || {}).c;
        const b = sv.blocks[ent], x = b && b.rows[f] ? b.rows[f].row : extra[ent] && extra[ent][f];
        return c && x && isNum(x[c]) ? x[c] : null;
      };
      return { sv, val, projects: sv.cols.map((x) => x.project).filter((p) => p !== 'All Projects') };
    });
  }

  // Equity release date per project from a budget sheet: the header row names 'Project Name'
  // and 'Equity release'. Returns {project: 'YYYY-MM-DD'}.
  function releaseDates(s) {
    const out = {};
    let pc = null, ec = null;
    for (const r of s.rowNums()) {
      const row = s.row(r);
      if (pc == null) {
        for (const [c, v] of Object.entries(row)) { if (/^project name$/.test(lower(v))) pc = +c; if (/^equity release$/.test(lower(v))) ec = +c; }
        if (pc == null || ec == null) pc = ec = null;
        continue;
      }
      const p = clean(row[pc]), d = iso(row[ec]);
      if (p && d && d > '1900-12-31' && !(p in out)) out[p] = d;
    }
    return out;
  }

  // Milestones from the input-sheet rows of a project (one per phase): the earliest start and
  // the latest finish across phases. Landowner: land received, lots sold, infra done, last lot
  // sold. Homebuilder: lots (or, lot-buying, land) received, home sales, vertical done, close-out.
  function milestones(rows, ent) {
    const pick = (re, f, last) => {
      const v = rows.map((x) => (x.acts.find((a) => re.test(a.activity)) || {})[f]).filter(Boolean).sort();
      return v.length ? v[last ? v.length - 1 : 0] : null;
    };
    const lot = rows.some((x) => x.lotBuying);
    const m = ent === 'landowner'
      ? { land: pick(/^land/i, 'finish'), sales: pick(/^lot/i, 'start'), dev: pick(/^horizontal/i, 'finish', 1), hand: pick(/^lot/i, 'finish', 1) }
      : { land: lot ? pick(/^land/i, 'finish') : pick(/^lot/i, 'start') || pick(/^vertical/i, 'start'), sales: pick(/^home/i, 'start'), dev: pick(/^vertical/i, 'finish', 1), hand: pick(/^close/i, 'start', 1) };
    const from = ent === 'landowner' ? m.land : pick(/^vertical/i, 'start');
    const tbd = (d) => mon(d) || 'TBD';
    return {
      timeline: from && m.hand ? mon(from) + ' – ' + mon(m.hand) : 'TBD',
      land_parcel_receipt: tbd(m.land), sales_commencement: tbd(m.sales), development_completion: tbd(m.dev), hand_over: tbd(m.hand),
    };
  }
  const MILESTONES = ['timeline', 'land_parcel_receipt', 'sales_commencement', 'development_completion', 'hand_over'];

  // The model's own cashflow per entity (falls back to the PRT dataset), memoised.
  async function ownCF(ctx, ent) {
    return ctx.memo('details:cf:' + ent, async () => {
      const s = await ctx.sheet(ent + '_cf_own');
      if (s) { const cf = readCF(s); return { rows: cf.rows, periods: cf.periods, src: `${s.file} › ${s.name}` }; }
      const rows = ctx.get(ent + '_cf'), periods = rows.length ? Object.keys(rows[0]).filter(periodYear) : [];
      return { rows, periods, src: ent + '_cf' };
    });
  }

  // ---- project_profile ---------------------------------------------------------------
  X.step('project_profile', async (ctx) => {
    const { sv, val, projects } = await summary(ctx);
    const tl = await timeline(ctx);
    const prev = prevBy(ctx, 'project_profile', (r) => r.project);
    const pl = ctx.get('consol_project_pl');
    const sum = (rows, f) => { const v = rows.map((x) => x[f]).filter(isNum); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
    const out = [];
    for (const p of projects) {
      const old = prev[p] || {}, rows = tl ? tl[p] || [] : null;
      const rev = nz(val('consol', p, 'revenue'));
      // Without a revenue plan (e.g. land held for later) the report shows no P&L figures.
      const pnl = (v, dp) => (rev ? mn(v, dp) : null);
      const acres = rows ? sum(rows, 'acres') : old.acreage, units = rows ? sum(rows, 'units') : old.units;
      const sba = rows ? sum(rows, 'sba') : old.nsa_sqft;
      const plotted = old.plotted_sqft != null ? old.plotted_sqft : null;
      const tdc = pl.find((r) => r.project === p && r.kind !== 'header' && concept(r.line) === 'totaldirect');
      const land = nz(val('landowner', p, 'land')) || val('homebuilder', p, 'land');
      // The consolidated column is blank for a project without returns (land held for later).
      const eq = nz(val('consol', p, 'equity_infused')) || num(val('landowner', p, 'equity_infused')) + num(val('homebuilder', p, 'equity_infused'));
      const irr = val('consol', p, 'irr_pre');
      out.push({
        project: p,
        report_name: old.report_name != null ? old.report_name : clean(p.replace(/\s*[@(].*$/, '')),
        location: old.location != null ? old.location : (rows && rows[0] && rows[0].location) || '',
        status: old.status != null ? old.status : '',
        acreage: acres ? r2(acres) : null, units: units || null, nsa_sqft: sba ? Math.round(sba) : null,
        plotted_sqft: plotted,
        plotting_eff: plotted && acres ? round(plotted / (acres * SQFT_PER_ACRE), 4) : null,
        avg_home_sqft: sba && units ? Math.round(sba / units) : null,
        gross_revenue_m: pnl(rev), npat_m: pnl(val('consol', p, 'net_profit')), gross_profit_m: pnl(val('consol', p, 'gross_profit')),
        equity_required_m: mn(eq),
        avg_home_price_m: rev && units ? mn(rev / units) : null,
        pretax_irr: rev && isNum(irr) && irr ? round(irr, 3) : null,
        land_cost_m: pnl(land), infra_cost_m: pnl(val('landowner', p, 'infra')),
        total_direct_cost_m: pnl(tdc ? tdc.Total : num(rev) - num(val('consol', p, 'gross_profit'))),
        note: old.note != null ? old.note : '',
      });
    }
    ctx.report.sources.project_profile = `${sv.s.file} › ${sv.s.name}` + (tl ? ', Timeline Assumptions' : '') + ', consol_project_pl';
    return out;
  });

  // ---- project_entity ----------------------------------------------------------------
  X.step('project_entity', async (ctx) => {
    const { sv, val, projects } = await summary(ctx);
    const tl = await timeline(ctx);
    const prev = prevBy(ctx, 'project_entity', (r) => r.key);
    // Without a budget sheet the release month is kept from the previous data.
    const rel = { landowner: await ctx.sheet('landowner_budget'), homebuilder: await ctx.sheet('budget') };
    for (const ent in rel) rel[ent] = rel[ent] && releaseDates(rel[ent]);
    const cf = { landowner: await ownCF(ctx, 'landowner'), homebuilder: await ownCF(ctx, 'homebuilder') };
    // Schedule columns: everything up to the end of the landowner model's stub periods
    // ("Till Aug'26", "Sep-Dec'26"), then calendar years.
    if (!cf.landowner.periods.length) throw new Error('no landowner cashflow periods');
    const stub = cf.landowner.periods.filter((p) => !/^FY/.test(p)).map(periodYear);
    const cut = stub.length ? Math.max(...stub) : Math.min(...cf.landowner.periods.map(periodYear)) - 1;
    // Years run on to the last one in which any project infuses or releases equity, so a model
    // with more years loses none of it.
    let last = cut + EQ_YEARS;
    for (const ent of ['landowner', 'homebuilder']) for (const r of cf[ent].rows) {
      if (/^equity (infusion|release)$/i.test(r.line)) for (const k of cf[ent].periods) if (Math.abs(num(r[k])) >= 0.5) last = Math.max(last, periodYear(k));
    }
    const cols = [{ key: "equity Till Dec'" + String(cut).slice(2), test: (y) => y <= cut }];
    for (let y = cut + 1; y <= last; y++) cols.push({ key: 'equity FY' + y, test: (x) => x === y });

    const out = [];
    for (const p of projects) {
      for (const [ent, label] of ENTS) {
        const rev = nz(val(ent, p, 'revenue')), eq = nz(val(ent, p, 'equity_infused'));
        if (!rev && !eq) continue;
        const key = p + '|' + label, old = prev[key] || {};
        const o = { key, project: p, entity: label };
        const ms = tl ? milestones(tl[p] || [], ent) : null;
        for (const f of MILESTONES) o[f] = ms ? ms[f] : old[f] != null ? old[f] : 'TBD';
        o.net_revenue_m = mn(rev, 1);
        const ratio = (f) => (rev && isNum(val(ent, p, f)) ? round(val(ent, p, f), 3) : null);
        o.pretax_irr = ratio('irr_pre'); o.gp_margin = ratio('gp_pct'); o.net_margin = ratio('np_pct');
        o.equity_required_m = mn(eq);
        // Equity schedule ($Mn): infusions by year from the cashflow, less the equity released.
        // The release is shown as equity returned plus net profit (Summary val), in the year(s)
        // the cashflow releases it.
        const line = (re) => cf[ent].rows.find((r) => r.project === p && re.test(r.line));
        const inf = line(/^equity infusion$/i), rls = line(/^equity release$/i);
        const relTot = rls ? cf[ent].periods.reduce((s, k) => s + num(rls[k]), 0) : 0;
        const back = num(eq) + num(val(ent, p, 'net_profit'));
        const net = cols.map(() => 0);
        let funding = 0;
        for (const k of cf[ent].periods) {
          const i = cols.findIndex((c) => c.test(periodYear(k)));
          if (i < 0) continue;
          const r = relTot ? (num(rls[k]) / relTot) * back : 0;
          net[i] += num(inf && inf[k]) - r; funding -= r;
        }
        o.revenue_funding_m = mn(funding);
        o.equity_release = rel[ent] ? mon(rel[ent][p]) : old.equity_release || null;
        cols.forEach((c, i) => { o[c.key] = mn(net[i]); });
        out.push(o);
      }
    }
    ctx.report.sources.project_entity = `${sv.s.file} › ${sv.s.name}, ${cf.landowner.src}, ${cf.homebuilder.src}` + (tl ? ', Timeline Assumptions' : '');
    return out;
  });

  // ---- project_sales -----------------------------------------------------------------
  // The cashflow 'Sales' and 'Sales unit' lines by calendar year (the landowner's stub periods
  // fall into their year), units rounded to whole homes/lots.
  // 'Sales unit' as saved in the cashflow sheet: the datasets hold it to 2 dp, and 72.4989
  // must round to 72, not (via 72.50) to 73. {project: {period: units}}.
  function rawUnits(s) {
    const L = layout(headerCols(s, (row) => row[2] === 'Sr.no' || clean(row[3]) === 'Particular')), out = {};
    for (const r of s.rowNums()) {
      const row = s.row(r), p = clean(row[1]);
      if (p && lower(row[3]) === 'sales unit' && !out[p]) { out[p] = {}; for (const { col, label } of L.periods) out[p][label] = num(row[col]); }
    }
    return out;
  }
  X.step('project_sales', async (ctx) => {
    const out = [];
    let any = false;
    for (const [ent, label] of ENTS) {
      const s = await ctx.sheet(ent + '_cf');
      if (s) any = true;
      const rows = ctx.get(ent + '_cf'), raw = s ? await ctx.memo('details:units:' + ent, async () => rawUnits(s)) : {};
      const periods = rows.length ? Object.keys(rows[0]).filter(periodYear) : [];
      for (const p of [...new Set(rows.map((r) => r.project))]) {
        if (p === 'All Projects') continue;
        const line = (re) => rows.find((r) => r.project === p && re.test(r.line));
        const sv = line(/^sales$/i), su = line(/^sales unit$/i);
        if (!sv) continue;
        const by = {};
        for (const k of periods) {
          const y = periodYear(k), b = (by[y] = by[y] || { v: 0, u: 0 });
          b.v += num(sv[k]); b.u += raw[p] ? raw[p][k] || 0 : num(su && su[k]);
        }
        for (const [y, b] of Object.entries(by)) {
          if (mn(b.v, 1)) out.push({ key: `${p}|${label}|${y}`, project: p, entity: label, year: +y, sales_value_m: mn(b.v, 1), units: Math.round(b.u) });
        }
      }
    }
    if (!any) throw new Error("needs 'landowner Projectwise cashf PRT' or 'Homebuilde Projectwise cash PRT'");
    ctx.report.sources.project_sales = 'landowner_cf, homebuilder_cf (Sales, Sales unit)';
    return out;
  });
})(typeof window !== 'undefined' ? window.SobhaExtract : globalThis.SobhaExtract);
