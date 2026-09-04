import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore
import { run, DEF } from '@/lib/engine/model.js';

export const runtime = 'nodejs';

/** Named variants of the base case, run side by side. Each scenario is a set
 *  of input overrides, so what changed is explicit and auditable rather than
 *  hidden in a saved copy of the whole model.
 *
 *  A scenario that fails validation returns its error rather than being
 *  dropped: "this combination is not a runnable scheme" is a finding, and
 *  silently omitting it would make the comparison look complete when it is
 *  not. */
export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const inputs = { ...(DEF as object), ...(body?.inputs ?? {}) };
  const scenarios: { name: string; overrides: Record<string, number> }[] =
    Array.isArray(body?.scenarios) ? body.scenarios : [];

  const pick = (A: any) => ({
    revenue: num(A?.revenue), npat: num(A?.npat), npv: num(A?.npv),
    eirr: num(A?.eirr), margin: num(A?.margin), moic: num(A?.moic),
    peakEquity: num(A?.epeak), peakDebt: num(A?.peakdebt),
    stampDuty: num(A?.stampDuty), firb: num(A?.firbCost),
  });

  let base: any = null, baseErr: string | null = null;
  try { base = pick(run(inputs, {})); }
  catch (e: any) { baseErr = String(e?.message ?? e); }

  const results = scenarios.map((s) => {
    try {
      const A = run({ ...inputs, ...(s.overrides ?? {}) }, {});
      return { name: s.name, overrides: s.overrides ?? {}, ok: true, metrics: pick(A), error: null };
    } catch (e: any) {
      return { name: s.name, overrides: s.overrides ?? {}, ok: false, metrics: null,
               error: String(e?.message ?? e) };
    }
  });

  return NextResponse.json({
    ok: !baseErr, base, baseError: baseErr, results,
  });
}
const num = (v: any) => (typeof v === 'number' && isFinite(v) ? v : null);
