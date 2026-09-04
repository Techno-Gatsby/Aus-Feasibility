import { NextResponse } from 'next/server';
import { cached, keyOf, TTL } from '@/lib/cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Google Maps Embed API is free of charge with no usage cap, and Street View
// *metadata* requests are also free — so this costs nothing to run, but it
// does need a key and therefore a Google Cloud project with billing enabled.
//
// The key ends up in the iframe src and is visible in the DOM. That is normal
// and expected for the Embed API, but it means the key MUST be restricted by
// HTTP referrer to this domain, and scoped to Maps Embed + Street View Static
// only. An unrestricted key pasted here is a billable liability.

const META = 'https://maps.googleapis.com/maps/api/streetview/metadata';

/** Initial bearing from (lat1,lon1) to (lat2,lon2), degrees clockwise from N. */
function bearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = Math.PI / 180;
  const dLon = (lon2 - lon1) * r;
  const y = Math.sin(dLon) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) -
    Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos(dLon);
  return (Math.atan2(y, x) / r + 360) % 360;
}

function metres(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * 111_320;
  const dLon = (lon2 - lon1) * 111_320 * Math.cos(((lat1 + lat2) / 2) * r);
  return Math.hypot(dLat, dLon);
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const lat = Number(q.get('lat'));
  const lon = Number(q.get('lon'));
  if (!isFinite(lat) || !isFinite(lon)) {
    return NextResponse.json({ error: 'lat and lon required' }, { status: 400 });
  }

  const key = process.env.GOOGLE_MAPS_API_KEY ?? '';
  if (!key) {
    return NextResponse.json({
      status: 'no-key',
      message:
        'Street View embed not configured. Create a Google Cloud project, ' +
        'enable "Maps Embed API" and "Street View Static API", create an ' +
        'API key restricted by HTTP referrer to this domain, then set ' +
        'GOOGLE_MAPS_API_KEY. Both APIs are free of charge, but Google ' +
        'requires a billing account on the project.',
    });
  }

  // Rural tracts frequently have no imagery. Check before rendering a frame,
  // so the UI can say "none nearby" instead of showing a grey void.
  const radius = Number(q.get('radius') ?? 400);
  const out = await cached(
    keyOf('sv', lat.toFixed(5), lon.toFixed(5), radius), TTL.slow, ['streetview'],
    async () => {
      const u = `${META}?${new URLSearchParams({
        location: `${lat},${lon}`, radius: String(radius),
        source: 'outdoor', key,
      })}`;
      const d = await (await fetch(u, { cache: 'no-store' })).json();
      return d as {
        status: string; date?: string; pano_id?: string;
        location?: { lat: number; lng: number };
      };
    },
  );

  if (out.status !== 'OK' || !out.location) {
    return NextResponse.json({
      status: out.status === 'ZERO_RESULTS' ? 'none-nearby' : 'error',
      googleStatus: out.status,
      radius,
      message: out.status === 'ZERO_RESULTS'
        ? `No Street View imagery within ${radius} m. Common on raw exurban ` +
          'land with no public road frontage.'
        : `Google returned ${out.status}. Check the key restrictions and that ` +
          'the Street View Static API is enabled.',
    });
  }

  const pLat = out.location.lat;
  const pLon = out.location.lng;
  // Point the camera at the tract rather than wherever the car was facing.
  const heading = Math.round(bearing(pLat, pLon, lat, lon));

  const embed = `https://www.google.com/maps/embed/v1/streetview?${new URLSearchParams({
    key,
    location: `${pLat},${pLon}`,
    heading: String(heading),
    pitch: '0',
    fov: '90',
  })}`;

  return NextResponse.json({
    status: 'ok',
    embedUrl: embed,
    heading,
    imageryDate: out.date ?? null,
    distanceM: Math.round(metres(lat, lon, pLat, pLon)),
    panoLat: pLat,
    panoLon: pLon,
  });
}
