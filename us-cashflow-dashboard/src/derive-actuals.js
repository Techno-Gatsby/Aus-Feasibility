// derive-actuals: derived datasets (see extract.js for the step API).
//   actuals_plan  the plan (business-plan) side of the Actuals tab: every line of the six
//                 statements with the role app.js gives it (evalActuals): typed in ('input'),
//                 summed over projects ('sumifs'), a signed sum of lines ('expr', rule = JSON
//                 [[sign, line]]), a section total ('sec', rule = its section header), a header,
//                 or an opening / closing (escrow) balance carried from year to year.
// Years are the app's: "Till Dec'YY" holds everything up to the end of the model's current
// year (Till Aug + Sep-Dec, or FY2025 + FY2026, or the P&L's FY 26), then one column per FY.
(function (X) {
  'use strict';
  const { num, r2, pad2, lower, concept, readSummaryPL, CORP } = X.lib;


  const ALL = 'All Projects';
  const CFS = ['consol_cf', 'landowner_cf', 'homebuilder_cf'], PLS = ['consol_pl', 'landowner_pl', 'homebuilder_pl'];
  // app.js finds lines by trimmed lower-case text.
  const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
  // "Till Aug'26", "Sep-Dec'26" -> 2026; 'FY2027' -> 2027; anything else -> null.
  const yearOf = (p) => { const m = String(p).match(/^FY(\d{4})$/) || String(p).match(/^(?:Till [A-Za-z]{3}|[A-Za-z]{3}-[A-Za-z]{3})'(\d{2})$/); return m ? +(m[1].length === 2 ? '20' + m[1] : m[1]) : null; };
  const periodKeys = (rows) => [...new Set(rows.flatMap((r) => Object.keys(r).filter((k) => yearOf(k) != null)))];

  // ---- formulas of P&L totals ------------------------------------------------------
  // What each total adds up, by concept (extract.js CONCEPTS); '-' subtracts.
  const TOTALS = {
    totaldirect: ['land', 'infra', 'otherdirect', 'construction', 'dns', 'authority', 'brokerage'],
    gp: ['revenue', '-totaldirect'],
    tgo: ['legal', 'gna', 'staff'],
    netfinance: ['finance', 'interest'],
    statetax: ['rpt', 'franchise'],
    toverhead: ['tgo', 'marketing', 'netfinance', 'statetax'],
    npbt: ['gp', '-toverhead'],
    npat: ['npbt', '-corptax'],
  };
  // Rules for the totals among `rows` ({line, c}). A missing subtotal is replaced by the parts
  // of it the rows have. A line item a total adds directly but the rows lack is taken from
  // `parent` (the statement lines the rows hang under), so a project's total direct costs
  // still lists every direct-cost line of the statement. Terms in line order.
  function deriveRules(rows, parent) {
    const ref = parent || rows, pos = new Map();
    ref.concat(rows).forEach((x, i) => { if (!pos.has(norm(x.line))) pos.set(norm(x.line), i); });
    const terms = (m, sign, out, direct) => {
      const c = m.replace(/^-/, ''), s = m[0] === '-' ? -sign : sign, own = rows.filter((x) => x.c === c);
      if (own.length) own.forEach((x) => out.push([s, norm(x.line)]));
      else if (TOTALS[c]) for (const k of TOTALS[c]) terms(k, s, out, false);
      else if (parent && direct) parent.filter((x) => x.c === c).forEach((x) => out.push([s, norm(x.line)]));
      return out;
    };
    const rules = new Map();
    for (const x of rows) {
      if (!TOTALS[x.c]) continue;
      const t = [];
      for (const m of TOTALS[x.c]) terms(m, 1, t, true);
      const seen = new Set(), u = t.filter(([, l]) => !seen.has(l) && seen.add(l)).sort((a, b) => pos.get(a[1]) - pos.get(b[1]));
      // Spelt as the dataset always has (Python's json.dumps).
      if (u.length) rules.set(x, '[' + u.map(([s, l]) => `[${s}, ${JSON.stringify(l)}]`).join(', ') + ']');
    }
    return rules;
  }

  // ---- the step ------------------------------------------------------------------------
  X.step('actuals_plan', async (ctx) => {
    // Built from this run's statements, else the current ones; nothing new, nothing to do.
    // The Homebuilder model's own summary P&L: the Homebuilder 'All Projects' plan figures.
    const hs = await ctx.sheet('homebuilder_co_pl');
    if (!hs && !CFS.concat(PLS).some((st) => ctx.fresh(st))) throw new Error('needs the model workbooks');
    const src = {};
    for (const st of CFS.concat(PLS, ['consol_project_pl'])) { src[st] = ctx.get(st); if (!src[st].length) throw new Error('needs ' + st); }
    let summary;
    if (hs) summary = (await ctx.memo('copl:homebuilder', async () => readSummaryPL(hs))).rows;
    else {
      // Without the Homebuilder model its 'All Projects' P&L lines stay as they are, with their
      // roles, so the other statements can still be refreshed.
      summary = (ctx.prev.actuals_plan || []).filter((r) => r.stmt === 'homebuilder_pl' && r.project === ALL);
      if (!summary.length) throw new Error("needs 'Cons P&L' of the Homebuilder model");
      ctx.report.warnings.push("actuals_plan: Homebuilder 'All Projects' P&L kept from the current data; upload the Homebuilder model to refresh it");
    }

    // Output years: "Till Dec'YY" for the model's current year (the one the cashflows split
    // into 'Till <month>' and the rest of the year), then every FY any statement reaches.
    const keys = Object.values(src).concat([summary]).flatMap(periodKeys);
    const split = keys.find((p) => !/^FY/.test(p));
    const Y = split ? yearOf(split) : null;
    if (!Y) throw new Error('cannot tell the current year (no "Till …" period in the cashflows)');
    const TILL = "Till Dec'" + String(Y).slice(-2);
    const OUT = [TILL];
    for (let y = Y + 1, last = Math.max(...keys.map(yearOf)); y <= last; y++) OUT.push('FY' + y);
    const label = (p) => { const y = yearOf(p); return y == null ? null : y <= Y ? TILL : 'FY' + y; };
    // The years a statement has: the others stay empty (null).
    const yearsOf = (rows) => new Set(rows.flatMap((r) => Object.keys(r).filter((k) => r[k] != null).map(label)).filter(Boolean));
    // A row's figures by output year: balances keep the opening of the first period folded in
    // and the closing of the last; everything else adds up.
    const fold = (x, P, bal) => {
      const ps = Object.keys(x).filter((k) => label(k) === P && x[k] != null);
      if (bal) return ps.length ? num(x[bal === 'open' ? ps[0] : ps[ps.length - 1]]) : 0;
      return ps.reduce((s, k) => s + num(x[k]), 0);
    };

    const out = [];
    function emit(st, project, ord, x, role, rule, has) {
      const o = { key: `${st}|${project}|${pad2(ord)}`, stmt: st, project, ord, line: x.line, kind: x.kind, role, rule };
      const bal = /^e?open$/.test(role) ? 'open' : /^e?close$/.test(role) ? 'close' : null;
      let sum = 0;
      for (const P of OUT) {
        if (role === 'header' || !has.has(P)) { o[P] = null; continue; }
        const v = fold(x, P, bal);
        o[P] = r2(v); sum += v;
      }
      o.Total = role === 'header' || bal ? null : r2(sum);
      out.push(o);
    }

    // Cashflows: the cashflow sheets' 'All Projects' block is the sum of the projects; a total
    // closes the section its header opened.
    const BAL = [[/^opening escrow/, 'eopen'], [/^closing escrow/, 'eclose'], [/^opening/, 'open'], [/^closing/, 'close']];
    for (const st of CFS) {
      const has = yearsOf(src[st]);
      let head = null;
      for (const r of src[st]) {
        let role, rule = null;
        if (r.kind === 'header') { role = 'header'; head = r.line; }
        else if (r.kind === 'balance') role = (BAL.find(([re]) => re.test(lower(r.line))) || [null, 'input'])[1];
        else if (r.kind === 'total' && head) { role = 'sec'; rule = norm(head); }
        else role = r.project === ALL ? 'sumifs' : 'input';
        emit(st, r.project, r.ord, r, role, rule, has);
      }
    }

    // P&L: the 'All Projects' lines, then each project's lines.
    //  consol: 'Cons P&L' (consol_pl level 0); projects: their own P&Ls (consol_project_pl);
    //  landowner: landowner_pl, whose project lines hang under those same 'All Projects' lines;
    //  homebuilder: the Homebuilder 'Cons P&L'; projects: their lines in homebuilder_pl.
    const withC = (rows) => rows.map((r) => Object.assign({}, r, { c: r.c !== undefined ? r.c : r.kind === 'header' ? null : concept(r.line) }));
    const byProject = (rows) => { const m = new Map(); for (const r of rows) { if (!m.has(r.project)) m.set(r.project, []); m.get(r.project).push(r); } return m; };
    const top = (st) => src[st].filter((r) => !r.level);
    // Each project's lines in statement order, with the headers of the sections it has lines in.
    function underTop(st) {
      const m = new Map();
      for (const [p, ks] of byProject(src[st].filter((r) => r.level === 1 && r.project !== CORP))) {
        const rows = [];
        let head = null;
        for (const t of top(st)) {
          if (t.kind === 'header') { head = t; continue; }
          const k = ks.find((x) => x.parent === t.key);
          if (!k) continue;
          if (head) { rows.push(Object.assign({}, head, { project: p })); head = null; }
          rows.push(k);
        }
        m.set(p, rows);
      }
      return m;
    }
    const PL = {
      consol_pl: { all: top('consol_pl'), allIsTop: true, parents: null, projects: byProject(src.consol_project_pl) },
      landowner_pl: { all: top('landowner_pl'), allIsTop: true, parents: top('landowner_pl'), projects: underTop('landowner_pl') },
      homebuilder_pl: { all: summary, allIsTop: false, parents: top('homebuilder_pl'), projects: underTop('homebuilder_pl') },
    };
    for (const st of PLS) {
      const d = PL[st], all = withC(d.all), projRows = [...d.projects.values()].flat();
      const parents = d.parents && withC(d.parents).filter((x) => x.kind !== 'header');
      const has = yearsOf(d.all.concat(projRows.filter((x) => x.kind !== 'header')));
      const allRules = deriveRules(all.filter((x) => x.kind !== 'header'));
      const same = (a, b) => OUT.every((P) => Math.abs(fold(a, P) - fold(b, P)) <= 1);
      // An 'All Projects' line the projects fully explain is their sum: the projects have a line
      // of that name, the P&L dataset puts nothing of it at corporate level, and has the same
      // figures for it. Corporate tax is on the entity's profit, so it is always typed in.
      const summed = (x) => {
        if (x.c === 'corptax' || !projRows.some((r) => r.kind !== 'header' && norm(r.line) === norm(x.line))) return false;
        const t = top(st).find((r) => r.kind !== 'header' && norm(r.line) === norm(x.line)) || top(st).find((r) => r.kind !== 'header' && concept(r.line) === x.c);
        if (!t) return true;
        if (src[st].some((r) => r.parent === t.key && r.project === CORP)) return false;
        return d.allIsTop || same(x, t);
      };
      all.forEach((x, i) => {
        // Lines kept from the current data keep their roles.
        const rule = x.role ? x.rule : allRules.get(x) || null;
        const role = x.role || (x.kind === 'header' ? 'header' : rule ? 'expr' : summed(x) ? 'sumifs' : 'input');
        emit(st, ALL, i + 1, x, role, rule, has);
      });
      const allByKey = new Map(all.map((x) => [x.key, x]));
      for (const [p, rows0] of d.projects) {
        const rows = withC(rows0), lines = rows.filter((x) => x.kind !== 'header');
        // Project lines that hang under the 'All Projects' lines compute like them; otherwise a
        // project's totals add up its own lines.
        const own = d.allIsTop && parents ? null : deriveRules(lines, parents);
        rows.forEach((x, i) => {
          const rule = x.kind === 'header' ? null : (own ? own.get(x) : allRules.get(allByKey.get(x.parent))) || null;
          emit(st, p, i + 1, x, x.kind === 'header' ? 'header' : rule ? 'expr' : 'input', rule, has);
        });
      }
    }
    ctx.report.sources.actuals_plan = 'the cashflow and P&L datasets, consol_project_pl' + (hs ? `, ${hs.file} › ${hs.name}` : '');
    return out;
  });
})(typeof window !== 'undefined' ? window.SobhaExtract : globalThis.SobhaExtract);
