import { NextResponse } from 'next/server';
import { analyse, geocode } from '@/lib/analyse';

// Fan-out across ~20 upstream services with elevation sampling; well inside
// the 300s function limit but nowhere near instant.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  try {
    const address = q.get('address');
    const latlon = q.get('latlon');
    const propId = q.get('propId');

    let lat: number | undefined;
    let lon: number | undefined;
    let matched: string | undefined;

    if (address) {
      const g = await geocode(address);
      if (!g) {
        return NextResponse.json(
          { error: `Could not find that address: "${address}"` },
          { status: 404 },
        );
      }
      lat = g.lat; lon = g.lon; matched = g.matched;
    } else if (latlon) {
      const [a, b] = latlon.split(',').map(Number);
      if (!isFinite(a) || !isFinite(b)) {
        return NextResponse.json(
          { error: 'latlon must be "lat,lon"' }, { status: 400 },
        );
      }
      lat = a; lon = b;
    } else if (!propId) {
      return NextResponse.json(
        { error: 'Provide address, latlon or propId' }, { status: 400 },
      );
    }

    const result = await analyse({
      lat, lon, propId: propId ? Number(propId) : undefined,
    });
    if ('error' in result && result.error) {
      return NextResponse.json(result, { status: 404 });
    }
    return NextResponse.json({ ...result, matchedAddress: matched ?? null });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
