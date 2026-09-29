/* =====================================================================
   Invoice builder: pick client + projects + months, add SAP fields,
   generate lines from attendance, print invoice + timesheets, merge PDFs
   ===================================================================== */
const IV = { draft: null, pdfs: [] };

function newInvoiceDraft() {
  const m = addMonths(ymOf(todayISO()), -1);
  return { id: uid('i'), no: '', date: todayISO(), clientId: '', projectIds: [], from: m, to: m, entity: '', trn: '', customerCode: '', poNo: '', sapProject: '', orderCode: '', custAddress: '', payTerms: S.settings.payTerms, advance: 0, retention: 0, lines: [], withSap: true, attachTs: true, notes: '' };
}

function invoiceLines(dr) {
  const lines = [];
  const multi = dr.projectIds.length > 1;
  for (const m of monthsBetween(dr.from, dr.to)) {
    for (const pid of dr.projectIds) {
      const p = IX.proj.get(pid); if (!p) continue;
      const b = p.billing || {}; const rate = +b.rate || 0; const unit = b.unit || 'Security';
      const ts = buildTimesheet(pid, m), md = ts.total, D = dim(m);
      if (!md && !['fixed', 'lump'].includes(b.basis)) continue;           // nothing worked on this project that month
      if (!b.basis || b.basis === 'ratecard') {
        // Same shape as Latinem invoices: "22 Security @ 31 Days", "1 Security @ 5 Days" – rate × days ÷ days in month
        const perEmp = new Map();
        for (const r of ts.rows) perEmp.set(r.emp.id, { emp: r.emp, d: (perEmp.get(r.emp.id)?.d || 0) + r.total });
        const groups = new Map();
        for (const { emp, d } of perEmp.values()) { if (!d) continue; const k = `${emp.trade || 'SECURITY GUARD'}|${d}`; groups.set(k, (groups.get(k) || 0) + 1); }
        [...groups.entries()].sort((x, y) => x[0].split('|')[0].localeCompare(y[0].split('|')[0]) || +y[0].split('|')[1] - +x[0].split('|')[1]).forEach(([k, n]) => {
          const [trade, d] = k.split('|'); const rt = rateFor(p, trade);
          lines.push({ desc: (multi ? p.name + ' – ' : '') + `${fmtMonYY(m)}  ${n} ${unitFor(trade)} @ ${d} Days`, rate: rt, amount: round2(n * rt * +d / D), vat: +b.vat || 0, src: { pid, m, md: n * +d }, noRate: !rt });
        });
        continue;
      }
      let amt = 0, desc = '';
      switch (b.basis) {
        case 'monthly_26': case 'monthly_30': { const div = b.basis === 'monthly_26' ? 26 : 30; amt = md * rate / div; desc = `${fmtMonYY(m)}  ${md} man-days (${unit}) @ ${money(rate)} / ${div}`; break; }
        case 'daily': amt = md * rate; desc = `${fmtMonYY(m)}  ${md} man-days (${unit})`; break;
        case 'hourly': { const h = +S.settings.shiftHours || 12; amt = md * h * rate; desc = `${fmtMonYY(m)}  ${md} shifts × ${h} hrs = ${md * h} hrs (${unit})`; break; }
        case 'lump': amt = rate; desc = `Security services for the month of ${MONTH_FULL[+m.slice(5) - 1][0] + MONTH_FULL[+m.slice(5) - 1].slice(1).toLowerCase()} ${m.slice(0, 4)}`; break;
        case 'fixed': { const q = +b.posts || 0; amt = q * rate; desc = `${fmtMonYY(m)}  ${q} ${unit} @ ${D} Days`; break; }
        default: { const q = md / D; amt = md * rate / D; desc = `${fmtMonYY(m)}  ${qtyFmt(q)} ${unit} @ ${D} Days`; }
      }
      lines.push({ desc: (multi ? p.name + ' – ' : '') + desc, rate, amount: round2(amt), vat: +b.vat || 0, src: { pid, m, md } });
    }
  }
  return lines;
}
function invTotals(dr) {
  let ex = 0, vat = 0;
  for (const l of dr.lines) { ex += +l.amount || 0; vat += round2((+l.amount || 0) * (+l.vat || 0) / 100); }
  return { ex: round2(ex), vat: round2(vat), inc: round2(ex + vat) };
}

