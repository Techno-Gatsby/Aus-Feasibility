'use server';

/** Dense elevation grid for the 3D site view.
 *
 *  WHY THIS IS A SERVER ACTION AND NOT A FETCH
 *  The browser cannot build this grid itself. Terrarium tiles on
 *  elevation-tiles-prod return no `Access-Control-Allow-Origin` header
 *  (verified: HEAD on s3.amazonaws.com/elevation-tiles-prod/terrarium/... comes
 *  back 200 with no CORS header at all), so an <img crossOrigin> taints the
 *  canvas and getImageData throws. The Google Elevation key is server-side by
 *  design. So the sampling has to happen on the server, and a `'use server'`
 *  module is the smallest way to do that without adding another /api route.
 *
 *  WHAT IT RETURNS, AND WHAT IT REFUSES TO PRETEND
 *  `/api/terrain` answers "what is the average grade" — one plane through 36
 *  points. A surface needs the points themselves, so this samples a denser
 *  grid from the SAME source that lib/terrain chose, and hands back both the
 *  raw elevations and lib/terrain's own metadata verbatim: source, resolution,
 *  datum, the resolution note, warnings. The renderer therefore never has to
 *  invent a provenance line.
 *
 *  The grid density is capped against the source's real resolution. Sampling a
 *  30 m DEM on a 4 m grid does not produce a 4 m surface, it produces the same
 *  30 m surface with smoother-looking interpolation — which reads as detail
 *  that was never measured. `spacingM` and `resolutionM` are both returned and
 *  the UI shows both, so the gap between "how often we asked" and "how finely
 *  the ground was actually measured" is on screen rather than implied away.
 *
 *  Missing points come back as null and stay null. A hole in a DEM rendered as
 *  a value is a hole rendered as ground.
 */

import { analyseTerrain, terrariumElevations, googleElevations } from '@/lib/terrain';
import { nswDemElevations, nswDemCovers } from '@/lib/dem';

