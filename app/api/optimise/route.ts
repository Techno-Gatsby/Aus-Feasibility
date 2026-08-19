import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore
import { run, DEF } from '@/lib/engine/model.js';
import { solve, REASON_TEXT } from '@/lib/optimise';

export const runtime = 'nodejs';

const METRIC: Record<string, (A: any) => number | null> = {
  eirr: (A) => fin(A?.eirr), npat: (A) => fin(A?.npat), npv: (A) => fin(A?.npv),
  margin: (A) => fin(A?.margin), moic: (A) => fin(A?.moic),
};
const fin = (v: any) => (typeof v === 'number' && isFinite(v) ? v : null);

/** Solves for the driver value that hits a target. The headline case is
 *  land price — "what can I pay and still clear my hurdle" is the question a
 *  feasibility exists to answer. */
export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const inputs = { ...(DEF as object), ...(body?.inputs ?? {}) };
  const driver: string = body?.driver ?? 'pr';
  const metricKey: string = body?.metric ?? 'eirr';
  const target = Number(body?.target ?? 0.15);
  const metric = METRIC[metricKey];
  if (!metric) return NextResponse.json({ error: `unknown metric ${metricKey}` }, { status: 400 });

  try { run(inputs, {}); }
  catch (e: any) {
    return NextResponse.json({ ok: false, kind: 'validation', error: String(e?.message ?? e) }, { status: 422 });
  }

  const current = Number((inputs as any)[driver]);
  if (!isFinite(current) || current === 0)
    return NextResponse.json({ error: `${driver} is zero or unset` }, { status: 422 });

  // search 0..3x the current value: wide enough to bracket a hurdle either
  // side of today's assumption without wandering into nonsense
  const evaluate = (x: number) => {
    try { return metric(run({ ...inputs, [driver]: x }, {})); } catch { return null; }
  };
  const r = solve(evaluate, target, Math.max(0, current * 0.05), current * 3, 24);

  const base = metric(run(inputs, {}));
  return NextResponse.json({
    ok: true, driver, metric: metricKey, target,
    current, currentMetric: base,
    solved: r.value, achieved: r.achieved,
    reason: r.reason, explanation: REASON_TEXT[r.reason],
    curve: r.samples.map((s) => ({ x: s.x, y: s.y })),
  });
}
