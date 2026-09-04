import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE, tokenFor, safeEqual, config as gateConfig } from '@/lib/auth';

export async function middleware(req: NextRequest) {
  const { pin, secret, enabled } = gateConfig();

  // Fail CLOSED. If the env vars are missing the site is locked, not open --
  // a misconfigured deploy must never silently publish the tool.
  if (!enabled) {
    return new NextResponse(
      'Land Intel is not configured (LAND_INTEL_PIN / LAND_INTEL_SECRET). ' +
        'Access denied until it is.',
      { status: 503, headers: { 'content-type': 'text/plain' } },
    );
  }

  const got = req.cookies.get(COOKIE)?.value ?? '';
  const want = await tokenFor(pin, secret);
  if (got && safeEqual(got, want)) return NextResponse.next();

  // API callers get a clean 401 rather than an HTML login page.
  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Locked' }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = '/gate';
  url.search = '';
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/((?!gate|api/gate|_next/static|_next/image|favicon.ico).*)'],
};
