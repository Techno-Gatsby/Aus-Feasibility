import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore — the engine is untyped by design; see lib/engine/model.js
import { run, DEF, fyOf, AUSTRALIA_MODEL_VERSION } from '@/lib/engine/model.js';
import { profitAndLoss, sourcesAndUses, cashflow, balanceSheet, debtCover } from '@/lib/statements';
import { buildXlsx, cell, money, pct, ratio, type Cell, type SheetSpec } from '@/lib/xlsx';

export const runtime = 'nodejs';

/** True .xlsx (OPC/ZIP) workbook, written by lib/xlsx.ts without a
 *  dependency. app/api/export/route.ts still serves SpreadsheetML 2003
 *  (.xls) — that one is plain text and auditable by eye; this one is what
 *  Excel, Numbers and Google Sheets all treat as native, with real number
 *  formats, frozen headers and column widths.
 *
 *  Every figure is written as a NUMBER carrying a format, never as a
 *  formatted string: "$11.4m" in a cell is a dead end for anyone who wants
 *  to sum, pivot or re-base it. Ratios go in as fractions (0.612) with a
 *  percent format, so the underlying value is still the ratio.
 */

type StatementLike = ReturnType<typeof profitAndLoss>;

/** One statement -> one sheet. Bands become full-width headings, subtotals
 *  and results get the bold rule, everything else is a plain money row. */
function statementSheet(s: StatementLike): SheetSpec {
  const showTotal = s.columns.length > 1;
  const header: Cell[] = [
    cell('No.', 'header'), cell('Description', 'header'),
    ...s.columns.map((c) => cell(c, 'header')),
    ...(showTotal ? [cell('Total', 'header')] : []),
  ];
  const width = header.length;

  const rows: Cell[][] = [header];
  for (const r of s.rows) {
    if (r.kind === 'band') {
      rows.push([cell(r.label, 'band', width)]);
      continue;
    }
    const strong = r.kind === 'sub' || r.kind === 'result';
    rows.push([
      cell(r.no ?? '', strong ? 'totalText' : 'label'),
      cell(r.label, strong ? 'totalText' : 'label'),
      ...r.values.map((v) => (strong ? cell(v, 'total') : money(v))),
      ...(showTotal ? [strong ? cell(r.total, 'total') : money(r.total)] : []),
    ]);
  }
  if (s.note) {
    rows.push([]);
    rows.push([cell(s.note, 'note', width)]);
  }

  return {
    name: s.caption,
    rows,
    // labels stay put while the year columns scroll
    freeze: { rows: 1, cols: 2 },
    columns: [{ width: 7 }, { width: 42 }],
  };
}

