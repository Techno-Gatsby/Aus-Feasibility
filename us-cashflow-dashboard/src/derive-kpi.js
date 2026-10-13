// derive-kpi: KPI tiles per entity and project (kpi_extra) and the return on equity
// from the executive summary (project_roe). See extract.js for the step API.
(function (X) {
  'use strict';
  const { isNum, num, r2, clean, lower, readSummary } = X.lib;
  const ENTS = ['consol', 'landowner', 'homebuilder'];
  const ALL = 'All Projects';

  // Development cost: the outflows that build the project (land, infra incl. PID
  // processing, construction, design & supervision, authority). Finance, taxes, selling
  // costs, deposits and debt/equity movements are not part of it.
  const DEV_LINE = /^(land purchase|infra|construction|design|authority)/;
  const r1 = (v) => Math.round(v * 10) / 10;
  const NOT_PERIOD = new Set(['key', 'project', 'ord', 'line', 'kind', 'Budget', 'Total']);

  // Per project of a cashflow dataset: units and sales (memo lines), development cost and
  // peak external debt (highest running balance of debt raised less repaid, first period
  // it is reached).
  function cfFigures(rows) {
    const out = {};
    for (const r of rows) {
      const f = (out[r.project] = out[r.project] || { units: 0, sales: 0, dev: 0, debt: {}, out: false });
      const l = lower(r.line);
      if (r.kind === 'header') { f.out = /^outflows/.test(l); continue; }
      if (l === 'sales unit') f.units = Math.round(num(r.Total)); // sum of cent-rounded periods
      else if (l === 'sales') f.sales = num(r.Total);
      else if (f.out && r.kind === 'item' && DEV_LINE.test(l)) f.dev += num(r.Total);
      const sign = /^external debt raised/.test(l) ? 1 : /^external debt repay/.test(l) ? -1 : 0;
      if (sign) for (const [k, v] of Object.entries(r)) if (!NOT_PERIOD.has(k)) f.debt[k] = (f.debt[k] || 0) + sign * num(v);
    }
    for (const f of Object.values(out)) {
      let bal = 0; f.peak = 0; f.peakPeriod = null;
      for (const [p, v] of Object.entries(f.debt)) { bal += v; if (bal > f.peak + 0.005) { f.peak = bal; f.peakPeriod = p; } }
      f.peak = r2(f.peak); f.dev = r2(f.dev);
    }
    return out;
  }

  // Saleable building area per project from the budgeted cost sheet (the column under
  // 'SBA (Sqft)', projects under 'Project Name').
  async function sbaByProject(ctx) {
    const s = await ctx.sheet('budget'), out = {};
    if (!s) return { out };
    for (const r of s.rowNums()) {
      const row = s.row(r), col = (re) => +(Object.keys(row).find((c) => re.test(clean(row[c]))) || 0);
      const pc = col(/^project name$/i), sc = col(/^sba\b/i);
      if (!pc || !sc) continue;
      for (const q of s.rowNums()) {
        const p = clean(s.get(q, pc)), v = s.get(q, sc);
        if (q > r && p && isNum(v) && !(p in out)) out[p] = v;
      }
      break;
    }
    return { s, out };
  }

  X.step('kpi_extra', async (ctx) => {
    const fresh = ENTS.filter((e) => ctx.fresh(e + '_cf'));
    if (!fresh.length) throw new Error('needs the cashflow statements (Projectwise cashflow sheets)');
    // Status and plotted lot area are not in the models: they come from the project profile.
    const profile = {};
    for (const p of ctx.get('project_profile')) profile[p.project] = p;
    const tl = {};
    for (const t of ctx.get('project_timeline')) (tl[t.project] = tl[t.project] || []).push(t);
    const sba = await sbaByProject(ctx);
    const out = [];
    for (const ent of ENTS) {
      if (!fresh.includes(ent)) { out.push(...(ctx.prev.kpi_extra || []).filter((r) => r.entity === ent)); continue; }
      const F = cfFigures(ctx.get(ent + '_cf')), lot = ent === 'landowner';
      // Average size: SBA per home; for the landowner, plotted lot area per lot.
      const area = (p) => { const x = lot ? (profile[p] || {}).plotted_sqft : p in sba.out ? sba.out[p] : (profile[p] || {}).nsa_sqft; return isNum(x) ? x : null; };
      // Start: the first timeline date (land acquisition). Completion: the last lot sale
      // for the landowner, whose part ends with the lots; the last close-out otherwise.
      const dates = (p) => {
        const ts = (tl[p] || []).filter((t) => !lot || t.group === 'land');
        const st = ts.map((t) => t.start).filter(Boolean).sort(), fin = ts.map((t) => t.finish).filter(Boolean).sort();
        return { start: st[0] || null, completion: fin.pop() || null };
      };
      const row = (p, f, extra) => Object.assign({
        key: ent + '|' + p, entity: ent, project: p, units: f.units, sales: r2(f.sales),
        avg_price: f.units ? r2(f.sales / f.units) : null, dev_cost: f.dev, peak_debt: f.peak, peak_debt_period: f.peakPeriod,
        avg_unit_size: f.size, size_basis: lot ? 'lot' : 'home', avg_unit_cost: f.units ? r2(f.dev / f.units) : null,
        start: f.start, completion: f.completion,
      }, extra);
      const rows = [], active = [];
      let areaSum = 0, areaUnits = 0, start = null, completion = null;
      for (const p of Object.keys(F)) {
        if (p === ALL) continue;
        const f = F[p], a = area(p), d = dates(p), status = (profile[p] || {}).status || null;
        rows.push(row(p, Object.assign({}, f, d, { size: f.units && a ? r1(a / f.units) : null }), { status, n_projects: 1 }));
        // Projects with nothing to build or sell in this entity are not counted.
        if (!f.units && !f.dev) continue;
        active.push(lower(status));
        if (a && f.units) { areaSum += a; areaUnits += f.units; }
        if (d.start && (!start || d.start < start)) start = d.start;
        if (d.completion && (!completion || d.completion > completion)) completion = d.completion;
      }
      if (F[ALL]) {
        const n = (re) => active.filter((s) => re.test(s)).length;
        out.push(row(ALL, Object.assign({}, F[ALL], { start, completion, size: areaUnits ? r1(areaSum / areaUnits) : null }), {
          n_projects: active.length, n_confirmed: n(/^confirm/), n_consider: n(/consider/), n_pipeline: n(/pipeline/), status: null,
        }));
      }
      out.push(...rows);
    }
    ctx.report.sources.kpi_extra = fresh.map((e) => ctx.report.sources[e + '_cf']).concat(sba.s ? [`${sba.s.file} › ${sba.s.name}`] : [])
      .filter(Boolean).join('; ') + '; timeline and project profile';
    return out;
  });

  // Return on equity per entity and project from 'Summary val'. A project is listed for an
  // entity only when equity goes into it there (the landowner has no lot-buying projects,
  // the homebuilder nothing in the commercial land).
  X.step('project_roe', async (ctx) => {
    const { s, cols, blocks } = await readSummary(ctx);
    const out = [];
    for (const ent of ['landowner', 'homebuilder', 'consol']) {
      const b = blocks[ent]; if (!b || !b.rows.roe) continue;
      const val = (f, c) => { const x = b.rows[f]; const v = x ? x.row[c] : null; return isNum(v) ? v : null; };
      for (const { c, project } of cols) {
        const eq = val('equity_infused', c);
        if (!eq) continue;
        out.push({
          key: ent + '|' + project, entity: ent, project, revenue: val('revenue', c), equity_infused: eq, roe: val('roe', c),
          source: `Executive Summary (${s.name}), row ${b.rows.roe.r}, column ${XLSXLite.colName(c)}`,
        });
      }
    }
    ctx.report.sources.project_roe = `${s.file} › ${s.name}`;
    return out;
  });
})(typeof window !== 'undefined' ? window.SobhaExtract : globalThis.SobhaExtract);
