// Invoice pack: identify the pages of a real pack PDF, save the WOI to the project, build the 10-page pack.
// Needs: node_modules (leaflet, pdf-lib, pdfjs-dist, html2canvas, playwright) and PACK_PDF=<path to a pack PDF like Tax Invoice_Elwood Infra-January to May 2026.pdf>
import { chromium } from 'playwright';
import fs from 'node:fs';
const N = new URL('./node_modules/', import.meta.url).pathname, PDF = process.env.PACK_PDF;
if (!PDF || !fs.existsSync(PDF)) { console.log('SKIP: set PACK_PDF to the Elwood pack PDF'); process.exit(0); }
const URLA = 'file://' + new URL('../Attendance Tracker.html', import.meta.url).pathname.replace(/ /g, '%20');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
const lib = { 'pdf-lib.min.js': N + 'pdf-lib/dist/pdf-lib.min.js', 'html2canvas.min.js': N + 'html2canvas/dist/html2canvas.min.js', 'pdf.min.mjs': N + 'pdfjs-dist/build/pdf.min.mjs', 'pdf.worker.min.mjs': N + 'pdfjs-dist/build/pdf.worker.min.mjs' };
await ctx.route('https://cdn.jsdelivr.net/**', r => { const u = r.request().url(); if (u.includes('/leaflet@')) return r.fulfill({ path: N + 'leaflet/dist/' + u.split('/dist/')[1] }); const f = Object.keys(lib).find(k => u.endsWith(k)); return f ? r.fulfill({ path: lib[f], contentType: 'text/javascript' }) : r.abort(); });
await ctx.route(/arcgisonline/, r => r.fulfill({ status: 200, body: '' }));
const A = await ctx.newPage(); const errs = []; A.on('pageerror', e => errs.push(e.message));
await A.goto(URLA); await A.waitForSelector('body[data-ready]');
// open the Elwood invoice
await A.evaluate(() => { showView('invoices'); const inv = S.invoices.find(x => x.no === '2026-0900000689'); IV.draft = JSON.parse(JSON.stringify(inv)); IV.draft.sapPdf = null; IV.draft.signedTs = []; renderInvoices(); });
const before = await A.evaluate(() => packSlots(IV.draft).map(x => x.src));
ok(before.every(x => x === 'generated') && before.length === 7, 'pack starts as 7 generated pages ' + JSON.stringify(before));
// identify pages
await A.setInputFiles('#iv-ident', PDF); await A.waitForSelector('.pth', { timeout: 60000 });
const kinds = await A.evaluate(() => [...document.querySelectorAll('[data-pk]')].map(x => x.value));
ok(JSON.stringify(kinds) === JSON.stringify(['sap', 'breakup', 'ts', 'ts', 'ts', 'ts', 'ts', 'woi', 'woi', 'woi']), 'pages labelled ' + kinds.join(','));
const txt = (await A.textContent('#modal .mb')).replace(/\s+/g, ' ');
ok(/INS-104N135-26-0002/.test(txt) && /104N135/.test(txt) && /2026-0900000689/.test(txt), 'PO, project code and invoice number found');
ok(/SCL - ELWOOD - INFRA.*ticked/.test(txt), 'project recognised from the PO');
ok(/matches this break-up/.test(txt), 'invoice total matches the generated break-up');
ok((await A.evaluate(() => document.querySelectorAll('.pth img').length)) === 10, 'thumbnails rendered');
await A.click('#modal .mf button.pri'); await A.waitForSelector('.pth', { state: 'detached', timeout: 60000 }); await A.waitForTimeout(500);
const after = await A.evaluate(() => { const dr = IV.draft, p = IX.proj.get(dr.projectIds[0]); return { sap: dr.sapPdf?.pages, ts: dr.signedTs?.map(x => x.pages), woi: p.docs?.filter(d => d.kind === 'woi').map(d => d.pages), slots: packSlots(dr).map(x => `${x.kind}:${x.src}:${x.pages || 1}`) }; });
ok(after.sap === 1 && JSON.stringify(after.ts) === '[5]' && JSON.stringify(after.woi) === '[3]', 'SAP page, signed sheets and WOI stored ' + JSON.stringify(after));
ok(JSON.stringify(after.slots) === JSON.stringify(['sap:uploaded:1', 'breakup:generated:1', 'ts:uploaded:5', 'doc:project:3']), 'pack slots in Elwood order ' + JSON.stringify(after.slots));
// build the pack
const n = await A.evaluate(async () => { window.__blob = null; window.downloadBlob = b => { window.__blob = b; }; await buildPack(IV.draft); const d = await PDFLib.PDFDocument.load(await window.__blob.arrayBuffer()); return { pages: d.getPageCount(), sizes: d.getPages().map(p => Math.round(p.getWidth()) + 'x' + Math.round(p.getHeight())) }; });
ok(n.pages === 10, 'pack PDF has 10 pages ' + JSON.stringify(n));
// a new draft for the same project already carries the WOI
const fresh = await A.evaluate(() => { const d = newInvoiceDraft(); d.projectIds = [IV.draft.projectIds[0]]; return packSlots(d).filter(x => x.kind === 'doc').map(x => x.src + ':' + x.pages); });
ok(JSON.stringify(fresh) === '["project:3"]', 'next invoice of the project gets the WOI automatically');
// bulk upload: the same pack as one file → one WOI matched by PO
await A.evaluate(() => { const p = IX.proj.get(IV.draft.projectIds[0]); p.docs = []; showView('projects'); });
await A.setInputFiles('#pv-bulkdocs', PDF); await A.waitForSelector('[data-bp]', { timeout: 60000 });
const bulk = await A.evaluate(() => [...document.querySelectorAll('#modal tbody tr')].map(tr => ({ pages: tr.children[1].textContent, po: tr.children[2].textContent, proj: tr.querySelector('[data-bp]').selectedOptions[0].textContent, how: tr.children[5].textContent })));
ok(bulk.length === 1 && bulk[0].pages === '3' && bulk[0].po === 'INS-104N135-26-0002' && bulk[0].proj === 'SCL - ELWOOD - INFRA' && bulk[0].how === 'WOI no', 'bulk upload matched the project by WOI number ' + JSON.stringify(bulk));
await A.click('#modal .mf button.pri'); await A.waitForSelector('[data-bp]', { state: 'detached', timeout: 60000 }); await A.waitForTimeout(300);
const bulkDoc = await A.evaluate(() => IX.proj.get(IV.draft.projectIds[0]).docs.map(d => d.kind + ':' + d.pages));
ok(JSON.stringify(bulkDoc) === '["woi:3"]', 'bulk-uploaded WOI saved on the project ' + JSON.stringify(bulkDoc));
// project card badge + persistence across reload
await A.evaluate(() => { saveInvoice(IV.draft); showView('projects'); });
ok(/📄 WOI 3 p/.test(await A.textContent('#v-projects')), 'project card shows the document');
await A.waitForTimeout(800); await A.reload(); await A.waitForSelector('body[data-ready]');
const kept = await A.evaluate(async () => { const p = S.projects.find(x => x.docs?.length); const b = p && await Files.get(p.docs[0].id); return { doc: !!p, bytes: b ? b.size : 0 }; });
ok(kept.doc && kept.bytes > 1000, 'document survives a reload ' + JSON.stringify(kept));
// backup carries the files
const bk = await A.evaluate(async () => { window.__blob = null; window.downloadBlob = b => { window.__blob = b; }; await downloadBackup(); const j = JSON.parse(await window.__blob.text()); return Object.keys(j._files || {}).length; });
ok(bk >= 3, 'backup includes the documents (' + bk + ' files)');
console.log(errs.length ? 'page errors: ' + errs.join(' | ') : 'no page errors');
console.log(`${fails ? 'FAILED ' + fails : 'all passed'}`); await b.close(); process.exit(fails ? 1 : 0);
