import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore
import { run, DEF, fyOf, AUSTRALIA_MODEL_VERSION } from '@/lib/engine/model.js';
import { profitAndLoss, sourcesAndUses, cashflow, balanceSheet, debtCover, type Statement } from '@/lib/statements';
import { Pdf, type Col } from '@/lib/pdf';

export const runtime = 'nodejs';

const money = (v: number | null) =>
  v == null ? '' : v === 0 ? '-' :
  Math.abs(v) >= 1e6
    ? `${v < 0 ? '(' : ''}$${(Math.abs(v) / 1e6).toFixed(2)}m${v < 0 ? ')' : ''}`
    : `${v < 0 ? '(' : ''}$${Math.round(Math.abs(v)).toLocaleString('en-AU')}${v < 0 ? ')' : ''}`;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** Column plan: label column takes what is left after the value columns, so
 *  a seven-year statement and a one-column one both fill the page. */
function plan(colCount: number, hasTotal: boolean): Col[] {
  const valW = 74, noW = 30;
  const n = colCount + (hasTotal ? 1 : 0);
  const labelW = 770 - noW - n * valW;
  return [
    { w: noW }, { w: Math.max(150, labelW) },
    ...Array.from({ length: n }, () => ({ w: valW, align: 'r' as const })),
  ];
}

function renderStatement(pdf: Pdf, s: Statement) {
  const hasTotal = s.columns.length > 1;
  pdf.ensure(80);
  pdf.text(s.caption, 36, 11, true);
  pdf.move(16);
  const cols = plan(s.columns.length, hasTotal);
  const header = ['No.', 'Description', ...s.columns, ...(hasTotal ? ['Total'] : [])];
  const rows = s.rows.map((r) =>
    r.kind === 'band'
      ? [r.label, ...header.slice(1).map(() => null)]
      : [r.no ?? '', r.label,
         ...r.values.map((v) => money(v)),
         ...(hasTotal ? [money(r.total)] : [])],
  );
  pdf.table(header, cols, rows, s.rows.map((r) => r.kind));
  if (s.note) pdf.note(s.note);
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const inputs = { ...(DEF as object), ...(body?.inputs ?? {}) };
  const project: string = body?.project ?? 'Feasibility';

  let A: any;
  try { A = run(inputs, {}); }
  catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e), kind: 'validation' }, { status: 422 });
  }

  const months = Array.isArray(A?.R?.cfrefnetcash) ? A.R.cfrefnetcash.length : 0;
  const fyMap: number[] = [];
  for (let m = 0; m < months; m++) fyMap.push((fyOf as any)(m, inputs));

  const stamp = new Date().toISOString().slice(0, 10);
  const pdf = new Pdf(project, `Feasibility summary — ${stamp}`);

  // headline figures first: whoever opens this wants the answer on page one
  pdf.text('Result', 36, 11, true); pdf.move(16);
  const kpi: [string, string][] = [
    ['Gross realisation', money(A.revenue)],
    ['Net profit after tax', money(A.npat)],
    ['Margin on revenue', typeof A.margin === 'number' ? pct(A.margin) : '-'],
    ['Equity IRR (after tax)', typeof A.eirr === 'number' ? pct(A.eirr) : '-'],
    ['Peak equity', money(A.epeak)],
    ['Peak debt', money(A.peakdebt)],
    ['Stamp duty', money(A.stampDuty)],
    ['FIRB application fee', money(A.firbCost)],
  ];
  pdf.table(
    ['Measure', 'Value'],
    [{ w: 300 }, { w: 140, align: 'r' as const }],
    kpi.map(([k, v]) => [k, v]),
  );

  const d = debtCover(A);
  pdf.ensure(120);
  pdf.text('Debt sizing and cover', 36, 11, true); pdf.move(16);
  pdf.table(
    ['Measure', 'Value', 'Test'],
    [{ w: 300 }, { w: 140, align: 'r' as const }, { w: 200 }],
    [
      ['Peak debt drawn', money(d.peak), `month ${d.peakMonth}`],
      ['Facility limit', money(d.limit), ''],
      ['Headroom', money(d.headroom), d.headroom >= 0 ? 'within limit' : 'OVER LIMIT'],
      ['Loan to cost', pct(d.ltc), 'typical cap 65%'],
      ['Loan to gross realisation', pct(d.ltgrv), 'typical cap 60%'],
      ['Repayment cover at peak debt', d.repaymentCover == null ? 'n/a' : `${d.repaymentCover.toFixed(2)}x`,
       `covenant ${d.covenant.toFixed(2)}x`],
      ['Minimum DSCR (repayment window)', d.minDscr == null ? 'n/a' : `${d.minDscr.toFixed(2)}x`,
       d.minDscr == null ? 'no serviced period' : `covenant ${d.covenant.toFixed(2)}x`],
      ['Periods below covenant', String(d.breaches), d.breaches === 0 ? 'no breach' : `${d.breaches} below`],
    ],
  );
  pdf.note(
    'DSCR is measured only where both debt service and settlement receipts occur. ' +
    'During construction a development facility is not serviced from operations — ' +
    'interest rolls up and is repaid from settlements — so a construction-phase DSCR ' +
    'is not a meaningful number. Loan to gross realisation uses this model’s own ' +
    'realisation, not a bank valuation, and the caps shown are typical rather than ' +
    'your lender’s.',
  );

  pdf.newPage(); renderStatement(pdf, profitAndLoss(A));
  pdf.newPage(); renderStatement(pdf, cashflow(A, fyMap));
  pdf.newPage(); renderStatement(pdf, balanceSheet(A));
  pdf.newPage(); renderStatement(pdf, sourcesAndUses(A));

  pdf.note(
    `Model ${AUSTRALIA_MODEL_VERSION}. Every figure is read from the model rather ` +
    'than recomputed for this report, so the PDF, the screen and the exported ' +
    'workbook cannot disagree. Ownership is not shown because it is not public in ' +
    'NSW: a title search is paid, per search, through LRS.',
  );

  const buf = pdf.build();
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="feasibility-${stamp}.pdf"`,
    },
  });
}
