// Turns the uploaded model workbooks into the dashboard's datasets (same shapes as
// src/baseline.json). Pure functions over XLSXLite sheets: no DOM, so test/parity.mjs runs
// exactly this code in Node. Everything is found by label (project in column A, line
// names, period headers), not by fixed cell addresses.
(function (root) {
  'use strict';

  // ---- workbooks ---------------------------------------------------------------------
  // A file is recognised by the sheets it contains. When a sheet is renamed in a future
  // model version, change it here and in SHEETS below.
  const MODELS = {
    consol: { label: 'Consol model', need: ['Consol Projectwise cash PRT', 'Cons P&L'] },
    landowner: { label: 'Landowner model', need: ['landowner Projectwise cashf PRT', 'landowner Projectwise PL', 'Summary val'] },
    homebuilder: { label: 'Homebuilder model', need: ['Homebuilde Projectwise cash PRT', 'Homebuilde Projectwise PL'] },
    bpinput: { label: 'BP Input Sheets', need: ['Timeline Assumptions'] },
  };
  // Where each input lives, in order of preference: [model, sheet name].
  const SHEETS = {
    consol_cf: [['consol', 'Consol Projectwise cash PRT']],
    landowner_cf: [['landowner', 'landowner Projectwise cashf PRT'], ['consol', 'landowner Projectwise cashf PRT']],
    homebuilder_cf: [['homebuilder', 'Homebuilde Projectwise cash PRT'], ['consol', 'Homebuilde Projectwise cash PRT']],
    consol_pl: [['consol', 'Cons P&L']],
    consol_pl_projects: [['consol', 'Consol Projectwise PL']],
    landowner_pl: [['landowner', 'landowner Projectwise PL']],
    homebuilder_pl: [['homebuilder', 'Homebuilde Projectwise PL']],
    summary: [['landowner', 'Summary val']],
    budget: [['consol', 'Cons Budgetd Costs new'], ['homebuilder', 'Cons Budgetd Costs']],
    exposure: [['consol', 'Cons Exposure']],
    timeline: [['bpinput', 'Timeline Assumptions']],
  };

  function detect(wb) {
    for (const [model, m] of Object.entries(MODELS)) if (m.need.every((s) => wb.has(s))) return model;
    return null;
  }
  function missingFor(wb) {
    // Closest model by sheets present, to name what is missing in an error.
    let best = null;
    for (const [model, m] of Object.entries(MODELS)) {
      const have = m.need.filter((s) => wb.has(s)).length;
      if (have && (!best || have > best.have)) best = { model, have, missing: m.need.filter((s) => !wb.has(s)) };
    }
    return best;
  }

  // ---- small helpers -----------------------------------------------------------------
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const num = (v) => (isNum(v) ? v : 0);
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const pad2 = (n) => String(n).padStart(2, '0');
  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const lower = (s) => clean(s).toLowerCase();
  const iso = (v) => (isNum(v) ? root.XLSXLite.serialToISO(v) : null);

  // 'Till 31 Aug'26' -> "Till Aug'26", "Sept'26 to Dec'26" -> "Sep-Dec'26", 'FY 26' / 'FY 2027' -> 'FY2027'.
  function periodLabel(s) {
    const t = clean(s);
    let m = t.match(/^FY\s*'?(\d{2}|\d{4})$/i);
    if (m) return 'FY' + (m[1].length === 2 ? '20' + m[1] : m[1]);
    m = t.match(/^Till\s+(?:\d{1,2}\s+)?([A-Za-z]{3})[A-Za-z]*\s*'(\d{2})$/i);
    if (m) return 'Till ' + m[1][0].toUpperCase() + m[1].slice(1, 3).toLowerCase() + "'" + m[2];
    m = t.match(/^([A-Za-z]{3})[A-Za-z]*\s*'(\d{2})\s+to\s+([A-Za-z]{3})[A-Za-z]*\s*'(\d{2})$/i);
    if (m) { const c = (x) => x[0].toUpperCase() + x.slice(1, 3).toLowerCase(); return c(m[1]) + '-' + c(m[3]) + "'" + m[4]; }
    return null;
  }

  // Header columns of a sheet: for each column, the most common label across the rows
  // that look like headers (so one odd block header does not win).
  function headerCols(sheet, isHeaderRow) {
    const votes = {};
    for (const r of sheet.rowNums()) {
      const row = sheet.row(r);
      if (!isHeaderRow(row)) continue;
      for (const [c, v] of Object.entries(row)) {
        if (typeof v !== 'string') continue;
        const k = clean(v); if (!k) continue;
        (votes[c] = votes[c] || {})[k] = (votes[c][k] || 0) + 1;
      }
    }
    const cols = {};
    for (const [c, vs] of Object.entries(votes)) cols[c] = Object.entries(vs).sort((a, b) => b[1] - a[1])[0][0];
    return cols;
  }
  function layout(cols) {
    const periods = [], out = { periods, total: null, budget: null };
    for (const c of Object.keys(cols).map(Number).sort((a, b) => a - b)) {
      const v = cols[c], p = periodLabel(v);
      if (p) { if (!periods.some((x) => x.label === p)) periods.push({ col: c, label: p }); }
      else if (/^total$/i.test(v) && out.total == null) out.total = c;
      else if (/^topline$/i.test(v)) out.budget = c;
    }
    return out;
  }

  // ---- cashflow statements (… Projectwise cash PRT) -----------------------------------
  const CF_FIX = { 'opening escrow balance balance': 'Opening escrow balance', 'croporate cashflows:': 'Corporate cashflows:' };
  function cfKind(line) {
    const l = lower(line);
    if (/:$/.test(l)) return 'header';
    if (/^(opening|closing)\b.*balance$/.test(l)) return 'balance';
    if (/^total\b/.test(l)) return 'total';
    if (/^(sales|sales unit|revenue)$/.test(l)) return 'memo';
    return 'item';
  }
  function readCF(sheet) {
    const L = layout(headerCols(sheet, (row) => row[2] === 'Sr.no' || clean(row[3]) === 'Particular'));
    if (!L.periods.length) throw new Error(`no period columns found in '${sheet.name}'`);
    const out = [], seen = {}, irr = {};
    let block = null, afterXirr = false;
    for (const r of sheet.rowNums()) {
      const row = sheet.row(r);
      // The equity IRR sits in column D of the row below the 'XIRR' dates row. Its label
      // ('IRR', 'Pre-tax equity IRR flow …') and its column A are not always filled in.
      const isIrr = isNum(row[4]) && !isNum(row[2]) && (afterXirr || /\birr\b/i.test(clean(row[3])));
      afterXirr = clean(row[2]) === 'XIRR';
      if (isIrr) { const q = clean(row[1]) || block; if (q && !(q in irr)) irr[q] = { value: row[4], row: r }; continue; }
      const p = clean(row[1]);
      if (!p) continue;
      block = p;
      if (!isNum(row[2]) || !clean(row[3])) continue;
      let line = clean(row[3]);
      line = CF_FIX[line.toLowerCase()] || line;
      const ord = (seen[p] = (seen[p] || 0) + 1);
      const kind = cfKind(line);
      const o = { key: p + '|' + pad2(ord), project: p, ord, line, kind };
      let sum = 0;
      for (const { col, label } of L.periods) { const v = kind === 'header' ? null : r2(num(row[col])); o[label] = v; sum += v || 0; }
      o.Budget = kind === 'header' || kind === 'balance' ? null : r2(num(L.budget ? row[L.budget] : 0));
      // Always the sum of the periods: the sheets' own Total column is stale on some lines.
      o.Total = kind === 'header' || kind === 'balance' ? null : r2(sum);
      out.push(o);
    }
    return { rows: out, periods: L.periods.map((x) => x.label), irr };
  }

  // ---- P&L statements ----------------------------------------------------------------
  // Lines are matched across the summary P&L and the project blocks by meaning, since the
  // wording differs ('Land cost' vs 'Land costs', 'Total Overheads' vs 'Total Overhead Cost').
  const CONCEPTS = [
    [/^total revenue/, 'revenue'], [/^land cost/, 'land'], [/^infra cost/, 'infra'], [/^other direct cost/, 'otherdirect'],
    [/^construction cost/, 'construction'], [/^design .*supervision/, 'dns'], [/^authority cost/, 'authority'],
    [/^brokerage/, 'brokerage'], [/^(total direct costs?|cost of revenue)$/, 'totaldirect'], [/^gross profit/, 'gp'],
    [/^legal/, 'legal'], [/^general .*admin/, 'gna'], [/^staff/, 'staff'], [/^total general overhead/, 'tgo'],
    [/^marketing/, 'marketing'], [/^(total )?finance costs? \(net\)$|^total net finance/, 'netfinance'],
    [/^external finance|^finance costs?$/, 'finance'], [/^interest income|^finance income/, 'interest'],
    [/^real property tax/, 'rpt'], [/^franchise tax/, 'franchise'], [/^total state tax/, 'statetax'],
    [/^total overhead/, 'toverhead'], [/^net profit before tax/, 'npbt'], [/^corporate tax/, 'corptax'],
    [/^net profit( after tax|\s*\/\s*\(loss\))/, 'npat'],
  ];
  const concept = (line) => { const l = lower(line); for (const [re, k] of CONCEPTS) if (re.test(l)) return k; return null; };
  const plKind = (line, hasNums) => {
    if (!hasNums) return 'header';
    return /^(total\b|gross profit|net profit|cost of revenue$|finance costs \(net\))/i.test(clean(line)) ? 'total' : 'item';
  };

  // One block = consecutive rows under a header row ('Description' in the label column).
  // Returns [{project, lines:[{label, vals:{period:v}, total, hasNums}]}].
  function readPLBlocks(sheet, opt) {
    const labelCol = opt.labelCol, H = headerCols(sheet, (row) => /^description$/i.test(clean(row[labelCol])));
    const L = layout(H);
    if (!L.total) for (const [c, v] of Object.entries(H)) if (/^total$/i.test(v)) L.total = +c;
    const blocks = [];
    let cur = null;
    for (const r of sheet.rowNums()) {
      const row = sheet.row(r), label = clean(row[labelCol]);
      if (/^description$/i.test(label)) { cur = { project: clean(row[1]) || (blocks.length ? null : 'All Projects'), header: r, lines: [] }; blocks.push(cur); continue; }
      if (!cur || !label) continue;
      if (cur.closed) continue;
      const vals = {}; let hasNums = false;
      for (const { col, label: p } of L.periods) { const v = row[col]; if (isNum(v)) hasNums = true; vals[p] = isNum(v) ? v : null; }
      const total = L.total && isNum(row[L.total]) ? row[L.total] : null;
      if (total != null) hasNums = true;
      cur.lines.push({ label, vals, total, hasNums, row: r });
      // A statement ends at net profit after tax; below it are ratios and checks.
      if (hasNums && concept(label) === 'npat') cur.closed = true;
    }
    return { blocks, periods: L.periods.map((x) => x.label) };
  }

  // Top-level lines (with their All| keys) from a block. A label-only row repeating the
  // previous label is a duplicate sub-header: it keeps its number but is not shown.
  function topLines(lines, periods) {
    const out = []; let n = 0, prev = null;
    for (const ln of lines) {
      n++;
      if (!ln.hasNums && prev && lower(prev) === lower(ln.label)) { prev = ln.label; continue; }
      prev = ln.label;
      const kind = plKind(ln.label, ln.hasNums);
      const o = { key: 'All|' + pad2(n), parent: '', level: 0, project: 'All Projects', line: ln.label.replace(/\s+$/, ''), kind };
      let sum = 0;
      for (const p of periods) { const v = kind === 'header' ? null : r2(num(ln.vals[p])); o[p] = v; sum += v || 0; }
      o.Total = kind === 'header' ? null : r2(ln.total != null ? ln.total : sum);
      out.push(o);
    }
    return out;
  }

  // Children: each project block's lines summed by concept under the matching top line;
  // 'Corporate level & differences' takes whatever the projects do not explain.
  const CORP = 'Corporate level & differences';
  function plChildren(top, blocks, periods, opt) {
    const rows = [];
    const byConcept = {};
    top.forEach((t) => { const c = t.kind !== 'header' && concept(t.line); if (c && !byConcept[c]) byConcept[c] = t; });
    const kids = {};
    for (const b of blocks) {
      if (!b.project || b.project === 'All Projects') continue;
      const acc = {};
      for (const ln of b.lines) {
        if (!ln.hasNums) continue;
        const c = concept(ln.label), t = c && byConcept[c];
        if (!t) continue;
        const a = (acc[t.key] = acc[t.key] || { t, vals: {}, total: 0 });
        for (const p of periods) a.vals[p] = (a.vals[p] || 0) + num(ln.vals[p]);
        a.total += ln.total != null ? ln.total : periods.reduce((s, p) => s + num(ln.vals[p]), 0);
      }
      for (const a of Object.values(acc)) {
        const o = { key: b.project + '|' + a.t.key.split('|')[1], parent: a.t.key, level: 1, project: b.project, line: a.t.line, kind: a.t.kind };
        for (const p of periods) o[p] = r2(a.vals[p]);
        o.Total = r2(a.total);
        rows.push(o); (kids[a.t.key] = kids[a.t.key] || []).push(o);
      }
    }
    for (const t of top) {
      if (t.kind === 'header') continue;
      const ks = kids[t.key] || [];
      if (opt.corporateOnlyWithKids && !ks.length) continue;
      const o = { key: 'Corporate|' + t.key.split('|')[1], parent: t.key, level: 1, project: CORP, line: t.line, kind: t.kind };
      let any = false;
      for (const p of [...periods, 'Total']) {
        const v = r2(num(t[p]) - ks.reduce((s, k) => s + num(k[p]), 0));
        o[p] = Math.abs(v) < 0.5 ? 0 : v; if (o[p]) any = true;
      }
      if (any) rows.push(o);
    }
    return rows;
  }

  function readProjectPL(sheet) {
    const { blocks, periods } = readPLBlocks(sheet, { labelCol: 3 });
    const all = blocks[0];
    if (!all || !all.lines.length) throw new Error(`no P&L found in '${sheet.name}'`);
    const top = topLines(all.lines, periods);
    return { rows: top.concat(plChildren(top, blocks.slice(1), periods, {})), periods, blocks, top };
  }

  // ---- context and steps -------------------------------------------------------------
  const steps = [];
  // Register a dataset builder. fn(ctx) returns rows, or throws when its inputs are missing.
  function step(name, fn) { steps.push({ name, fn }); }

  function makeCtx(books, prev, report) {
    const models = {};
    for (const b of books) {
      const model = detect(b.wb);
      report.files.push({ name: b.name, model, label: model ? MODELS[model].label : null, missing: model ? [] : ((missingFor(b.wb) || {}).missing || []) });
      if (!model) { report.warnings.push(`${b.name}: not recognised as one of the models` + ((missingFor(b.wb) || {}).missing ? ` (missing sheets: ${missingFor(b.wb).missing.join(', ')})` : '')); continue; }
      if (models[model]) report.warnings.push(`${b.name}: a second ${MODELS[model].label}; using ${models[model].name}`);
      else models[model] = b;
    }
    const cache = {};
    const ctx = {
      models, prev, data: {}, report, cache,
      has: (model) => !!models[model],
      // First available sheet for an input key; null when no uploaded file has it.
      async sheet(key) {
        for (const [model, name] of SHEETS[key] || []) {
          const b = models[model];
          if (!b || !b.wb.has(name)) continue;
          const s = await b.wb.sheet(name);
          if (s.uncached) report.warnings.push(`${b.name} › ${name}: ${s.uncached} formula cells have no saved value — open the file in Excel, recalculate and save it again`);
          return Object.assign(s, { model, file: b.name });
        }
        return null;
      },
      // A named sheet of an uploaded model, for inputs not listed in SHEETS.
      async sheetOf(model, name) { const b = models[model]; return b && b.wb.has(name) ? Object.assign(await b.wb.sheet(name), { model, file: b.name }) : null; },
      async need(key) { const s = await ctx.sheet(key); if (!s) throw new Error('needs ' + (SHEETS[key] || [[null, key]]).map((x) => `'${x[1]}'`).join(' or ')); return s; },
      // A dataset: freshly built in this run, else the current one.
      get: (name) => (name in ctx.data ? ctx.data[name] : (prev[name] || [])),
      fresh: (name) => name in ctx.data,
      memo: async (k, fn) => (k in cache ? cache[k] : (cache[k] = await fn())),
    };
    return ctx;
  }

  async function build(books, prev) {
    const report = { files: [], refreshed: [], kept: [], warnings: [], checks: [], sources: {}, periods: {} };
    const ctx = makeCtx(books, prev || {}, report);
    for (const s of steps) {
      try {
        const rows = await s.fn(ctx);
        if (rows) { ctx.data[s.name] = rows; report.refreshed.push(s.name); }
      } catch (e) {
        if (!/^needs /.test(e.message)) report.warnings.push(`${s.name}: ${e.message}`);
        report.sources[s.name] = report.sources[s.name] || e.message;
      }
    }
    const data = Object.assign({}, prev, ctx.data);
    report.kept = Object.keys(prev || {}).filter((k) => !report.refreshed.includes(k));
    return { data, report };
  }

  // ---- direct datasets ---------------------------------------------------------------
  for (const ent of ['consol', 'landowner', 'homebuilder']) {
    step(ent + '_cf', async (ctx) => {
      const s = await ctx.need(ent + '_cf');
      const cf = await ctx.memo('cf:' + ent, async () => readCF(s));
      ctx.report.sources[ent + '_cf'] = `${s.file} › ${s.name}`;
      ctx.report.periods[ent + '_cf'] = cf.periods;
      if (s.model !== ent) ctx.report.warnings.push(`${ent}_cf: taken from the copy inside ${s.file}; upload the ${MODELS[ent].label} for its own figures`);
      return cf.rows;
    });
  }
  for (const ent of ['landowner', 'homebuilder']) {
    step(ent + '_pl', async (ctx) => {
      const s = await ctx.need(ent + '_pl');
      const pl = await ctx.memo('pl:' + ent, async () => readProjectPL(s));
      ctx.report.sources[ent + '_pl'] = `${s.file} › ${s.name}`;
      return pl.rows;
    });
  }

  // Equity IRR: the IRR row under each project block of the three cashflow sheets.
  step('project_irr', async (ctx) => {
    const out = [];
    let any = false;
    for (const ent of ['consol', 'landowner', 'homebuilder']) {
      const s = await ctx.sheet(ent + '_cf');
      if (!s) { out.push(...(ctx.prev.project_irr || []).filter((r) => r.entity === ent)); continue; }
      any = true;
      const cf = await ctx.memo('cf:' + ent, async () => readCF(s));
      const projects = [...new Set(cf.rows.map((r) => r.project))];
      for (const p of projects) {
        const line = (re) => cf.rows.find((r) => r.project === p && re.test(r.line));
        const inf = line(/^equity infusion$/i), rel = line(/^equity release$/i);
        const ei = inf ? inf.Total : null, er = rel ? rel.Total : null;
        const irr = cf.irr[p];
        out.push({
          key: ent + '|' + p, entity: ent, project: p,
          equity_infused: ei, equity_released: er,
          net_return: ei != null && er != null ? r2(er - ei) : null,
          multiple: ei ? Math.round((er / ei) * 10000) / 10000 : null,
          pretax_equity_irr: irr ? irr.value : null,
          source: irr ? `${s.name}, row ${irr.row} (XIRR)` : s.name,
        });
      }
    }
    return any ? out : null;
  });

  // Executive summary tiles: 'Summary val' has a Landowner, Homebuilder and Consolidated
  // block, projects across the header row and 'Total' at the end.
  const SUMMARY_FIELDS = [
    [/^topline|^revenue/, 'revenue'], [/^gross profit %/, 'gp_pct'], [/^gross profit/, 'gross_profit'],
    [/^net profit %/, 'np_pct'], [/^net profit/, 'net_profit'], [/^total equity infused/, 'equity_infused'],
    [/^debt raised/, 'debt_raised'], [/^irr \(pre/, 'irr_pre'], [/^irr \(post/, 'irr_post'],
    [/^ret(u|ur)n on equity/, 'roe'], [/^margin to equity/, 'margin_to_equity'], [/^debt to equity/, 'debt_to_equity'],
  ];
  async function readSummary(ctx) {
    return ctx.memo('summary', async () => {
      const s = await ctx.need('summary');
      let hdr = null; const blocks = {}; let cur = null;
      for (const r of s.rowNums()) {
        const row = s.row(r), b = lower(row[2]);
        if (b === 'particulars') { hdr = row; continue; }
        const ent = /^land/.test(b) ? 'landowner' : /^homebuilder/.test(b) ? 'homebuilder' : /^consolidated/.test(b) ? 'consol' : null;
        if (ent && /:$/.test(clean(row[2]))) { cur = blocks[ent] = { rows: {} }; continue; }
        if (!cur) continue;
        for (const [re, f] of SUMMARY_FIELDS) if (re.test(b)) { if (!cur.rows[f]) cur.rows[f] = { row, r }; break; }
      }
      if (!hdr) throw new Error(`no 'Particulars' header in '${s.name}'`);
      const cols = Object.keys(hdr).map(Number).filter((c) => c > 2 && clean(hdr[c])).map((c) => ({ c, project: /^total$/i.test(clean(hdr[c])) ? 'All Projects' : clean(hdr[c]) }));
      return { s, cols, blocks };
    });
  }
  step('project_summary', async (ctx) => {
    const { s, cols, blocks } = await readSummary(ctx);
    const out = [];
    for (const ent of ['landowner', 'homebuilder', 'consol']) {
      const b = blocks[ent]; if (!b) continue;
      for (const { c, project } of cols) {
        const o = { key: ent + '|' + project, entity: ent, project };
        for (const [, f] of SUMMARY_FIELDS) { const x = b.rows[f]; const v = x ? x.row[c] : null; o[f] = isNum(v) ? v : null; }
        // Ratios over a zero base are blank, not 0%.
        if (!o.revenue) o.gp_pct = o.np_pct = null;
        if (!o.equity_infused) o.irr_post = o.roe = o.margin_to_equity = o.debt_to_equity = null;
        o.source = 'Executive Summary (Summary val sheet, Landowner model)';
        o.roe_multiple = o.margin_to_equity != null ? Math.round((1 + o.margin_to_equity) * 10000) / 10000 : null;
        out.push(o);
      }
    }
    ctx.report.sources.project_summary = `${s.file} › ${s.name}`;
    return out;
  });

  // ---- timeline (BP Input Sheets › Timeline Assumptions) -----------------------------
  // Row names in the input sheet differ from the model's project names; they are matched
  // on a short key. Add an alias here when a project is renamed in one place only.
  const TIMELINE_ALIASES = { 'willard commercial': 'creek park commercial' };
  const nameKey = (s) => {
    let t = lower(s).replace(/\s*-\s*phase\s*\d+\s*$/, '').replace(/\(phase[^)]*\)/g, '');
    t = t.replace(/\s*@.*$/, '').replace(/\s*\(.*$/, '').replace(/[^a-z0-9]+/g, ' ').trim();
    t = t.replace(/^project (\d+)$/, 'project$1').replace(/\s+/g, ' ');
    t = TIMELINE_ALIASES[t] || t;
    return t.replace(/\s+/g, '');
  };
  const ACTIVITIES = [
    // [activity, group, start header, finish header]
    ['Land acquisition', 'land', /acquisition start/, /acquisition finish/],
    ['Horizontal works', 'land', /^horizontal start/, /^horizontal finish/],
    ['Lot sales', 'land', /^lot sale start/, /^lot sale finish/],
    ['Vertical construction', 'home', /^vertical start/, /^vertical finish/],
    ['Home sales', 'home', /^proposed sales? start|^sales? start/, /^tentative sales? finish|^sales? finish/],
    ['Close-out & handover', 'home', /^close out/, /^close out/],
  ];
  async function readTimeline(ctx) {
    return ctx.memo('timeline', async () => {
      const s = await ctx.need('timeline');
      // The header row is the one naming the acquisition start column.
      let hr = null;
      for (const r of s.rowNums()) if (Object.values(s.row(r)).some((v) => typeof v === 'string' && /acquisition start/i.test(v))) { hr = r; break; }
      if (!hr) throw new Error(`no date header in '${s.name}'`);
      const H = s.row(hr), col = (re) => { for (const [c, v] of Object.entries(H)) if (typeof v === 'string' && re.test(lower(v))) return +c; return null; };
      const top = s.row(hr - 1);
      const nameCol = +(Object.entries(top).find(([, v]) => /proposed projects/i.test(String(v))) || [4])[0];
      const typeCol = +(Object.entries(top).find(([, v]) => /type of project/i.test(String(v))) || [6])[0];
      const C = {
        units: col(/estimated units/), acres: col(/land area/), status: col(/acquisition\s*status/), sba: col(/^sba/),
        homeSize: col(/avg home size/), homePrice: col(/avg home price/), location: +(Object.entries(top).find(([, v]) => /^location$/i.test(clean(v))) || [5])[0],
      };
      const acts = ACTIVITIES.map(([a, g, rs, rf]) => ({ a, g, s: col(rs), f: col(rf) }));
      const rows = []; let type = null, loc = null;
      for (const r of s.rowNums()) {
        if (r <= hr) continue;
        const row = s.row(r), name = clean(row[nameCol]);
        if (!name || /^note/i.test(name)) continue;
        if (clean(row[typeCol])) type = lower(row[typeCol]);
        if (clean(row[C.location])) loc = clean(row[C.location]);
        const ph = name.match(/-\s*phase\s*(\d+)\s*$/i);
        rows.push({
          r, name, key: nameKey(name), phase: ph ? 'Phase ' + ph[1] : 'Project', lotBuying: /lot/.test(type || ''), location: loc,
          units: isNum(row[C.units]) ? row[C.units] : null, acres: isNum(row[C.acres]) ? row[C.acres] : null,
          status: clean(row[C.status]) || null, sba: isNum(row[C.sba]) ? row[C.sba] : null,
          homeSize: isNum(row[C.homeSize]) ? row[C.homeSize] : null, homePrice: isNum(row[C.homePrice]) ? row[C.homePrice] : null,
          acts: acts.map((x) => ({ activity: x.a, group: x.g, start: iso(row[x.s]), finish: iso(row[x.f]) })),
        });
      }
      return { s, rows };
    });
  }
  // Model projects and which input rows describe them (horizontal projects match
  // raw-land rows, lot-buying projects match lot-buying rows).
  async function timelineMatch(ctx) {
    const { s, rows } = await readTimeline(ctx);
    const projects = [...new Set(ctx.get('consol_cf').concat(ctx.get('homebuilder_cf')).map((r) => r.project))].filter((p) => p !== 'All Projects');
    const land = new Set(ctx.get('landowner_cf').map((r) => r.project));
    const out = {};
    for (const p of projects) {
      const k = nameKey(p);
      let m = rows.filter((x) => x.key === k && x.lotBuying === !land.has(p));
      if (!m.length) m = rows.filter((x) => x.key === k);
      out[p] = m;
    }
    return { s, rows, match: out };
  }
  step('project_timeline', async (ctx) => {
    const { s, match } = await timelineMatch(ctx);
    const out = [];
    for (const [p, rows] of Object.entries(match)) {
      rows.forEach((x, i) => {
        for (const a of x.acts) {
          if (!a.start) continue;
          out.push({ key: `${p}|${i + 1}|${a.activity}`, project: p, phase: x.phase, input_name: x.name, activity: a.activity, group: a.group, start: a.start, finish: a.finish, units: x.units, sheet_row: x.r });
        }
      });
    }
    const unmatched = Object.entries(match).filter(([, v]) => !v.length).map(([p]) => p);
    if (unmatched.length) ctx.report.warnings.push(`Timeline: no row in '${s.name}' for ${unmatched.join(', ')}`);
    ctx.report.sources.project_timeline = `${s.file} › ${s.name}`;
    return out;
  });

  root.SobhaExtract = {
    MODELS, SHEETS, detect, missingFor, build, step,
    // Shared with the derived-dataset files.
    lib: { isNum, num, r2, pad2, clean, lower, iso, periodLabel, headerCols, layout, readCF, readPLBlocks, topLines, plChildren, concept, plKind, readProjectPL, readSummary, readTimeline, timelineMatch, nameKey, CORP },
  };
})(typeof window !== 'undefined' ? window : globalThis);
