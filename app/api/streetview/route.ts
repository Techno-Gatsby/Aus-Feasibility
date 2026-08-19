import { NextRequest, NextResponse } from 'next/server';
import { bearing, metres } from '@/lib/geo';
export const runtime = 'nodejs';

/** Resolves the nearest panorama and returns an image URL already aimed at
 *  the site. The key stays on the server; the browser never sees it. */
export async function GET(req: NextRequest) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return NextResponse.json({ available: false, reason: 'no key configured' });

  const lat = Number(req.nextUrl.searchParams.get('lat'));
  const lng = Number(req.nextUrl.searchParams.get('lng'));
  if (!isFinite(lat) || !isFinite(lng))
    return NextResponse.json({ available: false, reason: 'lat/lng required' }, { status: 400 });

  const meta = await fetch(
    `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}` +
    `&radius=200&key=${encodeURIComponent(key)}`,
  ).then((r) => r.json());

  if (meta?.status !== 'OK')
    return NextResponse.json({ available: false, reason: 'no panorama within 200 m' });

  const cam = { lat: meta.location.lat, lng: meta.location.lng };
  const site = { lat, lng };
  const heading = Math.round(bearing(cam, site));
  const distance = Math.round(metres(cam, site));

  return NextResponse.json({
    available: true, heading, distance,
    image: `/api/streetview/image?lat=${cam.lat}&lng=${cam.lng}&heading=${heading}`,
    note: 'The nearest road may not front the land.',
  });
}
