/**
 * GeoJSON import/export and geodesic area for drawn site polygons.
 *
 * DELIBERATELY FREE OF ANY LEAFLET IMPORT. Leaflet touches `window` at module
 * scope; this file is imported by components that Next may reach on the
 * server, so pulling Leaflet in here would break prerendering the same way it
 * would in lib/mapStyle.ts.
 *
 * ── COORDINATE ORDER ────────────────────────────────────────────────────────
 * GeoJSON positions are [lng, lat]  (RFC 7946 §3.1.1 — x, y, i.e. easting first)
 * Leaflet LatLngs are   [lat, lng]
 *
 * Every swap in the whole app happens in the four functions below —
 * toLatLng / toLngLat / ringToLatLng / ringToLngLat. Nothing else in this file
 * or in SiteMap.tsx reverses a pair by hand. Get it backwards and a Sydney
 * site (lat -33.87, lng 151.21) is read as lat 151.21 — off the planet, or
 * silently in the Indian Ocean once it wraps. The importer therefore also
 * range-checks latitude and says so explicitly rather than drawing nonsense.
 *
 * Internally, everything the map handles is in Leaflet order and rings are
 * held OPEN (no repeated closing vertex, which is what Leaflet wants). The
 * closing vertex is added back on export, because GeoJSON requires it.
 */

/** [lat, lng] — Leaflet order. Used everywhere inside the app. */
export type LatLng = [number, number];
/** [lng, lat] — GeoJSON order. Only ever seen at the import/export boundary. */
export type LngLat = [number, number];
/** An open ring in Leaflet order: first vertex is NOT repeated at the end. */
export type Ring = LatLng[];
/** [outer, ...holes] — one polygon, matching Leaflet's polygon(latlngs) form. */
export type Rings = Ring[];

/* ── the one and only coordinate swap ─────────────────────────────────────── */

/** GeoJSON [lng, lat] → Leaflet [lat, lng]. */
export const toLatLng = (c: LngLat): LatLng => [c[1], c[0]];
/** Leaflet [lat, lng] → GeoJSON [lng, lat]. */
export const toLngLat = (c: LatLng): LngLat => [c[1], c[0]];
export const ringToLatLng = (r: LngLat[]): Ring => r.map(toLatLng);
export const ringToLngLat = (r: Ring): LngLat[] => r.map(toLngLat);

/* ── area ─────────────────────────────────────────────────────────────────── */

/** WGS84 equatorial radius. Same constant Leaflet's own CRS uses, so the
 *  measured area agrees with what the tiles imply. */
const R = 6378137;
const D2R = Math.PI / 180;

/**
 * Signed geodesic area of a ring, in m², by spherical excess.
 *
 * NOT a planar shoelace over degrees. A degree of longitude is 111.32 km at
 * the equator but 81.2 km at Hobart (43°S) — Australia spans 10°S to 43°S, so
 * planar-on-degrees is wrong by cos(latitude), i.e. up to 27% too large in the
 * south, and the error is invisible because the number still looks plausible.
 *
 * Sign follows winding: positive for counter-clockwise (in lng/lat space),
 * negative for clockwise. Callers that only want size take the absolute value;
 * the exporter uses the sign to wind rings the way RFC 7946 asks.
 */
export function signedRingAreaM2(ring: Ring): number {
  const n = ring.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [lat1, lng1] = ring[j];
    const [lat2, lng2] = ring[i];
    sum += (lng2 - lng1) * D2R * (2 + Math.sin(lat1 * D2R) + Math.sin(lat2 * D2R));
  }
  return (sum * R * R) / 2;
}

/** Unsigned area of a single ring, m². */
export const ringAreaM2 = (ring: Ring): number => Math.abs(signedRingAreaM2(ring));

/** Area of a polygon: outer ring less every hole. */
export function polygonAreaM2(rings: Rings): number {
  if (!rings.length) return 0;
  const outer = ringAreaM2(rings[0]);
  const holes = rings.slice(1).reduce((a, r) => a + ringAreaM2(r), 0);
  return Math.max(0, outer - holes);
}

/** Great-circle length of an open path, m. Used by the line/measure tool. */
export function pathLengthM(path: Ring): number {
  let d = 0;
  for (let i = 1; i < path.length; i++) {
    const [lat1, lng1] = path[i - 1];
    const [lat2, lng2] = path[i];
    const dLat = (lat2 - lat1) * D2R;
    const dLng = (lng2 - lng1) * D2R;
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLng / 2) ** 2;
    d += 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  return d;
}

export function formatArea(m2: number | null): string {
  if (m2 == null || !Number.isFinite(m2)) return '—';
  const ha = m2 / 10000;
  const m2s = m2 >= 100 ? Math.round(m2).toLocaleString() : m2.toFixed(1);
  return `${m2s} m² · ${ha.toFixed(ha >= 10 ? 2 : 4)} ha`;
}

