import { getCache } from '@vercel/functions';

// Caching sits at the level of the individual upstream call, not the whole
// analysis. Two reasons: analysis payloads for a big tract can exceed the 2 MB
// item limit, and per-call caching lets unrelated tracts share work -- the same
// elevation point, the same flood polygon, the same parcel query while panning.

export const TTL = {
  /** Terrain does not change. */
  elevation: 60 * 60 * 24 * 365,
  /** SSURGO is revised on a multi-year cycle. */
  soils: 60 * 60 * 24 * 180,
  /** FEMA/NWI/CCN/RRC revise on the order of months. */
  slow: 60 * 60 * 24 * 30,
  /** CAD parcels refresh nightly; zoning changes at council cadence. */
  parcel: 60 * 60 * 24 * 7,
  /** Development applications are the only near-live layer. */
  live: 60 * 60 * 6,
} as const;

const MAX_ITEM_BYTES = 1_800_000; // Runtime Cache item limit is 2 MB.

// Local dev and any environment without the Runtime Cache falls back to an
// in-process map. Correct either way -- just not shared between instances.
const mem = new Map<string, { v: unknown; exp: number }>();

function memGet(key: string) {
  const hit = mem.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.exp) { mem.delete(key); return undefined; }
  return hit.v;
}

let warned = false;

export async function cached<T>(
  key: string,
  ttlSeconds: number,
  tags: string[],
  produce: () => Promise<T>,
): Promise<T> {
  let store: ReturnType<typeof getCache> | null = null;
  try {
    store = getCache();
  } catch {
    if (!warned) {
      console.warn('[cache] Runtime Cache unavailable; using in-process cache');
      warned = true;
    }
  }

  try {
    const hit = store ? await store.get(key) : memGet(key);
    if (hit !== undefined && hit !== null) return hit as T;
  } catch {
    /* a cache read must never break the request */
  }

  const value = await produce();

  // Never cache a failure -- otherwise a transient upstream 500 gets pinned
  // for the whole TTL and the tool reports it as truth. `null` counts: EPQS
  // drops requests under load, and caching that for a year would silently
  // hollow out the terrain model.
  const failed =
    value === null || value === undefined ||
    (typeof value === 'object' && 'error' in (value as object) &&
      Boolean((value as { error?: unknown }).error));
  if (failed) return value;

  try {
    if (JSON.stringify(value).length <= MAX_ITEM_BYTES) {
      if (store) await store.set(key, value, { ttl: ttlSeconds, tags });
      else mem.set(key, { v: value, exp: Date.now() + ttlSeconds * 1000 });
    }
  } catch {
    /* a cache write must never break the request */
  }
  return value;
}

/** Stable, short key from arbitrary parts. FNV-1a is plenty here -- this is a
 *  cache key, not a security primitive. */
export function keyOf(...parts: unknown[]): string {
  const s = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36) + '-' + s.length.toString(36);
}
