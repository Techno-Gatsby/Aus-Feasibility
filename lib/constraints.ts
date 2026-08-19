/**
 * CONSTRAINT UNION — how much of a site is actually developable once
 * overlapping hazard layers are accounted for.
 *
 * WHY THIS EXISTS
 * ---------------
 * Hazard layers overlap, and they overlap for physical reasons, not by
 * coincidence. Flood and wetland follow the same drainage line. Bushfire and
 * biodiversity follow the same remnant vegetation. Landslide and steep-slope
 * vegetation follow the same escarpment.
 *
 * So if you add the constrained areas together you count the same ground
 * two or three times and overstate the loss. On a real 324-acre tract the
 * sum of the layers said 141 acres unbuildable; the union said 89. That
 * 52-acre difference was the entire margin of the deal. A feasibility that
 * sums is not conservative, it is wrong.
 *
 * This module computes the UNION of the constrained area — ground covered by
 * AT LEAST ONE layer — and reports the naive sum beside it so the size of the
 * double-count is visible rather than hidden.
 *
 * METHOD, AND ITS LIMITS — READ BEFORE TRUSTING A NUMBER
 * -----------------------------------------------------
 * This is a RASTER SAMPLE, not a polygon boolean. An N x N grid is laid over
 * the site's bounding box and each cell centre is classified: inside the site
 * or not, and inside each constraint or not. Areas are cell counts times cell
 * area.
 *
 * Consequences you must not paper over:
 *  - It is an APPROXIMATION. The error lives entirely on the boundaries —
 *    a cell is all-in or all-out, so every edge is quantised to the cell size.
 *  - Accuracy is bounded by RESOLUTION. At the default N=40 a 1 km site has
 *    25 m cells; a feature narrower than a cell can be missed completely and a
 *    feature slightly wider can be doubled. `resolutionM` and
 *    `unionUncertaintyM2` in the result quantify this — read them.
 *  - Raising N costs N^2 point-in-polygon tests. N=40 is 1,600, which is
 *    nothing. N=200 is 40,000, still cheap, and quarters the boundary error.
 *  - The source polygons are themselves generalised by the upstream server
 *    and are mapped at scales of 1:10,000 or coarser. Sub-metre precision in
 *    this output would be false precision regardless of N.
 *  - IT IS NOT A SUBSTITUTE FOR A SURVEY. It is a screening figure to decide
 *    whether a site is worth surveying, and what to argue about when a
 *    surveyor and a council disagree. Nobody should exchange contracts on it.
 *
 * PROJECTION
 * ----------
 * Degrees of longitude shrink with latitude. Australia spans about 10°S to
 * 43°S, where cos(lat) runs from 0.98 to 0.73 — treating a degree of longitude
 * as a degree of latitude overstates east-west distance by up to ~37% at
 * Hobart, i.e. an area error well past 25%. Every area here is computed on an
 * equirectangular projection with the cos(latitude) factor applied to
 * longitude, evaluated per grid ROW so the factor tracks the site's own
 * north-south extent instead of being frozen at one reference latitude.
 *
 * COORDINATE ORDER
 * ----------------
 * Everything in this file is [lat, lng] — the Leaflet order produced by
 * `ringsToLatLng` in lib/arcgis.ts, NOT the [x, y] order ArcGIS emits. Getting
 * this backwards silently relocates the site, so the convention is stated once
 * here and never varied.
 *
 * RINGS AND HOLES
 * ---------------
 * A polygon is an array of rings, GeoJSON-style: ring 0 is the outer boundary
 * and every subsequent ring is an interior hole. A point inside a hole is
 * OUTSIDE the polygon. Holes are not decorative — a flood layer with an island
 * of high ground punched out of it is exactly the ground you want to build on.
 */

/** [latitude, longitude]. Never [lng, lat]. */
export type LatLng = [number, number];
/** A closed ring. First/last vertex need not be repeated. */
export type Ring = LatLng[];
/** [outerRing, ...holeRings] */
export type Polygon = Ring[];
/** One layer's geometry: many polygons, each possibly holed. */
export type PolygonSet = Polygon[];

