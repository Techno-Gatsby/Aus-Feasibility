import { NextRequest, NextResponse } from 'next/server';
import { buildDossier, type DossierInput } from '@/lib/dossier';
import type { Ring } from '@/lib/amalgamate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * /api/dossier — one call, every field the E1 lead-one-pager and D1
 * active-to-potential skills ask for, from live NSW government services.
 *
 * The point is that an analyst handed a JLL information memorandum should be
 * CHECKING figures, not retyping them. So the endpoint is built around the
 * three ways a real site actually arrives:
 *
 *   GET  ?lots=40/1/DP1649,41/1/DP1649,2/DP202169,...
 *        The title schedule, copied straight off page two of the IM. Sites are
 *        several lots; the Bruce Street Collective in Wollstonecraft is six,
 *        and a one-lot answer for it would report 559 sqm against the true
 *        2,235 — wrong by a factor of four while looking entirely plausible.
 *
 *   POST { rings: [[[lng,lat], ...]] }
 *        A boundary drawn on the map. Every lot with a real share of its area
 *        inside is returned; lots that merely touch the edge are excluded and
 *        listed, because `esriSpatialRelIntersects` otherwise annexes the
 *        neighbours.
 *
 *   GET  ?lat=-33.8297&lng=151.2011
 *        A pin. Returns the ONE lot under it and says so in `warnings`, which
 *        is the honest answer to an ambiguous question. `expandAdjacent=true`
 *        offers the adjoining lots as candidates, flagged as candidates.
 *
 * Optional commercial inputs (grvAud, ppsmAud, marginPct, turnaroundMonths,
 * lotCount, unitCount, salePricePerSqmNsa, nsaEfficiency, avgUnitSizeSqm)
 * feed the D1 threshold gate. They are optional on purpose: without them the
 * verdict is UNKNOWN and names what is missing. Nothing here estimates a GRV
 * to manufacture a PASS.
 *
 * Pass imSiteAreaM2, imGfaM2 or imUnits to have the IM's own figures compared
 * against the surveyed and mapped ones. A disagreement is reported as a
 * disagreement, with both numbers — the cadastre is not silently preferred.
 */