function build(inputs: Record<string, any>) {
  const A: any = run(inputs, {});

  const months = Array.isArray(A?.R?.cfrefnetcash) ? A.R.cfrefnetcash.length : 0;
  const fyMap: number[] = [];
  for (let m = 0; m < months; m++) fyMap.push((fyOf as any)(m, inputs));

  const d = debtCover(A);
  const num = (v: any) => (typeof v === 'number' && isFinite(v) ? v : null);

  const summary: SheetSpec = {
    name: 'Summary',
    rows: [
      [cell('Measure', 'header'), cell('Value', 'header'), cell('Basis', 'header')],
      [cell('Gross realisation', 'label'), money(num(A?.revenue)), cell('incl GST', 'label')],
      [cell('Net revenue', 'label'), money(num(A?.netRevenue)), cell('after output GST', 'label')],
      [cell('Net profit after tax', 'label'), money(num(A?.npat)), cell('', 'label')],
      [cell('Margin on revenue', 'label'), pct(num(A?.margin)), cell('NPAT / net revenue', 'label')],
      [cell('Project NPV', 'label'), money(num(A?.npv)), cell('at the model discount rate', 'label')],
      [cell('Project IRR', 'label'), pct(num(A?.irr)), cell('unlevered, monthly compounded', 'label')],
      [cell('Equity IRR', 'label'), pct(num(A?.eirr)), cell('after tax', 'label')],
      [cell('Equity multiple', 'label'), ratio(num(A?.moic)), cell('returned / injected', 'label')],
      [cell('Peak equity', 'label'), money(num(A?.epeak)), cell('maximum out of pocket', 'label')],
      [cell('Peak debt', 'label'), money(num(A?.peakdebt)), cell('', 'label')],
      [cell('Stamp duty', 'label'), money(num(A?.stampDuty)), cell('acquisition', 'label')],
      [cell('Foreign purchaser surcharge', 'label'), money(num(A?.foreignPurchaserSurcharge)), cell('acquisition', 'label')],
      [cell('FIRB application fee', 'label'), money(num(A?.firbCost)), cell('acquisition', 'label')],
      [],
      [cell(
        `Model ${AUSTRALIA_MODEL_VERSION}. Percentages are stored as fractions and formatted as ` +
        `percentages, so 0.0645 displays as 6.45% and still sums and averages correctly.`,
        'note', 3)],
    ],
    freeze: { rows: 1 },
    columns: [{ width: 34 }, { width: 18 }, { width: 38 }],
  };

  const debt: SheetSpec = {
    name: 'Debt and cover',
    rows: [
      [cell('Measure', 'header'), cell('Value', 'header'), cell('Test', 'header')],
      [cell('Peak debt drawn', 'label'), money(d.peak), cell(`month ${d.peakMonth}`, 'label')],
      [cell('Facility limit', 'label'), money(d.limit), cell('', 'label')],
      [cell('Headroom', 'label'), money(d.headroom),
       cell(d.headroom >= 0 ? 'within limit' : 'OVER LIMIT', 'label')],
      [cell('Loan to cost', 'label'), pct(d.ltc), cell('typical cap 65%', 'label')],
      [cell('Loan to gross realisation', 'label'), pct(d.ltgrv), cell('typical cap 60%', 'label')],
      [cell('Repayment cover at peak debt', 'label'), ratio(d.repaymentCover),
       cell(`covenant ${d.covenant}x`, 'label')],
      [cell('Minimum DSCR (repayment window)', 'label'), ratio(d.minDscr),
       cell(`covenant ${d.covenant}x, month ${d.minDscrMonth}`, 'label')],
      [cell('Serviced periods tested', 'label'), cell(d.servicedPeriods, 'number'), cell('', 'label')],
      [cell('Periods below covenant', 'label'), cell(d.breaches, 'number'), cell('', 'label')],
      [],
      [cell(
        'Cover ratios are stored as fractions and multiples, not text, so a credit team ' +
        'can re-base them against its own covenants without retyping anything.',
        'note', 3)],
    ],
    freeze: { rows: 1 },
    columns: [{ width: 34 }, { width: 18 }, { width: 34 }],
  };

  // Every input behind the workbook, so the file is self-describing and a
  // run can be reproduced from the spreadsheet alone.
  const inputRows: Cell[][] = Object.entries(inputs)
    .filter(([, v]) => typeof v === 'number' || typeof v === 'string')
    .map(([k, v]) =>
      typeof v === 'number'
        ? [cell(k, 'label'), cell(v, Number.isInteger(v) ? 'number' : 'currency2')]
        : [cell(k, 'label'), cell(String(v), 'label')]);

  const inputSheet: SheetSpec = {
    name: 'Inputs',
    rows: [
      [cell('Key', 'header'), cell('Value', 'header')],
      ...inputRows,
      [],
      [cell(`Model ${AUSTRALIA_MODEL_VERSION}. Every input behind the figures in this workbook.`, 'note', 2)],
    ],
    freeze: { rows: 1 },
    columns: [{ width: 34 }, { width: 20 }],
  };

  return buildXlsx(
    [
      summary,
      statementSheet(profitAndLoss(A)),
      statementSheet(cashflow(A, fyMap)),
      statementSheet(balanceSheet(A)),
      statementSheet(sourcesAndUses(A)),
      debt,
      inputSheet,
    ],
    { title: 'Land feasibility', creator: 'Land Feasibility', company: '' },
  );
}

function respond(bytes: Uint8Array) {
  const name = `feasibility-${new Date().toISOString().slice(0, 10)}.xlsx`;
  // copy into a fresh ArrayBuffer: Buffer views share a pooled buffer, and
  // handing the pool to the response would ship whatever else is in it.
  const body = new Uint8Array(bytes);
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 }); }

  const inputs = { ...(DEF as object), ...(body?.inputs ?? {}) };
  try {
    return respond(build(inputs));
  } catch (e: any) {
    // engine validation messages are guidance for the user, not server faults
    return NextResponse.json({ error: String(e?.message ?? e), kind: 'validation' }, { status: 422 });
  }
}

/* No GET. The model ships without defaults on purpose — run() refuses a
 * bare DEF ("Sales velocity must be greater than zero in finished-lot
 * mode"), so a link-style download would only ever hand back a 422. The
 * export needs the inputs the user is actually looking at. */