/** Mean Earth radius, matching lib/geo.ts so distances and areas agree. */
export const EARTH_RADIUS_M = 6371000;
/** Metres per degree of latitude. Constant to well within this method's error. */
export const M_PER_DEG_LAT = (Math.PI / 180) * EARTH_RADIUS_M;
/** Metres per degree of longitude at a given latitude. The whole point. */
export const mPerDegLng = (lat: number) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

export const M2_PER_ACRE = 4046.8564224;
export const M2_PER_HECTARE = 10000;

/** [minLat, minLng, maxLat, maxLng] */
export type Bounds = [number, number, number, number];

const isNum = (v: unknown): v is number => typeof v === 'number' && isFinite(v);

/* ------------------------------------------------------------------ *
 * Point in polygon
 * ------------------------------------------------------------------ */

/**
 * Ray casting: shoot a ray east from the point and count edge crossings; odd
 * means inside. Run on raw degrees rather than projected metres on purpose —
 * the equirectangular projection is a positive scaling of each axis, and a
 * positive scaling cannot move a point across an edge. Projecting first would
 * cost 2 multiplies per vertex and change nothing.
 *
 * A vertex exactly on the ray is handled by the asymmetric `(yi > lat) !==
 * (yj > lat)` test, which counts each vertex on one side only and so avoids
 * the double-count that makes naive implementations report "outside" for
 * points level with a vertex.
 *
 * Points exactly ON an edge are undefined — they may land either way. That is
 * acceptable here because grid cell centres landing exactly on a polygon edge
 * is a measure-zero event, and one cell either way is far inside the method's
 * stated error.
 */
export function pointInRing(lat: number, lng: number, ring: Ring): boolean {
  const n = ring.length;
  if (n < 3) return false; // a line or a point encloses nothing
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = ring[i][0], xi = ring[i][1];
    const yj = ring[j][0], xj = ring[j][1];
    if (yi === yj) continue; // horizontal edge: the ray never crosses it
    if ((yi > lat) !== (yj > lat)) {
      const xAt = xi + ((xj - xi) * (lat - yi)) / (yj - yi);
      if (lng < xAt) inside = !inside;
    }
  }
  return inside;
}

/** Inside the outer ring AND outside every hole. */
export function pointInPolygon(lat: number, lng: number, poly: Polygon): boolean {
  if (!poly.length) return false;
  if (!pointInRing(lat, lng, poly[0])) return false;
  for (let h = 1; h < poly.length; h++)
    if (pointInRing(lat, lng, poly[h])) return false; // in a hole = outside
  return true;
}

/** Inside any polygon of the set. Used per layer, where features may be many
 *  and may themselves overlap — union semantics, so first hit wins. */
export function pointInSet(lat: number, lng: number, set: PolygonSet): boolean {
  for (let i = 0; i < set.length; i++)
    if (pointInPolygon(lat, lng, set[i])) return true;
  return false;
}

/* ------------------------------------------------------------------ *
 * Geometry helpers
 * ------------------------------------------------------------------ */

/** Bounding box of a polygon set. Returns null if there are no usable vertices
 *  — an empty box is not a zero-area site, it is an absence of input, and the
 *  two must not be confused downstream. */
export function boundsOf(set: PolygonSet): Bounds | null {
  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
  let seen = 0;
  for (const poly of set)
    for (const ring of poly)
      for (const [lat, lng] of ring) {
        if (!isNum(lat) || !isNum(lng)) continue;
        seen++;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
      }
  if (!seen) return null;
  return [minLat, minLng, maxLat, maxLng];
}

/**
 * Exact planar area of one polygon by the shoelace formula, on the
 * equirectangular projection, holes subtracted. Reported alongside the grid
 * figure as a cross-check: if the two disagree by more than a few percent the
 * grid is too coarse for the shape, and that is worth knowing.
 *
 * Sign is discarded, so ring winding order does not matter — which is
 * deliberate, because ArcGIS and GeoJSON disagree about winding and half the
 * feeds in this app get it wrong anyway.
 */
