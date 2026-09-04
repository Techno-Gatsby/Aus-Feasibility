// App-level PIN gate.
//
// Vercel's own Password Protection is a Pro feature and this project is on
// Hobby, so the gate lives in the app. The cookie stores an HMAC of the PIN
// under a server-only secret -- never the PIN itself -- so a stolen cookie
// cannot be read back into the PIN, and rotating the secret invalidates every
// existing session.

export const COOKIE = 'li_auth';

function bytesToHex(b: ArrayBuffer) {
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function tokenFor(pin: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(`land-intel:${pin}`),
  );
  return bytesToHex(sig);
}

/** Length-independent constant-time compare. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function config() {
  const pin = process.env.LAND_INTEL_PIN ?? '';
  const secret = process.env.LAND_INTEL_SECRET ?? '';
  return { pin, secret, enabled: pin.length > 0 && secret.length > 0 };
}
