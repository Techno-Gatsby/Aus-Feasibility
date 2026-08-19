import { NextRequest, NextResponse } from 'next/server';
import { layersFor, SUPPORTED, type LayerDef, type Purpose } from '@/lib/layers';
import { inBox, ringsToLatLng, type Box } from '@/lib/arcgis';
import { stateOf, STATE_NAME, type StateCode } from '@/lib/geo';
import {
  analyseConstraints, boundsOf, CAVEATS, DEFAULT_N, MAX_N,
  type ConstraintLayerInput, type LatLng, type Polygon, type PolygonSet,
} from '@/lib/constraints';

export const runtime = 'nodejs';

/**
 * POST /api/constraints
 *   { rings: [lat,lng][][], state?: StateCode, layers?: Purpose[], n?: number }
 *
 * Answers the only question that matters before a land offer: of the ground
 * inside this boundary, how much can actually be built on once every mapped
 * hazard is laid over it AT ONCE.
 *
 * The union, not the sum. Flood and wetland share a drainage line; bushfire
 * and biodiversity share the same remnant vegetation. Add the layers up and
 * you write off the same acre three times. The response carries both figures
 * side by side precisely so the double-count is visible rather than buried.
 *
 * Runs server-side: the NSW EPA contamination layer sends no CORS header, and
 * a slow council server should never be able to block paint in the browser.
 *
 * The numbers are a GRID SAMPLE and are approximate by construction — the
 * response says so in `caveats`, which is not boilerplate and should be shown
 * to the user, not stripped.
 */

/** Layers that take land away. Zoning, FSR, height and cadastre describe what
 *  you may build; they do not subtract developable ground, so they have no
 *  business in a constraint union. Contamination is included: notified land
 *  is not unbuildable in law but it is unfundable in practice until remediated,
 *  and a feasibility that ignores that is optimistic, not neutral. */
const HAZARD_PURPOSES: Purpose[] = [
  'flood', 'bushfire', 'landslide', 'biodiversity', 'contamination',
];

/** Per-layer feature cap. A generalised hazard polygon set over a single site
 *  is a handful of features; 200 is far beyond any real site and exists only
 *  so a mis-drawn boundary spanning half a state cannot pull down a million
 *  vertices. */
const FEATURE_LIMIT = 200;

/** Pad the fetch box beyond the site so a polygon that merely clips the
 *  corner is still returned whole. Roughly 200 m. */
const FETCH_PAD_DEG = 0.002;

type Body = {
  rings?: unknown;
  state?: unknown;
  layers?: unknown;
  n?: unknown;
};