const M_PER_LAT = 110574;
const mPerLng = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);
const TILE = 256;
const pxMetres = (lat: number, z: number) =>
  (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

/** Corner-aligned grid: the first and last rows/columns sit ON the bbox edges
 *  so the rendered surface covers the drawn site rather than stopping half a
 *  cell short of it. (lib/terrain uses cell centres because it is fitting a
 *  plane, where edge coverage does not matter.) */
function cornerGrid(b: [number, number, number, number], n: number) {
  const pts: { lat: number; lng: number }[] = [];
  for (let i = 0; i < n; i++) {
    const lat = b[1] + (b[3] - b[1]) * (i / (n - 1));
    for (let j = 0; j < n; j++) {
      pts.push({ lat, lng: b[0] + (b[2] - b[0]) * (j / (n - 1)) });
    }
  }
  return pts;
}

/** Highest grid density that is still defensible for a given source
 *  resolution. Half the post spacing is the Nyquist-ish limit: below that we
 *  are drawing the interpolator, not the ground. */
function densityFor(resolutionM: number | null, longestM: number, source: string) {
  const target = Math.max((resolutionM ?? 30) / 2, 4);
  const raw = Math.round(longestM / target) + 1;
  // Google Elevation is one GET with the locations in the query string; past
  // ~200 points the URL is longer than the service will take. The other two
  // sources are POST/tile-based and do not have that ceiling.
  // NSW's getSamples is chunked 100 at a time inside lib/dem and fired with
  // Promise.all; past a few hundred points the service starts dropping whole
  // chunks, so the grid is capped and the request is paced below.
  const cap = source === 'google' ? 13 : source === 'nsw5m' ? 24 : 30;
  return Math.max(6, Math.min(cap, raw));
}

/** NSW 5 m DEM, paced.
 *
 *  Asking for 900 points at once produced 349 empty cells at Echo Point — not
 *  cliff voids, whole 100-point chunks the service declined under nine
 *  concurrent POSTs. A shredded surface with holes in it looks like missing
 *  ground when it is actually a rate limit, so the request is sent in serial
 *  batches and anything still missing is asked for a second time. What is null
 *  after that is a genuine void and stays null.
 */
async function nswPaced(pts: { lat: number; lng: number }[], timeoutMs: number) {
  const BATCH = 400;                       // four internal chunks per round trip
  const values: (number | null)[] = new Array(pts.length).fill(null);
  let resolutionM: number | null = null;
  let any = false;

  for (let i = 0; i < pts.length; i += BATCH) {
    const r = await nswDemElevations(pts.slice(i, i + BATCH), timeoutMs);
    if (!r) continue;
    any = true;
    resolutionM = Math.max(resolutionM ?? 0, r.resolutionM);
    r.values.forEach((v, k) => { if (v !== null) values[i + k] = v; });
  }
  if (!any) return null;

  const missing: number[] = [];
  values.forEach((v, i) => { if (v === null) missing.push(i); });
  if (missing.length && missing.length < pts.length) {
    for (let i = 0; i < missing.length; i += BATCH) {
      const idx = missing.slice(i, i + BATCH);
      const r = await nswDemElevations(idx.map((k) => pts[k]), timeoutMs);
      if (!r) continue;
      r.values.forEach((v, k) => { if (v !== null) values[idx[k]] = v; });
    }
  }

  const hits = values.filter((v) => v !== null).length;
  return hits ? { values, resolutionM: resolutionM ?? 5, hits } : null;
}

export async function sampleSurface(
  bbox: [number, number, number, number],
  timeoutMs = 15000,
) {
  const [w, s, e, nth] = bbox;
  const midLat = (s + nth) / 2;
  const midLng = (w + e) / 2;
  const widthM = Math.max(1, (e - w) * mPerLng(midLat));
  const heightM = Math.max(1, (nth - s) * M_PER_LAT);

  /* ---- 1. lib/terrain decides the source and owns every published number.
       Cast to a loose shape on purpose: this module must not break the build
       when TerrainResult gains or renames a field. ---- */
  let t: any = null;
  try {
    t = await analyseTerrain({ bbox, n: 6, googleKey: process.env.GOOGLE_MAPS_API_KEY || null, timeoutMs });
  } catch (err) {
    t = null;
  }

  const source: string = t?.source ?? (nswDemCovers({ lng: midLng, lat: midLat }) ? 'nsw5m' : 'terrarium');
  const resolutionM: number | null = Number.isFinite(t?.resolutionM) ? Number(t.resolutionM) : null;
  const n = densityFor(resolutionM, Math.max(widthM, heightM), source);
  const pts = cornerGrid(bbox, n);

  /* ---- 2. Dense sample from that same source. ---- */
  let elev: (number | null)[] = [];
  let gridSource = source;
  let gridResolutionM = resolutionM;
  let degraded: string | null = null;

  /** Every failure path returns the same shape, so the caller never has to
   *  branch on which one it was. `reason` is the sentence shown to the reader
   *  in place of a surface — never instead of nothing. */
  const fail = (reason: string, filled = 0, requested = 0) => ({
    ok: false as const, reason,
    bbox, n: 0, elev: [] as (number | null)[], filled, requested,
    widthM, heightM, spacingM: null as number | null,
    minM: null as number | null, maxM: null as number | null,
    meanM: null as number | null, reliefM: null as number | null,
    source: gridSource as string | null,
    sourceLabel: String(t?.sourceLabel ?? ''),
    datum: (t?.datum ?? null) as string | null,
    resolutionM: gridResolutionM,
    resolutionNote: String(t?.resolutionNote ?? ''),
    degraded,
    slopePct: null as number | null, crossFallPct: null as number | null,
    aspect: null as string | null, aspectDeg: null as number | null,
    grade: null as string | null, fallM: null as number | null,
    spanM: null as number | null,
    warnings: Array.isArray(t?.warnings) ? (t.warnings as string[]) : [],
  });

  const terrarium = async () => {
    // Same tile-budget rule lib/terrain uses, so we land on the same zoom and
    // therefore the same pixels it read.
    let z = 15;
    while (z > 10) {
      const px = pxMetres(midLat, z);
      const tiles = Math.ceil(widthM / (px * TILE) + 1) * Math.ceil(heightM / (px * TILE) + 1);
      if (tiles <= 12) break;
      z--;
    }
    return terrariumElevations(pts, z, timeoutMs);
  };

  try {
    if (source === 'nsw5m') {
      const r = await nswPaced(pts, timeoutMs);
      if (r && r.hits > 0) {
        elev = r.values;
        gridResolutionM = r.resolutionM;
      } else {
        elev = await terrarium();
        gridSource = 'terrarium';
        gridResolutionM = 30;
        degraded = 'The NSW 5 m DEM answered the slope query but returned nothing for the ' +
          'denser render grid, so the SURFACE below is the ~30 m terrarium one. The slope ' +
          'figures above it are still the 5 m ones. Two different datasets in one view — ' +
          'read the shape as 30 m.';
      }
    } else if (source === 'google' && process.env.GOOGLE_MAPS_API_KEY) {
      const r = await googleElevations(pts, process.env.GOOGLE_MAPS_API_KEY, timeoutMs);
      if (r) {
        elev = r.values;
        gridResolutionM = r.resolution ?? resolutionM;
      } else {
        elev = await terrarium();
        gridSource = 'terrarium';
        gridResolutionM = 30;
        degraded = 'Google Elevation served the slope query but not the denser render grid; ' +
          'the surface below is the ~30 m terrarium one.';
      }
    } else {
      elev = await terrarium();
      gridSource = 'terrarium';
      gridResolutionM = gridResolutionM ?? 30;
    }
  } catch (err) {
    return fail(`Elevation sampling failed: ${err instanceof Error ? err.message : String(err)}. ` +
      'No surface is drawn — an empty picture is the honest answer to a failed request.');
  }

  const good = elev.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (good.length < 4) {
    return fail(
      good.length === 0
        ? 'No elevation source returned a value anywhere on this footprint. Nothing is drawn — ' +
          'a flat plane here would be an invented surface, not a flat site.'
        : `Only ${good.length} of ${pts.length} sample points returned an elevation. That is not ` +
          'enough to draw a surface, and the gaps would have to be filled by guesswork.',
      good.length, pts.length);
  }

  const minM = Math.min(...good);
  const maxM = Math.max(...good);
  const meanM = good.reduce((a, b) => a + b, 0) / good.length;

  /* A DEM that answers with one number everywhere is not describing flat
     ground, it is describing water or a void in its own coverage — terrarium
     returns a flat 0 m over Port Phillip Bay and over holes in the mosaic
     alike. Drawing that produces a perfectly level plane, which is exactly
     what a genuinely level site looks like, so the picture would be a lie
     that cannot be told apart from the truth. Refuse it. */
  if (maxM === minM) {
    return fail(
      `All ${good.length} samples came back at exactly ${minM.toFixed(1)} m. A DEM returns a ` +
      'single constant like that over water and over voids in its coverage, not over ground. ' +
      'No surface is drawn: a perfectly level plane would be indistinguishable from a genuinely ' +
      'level site, and this is almost certainly no data at all.',
      good.length, pts.length);
  }

  const SOURCE_LABEL: Record<string, string> = {
    nsw5m: 'NSW 5 m DEM (Spatial Services SIX, 5 m posts, AHD)',
    google: 'Google Elevation API',
    terrarium: 'Terrarium tiles (SRTM 1-arcsec, ~30 m)',
  };

  return {
    ok: true as const,
    reason: undefined as string | undefined,
    bbox,
    n,
    /** Row-major. Row 0 is the SOUTH edge, column 0 the WEST edge. */
    elev,
    filled: good.length,
    requested: pts.length,
    widthM,
    heightM,
    /** Distance between adjacent render samples. NOT the data resolution. */
    spacingM: Math.max(widthM, heightM) / (n - 1),
    minM,
    maxM,
    meanM,
    reliefM: maxM - minM,
    source: gridSource as string | null,
    // If the render grid fell back to a different source than the slope
    // figures, say so in the label rather than inheriting the wrong one.
    sourceLabel: gridSource === t?.source
      ? String(t?.sourceLabel ?? SOURCE_LABEL[gridSource] ?? gridSource)
      : (SOURCE_LABEL[gridSource] ?? gridSource),
    datum: (t?.datum ?? null) as string | null,
    resolutionM: gridResolutionM,
    resolutionNote: String(t?.resolutionNote ?? ''),
    degraded,
    slopePct: Number.isFinite(t?.slopePct) ? Number(t.slopePct) : null,
    crossFallPct: Number.isFinite(t?.crossFallPct) ? Number(t.crossFallPct) : null,
    aspect: (t?.aspect ?? null) as string | null,
    aspectDeg: Number.isFinite(t?.aspectDeg) ? Number(t.aspectDeg) : null,
    grade: (t?.grade ?? null) as string | null,
    fallM: Number.isFinite(t?.fallM) ? Number(t.fallM) : null,
    spanM: Number.isFinite(t?.spanM) ? Number(t.spanM) : null,
    warnings: Array.isArray(t?.warnings) ? (t.warnings as string[]) : [],
  };
}
