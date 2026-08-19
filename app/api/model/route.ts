import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore — the engine is untyped by design; see lib/engine/model.js
import { run, DEF, GROUPS, AUSTRALIA_MODEL_VERSION } from '@/lib/engine/model.js';

export const runtime = 'nodejs';

/** GET  -> input schema and defaults, so the UI can build itself.
 *  POST -> { inputs, overrides? } returns the full analysis.
 *
 *  The engine validates its own inputs and throws plain-language errors
 *  ("Sales velocity must be greater than zero in finished-lot mode"). Those
 *  are returned as 422 with the message intact — they are guidance for the
 *  user, not server faults, and must not be swallowed into a generic 500.
 */
export async function GET() {
  return NextResponse.json({
    version: AUSTRALIA_MODEL_VERSION,
    groups: (GROUPS as any[]).map((g) => ({
      group: g.g,
      fields: (g.f ?? []).map((f: any[]) => ({
        key: f[0], label: f[1], unit: f[2], default: f[3], type: f[4],
      })),
    })),
    defaults: DEF,
  });
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 }); }

  const inputs = { ...(DEF as object), ...(body?.inputs ?? {}) };
  const overrides = body?.overrides ?? {};

  try {
    const A = run(inputs, overrides);
    return NextResponse.json({
      ok: true,
      version: AUSTRALIA_MODEL_VERSION,
      summary: {
        revenue: A.revenue ?? null, npat: A.npat ?? null, npv: A.npv ?? null,
        irr: A.irr ?? null, equityIrr: A.eirr ?? null, moic: A.moic ?? null,
        peakDebt: A.peakdebt ?? null, peakEquity: A.epeak ?? null,
        stampDuty: A.stampDuty ?? null, firb: A.firbCost ?? null,
        margin: A.margin ?? null,
      },
      analysis: A,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e), kind: 'validation' },
      { status: 422 },
    );
  }
}
