/**
 * Amalgamation: turning "a site" into the several lots it actually is.
 *
 * WHY THIS EXISTS
 * A point query answers with ONE lot. Real acquisition sites are almost never
 * one lot — the JLL Bruce Street Collective in Wollstonecraft is SIX, and a
 * one-lot answer for it reports 559 sqm where the truth is 2,235 sqm. That is
 * wrong by a factor of four while looking entirely plausible, which is the
 * worst kind of wrong. So the caller may name lots or draw a polygon, and this
 * module returns EVERY intersecting lot with its own surveyed area plus the
 * combined total.
 *
 * AREA IS COMPUTED GEODESICALLY, NOT READ OFF THE LAYER
 * The NSW cadastre carries `planlotarea`, but it is null on most urban lots
 * (4 of the 6 Bruce Street lots) and `shape_Area` is NOT square metres — it is
 * the layer's projected (Web Mercator) area, inflated by 1/cos(lat)^2. At
 * Sydney's latitude that is a 45% overstatement: lot 40/1/DP1649 reads 809
 * where the ground truth is 558. Casting shape_Area to "sqm" would report the
 * six-lot site as 3,238 sqm against the IM's 2,225 and look like a plausible
 * survey disagreement rather than a units bug. Everything here therefore works
 * from the WGS84 rings and a spherical-excess area, which reproduces the
 * layer's own `planlotarea` to within 1.5% where that field is populated.
 */

/** [lng, lat] — ArcGIS order. Getting this backwards puts Sydney in the
 *  Indian Ocean, so the order is stated in the type name everywhere it moves. */
export type LngLat = [number, number];
export type Ring = LngLat[];
export type BBox = { minX: number; minY: number; maxX: number; maxY: number };

const R_EARTH = 6378137; // GRS80 semi-major, the datum NSW cadastre is on
const RAD = Math.PI / 180;

/* ------------------------------------------------------------------ area */

/** Signed spherical-excess area of one ring, in square metres.
 *  Sign carries the winding, so ArcGIS holes (wound opposite to their outer
 *  ring) subtract instead of adding. */
export function signedRingAreaM2(ring: Ring): number {
  if (!ring || ring.length < 3) return 0;
  let t = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    t += (x2 - x1) * RAD * (2 + Math.sin(y1 * RAD) + Math.sin(y2 * RAD));
  }
  return (t * R_EARTH * R_EARTH) / 2;
}

/** Area of a polygon given as ArcGIS rings. Holes are handled by the sign. */
export function polygonAreaM2(rings: Ring[]): number {
  if (!Array.isArray(rings)) return 0;
  return Math.abs(rings.reduce((s, r) => s + signedRingAreaM2(r), 0));
}

export function bboxOf(rings: Ring[]): BBox | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rings) for (const [x, y] of r) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/* ------------------------------------------------------- point in polygon */

function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

/** Even-odd rule across all rings, so a point inside a hole reads as outside
 *  the polygon rather than inside it. */
export function pointInPolygon(x: number, y: number, rings: Ring[]): boolean {
  let crossings = 0;
  for (const r of rings) if (pointInRing(x, y, r)) crossings++;
  return crossings % 2 === 1;
}

/* -------------------------------------------------------- area overlap by
 * grid sampling.
 *
 * The honest alternative is general polygon clipping (Greiner-Hormann or
 * Weiler-Atherton). Those are several hundred lines apiece and fail on the
 * exact inputs a cadastre produces: coincident edges between adjoining lots
 * and vertices that lie precisely on the other polygon's boundary. Sampling a
 * grid has no degenerate cases at all. At the default density the sampling
 * error on a 2,000 sqm site is under half a percent, which is finer than the
 * disagreement between the cadastre and a title survey, and it is a bounded,
 * stated error rather than a silent geometric failure.
 */

/** Fraction of `subject` that lies inside `clip`, 0..1. */
export function overlapFraction(subject: Ring[], clip: Ring[], grid = 96): number {
  const b = bboxOf(subject);
  if (!b) return 0;
  let inSubject = 0, inBoth = 0;
  for (let i = 0; i < grid; i++) {
    const x = b.minX + (b.maxX - b.minX) * ((i + 0.5) / grid);
    for (let k = 0; k < grid; k++) {
      const y = b.minY + (b.maxY - b.minY) * ((k + 0.5) / grid);
      if (!pointInPolygon(x, y, subject)) continue;
      inSubject++;
      if (pointInPolygon(x, y, clip)) inBoth++;
    }
  }
  return inSubject ? inBoth / inSubject : 0;
}

export type Zone<T> = { key: string; value: T; areaM2: number };

