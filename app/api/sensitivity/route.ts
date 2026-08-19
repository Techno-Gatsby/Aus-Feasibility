import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore
import { run, DEF } from '@/lib/engine/model.js';

export const runtime = 'nodejs';

/** Sensitivity by RE-RUNNING THE MODEL at each point, not by linearising
 *  around the base case. A development model is full of thresholds — debt
 *  sizing, tax, settlement timing — so a gradient taken at the base case
 *  lies as soon as one of them trips. At ~7.5 ms a run a 7x7 grid costs
 *  about 370 ms, which is cheap enough that there is no excuse to
 *  approximate.
 *
 *  A cell that fails validation returns null, not zero: "this combination
 *  is not a runnable scheme" and "this scheme earns nothing" are different
 *  statements and must not look alike. */

const METRICS: Record<string, (A: any) => number | null> = {
  npat: (A) => num(A?.npat),
  npv: (A) => num(A?.npv),
  equityIrr: (A) => num(A?.eirr),
  margin: (A) => num(A?.margin),
  moic: (A) => num(A?.moic),
  peakEquity: (A) => num(A?.epeak),
};
const num = (v: any) => (typeof v === 'number' && isFinite(v) ? v : null);

function steps(base: number, swingPct: number, n: number) {
  const out: number[] = [];
  const half = Math.floor(n / 2);
  for (let i = -half; i <= half; i++) out.push(base * (1 + (swingPct / 100) * (i / half)));
  return out;
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const inputs = { ...(DEF as object), ...(body?.inputs ?? {}) };
  const metricKey: string = body?.metric ?? 'npat';
  const metric = METRICS[metricKey];
  if (!metric) return NextResponse.json({ error: `unknown metric ${metricKey}` }, { status: 400 });

  const swing = Number(body?.swing ?? 10);
  const n = Math.min(9, Math.max(3, Number(body?.steps ?? 7) | 1));

  const rowKey: string = body?.rowDriver;
  const colKey: string | null = body?.colDriver ?? null;
  if (!rowKey) return NextResponse.json({ error: 'rowDriver required' }, { status: 400 });

  const rowBase = Number((inputs as any)[rowKey]);
  if (!isFinite(rowBase) || rowBase === 0)
    return NextResponse.json(
      { error: `${rowKey} is zero or unset — nothing to swing around` }, { status: 422 });

  // base case first: if the scheme does not run at all, say so plainly
  // rather than returning a grid of nulls that looks like a broken tool.
  try { run(inputs, {}); }
  catch (e: any) {
    return NextResponse.json({ ok: false, kind: 'validation', error: String(e?.message ?? e) }, { status: 422 });
  }

  const rows = steps(rowBase, swing, n);
  if (!colKey) {
    const cells = rows.map((v) => {
      try { return metric(run({ ...inputs, [rowKey]: v }, {})); }
      catch { return null; }
    });
    return NextResponse.json({ ok: true, mode: 'one', metric: metricKey,
      rowKey, rowValues: rows, cells });
  }

  const colBase = Number((inputs as any)[colKey]);
  if (!isFinite(colBase) || colBase === 0)
    return NextResponse.json(
      { error: `${colKey} is zero or unset — nothing to swing around` }, { status: 422 });
  const cols = steps(colBase, swing, n);

  const grid = rows.map((rv) =>
    cols.map((cv) => {
      try { return metric(run({ ...inputs, [rowKey]: rv, [colKey]: cv }, {})); }
      catch { return null; }
    }),
  );
  return NextResponse.json({ ok: true, mode: 'two', metric: metricKey,
    rowKey, colKey, rowValues: rows, colValues: cols, grid });
}
