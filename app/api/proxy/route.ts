import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';

/** Narrow proxy for the two sources that send no CORS header: NSW EPA
 *  contaminated land and the ABS data API. Allow-list only — an open proxy
 *  on a public deployment is an abuse vector, not a convenience. */
const ALLOW = [
  'https://mapprod2.environment.nsw.gov.au/',
  'https://data.api.abs.gov.au/',
  // WA's planning host returns data to a server but sends no
  // Access-Control-Allow-Origin on GET, HEAD or even preflight, so the
  // browser blocks it. The CORS-enabled SLIP mirror covers most of WA;
  // this is for the richer espatial cadastre that SLIP does not carry.
  'https://espatial.dplh.wa.gov.au/',
  // SA's authoritative service is CloudFront geo-blocked outside Australia.
  // Allow-listed so it works the moment this runs from an AU host.
  'https://location.sa.gov.au/',
  'https://lsa2.geohub.sa.gov.au/',
];

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get('url');
  if (!target) return NextResponse.json({ error: 'url required' }, { status: 400 });
  if (!ALLOW.some((a) => target.startsWith(a)))
    return NextResponse.json({ error: 'host not allowed' }, { status: 403 });
  try {
    const r = await fetch(target, { headers: { Accept: 'application/json' } });
    const body = await r.text();
    return new NextResponse(body, {
      status: r.status,
      headers: { 'Content-Type': r.headers.get('content-type') ?? 'application/json' },
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 502 });
  }
}