export function formatLength(m: number | null): string {
  if (m == null || !Number.isFinite(m)) return '—';
  return m >= 1000 ? `${(m / 1000).toFixed(3)} km` : `${m.toFixed(1)} m`;
}

/* ── ring hygiene ─────────────────────────────────────────────────────────── */

const samePoint = (a: LatLng, b: LatLng) =>
  Math.abs(a[0] - b[0]) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12;

/** Drop the repeated closing vertex GeoJSON requires; Leaflet does not want it. */
export function openRing(ring: Ring): Ring {
  const r = ring.slice();
  while (r.length > 1 && samePoint(r[0], r[r.length - 1])) r.pop();
  return r;
}

/** Re-add the closing vertex for export. */
export function closeRing(ring: Ring): Ring {
  if (ring.length < 3) return ring.slice();
  const r = ring.slice();
  if (!samePoint(r[0], r[r.length - 1])) r.push(r[0]);
  return r;
}

/* ── import ───────────────────────────────────────────────────────────────── */

export type ImportOk = {
  ok: true;
  /** Leaflet-order rings: [outer, ...holes]. */
  rings: Rings;
  areaM2: number;
  /** how many polygons the source held; >1 means we kept only the largest */
  parts: number;
  name: string | null;
  note: string | null;
};
export type ImportErr = { ok: false; error: string };
export type ImportResult = ImportOk | ImportErr;

const typeOf = (v: unknown): string => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  if (typeof v === 'object') {
    const t = (v as { type?: unknown }).type;
    return typeof t === 'string' ? `a ${t}` : 'an object with no "type"';
  }
  return `a ${typeof v}`;
};

/** Validate one GeoJSON polygon coordinate array → Leaflet rings, or a reason. */
function ringsFromCoords(coords: unknown, where: string): Rings | string {
  if (!Array.isArray(coords) || !coords.length) return `${where} has no coordinates.`;
  const out: Rings = [];
  for (let ri = 0; ri < coords.length; ri++) {
    const raw = coords[ri];
    if (!Array.isArray(raw)) return `${where} ring ${ri + 1} is not an array of positions.`;
    const ring: Ring = [];
    for (let pi = 0; pi < raw.length; pi++) {
      const p = raw[pi];
      if (!Array.isArray(p) || p.length < 2 || typeof p[0] !== 'number' || typeof p[1] !== 'number'
          || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
        return `${where} ring ${ri + 1}, position ${pi + 1} is not a [lng, lat] number pair.`;
      }
      const [lng, lat] = p as LngLat;
      if (lat < -90 || lat > 90) {
        return `${where} ring ${ri + 1}, position ${pi + 1} has latitude ${lat}, which is outside -90..90. ` +
               `GeoJSON positions are [lng, lat] — this file looks like it is [lat, lng].`;
      }
      if (lng < -180 || lng > 180) {
        return `${where} ring ${ri + 1}, position ${pi + 1} has longitude ${lng}, which is outside -180..180.`;
      }
      // the single import-side swap
      ring.push(toLatLng([lng, lat]));
    }
    const open = openRing(ring);
    if (open.length < 3) return `${where} ring ${ri + 1} has only ${open.length} distinct point(s); a polygon needs 3.`;
    out.push(open);
  }
  return out;
}

/**
 * Parse a pasted string (or an already-parsed value) into one polygon.
 *
 * Accepts a Feature, a FeatureCollection, or a bare Geometry. Anything that is
 * not a Polygon/MultiPolygon is rejected by name — "got a LineString" — rather
 * than silently producing an empty map, which is the failure everyone wastes
 * an afternoon on.
 *
 * A MultiPolygon (or a collection of several polygons) keeps the LARGEST part
 * and says so in `note`: the drawn site is one shape, and quietly merging
 * disjoint parts would overstate the developable area.
 */