export function polygonAreaM2(poly: Polygon, refLat?: number): number {
  if (!poly.length) return 0;
  const lat0 = refLat ?? avgLat(poly[0]);
  const kx = mPerDegLng(lat0), ky = M_PER_DEG_LAT;
  const ringArea = (ring: Ring) => {
    const n = ring.length;
    if (n < 3) return 0;
    let s = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = ring[i][1] * kx, yi = ring[i][0] * ky;
      const xj = ring[j][1] * kx, yj = ring[j][0] * ky;
      s += xj * yi - xi * yj;
    }
    return Math.abs(s) / 2;
  };
  let a = ringArea(poly[0]);
  for (let h = 1; h < poly.length; h++) a -= ringArea(poly[h]);
  return Math.max(0, a);
}

export function setAreaM2(set: PolygonSet): number {
  // NOTE: this SUMS the polygons. It is correct only when they do not overlap.
  // It exists for the single-polygon site cross-check, not for constraints —
  // overlapping constraints are exactly what the grid is here to resolve.
  const b = boundsOf(set);
  const refLat = b ? (b[0] + b[2]) / 2 : 0;
  return set.reduce((a, p) => a + polygonAreaM2(p, refLat), 0);
}

function avgLat(ring: Ring): number {
  if (!ring.length) return 0;
  let s = 0;
  for (const [lat] of ring) s += lat;
  return s / ring.length;
}

/* ------------------------------------------------------------------ *
 * The analysis
 * ------------------------------------------------------------------ */

export type ConstraintLayerInput = {
  /** stable machine key, e.g. 'flood' */
  key: string;
  /** human label for the report */
  label?: string;
  /** the layer's polygons, [lat,lng] rings, holes after the first */
  polygons: PolygonSet;
};

export type ConstraintLayerResult = {
  key: string;
  label: string;
  /** cells inside the site that this layer covers */
  cells: number;
  constrainedM2: number;
  constrainedAcres: number;
  constrainedHectares: number;
  /** 0..1 of the site */
  shareOfSite: number;
  /** how much of THIS layer's area is also covered by at least one other
   *  layer — the part of it that is double-counted when you sum */
  sharedWithOthersM2: number;
  /** true when the layer contributes nothing the others do not already
   *  constrain; it costs the deal no additional land */
  fullyRedundant: boolean;
  polygonCount: number;
};

export type PairOverlap = {
  a: string;
  b: string;
  m2: number;
  acres: number;
};

export type ConstraintAnalysis = {
  ok: true;
  grid: {
    n: number;
    /** cells whose centre fell inside the site polygon */
    cellsInSite: number;
    /** nominal cell edge length in metres (north-south x east-west at the
     *  bbox centre latitude) */
    resolutionM: { ns: number; ew: number };
    bounds: Bounds;
  };
  site: {
    /** grid-sampled site area — the denominator for every share below, so
     *  that shares are internally consistent even where the grid is coarse */
    areaM2: number;
    areaAcres: number;
    areaHectares: number;
    /** exact shoelace area, for cross-check */
    exactAreaM2: number;
    exactAreaAcres: number;
    /** |grid - exact| / exact. Above ~0.02 raise `n`. */
    gridVsExactError: number;
  };
  layers: ConstraintLayerResult[];
  /** THE HEADLINE. Ground covered by at least one layer. */
  unionM2: number;
  unionAcres: number;
  unionHectares: number;
  unionShareOfSite: number;
  /** The naive figure: layers added together. Always >= union. */
  sumM2: number;
  sumAcres: number;
  /** sum - union. The land you would have written off twice. */
  overlapM2: number;
  overlapAcres: number;
  /** overlapM2 / sumM2 — 0 when no layer overlaps another, 0.5 when half the
   *  naive total is double-counted */
  doubleCountShare: number;
  developableM2: number;
  developableAcres: number;
  developableHectares: number;
  developableShareOfSite: number;
  /** area of the site covered by exactly k layers, k = 0, 1, 2, ... */
  byLayerCount: number[];
  /** pairwise intersections, largest first — where the double-count comes from */
  pairOverlaps: PairOverlap[];
  /** +/- band on the union from grid quantisation: roughly half a cell along
   *  the constraint boundary. Not a confidence interval, an order of magnitude. */
  unionUncertaintyM2: number;
  unionUncertaintyAcres: number;
  method: string;
  caveats: string[];
};

export type ConstraintError = { ok: false; error: string };

export type ConstraintOptions = {
  /** grid resolution per axis. Default 40 => 1,600 samples. Cost is O(n^2). */
  n?: number;
};