/**
 * Split the area of `subject` between a set of control polygons.
 *
 * This is what makes dual controls quantitative rather than merely listed. A
 * lot that straddles two FSR polygons is not "FSR 2.5 and 8.6" in equal
 * measure; the developable envelope depends on how many square metres sit
 * under each. Bruce Street splits almost exactly 1,117 / 1,117.
 *
 * Samples that land inside NO control polygon are counted separately and
 * returned as `unmappedM2` — that is a real state (a gap in the control layer)
 * and must not be silently folded into whichever polygon happens to be first.
 */
export function splitAreaByControl<T>(
  subject: Ring[],
  controls: { key: string; value: T; rings: Ring[] }[],
  grid = 128,
): { zones: Zone<T>[]; unmappedM2: number; totalM2: number } {
  const total = polygonAreaM2(subject);
  const b = bboxOf(subject);
  if (!b || total <= 0) return { zones: [], unmappedM2: 0, totalM2: total };

  const hits = new Map<string, number>();
  let inSubject = 0, unmapped = 0;
  for (let i = 0; i < grid; i++) {
    const x = b.minX + (b.maxX - b.minX) * ((i + 0.5) / grid);
    for (let k = 0; k < grid; k++) {
      const y = b.minY + (b.maxY - b.minY) * ((k + 0.5) / grid);
      if (!pointInPolygon(x, y, subject)) continue;
      inSubject++;
      const hit = controls.find((c) => pointInPolygon(x, y, c.rings));
      if (hit) hits.set(hit.key, (hits.get(hit.key) ?? 0) + 1);
      else unmapped++;
    }
  }
  if (!inSubject) return { zones: [], unmappedM2: 0, totalM2: total };

  const zones: Zone<T>[] = [];
  for (const c of controls) {
    const n = hits.get(c.key);
    if (!n) continue;
    zones.push({ key: c.key, value: c.value, areaM2: (total * n) / inSubject });
  }
  zones.sort((a, b2) => b2.areaM2 - a.areaM2);
  return { zones, unmappedM2: (total * unmapped) / inSubject, totalM2: total };
}

/* --------------------------------------------------------- lot identifiers */

/**
 * NSW lot identifiers are LOT/SECTION/PLAN and the section is USUALLY empty,
 * which the cadastre writes as a doubled slash: `2//DP202169`. An IM writes
 * the same lot `2/DP202169`. Querying the IM's spelling returns nothing, and
 * nothing reads as "that lot does not exist" when it means "you typed the
 * separator the human way". Four of the six Bruce Street titles are affected.
 *
 * Handles: `2/DP202169`, `2//DP202169`, `40/1/DP1649`, `Lot 2 DP 202169`,
 * `2 DP202169`, and lower case plan prefixes.
 */
export function normaliseLotId(raw: string): string | null {
  if (!raw) return null;
  let s = raw.trim().toUpperCase().replace(/^LOT\s+/, '');
  s = s.replace(/\s*\/\s*/g, '/');
  // "DP 202169" / "SP 12345" -> "DP202169"
  s = s.replace(/\b(DP|SP|CP)\s+(\d)/g, '$1$2');
  const plan = s.match(/\b((?:DP|SP|CP)\d+)\b/);
  if (!plan) return null;
  const planLabel = plan[1];
  const before = s.slice(0, plan.index ?? 0).replace(/[\s/]+$/, '');
  const parts = before.split(/[/\s]+/).filter(Boolean);
  if (!parts.length) return null;
  const lot = parts[0];
  const section = parts.length > 1 ? parts[1] : '';
  return `${lot}/${section}/${planLabel}`;
}

/* ------------------------------------------------------------- contiguity */

const distPointSegM = (p: LngLat, a: LngLat, b: LngLat): number => {
  // Local equirectangular metres — exact enough over the tens of metres that
  // separate adjoining lot corners.
  const k = Math.cos(p[1] * RAD) * RAD * R_EARTH;
  const j = RAD * R_EARTH;
  const px = p[0] * k, py = p[1] * j;
  const ax = a[0] * k, ay = a[1] * j;
  const bx = b[0] * k, by = b[1] * j;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  const qx = ax + t * dx, qy = ay + t * dy;
  return Math.hypot(px - qx, py - qy);
};

/** Do two lots share a boundary (within `tolM` metres)? Vertex-to-edge, not
 *  bbox, because bounding boxes of city blocks overlap constantly and would
 *  report two lots on opposite sides of a street as adjoining. */
