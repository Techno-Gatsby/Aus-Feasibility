import { NextRequest, NextResponse } from 'next/server';
import { analyseTerrain, boxAround, slopeVerdict, type Box } from '@/lib/terrain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Terrain / slope screening for a point or a drawn footprint.
 *
 *  The Google Elevation call lives HERE and only here: GOOGLE_MAPS_API_KEY is
 *  server-side, and the moment an elevation URL is built in the browser the
 *  key is in a network tab. Without a key the route silently uses terrarium
 *  tiles and says so in `source` — the caller is never left guessing which
 *  dataset produced the number.
 *
 *  ?lat= &lng=      centre of a square footprint
 *  ?half=           half-width in metres (default 100 → a 200 m square)
 *  ?bbox=w,s,e,n    exact footprint, overrides lat/lng/half
 *  ?n=              grid is n x n (default 6 → 36 samples)
 */
/** null for absent or unparseable, so an omitted parameter can never be
 *  mistaken for zero. */
const num = (v: string | null): number | null => {
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;

  let bbox: Box | null = null;
  const raw = q.get('bbox');
  if (raw) {
    const v = raw.split(',').map(Number);
    if (v.length === 4 && v.every(Number.isFinite) && v[2] > v[0] && v[3] > v[1])
      bbox = [v[0], v[1], v[2], v[3]];
    else
      return NextResponse.json({ ok: false, reason: 'bbox must be w,s,e,n with e>w and n>s' }, { status: 400 });
  } else {
    // num(), not Number(): Number(null) is 0, so a missing lat silently
    // becomes the equator and the route answers about the Gulf of Guinea
    // instead of refusing. Verified — it returned 200 with sea level.
    const lat = num(q.get('lat')), lng = num(q.get('lng'));
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180)
      return NextResponse.json(
        { ok: false, reason: 'lat and lng are required, and must be a real coordinate' },
        { status: 400 });
    const half = Math.max(25, Math.min(5000, num(q.get('half')) ?? 100));
    bbox = boxAround(lat, lng, half);
  }

  const n = Math.max(3, Math.min(12, Math.round(num(q.get('n')) ?? 6)));

  const result = await analyseTerrain({
    bbox,
    n,
    // Read at request time, never at module load: a key added to the
    // environment should take effect on the next request.
    googleKey: process.env.GOOGLE_MAPS_API_KEY || null,
    timeoutMs: 12000,
  });

  return NextResponse.json(
    { ...result, verdict: slopeVerdict(result) },
    { headers: { 'Cache-Control': 'private, max-age=300' } },
  );
}
