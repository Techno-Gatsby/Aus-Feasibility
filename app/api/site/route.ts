import { NextRequest, NextResponse } from 'next/server';
import { layersFor, SUPPORTED, type LayerDef } from '@/lib/layers';
import { atPoint, presence, inBox, ringsToLatLng } from '@/lib/arcgis';
import { stateOf, STATE_NAME, type StateCode } from '@/lib/geo';

export const runtime = 'nodejs';

/** One call returns everything known about a point, for whichever state the
 *  point falls in. Runs server-side so CORS-blocked sources work and a slow
 *  council server cannot block paint.
 *
 *  A state with no wired layers returns a plain statement to that effect.
 *  Australia has no national planning dataset; pretending otherwise by
 *  returning an empty result set would read as "nothing here" when it means
 *  "nobody has published this". */
export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get('lat'));
  const lng = Number(req.nextUrl.searchParams.get('lng'));
  if (!isFinite(lat) || !isFinite(lng))
    return NextResponse.json({ error: 'lat/lng required' }, { status: 400 });

  const p = { lat, lng };
  const state = stateOf(p);
  const layers = layersFor(state);

  if (!state)
    return NextResponse.json({
      state: null, supported: false,
      message: 'That point is outside Australia.',
    });

  if (!layers.length)
    return NextResponse.json({
      state, stateName: STATE_NAME[state], supported: false,
      supportedStates: SUPPORTED(),
      message:
        `${STATE_NAME[state]} is not wired yet. Australia has no national planning ` +
        `dataset — each state publishes its own, and only ${SUPPORTED().join(', ')} ` +
        `${SUPPORTED().length === 1 ? 'is' : 'are'} connected so far.`,
    });

  const pad = 0.004;
  const results = await Promise.allSettled(
    layers.map(async (L: LayerDef) => {
      if (L.purpose === 'cadastre') {
        const r = await atPoint(L.url, p, '*', true);
        return [L.purpose, {
          error: r.error,
          attrs: r.features[0]?.attributes ?? null,
          rings: r.features[0] ? ringsToLatLng(r.features[0]) : [],
        }] as const;
      }
      const pres = await presence(L.url, p);
      const geo = await inBox(
        L.url, [p.lng - pad, p.lat - pad, p.lng + pad, p.lat + pad],
        L.starFieldsOnly ? '*' : '*', 12, true,
      );
      return [L.purpose, {
        ...pres,
        shapes: (geo.features ?? []).map(ringsToLatLng).filter((x: unknown[]) => x.length),
      }] as const;
    }),
  );

  const out: Record<string, any> = {};
  results.forEach((r, i) => {
    const key = layers[i].purpose;
    out[key] = r.status === 'fulfilled' ? r.value[1] : { error: 'request failed' };
  });

  const cadLayer = layers.find((l) => l.purpose === 'cadastre');
  const cad = out.cadastre?.attrs;
  let areaM2: number | null = null;
  if (cad) {
    const raw = Number(cad.planlotarea ?? cad.AREA ?? cad.Shape__Area);
    if (isFinite(raw) && raw > 0) {
      areaM2 = raw;
      if (String(cad.planlotareaunits ?? '').toLowerCase().includes('hect')) areaM2 *= 10000;
    }
  }
  const zoneLayer = layers.find((l) => l.purpose === 'zoning');
  const zoneVal = zoneLayer?.field ? out.zoning?.attrs?.[zoneLayer.field] ?? null : null;

  return NextResponse.json({
    state, stateName: STATE_NAME[state], supported: true,
    supportedStates: SUPPORTED(),
    point: p,
    parcel: cad
      ? {
          lotId: (cadLayer?.field && cad[cadLayer.field]) || null,
          areaM2, areaHa: areaM2 ? areaM2 / 10000 : null,
          urbanity: cad.urbanity ?? null,
          ownership: 'not public in Australia — a title search is paid, per search, '
                   + 'through the state land registry',
        }
      : null,
    zoning: zoneVal,
    zoningEpi: out.zoning?.attrs?.EPI_NAME ?? out.zoning?.attrs?.SCHEME_CODE ?? null,
    hazard: {
      flood: !!out.flood?.present,
      bushfire: !!out.bushfire?.present,
      bushfireCategory: out.bushfire?.attrs?.Category ?? null,
      bushfireNearby: !!out.bushfire?.near && !out.bushfire?.present,
      landslide: !!out.landslide?.present,
      biodiversity: !!out.biodiversity?.present,
    },
    available: layers.map((l) => l.purpose),
    shapes: Object.fromEntries(
      layers.map((l) => [l.purpose,
        l.purpose === 'cadastre' ? (out.cadastre?.rings ?? []) : (out[l.purpose]?.shapes ?? [])]),
    ),
    errors: Object.fromEntries(
      Object.entries(out).filter(([, v]: any) => v?.error).map(([k, v]: any) => [k, v.error]),
    ),
  });
}
