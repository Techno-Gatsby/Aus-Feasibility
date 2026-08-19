import { NextRequest, NextResponse } from 'next/server';
import { nearbyPoi, POI_KINDS, type PoiKind } from '@/lib/poi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Nearby schools, shops, transport and hospitals from OpenStreetMap.
 *
 *  Server-side so the browser is not the thing being rate-limited by
 *  Overpass, and so one slow endpoint cannot block paint. The route always
 *  returns 200 with a `queried` flag: an Overpass failure is a reportable
 *  state, not an HTTP error the panel has to guess at.
 *
 *  ?lat= &lng=   centre
 *  ?radius=      metres, 200–10000, default 2000
 *  ?limit=       items per category, default 5
 *  ?kinds=       comma list of school,shop,transport,hospital
 */
/** null for absent or unparseable. Number(null) is 0, which would turn a
 *  missing lat into a query off the coast of Africa answered with a
 *  confident "nothing nearby". */
const num = (v: string | null): number | null => {
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const lat = num(q.get('lat')), lng = num(q.get('lng'));
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return NextResponse.json(
      { queried: false, error: 'lat and lng are required, and must be a real coordinate', categories: [] },
      { status: 400 });

  const radius = num(q.get('radius')) ?? 2000;
  const limit = num(q.get('limit')) ?? 5;
  const kinds = (q.get('kinds') ?? '')
    .split(',').map((s) => s.trim()).filter((s): s is PoiKind => (POI_KINDS as string[]).includes(s));

  const result = await nearbyPoi({ lat, lng }, radius, {
    limit,
    kinds: kinds.length ? kinds : undefined,
    timeoutMs: 15000,
  });

  return NextResponse.json(result, {
    // Only cache a real answer. Caching a timeout would turn one bad minute
    // into five minutes of "no schools nearby".
    headers: { 'Cache-Control': result.queried ? 'private, max-age=600' : 'no-store' },
  });
}
