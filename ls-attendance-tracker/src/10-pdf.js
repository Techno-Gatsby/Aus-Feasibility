/* =====================================================================
   PDF documents for the invoice pack: read pages (pdf.js), recognise what
   each page is (SAP invoice · break-up · signed timesheet · Work Order
   Instruction), pick invoice fields out of the text, render generated
   sheets to images (html2canvas) and build one pack PDF (pdf-lib).
   ===================================================================== */
const PDFX = (() => {
  let pdfjs = null;
  async function lib() {
    if (pdfjs) return pdfjs;
    const m = await import(LIB.pdfjs);
    try { m.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([`export * from "${LIB.pdfjsWorker}";`], { type: 'text/javascript' })); } catch (e) { }
    return pdfjs = m;
  }
  /** Pages of a PDF: { i, w, h, land, text, hasText, thumb } */
  async function pages(blob, { thumbs = true, scale = 0.22 } = {}) {
    const P = await lib();
    const doc = await P.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
    const out = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i), vp = pg.getViewport({ scale: 1 });
      const tc = await pg.getTextContent(); const text = tc.items.map(x => x.str).join(' ').replace(/\s+/g, ' ').trim();
      let thumb = '';
      if (thumbs) { try { const v2 = pg.getViewport({ scale }); const c = document.createElement('canvas'); c.width = Math.round(v2.width); c.height = Math.round(v2.height); await pg.render({ canvasContext: c.getContext('2d'), viewport: v2 }).promise; thumb = c.toDataURL('image/jpeg', .72); } catch (e) { } }
      out.push({ i, w: vp.width, h: vp.height, land: vp.width > vp.height, text, hasText: text.length > 40, thumb });
    }
    return { n: doc.numPages, pages: out };
  }
  const KINDS = { sap: 'SAP tax invoice', breakup: 'Amount break-up', ts: 'Signed timesheet', woi: 'Work Order Instruction', other: 'Other' };
  const KIND_COLORS = { sap: '#1766CB', breakup: '#6B7A94', ts: '#2B6A52', woi: '#5B4AB8', other: '#93A0B5' };
  /** Label each page. Text pages by their words; image-only pages by position: a portrait scan before anything else is the SAP invoice, later scans are signed timesheets. */
  function classify(pages, ctx = {}) {
    const woiNo = (ctx.poNo || '').trim();
    let seenInv = false;
    return pages.map(p => {
      const t = p.text; let k = 'other';
      if (/WORK\s*ORDER\s*INSTRUCTION|Sub\s*-?\s*Contractor\s*Name|Procurement\s*Team|End of Page|condition precedent/i.test(t) || (woiNo && t.includes(woiNo) && !/Sl\.?\s*No/i.test(t) && !/Invoice\s*No/i.test(t))) k = 'woi';
      else if (/Sl\.?\s*No.*Description.*Unit\s*Rate.*Amount/i.test(t) || /AMOUNT\s*BREAK\s*-?\s*UP/i.test(t)) k = 'breakup';
      else if (/TAX\s*INVOICE|Invoice\s*(No|Number|Date)|Customer\s*Ref|Bill\s*to/i.test(t)) k = 'sap';
      else if (/TIME\s*SHEET|LS\/DO\/F-026|ATTENDANCE|RELIEVER/i.test(t)) k = 'ts';
      else if (!p.hasText) k = (!seenInv && !p.land) ? 'sap' : 'ts';
      if (k === 'sap' || k === 'breakup') seenInv = true;
      return { ...p, kind: k };
    });
  }
  /** Invoice fields found in the text: PO / WOI number, project code, SAP invoice number, date, order code, largest amount */
  function fields(pages) {
    const t = pages.map(p => p.text).join('\n'), f = {}; let m;
    if ((m = t.match(/\b(INS-[A-Z0-9]+-\d{2}-\d{4})\b/))) f.poNo = m[1];
    if ((m = t.match(/Project\s*Code\s*:?\s*([0-9]{3}[A-Z][0-9]{3})/i))) f.projectCode = m[1];
    if ((m = t.match(/\b(\d{4}-\d{10})\b/))) f.no = m[1];
    if ((m = t.match(/\b(\d{2})\.(\d{2})\.(\d{4})\b/))) f.date = `${m[3]}-${m[2]}-${m[1]}`;
    if ((m = t.match(/\b(3\d{6}P\d{3})\b/))) f.orderCode = m[1];
    const amts = [...t.matchAll(/(?<![\d.])(\d{1,3}(?:,\d{3})+\.\d{2})(?![\d])/g)].map(x => +x[1].replace(/,/g, ''));
    if (amts.length) f.total = Math.max(...amts);
    return f;
  }
  /** Render a generated sheet (HTML with class "sheet") to a PNG at 2× */
  async function htmlToPng(html, land) {
    await loadScript(LIB.html2canvas);
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-30000px;top:0;background:#fff;z-index:-1';
    host.innerHTML = html; document.body.appendChild(host);
    const el = host.firstElementChild; Object.assign(el.style, { margin: '0', border: '0', boxShadow: 'none', width: land ? '1120px' : '800px', maxWidth: 'none', overflow: 'visible' });
    try { const c = await html2canvas(el, { scale: 2, backgroundColor: '#fff', logging: false, useCORS: true }); return { png: c.toDataURL('image/png'), w: c.width, h: c.height }; }
    finally { host.remove(); }
  }
  /** parts: { pdf: Blob, pages?: [0-based] } | { html, land } → one PDF Blob (A4, generated pages placed as images) */
  async function build(parts, onStep) {
    await loadScript(LIB.pdflib);
    const out = await PDFLib.PDFDocument.create(); let n = 0;
    for (const part of parts) {
      onStep?.(++n, parts.length);
      if (part.pdf) {
        const src = await PDFLib.PDFDocument.load(await part.pdf.arrayBuffer(), { ignoreEncryption: true });
        const idx = part.pages?.length ? part.pages : src.getPageIndices();
        (await out.copyPages(src, idx)).forEach(p => out.addPage(p));
      } else if (part.html) {
        const land = part.land ?? /class="sheet[^"]*\bland\b/.test(part.html);
        const img = await htmlToPng(part.html, land);
        const A4 = land ? [841.89, 595.28] : [595.28, 841.89], pg = out.addPage(A4);
        const pic = await out.embedPng(img.png), M = 20, W = A4[0] - 2 * M, H = A4[1] - 2 * M;
        const k = Math.min(W / pic.width, H / pic.height), w = pic.width * k, h = pic.height * k;
        pg.drawImage(pic, { x: (A4[0] - w) / 2, y: A4[1] - M - h, width: w, height: h });
      }
    }
    return new Blob([await out.save()], { type: 'application/pdf' });
  }
  const subset = (blob, idx) => build([{ pdf: blob, pages: idx }]);
  /** Save a PDF (whole or some pages) into the file store; returns the document record */
  async function store(blob, { name, kind = 'other', pages: idx } = {}) {
    const b = idx?.length ? await subset(blob, idx) : blob;
    let n = idx?.length || 0;
    if (!n) { try { await loadScript(LIB.pdflib); n = (await PDFLib.PDFDocument.load(await b.arrayBuffer(), { ignoreEncryption: true })).getPageCount(); } catch (e) { } }
    const id = uid('f'); await Files.put(id, b);
    return { id, kind, name: name || 'document.pdf', pages: n, size: b.size, addedAt: new Date().toISOString() };
  }
  function open(id) { Files.get(id).then(b => { if (!b) return toast('File not found in this browser'); const u = URL.createObjectURL(b); window.open(u, '_blank'); setTimeout(() => URL.revokeObjectURL(u), 60000); }); }
  const fmtSize = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  return { pages, classify, fields, build, subset, store, open, htmlToPng, KINDS, KIND_COLORS, fmtSize };
})();
