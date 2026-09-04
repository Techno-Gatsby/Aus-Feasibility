import type { LonLat } from './geo';
import { cached, keyOf, TTL } from './cache';

const TIMEOUT_MS = 30_000;

/** How long a given layer's answers stay good for. Anything unlisted is
 *  treated as slow-moving. */
function ttlFor(layer: string): number {
  if (/CCAD_Parcel|Land_Records/.test(layer)) return TTL.parcel;
  if (/Planning\/FeatureServer\/3/.test(layer)) return TTL.live; // current dev
  if (/Planning|Administrative_Boundaries/.test(layer)) return TTL.parcel;
  return TTL.slow;
}

export interface ArcFeature {
  attributes: Record<string, unknown>;
  geometry?: { rings?: LonLat[][]; paths?: LonLat[][]; x?: number; y?: number };
}
export interface ArcResult {
  features: ArcFeature[];
  error?: string;
}

async function post(url: string, body: Record<string, string>): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
      signal: ctl.signal,
      cache: 'no-store',
    });
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** Query an ArcGIS layer. The RRC service throws transient 500s, so retry. */
export async function arcQuery(
  layer: string,
  params: Record<string, string>,
): Promise<ArcResult> {
  const p: Record<string, string> = {
    f: 'json',
    outFields: '*',
    returnGeometry: 'false',
    outSR: '4326',
    inSR: '4326',
    ...params,
  };
  return cached(
    keyOf('arc', layer, p), ttlFor(layer), ['arcgis'],
    async () => {
      let last: string | undefined;
      for (let i = 0; i < 2; i++) {
        try {
          const d = await post(`${layer}/query`, p);
          if (!d?.error) return { features: d?.features ?? [] };
          last = typeof d.error === 'string' ? d.error : JSON.stringify(d.error);
        } catch (e) {
          last = e instanceof Error ? e.message : String(e);
        }
      }
      return { features: [], error: last };
    },
  );
}

export function arcPoint(layer: string, lon: number, lat: number, extra = {}) {
  return arcQuery(layer, {
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    spatialRel: 'esriSpatialRelIntersects',
    ...extra,
  });
}

export function arcIntersect(layer: string, rings: LonLat[][], extra = {}) {
  return arcQuery(layer, {
    geometry: JSON.stringify({ rings, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPolygon',
    spatialRel: 'esriSpatialRelIntersects',
    ...extra,
  });
}

export function arcEnvelope(
  layer: string,
  bbox: [number, number, number, number],
  extra = {},
) {
  const [xmin, ymin, xmax, ymax] = bbox;
  return arcQuery(layer, {
    geometry: JSON.stringify({
      xmin, ymin, xmax, ymax, spatialReference: { wkid: 4326 },
    }),
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    ...extra,
  });
}

/** Prefer the town layer inside Prosper, else the county layer. Coverage is
 *  reported explicitly -- a layer that does not extend over the site must
 *  never read as "nothing found". */
export async function dualLayer(
  townUrl: string,
  countyUrl: string,
  inProsper: boolean,
  fetcher: (url: string) => Promise<ArcResult>,
): Promise<{ features: ArcFeature[]; source: string }> {
  const order = inProsper
    ? [['town', townUrl], ['county', countyUrl]]
    : [['county', countyUrl], ['town', townUrl]];
  let reached: string | null = null;
  for (const [src, url] of order) {
    const r = await fetcher(url);
    if (r.error) continue;
    if (r.features.length) return { features: r.features, source: src };
    reached = reached ?? src;
  }
  return { features: [], source: reached ?? 'NO COVERAGE' };
}
