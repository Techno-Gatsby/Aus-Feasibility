/** NSW 5 m DEM — Spatial Services (SIX) elevation ImageServer.
 *
 *  WHY THIS EXISTS
 *  Terrarium tiles are SRTM 1-arcsec underneath: ~30 m posts, and in built-up
 *  Sydney the SRTM surface sits on rooftops and canopy rather than ground.
 *  At Parramatta that reads roughly 8 m high. Eight metres over a hectare is
 *  80,000 m³ of notional cut. Nobody prices a site off that twice.
 *
 *  THE SERVICE
 *    https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_5M_Elevation/ImageServer
 *  Verified from ?f=json:
 *    pixelSizeX/Y  = 5              (5 m posts, photogrammetric from stereo imagery)
 *    bandCount     = 1, pixelType F32
 *    heightModelInfo = orthometric, metres  (AHD — the mosaic items are named
 *                    e.g. "Sydney-DEM-AHD_56_5m")
 *    capabilities  = Catalog,Image,Mensuration,Metadata,Pixels
 *    extent SR     = 102100 / 3857
 *
 *  THE CALL THAT WORKS — the awkward parts, all verified against the live
 *  service rather than assumed:
 *    - `getSamples`, not `identify`. identify is one HTTP round trip per
 *      point; getSamples takes a multipoint and returns the whole grid in one.
 *    - `geometryType=esriGeometryMultipoint` MUST be sent explicitly. The
 *      geometry JSON alone is not enough.
 *    - wkid 4326 is accepted directly — no reprojection to 3857 needed. Both
 *      were tested and return the identical value at the same ground point.
 *    - `value` comes back as a STRING ("8.944000244"). Number() it, and check
 *      the result, because NoData arrives as a non-numeric string.
 *    - POINTS OUTSIDE COVERAGE ARE SILENTLY OMITTED FROM THE ARRAY. Sending
 *      38 points and getting 36 samples back is not an error response, it is
 *      two points off the raster. Results are therefore keyed by the
 *      `locationId` index the service echoes, never by array position. Reading
 *      this response positionally would shift every elevation after the first
 *      gap onto the wrong coordinate, which is a silent, plausible-looking
 *      wrong answer — the worst kind here.
 *    - Do NOT send `returnFirstValueOnly`: it hung the request past 120 s in
 *      testing. The default mosaic rule already returns one value per point.
 *
 *  DATUM NOTE: this is AHD; SRTM and Google are EGM96. Across eastern NSW the
 *  two surfaces differ by well under a metre, so a multi-metre gap between
 *  this source and terrarium is DEM error, not a datum offset. Don't let
 *  anyone wave a discrepancy away as "different datums".
 */
import { stateOf, type Pt } from '@/lib/geo';

export const NSW_DEM_URL =
  'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_5M_Elevation/ImageServer';

/** Post spacing of the published raster, from the service's own metadata. */
export const NSW_DEM_RESOLUTION_M = 5;

export type LatLng = { lat: number; lng: number };

export type NswDemResult = {
  /** Aligned 1:1 with the points passed in. null = off-coverage or NoData. */
  values: (number | null)[];
  /** Post spacing the service reported, per sample. 5 unless it says otherwise. */
  resolutionM: number;
  /** Mosaic item names, e.g. "Sydney-DEM-AHD_56_5m". Best-effort provenance. */
  rasterNames: string[];
  /** Points that came back with a usable number. */
  hits: number;
};

/** The NSW 5 m DEM covers New South Wales and nothing else. Asking it about
 *  Victoria wastes a round trip and gets an empty array back, which is
 *  indistinguishable from a service outage — so we don't ask. The ACT is a
 *  hole in NSW and is not in this mosaic, hence the exact-match test. */
export function nswDemCovers(p: Pt): boolean {
  return stateOf(p) === 'NSW';
}

async function postForm(
  url: string, body: Record<string, string>, timeoutMs: number,
): Promise<any | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });
    if (!r.ok) return null;
    // ArcGIS answers errors with HTTP 200 and an {error:{code,message}} body,
    // so the status code alone proves nothing.
    const j = await r.json();
    if (j && typeof j === 'object' && j.error) return null;
    return j;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** One `identify` at the centre, purely to name the mosaic item that answered.
 *  Provenance, not measurement — a failure here must never fail the sample. */
async function identifyRasterNames(p: LatLng, timeoutMs: number): Promise<string[]> {
  const j = await postForm(`${NSW_DEM_URL}/identify`, {
    geometry: JSON.stringify({ x: p.lng, y: p.lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    returnGeometry: 'false',
    f: 'json',
  }, timeoutMs);
  const feats = j?.catalogItems?.features;
  if (!Array.isArray(feats)) return [];
  return feats
    .map((f: any) => String(f?.attributes?.Name ?? '').trim())
    .filter(Boolean);
}

/** maxRecordCount on this service is 1000; 100 keeps each POST small and each
 *  failure cheap. Our grids top out at 144 points, so this is one or two calls. */
const CHUNK = 100;

/** Sample the NSW 5 m DEM at every point. Returns null when the service gave
 *  us nothing at all — which is a source failure and must be reported as one,
 *  not quietly turned into a flat site. */
export async function nswDemElevations(
  pts: LatLng[], timeoutMs = 12000,
): Promise<NswDemResult | null> {
  if (!pts.length) return null;

  const values: (number | null)[] = new Array(pts.length).fill(null);
  const resolutions: number[] = [];
  let anyResponse = false;

  const chunks: { offset: number; pts: LatLng[] }[] = [];
  for (let i = 0; i < pts.length; i += CHUNK)
    chunks.push({ offset: i, pts: pts.slice(i, i + CHUNK) });

  const namesP = identifyRasterNames(pts[Math.floor(pts.length / 2)], timeoutMs);

  const results = await Promise.all(chunks.map((c) => postForm(`${NSW_DEM_URL}/getSamples`, {
    geometry: JSON.stringify({
      points: c.pts.map((p) => [p.lng, p.lat]),
      spatialReference: { wkid: 4326 },
    }),
    geometryType: 'esriGeometryMultipoint',
    f: 'json',
  }, timeoutMs)));

  results.forEach((j, ci) => {
    if (!j || !Array.isArray(j.samples)) return;
    anyResponse = true;
    const offset = chunks[ci].offset;
    for (const s of j.samples) {
      const id = Number(s?.locationId);
      // Key by locationId. Positional reads break the moment one point of the
      // grid falls off the raster, and they break silently.
      if (!Number.isInteger(id) || id < 0 || id >= chunks[ci].pts.length) continue;
      const idx = offset + id;
      if (values[idx] !== null) continue;          // overlapping mosaic items
      const v = Number(s?.value);
      if (!Number.isFinite(v)) continue;           // "NoData" lands here
      // Australia's range is roughly -15 m (Lake Eyre) to 2228 m (Kosciuszko).
      // Anything outside that is a sentinel wearing a number's clothes.
      if (v < -100 || v > 2500) continue;
      values[idx] = v;
      const res = Number(s?.resolution);
      if (Number.isFinite(res) && res > 0) resolutions.push(res);
    }
  });

  if (!anyResponse) return null;

  const hits = values.filter((v) => v !== null).length;
  if (!hits) return null;

  return {
    values,
    // The service reports resolution per sample. Take the coarsest actually
    // used rather than repeating the 5 m headline if it served something else.
    resolutionM: resolutions.length ? Math.max(...resolutions) : NSW_DEM_RESOLUTION_M,
    rasterNames: await namesP.catch(() => [] as string[]),
    hits,
  };
}
