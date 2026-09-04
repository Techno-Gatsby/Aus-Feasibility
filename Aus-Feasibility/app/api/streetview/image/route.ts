import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';

/** Streams the panorama so the key is never exposed to the client. */
export async function GET(req: NextRequest) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return new NextResponse('not configured', { status: 503 });
  const p = req.nextUrl.searchParams;
  const url =
    `https://maps.googleapis.com/maps/api/streetview?size=640x360` +
    `&location=${p.get('lat')},${p.get('lng')}` +
    `&heading=${p.get('heading') ?? 0}&pitch=0&fov=80&key=${encodeURIComponent(key)}`;
  const r = await fetch(url);
  if (!r.ok) return new NextResponse('unavailable', { status: r.status });
  return new NextResponse(r.body, {
    headers: {
      'Content-Type': r.headers.get('content-type') ?? 'image/jpeg',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