function numberWords(n) {
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const t = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const w = x => x < 20 ? a[x] : x < 100 ? t[Math.floor(x / 10)] + (x % 10 ? '-' + a[x % 10] : '') : a[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' and ' + w(x % 100) : '');
  const parts = [[1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand'], [1, '']];
  let int = Math.floor(n), out = [];
  for (const [v, l] of parts) { const q = Math.floor(int / v); if (q) { out.push(w(q) + (l ? ' ' + l : '')); int -= q * v; } }
  const fils = Math.round((n - Math.floor(n)) * 100);
  return 'AED ' + (out.join(' ') || 'Zero') + (fils ? ` and ${w(fils)} Fils` : '') + ' Only';
}

/** SAP-style amount in words: EIGHTY-TWO THOUSAND AED */
function sapWords(n) {
  const w = numberWords(Math.floor(n)).replace(/^AED /, '').replace(/ Only$/, '').replace(/ and /g, ' ').toUpperCase();
  const f = Math.round((n - Math.floor(n)) * 100);
  return w + (f ? ` AND ${numberWords(f).replace(/^AED /, '').replace(/ Only$/, '').toUpperCase()} FILS` : '') + ' ' + (S.settings.currency || 'AED');
}
/** Month as typed on the SAP invoices: full name up to 5 letters (March, April, May, June, July), else short (Jan, Feb, Sep) */
const sapMonth = ym => { const f = MONTH_FULL[+ym.slice(5) - 1]; return f.length <= 5 ? f[0] + f.slice(1).toLowerCase() : MON[+ym.slice(5) - 1]; };
/** Lines on the SAP invoice: one per month and rate, "Security Services - Jan'26", Qty = persons (amount ÷ rate) */
function sapLines(dr) {
  const out = [], by = new Map();
  for (const l of dr.lines) {
    if (!l.src?.m) { out.push({ desc: l.desc, qty: l.rate ? round2(l.amount / l.rate) : 1, rate: +l.rate || +l.amount, amount: +l.amount || 0, vat: +l.vat || 0 }); continue; }
    const k = l.src.m + '|' + l.rate + '|' + (l.vat || 0);
    const g = by.get(k) || by.set(k, { desc: `Security Services - ${sapMonth(l.src.m)}'${l.src.m.slice(2, 4)}`, qty: 0, rate: +l.rate, amount: 0, vat: +l.vat || 0 }).get(k);
    g.amount = round2(g.amount + (+l.amount || 0));
  }
  for (const g of by.values()) { g.qty = g.rate ? round2(g.amount / g.rate) : 1; out.push(g); }
  return out;
}
const qtyTxt = q => Number.isInteger(q) ? String(q) : qtyFmt(q);
const int0 = n => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

/** Page 1 of the pack – the tax invoice with the SAP fields (layout of invoice 2026-0900000689) */
function sapInvoiceHTML(dr) {
  const st = S.settings, c = IX.client.get(dr.clientId), tt = invTotals(dr), L = sapLines(dr), bk = st.bank || {};
  const adv = +dr.advance || 0, ret = +dr.retention || 0, net = round2(tt.inc - adv - ret);
  const vatTxt = v => v ? v + '%' : 'Out Of Scope';
  return `<div class="sheet port sap">
    <div class="sap-logo"><img src="${LOGO}" alt="Latinem Securities"></div>
    <div class="sap-from">${esc(st.invAddress).replace(/\n/g, '<br>')}</div>
    <div class="sap-t">Invoice</div>
    <table class="sap-hd"><tr><td>
      <div><b>Customer Name</b> &nbsp;: ${esc(c?.name || dr.entity || '')}</div>
      <div class="pre">${esc(dr.custAddress || c?.address || '')}</div>
      <div style="margin-top:6px"><b>Customer Ref No</b> :${esc(dr.poNo)}</div>
      <div><b>Customer TRN</b> &nbsp;&nbsp;&nbsp;: ${esc(dr.trn || c?.trn || '')}</div>
    </td><td>
      <table class="kv0">${[['Invoice Number', dr.no], ['Invoice Date', fmtDMY(dr.date)], ['Currency', st.currency || 'AED'], ['Payment Terms', dr.payTerms || st.payTerms], ['Project Name', dr.sapProject], ['Project/Order Code', dr.orderCode]].map(([k, v]) => `<tr><td><b>${k}</b></td><td>:${esc(v || '')}</td></tr>`).join('')}</table>
    </td></tr></table>
    <table class="sap-l"><thead><tr><th style="width:44px">Sr.No</th><th>Particulars/description</th><th style="width:48px">Qty</th><th style="width:88px">Rate</th><th style="width:92px">Amount (${esc(st.currency || 'AED')})</th><th style="width:92px">VAT%</th><th style="width:70px">VAT Amt</th><th style="width:94px">Total Amount</th></tr></thead><tbody>
      ${L.map((l, i) => { const va = round2(l.amount * l.vat / 100); return `<tr><td class="c">${i + 1}</td><td>${esc(l.desc)}</td><td class="c">${qtyTxt(l.qty)}</td><td class="c">${int0(l.rate)}</td><td class="c">${int0(l.amount)}</td><td class="c">${vatTxt(l.vat)}</td><td class="c">${int0(va)}</td><td class="c">${int0(l.amount + va)}</td></tr>`; }).join('')}
      <tr class="b"><td colspan="2" class="c">Total Amount of Invoice</td><td></td><td></td><td class="c">${int0(tt.ex)}</td><td></td><td class="c">${int0(tt.vat)}</td><td class="c">${int0(tt.inc)}</td></tr>
      <tr class="b"><td colspan="2" class="c">Advance Adjustment, if any</td><td></td><td></td><td class="c">${int0(adv)}</td><td></td><td></td><td class="c">${int0(adv)}</td></tr>
      <tr class="b"><td colspan="2" class="c">Retention Adjustment, if any</td><td></td><td></td><td class="c">${int0(ret)}</td><td></td><td></td><td class="c">${int0(ret)}</td></tr>
      <tr class="b"><td colspan="2" class="c">Net Amount Due for payment</td><td></td><td></td><td class="c">${int0(round2(tt.ex - adv - ret))}</td><td></td><td class="c">${int0(tt.vat)}</td><td class="c"><b>${int0(net)}</b></td></tr>
    </tbody></table>
    <div class="sap-w"><b>Amount in words :</b> ${esc(sapWords(net))}</div>
    <div class="sap-bank"><b>Bank Details</b>
      <table class="kv0">${[['Account Name', bk.name], ['Bank Name', bk.bank], ['Account Numbe', bk.acct], ['IBAN Number', bk.iban], ['Swift Code', bk.swift]].map(([k, v]) => `<tr><td><b>${k}</b></td><td>: ${esc(v || '')}</td></tr>`).join('')}</table></div>
    <div class="sap-decl"><b>Declaration / Remarks :</b> &nbsp;&nbsp;&nbsp; ${esc(dr.notes || st.declaration)}</div>
  </div>`;
}

/** Page 2 – TAX INVOICE AMOUNT BREAK-UP, as in the Elwood pack */
function invoiceHTML(dr) {
  const st = S.settings, c = IX.client.get(dr.clientId); const tt = invTotals(dr);
  const desc = l => { const m = l.desc.match(/^(.*?)([A-Z][a-z]{2}-\d{2})\s{2,}(.*)$/); return m ? `<b>${esc(m[1] + m[2])}</b><br>${esc(m[3])}` : esc(l.desc); };
  const addr = [...st.address.split('\n'), 'Tel : ' + st.tel, 'TRN No : ' + st.trn];
  const d = new Date();
  return `<div class="sheet port bu">
    <div class="bu-top"><span>${esc(st.companyShort)}</span><span>${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}</span></div>
    <div class="bu-logo"><img src="${LOGO}" alt=""></div>
    <div class="bu-t">TAX INVOICE AMOUNT BREAK-UP</div>
    <table class="bu-hd"><tbody>
      <tr><td class="l"><b>${esc(dr.entity || c?.name || '')}</b></td><td class="k">Entity</td><td class="v"><b>${esc(st.company)}</b></td></tr>
      ${[['TRN NO', st.trn], ['Invoice No', dr.no], ['Invoice Date', fmtDotDMY(dr.date)], ['PO No', dr.poNo], ['Customer Code', dr.customerCode]].map(([k, v], i) => `<tr><td class="l"><b>${esc(addr[i] || '')}</b></td><td class="k">${k}</td><td class="v"><b>${esc(v || '')}</b></td></tr>`).join('')}
      ${addr.slice(5).map(a => `<tr><td class="l"><b>${esc(a)}</b></td><td></td><td></td></tr>`).join('')}
    </tbody></table>
    <table class="bu-l"><thead><tr><th>Sl.No</th><th style="text-align:left">Description</th><th>Unit Rate</th><th>Amount<br>Excl VAT</th><th>VAT</th><th>VAT Amount</th><th>Amount<br>Incl VAT</th></tr></thead><tbody>
    ${dr.lines.map((l, i) => { const va = round2((+l.amount || 0) * (+l.vat || 0) / 100); return `<tr><td class="c">${i + 1}</td><td>${desc(l)}</td><td class="n">${money(l.rate)}</td><td class="n">${money(l.amount)}</td><td class="c">${+l.vat || 0}%</td><td class="c">${va ? money(va) : '-'}</td><td class="n">${money((+l.amount || 0) + va)}</td></tr>`; }).join('')}
    </tbody></table>
    <table class="bu-tot"><tr><td>Total Amount Excluding VAT</td><td>${money(tt.ex)}</td></tr><tr><td>VAT</td><td>${tt.vat ? money(tt.vat) : '-'}</td></tr><tr class="last"><td>Total Amount Including VAT</td><td>${money(tt.inc)}</td></tr></table>
    <div class="bu-pg">Page 1 of 1</div>
  </div>`;
}

/** The pack in the Elwood order: 1 SAP invoice · 2 break-up · 3… one client timesheet per month and project */
function packPages(dr) {
  const pages = [];
  if (dr.withSap !== false) pages.push({ t: 'Tax invoice (SAP fields)', html: sapInvoiceHTML(dr) });
  pages.push({ t: 'Tax invoice amount break-up', html: invoiceHTML(dr) });
  if (dr.attachTs) for (const m of monthsBetween(dr.from, dr.to)) for (const pid of dr.projectIds) pages.push({ t: `Timesheet ${fmtMonYY(m)} · ${IX.proj.get(pid)?.name || ''}`, html: tsSheetHTML(buildTimesheet(pid, m)) });
  return pages;
}

function parseSapText(txt, dr) {
  const map = [[/invoice\s*(no|number|#)/i, 'no'], [/invoice\s*date|doc(ument)?\s*date|billing\s*date/i, 'date'], [/customer\s*(code|no|number)|sold.?to/i, 'customerCode'], [/\bpo\b|purchase\s*order|work\s*order|reference/i, 'poNo'], [/\btrn\b|tax\s*reg/i, 'trn'], [/entity|customer\s*name|bill.?to/i, 'entity']];
  let n = 0;
  const lines = txt.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  // format A: "Label: value" or "Label<TAB>value" per line
  for (const l of lines) {
    const m = l.match(/^([^:\t]+)[:\t]\s*(.+)$/); if (!m) continue;
    const hit = map.find(([re]) => re.test(m[1])); if (!hit) continue;
    let val = m[2].trim(); if (hit[1] === 'date') val = parseAnyDate(val) || val;
    dr[hit[1]] = val; n++;
  }
  // format B: a header row + a value row copied from an SAP list (tab separated)
  if (!n && lines.length >= 2 && lines[0].includes('\t')) {
    const hd = lines[0].split('\t'), vals = lines[1].split('\t');
    hd.forEach((h, i) => { const hit = map.find(([re]) => re.test(h)); if (hit && vals[i]) { dr[hit[1]] = hit[1] === 'date' ? (parseAnyDate(vals[i]) || vals[i]) : vals[i].trim(); n++; } });
  }
  return n;
}

function renderInvoices() {
  const v = $('#v-invoices');
  const dr = IV.draft ||= newInvoiceDraft();
  const saved = S.invoices.some(x => x.id === dr.id);
  const projs = S.projects.filter(p => !dr.clientId || p.clientId === dr.clientId).sort((a, b) => a.name.localeCompare(b.name));
  const tt = invTotals(dr);
  const tot = S.invoices.reduce((a, x) => { const inc = invTotals(x).inc, paid = +x.track?.paidAmt || (x.track?.paidOn ? inc : 0); a.i += inc; a.p += paid; return a; }, { i: 0, p: 0 });
  v.innerHTML = docHead(saved ? 'Invoice ' + esc(dr.no || '(no number)') : 'New invoice', 'choose what to bill → SAP details → lines → save & print', saved ? statusTag(dr) : '') + `<div class="dc"><div class="split">
  <div>
    ${sec('iv1', '1 · Client, projects &amp; months', `
      <div class="form">
        <label class="f">Client<select id="iv-client">${opts(S.clients.map(c => [c.id, c.name]), dr.clientId, '— all clients —')}</select></label>
        <label class="f">From month<input type="month" id="iv-from" value="${dr.from}"></label>
        <label class="f">To month<input type="month" id="iv-to" value="${dr.to}"></label>
      </div>
      <div class="listbox" style="margin-top:8px">
        ${projs.map(p => `<label><input type="checkbox" data-ip="${p.id}" ${dr.projectIds.includes(p.id) ? 'checked' : ''}> ${esc(p.name)} <span class="muted small">${esc(p.code || '')}${p.billing?.basis === 'lump' ? ' · fixed ' + money(p.billing.rate) : rateFor(p, 'SECURITY GUARD') ? ' · guard ' + money(rateFor(p, 'SECURITY GUARD')) : ' · <span class="pill warn">no rate</span>'}</span></label>`).join('') || '<div class="muted" style="padding:8px">No projects.</div>'}
      </div>`, `<span class="cnt">${dr.projectIds.length} ticked</span>`)}
    ${sec('iv2', '2 · SAP details', `
      <div class="form">
        <label class="f">Invoice No<input type="text" data-k="no" value="${esc(dr.no)}" placeholder="2026-0900000689"></label>
        <label class="f">Invoice date<input type="date" data-k="date" value="${esc(dr.date)}"></label>
        <label class="f">PO No<input type="text" data-k="poNo" value="${esc(dr.poNo)}" placeholder="INS-104N135-26-0002"></label>
        <label class="f">Customer code<input type="text" data-k="customerCode" value="${esc(dr.customerCode)}"></label>
        <label class="f">Client TRN<input type="text" data-k="trn" value="${esc(dr.trn)}"></label>
        <label class="f wide">Entity / customer name<input type="text" data-k="entity" value="${esc(dr.entity)}"></label>
        <label class="f">SAP project name<input type="text" data-k="sapProject" value="${esc(dr.sapProject || '')}" placeholder="SOBHA ELWOOD INFRASTRUCTURE"></label>
        <label class="f">Project / order code<input type="text" data-k="orderCode" value="${esc(dr.orderCode || '')}" placeholder="3020110P047"></label>
        <label class="f">Payment terms<input type="text" data-k="payTerms" value="${esc(dr.payTerms ?? S.settings.payTerms)}"></label>
        <label class="f">Advance adjustment<input type="number" step="0.01" data-k="advance" value="${+dr.advance || 0}"></label>
        <label class="f">Retention adjustment<input type="number" step="0.01" data-k="retention" value="${+dr.retention || 0}"></label>
        <label class="f wide">Customer address (SAP invoice)<textarea data-k="custAddress" placeholder="SOBHA SAPPHIRE,13TH FLOOR,AL KHAIL ROAD,BUSINESS BAY">${esc(dr.custAddress || '')}</textarea></label>
      </div>
      <details style="margin-top:8px"><summary class="muted small" style="cursor:pointer">Paste from SAP</summary>
        <textarea id="iv-paste" style="width:100%;margin-top:6px" placeholder="Lines like 'Invoice No: 2026-0900000689', or a header row + value row copied from SAP"></textarea>
        <button class="btn sm" id="iv-parse">Fill fields</button></details>`)}
    ${sec('iv3', '3 · Lines', `
      <div class="row"><button class="btn pri" id="iv-gen">Generate from attendance</button><button class="btn sm" id="iv-addl">Blank line</button>
</div>
      <div class="tw" style="margin-top:8px"><table><thead><tr><th>#</th><th>Description</th><th class="num">Unit rate</th><th class="num">Excl VAT</th><th class="num">VAT %</th><th class="num">Incl VAT</th><th></th></tr></thead><tbody>
      ${dr.lines.map((l, i) => `<tr><td>${i + 1}</td><td style="white-space:normal;min-width:260px"><input type="text" data-l="${i}" data-lk="desc" value="${esc(l.desc)}" style="width:100%">${l.src ? `<div class="muted small">${l.src.md} billable days · ${fmtMonYY(l.src.m)}</div>` : ''}</td>
        <td class="num"><input type="number" step="0.01" data-l="${i}" data-lk="rate" value="${l.rate}" style="width:95px"></td>
        <td class="num"><input type="number" step="0.01" data-l="${i}" data-lk="amount" value="${l.amount}" style="width:110px"></td>
        <td class="num"><input type="number" step="0.01" data-l="${i}" data-lk="vat" value="${l.vat}" style="width:60px"></td>
        <td class="num">${money((+l.amount || 0) * (1 + (+l.vat || 0) / 100))}</td><td><button class="btn sm bad" data-ldel="${i}">✕</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted" style="padding:12px">Tick a project, then Generate from attendance.</td></tr>'}
      <tr class="total"><td></td><td>Total</td><td></td><td class="num">${money(tt.ex)}</td><td class="num">${money(tt.vat)}</td><td class="num">${money(tt.inc)}</td><td></td></tr>
      </tbody></table></div>
      <label class="f" style="margin-top:10px">Notes on the break-up (optional)<textarea data-k="notes">${esc(dr.notes)}</textarea></label>`, `<span class="cnt">AED ${money(tt.inc)}</span>`)}
    ${saved ? sec('iv5', '5 · Track', `<div class="form">${TRACK.map(([k, l, t]) => `<label class="f">${l}<input type="${t}" data-tk="${k}" value="${esc(dr.track?.[k] ?? '')}"${t === 'number' ? ' step="0.01"' : ''}></label>`).join('')}</div>
      <p class="muted small" style="margin:8px 0 0">Same stages as the Tax Invoice Tracker. Saves straight away.</p>`, statusTag(dr)) : ''}
    ${(() => { const pg = packPages(dr); return sec('ivp', '4 · Pack', `
      <div class="row" style="margin-bottom:8px"><label class="chk"><input type="checkbox" id="iv-sap" ${dr.withSap !== false ? 'checked' : ''}> Tax invoice page</label><label class="chk"><input type="checkbox" id="iv-ts" ${dr.attachTs ? 'checked' : ''}> Client timesheets</label>
        <span class="spacer"></span><button class="btn pri" id="iv-print2" ${dr.lines.length ? '' : 'disabled'}>Print pack / PDF</button></div>
      <div class="tw"><table><tbody>${pg.map((p, i) => `<tr class="${IV.pv === i ? 'on' : ''}" data-pp="${i}" style="cursor:pointer"><td class="num" style="width:40px">${i + 1}</td><td>${esc(p.t)}</td><td class="muted small">printed here</td></tr>`).join('')}
        <tr><td class="num">${pg.length + 1}</td><td>Signed timesheet scans, if the client signs on paper</td><td class="muted small">Merge PDFs →</td></tr>
        <tr><td class="num">${pg.length + 2}</td><td>Work Order Instruction ${esc(IX.proj.get(dr.projectIds[0])?.poNo || dr.poNo || '')} (3 pages)</td><td class="muted small">Merge PDFs →</td></tr></tbody></table></div>
      <p class="muted small" style="margin:6px 0 0">Same order as Tax Invoice_Elwood Infra-January to May 2026.pdf (10 pages: invoice, break-up, 5 signed timesheets, 3-page WOI). Click a row to preview it.</p>`, `<span class="cnt">${pg.length} page(s) + attachments</span>`); })()}
    <div id="iv-preview">${dr.lines.length ? (packPages(dr)[IV.pv || 0] || packPages(dr)[0]).html : ''}</div>
  </div>
  <div>
    ${sec('ivs', 'Saved invoices', `
      ${S.invoices.length ? `<div class="kpis" style="grid-template-columns:repeat(3,1fr)"><div class="kpi"><div class="l">Invoiced</div><div class="v" style="font-size:14px">${money(tot.i)}</div></div><div class="kpi" style="--c:var(--pos)"><div class="l">Paid</div><div class="v" style="font-size:14px">${money(tot.p)}</div></div><div class="kpi" style="--c:var(--neg)"><div class="l">Outstanding</div><div class="v" style="font-size:14px">${money(tot.i - tot.p)}</div></div></div>` : ''}
      <div class="tw" style="max-height:420px"><table><tbody>
      ${[...S.invoices].reverse().map(x => `<tr class="${x.id === dr.id ? 'on' : ''}"><td style="white-space:normal"><b>${esc(x.no || '(no number)')}</b><div class="muted small">${esc(IX.proj.get(x.projectIds?.[0])?.name || IX.client.get(x.clientId)?.name || x.entity || '')} · ${fmtMonYY(x.from)}${x.to !== x.from ? ' – ' + fmtMonYY(x.to) : ''}</div></td>
        <td class="num">${money(invTotals(x).inc)}<div>${statusTag(x)}</div></td><td style="text-align:right"><button class="btn sm" data-iopen="${x.id}">Open</button> <button class="btn sm bad" data-idel="${x.id}">✕</button></td></tr>`).join('') || '<tr><td class="muted">None yet</td></tr>'}
      </tbody></table></div>`, `<span class="cnt">${S.invoices.length}</span>`)}
    ${sec('ivm', 'Merge PDFs into one pack', `
      <p class="muted small" style="margin:0 0 8px">Printed pack PDF first, then signed timesheet scans and the Work Order Instruction.</p>
      <label class="btn wide" style="display:block;text-align:center">Add PDF files…<input type="file" id="iv-pdfs" accept="application/pdf" multiple hidden></label>
      <table style="margin-top:6px"><tbody>${IV.pdfs.map((f, i) => `<tr><td class="small" style="white-space:normal">${i + 1}. ${esc(f.name)}</td><td style="text-align:right"><button class="btn sm" data-pu="${i}">↑</button><button class="btn sm" data-pd="${i}">↓</button><button class="btn sm bad" data-px="${i}">✕</button></td></tr>`).join('')}</tbody></table>
      <label class="f" style="margin-top:8px">File name<input type="text" id="iv-pdfname" value="${esc(defaultPackName(dr))}"></label>
      <div class="row end" style="margin-top:8px"><button class="btn pri" id="iv-merge" ${IV.pdfs.length < 1 ? 'disabled' : ''}>Merge &amp; download</button></div>`)}
  </div></div></div>`;
  bindSecs(v);
  const rer = () => renderInvoices();
  $('#iv-client').onchange = e => {
    dr.clientId = e.target.value; dr.projectIds = dr.projectIds.filter(id => !dr.clientId || IX.proj.get(id)?.clientId === dr.clientId);
    const c = IX.client.get(dr.clientId); if (c) { dr.customerCode ||= c.customerCode || ''; dr.trn ||= c.trn || ''; }
    rer();
  };
  $('#iv-from').onchange = e => { dr.from = e.target.value; if (dr.to < dr.from) dr.to = dr.from; rer(); };
  $('#iv-to').onchange = e => { dr.to = e.target.value; if (dr.to < dr.from) dr.from = dr.to; rer(); };
  v.querySelectorAll('[data-ip]').forEach(c => c.onchange = () => {
    const id = c.dataset.ip;
    dr.projectIds = c.checked ? [...dr.projectIds, id] : dr.projectIds.filter(x => x !== id);
    const p = IX.proj.get(id);
    if (c.checked && p) {
      if (!dr.clientId && p.clientId) dr.clientId = p.clientId;
      const cl = IX.client.get(p.clientId);
      dr.poNo ||= p.poNo || ''; dr.entity ||= p.entityName || cl?.name || ''; dr.customerCode ||= cl?.customerCode || ''; dr.trn ||= cl?.trn || ''; dr.sapProject ||= p.sapName || ''; dr.orderCode ||= p.orderCode || ''; dr.custAddress ||= cl?.address || '';
    }
    rer();
  });
  v.querySelectorAll('[data-k]').forEach(i => { i.oninput = () => { dr[i.dataset.k] = i.type === 'number' ? +i.value || 0 : i.value; }; i.onchange = () => { if (dr.lines.length) { const y = $('#v-invoices .dc').scrollTop; rer(); $('#v-invoices .dc').scrollTop = y; } }; });
  v.querySelectorAll('[data-l]').forEach(i => i.onchange = () => { const l = dr.lines[+i.dataset.l]; l[i.dataset.lk] = i.dataset.lk === 'desc' ? i.value : +i.value; rer(); });
  v.querySelectorAll('[data-ldel]').forEach(b => b.onclick = () => { dr.lines.splice(+b.dataset.ldel, 1); rer(); });
  $('#iv-parse').onclick = () => { const n = parseSapText($('#iv-paste').value, dr); toast(n ? `Filled ${n} field(s)` : 'No recognised fields – use "Label: value" lines'); rer(); };
  $('#iv-gen').onclick = () => ivCmd('gen');
  $('#iv-addl').onclick = () => { dr.lines.push({ desc: '', rate: 0, amount: 0, vat: 0 }); rer(); };
  $('#iv-ts').onchange = e => { dr.attachTs = e.target.checked; IV.pv = 0; rer(); };
  $('#iv-sap').onchange = e => { dr.withSap = e.target.checked; IV.pv = 0; rer(); };
  $('#iv-print2').onclick = () => ivCmd('print');
  v.querySelectorAll('[data-pp]').forEach(r => r.onclick = () => { IV.pv = +r.dataset.pp; rer(); $('#iv-preview').scrollIntoView({ block: 'start' }); });
  v.querySelectorAll('[data-tk]').forEach(i => i.onchange = () => { (dr.track ||= {})[i.dataset.tk] = i.type === 'number' ? (+i.value || '') : i.value; const sv = S.invoices.find(x => x.id === dr.id); if (sv) { sv.track = { ...dr.track }; markDirty(); } rer(); });
  v.querySelectorAll('[data-iopen]').forEach(b => b.onclick = () => { IV.draft = JSON.parse(JSON.stringify(S.invoices.find(x => x.id === b.dataset.iopen))); rer(); });
  v.querySelectorAll('[data-idel]').forEach(b => b.onclick = async () => { if (!await confirmBox('Delete this saved invoice?', 'Delete', 'bad')) return; S.invoices = S.invoices.filter(x => x.id !== b.dataset.idel); markDirty(); rer(); });
  $('#iv-pdfs').onchange = e => { IV.pdfs.push(...e.target.files); rer(); };
  v.querySelectorAll('[data-pu]').forEach(b => b.onclick = () => { const i = +b.dataset.pu; if (i > 0) [IV.pdfs[i - 1], IV.pdfs[i]] = [IV.pdfs[i], IV.pdfs[i - 1]]; rer(); });
  v.querySelectorAll('[data-pd]').forEach(b => b.onclick = () => { const i = +b.dataset.pd; if (i < IV.pdfs.length - 1) [IV.pdfs[i + 1], IV.pdfs[i]] = [IV.pdfs[i], IV.pdfs[i + 1]]; rer(); });
  v.querySelectorAll('[data-px]').forEach(b => b.onclick = () => { IV.pdfs.splice(+b.dataset.px, 1); rer(); });
  $('#iv-merge').onclick = () => mergePdfs($('#iv-pdfname').value).catch(e => toast(e.message, 5000));
}
/** Toolbar / menu commands */
function ivCmd(cmd) {
  if (curView !== 'invoices') showView('invoices');
  const dr = IV.draft ||= newInvoiceDraft();
  if (cmd === 'new') { IV.draft = newInvoiceDraft(); renderInvoices(); return; }
  if (cmd === 'gen') {
    if (!dr.projectIds.length) return toast('Tick at least one project');
    dr.lines = invoiceLines(dr); renderInvoices();
    const noRate = [...new Set(dr.lines.filter(l => l.noRate).map(l => l.desc.split('@')[0].trim()))];
    if (noRate.length) toast('No rate for: ' + noRate.join(', ') + ' – enter it in Settings → Rate card or on the project', 7000);
    return;
  }
  if (cmd === 'save') { saveInvoice(dr); renderInvoices(); return; }
  if (cmd === 'print') {
    if (!dr.lines.length) return toast('Generate or add lines first');
    printHTML(packPages(dr).map(p => p.html).join(''));
  }
}
function defaultPackName(dr) {
  const c = IX.client.get(dr.clientId); const p = dr.projectIds.length === 1 ? IX.proj.get(dr.projectIds[0]) : null;
  const who = (p?.name || c?.name || 'Client').replace(/[\\/:*?"<>|]/g, '');
  const mn = ym => MONTH_FULL[+ym.slice(5) - 1].charAt(0) + MONTH_FULL[+ym.slice(5) - 1].slice(1).toLowerCase();
  const per = dr.from === dr.to ? `${mn(dr.from)} ${dr.from.slice(0, 4)}`
    : dr.from.slice(0, 4) === dr.to.slice(0, 4) ? `${mn(dr.from)} to ${mn(dr.to)} ${dr.to.slice(0, 4)}`
    : `${mn(dr.from)} ${dr.from.slice(0, 4)} to ${mn(dr.to)} ${dr.to.slice(0, 4)}`;
  return `Tax Invoice_${who}-${per}.pdf`;
}
const TRACK = [['tsSent', 'Timesheet submitted to client', 'date'], ['tsApproved', 'Approval from client', 'date'], ['invSent', 'Invoice submitted to client', 'date'], ['invProcessed', 'Invoice processing', 'date'], ['spcNo', 'SPC No', 'text'], ['paidOn', 'Payment received', 'date'], ['paidAmt', 'Amount received (blank = full)', 'number']];
function statusTag(x) {
  const t = x.track || {};
  const inc = invTotals(x).inc, paid = +t.paidAmt || 0;
  const [l, c] = t.paidOn || paid >= inc - 0.01 ? (paid && paid < inc - 0.01 ? ['Part paid', 'warn'] : ['Paid', 'pos']) : paid ? ['Part paid', 'warn'] : t.invProcessed ? ['Processed', ''] : t.invSent ? ['Invoice sent', ''] : t.tsApproved ? ['TS approved', ''] : t.tsSent ? ['TS sent', ''] : ['Draft', 'warn'];
  return `<span class="pill ${c}">${l}</span>`;
}
function saveInvoice(dr) {
  const i = S.invoices.findIndex(x => x.id === dr.id);
  const copy = JSON.parse(JSON.stringify(dr)); copy.savedAt = new Date().toISOString();
  if (i >= 0) S.invoices[i] = copy; else S.invoices.push(copy);
  markDirty(); toast('Invoice saved');
}
async function mergePdfs(name) {
  await loadScript(LIB.pdflib);
  const out = await PDFLib.PDFDocument.create();
  for (const f of IV.pdfs) {
    const src = await PDFLib.PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices()); pages.forEach(p => out.addPage(p));
  }
  const bytes = await out.save();
  downloadBlob(new Blob([bytes], { type: 'application/pdf' }), (name || 'Invoice pack').replace(/\.pdf$/i, '') + '.pdf');
  toast(`Merged ${IV.pdfs.length} file(s) · ${out.getPageCount()} pages`);
}
