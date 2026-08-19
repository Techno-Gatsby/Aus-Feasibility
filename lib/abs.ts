/** ABS access, server-side.
 *
 *  Two entirely different ABS endpoints are involved and it matters which is
 *  which, because only one of them is the awkward one. Everything below was
 *  verified by hand against the live services on 2026-08-19.
 *
 *  1. geo.abs.gov.au — the BOUNDARIES, plain ArcGIS REST. It is alive, and it
 *     does send `access-control-allow-origin: *`, so it would in fact work
 *     from the browser. We still call it from the route so that one request
 *     returns one settled answer rather than the client orchestrating three.
 *
 *  2. data.api.abs.gov.au — the NUMBERS, SDMX-JSON. Sends NO CORS header
 *     (confirmed: no access-control-* on the response at all). This one is
 *     genuinely unreachable from a browser and MUST stay server-side.
 *
 *  The SDMX awkwardness is real: an observation key is a colon-joined list of
 *  INDICES into the structure block's value arrays, and the server returns the
 *  values in ITS chosen order, not the order you asked for. Requesting
 *  MEDAVG `1+2+4` comes back as `4,1,2`. Anything that assumes request order
 *  silently mislabels median age as household income, so decoding always goes
 *  through the structure block.
 */

export type LatLng = { lat: number; lng: number };

/** Read lat/lng off a query string.
 *
 *  Exists because `Number(params.get('lat'))` is a trap: `Number(null)` is 0,
 *  not NaN, so a request with NO coordinates at all sails through an
 *  `isFinite` check as a perfectly valid point in the Atlantic off Ghana. The
 *  caller then gets a confident answer about nowhere instead of a 400. */
export function parseLatLng(params: URLSearchParams): LatLng | null {
  const rawLat = params.get('lat');
  const rawLng = params.get('lng');
  if (rawLat === null || rawLng === null) return null;
  if (rawLat.trim() === '' || rawLng.trim() === '') return null;
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/** ASGS Edition 3 (2021). Deliberately NOT the 2026 folder that also exists on
 *  the server: the statistical dataflows are keyed to CL_ASGS_2021, so a 2026
 *  boundary code would look valid and return nothing. Boundary vintage and
 *  data vintage have to match. */
export const SA2_LAYER =
  'https://geo.abs.gov.au/arcgis/rest/services/ASGS2021/SA2/MapServer/0';

const SDMX = 'https://data.api.abs.gov.au/rest/data';

/** The API 406s on `version=1.0.0`; the advertised type is `version=1.0`. */
const SDMX_ACCEPT = 'application/vnd.sdmx.data+json;version=1.0';

export type Sa2 = {
  code: string;
  name: string;
  sa3: string | null;
  sa4: string | null;
  gccsa: string | null;
  state: string | null;
  areaSqKm: number | null;
};

export type Figure = {
  value: number;
  /** Reference period as the ABS states it — never relabelled or extrapolated. */
  period: string;
};

/** A value we could not get. Carries the reason so the UI can say why instead
 *  of printing a zero. */
export type Missing = { field: string; reason: string };

export type Demographics = {
  sa2: Sa2 | null;
  population: Figure | null;
  medianAge: Figure | null;
  medianPersonalIncomeWeekly: Figure | null;
  medianHouseholdIncomeWeekly: Figure | null;
  missing: Missing[];
};

/* ------------------------------------------------------------------ SDMX */

type Obs = { dims: Record<string, { id: string; name: string }>; value: number };

async function getJson(url: string, accept: string, ms = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { Accept: accept }, signal: ctl.signal });
    const text = await r.text();
    if (!r.ok) {
      // ABS answers a bad flowRef or key with a PLAIN-TEXT body and a 404/406.
      // Parsing it as JSON throws and the real message — which names the
      // problem exactly — gets lost behind a SyntaxError.
      return { json: null, error: `HTTP ${r.status}: ${text.slice(0, 160).trim()}` };
    }
    try {
      return { json: JSON.parse(text), error: null as string | null };
    } catch {
      return { json: null, error: 'response was not JSON' };
    }
  } catch (e: any) {
    return { json: null, error: e?.name === 'AbortError' ? 'timeout' : String(e?.message ?? e) };
  } finally {
    clearTimeout(t);
  }
}

/** Flatten SDMX-JSON (dimensionAtObservation=AllDimensions) into labelled
 *  observations. This is the only place that touches the index arithmetic. */
