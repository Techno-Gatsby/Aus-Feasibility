/** ArcGIS REST helpers. Every quirk found during verification lives here so
 *  callers cannot reintroduce it. */

export type Pt = { lng: number; lat: number };
export type Box = [number, number, number, number]; // W,S,E,N

const form = (o: Record<string, string>) =>
  new URLSearchParams(o).toString();

async function post(url: string, body: Record<string, string>, ms = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`${url}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form(body),
      signal: ctl.signal,
    });
    if (!r.ok) return { features: [], error: `HTTP ${r.status}` };
    const j = await r.json();
    // ArcGIS returns 200 with an error object; surface it rather than
    // letting it masquerade as "no features".
    if (j?.error) return { features: [], error: j.error.message || 'query error' };
    return { features: j.features ?? [], error: null as string | null };
  } catch (e: any) {
    return { features: [], error: e?.name === 'AbortError' ? 'timeout' : String(e) };
  } finally {
    clearTimeout(t);
  }
}

/** Point query. outFields defaults to '*' because several NSW layers —
 *  cadastre especially — reject named field lists. */
export const atPoint = (url: string, p: Pt, outFields = '*') =>
  post(url, {
    f: 'json',
    geometry: JSON.stringify({ x: p.lng, y: p.lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields,
    returnGeometry: 'false',
  });

export const inBox = (url: string, b: Box, outFields = '*', limit = 20) =>
  post(url, {
    f: 'json',
    geometry: JSON.stringify({
      xmin: b[0], ymin: b[1], xmax: b[2], ymax: b[3],
      spatialReference: { wkid: 4326 },
    }),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields,
    returnGeometry: 'false',
    resultRecordCount: String(limit),
  });

/** A point can sit in a gap a polygon does not cover, so a nil point result
 *  is checked against a small envelope before being reported as absent. */
export async function presence(url: string, p: Pt, padDeg = 0.0015) {
  const pt = await atPoint(url, p);
  if (pt.error) return { present: false, near: false, error: pt.error, attrs: null };
  if (pt.features.length)
    return { present: true, near: true, error: null, attrs: pt.features[0].attributes };
  const box: Box = [p.lng - padDeg, p.lat - padDeg, p.lng + padDeg, p.lat + padDeg];
  const nb = await inBox(url, box, '*', 5);
  return {
    present: false,
    near: nb.features.length > 0,
    error: nb.error,
    attrs: nb.features[0]?.attributes ?? null,
  };
}