/** Hard ceiling on n. 400 is 160,000 cells times however many layers — still
 *  sub-second, but past this the source data's own accuracy dominates and the
 *  extra precision is imaginary. */
export const MAX_N = 400;
export const DEFAULT_N = 40;

export function analyseConstraints(
  site: PolygonSet,
  layers: ConstraintLayerInput[],
  opts: ConstraintOptions = {},
): ConstraintAnalysis | ConstraintError {
  const n = Math.max(4, Math.min(MAX_N, Math.round(opts.n ?? DEFAULT_N)));

  const b = boundsOf(site);
  if (!b) return { ok: false, error: 'site polygon has no usable vertices' };
  const [minLat, minLng, maxLat, maxLng] = b;
  const dLatDeg = (maxLat - minLat) / n;
  const dLngDeg = (maxLng - minLng) / n;
  if (!(dLatDeg > 0) || !(dLngDeg > 0))
    return { ok: false, error: 'site polygon has zero extent in one axis' };

  const L = layers.length;

  // Per-row cell area. Longitude metres shrink with latitude, so a site with
  // real north-south extent has genuinely different cell areas top and bottom.
  const rowArea = new Array<number>(n);
  for (let r = 0; r < n; r++) {
    const rowLat = minLat + (r + 0.5) * dLatDeg;
    rowArea[r] = dLatDeg * M_PER_DEG_LAT * dLngDeg * mPerDegLng(rowLat);
  }

  let siteArea = 0;
  let siteCells = 0;
  let unionArea = 0;
  const layerArea = new Array<number>(L).fill(0);
  const layerCells = new Array<number>(L).fill(0);
  const layerShared = new Array<number>(L).fill(0);
  const pairArea = new Map<string, number>();
  const byCount: number[] = [];
  // constrained mask, kept so the boundary-uncertainty pass can look at
  // neighbours. -1 = outside the site.
  const mask = new Int8Array(n * n).fill(-1);

  const hits: number[] = [];
  for (let r = 0; r < n; r++) {
    const lat = minLat + (r + 0.5) * dLatDeg;
    const cellA = rowArea[r];
    for (let c = 0; c < n; c++) {
      const lng = minLng + (c + 0.5) * dLngDeg;
      if (!pointInSet(lat, lng, site)) continue;

      siteArea += cellA;
      siteCells++;
      hits.length = 0;
      for (let i = 0; i < L; i++)
        if (pointInSet(lat, lng, layers[i].polygons)) hits.push(i);

      const k = hits.length;
      byCount[k] = (byCount[k] ?? 0) + cellA;
      mask[r * n + c] = k > 0 ? 1 : 0;

      for (let a = 0; a < k; a++) {
        layerArea[hits[a]] += cellA;
        layerCells[hits[a]]++;
        if (k > 1) layerShared[hits[a]] += cellA;
        for (let bIdx = a + 1; bIdx < k; bIdx++) {
          const key = `${hits[a]}:${hits[bIdx]}`;
          pairArea.set(key, (pairArea.get(key) ?? 0) + cellA);
        }
      }
      if (k > 0) unionArea += cellA;
    }
  }

  if (siteArea <= 0)
    return {
      ok: false,
      error:
        `no grid cell centre fell inside the site at n=${n}. The polygon is ` +
        `probably slivered or self-intersecting; raise n or check the ring order.`,
    };

  // Boundary uncertainty: every cell on a classification edge could plausibly
  // flip, so half a cell along the edge is the honest band.
  let boundaryArea = 0;
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const v = mask[r * n + c];
      if (v < 0) continue;
      const nb = [
        r > 0 ? mask[(r - 1) * n + c] : -1,
        r < n - 1 ? mask[(r + 1) * n + c] : -1,
        c > 0 ? mask[r * n + c - 1] : -1,
        c < n - 1 ? mask[r * n + c + 1] : -1,
      ];
      if (nb.some((x) => x !== v)) boundaryArea += rowArea[r];
    }

  const sum = layerArea.reduce((a, x) => a + x, 0);
  const exact = setAreaM2(site);
  const centreLat = (minLat + maxLat) / 2;

  const layerResults: ConstraintLayerResult[] = layers.map((l, i) => ({
    key: l.key,
    label: l.label ?? l.key,
    cells: layerCells[i],
    constrainedM2: layerArea[i],
    constrainedAcres: layerArea[i] / M2_PER_ACRE,
    constrainedHectares: layerArea[i] / M2_PER_HECTARE,
    shareOfSite: layerArea[i] / siteArea,
    sharedWithOthersM2: layerShared[i],
    fullyRedundant: layerArea[i] > 0 && layerShared[i] >= layerArea[i] - 1e-9,
    polygonCount: l.polygons.length,
  }));

  const pairOverlaps: PairOverlap[] = [...pairArea.entries()]
    .map(([k, m2]) => {
      const [i, j] = k.split(':').map(Number);
      return { a: layers[i].key, b: layers[j].key, m2, acres: m2 / M2_PER_ACRE };
    })
    .sort((x, y) => y.m2 - x.m2);

  const developable = Math.max(0, siteArea - unionArea);
  for (let k = 0; k <= L; k++) if (byCount[k] === undefined) byCount[k] = 0;

  return {
    ok: true,
    grid: {
      n,
      cellsInSite: siteCells,
      resolutionM: {
        ns: dLatDeg * M_PER_DEG_LAT,
        ew: dLngDeg * mPerDegLng(centreLat),
      },
      bounds: b,
    },
    site: {
      areaM2: siteArea,
      areaAcres: siteArea / M2_PER_ACRE,
      areaHectares: siteArea / M2_PER_HECTARE,
      exactAreaM2: exact,
      exactAreaAcres: exact / M2_PER_ACRE,
      gridVsExactError: exact > 0 ? Math.abs(siteArea - exact) / exact : 0,
    },
    layers: layerResults,
    unionM2: unionArea,
    unionAcres: unionArea / M2_PER_ACRE,
    unionHectares: unionArea / M2_PER_HECTARE,
    unionShareOfSite: unionArea / siteArea,
    sumM2: sum,
    sumAcres: sum / M2_PER_ACRE,
    overlapM2: sum - unionArea,
    overlapAcres: (sum - unionArea) / M2_PER_ACRE,
    doubleCountShare: sum > 0 ? (sum - unionArea) / sum : 0,
    developableM2: developable,
    developableAcres: developable / M2_PER_ACRE,
    developableHectares: developable / M2_PER_HECTARE,
    developableShareOfSite: developable / siteArea,
    byLayerCount: byCount,
    pairOverlaps,
    unionUncertaintyM2: boundaryArea / 2,
    unionUncertaintyAcres: boundaryArea / 2 / M2_PER_ACRE,
    method:
      `Raster sample: a ${n} x ${n} grid over the site bounding box, ` +
      `${n * n} cell centres tested against the site and against each ` +
      `constraint layer. Areas are cell counts on an equirectangular ` +
      `projection with a cos(latitude) factor applied per grid row.`,
    caveats: CAVEATS,
  };
}

/** Shipped verbatim in the API response. The method's limits belong next to
 *  its numbers, not in a document nobody opens. */
export const CAVEATS: string[] = [
  'This is a grid sample, not a survey, and not a substitute for one. Use it ' +
    'to decide whether a site is worth surveying.',
  'Accuracy is bounded by the grid resolution. Every constraint edge is ' +
    'quantised to one cell, so the error scales with the length of the ' +
    'constraint boundary. See resolutionM and unionUncertaintyM2.',
  'A constraint narrower than one cell can be missed entirely; one slightly ' +
    'wider than a cell can be overstated. Raise n on long thin features such ' +
    'as watercourses and easements.',
  'Source polygons are generalised in transit (about 4 m) and are mapped at ' +
    'scales of 1:10,000 or coarser. Precision below tens of metres is not ' +
    'real regardless of grid resolution.',
  'Absence of a polygon is not proof the constraint is absent. Several ' +
    'hazards are mapped only where a council has commissioned a study.',
  'The union is the correct figure for lost land. The sum is shown only so ' +
    'the size of the double-count is visible; do not quote the sum.',
  'Developable area here means unconstrained by the layers tested. Setbacks, ' +
    'easements, access, topography and yield controls take further land and ' +
    'are not modelled.',
];