function decodeSdmx(j: any): Obs[] {
  const data = j?.data ?? j;
  // v1.0 exposes `structure`; some responses use the v2-style `structures[0]`.
  const structure = data?.structure ?? data?.structures?.[0];
  const dims = structure?.dimensions?.observation;
  const dataSet = data?.dataSets?.[0];
  if (!Array.isArray(dims) || !dataSet?.observations) return [];

  const out: Obs[] = [];
  for (const [key, val] of Object.entries<any>(dataSet.observations)) {
    const idx = key.split(':').map(Number);
    // A malformed key would otherwise index undefined and throw mid-loop.
    if (idx.length !== dims.length || idx.some((n) => !Number.isFinite(n))) continue;
    const value = Array.isArray(val) ? val[0] : val;
    if (typeof value !== 'number') continue; // suppressed / confidentialised cells

    const labelled: Record<string, { id: string; name: string }> = {};
    let ok = true;
    for (let i = 0; i < dims.length; i++) {
      const v = dims[i]?.values?.[idx[i]];
      if (!v) { ok = false; break; }
      labelled[dims[i].id] = { id: String(v.id), name: String(v.name ?? v.id) };
    }
    if (ok) out.push({ dims: labelled, value });
  }
  return out;
}

const period = (o: Obs) => o.dims.TIME_PERIOD?.name ?? o.dims.TIME_PERIOD?.id ?? 'unstated';

/* ------------------------------------------------------------- boundaries */

/** SA2 containing the point, from the ABS boundary service. */
export function readSa2(attrs: any): Sa2 | null {
  const code = attrs?.sa2_code_2021;
  const name = attrs?.sa2_name_2021;
  if (!code || !name) return null;
  return {
    code: String(code),
    name: String(name),
    sa3: attrs.sa3_name_2021 ?? null,
    sa4: attrs.sa4_name_2021 ?? null,
    gccsa: attrs.gccsa_name_2021 ?? null,
    state: attrs.state_name_2021 ?? null,
    areaSqKm: typeof attrs.area_albers_sqkm === 'number' ? attrs.area_albers_sqkm : null,
  };
}

/* ------------------------------------------------------------------- data */

/** Estimated Resident Population — the ABS's own current estimate, not a
 *  Census count, so it is several years fresher (2025 at time of writing).
 *  Key order is MEASURE.REGION_TYPE.ASGS_2021.FREQ; getting it wrong returns
 *  a 404 "Could not find Dataflow and/or DSD", not an empty result. */
export async function fetchPopulation(sa2Code: string): Promise<{ figure: Figure | null; error: string | null }> {
  const url =
    `${SDMX}/ABS,ABS_ANNUAL_ERP_ASGS2021/ERP.SA2.${encodeURIComponent(sa2Code)}.A` +
    `?dimensionAtObservation=AllDimensions&lastNObservations=1`;
  const { json, error } = await getJson(url, SDMX_ACCEPT);
  if (error) return { figure: null, error };
  const obs = decodeSdmx(json);
  const hit = obs.find((o) => o.dims.MEASURE?.id === 'ERP') ?? obs[0];
  if (!hit) return { figure: null, error: 'no ERP observation for this SA2' };
  return { figure: { value: hit.value, period: period(hit) }, error: null };
}

/** Census 2021 G02 "Selected medians and averages".
 *  MEDAVG codes: 1 = median age, 2 = median total personal income ($/week),
 *  4 = median total household income ($/week). Dimension order is
 *  MEDAVG.REGION.REGION_TYPE.STATE. */
export async function fetchMedians(sa2Code: string): Promise<{
  age: Figure | null;
  personal: Figure | null;
  household: Figure | null;
  error: string | null;
}> {
  const url =
    `${SDMX}/ABS,C21_G02_SA2/1+2+4.${encodeURIComponent(sa2Code)}.SA2..` +
    `?dimensionAtObservation=AllDimensions`;
  const { json, error } = await getJson(url, SDMX_ACCEPT);
  if (error) return { age: null, personal: null, household: null, error };

  const obs = decodeSdmx(json);
  // Match on the MEDAVG code, NOT on position — the server reorders.
  const pick = (code: string): Figure | null => {
    const o = obs.find((x) => x.dims.MEDAVG?.id === code);
    return o ? { value: o.value, period: period(o) } : null;
  };
  return { age: pick('1'), personal: pick('2'), household: pick('4'), error: null };
}