export function touches(a: Ring[], b: Ring[], tolM = 0.6): boolean {
  const ab = bboxOf(a), bb = bboxOf(b);
  if (!ab || !bb) return false;
  const pad = 0.00002; // ~2 m, a cheap reject before the O(n*m) pass
  if (ab.minX > bb.maxX + pad || ab.maxX < bb.minX - pad ||
      ab.minY > bb.maxY + pad || ab.maxY < bb.minY - pad) return false;
  for (const ra of a) for (const p of ra)
    for (const rb of b) for (let i = 0; i < rb.length; i++)
      if (distPointSegM(p, rb[i], rb[(i + 1) % rb.length]) <= tolM) return true;
  return false;
}

/** Connected components over the "shares a boundary" relation. One component
 *  means a genuinely amalgamated site; more than one means the caller has
 *  named lots that do not adjoin, which is a fact worth telling them rather
 *  than quietly summing. */
export function contiguityGroups(shapes: Ring[][]): number[][] {
  const n = shapes.length;
  const seen = new Array<boolean>(n).fill(false);
  const groups: number[][] = [];
  for (let i = 0; i < n; i++) {
    if (seen[i]) continue;
    const stack = [i]; const g: number[] = []; seen[i] = true;
    while (stack.length) {
      const c = stack.pop()!;
      g.push(c);
      for (let j = 0; j < n; j++)
        if (!seen[j] && touches(shapes[c], shapes[j])) { seen[j] = true; stack.push(j); }
    }
    groups.push(g.sort((a, b) => a - b));
  }
  return groups;
}

/* --------------------------------------------------------- ArcGIS plumbing */

export type ArcResult = { features: any[]; exceeded: boolean; error: string | null };

const EMPTY: ArcResult = { features: [], exceeded: false, error: null };

/**
 * One POST to an ArcGIS `/query`. Deliberately not reusing lib/arcgis.ts:
 * that module exposes point and envelope queries only, and every question
 * here is asked of a POLYGON — the amalgamated site — because asking about a
 * centroid would miss the very controls that differ across the site.
 *
 * ArcGIS answers a bad request with HTTP 200 and an `error` object in the
 * body, so a caller that only checks `features` cannot tell a rejected query
 * from genuinely empty ground. The error is surfaced instead.
 */
