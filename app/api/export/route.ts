import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore
import { run, DEF, fyOf, AUSTRALIA_MODEL_VERSION } from '@/lib/engine/model.js';
import { profitAndLoss, sourcesAndUses, cashflow, balanceSheet, debtCover } from '@/lib/statements';

export const runtime = 'nodejs';

/** Multi-sheet workbook as SpreadsheetML 2003 — plain XML that Excel, Numbers
 *  and LibreOffice all open natively. Chosen over .xlsx deliberately: xlsx is
 *  a ZIP container and would need a dependency to write, whereas this is text
 *  we can emit correctly and audit by eye.
 *
 *  Numbers are written as NUMBERS, not preformatted strings. A finance team
 *  will sum and pivot this; exporting "$11.4m" as text makes that impossible
 *  and is the single most common way a good export is ruined. */

const esc = (s: any) =>
  String(s ?? '').replace(/[<>&"']/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!));

const cellNum = (v: number | null) =>
  v == null || !isFinite(v)
    ? '<Cell/>'
    : `<Cell><Data ss:Type="Number">${v}</Data></Cell>`;
const cellStr = (v: any, style = '') =>
  `<Cell${style}><Data ss:Type="String">${esc(v)}</Data></Cell>`;

function sheet(name: string, header: string[], rows: any[][], note?: string) {
  const head = `<Row>${header.map((h) => cellStr(h, ' ss:StyleID="h"')).join('')}</Row>`;
  const body = rows
    .map((r) => `<Row>${r.map((c) => (typeof c === 'number' || c === null ? cellNum(c) : cellStr(c))).join('')}</Row>`)
    .join('');
  const foot = note ? `<Row/><Row>${cellStr(note)}</Row>` : '';
  // sheet names cannot contain : \ / ? * [ ] and cap at 31 chars
  const safe = name.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31);
  return `<Worksheet ss:Name="${esc(safe)}"><Table>${head}${body}${foot}</Table></Worksheet>`;
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const inputs = { ...(DEF as object), ...(body?.inputs ?? {}) };

  let A: any;
  try { A = run(inputs, {}); }
  catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e), kind: 'validation' }, { status: 422 });
  }

  const months = Array.isArray(A?.R?.cfrefnetcash) ? A.R.cfrefnetcash.length : 0;
  const fyMap: number[] = [];
  for (let m = 0; m < months; m++) fyMap.push((fyOf as any)(m, inputs));

  const sheets: string[] = [];
  const push = (s: ReturnType<typeof profitAndLoss>) => {
    const header = ['No.', 'Description', ...s.columns, ...(s.columns.length > 1 ? ['Total'] : [])];
    const rows = s.rows.map((r) =>
      r.kind === 'band'
        ? [r.label, ...header.slice(1).map(() => null)]
        : [r.no ?? '', r.label, ...r.values, ...(s.columns.length > 1 ? [r.total] : [])],
    );
    sheets.push(sheet(s.caption, header, rows, s.note));
  };

  push(profitAndLoss(A));
  push(cashflow(A, fyMap));
  push(balanceSheet(A));
  push(sourcesAndUses(A));

  const d = debtCover(A);
  sheets.push(sheet('Debt and cover', ['Measure', 'Value', 'Test'], [
    ['Peak debt drawn', d.peak, `month ${d.peakMonth}`],
    ['Facility limit', d.limit, ''],
    ['Headroom', d.headroom, d.headroom >= 0 ? 'within limit' : 'OVER LIMIT'],
    ['Loan to cost', d.ltc, 'typical cap 65%'],
    ['Loan to gross realisation', d.ltgrv, 'typical cap 60%'],
    ['Repayment cover at peak debt', d.repaymentCover, `covenant ${d.covenant}x`],
    ['Minimum DSCR (repayment window)', d.minDscr, `covenant ${d.covenant}x`],
    ['Periods below covenant', d.breaches, ''],
  ], 'Ratios are exported as decimals, not percentages, so they can be reformatted without being re-derived.'));

  // every input, so the workbook is self-describing and reproducible
  const inputRows = Object.entries(inputs)
    .filter(([, v]) => typeof v === 'number' || typeof v === 'string')
    .map(([k, v]) => [k, typeof v === 'number' ? v : String(v)]);
  sheets.push(sheet('Inputs', ['Key', 'Value'], inputRows,
    `Model ${AUSTRALIA_MODEL_VERSION}. Every input behind the figures in this workbook.`));

  const xml =
    `<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n` +
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n` +
    ` xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n` +
    `<Styles><Style ss:ID="h"><Font ss:Bold="1"/></Style></Styles>\n` +
    sheets.join('\n') + `\n</Workbook>`;

  const name = `feasibility-${new Date().toISOString().slice(0, 10)}.xls`;
  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/vnd.ms-excel; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
    },
  });
}
