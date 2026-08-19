import { NextRequest, NextResponse } from 'next/server';
import { LAYERS, byId } from '@/lib/layers';
import { atPoint, presence, inBox, ringsToLatLng } from '@/lib/arcgis';
import { inNSW } from '@/lib/geo';
export const runtime = 'nodejs';

/** One call returns everything known about a point. Runs server-side so the
 *  CORS-blocked sources work and a slow council server cannot block paint. */
export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get('lat'));
  const lng = Number(req.nextUrl.searchParams.get('lng'));
  if (!isFinite(lat) || !isFinite(lng))
    return NextResponse.json({ error: 'lat/lng required' }, { status: 400 });
  const p = { lat, lng };

  if (!inNSW(p))
    return NextResponse.json({
      state: null,
      supported: false,
      message:
        'Only NSW is wired. The other states publish planning and hazard ' +
        'separately and each needs its own endpoint set.',
    });

  const want = ['zoning', 'fsr', 'height', 'flood', 'bushfire', 'landslide',
                'biodiversity', 'cadastre'];

  const results = await Promise.allSettled(
    want.map(async (id) => {
      const L = byId(id)!;
      if (id === 'cadastre') {
        // outFields '*' only — named lists fail on this layer.
        const r = await atPoint(L.url, p, '*', true);
        return [id, {
          error: r.error,
          attrs: r.features[0]?.attributes ?? null,
          rings: r.features[0] ? ringsToLatLng(r.features[0]) : [],
        }] as const;
      }
      // Geometry as well as presence: the map has to DRAW these, not just
      // report yes/no. A hazard you cannot see on the parcel is not useful.
      const r = await presence(L.url, p);
      const geo = await inBox(
        L.url,
        [p.lng - 0.004, p.lat - 0.004, p.lng + 0.004, p.lat + 0.004],
        '*', 12, true,
      );
      return [id, { ...r, shapes: (geo.features ?? []).map(ringsToLatLng).filter((x: unknown[]) => x.length) }] as const;
    }),
  );

  const out: Record<string, any> = {};
  results.forEach((r, i) => {
    const id = want[i];
    out[id] = r.status === 'fulfilled' ? r.value[1] : { error: 'request failed' };
  });

  const cad = out.cadastre?.attrs;
  let areaM2: number | null = null;
  if (cad?.planlotarea) {
    areaM2 = Number(cad.planlotarea);
    if (String(cad.planlotareaunits ?? '').toLowerCase().includes('hect'))
      areaM2 *= 10000;
  }

  return NextResponse.json({
    state: 'NSW',
    supported: true,
    point: p,
    parcel: cad
      ? {
          lotId: cad.lotidstring ?? null,
          areaM2,
          areaHa: areaM2 ? areaM2 / 10000 : null,
          urbanity: cad.urbanity ?? null,
          ownership: 'not public — a NSW title search is paid, per search, via LRS',
        }
      : null,
    zoning: out.zoning?.attrs?.SYM_CODE ?? null,
    zoningEpi: out.zoning?.attrs?.EPI_NAME ?? null,
    hazard: {
      flood: !!out.flood?.present,
      bushfire: !!out.bushfire?.present,
      bushfireCategory: out.bushfire?.attrs?.Category ?? null,
      bushfireNearby: !!out.bushfire?.near && !out.bushfire?.present,
      landslide: !!out.landslide?.present,
      biodiversity: !!out.biodiversity?.present,
    },
    shapes: {
      parcel: out.cadastre?.rings ?? [],
      flood: out.flood?.shapes ?? [],
      bushfire: out.bushfire?.shapes ?? [],
      landslide: out.landslide?.shapes ?? [],
      biodiversity: out.biodiversity?.shapes ?? [],
      zoning: out.zoning?.shapes ?? [],
    },
    errors: Object.fromEntries(
      Object.entries(out).filter(([, v]: any) => v?.error).map(([k, v]: any) => [k, v.error]),
    ),
  });
}