export function importGeoJSON(input: string | unknown): ImportResult {
  let doc: unknown = input;
  if (typeof input === 'string') {
    const txt = input.trim();
    if (!txt) return { ok: false, error: 'Nothing to import — the box is empty.' };
    try { doc = JSON.parse(txt); }
    catch (e) { return { ok: false, error: `Not valid JSON: ${(e as Error).message}` }; }
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, error: `Expected a GeoJSON object, got ${typeOf(doc)}.` };
  }

  const d = doc as { type?: unknown; features?: unknown; geometry?: unknown; coordinates?: unknown;
                     properties?: Record<string, unknown> | null; geometries?: unknown };
  const type = typeof d.type === 'string' ? d.type : null;
  if (!type) return { ok: false, error: 'Expected a GeoJSON object with a "type" field; there is none.' };

  // candidate polygons, plus a record of every geometry type seen for the message
  const found: { rings: Rings; area: number; name: string | null }[] = [];
  const seen: string[] = [];
  let firstReason: string | null = null;

  const take = (geom: unknown, name: string | null, where: string) => {
    if (!geom || typeof geom !== 'object') { seen.push(typeOf(geom)); return; }
    const g = geom as { type?: unknown; coordinates?: unknown; geometries?: unknown };
    const gt = typeof g.type === 'string' ? g.type : null;
    if (!gt) { seen.push('a geometry with no "type"'); return; }
    if (gt === 'GeometryCollection') {
      seen.push('GeometryCollection');
      const gs = Array.isArray(g.geometries) ? g.geometries : [];
      gs.forEach((sub, i) => take(sub, name, `${where} geometry ${i + 1}`));
      return;
    }
    seen.push(gt);
    if (gt === 'Polygon') {
      const r = ringsFromCoords(g.coordinates, where);
      if (typeof r === 'string') { firstReason ??= r; return; }
      found.push({ rings: r, area: polygonAreaM2(r), name });
      return;
    }
    if (gt === 'MultiPolygon') {
      const parts = Array.isArray(g.coordinates) ? g.coordinates : [];
      if (!parts.length) { firstReason ??= `${where} MultiPolygon has no coordinates.`; return; }
      parts.forEach((part, i) => {
        const r = ringsFromCoords(part, `${where} polygon ${i + 1}`);
        if (typeof r === 'string') { firstReason ??= r; return; }
        found.push({ rings: r, area: polygonAreaM2(r), name });
      });
    }
  };

  if (type === 'FeatureCollection') {
    const feats = Array.isArray(d.features) ? d.features : null;
    if (!feats) return { ok: false, error: 'FeatureCollection has no "features" array.' };
    if (!feats.length) return { ok: false, error: 'FeatureCollection is empty — no features to import.' };
    feats.forEach((f, i) => {
      const ft = f as { geometry?: unknown; properties?: Record<string, unknown> | null; type?: unknown };
      const nm = ft?.properties && typeof ft.properties.name === 'string' ? ft.properties.name : null;
      take(ft?.geometry, nm, `Feature ${i + 1}`);
    });
  } else if (type === 'Feature') {
    const nm = d.properties && typeof d.properties.name === 'string' ? d.properties.name : null;
    take(d.geometry, nm, 'The feature');
  } else if (type === 'Polygon' || type === 'MultiPolygon' || type === 'GeometryCollection') {
    take(d, null, 'The geometry');
  } else {
    return {
      ok: false,
      error: `Expected a Polygon or MultiPolygon (as a Feature, FeatureCollection or bare geometry) — got a ${type}.`,
    };
  }

  if (!found.length) {
    if (firstReason) return { ok: false, error: firstReason };
    const uniq = Array.from(new Set(seen));
    const what = uniq.length ? uniq.join(', ') : 'nothing';
    return {
      ok: false,
      error: `No Polygon or MultiPolygon in this file — it contains ${what}. A site boundary must be an area, not a point or a line.`,
    };
  }

  found.sort((a, b) => b.area - a.area);
  const best = found[0];
  return {
    ok: true,
    rings: best.rings,
    areaM2: best.area,
    parts: found.length,
    name: best.name,
    note: found.length > 1
      ? `File held ${found.length} polygons — kept the largest (${formatArea(best.area)}) and ignored the rest.`
      : null,
  };
}

/* ── export ───────────────────────────────────────────────────────────────── */

export type SiteFeature = {
  type: 'Feature';
  geometry: { type: 'Polygon'; coordinates: LngLat[][] };
  properties: {
    name: string;
    area_m2: number;
    area_ha: number;
    vertices: number;
    source: string;
    created: string;
  };
};

/**
 * The drawn site as a GeoJSON Feature.
 *
 * Rings are wound RFC 7946 style — exterior counter-clockwise, holes
 * clockwise — and closed. Area travels in `properties` so the file is useful
 * to anything that reads it without recomputing geodesy.
 */
export function toFeature(rings: Rings, opts?: { name?: string; created?: string }): SiteFeature {
  const areaM2 = polygonAreaM2(rings);
  const wound = rings.map((ring, i) => {
    const signed = signedRingAreaM2(ring);
    const wantPositive = i === 0;                    // outer CCW, holes CW
    const r = (signed < 0) === wantPositive ? ring.slice().reverse() : ring;
    return ringToLngLat(closeRing(r));               // the single export-side swap
  });
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: wound },
    properties: {
      name: opts?.name ?? 'Drawn site',
      area_m2: Math.round(areaM2 * 100) / 100,
      area_ha: Math.round((areaM2 / 10000) * 1e6) / 1e6,
      vertices: rings[0]?.length ?? 0,
      source: 'Australia Land Feasibility — site map',
      created: opts?.created ?? new Date().toISOString(),
    },
  };
}

export const featureToString = (rings: Rings, opts?: { name?: string }): string =>
  JSON.stringify(toFeature(rings, opts), null, 2);