export async function POST(req: NextRequest) {
  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const site = parseSite(body.rings);
  if ('error' in site) return NextResponse.json({ error: site.error }, { status: 400 });

  const b = boundsOf(site.polygons);
  if (!b) return NextResponse.json({ error: 'site polygon has no usable vertices' }, { status: 400 });
  const centre = { lat: (b[0] + b[2]) / 2, lng: (b[1] + b[3]) / 2 };

  const asked = typeof body.state === 'string' ? body.state.toUpperCase() : null;
  const state = (asked as StateCode | null) ?? stateOf(centre);

  if (!state)
    return NextResponse.json({
      ok: false, state: null, supported: false,
      message: 'That boundary sits outside Australia.',
    });

  const wired = layersFor(state);
  if (!wired.length)
    return NextResponse.json({
      ok: false, state, stateName: STATE_NAME[state], supported: false,
      supportedStates: SUPPORTED(),
      message:
        `${STATE_NAME[state]} is not wired yet. Australia has no national ` +
        `planning dataset — each state publishes its own, and only ` +
        `${SUPPORTED().join(', ')} ${SUPPORTED().length === 1 ? 'is' : 'are'} ` +
        `connected so far. A constraint union over a partial layer set would ` +
        `understate the loss, so none is returned.`,
    });

  // Which hazards to test. An explicit list is honoured but still filtered to
  // hazards — asking for 'zoning' here is a category error, not a constraint.
  const wanted: Purpose[] = Array.isArray(body.layers) && body.layers.length
    ? (body.layers as unknown[])
        .filter((x): x is Purpose => typeof x === 'string' && HAZARD_PURPOSES.includes(x as Purpose))
    : HAZARD_PURPOSES;

  const defs = wired.filter((l) => wanted.includes(l.purpose));
  if (!defs.length)
    return NextResponse.json({
      ok: false, state, stateName: STATE_NAME[state],
      message: `No hazard layers available in ${STATE_NAME[state]} for: ${wanted.join(', ')}.`,
    }, { status: 422 });

  const box: Box = [
    b[1] - FETCH_PAD_DEG, b[0] - FETCH_PAD_DEG,
    b[3] + FETCH_PAD_DEG, b[2] + FETCH_PAD_DEG,
  ];

  const fetched = await Promise.all(defs.map(async (L: LayerDef) => {
    try {
      const r = await inBox(L.url, box, '*', FEATURE_LIMIT, true);
      const polygons: PolygonSet = (r.features ?? [])
        .map(ringsToLatLng)
        .filter((p: LatLng[][]) => p.length > 0);
      return { def: L, polygons, error: r.error, truncated: (r.features?.length ?? 0) >= FEATURE_LIMIT };
    } catch (e: unknown) {
      return { def: L, polygons: [] as PolygonSet, error: String(e), truncated: false };
    }
  }));

  // A layer that ERRORED is not a layer that is clear. Excluding it silently
  // would report more developable land than the data supports, which is the
  // one direction of error that loses money. It is dropped from the maths and
  // named loudly in `unavailable`.
  const usable = fetched.filter((f) => !f.error);
  const unavailable = fetched
    .filter((f) => f.error)
    .map((f) => ({ layer: f.def.purpose, label: f.def.label, error: f.error }));

  const inputs: ConstraintLayerInput[] = usable.map((f) => ({
    key: f.def.purpose,
    label: f.def.label,
    polygons: f.polygons,
  }));

  const n = clampN(body.n);
  const result = analyseConstraints(site.polygons, inputs, { n });
  if (!result.ok)
    return NextResponse.json({ ok: false, error: result.error }, { status: 422 });

  const truncated = usable.filter((f) => f.truncated).map((f) => f.def.purpose);

  return NextResponse.json({
    ...result,
    state,
    stateName: STATE_NAME[state],
    layersTested: inputs.map((i) => i.key),
    unavailable,
    // Every reason the answer might be wrong, in one place, at the top level
    // where a UI cannot claim it did not see them.
    caveats: [
      ...CAVEATS,
      ...(unavailable.length
        ? [`${unavailable.length} layer(s) could not be reached (` +
           `${unavailable.map((u) => u.layer).join(', ')}). They are excluded ` +
           `from the union, so the developable figure is an UPPER bound.`]
        : []),
      ...(truncated.length
        ? [`Feature cap of ${FEATURE_LIMIT} hit on: ${truncated.join(', ')}. ` +
           `Some geometry may be missing; developable area is overstated.`]
        : []),
      ...(result.site.gridVsExactError > 0.02
        ? [`Grid area differs from the exact boundary area by ` +
           `${(result.site.gridVsExactError * 100).toFixed(1)}%. The site shape ` +
           `is fine relative to the grid — re-run with a higher n.`]
        : []),
    ],
  });
}

function clampN(v: unknown): number {
  const x = Number(v);
  if (!isFinite(x) || x <= 0) return DEFAULT_N;
  return Math.max(4, Math.min(MAX_N, Math.round(x)));
}

/**
 * Accepts either a single polygon ([lat,lng][][] — outer ring then holes) or
 * a list of them. Validates coordinate ORDER as far as it can: latitudes
 * outside +/-90 mean the caller passed [lng,lat], which would silently place
 * the site in the wrong hemisphere and return a confident, useless answer.
 */
function parseSite(raw: unknown): { polygons: PolygonSet } | { error: string } {
  if (!Array.isArray(raw) || !raw.length) return { error: 'rings required' };

  const depth = arrayDepth(raw);
  let polys: unknown[];
  if (depth === 3) polys = [raw];        // one polygon: [ring][vertex][coord]
  else if (depth === 4) polys = raw;     // many polygons
  else return { error: 'rings must be [lat,lng][][] or [lat,lng][][][]' };

  const out: PolygonSet = [];
  for (const p of polys) {
    if (!Array.isArray(p)) return { error: 'malformed polygon' };
    const poly: Polygon = [];
    for (const ring of p) {
      if (!Array.isArray(ring)) return { error: 'malformed ring' };
      const pts: LatLng[] = [];
      for (const v of ring) {
        if (!Array.isArray(v) || v.length < 2) return { error: 'malformed vertex' };
        const lat = Number(v[0]), lng = Number(v[1]);
        if (!isFinite(lat) || !isFinite(lng)) return { error: 'non-numeric vertex' };
        if (Math.abs(lat) > 90)
          return { error: `latitude ${lat} out of range — coordinates must be [lat,lng], not [lng,lat]` };
        if (Math.abs(lng) > 180) return { error: `longitude ${lng} out of range` };
        pts.push([lat, lng]);
      }
      if (pts.length >= 3) poly.push(pts);
    }
    if (poly.length) out.push(poly);
  }
  if (!out.length) return { error: 'no ring had three or more vertices' };
  return { polygons: out };
}

/** Nesting depth of the first spine of an array. Used only to tell a single
 *  polygon from a list of them; both shapes are common in the wild. */
function arrayDepth(a: unknown): number {
  let d = 0;
  let cur: unknown = a;
  while (Array.isArray(cur)) { d++; cur = cur[0]; }
  return d;
}
