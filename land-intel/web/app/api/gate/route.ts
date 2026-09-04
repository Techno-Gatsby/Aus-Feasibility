import { NextResponse } from 'next/server';
import { COOKIE, tokenFor, safeEqual, config } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Crude but effective throttle against PIN guessing. Per-instance only --
// enough to make a 4-digit space impractical to sweep, not a substitute for
// a real rate limiter if this ever goes properly public.
const attempts = new Map<string, { n: number; until: number }>();
const WINDOW_MS = 60_000;
const MAX_TRIES = 8;

export async function POST(req: Request) {
  const { pin, secret, enabled } = config();
  if (!enabled) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const now = Date.now();
  const rec = attempts.get(ip);
  if (rec && now < rec.until && rec.n >= MAX_TRIES) {
    return NextResponse.json(
      { error: 'Too many attempts. Wait a minute.' }, { status: 429 },
    );
  }

  let given = '';
  try {
    given = String((await req.json())?.pin ?? '');
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  if (!safeEqual(given, pin)) {
    const next = rec && now < rec.until
      ? { n: rec.n + 1, until: rec.until }
      : { n: 1, until: now + WINDOW_MS };
    attempts.set(ip, next);
    return NextResponse.json({ error: 'Incorrect PIN' }, { status: 401 });
  }

  attempts.delete(ip);
  // Secure cookies are dropped by the browser over plain http, which would
  // silently break local dev. Follow the actual protocol instead.
  const https = (req.headers.get('x-forwarded-proto') ?? 'http') === 'https';
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, await tokenFor(pin, secret), {
    httpOnly: true,
    secure: https,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  return res;
}
