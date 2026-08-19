import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';

/** Narrow proxy for the two sources that send no CORS header: NSW EPA
 *  contaminated land and the ABS data API. Allow-list only — an open proxy
 *  on a public deployment is an abuse vector, not a convenience. */
const ALLOW = [
  'https://mapprod2.environment.nsw.gov.au/',
  'https://data.api.abs.gov.au/',
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
