import { NextRequest, NextResponse } from 'next/server';
import { inAustralia } from '@/lib/geo';

export const runtime = 'nodejs';

type Hit = { label: string; lng: number; lat: number; source: string; precise: boolean };

/** Google first when a key is configured (better on unit and lot level
 *  Australian addresses), Photon as fallback so the app still works with no
 *  key at all. Every hit is bounds-checked: the previous build accepted a
 *  result 550 km from the requested suburb and flew there. */
async function google(q: string): Promise<Hit[]> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return [];
  const u =
    'https://maps.googleapis.com/maps/api/geocode/json?address=' +
    encodeURIComponent(q) +
    '&region=au&components=country:AU&key=' + encodeURIComponent(key);
  const r = await fetch(u, { next: { revalidate: 0 } });
  const j = await r.json();
  if (j.status !== 'OK') return [];
  return (j.results ?? []).slice(0, 8).map((x: any) => ({
    label: x.formatted_address,
    lng: x.geometry.location.lng,
    lat: x.geometry.location.lat,
    source: 'google',
    precise: x.geometry.location_type === 'ROOFTOP',
  }));
}

async function photon(q: string): Promise<Hit[]> {
  const query = /\baustralia\b/i.test(q) ? q : `${q}, Australia`;
  const r = await fetch(
    `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=8&lang=en`,
  );
  const j = await r.json();
  return (j.features ?? [])
    .filter((f: any) => {
      const cc = String(f.properties?.countrycode ?? '').toLowerCase();
      return !cc || cc === 'au';
    })
    .map((f: any) => ({
      label: [f.properties?.name, f.properties?.city, f.properties?.state]
        .filter(Boolean).join(', '),
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      source: 'photon',
      precise: f.properties?.osm_key === 'building',
    }));
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q || q.length < 3)
    return NextResponse.json({ hits: [], error: 'query too short' }, { status: 400 });

  // "lat,lng" typed directly
  const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    const p = Math.abs(a) <= 90 ? { lat: a, lng: b } : { lat: b, lng: a };
    if (!inAustralia(p))
      return NextResponse.json({ hits: [], error: 'coordinates are outside Australia' });
    return NextResponse.json({
      hits: [{ label: `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`, ...p,
               source: 'coords', precise: true }],
    });
  }

  let hits: Hit[] = [];
  let error: string | null = null;
  try { hits = await google(q); } catch { /* fall through */ }
  if (!hits.length) {
    try { hits = await photon(q); }
    catch (e: any) { error = String(e?.message ?? e); }
  }

  const inside = hits.filter((h) => inAustralia(h));
  const dropped = hits.length - inside.length;
  return NextResponse.json({
    hits: inside,
    dropped,
    error: inside.length ? null : (error ?? 'no match in Australia'),
  });
}