export async function arcQuery(
  url: string,
  params: Record<string, string>,
  timeoutMs = 25000,
): Promise<ArcResult> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${url}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ f: 'json', ...params }).toString(),
      signal: ctl.signal,
      cache: 'no-store',
    });
    if (!r.ok) return { ...EMPTY, error: `HTTP ${r.status}` };
    const text = await r.text();
    let j: any;
    try { j = JSON.parse(text); }
    catch { return { ...EMPTY, error: 'response was not JSON' }; }
    if (j?.error) return { ...EMPTY, error: j.error.message || 'query error' };
    return {
      features: Array.isArray(j.features) ? j.features : [],
      exceeded: !!j.exceededTransferLimit,
      error: null,
    };
  } catch (e: any) {
    return { ...EMPTY, error: e?.name === 'AbortError' ? 'timeout' : String(e?.message ?? e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Query a layer with a polygon. `outFields` is `*` because several NSW
 *  layers — the cadastre and the POI layer both — reject a named field list
 *  with "Failed to execute query", which reads as "no data here". */
export const polygonQuery = (url: string, rings: Ring[], extra: Record<string, string> = {}) =>
  arcQuery(url, {
    geometry: JSON.stringify({ rings, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPolygon',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'false',
    ...extra,
  });

export const withGeometry = { returnGeometry: 'true', outSR: '4326', geometryPrecision: '8' };

export const ringsOf = (f: any): Ring[] =>
  Array.isArray(f?.geometry?.rings) ? (f.geometry.rings as Ring[]) : [];

/* -------------------------------------------------------------- the cadastre */

export const NSW_CADASTRE =
  'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Cadastre/MapServer/9';

export type Lot = {
  lotId: string;
  planLabel: string | null;
  lotNumber: string | null;
  sectionNumber: string | null;
  /** Geodesic, from the WGS84 ring. The figure an analyst should quote. */
  areaM2: number;
  /** The layer's own stated area where it publishes one — null on most urban
   *  lots. Kept so the two can be compared rather than one silently chosen. */
  statedAreaM2: number | null;
  urbanity: string | null;
  rings: Ring[];
};

const statedArea = (a: any): number | null => {
  const n = Number(a?.planlotarea);
  if (!isFinite(n) || n <= 0) return null;
  return /hect/i.test(String(a?.planlotareaunits ?? '')) ? n * 10000 : n;
};

const toLot = (f: any): Lot | null => {
  const a = f?.attributes ?? {};
  const rings = ringsOf(f);
  if (!rings.length || !a.lotidstring) return null;
  return {
    lotId: String(a.lotidstring),
    planLabel: a.planlabel ?? null,
    lotNumber: a.lotnumber != null ? String(a.lotnumber) : null,
    sectionNumber: a.sectionnumber != null ? String(a.sectionnumber) : null,
    areaM2: polygonAreaM2(rings),
    statedAreaM2: statedArea(a),
    urbanity: a.urbanity ?? null,
    rings,
  };
};

const dedupe = (lots: Lot[]): Lot[] => {
  const seen = new Set<string>();
  return lots.filter((l) => (seen.has(l.lotId) ? false : (seen.add(l.lotId), true)));
};

/** Lots named explicitly, e.g. from an IM's title schedule. Returns the ones
 *  that resolved AND the ones that did not, because a title the cadastre does
 *  not know is a finding — a superseded plan, a typo, or a strata reference —
 *  not something to drop from the total in silence. */
export async function lotsByIdentifier(ids: string[]): Promise<{
  lots: Lot[]; unresolved: string[]; error: string | null;
}> {
  const wanted = new Map<string, string>(); // normalised -> as the caller wrote it
  for (const raw of ids) {
    const n = normaliseLotId(raw);
    if (n) wanted.set(n, raw); else wanted.set(`?${raw}`, raw);
  }
  const queryable = [...wanted.keys()].filter((k) => !k.startsWith('?'));
  if (!queryable.length)
    return { lots: [], unresolved: ids, error: 'no identifier parsed as a NSW lot/section/plan' };

  const where = `lotidstring IN (${queryable.map((k) => `'${k.replace(/'/g, "''")}'`).join(',')})`;
  const r = await arcQuery(NSW_CADASTRE, { where, outFields: '*', ...withGeometry });
  if (r.error) return { lots: [], unresolved: ids, error: r.error };

  const lots = dedupe(r.features.map(toLot).filter((x): x is Lot => !!x));
  const got = new Set(lots.map((l) => l.lotId));
  const unresolved = [...wanted.entries()]
    .filter(([k]) => k.startsWith('?') || !got.has(k))
    .map(([, raw]) => raw);
  return { lots, unresolved, error: null };
}

/** Every lot intersecting a drawn polygon.
 *
 *  `minOverlap` exists because `esriSpatialRelIntersects` includes lots that
 *  merely TOUCH an edge. Drawing a boundary along a shared side would
 *  otherwise pull in the neighbour's whole lot and inflate the site. A lot is
 *  kept only if a real share of it lies inside what the caller drew. */
export async function lotsInPolygon(rings: Ring[], minOverlap = 0.15): Promise<{
  lots: Lot[]; rejected: { lotId: string; overlap: number }[]; error: string | null;
}> {
  const r = await polygonQuery(NSW_CADASTRE, rings, { ...withGeometry, resultRecordCount: '250' });
  if (r.error) return { lots: [], rejected: [], error: r.error };
  const all = dedupe(r.features.map(toLot).filter((x): x is Lot => !!x));
  const lots: Lot[] = [];
  const rejected: { lotId: string; overlap: number }[] = [];
  for (const l of all) {
    const f = overlapFraction(l.rings, rings);
    if (f >= minOverlap) lots.push(l);
    else rejected.push({ lotId: l.lotId, overlap: Number(f.toFixed(3)) });
  }
  return { lots, rejected, error: null };
}

/** The single lot under a point — the starting position when all the caller
 *  has is a pin. It is deliberately NOT presented as the site. */
export async function lotAtPoint(lng: number, lat: number): Promise<{ lot: Lot | null; error: string | null }> {
  const r = await arcQuery(NSW_CADASTRE, {
    geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    ...withGeometry,
  });
  if (r.error) return { lot: null, error: r.error };
  return { lot: r.features.map(toLot).find((x): x is Lot => !!x) ?? null, error: null };
}

export type Amalgamation = {
  lots: Lot[];
  rings: Ring[];
  totalAreaM2: number;
  /** Sum of the layer's own stated areas, over the lots that publish one. */
  statedAreaM2: number | null;
  statedAreaLotCount: number;
  contiguous: boolean;
  groups: string[][];
};

/** Combine resolved lots into one multi-ring site polygon. */
export function amalgamate(lots: Lot[]): Amalgamation {
  const rings = lots.flatMap((l) => l.rings);
  const stated = lots.filter((l) => l.statedAreaM2 != null);
  const groups = contiguityGroups(lots.map((l) => l.rings));
  return {
    lots,
    rings,
    totalAreaM2: lots.reduce((s, l) => s + l.areaM2, 0),
    statedAreaM2: stated.length ? stated.reduce((s, l) => s + (l.statedAreaM2 ?? 0), 0) : null,
    statedAreaLotCount: stated.length,
    contiguous: groups.length <= 1,
    groups: groups.map((g) => g.map((i) => lots[i].lotId)),
  };
}
