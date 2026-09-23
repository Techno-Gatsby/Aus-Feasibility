/* =====================================================================
   Invoice builder: pick client + projects + months, add SAP fields,
   generate lines from attendance, print invoice + timesheets, merge PDFs
   ===================================================================== */
const IV = { draft: null, pdfs: [] };

function newInvoiceDraft() {
  const m = addMonths(ymOf(todayISO()), -1);
  return { id: uid('i'), no: '', date: todayISO(), clientId: '', projectIds: [], from: m, to: m, entity: '', trn: '', customerCode: '', poNo: '', lines: [], attachTs: true, notes: '' };
}

function invoiceLines(dr) {
  const lines = [];
  const multi = dr.projectIds.length > 1;
  for (const m of monthsBetween(dr.from, dr.to)) {
    for (const pid of dr.projectIds) {
      const p = IX.proj.get(pid); if (!p) continue;
      const b = p.billing || {}; const rate = +b.rate || 0; const unit = b.unit || 'Security';
      const md = buildTimesheet(pid, m).total; const D = dim(m);
      if (!md && b.basis !== 'fixed') continue;           // nothing worked on this project that month
      let amt = 0, desc = '';
      switch (b.basis) {
        case 'monthly_26': case 'monthly_30': { const div = b.basis === 'monthly_26' ? 26 : 30; amt = md * rate / div; desc = `${fmtMonYY(m)}  ${md} man-days (${unit}) @ ${money(rate)} / ${div}`; break; }
        case 'daily': amt = md * rate; desc = `${fmtMonYY(m)}  ${md} man-days (${unit})`; break;
        case 'hourly': { const h = +S.settings.shiftHours || 12; amt = md * h * rate; desc = `${fmtMonYY(m)}  ${md} shifts × ${h} hrs = ${md * h} hrs (${unit})`; break; }
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

function invoiceHTML(dr) {
  const st = S.settings, c = IX.client.get(dr.clientId); const tt = invTotals(dr);
  return `<div class="sheet port inv">
    <div class="ihead"><div class="logo">${esc(st.companyShort)}</div><div class="small" style="text-align:right">TRN No : ${esc(st.trn)}<br>Tel : ${esc(st.tel)}</div></div>
    <div class="ttl">TAX INVOICE</div>
    <div class="blocks">
      <div class="addr"><b>${esc(st.company)}</b>\n${esc(st.address)}\nTel : ${esc(st.tel)}\nTRN No : ${esc(st.trn)}</div>
      <table class="kv">
        <tr><td>Entity</td><td>${esc(dr.entity || c?.name || '')}</td></tr>
        <tr><td>TRN NO</td><td>${esc(dr.trn)}</td></tr>
        <tr><td>Invoice No</td><td>${esc(dr.no)}</td></tr>
        <tr><td>Invoice Date</td><td>${fmtDotDMY(dr.date)}</td></tr>
        <tr><td>PO No</td><td>${esc(dr.poNo)}</td></tr>
        <tr><td>Customer Code</td><td>${esc(dr.customerCode)}</td></tr>
      </table>
    </div>
    <table class="lines"><thead><tr><th>Sl.No</th><th>Description</th><th>Unit Rate</th><th>Amount Excl VAT</th><th>VAT</th><th>VAT Amount</th><th>Amount Incl VAT</th></tr></thead><tbody>
    ${dr.lines.map((l, i) => { const va = round2((+l.amount || 0) * (+l.vat || 0) / 100); return `<tr><td>${i + 1}</td><td>${esc(l.desc)}</td><td class="num">${money(l.rate)}</td><td class="num">${money(l.amount)}</td><td class="num">${+l.vat || 0}%</td><td class="num">${va ? money(va) : '-'}</td><td class="num">${money((+l.amount || 0) + va)}</td></tr>`; }).join('')}
    <tr class="tt"><td></td><td colspan="2">TOTAL</td><td class="num">${money(tt.ex)}</td><td></td><td class="num">${tt.vat ? money(tt.vat) : '-'}</td><td class="num">${money(tt.inc)}</td></tr>
    </tbody></table>
    <h4 style="margin:18px 0 6px">AMOUNT BREAK-UP</h4>
    <table class="kv" style="min-width:360px">
      <tr><td>Total Amount Excluding VAT</td><td class="num" style="text-align:right">${money(tt.ex)}</td></tr>
      <tr><td>VAT</td><td style="text-align:right">${tt.vat ? money(tt.vat) : '-'}</td></tr>
      <tr><td>Total Amount Including VAT</td><td style="text-align:right"><b>${money(tt.inc)}</b></td></tr>
    </table>
    <div class="words">${esc(numberWords(tt.inc))}</div>
    ${dr.notes ? `<p style="white-space:pre-line;margin-top:10px">${esc(dr.notes)}</p>` : ''}
    <div class="foot"><div>Prepared by: ${esc(st.preparedBy)}</div><div>For ${esc(st.company)}<br><br><br>Authorised Signatory</div></div>
  </div>`;
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
  const projs = S.projects.filter(p => !dr.clientId || p.clientId === dr.clientId).sort((a, b) => a.name.localeCompare(b.name));
  const tt = invTotals(dr);
  v.innerHTML = `<div class="row" style="align-items:flex-start;gap:14px">
  <div style="flex:1 1 640px;min-width:0">
    <div class="card">
      <div class="row"><h2 style="margin:0">${S.invoices.some(x => x.id === dr.id) ? 'Edit invoice' : 'New invoice'}</h2><span class="grow"></span><button class="btn sm" id="iv-new">Start new</button></div>
      <h3>1 · Client, projects and period</h3>
      <div class="grid2">
        <label class="f">Client<select id="iv-client">${opts(S.clients.map(c => [c.id, c.name]), dr.clientId, '— all clients —')}</select></label>
        <label class="f">From month<input type="month" id="iv-from" value="${dr.from}"></label>
        <label class="f">To month<input type="month" id="iv-to" value="${dr.to}"></label>
      </div>
      <div style="margin-top:8px;max-height:170px;overflow:auto;border:1px solid var(--line);border-radius:6px;padding:6px 10px">
        ${projs.map(p => `<label class="chk" style="display:flex;margin:3px 0"><input type="checkbox" data-ip="${p.id}" ${dr.projectIds.includes(p.id) ? 'checked' : ''}> ${esc(p.name)} <span class="muted small">${esc(p.code || '')} · ${esc(IX.client.get(p.clientId)?.name || 'no client')}${p.billing?.rate ? ' · ' + money(p.billing.rate) : ' · <span class="tag warn">no rate</span>'}</span></label>`).join('') || '<span class="muted">No projects.</span>'}
      </div>
      <h3>2 · SAP details</h3>
      <div class="grid2">
        <label class="f">Invoice No<input type="text" data-k="no" value="${esc(dr.no)}" placeholder="2026-0900000689"></label>
        <label class="f">Invoice date<input type="date" data-k="date" value="${esc(dr.date)}"></label>
        <label class="f">PO No<input type="text" data-k="poNo" value="${esc(dr.poNo)}"></label>
        <label class="f">Customer code<input type="text" data-k="customerCode" value="${esc(dr.customerCode)}"></label>
        <label class="f">TRN No<input type="text" data-k="trn" value="${esc(dr.trn)}"></label>
        <label class="f" style="grid-column:1/-1">Entity<input type="text" data-k="entity" value="${esc(dr.entity)}"></label>
      </div>
      <details style="margin-top:8px"><summary class="small" style="cursor:pointer">Paste from SAP…</summary>
        <textarea id="iv-paste" style="width:100%;margin-top:6px" placeholder="Paste lines like 'Invoice No: 2026-0900000689' or a header row + value row copied from an SAP list"></textarea>
        <button class="btn sm" id="iv-parse">Fill fields</button></details>
      <h3>3 · Lines</h3>
      <div class="row"><button class="btn pri" id="iv-gen">Generate lines from attendance</button><button class="btn sm" id="iv-addl">+ Blank line</button>
        <label class="chk small"><input type="checkbox" id="iv-ts" ${dr.attachTs ? 'checked' : ''}> include client timesheets after the invoice</label></div>
      <table class="t" style="margin-top:8px"><thead><tr><th>#</th><th>Description</th><th class="num">Unit rate</th><th class="num">Amount excl VAT</th><th class="num">VAT %</th><th class="num">Incl VAT</th><th></th></tr></thead><tbody>
      ${dr.lines.map((l, i) => `<tr><td>${i + 1}</td><td><input type="text" data-l="${i}" data-lk="desc" value="${esc(l.desc)}" style="width:100%">${l.src ? `<div class="small muted">${l.src.md} billable days in ${fmtMonYY(l.src.m)}</div>` : ''}</td>
        <td class="num"><input type="number" step="0.01" data-l="${i}" data-lk="rate" value="${l.rate}" style="width:95px"></td>
        <td class="num"><input type="number" step="0.01" data-l="${i}" data-lk="amount" value="${l.amount}" style="width:110px"></td>
        <td class="num"><input type="number" step="0.01" data-l="${i}" data-lk="vat" value="${l.vat}" style="width:60px"></td>
        <td class="num">${money((+l.amount || 0) * (1 + (+l.vat || 0) / 100))}</td><td><button class="btn sm bad" data-ldel="${i}">✕</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">No lines yet.</td></tr>'}
      <tr><td></td><td><b>Total</b></td><td></td><td class="num"><b>${money(tt.ex)}</b></td><td class="num">${money(tt.vat)}</td><td class="num"><b>${money(tt.inc)}</b></td><td></td></tr>
      </tbody></table>
      <label class="f" style="margin-top:10px">Notes on invoice (optional)<textarea data-k="notes">${esc(dr.notes)}</textarea></label>
      <div class="row end" style="margin-top:12px">
        <button class="btn" id="iv-prev">Preview</button>
        <button class="btn" id="iv-save">Save invoice</button>
        <button class="btn pri" id="iv-print">Print pack / Save as PDF</button>
      </div>
    </div>
    <div id="iv-preview"></div>
  </div>
  <div style="flex:0 1 440px;min-width:320px">
    <div class="card"><h2>Saved invoices</h2>
      <table class="t"><thead><tr><th>No</th><th>Client</th><th>Period</th><th class="num">Amount</th><th></th></tr></thead><tbody>
      ${[...S.invoices].reverse().map(x => `<tr><td>${esc(x.no || '(no number)')}<div class="small muted">${fmtDMY(x.date)}</div></td><td class="small">${esc(IX.client.get(x.clientId)?.name || x.entity || '')}</td>
        <td class="small">${fmtMonYY(x.from)}${x.to !== x.from ? ' – ' + fmtMonYY(x.to) : ''}</td><td class="num">${money(invTotals(x).inc)}</td>
        <td><button class="btn sm" data-iopen="${x.id}">Open</button> <button class="btn sm bad" data-idel="${x.id}">✕</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">None yet</td></tr>'}
      </tbody></table></div>
    <div class="card"><h2>Merge PDFs into one pack</h2>
      <p class="hint" style="margin-top:0">Add the invoice pack you saved as PDF, the Work Order Instruction from SAP and any signed/scanned timesheets. Put them in order and download one file – like "Tax Invoice_Elwood Infra-January to May 2026.pdf".</p>
      <input type="file" id="iv-pdfs" accept="application/pdf" multiple>
      <table class="t" style="margin-top:6px"><tbody>${IV.pdfs.map((f, i) => `<tr><td class="small">${i + 1}. ${esc(f.name)}</td><td style="white-space:nowrap;text-align:right"><button class="btn sm" data-pu="${i}">↑</button><button class="btn sm" data-pd="${i}">↓</button><button class="btn sm bad" data-px="${i}">✕</button></td></tr>`).join('')}</tbody></table>
      <label class="f" style="margin-top:8px">File name<input type="text" id="iv-pdfname" value="${esc(defaultPackName(dr))}"></label>
      <div class="row end" style="margin-top:8px"><button class="btn pri" id="iv-merge" ${IV.pdfs.length < 1 ? 'disabled' : ''}>Merge &amp; download</button></div>
    </div>
  </div></div>`;

  const rer = () => renderInvoices();
  $('#iv-new').onclick = () => { IV.draft = newInvoiceDraft(); rer(); };
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
      dr.poNo ||= p.poNo || ''; dr.entity ||= p.entityName || cl?.name || ''; dr.customerCode ||= cl?.customerCode || ''; dr.trn ||= cl?.trn || '';
    }
    rer();
  });
  v.querySelectorAll('[data-k]').forEach(i => i.oninput = () => { dr[i.dataset.k] = i.value; });
  v.querySelectorAll('[data-l]').forEach(i => i.onchange = () => { const l = dr.lines[+i.dataset.l]; l[i.dataset.lk] = i.dataset.lk === 'desc' ? i.value : +i.value; rer(); });
  v.querySelectorAll('[data-ldel]').forEach(b => b.onclick = () => { dr.lines.splice(+b.dataset.ldel, 1); rer(); });
  $('#iv-parse').onclick = () => { const n = parseSapText($('#iv-paste').value, dr); toast(n ? `Filled ${n} field(s)` : 'No recognised fields – use "Label: value" lines'); rer(); };
  $('#iv-gen').onclick = () => {
    if (!dr.projectIds.length) return toast('Tick at least one project');
    dr.lines = invoiceLines(dr); rer();
    const noRate = dr.projectIds.filter(id => !IX.proj.get(id)?.billing?.rate).map(id => IX.proj.get(id)?.name);
    if (noRate.length) toast('No rate set for: ' + noRate.join(', '), 5000);
  };
  $('#iv-addl').onclick = () => { dr.lines.push({ desc: '', rate: 0, amount: 0, vat: 0 }); rer(); };
  $('#iv-ts').onchange = e => dr.attachTs = e.target.checked;
  $('#iv-prev').onclick = () => { $('#iv-preview').innerHTML = invoiceHTML(dr); $('#iv-preview').scrollIntoView({ behavior: 'smooth' }); };
  $('#iv-save').onclick = () => { saveInvoice(dr); rer(); };
  $('#iv-print').onclick = () => {
    if (!dr.lines.length) return toast('Generate or add lines first');
    let html = invoiceHTML(dr);
    if (dr.attachTs) for (const m of monthsBetween(dr.from, dr.to)) for (const pid of dr.projectIds) html += tsSheetHTML(buildTimesheet(pid, m));
    printHTML(html);
  };
  v.querySelectorAll('[data-iopen]').forEach(b => b.onclick = () => { IV.draft = JSON.parse(JSON.stringify(S.invoices.find(x => x.id === b.dataset.iopen))); rer(); });
  v.querySelectorAll('[data-idel]').forEach(b => b.onclick = async () => { if (!await confirmBox('Delete this saved invoice?', 'Delete', 'bad')) return; S.invoices = S.invoices.filter(x => x.id !== b.dataset.idel); markDirty(); rer(); });
  $('#iv-pdfs').onchange = e => { IV.pdfs.push(...e.target.files); rer(); };
  v.querySelectorAll('[data-pu]').forEach(b => b.onclick = () => { const i = +b.dataset.pu; if (i > 0) [IV.pdfs[i - 1], IV.pdfs[i]] = [IV.pdfs[i], IV.pdfs[i - 1]]; rer(); });
  v.querySelectorAll('[data-pd]').forEach(b => b.onclick = () => { const i = +b.dataset.pd; if (i < IV.pdfs.length - 1) [IV.pdfs[i + 1], IV.pdfs[i]] = [IV.pdfs[i], IV.pdfs[i + 1]]; rer(); });
  v.querySelectorAll('[data-px]').forEach(b => b.onclick = () => { IV.pdfs.splice(+b.dataset.px, 1); rer(); });
  $('#iv-merge').onclick = () => mergePdfs($('#iv-pdfname').value).catch(e => toast(e.message, 5000));
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
