// derive-company: each company's own cash flow statement, as the Executive Report shows it
// (see extract.js for the step API):
//   landowner_co_cf    'HS Cashflow P' of the Landowner model
//   homebuilder_co_cf  'Cons Cashflow P' of the Homebuilder model
//   consol_co_cf       'Cons Cashflow final …' of the Consol model
// The statement is set out on the lines of the projectwise cashflow ('Equity infusion',
// 'Collection from sale', …) the way the report does: the net equity line split into
// infusions and releases, a PID reimbursement booked against outflows shown as an inflow,
// the salaries, legal and other overheads as one 'Overheads (G&A)' line, the Consol model's
// 'Brokerages & Marketing' split by the Homebuilder model's brokerage. Consecutive 'Till …'
// columns are one period ('Till Mar'26' and 'Till FY 26' make "Till Dec'26").
// Rows: the 'All Projects' lines (key 'All|NN'), then each project's figures for those lines
// from the projectwise cashflow ('<project>|NN', summed into the statement's periods), then
// what the projects do not explain ('Corporate|NN', 'Corporate level & differences'): the
// company netting one project's release against another's infusion, overheads, interest, and
// anything after the statement's last year.
(function (X) {
  'use strict';
  const { isNum, num, r2, pad2, clean, lower, periodLabel, CORP } = X.lib;
  const ALL = 'All Projects';
  const ENTS = ['landowner', 'homebuilder', 'consol'];

  // ---- periods -------------------------------------------------------------------------
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  // A period's first and last month (year * 12 + month); "Till …" starts at -Infinity.
  function span(p) {
    let m = /^FY(\d{4})$/.exec(p);
    if (m) return { s: +m[1] * 12 + 1, e: +m[1] * 12 + 12 };
    m = /^Till ([A-Za-z]{3})'(\d{2})$/.exec(p);
    if (m) return { s: -Infinity, e: (2000 + +m[2]) * 12 + MON[lower(m[1])] };
    m = /^([A-Za-z]{3})-([A-Za-z]{3})'(\d{2})$/.exec(p);
    if (m) return { s: (2000 + +m[3]) * 12 + MON[lower(m[1])], e: (2000 + +m[3]) * 12 + MON[lower(m[2])] };
    return null;
  }
  // The statement period another period's figures go in: the one containing it, else the one
  // ending with it; null when none (after the statement's last year).
  function into(P) {
    const sp = P.map(span);
    return (q) => {
      const t = span(q);
      if (!t) return null;
      let i = sp.findIndex((c) => c && t.s >= c.s && t.e <= c.e);
      if (i < 0) i = sp.findIndex((c) => c && c.e === t.e);
      return i < 0 ? null : P[i];
    };
  }

  // ---- what a line is ------------------------------------------------------------------
  // Inflows and outflows by meaning, the same for the company sheets and the projectwise ones.
  function cIn(l) {
    if (/^equity/.test(l)) return 'equity';
    if (/escrow release/.test(l)) return 'erel_in';
    if (/^collection/.test(l)) return 'collection';
    if (/pid|reimburse/.test(l)) return 'pid_in';
    if (/^interest income/.test(l)) return 'interest';
    if (/^deposit released/.test(l)) return 'deposit_rel';
    if (/internal debt/.test(l)) return 'idebt_in';
    if (/debt raised|borrowing/.test(l)) return 'debt_in';
    return null;
  }
  // A PID line booked as a negative outflow is the reimbursement (an inflow).
  function cOut(l, total) {
    if (/pid|reimburse/.test(l)) return total < 0 ? 'pid_in' : 'pid_cost';
    if (/^land/.test(l)) return 'land';
    if (/^infra/.test(l)) return 'infra';
    if (/^construction/.test(l)) return 'construction';
    if (/^design/.test(l)) return 'dns';
    if (/^authority/.test(l)) return 'authority';
    if (/internal debt/.test(l)) return /repa/.test(l) ? 'idebt_out' : 'idebt_int';
    if (/^external (debt|finance)/.test(l) && /interest|finance cost|processing/.test(l)) return 'fin';
    if (/debt repa/.test(l)) return 'debt_out';
    if (/^deposit with/.test(l)) return 'deposit';
    if (/^real property/.test(l)) return 'rpt';
    if (/corporate tax/.test(l) && /franchise/.test(l)) return 'corpfran';
    if (/^franchise/.test(l)) return 'franchise';
    if (/^corporate tax/.test(l)) return 'corptax';
    if (/^brokerages?\b/.test(l) && /marketing/.test(l)) return 'brokmkt';
    if (/^brokerage/.test(l)) return 'brokerage';
    if (/marketing/.test(l)) return 'marketing';
    if (/^(overheads?|salar|legal|other misc|staff|general)/.test(l)) return 'oh';
    if (/^equity release/.test(l)) return 'erel';
    return null;
  }
  const LABEL = {
    revenue: 'Revenue (recognised)', eopen: 'Opening escrow balance', ein: 'Collected in escrow', eout: 'Less: released from escrow',
    eclose: 'Closing escrow balance', open: 'Opening balance', close: 'Closing balance', tin: 'Total inflows', tout: 'Total outflows',
    equity: 'Equity infusion', erel_in: 'Escrow release', collection: 'Collection from sale', interest: 'Interest income on bank deposit',
    deposit_rel: 'Deposit released', debt_in: 'External debt raised', idebt_in: 'Internal debt raised', pid_in: 'Infra PID reimbursement',
    land: 'Land purchase cost', infra: 'Infra cost', pid_cost: 'Infra PID / debt processing', construction: 'Construction cost',
    dns: 'Design & supervision cost', authority: 'Authority cost', fin: 'External finance cost (incl. processing)', idebt_int: 'Internal debt interest',
    deposit: 'Deposit with bank', rpt: 'Real property tax', brokerage: 'Brokerage', marketing: 'Sales & marketing expenses',
    brokmkt: 'Brokerage & marketing', debt_out: 'External debt repayment', idebt_out: 'Internal debt repaid', franchise: 'Franchise tax',
    corptax: 'Corporate tax', corpfran: 'Corporate & franchise tax', oh: 'Overheads (G&A)', erel: 'Equity release',
  };
  // Where a line goes when the projectwise statement has no such line: after the nearest of
  // these before it.
  const CANON = {
    escrow: ['ein', 'eout'],
    in: ['equity', 'erel_in', 'collection', 'interest', 'deposit_rel', 'debt_in', 'idebt_in', 'pid_in'],
    out: ['land', 'infra', 'pid_cost', 'construction', 'dns', 'authority', 'fin', 'idebt_int', 'deposit', 'rpt', 'brokerage', 'marketing', 'brokmkt',
      'debt_out', 'idebt_out', 'franchise', 'corptax', 'corpfran', 'oh', 'erel'],
  };
  // A company line covering several projectwise ones.
  const PARTS = { corpfran: ['franchise', 'corptax'], brokmkt: ['brokerage', 'marketing'] };

  // ---- the company sheet ---------------------------------------------------------------
  function readCompanyCF(s) {
    let hr = null, lc = null;
    for (const r of s.rowNums()) {
      const row = s.row(r), c = Object.keys(row).find((k) => /^particulars?$/i.test(clean(row[k])));
      if (c != null) { hr = r; lc = +c; break; }
    }
    if (hr == null) throw new Error(`no 'Particular' header in '${s.name}'`);
    const hdr = s.row(hr), groups = [];
    for (const c of Object.keys(hdr).map(Number).sort((a, b) => a - b)) {
      const p = c > lc ? periodLabel(hdr[c]) : null;
      if (!p) continue;
      const g = groups[groups.length - 1];
      if (g && /^Till /.test(g.p) && /^Till /.test(p)) { g.cols.push(c); g.p = p; } else groups.push({ p, cols: [c] });
    }
    const P = groups.map((g) => g.p);
    if (!P.length) throw new Error(`no period columns in '${s.name}'`);
    const lines = new Map(), bal = {};
    const add = (c, label, side, v) => {
      let x = lines.get(c);
      if (!x) lines.set(c, (x = { c, label, side, v: Object.fromEntries(P.map((p) => [p, 0])) }));
      P.forEach((p) => (x.v[p] += v[p]));
    };
    let sec = null, side = null, closed = false;
    for (const r of s.rowNums()) {
      if (r <= hr || closed) continue;
      const row = s.row(r), label = clean(row[lc]), l = lower(label), mark = clean(row[lc - 1]);
      if (!label) continue;
      if (/escrow cash\s*flow/.test(l)) { sec = 'escrow'; side = null; continue; }
      if (/corporate cash\s*flow/.test(l)) { sec = 'corp'; side = null; continue; }
      if (/^cash inflows?$/.test(l)) { if (sec !== 'corp') sec = 'corp'; side = 'in'; continue; }
      if (/^cash outflows?$/.test(l)) { side = 'out'; continue; }
      const at = (c) => num(row[c]);
      if (/^opening\b.*balance$/.test(l)) { bal[sec === 'escrow' ? 'eopen' : 'open'] = Object.fromEntries(groups.map((g) => [g.p, at(g.cols[0])])); continue; }
      if (/^closing\b.*balance$/.test(l)) {
        bal[sec === 'escrow' ? 'eclose' : 'close'] = Object.fromEntries(groups.map((g) => [g.p, at(g.cols[g.cols.length - 1])]));
        if (sec !== 'escrow') closed = true;
        continue;
      }
      if (!groups.some((g) => g.cols.some((c) => isNum(row[c])))) continue;
      // Sub-totals ('a' Operation cash inflows, 'I' Total cash inflows, …) are worked out again.
      if (/^([a-z]|i{1,3}|iv)$/i.test(mark) || /^total\b/.test(l)) continue;
      const v = Object.fromEntries(groups.map((g) => [g.p, g.cols.reduce((t, c) => t + at(c), 0)]));
      const total = P.reduce((t, p) => t + v[p], 0);
      let c = sec === 'escrow' ? (/collect/.test(l) ? 'ein' : /release/.test(l) ? 'eout' : null) : side === 'in' ? cIn(l) : side === 'out' ? cOut(l, total) : null;
      if (side === 'out' && c === 'pid_in') P.forEach((p) => (v[p] = -v[p]));
      if (!c) c = 'x:' + l;
      add(c, label, sec === 'escrow' ? 'escrow' : c === 'pid_in' ? 'in' : side, v);
    }
    if (!bal.close) throw new Error(`no closing balance in '${s.name}'`);
    // Net equity: what goes in is the infusion, what comes out the release.
    const eq = lines.get('equity');
    if (eq) {
      const rel = { c: 'erel', label: 'Equity release', side: 'out', v: Object.fromEntries(P.map((p) => [p, 0])) };
      P.forEach((p) => { if (eq.v[p] < 0) { rel.v[p] = -eq.v[p]; eq.v[p] = 0; } });
      if (lines.has('erel')) P.forEach((p) => (lines.get('erel').v[p] += rel.v[p])); else lines.set('erel', rel);
    }
    return { P, lines, bal };
  }

  // ---- the projectwise statement, by meaning --------------------------------------------
  // Each row of a projectwise cashflow with its meaning, project by project.
  function classify(rows) {
    const out = new Map();
    let cur = null, sec = null, side = null;
    for (const r of rows) {
      if (r.project !== cur) { cur = r.project; sec = null; side = null; if (!out.has(cur)) out.set(cur, []); }
      const l = lower(r.line);
      let c = null;
      if (r.kind === 'header') {
        if (/escrow/.test(l)) sec = 'escrow'; else if (/corporate/.test(l)) sec = 'corp';
        if (/^inflows/.test(l)) side = 'in'; else if (/^outflows/.test(l)) side = 'out';
      } else if (r.kind === 'balance') c = /escrow/.test(l) ? (/^opening/.test(l) ? 'eopen' : 'eclose') : /^opening/.test(l) ? 'open' : /^closing/.test(l) ? 'close' : null;
      else if (r.kind === 'memo') c = l === 'revenue' ? 'revenue' : null;
      else if (r.kind === 'total') c = /inflows/.test(l) ? 'tin' : /outflows/.test(l) ? 'tout' : null;
      else if (sec === 'escrow') c = /collect/.test(l) ? 'ein' : /release/.test(l) ? 'eout' : null;
      else c = side === 'in' ? cIn(l) : side === 'out' ? cOut(l, num(r.Total)) : null;
      out.get(cur).push({ r, c, side: sec === 'escrow' && r.kind === 'item' ? 'escrow' : side });
    }
    return out;
  }

  // ---- the statement --------------------------------------------------------------------
  function statement(co, base, brokerage) {
    const { P, bal } = co, lines = new Map([...co.lines].map(([k, x]) => [k, Object.assign({}, x, { v: Object.assign({}, x.v) })]));
    const nz = (v) => P.some((p) => Math.abs(v[p] || 0) >= 0.005);
    // The Consol model's 'Brokerages & Marketing', split by the Homebuilder model's brokerage.
    if (lines.has('brokmkt') && brokerage) {
      const bm = lines.get('brokmkt'), b = { c: 'brokerage', label: LABEL.brokerage, side: 'out', v: {} }, m = { c: 'marketing', label: LABEL.marketing, side: 'out', v: {} };
      P.forEach((p) => { b.v[p] = brokerage[p] || 0; m.v[p] = bm.v[p] - b.v[p]; });
      lines.delete('brokmkt'); lines.set('brokerage', b); lines.set('marketing', m);
    }
    const tmpl = classify(base), all = tmpl.get(ALL) || [];
    // Line order and wording: the projectwise statement's, company-only lines in their place.
    const header = (re, def) => { const h = all.find((x) => x.r.kind === 'header' && re.test(lower(x.r.line))); return h ? h.r.line : def; };
    const order = (side) => {
      const have = (c) => lines.has(c) && lines.get(c).side === side && nz(lines.get(c).v);
      const out = [];
      for (const x of all) {
        if (x.side !== side || !x.c) continue;
        let c = x.c;
        if (!lines.has(c)) c = Object.keys(PARTS).find((k) => PARTS[k].includes(c) && lines.has(k)) || c;
        if (have(c) && !out.includes(c)) out.push(c);
      }
      const canon = CANON[side];
      for (const [c, x] of lines) {
        if (x.side !== side || out.includes(c) || !nz(x.v)) continue;
        const k = canon.indexOf(c);
        let at = -1;
        for (let j = k - 1; j >= 0 && at < 0; j--) at = out.indexOf(canon[j]);
        out.splice(k < 0 ? out.length : at + 1, 0, c);
      }
      return out;
    };
    const label = (c) => {
      if (c.startsWith('x:')) return lines.get(c).label;
      const t = all.filter((x) => x.c === c && x.r.kind !== 'header');
      return t.length === 1 ? t[0].r.line : LABEL[c] || (lines.get(c) || {}).label || c;
    };
    const tops = [];
    const push = (c, kind, line, v) => tops.push({ c, kind, line, v });
    const sum = (cs) => Object.fromEntries(P.map((p) => [p, cs.reduce((t, c) => t + (lines.has(c) ? lines.get(c).v[p] : 0), 0)]));
    push('revenue', 'memo', LABEL.revenue, sum(['collection', 'erel_in']));
    if (bal.eopen || lines.has('ein')) {
      push(null, 'header', header(/escrow/, 'Escrow cashflows:'));
      if (bal.eopen) push('eopen', 'balance', label('eopen'), bal.eopen);
      order('escrow').forEach((c) => push(c, 'item', label(c), lines.get(c).v));
      if (bal.eclose) push('eclose', 'balance', label('eclose'), bal.eclose);
      push(null, 'header', header(/corporate/, 'Corporate cashflows:'));
    }
    if (bal.open) push('open', 'balance', label('open'), bal.open);
    const ins = order('in'), outs = order('out');
    push(null, 'header', header(/^inflows/, 'Inflows:'));
    ins.forEach((c) => push(c, 'item', label(c), lines.get(c).v));
    push('tin', 'total', label('tin'), sum(ins));
    push(null, 'header', header(/^outflows/, 'Outflows:'));
    outs.forEach((c) => push(c, 'item', label(c), lines.get(c).v));
    push('tout', 'total', label('tout'), sum(outs));
    push('close', 'balance', label('close'), bal.close);

    // Rows: the statement, then each project's figures for its lines, then the differences.
    const pin = into(P), isBal = (k) => k === 'balance';
    const row = (key, project, ord, t, v) => {
      const o = { key, project, ord, line: t.line, kind: t.kind };
      let s = 0;
      for (const p of P) { const x = t.kind === 'header' ? null : r2(v ? v[p] || 0 : 0); o[p] = x; s += x || 0; }
      o.Total = t.kind === 'header' || isBal(t.kind) ? null : r2(s);
      return o;
    };
    const out = tops.map((t, i) => row('All|' + pad2(i + 1), ALL, i + 1, t, t.v));
    const kids = tops.map(() => []);
    for (const [q, rs] of tmpl) {
      if (q === ALL) continue;
      tops.forEach((t, i) => {
        if (!t.c || t.kind === 'header') return;
        const want = PARTS[t.c] || [t.c];
        const mine = rs.filter((x) => want.includes(x.c) && (isBal(t.kind) === isBal(x.r.kind)));
        if (!mine.length) return;
        const v = Object.fromEntries(P.map((p) => [p, 0])), seen = {};
        for (const { r } of mine) for (const k of Object.keys(r)) {
          const p = span(k) && pin(k);
          if (!p || !isNum(r[k])) continue;
          // A balance takes the period's first opening or last closing.
          if (isBal(t.kind)) { if (/^e?open$/.test(t.c) ? !(p in seen) : true) v[p] = r[k]; seen[p] = 1; } else v[p] += r[k];
        }
        if (!nz(v)) return;
        const o = row(q + '|' + pad2(i + 1), q, i + 1, t, v);
        out.push(o); kids[i].push(o);
      });
    }
    tops.forEach((t, i) => {
      if (!kids[i].length) return;
      const v = Object.fromEntries(P.map((p) => [p, out[i][p] - kids[i].reduce((s, k) => s + (k[p] || 0), 0)]));
      P.forEach((p) => { if (Math.abs(v[p]) < 0.5) v[p] = 0; });
      if (nz(v)) out.push(row('Corporate|' + pad2(i + 1), CORP, i + 1, t, v));
    });
    return { rows: out, P, tops };
  }

  for (const ent of ENTS) {
    X.step(ent + '_co_cf', async (ctx) => {
      const s = await ctx.need(ent + '_co_cf');
      const co = await ctx.memo('cocf:' + ent, async () => readCompanyCF(s));
      const base = ctx.get(ent + '_cf');
      if (!base.length) throw new Error('needs ' + ent + '_cf');
      let brokerage = null;
      if (co.lines.has('brokmkt')) {
        const hs = await ctx.sheet('homebuilder_co_cf');
        const hb = hs && (await ctx.memo('cocf:homebuilder', async () => readCompanyCF(hs)));
        if (hb && hb.lines.has('brokerage')) {
          const pin = into(co.P);
          brokerage = {};
          for (const p of hb.P) { const q = pin(p); if (q) brokerage[q] = (brokerage[q] || 0) + hb.lines.get('brokerage').v[p]; }
        } else ctx.report.warnings.push(`${ent}_co_cf: brokerage and marketing shown as one line; upload the Homebuilder model to split them`);
      }
      const { rows, P, tops } = statement(co, base, brokerage);
      // The statement must add up: opening + inflows − outflows = closing.
      const t = (c) => tops.find((x) => x.c === c);
      const bad = P.filter((p) => Math.abs((t('open') ? t('open').v[p] : 0) + t('tin').v[p] - t('tout').v[p] - t('close').v[p]) > 1);
      if (bad.length) ctx.report.warnings.push(`${ent}_co_cf: '${s.name}' does not add up in ${bad.join(', ')} (closing ≠ opening + inflows − outflows)`);
      ctx.report.sources[ent + '_co_cf'] = `${s.file} › ${s.name}; projects from ${ctx.report.sources[ent + '_cf'] || ent + '_cf'}`;
      ctx.report.periods[ent + '_co_cf'] = P;
      return rows;
    });
  }
})(typeof window !== 'undefined' ? window.SobhaExtract : globalThis.SobhaExtract);
