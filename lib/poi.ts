/** Nearby points of interest, from OpenStreetMap via Overpass.
 *
 *  Two things this module refuses to do, because the legacy build did both
 *  and they read as facts:
 *
 *   1. Report an empty category as "there are no schools nearby". Overpass is
 *      rate-limited and frequently slow; a nil result is much more often a
 *      timeout or a 429 than an empty neighbourhood. Every category therefore
 *      carries a status of 'ok' | 'empty' | 'unavailable', and 'unavailable'
 *      says which endpoint failed and how.
 *   2. Hang the panel. Overpass gets ~15 s in total across all endpoints and
 *      then the panel degrades instead of spinning.
 */
import { metres, type Pt } from '@/lib/geo';

export type PoiKind = 'school' | 'shop' | 'transport' | 'hospital';

export type Poi = {
  name: string;
  kind: PoiKind;
  /** OSM's own tag, e.g. "supermarket", "station" — shown, never invented. */
  type: string;
  distanceM: number;
  lat: number;
  lng: number;
};

export type PoiCategory = {
  kind: PoiKind;
  label: string;
  /** 'ok' — found. 'empty' — Overpass ANSWERED and had nothing mapped.
   *  'unavailable' — Overpass did not answer; absence proves nothing. */
  status: 'ok' | 'empty' | 'unavailable';
  items: Poi[];
  /** Total matches inside the radius before the display cap. */
  total: number;
  nearest: Poi | null;
};

export type PoiResult = {
  /** True only if an Overpass endpoint returned parseable JSON. */
  queried: boolean;
  endpoint: string | null;
  error: string | null;
  attempts: { endpoint: string; error: string }[];
  radiusM: number;
  elapsedMs: number;
  centre: Pt;
  categories: PoiCategory[];
};

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

/** overpass-api.de answers a request with no User-Agent with HTTP 406, which
 *  reads exactly like a malformed query. Node's fetch sends no UA of its own,
 *  so the browser build worked and the server build did not. Verified: with
 *  this header the same query returns 200. Overpass' usage policy asks for an
 *  identifying UA in any case. */
const UA = 'aus-feasibility/0.1 (land feasibility site intelligence panel)';

const LABELS: Record<PoiKind, string> = {
  school: 'Schools and education',
  shop: 'Shops and retail',
  transport: 'Transport',
  hospital: 'Hospitals and medical',
};

const SHOP_TAGS =
  'supermarket|mall|department_store|convenience|greengrocer|bakery|butcher|' +
  'chemist|pharmacy|hardware|doityourself|variety_store|general';

/** bbox is Overpass order: south,west,north,east. */
function clauses(kind: PoiKind, b: string): string {
  switch (kind) {
    case 'school':
      return `nwr(${b})[amenity~"^(school|college|university|kindergarten|childcare)$"];`;
    case 'shop':
      return `nwr(${b})[shop~"^(${SHOP_TAGS})$"];nwr(${b})[amenity=marketplace];`;
    case 'transport':
      return `nwr(${b})[railway~"^(station|halt|tram_stop)$"];` +
             `nwr(${b})[public_transport~"^(station|stop_area)$"];` +
             `nwr(${b})[highway=bus_stop];` +
             `nwr(${b})[amenity~"^(bus_station|ferry_terminal)$"];`;
    case 'hospital':
      return `nwr(${b})[amenity~"^(hospital|clinic|doctors)$"];nwr(${b})[healthcare=hospital];`;
  }
}

function matches(kind: PoiKind, t: Record<string, string>): boolean {
  const amenity = t.amenity ?? '', railway = t.railway ?? '', shop = t.shop ?? '';
  switch (kind) {
    case 'school':
      return /^(school|college|university|kindergarten|childcare)$/.test(amenity);
    case 'shop':
      return new RegExp(`^(${SHOP_TAGS})$`).test(shop) || amenity === 'marketplace';
    case 'transport':
      return /^(station|halt|tram_stop)$/.test(railway) ||
             /^(station|stop_area)$/.test(t.public_transport ?? '') ||
             t.highway === 'bus_stop' ||
             /^(bus_station|ferry_terminal)$/.test(amenity);
    case 'hospital':
      return /^(hospital|clinic|doctors)$/.test(amenity) || t.healthcare === 'hospital';
  }
}

/** Ways and relations come back as `center`, nodes as lat/lon. Missing either
 *  means the element cannot be placed, so it is dropped rather than defaulted. */
