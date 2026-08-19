/** Terrain / slope sampling.
 *
 *  Slope is the number that decides whether a site is a deal. The difference
 *  between 3% and 12% average grade is the difference between trimming topsoil
 *  and importing a retaining-wall budget, so every figure here carries the
 *  resolution it was measured at. A slope number without a resolution is not
 *  information, it is decoration.
 *
 *  Two sources, in preference order:
 *    1. Google Elevation API — real point samples, returns its own per-point
 *       resolution. Requires GOOGLE_MAPS_API_KEY, which is SERVER-SIDE ONLY.
 *       This module is therefore server-only (it uses node:zlib as well).
 *    2. Terrarium tiles on elevation-tiles-prod — free, no key. Outside the
 *       United States the underlying DEM is SRTM 1-arcsec, ~30 m. The tile
 *       PIXEL is finer than that at zoom 15, which flatters the data: the
 *       pixel spacing is an interpolation grid, not the measurement.
 *
 *  Neither is a survey. Both are reported as screening.
 */
import zlib from 'node:zlib';

export type LatLng = { lat: number; lng: number };
export type Box = [number, number, number, number]; // W,S,E,N

export type TerrainSource = 'google' | 'terrarium';

export type TerrainResult = {
  ok: boolean;
  /** Which elevation source actually produced the numbers. Never guessed. */
  source: TerrainSource | null;
  sourceLabel: string;
  /** Populated when the preferred source failed and we fell back. */
  fallbackFrom?: string;
  reason?: string;               // why ok === false
  samples: number;
  requested: number;
  minM: number | null;
  maxM: number | null;
  meanM: number | null;
  /** max − min across the sampled footprint, in metres. */
  fallM: number | null;
  /** Average grade from a least-squares plane through the samples. This is
   *  the figure that maps to earthworks volume. */
  slopePct: number | null;
  /** fall ÷ diagonal. The legacy build reported only this; it under-reads a
   *  site that falls across the short axis, so both are given. */
  crossFallPct: number | null;
  /** Downhill direction, compass degrees, plus a cardinal for reading aloud. */
  aspectDeg: number | null;
  aspect: string | null;
  grade: 'gentle' | 'moderate' | 'steep' | 'severe' | null;
  /** Diagonal of the sampled box, so "fall" has something to be across. */
  spanM: number | null;
  /** Distance between adjacent grid samples. Bounds what the slope can see. */
  sampleSpacingM: number | null;
  /** The honest resolution of the underlying data, not the sample grid. */
  resolutionM: number | null;
  resolutionNote: string;
  bbox: Box;
  gridN: number;
  /** Anything that degraded the reading but did not kill it. */
  warnings: string[];
};

/* ------------------------------------------------------------------ *
 * Minimal PNG decode. No dependency is added for this: terrarium tiles
 * are 8-bit non-interlaced RGB, and node:zlib does the only hard part.
 * ------------------------------------------------------------------ */
type Raster = { width: number; height: number; channels: number; data: Buffer };