const num = (v: string | null): number | undefined => {
  if (v == null || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const bool = (v: string | null): boolean =>
  v != null && /^(1|true|yes)$/i.test(v.trim());

const splitLots = (v: string | null): string[] | undefined => {
  if (!v) return undefined;
  const parts = v.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
};

/** Rings arrive as [[[lng,lat],...]] or, from a GeoJSON-minded caller, as a
 *  single ring [[lng,lat],...]. Both are accepted; anything else is rejected
 *  rather than coerced, because a silently misread polygon returns a confident
 *  dossier about the wrong land. */
function readRings(v: unknown): { rings?: Ring[]; error?: string } {
  if (v == null) return {};
  if (!Array.isArray(v) || !v.length) return { error: 'rings must be a non-empty array' };
  const isPair = (p: unknown): p is [number, number] =>
    Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);

  const wrapped: unknown[] = isPair(v[0]) ? [v] : (v as unknown[]);
  const rings: Ring[] = [];
  for (const r of wrapped) {
    if (!Array.isArray(r) || r.length < 3)
      return { error: 'each ring needs at least three [lng, lat] positions' };
    const ring: Ring = [];
    for (const p of r) {
      if (!isPair(p)) return { error: 'ring positions must be [lng, lat] number pairs' };
      const [x, y] = p;
      // Latitude first is the classic mistake and it puts Sydney in the Indian
      // Ocean. NSW longitudes run 141 to 154, so a value that cannot be a
      // longitude here is caught rather than queried.
      if (Math.abs(y) > 90) return { error: `position [${x}, ${y}] has a latitude outside -90..90 — the order is [lng, lat]` };
      ring.push([x, y]);
    }
    rings.push(ring);
  }
  return { rings };
}

function fromQuery(sp: URLSearchParams): DossierInput {
  return {
    lat: num(sp.get('lat')),
    lng: num(sp.get('lng')),
    lots: splitLots(sp.get('lots')),
    expandAdjacent: bool(sp.get('expandAdjacent')),
    imSiteAreaM2: num(sp.get('imSiteAreaM2')),
    imGfaM2: num(sp.get('imGfaM2')),
    imUnits: num(sp.get('imUnits')),
    leadType: sp.get('leadType') === 'horizontal' ? 'horizontal'
            : sp.get('leadType') === 'vertical' ? 'vertical' : undefined,
    grvAud: num(sp.get('grvAud')),
    ppsmAud: num(sp.get('ppsmAud')),
    unitCount: num(sp.get('unitCount')),
    lotCount: num(sp.get('lotCount')),
    marginPct: num(sp.get('marginPct')),
    turnaroundMonths: num(sp.get('turnaroundMonths')),
    salePricePerSqmNsa: num(sp.get('salePricePerSqmNsa')),
    nsaEfficiency: num(sp.get('nsaEfficiency')),
    avgUnitSizeSqm: num(sp.get('avgUnitSizeSqm')),
  };
}

function validate(input: DossierInput): string | null {
  if ((input.lat != null) !== (input.lng != null))
    return 'lat and lng must be given together — one without the other cannot locate anything.';
  const hasPoint = input.lat != null && input.lng != null;
  if (!hasPoint && !input.lots?.length && !input.rings?.length)
    return 'Provide one of: lots (title references from the IM), rings (a drawn boundary), '
         + 'or lat and lng (a pin).';
  if (hasPoint && (Math.abs(input.lat!) > 90 || Math.abs(input.lng!) > 180))
    return 'lat must be within -90..90 and lng within -180..180.';
  if (input.nsaEfficiency != null && (input.nsaEfficiency <= 0 || input.nsaEfficiency > 1))
    return 'nsaEfficiency is a ratio between 0 and 1 (0.8, not 80).';
  return null;
}

async function respond(input: DossierInput) {
  const bad = validate(input);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });

  try {
    const r = await buildDossier(input);
    if (!r.ok)
      return NextResponse.json({ error: r.error, detail: r.detail ?? null }, { status: r.status });
    return NextResponse.json(r.dossier, {
      // Live planning data. A stale zoning or FSR read as current is exactly
      // the kind of confident wrong answer this endpoint exists to avoid.
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        error: 'The dossier could not be assembled.',
        detail: String(e?.message ?? e),
        note: 'This is a failure of the request, not a finding about the site. Nothing here should '
            + 'be read as an absence of constraints.',
      },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  return respond(fromQuery(req.nextUrl.searchParams));
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return NextResponse.json({ error: 'Body must be a JSON object.' }, { status: 400 });

  const { rings, error } = readRings(body.rings);
  if (error) return NextResponse.json({ error }, { status: 400 });

  // Query string still works on POST, so a drawn polygon can be combined with
  // commercial inputs without restating them in the body.
  const input: DossierInput = { ...fromQuery(req.nextUrl.searchParams) };
  const keys: (keyof DossierInput)[] = [
    'lat', 'lng', 'expandAdjacent', 'imSiteAreaM2', 'imGfaM2', 'imUnits', 'leadType',
    'grvAud', 'ppsmAud', 'unitCount', 'lotCount', 'marginPct', 'turnaroundMonths',
    'salePricePerSqmNsa', 'nsaEfficiency', 'avgUnitSizeSqm',
  ];
  for (const k of keys) if (body[k] !== undefined) (input as any)[k] = body[k];
  if (Array.isArray(body.lots) && body.lots.length)
    input.lots = body.lots.map(String);
  else if (typeof body.lots === 'string')
    input.lots = splitLots(body.lots);
  if (rings) input.rings = rings;

  return respond(input);
}