function coordOf(e: any): { lat: number; lng: number } | null {
  const lat = Number(e?.lat ?? e?.center?.lat);
  const lng = Number(e?.lon ?? e?.center?.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function typeOf(t: Record<string, string>): string {
  return t.railway || t.public_transport || t.amenity || t.shop ||
         t.healthcare || t.highway || '';
}

function bboxFor(p: Pt, radiusM: number): string {
  const dLat = radiusM / 110574;
  const dLng = radiusM / Math.max(1, 111320 * Math.cos((p.lat * Math.PI) / 180));
  return [p.lat - dLat, p.lng - dLng, p.lat + dLat, p.lng + dLng]
    .map((v) => v.toFixed(6)).join(',');
}

export const POI_KINDS: PoiKind[] = ['school', 'shop', 'transport', 'hospital'];

export async function nearbyPoi(
  centre: Pt,
  radiusM = 2000,
  opts: { timeoutMs?: number; limit?: number; kinds?: PoiKind[] } = {},
): Promise<PoiResult> {
  const radius = Math.max(200, Math.min(10000, Math.round(radiusM)));
  const limit = Math.max(1, Math.min(20, opts.limit ?? 5));
  const kinds = opts.kinds?.length ? opts.kinds : POI_KINDS;
  // Whole-operation budget. Overpass' own [timeout:] is set below it so the
  // server gives up before we do and returns a remark we can report.
  const budgetMs = Math.max(3000, Math.min(30000, opts.timeoutMs ?? 15000));
  const started = Date.now();

  const b = bboxFor(centre, radius);
  const query =
    `[out:json][timeout:${Math.max(5, Math.floor(budgetMs / 1000) - 3)}];(` +
    kinds.map((k) => clauses(k, b)).join('') +
    `);out center tags qt;`;

  const attempts: { endpoint: string; error: string }[] = [];
  let elements: any[] | null = null;
  let endpoint: string | null = null;

  for (const url of ENDPOINTS) {
    const left = budgetMs - (Date.now() - started);
    if (left < 1500) { attempts.push({ endpoint: url, error: 'skipped, time budget spent' }); continue; }
    // Cap each attempt so one hung mirror cannot eat the whole budget and
    // leave the healthy mirrors untried — that is how a transient stall turns
    // into "no schools nearby".
    const slice = Math.min(left - 250, Math.max(4000, Math.round(budgetMs * 0.55)));
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), slice);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          Accept: 'application/json',
          'User-Agent': UA,
        },
        body: 'data=' + encodeURIComponent(query),
        signal: ctl.signal,
      });
      if (!r.ok)
        throw new Error(
          r.status === 429 ? 'rate limited (HTTP 429)'
          : r.status === 504 ? 'gateway timeout (HTTP 504) — the mirror is overloaded'
          : `HTTP ${r.status}`);
      const text = await r.text();
      let j: any;
      try { j = JSON.parse(text); }
      catch { throw new Error('Overpass returned something that was not JSON'); }
      // Overpass signals server-side timeouts with a `remark` and NO elements
      // array. Treating that as an empty result is how "no schools nearby"
      // gets printed over a timeout.
      if (j?.remark && !Array.isArray(j.elements)) throw new Error(String(j.remark).trim());
      if (!Array.isArray(j?.elements)) throw new Error('Overpass response had no elements array');
      elements = j.elements;
      endpoint = url;
      break;
    } catch (e: any) {
      attempts.push({
        endpoint: url,
        error: e?.name === 'AbortError'
          ? `timed out after ${(slice / 1000).toFixed(0)}s`
          : String(e?.message ?? e),
      });
    } finally { clearTimeout(t); }
  }

  const queried = elements !== null;
  const categories: PoiCategory[] = kinds.map((kind) => {
    if (!queried)
      return { kind, label: LABELS[kind], status: 'unavailable' as const, items: [], total: 0, nearest: null };

    const seen = new Set<string>();
    const found: Poi[] = [];
    for (const e of elements!) {
      const tags: Record<string, string> = e?.tags ?? {};
      if (!matches(kind, tags)) continue;
      const c = coordOf(e);
      if (!c) continue;
      const d = metres(centre, { lat: c.lat, lng: c.lng });
      if (!Number.isFinite(d) || d > radius) continue;
      const name = String(tags.name ?? tags['name:en'] ?? tags.operator ?? tags.brand ?? '').trim();
      const key = `${(name || typeOf(tags)).toLowerCase()}|${c.lat.toFixed(4)}|${c.lng.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({
        name: name || `Unnamed ${typeOf(tags) || kind}`,
        kind, type: typeOf(tags), distanceM: Math.round(d), lat: c.lat, lng: c.lng,
      });
    }
    found.sort((a, z) => a.distanceM - z.distanceM);
    return {
      kind, label: LABELS[kind],
      status: found.length ? ('ok' as const) : ('empty' as const),
      items: found.slice(0, limit),
      total: found.length,
      nearest: found[0] ?? null,
    };
  });

  return {
    queried,
    endpoint,
    error: queried ? null
      : attempts.length ? `Overpass did not answer: ${attempts.map((a) => `${new URL(a.endpoint).host} — ${a.error}`).join('; ')}`
      : 'Overpass was not contacted',
    attempts,
    radiusM: radius,
    elapsedMs: Date.now() - started,
    centre,
    categories,
  };
}