export function decodePng(buf: Buffer): Raster {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47)
    throw new Error('not a PNG');
  let off = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
  const idat: Buffer[] = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const start = off + 8;
    if (type === 'IHDR') {
      w = buf.readUInt32BE(start); h = buf.readUInt32BE(start + 4);
      depth = buf[start + 8]; ctype = buf[start + 9]; interlace = buf[start + 12];
    } else if (type === 'IDAT') idat.push(buf.subarray(start, start + len));
    else if (type === 'IEND') break;
    off = start + len + 4;
  }
  if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`);
  if (interlace !== 0) throw new Error('interlaced PNG unsupported');
  const ch = ctype === 0 ? 1 : ctype === 2 ? 3 : ctype === 4 ? 2 : ctype === 6 ? 4 : 0;
  if (!ch) throw new Error(`unsupported colour type ${ctype}`);
  if (!w || !h || !idat.length) throw new Error('empty PNG');

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(stride * h);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[pos++];
    const line = raw.subarray(pos, pos + stride); pos += stride;
    const cur = out.subarray(y * stride, y * stride + stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= ch ? prev[i - ch] : 0;
      const x = line[i];
      let v: number;
      switch (f) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`bad PNG filter ${f}`);
      }
      cur[i] = v & 0xff;
    }
  }
  return { width: w, height: h, channels: ch, data: out };
}

/* ------------------------------------------------------------------ *
 * Terrarium tiles
 * ------------------------------------------------------------------ */
const TILE = 256;
const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
/** 16 is a 404 on this dataset — verified, not assumed. 15 is the ceiling. */
export const TERRARIUM_MAX_ZOOM = 15;

function slippy(lat: number, lng: number, z: number) {
  const n = 2 ** z;
  const fx = ((lng + 180) / 360) * n;
  const s = Math.sin((lat * Math.PI) / 180);
  const fy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  const tx = Math.floor(fx), ty = Math.floor(fy);
  return {
    tx, ty,
    px: Math.min(TILE - 1, Math.max(0, Math.floor((fx - tx) * TILE))),
    py: Math.min(TILE - 1, Math.max(0, Math.floor((fy - ty) * TILE))),
  };
}

/** Ground size of one terrarium pixel. This is the SAMPLE grid, and it is
 *  finer than the data behind it — see resolutionNote. */
export const pixelMetres = (lat: number, z: number) =>
  (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

async function fetchTile(
  z: number, x: number, y: number, cache: Map<string, Promise<Raster>>, ms: number,
): Promise<Raster> {
  const key = `${z}/${x}/${y}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = (async () => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(`${TERRARIUM}/${key}.png`, { signal: ctl.signal });
      if (!r.ok) throw new Error(`terrarium HTTP ${r.status}`);
      return decodePng(Buffer.from(await r.arrayBuffer()));
    } finally { clearTimeout(t); }
  })();
  cache.set(key, p);
  return p;
}

/** Terrarium encoding: (R * 256 + G + B / 256) − 32768 metres. */
export async function terrariumElevations(
  pts: LatLng[], zoom: number, timeoutMs = 12000,
): Promise<(number | null)[]> {
  const cache = new Map<string, Promise<Raster>>();
  const out: (number | null)[] = [];
  // Sequential per unique tile, but the cache means each tile is fetched once
  // and a 6x6 grid over a normal site touches one to four tiles.
  for (const p of pts) {
    const t = slippy(p.lat, p.lng, zoom);
    try {
      const img = await fetchTile(zoom, t.tx, t.ty, cache, timeoutMs);
      const i = (t.py * img.width + t.px) * img.channels;
      const e = img.data[i] * 256 + img.data[i + 1] + img.data[i + 2] / 256 - 32768;
      // Terrarium encodes "no data" as the ocean floor sentinel, not null.
      out.push(e < -12000 || e > 9000 ? null : e);
    } catch {
      out.push(null);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Google Elevation API — key stays on the server
 * ------------------------------------------------------------------ */
export async function googleElevations(
  pts: LatLng[], key: string, timeoutMs = 12000,
): Promise<{ values: (number | null)[]; resolution: number | null } | null> {
  if (!pts.length) return null;
  const locs = pts.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join('|');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(
      'https://maps.googleapis.com/maps/api/elevation/json?locations=' +
      encodeURIComponent(locs) + '&key=' + encodeURIComponent(key),
      { signal: ctl.signal },
    );
    if (!r.ok) return null;
    const j: any = await r.json();
    // Google returns 200 with a status string; OVER_QUERY_LIMIT looks like
    // success to anyone only checking the HTTP code.
    if (j?.status !== 'OK' || !Array.isArray(j.results)) return null;
    const values = j.results.map((x: any) =>
      Number.isFinite(Number(x?.elevation)) ? Number(x.elevation) : null);
    const res = j.results
      .map((x: any) => Number(x?.resolution))
      .filter((n: number) => Number.isFinite(n));
    return { values, resolution: res.length ? Math.max(...res) : null };
  } catch {
    return null;
  } finally { clearTimeout(t); }
}

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */
const M_PER_LAT = 110574;
const mPerLng = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

/** A square-ish box of `halfM` metres either side of a point. Used when the
 *  caller has a pin rather than a drawn polygon. */
export function boxAround(lat: number, lng: number, halfM: number): Box {
  const dLat = halfM / M_PER_LAT;
  const dLng = halfM / Math.max(1, mPerLng(lat));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
}

export function boxOfRing(ring: [number, number][]): Box | null {
  const xs = ring.map((c) => Number(c[0])).filter(Number.isFinite);
  const ys = ring.map((c) => Number(c[1])).filter(Number.isFinite);
  if (!xs.length || !ys.length) return null;
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Cell-centre grid, so no sample sits exactly on the boundary. */
function grid(b: Box, n: number): LatLng[] {
  const pts: LatLng[] = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      pts.push({
        lat: b[1] + (b[3] - b[1]) * ((i + 0.5) / n),
        lng: b[0] + (b[2] - b[0]) * ((j + 0.5) / n),
      });
  return pts;
}

const CARDINALS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
const cardinal = (deg: number) => CARDINALS[Math.round(deg / 22.5) % 16];

function gradeOf(pct: number): TerrainResult['grade'] {
  if (pct < 3) return 'gentle';
  if (pct < 8) return 'moderate';
  if (pct < 15) return 'steep';
  return 'severe';
}

/* ------------------------------------------------------------------ *
 * The analysis
 * ------------------------------------------------------------------ */
export type TerrainOptions = {
  bbox: Box;
  /** grid is n x n; 6 gives 36 samples, which is one Google request. */
  n?: number;
  googleKey?: string | null;
  timeoutMs?: number;
};

export async function analyseTerrain(opts: TerrainOptions): Promise<TerrainResult> {
  const bbox = opts.bbox;
  const n = Math.max(3, Math.min(16, Math.round(opts.n ?? 6)));
  const timeoutMs = opts.timeoutMs ?? 12000;
  const pts = grid(bbox, n);
  const midLat = (bbox[1] + bbox[3]) / 2;

  const widthM = (bbox[2] - bbox[0]) * mPerLng(midLat);
  const heightM = (bbox[3] - bbox[1]) * M_PER_LAT;
  const spanM = Math.max(1, Math.hypot(widthM, heightM));
  const sampleSpacingM = Math.max(1, Math.hypot(widthM / n, heightM / n));

  const warnings: string[] = [];
  let source: TerrainSource | null = null;
  let fallbackFrom: string | undefined;
  let resolutionM: number | null = null;
  let resolutionNote = '';
  let values: (number | null)[] | null = null;

  if (opts.googleKey) {
    const g = await googleElevations(pts, opts.googleKey, timeoutMs);
    if (g) {
      source = 'google';
      values = g.values;
      resolutionM = g.resolution;
      resolutionNote = resolutionM
        ? `Google Elevation API, ${resolutionM.toFixed(0)} m source resolution as reported by the service.`
        : 'Google Elevation API; the service did not report a resolution for these points.';
    } else {
      fallbackFrom = 'Google Elevation API (no answer, quota, or key rejected)';
      warnings.push('Google Elevation did not answer; fell back to terrarium tiles.');
    }
  }

  if (!values) {
    // Finest tile zoom the dataset actually serves, stepped down if the box
    // is large enough that finest zoom would mean fetching a wall of tiles.
    let zoom = TERRARIUM_MAX_ZOOM;
    while (zoom > 10) {
      const px = pixelMetres(midLat, zoom);
      const tiles = Math.ceil(widthM / (px * TILE) + 1) * Math.ceil(heightM / (px * TILE) + 1);
      if (tiles <= 12) break;
      zoom--;
    }
    values = await terrariumElevations(pts, zoom, timeoutMs);
    source = 'terrarium';
    const px = pixelMetres(midLat, zoom);
    // The honest number is the DEM behind the tile, not the tile pixel.
    resolutionM = 30;
    resolutionNote =
      `Terrarium tiles (elevation-tiles-prod) at zoom ${zoom}: ${px.toFixed(1)} m per pixel, ` +
      `but outside the United States the underlying DEM is SRTM 1-arcsec, about 30 m. ` +
      `The finer pixel spacing is interpolation, not measurement. This is a screening ` +
      `figure and is NOT a survey — order a contour survey before you commit earthworks money.`;
  }

  const good = values
    .map((z, i) => ({ z, p: pts[i] }))
    .filter((q): q is { z: number; p: LatLng } => Number.isFinite(q.z as number));

  const base: TerrainResult = {
    ok: false, source, sourceLabel: source === 'google' ? 'Google Elevation API'
      : source === 'terrarium' ? 'Terrarium tiles (SRTM 1-arcsec)' : 'none',
    fallbackFrom, samples: good.length, requested: pts.length,
    minM: null, maxM: null, meanM: null, fallM: null, slopePct: null, crossFallPct: null,
    aspectDeg: null, aspect: null, grade: null,
    spanM, sampleSpacingM, resolutionM, resolutionNote, bbox, gridN: n, warnings,
  };

  if (good.length < 4)
    return {
      ...base, ok: false,
      reason: good.length === 0
        ? `No elevation returned for any of the ${pts.length} sample points. ` +
          `The elevation source did not answer, so there is no slope figure to give — ` +
          `this is a source failure, not a flat site.`
        : `Only ${good.length} of ${pts.length} sample points returned elevation, which is ` +
          `too few to fit a slope. No figure is reported rather than a fabricated one.`,
    };

  if (good.length < pts.length)
    warnings.push(
      `${pts.length - good.length} of ${pts.length} sample points returned no elevation; ` +
      `the figures below are from the ${good.length} that did.`);

  // Least-squares plane through the samples, in metres, origin at the SW
  // corner. The plane gradient is the average grade an earthworks estimator
  // would use; max−min over the diagonal is not the same thing.
  const x0 = bbox[0], y0 = bbox[1], mLng = mPerLng(midLat);
  const X = good.map((q) => (q.p.lng - x0) * mLng);
  const Y = good.map((q) => (q.p.lat - y0) * M_PER_LAT);
  const Z = good.map((q) => q.z);
  const k = Z.length;
  const mx = X.reduce((a, b) => a + b, 0) / k;
  const my = Y.reduce((a, b) => a + b, 0) / k;
  const mz = Z.reduce((a, b) => a + b, 0) / k;
  let sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0;
  for (let i = 0; i < k; i++) {
    const dx = X[i] - mx, dy = Y[i] - my, dz = Z[i] - mz;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy; sxz += dx * dz; syz += dy * dz;
  }
  const det = sxx * syy - sxy * sxy;
  let gx = 0, gy = 0;
  if (Math.abs(det) > 1e-9) {
    gx = (sxz * syy - syz * sxy) / det;   // dz/d(east)
    gy = (syz * sxx - sxz * sxy) / det;   // dz/d(north)
  } else {
    warnings.push('Samples were collinear; the average grade falls back to fall over span.');
  }

  const minM = Math.min(...Z), maxM = Math.max(...Z);
  const fallM = maxM - minM;

  // A footprint that reads exactly 0.00 m everywhere is water or a DEM void,
  // not a perfectly level site. Saying "0% slope" there would be the most
  // confident wrong number this module could produce.
  if (minM === 0 && maxM === 0)
    warnings.push(
      'Every sample read exactly 0 m. That is what the DEM returns over water and ' +
      'over voids in the coverage — treat it as no data, not as a perfectly level site.');
  const gradient = Math.hypot(gx, gy);
  const slopePct = Math.abs(det) > 1e-9 ? gradient * 100 : (fallM / spanM) * 100;
  // Downhill bearing: negate the uphill gradient, then atan2(east, north).
  const aspectDeg = gradient > 1e-6
    ? ((Math.atan2(-gx, -gy) * 180) / Math.PI + 360) % 360
    : null;

  return {
    ...base,
    ok: true,
    minM, maxM, meanM: mz, fallM,
    slopePct,
    crossFallPct: (fallM / spanM) * 100,
    aspectDeg,
    aspect: aspectDeg == null ? null : cardinal(aspectDeg),
    grade: gradeOf(slopePct),
  };
}

/** One line an estimator can act on. Kept beside the maths so the wording
 *  and the thresholds can never drift apart. */
export function slopeVerdict(r: TerrainResult): string {
  if (!r.ok || r.slopePct == null || r.fallM == null) return '';
  const p = r.slopePct;
  if (p < 3)
    return 'Gentle. Cut and fill should balance close to on site; earthworks is a line, not a risk.';
  if (p < 8)
    return 'Moderate. Expect benching, retaining to lot boundaries and a real import/export ' +
           'balance to strike. Priceable, but price it.';
  if (p < 15)
    return 'Steep. Earthworks and retaining start driving the feasibility rather than following ' +
           'it — split levels, deeper retaining, longer service runs. Get a civil estimate before bidding.';
  return 'Severe. At this grade yield is set by the topography, not the planning controls. ' +
         'Many sites at this slope do not stack up at all.';
}
