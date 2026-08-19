/** LIVE OVERLAYS — the data half of the map, ported from the single-file
 *  build (search `LIVE OVERLAYS` / `const AU=` in
 *  legacy/Australia_Land_Feasibility_Paddington_Clean_No_Defaults.html).
 *
 *  Deliberately free of any Leaflet import. Leaflet touches `window` at module
 *  scope, and this file is imported by components that Next may reach from the
 *  server graph; keeping it Leaflet-free means the overlay config, the ArcGIS
 *  plumbing and the contour maths can be unit-reasoned without a map, and can
 *  never drag Leaflet into a server bundle. Only the map component imports
 *  Leaflet, and it is mounted ssr:false.
 *
 *  Every URL below was verified with a live query before it was wired. The two
 *  that did NOT answer from this machine are marked `blocked` with the reason,
 *  rather than being quietly dropped or swapped for a guess — the difference
 *  between "no data here" and "we could not ask" is exactly the difference a
 *  feasibility call turns on.
 */

/* ────────────────────────────── overlay catalogue ─────────────────────────── */

export type OverlayKey =
  | 'states' | 'poa' | 'contours' | 'zoning' | 'population' | 'age' | 'income';

export const OVERLAY_ORDER: OverlayKey[] = [
  'states', 'poa', 'contours', 'zoning', 'population', 'age', 'income',
];

/** minZoom is the FLOOR below which a layer is not requested and not drawn.
 *  Without it the viewport at national zoom is a bbox the size of the
 *  continent and the query comes back with hundreds of kilometres of polygon
 *  per feature — the map goes to treacle and the shapes are meaningless at
 *  that scale anyway. The legacy build carried fractional MapLibre zooms;
 *  these are the same thresholds rounded up to Leaflet's integer steps. */
export const OVERLAY_META: Record<OverlayKey, {
  label: string; source: string; minZoom: number; swatch: string;
}> = {
  states:     { label: 'States / Territories', minZoom: 3, swatch: '#315E92',
                source: 'ABS ASGS 2021 State/Territory boundaries' },
  poa:        { label: 'Postcodes',            minZoom: 8, swatch: '#3974BA',
                source: 'ABS ASGS 2021 Postal Areas' },
  contours:   { label: 'Contours',             minZoom: 9, swatch: '#675744',
                source: 'Terrarium elevation tiles (AWS elevation-tiles-prod, SRTM/NED)' },
  zoning:     { label: 'Zoning',               minZoom: 9, swatch: '#5D6D80',
                source: 'Official state, territory and local-government planning GIS' },
  population: { label: 'Population 2025',      minZoom: 9, swatch: '#477FBA',
                source: 'ABS Regional Population 2025 (SA2)' },
  age:        { label: 'Median age 2024',      minZoom: 9, swatch: '#C97832',
                source: 'ABS Regional population by age and sex 2024 (SA2, 30 June 2024)' },
  income:     { label: 'Median income 2022-23', minZoom: 9, swatch: '#8769B1',
                source: 'ABS Personal Income in Australia 2022-23 (SA2)' },
};

/** ArcGIS feature layers behind the ABS chips.
 *  `field` marks a choropleth layer — it also tightens the generalisation
 *  tolerance, because a shaded area with a visibly wrong edge reads as a data
 *  error rather than as drawing shorthand. */
type AbsCfg = {
  url: string; fields: string; field?: string; nameField?: string;
  maxRecords?: number;
};

export const ABS: Record<'states' | 'poa' | 'population' | 'income', AbsCfg> = {
  states: {
    url: 'https://geo.abs.gov.au/arcgis/rest/services/ASGS2021/STE/MapServer/0',
    fields: '*',
  },
  poa: {
    url: 'https://geo.abs.gov.au/arcgis/rest/services/ASGS2021/POA/MapServer/0',
    fields: '*',
  },
  population: {
    url: 'https://geo.abs.gov.au/arcgis/rest/services/Hosted/SA2_Regional_Population_2025/FeatureServer/3',
    fields: 'sa2_code_2021,sa2_name_2021,erp_2025,erp_change_per_cent_2024_25',
    field: 'erp_2025', nameField: 'sa2_name_2021', maxRecords: 350,
  },
  income: {
    url: 'https://geo.abs.gov.au/arcgis/rest/services/Hosted/Personal_Income_in_Australia_2022_23_SA2_2021/FeatureServer/0',
    fields: 'sa2_code_2021,sa2_name_2021,median_income_23',
    field: 'median_income_23', nameField: 'sa2_name_2021', maxRecords: 350,
  },
};

/** ABS 2025 Local Government Areas — not a chip, but the jurisdiction label
 *  and the QLD zoning provider lookup both need it. */
export const LGA_CFG: AbsCfg = {
  url: 'https://geo.abs.gov.au/arcgis/rest/services/ASGS2025/LGA/MapServer/0',
  fields: 'LGA_CODE_2025,LGA_NAME_2025,STATE_NAME_2021',
};

/** Median age is published through a portal item rather than a fixed layer
 *  URL, so the service is resolved once at runtime and cached. The layer id is
 *  NOT guessable — this is the reason the lookup exists. */
const AGE_ITEM =
  'https://statmaps.abs.gov.au/portal/sharing/rest/content/items/3cf651740aeb420fae64e909f6f62f0c';
let ageCfg: AbsCfg | null = null;

export async function ensureAgeConfig(): Promise<AbsCfg> {
  if (ageCfg) return ageCfg;
  const meta = await getJson(`${AGE_ITEM}?f=json`, 'age-item', 12000);
  let service = String(meta?.url ?? '').replace(/\/$/, '');
  if (!service) {
    const data = await getJson(`${AGE_ITEM}/data?f=json`, 'age-item-data', 12000);
    service = String(data?.operationalLayers?.[0]?.url ?? '').replace(/\/$/, '');
  }
  if (!service) throw new Error('ABS age service URL was not returned by the portal item');

  const candidates: string[] = [];
  if (/\/(FeatureServer|MapServer)\/\d+$/i.test(service)) candidates.push(service);
  else {
    const root = await getJson(`${service}?f=json`, 'age-service', 12000);
    for (const l of (root?.layers ?? []).slice(0, 8)) {
      if (l?.id != null) candidates.push(`${service}/${l.id}`);
    }
  }
  for (const url of candidates) {
    try {
      const def = await getJson(`${url}?f=json`, null, 12000);
      const fields: any[] = def?.fields ?? [];
      const txt = (f: any) => `${f?.alias ?? ''} ${f?.name ?? ''}`;
      const field =
        fields.find((f) => /median age.*persons/i.test(txt(f))) ??
        fields.find((f) => /median age/i.test(txt(f)));
      if (!field) continue;
      const nameField =
        fields.find((f) => /statistical areas level 2.*name|sa2.*name/i.test(txt(f))) ??
        fields.find((f) => /name/i.test(String(f?.name ?? '')));
      const codeField =
        fields.find((f) => /statistical areas level 2.*code|sa2.*code/i.test(txt(f)));
      const nm = String(nameField?.name ?? 'sa2_name_2021');
      const cd = String(codeField?.name ?? 'sa2_code_2021');
      ageCfg = {
        url, field: String(field.name), nameField: nm, maxRecords: 350,
        fields: [cd, nm, String(field.name)].join(','),
      };
      return ageCfg;
    } catch { /* try the next candidate layer */ }
  }
  throw new Error('Median age field was not found in the ABS 2024 SA2 service');
}

/* ─────────────────────────────── fetch plumbing ───────────────────────────── */

const inflight = new Map<string, AbortController>();

/** Aborts the previous request under the same key, so a fast pan does not
 *  stack seven overlapping queries and paint whichever lands last. */
export async function getJson(url: string, key: string | null, ms = 15000): Promise<any> {
  if (key) inflight.get(key)?.abort();
  const ctl = new AbortController();
  if (key) inflight.set(key, ctl);
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { mode: 'cors', credentials: 'omit', signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const ct = r.headers.get('content-type') ?? '';
    const body = await r.text();
    if (!/json/i.test(ct) && !/^\s*[[{]/.test(body)) {
      throw new Error(`service returned ${ct || 'a non-JSON response'}`);
    }
    const j = JSON.parse(body);
    // ArcGIS answers 200 with an error object in the body. Treated as success
    // it looks identical to "nothing mapped here", which is the wrong answer.
    if (j?.error) throw new Error(j.error.message || 'Remote GIS service error');
    return j;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('timed out');
    if (e instanceof TypeError) {
      // A cross-origin block surfaces as an opaque TypeError with no detail.
      throw new Error('blocked by the browser (no CORS header from this service)');
    }
    throw e;
  } finally {
    clearTimeout(t);
    if (key && inflight.get(key) === ctl) inflight.delete(key);
  }
}

export type Box = [number, number, number, number]; // W,S,E,N

/** Server-side generalisation. The tolerance is scaled to zoom because a raw
 *  ABS state boundary is millions of vertices; at national zoom none of them
 *  are distinguishable and all of them have to be parsed. */
export function queryUrl(cfg: AbsCfg, bbox: Box, z: number): string {
  const demo = !!cfg.field;
  const off = demo
    ? (z < 10 ? 0.008 : z < 12 ? 0.003 : z < 14 ? 0.0012 : 0.0005)
    : (z < 6 ? 0.05 : z < 9 ? 0.012 : z < 12 ? 0.003 : 0.0008);
  const p = new URLSearchParams({
    where: '1=1',
    geometry: bbox.join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326', outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: cfg.fields || '*',
    returnGeometry: 'true',
    geometryPrecision: demo ? '4' : '5',
    maxAllowableOffset: String(off),
    resultRecordCount: String(cfg.maxRecords ?? 1200),
    cacheHint: 'true',
    f: 'geojson',
  });
  return `${cfg.url}/query?${p}`;
}

export function esriJsonToGeojson(j: any): GeoJson {
  const features: GeoFeature[] = [];
  for (const f of j?.features ?? []) {
    const g = f.geometry ?? {};
    const geometry =
      g.rings ? { type: 'Polygon' as const, coordinates: g.rings }
      : g.paths ? { type: 'MultiLineString' as const, coordinates: g.paths }
      : Number.isFinite(g.x) && Number.isFinite(g.y)
        ? { type: 'Point' as const, coordinates: [g.x, g.y] }
        : null;
    if (geometry) features.push({ type: 'Feature', geometry: geometry as any, properties: f.attributes ?? {} });
  }
  return { type: 'FeatureCollection', features };
}

export type GeoFeature = { type: 'Feature'; geometry: any; properties: Record<string, any> };
export type GeoJson = { type: 'FeatureCollection'; features: GeoFeature[] };

/** f=geojson first; several council services advertise it and then answer
 *  with Esri JSON anyway, so the fallback is not optional. */
async function arcGeojson(url: string, bbox: Box, z: number, max: number, key: string): Promise<GeoJson> {
  const cfg: AbsCfg = { url, fields: '*', maxRecords: max };
  try {
    const d = await getJson(queryUrl(cfg, bbox, z), key, 16000);
    if (d?.type === 'FeatureCollection') return d as GeoJson;
  } catch (e) {
    // fall through to Esri JSON — but keep a hard failure visible if that
    // fails too, rather than reporting an empty layer
    if (String((e as Error).message).includes('blocked by the browser')) throw e;
  }
  const u = queryUrl(cfg, bbox, z).replace(/f=geojson/, 'f=json');
  return esriJsonToGeojson(await getJson(u, `${key}-json`, 16000));
}

const pick = (o: any, names: string[]): any => {
  if (!o) return null;
  for (const n of names) {
    if (o[n] != null && o[n] !== '') return o[n];
    const k = Object.keys(o).find((x) => x.toLowerCase() === n.toLowerCase());
    if (k && o[k] != null && o[k] !== '') return o[k];
  }
  return null;
};

/* ─────────────────────────── jurisdiction / context ───────────────────────── */

export type Jurisdiction = {
  state: string; stateCode: string; lga: string; lgaCode: string; postcode: string;
};

export function stateCode(name: unknown): string {
  const t = String(name ?? '').toLowerCase();
  if (/new south wales|\bnsw\b/.test(t)) return 'NSW';
  if (/victoria|\bvic\b/.test(t)) return 'VIC';
  if (/queensland|\bqld\b/.test(t)) return 'QLD';
  if (/western australia|\bwa\b/.test(t)) return 'WA';
  if (/south australia|\bsa\b/.test(t)) return 'SA';
  if (/tasmania|\btas\b/.test(t)) return 'TAS';
  if (/northern territory|\bnt\b/.test(t)) return 'NT';
  if (/australian capital territory|\bact\b/.test(t)) return 'ACT';
  return '';
}

export async function pointQuery(cfg: AbsCfg, lng: number, lat: number): Promise<Record<string, any> | null> {
  const p = new URLSearchParams({
    where: '1=1',
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: cfg.fields || '*',
    returnGeometry: 'false',
    resultRecordCount: '1',
    f: 'json',
  });
  const j = await getJson(`${cfg.url}/query?${p}`, null, 16000);
  return j?.features?.[0]?.attributes ?? null;
}

/** Label under the map head. Silent on failure: a missing label is a cosmetic
 *  gap, and an alert box over a pan is not. */
export async function jurisdictionAt(lng: number, lat: number): Promise<Jurisdiction | null> {
  try {
    const [ste, lga, poa] = await Promise.all([
      pointQuery(ABS.states, lng, lat).catch(() => null),
      pointQuery(LGA_CFG, lng, lat).catch(() => null),
      pointQuery(ABS.poa, lng, lat).catch(() => null),
    ]);
    const state =
      String(pick(ste, ['STE_NAME_2021', 'state_name_2021']) ??
             pick(lga, ['STATE_NAME_2021']) ?? '');
    if (!state && !lga) return null;
    return {
      state,
      stateCode: stateCode(state),
      lga: String(pick(lga, ['LGA_NAME_2025']) ?? ''),
      lgaCode: String(pick(lga, ['LGA_CODE_2025']) ?? ''),
      postcode: String(pick(poa, ['POA_CODE_2021', 'POA_NAME_2021']) ?? ''),
    };
  } catch { return null; }
}

export const jurisdictionLabel = (j: Jurisdiction | null): string =>
  !j || !j.state ? 'Australia' : j.lga ? `${j.lga} — ${j.state}` : j.state;

/* ───────────────────────────────── zoning ─────────────────────────────────── */

type ZoneCfg = {
  agency: string; status: string; instrument: string;
  zoneUrl?: string; sourceUrl: string; minZoom: number;
};

/** One entry per jurisdiction, exactly as the single-file build carried them.
 *  QLD and NT have no state-wide queryable zoning service; that is a fact
 *  about the data, and it is reported as such rather than papered over. */
export const ZONING: Record<string, ZoneCfg> = {
  NSW: {
    agency: 'NSW Department of Planning, Housing and Infrastructure',
    status: 'Official NSW Planning Portal live GIS',
    instrument: 'Environmental Planning Instrument / Local Environmental Plan',
    zoneUrl: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Principal_Planning/MapServer/19',
    sourceUrl: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Principal_Planning/MapServer/19',
    minZoom: 9,
  },
  VIC: {
    agency: 'Victorian Department of Transport and Planning',
    status: 'Official VicPlan live GIS',
    instrument: 'Victoria Planning Provisions / Local Planning Scheme',
    zoneUrl: 'https://plan-gis.mapshare.vic.gov.au/arcgis/rest/services/Planning/Vicplan_PlanningSchemeZones/MapServer/0',
    sourceUrl: 'https://plan-gis.mapshare.vic.gov.au/arcgis/rest/services/Planning/Vicplan_PlanningSchemeZones/MapServer/0',
    minZoom: 9,
  },
  QLD: {
    agency: 'Relevant Queensland local government',
    status: 'Queensland has no single state-wide council-zoning service; zoning is resolved per council',
    instrument: 'Relevant Local Government Planning Scheme',
    sourceUrl: 'https://www.planning.qld.gov.au/planning-framework/plan-making/local-planning/local-planning-schemes',
    minZoom: 9,
  },
  WA: {
    agency: 'WA Department of Planning, Lands and Heritage',
    status: 'Official WA planning GIS; reuse subject to DPLH service terms',
    instrument: 'Local Planning Scheme',
    zoneUrl: 'https://espatial.dplh.wa.gov.au/hosting/rest/services/LocalPlanningSchemes_v07/MapServer/1',
    sourceUrl: 'https://espatial.dplh.wa.gov.au/hosting/rest/services/LocalPlanningSchemes_v07/MapServer/1',
    minZoom: 9,
  },
  SA: {
    agency: 'SA Department for Housing and Urban Development',
    status: 'Official current Planning and Design Code GIS',
    instrument: 'Planning and Design Code (PDI Act 2016)',
    zoneUrl: 'https://location.sa.gov.au/server6/rest/services/ePlanningPublic/CurrentPDC_wmas/MapServer/114',
    sourceUrl: 'https://location.sa.gov.au/LMS/Reports/ReportMetadata.aspx?p_no=2545&pu=y',
    minZoom: 9,
  },
  TAS: {
    agency: 'Tasmanian Planning Commission / LIST',
    status: 'Official authorised electronic Tasmanian Planning Scheme map',
    instrument: 'Tasmanian Planning Scheme / Local Provisions Schedule',
    zoneUrl: 'https://services.thelist.tas.gov.au/arcgis/rest/services/Public/PlanningOnline/MapServer/13',
    sourceUrl: 'https://services.thelist.tas.gov.au/arcgis/rest/services/Public/PlanningOnline/MapServer/13',
    minZoom: 9,
  },
  NT: {
    agency: 'NT Department of Lands, Planning and Environment',
    status: 'NT zoning is published, but exposes no stable live query service for this integration',
    instrument: 'Northern Territory Planning Scheme 2020',
    sourceUrl: 'https://www.ntlis.nt.gov.au/metadata/export_data?metadata_id=2DBCB7711FD706B6E040CD9B0F274EFE&type=html',
    minZoom: 9,
  },
  ACT: {
    agency: 'ACT Territory Planning Authority',
    status: 'Official ACT Territory Plan live GIS',
    instrument: 'Territory Plan',
    zoneUrl: 'https://services1.arcgis.com/E5n4f1VY84i0xSjy/arcgis/rest/services/ACTGOV_TP_LAND_USE_ZONE/FeatureServer/1',
    sourceUrl: 'https://services1.arcgis.com/E5n4f1VY84i0xSjy/arcgis/rest/services/ACTGOV_TP_LAND_USE_ZONE/FeatureServer/1',
    minZoom: 9,
  },
};

type QldProvider = {
  key: string; match: RegExp; kind: 'arcgis' | 'ods'; agency: string;
  instrument: string; zoneUrl?: string; dataset?: string; minZoom: number;
};

export const QLD_PROVIDERS: QldProvider[] = [
  { key: 'brisbane', match: /brisbane/i, kind: 'ods', agency: 'Brisbane City Council',
    instrument: 'Brisbane City Plan 2014', dataset: 'cp14-zoning-overlay', minZoom: 10 },
  { key: 'gold-coast', match: /gold coast/i, kind: 'arcgis', agency: 'City of Gold Coast',
    instrument: 'Gold Coast City Plan V13',
    zoneUrl: 'https://maps1.goldcoast.qld.gov.au/arcgis/rest/services/City_Plan_V13_Zone/MapServer/6', minZoom: 9 },
  { key: 'sunshine-coast', match: /sunshine coast/i, kind: 'arcgis', agency: 'Sunshine Coast Council',
    instrument: 'Sunshine Coast Planning Scheme 2014',
    zoneUrl: 'https://geoimage.scc.qld.gov.au/arcgis/rest/services/PlanningCadastre/PlanningScheme_SunshineCoast_Zoning_SCC/MapServer/5', minZoom: 9 },
  { key: 'moreton-bay', match: /moreton bay/i, kind: 'arcgis', agency: 'City of Moreton Bay',
    instrument: 'City of Moreton Bay Planning Scheme',
    zoneUrl: 'https://services-ap1.arcgis.com/152ojN3Ts9H3cdtl/arcgis/rest/services/ZM_Zones_WebMercator_OpenData/FeatureServer/0', minZoom: 9 },
  { key: 'logan', match: /\blogan\b/i, kind: 'arcgis', agency: 'Logan City Council',
    instrument: 'Logan Planning Scheme 2015 v9.2',
    zoneUrl: 'https://services5.arcgis.com/ZUCWDRj8F77Xo351/ArcGIS/rest/services/Zones_V9_2_WFL1/FeatureServer/4', minZoom: 9 },
  { key: 'redland', match: /redland/i, kind: 'arcgis', agency: 'Redland City Council',
    instrument: 'Redland City Plan v14',
    zoneUrl: 'https://services7.arcgis.com/VGRM775aS3HJEeB7/ArcGIS/rest/services/Current_Version_14_City_Plan_Zones_and_Overlays/FeatureServer/44', minZoom: 9 },
  { key: 'toowoomba', match: /toowoomba/i, kind: 'arcgis', agency: 'Toowoomba Regional Council',
    instrument: 'Toowoomba Regional Planning Scheme',
    zoneUrl: 'https://maps.tr.qld.gov.au/arcgis/rest/services/External/External_PlanningScheme/MapServer/170', minZoom: 9 },
  { key: 'rockhampton', match: /rockhampton/i, kind: 'arcgis', agency: 'Rockhampton Regional Council',
    instrument: 'Rockhampton Region Planning Scheme',
    zoneUrl: 'https://services-ap1.arcgis.com/hx2J5p82likyGt5G/ArcGIS/rest/services/Land_Use_Zones/FeatureServer/0', minZoom: 9 },
  { key: 'scenic-rim', match: /scenic rim/i, kind: 'arcgis', agency: 'Scenic Rim Regional Council',
    instrument: 'Scenic Rim Planning Scheme 2020',
    zoneUrl: 'https://esriprod.scenicrim.qld.gov.au/arcgis/rest/services/PlanningXchange_base/MapServer/7', minZoom: 9 },
];

export type ZoneCategory =
  | 'residential' | 'commercial' | 'industrial' | 'rural'
  | 'conservation' | 'recreation' | 'infrastructure' | 'special' | 'other';

export function zoningCategory(code: unknown, name: unknown): ZoneCategory {
  const t = `${code ?? ''} ${name ?? ''}`.toLowerCase();
  if (/mixed|centre|center|commercial|business|activity|main street|city|employment/.test(t)) return 'commercial';
  if (/industrial|industry|resource extraction/.test(t)) return 'industrial';
  if (/residential|dwelling|neighbourhood|neighborhood|housing|living|township/.test(t)) return 'residential';
  if (/rural|agric|horticulture|primary production|pastoral/.test(t)) return 'rural';
  if (/conservation|environment|landscape|nature|bushland|coastal/.test(t)) return 'conservation';
  if (/recreation|open space|park|golf/.test(t)) return 'recreation';
  if (/transport|road|rail|utility|utilities|infrastructure|port|airport/.test(t)) return 'infrastructure';
  if (/community|special|particular|commonwealth|designated/.test(t)) return 'special';
  return 'other';
}

export const ZONE_COLOR: Record<ZoneCategory, string> = {
  residential: '#F4B8B8', commercial: '#AFCDE5', industrial: '#C9B4DD',
  rural: '#DEC9A5', conservation: '#BFD7B5', recreation: '#AEE0BD',
  infrastructure: '#C9CED6', special: '#E9D99A', other: '#D9DEE5',
};

/** Field names differ per jurisdiction — verified against a live response from
 *  each service, not inferred from the layer name. */
function zoneAttrs(sc: string, a: Record<string, any>, providerKey = '') {
  let code: any = '', name: any = '', sub: any = '';
  if (sc === 'NSW') { code = pick(a, ['SYM_CODE']); name = pick(a, ['LAY_CLASS', 'LABEL']); }
  else if (sc === 'VIC') { code = pick(a, ['ZONE_CODE']); name = pick(a, ['ZONE_DESCRIPTION', 'ZONE_CODE_GROUP_LABEL']); }
  else if (sc === 'WA') { code = pick(a, ['LABEL', 'ZONE_CATEGORY']); name = pick(a, ['ZONE_RESOLVED', 'ZONE', 'LABEL_DESC']); }
  else if (sc === 'SA') { code = pick(a, ['VALUE', 'ZONE']); name = pick(a, ['NAME', 'ZONE_MEANING', 'DESCRIPTION']); }
  else if (sc === 'TAS') { code = pick(a, ['ZONE_ABB', 'ZONE_NO']); name = pick(a, ['ZONE']); }
  else if (sc === 'ACT') { code = pick(a, ['LAND_USE_ZONE_CODE_ID']); name = pick(a, ['DESCRIPTION', 'LAND_USE_POLICY_DESC']); }
  else if (sc === 'QLD') {
    switch (providerKey) {
      case 'brisbane':
        code = pick(a, ['zone_code']); name = pick(a, ['lvl2_zone', 'lvl1_zone']);
        sub = pick(a, ['zone_prec_desc', 'zone_prec']); break;
      case 'gold-coast':
        code = pick(a, ['ZONE_CODE']); name = pick(a, ['ZONE', 'LVL1_ZONE']);
        sub = pick(a, ['ZONE_PRECINCT']); break;
      case 'sunshine-coast':
        code = pick(a, ['ZONE_CODE', 'CODE']); name = pick(a, ['LABEL', 'DESCRIPT', 'HEADING']);
        sub = pick(a, ['PRECINCT', 'LABEL2']); break;
      case 'moreton-bay':
        code = pick(a, ['ZONE_CODE', 'ZONE']); name = pick(a, ['LVL2_ZONE', 'LVL1_ZONE', 'ZONE']);
        sub = pick(a, ['ZONE_PREC', 'ZONE_PRECINCT']); break;
      case 'logan':
        code = pick(a, ['Zone_Code', 'ZONE_CODE']); name = pick(a, ['Zone']); break;
      case 'redland':
        code = pick(a, ['QPP_Zone']); name = pick(a, ['QPP_Description']);
        sub = pick(a, ['QPP_Precinct']); break;
      case 'toowoomba':
        code = pick(a, ['ZONE_CODE', 'Zone_Code']); name = pick(a, ['TRPS_Zones', 'Previous_Designation', 'ZONE']);
        sub = pick(a, ['Precinct', 'PRECINCT']); break;
      case 'rockhampton':
        code = pick(a, ['Zone_prefix', 'ZONE_CODE', 'GISREF']); name = pick(a, ['Zone_Lable', 'Zone', 'DESCRIPTION']);
        sub = pick(a, ['Split_Zone', 'Former_PS_Precinct']); break;
      case 'scenic-rim':
        code = pick(a, ['ZONE_CODE', 'zone_new']); name = pick(a, ['EPlan_TxtZ', 'New_Zone_A']);
        sub = pick(a, ['EPlan_TxtP', 'ZONE_PREC_']); break;
    }
  }
  return {
    code: String(code ?? '').trim(),
    name: String(name ?? '').trim(),
    sub: String(sub ?? '').trim(),
  };
}

function odsGeometry(shape: any): any {
  if (!shape) return null;
  if (shape.type === 'Feature') return shape.geometry ?? null;
  if (shape.type && shape.coordinates) return shape;
  return null;
}

async function brisbaneZoning(bbox: Box, max = 1200): Promise<GeoJson> {
  const p = new URLSearchParams({ dataset: 'cp14-zoning-overlay', rows: String(max) });
  p.set('geofilter.bbox', `${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]}`);
  const j = await getJson(`https://data.brisbane.qld.gov.au/api/records/1.0/search/?${p}`, 'zoning-bne', 16000);
  const features: GeoFeature[] = [];
  for (const r of j?.records ?? []) {
    const fields = r?.fields ?? {};
    const geometry = odsGeometry(fields.geo_shape ?? r.geometry);
    if (geometry) features.push({ type: 'Feature', geometry, properties: fields });
  }
  return { type: 'FeatureCollection', features };
}

/* ─────────────────────────── overlay loading (vector) ─────────────────────── */

export type OverlayResult = {
  key: OverlayKey;
  geojson: GeoJson;
  /** Human-readable provenance for the chip tooltip and the status line. */
  note: string;
};

/** Resolves which planning service answers for the current map centre. */
export async function zoningProviderFor(lng: number, lat: number, known?: Jurisdiction | null) {
  const j = known?.stateCode ? known : await jurisdictionAt(lng, lat);
  const sc = j?.stateCode ?? '';
  if (!sc) throw new Error('Planning jurisdiction could not be resolved for this location');
  const base = ZONING[sc];
  if (!base) throw new Error(`No planning adapter for ${sc}`);
  if (sc === 'QLD') {
    const p = QLD_PROVIDERS.find((x) => x.match.test(j?.lga ?? ''));
    if (!p) {
      throw new Error(
        `Queensland zoning is council-by-council and no adapter is configured for ${j?.lga || 'this LGA'}. ` +
        'Queensland publishes no state-wide zoning service.',
      );
    }
    return { sc, providerKey: p.key, agency: p.agency, instrument: p.instrument,
             zoneUrl: p.zoneUrl, kind: p.kind, minZoom: p.minZoom, lga: j?.lga ?? '' };
  }
  if (!base.zoneUrl) throw new Error(base.status);
  return { sc, providerKey: '', agency: base.agency, instrument: base.instrument,
           zoneUrl: base.zoneUrl, kind: 'arcgis' as const, minZoom: base.minZoom, lga: j?.lga ?? '' };
}

export async function loadZoning(bbox: Box, z: number, centre: { lng: number; lat: number }, known?: Jurisdiction | null): Promise<OverlayResult> {
  const p = await zoningProviderFor(centre.lng, centre.lat, known);
  const data = p.kind === 'ods'
    ? await brisbaneZoning(bbox, 1200)
    : await arcGeojson(p.zoneUrl!, bbox, z, 1400, 'zoning');
  for (const f of data.features) {
    const z0 = zoneAttrs(p.sc, f.properties ?? {}, p.providerKey);
    const cat = zoningCategory(z0.code, z0.name);
    f.properties = {
      ...(f.properties ?? {}),
      __category: cat,
      __label: [z0.code, z0.name].filter(Boolean).join(' — ') || 'Zoning',
      __sub: z0.sub,
      __authority: p.agency,
      __scheme: p.instrument,
    };
  }
  const where = p.lga ? `${p.agency} — ${p.lga}` : p.agency;
  return { key: 'zoning', geojson: data, note: `${where} — ${data.features.length} zoning areas` };
}

/** The ABS chips. Choropleth layers get `__value`/`__label` stamped on so the
 *  styler and the popup do not have to re-learn each service's field names. */
export async function loadAbsOverlay(key: 'states' | 'poa' | 'population' | 'age' | 'income', bbox: Box, z: number): Promise<OverlayResult> {
  const cfg = key === 'age' ? await ensureAgeConfig() : ABS[key];
  const data = await getJson(queryUrl(cfg, bbox, z), `layer-${key}`, 16000);
  if (data?.type !== 'FeatureCollection') throw new Error('GIS service did not return GeoJSON');
  const fc = data as GeoJson;
  for (const f of fc.features) {
    const props = f.properties ?? {};
    if (cfg.field) {
      const v = Number(pick(props, [cfg.field]));
      f.properties = {
        ...props,
        __value: Number.isFinite(v) ? v : null,
        __label: String(pick(props, [cfg.nameField ?? 'sa2_name_2021', 'sa2_name_2021']) ?? ''),
      };
    } else {
      f.properties = {
        ...props,
        __label: String(pick(props, ['state_name_2021', 'STE_NAME_2021', 'poa_code_2021', 'POA_CODE_2021']) ?? ''),
      };
    }
  }
  const unit = key === 'population' ? 'SA2 areas' : key === 'age' ? 'SA2 areas'
    : key === 'income' ? 'SA2 areas' : key === 'poa' ? 'postal areas' : 'areas';
  return { key, geojson: fc, note: `${OVERLAY_META[key].source} — ${fc.features.length} ${unit}` };
}

/* ────────────────────────────── choropleth ramp ───────────────────────────── */

const PALETTE: Record<string, string[]> = {
  population: ['#E8F1FA', '#B8D2EA', '#7FA9D2', '#477FBA', '#174F8F'],
  age:        ['#FFF4D6', '#F6D49B', '#E7AD62', '#C97832', '#8B451F'],
  income:     ['#F1ECF7', '#D8C9E8', '#B59ACF', '#8769B1', '#5C3E8A'],
};
const STROKE: Record<string, string> = {
  population: '#356A9D', age: '#9A582D', income: '#6A4B91',
};

const hex = (c: string) => [
  parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16),
];
const mix = (a: string, b: string, t: number) => {
  const [r1, g1, b1] = hex(a), [r2, g2, b2] = hex(b);
  const f = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgb(${f(r1, r2)},${f(g1, g2)},${f(b1, b2)})`;
};

/** Quantile breaks, so a single outlier SA2 does not flatten the whole ramp
 *  into one colour — which is exactly what an equal-interval ramp does to
 *  Australian population data. */
export function buildRamp(key: string, features: GeoFeature[]) {
  const vals = features
    .map((f) => Number(f.properties?.__value))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  const q = (p: number) => (vals.length
    ? vals[Math.max(0, Math.min(vals.length - 1, Math.floor((vals.length - 1) * p)))]
    : 0);
  const cuts = [q(0.05), q(0.28), q(0.5), q(0.72), q(0.95)];
  const pal = PALETTE[key] ?? PALETTE.population;
  const stops: [number, string][] = [];
  cuts.forEach((v, i) => {
    if (!Number.isFinite(v)) return;
    if (!stops.length || v > stops[stops.length - 1][0]) stops.push([v, pal[i]]);
  });
  return {
    stroke: STROKE[key] ?? '#607D9F',
    color(value: unknown): string {
      const v = Number(value);
      if (!stops.length) return pal[2];
      if (!Number.isFinite(v)) return pal[0];
      if (v <= stops[0][0]) return stops[0][1];
      for (let i = 1; i < stops.length; i++) {
        if (v <= stops[i][0]) {
          const span = stops[i][0] - stops[i - 1][0] || 1;
          return mix(stops[i - 1][1], stops[i][1], (v - stops[i - 1][0]) / span);
        }
      }
      return stops[stops.length - 1][1];
    },
    range: vals.length ? ([vals[0], vals[vals.length - 1]] as [number, number]) : null,
  };
}

/* ─────────────────────────────── contours ─────────────────────────────────── */

/** Terrarium RGB elevation tiles — the same source the single-file build fed
 *  into maplibre-contour. Leaflet has no contour engine, so the tiles are
 *  decoded here and marching-squares'd into polylines; the thresholds and the
 *  paint below are the legacy values verbatim so the two builds draw the same
 *  lines at the same zooms. */
const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

/** [minor, major] interval in metres, by map zoom. */
const CONTOUR_STEPS: Record<number, [number, number]> = {
  9: [100, 500], 10: [50, 250], 11: [25, 100], 12: [20, 100],
  13: [10, 50], 14: [5, 25], 15: [5, 25],
};
export const CONTOUR_PAINT = { color: '#675744', major: 1.35, minor: 0.72, opacity: 0.82 };

const worldPx = (z: number) => 256 * 2 ** z;
const lngToPx = (lng: number, z: number) => ((lng + 180) / 360) * worldPx(z);
const latToPx = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  const t = Math.tan(r), s = Math.log(t + Math.sqrt(t * t + 1));
  return (worldPx(z) * (1 - s / Math.PI)) / 2;
};
const pxToLng = (px: number, z: number) => (px / worldPx(z)) * 360 - 180;
const pxToLat = (py: number, z: number) => {
  const t = 1 - (2 * py) / worldPx(z);
  return (Math.atan(Math.sinh(Math.PI * t)) * 180) / Math.PI;
};

const demCache = new Map<string, Float32Array>();

/** REFRESH DATA drops everything cached so the next query really does go to
 *  the service. Without this the button would re-render stale bytes and look
 *  like it worked. */
export function clearOverlayCaches() {
  demCache.clear();
  ageCfg = null;
}

/** Decoded through a canvas, which needs the CORS header — verified present
 *  (`Access-Control-Allow-Origin: *`) on elevation-tiles-prod. Without
 *  crossOrigin the canvas taints and getImageData throws. */
function loadDemTile(z: number, x: number, y: number): Promise<Float32Array> {
  const id = `${z}/${x}/${y}`;
  const hit = demCache.get(id);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const done = (e: string) => reject(new Error(e));
    img.onerror = () => done(`elevation tile ${id} failed to load`);
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 256; c.height = 256;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (!ctx) return done('canvas 2d context unavailable');
        ctx.drawImage(img, 0, 0, 256, 256);
        const d = ctx.getImageData(0, 0, 256, 256).data;
        const out = new Float32Array(256 * 256);
        for (let i = 0, p = 0; i < out.length; i++, p += 4) {
          out[i] = d[p] * 256 + d[p + 1] + d[p + 2] / 256 - 32768;
        }
        demCache.set(id, out);
        resolve(out);
      } catch (e: any) { done(String(e?.message ?? e)); }
    };
    img.src = TERRARIUM.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  });
}

export type ContourLine = { level: 0 | 1; elevation: number; latlngs: [number, number][] };

/** Marching squares over a stitched DEM grid.
 *  Segments are chained into polylines before they leave here: one Leaflet
 *  layer per two-point segment would be tens of thousands of layers for a
 *  single hilly viewport, and the map would stop responding. */
export async function loadContours(
  bounds: { west: number; south: number; east: number; north: number },
  mapZoom: number,
): Promise<{ lines: ContourLine[]; note: string }> {
  const z = Math.max(9, Math.min(15, Math.round(mapZoom)));
  const [minor, major] = CONTOUR_STEPS[z] ?? CONTOUR_STEPS[12];

  // Terrarium is published to z15, but the underlying DEM is ~30 m SRTM, so
  // 13 is where extra tiles stop buying extra detail. Step down until the
  // requested window needs a sane number of tiles.
  let demZ = Math.min(13, Math.max(8, z));
  let x0 = 0, x1 = 0, y0 = 0, y1 = 0;
  let west = 0, north = 0, east = 0, south = 0;
  for (;;) {
    west = lngToPx(bounds.west, demZ); east = lngToPx(bounds.east, demZ);
    north = latToPx(bounds.north, demZ); south = latToPx(bounds.south, demZ);
    x0 = Math.floor(west / 256); x1 = Math.floor(east / 256);
    y0 = Math.floor(north / 256); y1 = Math.floor(south / 256);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) <= 20 || demZ <= 8) break;
    demZ--;
  }
  const nx = x1 - x0 + 1, ny = y1 - y0 + 1;

  const tiles = await Promise.all(
    Array.from({ length: nx * ny }, (_, i) =>
      loadDemTile(demZ, x0 + (i % nx), y0 + Math.floor(i / nx)).catch(() => null)),
  );
  if (tiles.every((t) => !t)) throw new Error('no elevation tiles could be read');

  // The grid is clipped to the REQUESTED WINDOW, not to whole tiles. Sampling
  // whole tiles pulls in terrain — and ocean bathymetry — far outside the
  // view, which both wastes the line budget and reports an elevation range
  // that has nothing to do with what is on screen.
  const originX = Math.floor(west), originY = Math.floor(north);
  const spanX = Math.max(2, Math.ceil(east) - originX), spanY = Math.max(2, Math.ceil(south) - originY);
  const stride = Math.max(1, Math.round(Math.sqrt((spanX * spanY) / 160000)));
  const gw = Math.floor(spanX / stride), gh = Math.floor(spanY / stride);
  const grid = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    const py = originY + gy * stride, ty = Math.floor(py / 256) - y0, iy = ((py % 256) + 256) % 256;
    for (let gx = 0; gx < gw; gx++) {
      const px = originX + gx * stride, tx = Math.floor(px / 256) - x0, ix = ((px % 256) + 256) % 256;
      const tile = (tx >= 0 && tx < nx && ty >= 0 && ty < ny) ? tiles[ty * nx + tx] : null;
      grid[gy * gw + gx] = tile ? tile[iy * 256 + ix] : NaN;
    }
  }

  // Terrarium is noisy: a Sydney tile that runs 0–170 m carried ~40 spike
  // pixels reading -741 m and +2170 m, all in one small cluster. Left in,
  // they stretch the threshold range over three kilometres of elevation that
  // does not exist and bury the real terrain under thousands of junk rings.
  // Spikes are dropped, and the range comes from percentiles rather than
  // min/max so a survivor cannot set the scale.
  let killed = 0;
  for (let gy = 1; gy < gh - 1; gy++) {
    for (let gx = 1; gx < gw - 1; gx++) {
      const i = gy * gw + gx, v = grid[i];
      if (!Number.isFinite(v)) continue;
      const n = [grid[i - 1], grid[i + 1], grid[i - gw], grid[i + gw]].filter(Number.isFinite) as number[];
      if (n.length < 3) continue;
      n.sort((a, b) => a - b);
      const med = n[Math.floor(n.length / 2)];
      if (Math.abs(v - med) > 150) { grid[i] = NaN; killed++; }
    }
  }

  // A light 3×3 mean over a ~30 m source. Without it every threshold shatters
  // into hundreds of two-point specks where the DEM quantisation crosses the
  // level, which reads as static rather than as terrain. The smoothing is well
  // inside the source's own accuracy, and this layer is screening either way.
  const smooth = Float32Array.from(grid);
  for (let gy = 1; gy < gh - 1; gy++) {
    for (let gx = 1; gx < gw - 1; gx++) {
      const i = gy * gw + gx;
      if (!Number.isFinite(grid[i])) continue;
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const v = grid[i + dy * gw + dx];
        if (Number.isFinite(v)) { sum += v; n++; }
      }
      smooth[i] = sum / n;
    }
  }
  grid.set(smooth);

  const sorted = Array.from(grid).filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length < 16) throw new Error('elevation tiles held no usable data');
  const at = (p: number) => sorted[Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * p)))];
  const lo = at(0.002), hi = at(0.998);
  if (!(hi > lo)) throw new Error('the elevation here is flat within the contour interval');

  const toLatLng = (gx: number, gy: number): [number, number] => [
    pxToLat(originY + gy * stride, demZ),
    pxToLng(originX + gx * stride, demZ),
  ];

  const lines: ContourLine[] = [];
  const first = Math.ceil(lo / minor) * minor;
  let budget = 4000;
  for (let t = first; t <= hi && budget > 0; t += minor) {
    const segs = marchingSquares(grid, gw, gh, t);
    if (!segs.length) continue;
    const level: 0 | 1 = Math.abs(t % major) < 1e-6 ? 1 : 0;
    for (const path of chain(segs)) {
      // two- and three-point fragments are single-cell specks, not contours
      if (path.length < 4) continue;
      lines.push({ level, elevation: t, latlngs: path.map(([gx, gy]) => toLatLng(gx, gy)) });
      if (--budget <= 0) break;
    }
  }
  return {
    lines,
    note: `${lines.length} contour lines, ${minor} m interval (${major} m index) — ` +
          `${Math.round(lo)}–${Math.round(hi)} m from terrarium z${demZ}` +
          (killed ? `, ${killed} spike samples discarded` : '') +
          '. ~30 m SRTM, screening only — not survey grade.',
  };
}

type Seg = [number, number, number, number]; // x1,y1,x2,y2 in grid space

function marchingSquares(g: Float32Array, w: number, h: number, t: number): Seg[] {
  const out: Seg[] = [];
  const at = (x: number, y: number) => g[y * w + x];
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const tl = at(x, y), tr = at(x + 1, y), br = at(x + 1, y + 1), bl = at(x, y + 1);
      // A hole in the DEM must not invent a contour through it.
      if (!Number.isFinite(tl) || !Number.isFinite(tr) || !Number.isFinite(br) || !Number.isFinite(bl)) continue;
      const idx = (tl > t ? 8 : 0) | (tr > t ? 4 : 0) | (br > t ? 2 : 0) | (bl > t ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const top = (): [number, number] => [x + (t - tl) / (tr - tl || 1e-9), y];
      const right = (): [number, number] => [x + 1, y + (t - tr) / (br - tr || 1e-9)];
      const bottom = (): [number, number] => [x + (t - bl) / (br - bl || 1e-9), y + 1];
      const left = (): [number, number] => [x, y + (t - tl) / (bl - tl || 1e-9)];
      const push = (a: [number, number], b: [number, number]) => out.push([a[0], a[1], b[0], b[1]]);
      switch (idx) {
        case 1: case 14: push(left(), bottom()); break;
        case 2: case 13: push(bottom(), right()); break;
        case 3: case 12: push(left(), right()); break;
        case 4: case 11: push(top(), right()); break;
        case 6: case 9:  push(top(), bottom()); break;
        case 7: case 8:  push(left(), top()); break;
        case 5: {
          // saddle — the centre decides which way the two strands run
          const c = (tl + tr + br + bl) / 4;
          if (c > t) { push(left(), top()); push(bottom(), right()); }
          else { push(left(), bottom()); push(top(), right()); }
          break;
        }
        case 10: {
          const c = (tl + tr + br + bl) / 4;
          if (c > t) { push(left(), bottom()); push(top(), right()); }
          else { push(left(), top()); push(bottom(), right()); }
          break;
        }
      }
    }
  }
  return out;
}

/** Greedy endpoint chaining. Endpoints are quantised to 1e-3 of a grid cell,
 *  which is far finer than the DEM and far coarser than float noise. */
function chain(segs: Seg[]): [number, number][][] {
  const key = (x: number, y: number) => `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
  const ends = new Map<string, number[]>();
  const used = new Uint8Array(segs.length);
  segs.forEach((s, i) => {
    for (const k of [key(s[0], s[1]), key(s[2], s[3])]) {
      const arr = ends.get(k);
      if (arr) arr.push(i); else ends.set(k, [i]);
    }
  });
  const take = (k: string, exclude: number): number => {
    for (const i of ends.get(k) ?? []) if (i !== exclude && !used[i]) return i;
    return -1;
  };
  const paths: [number, number][][] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const s = segs[i];
    const path: [number, number][] = [[s[0], s[1]], [s[2], s[3]]];
    // extend forward, then backward
    for (const dir of [1, 0]) {
      for (;;) {
        const tip = dir ? path[path.length - 1] : path[0];
        const n = take(key(tip[0], tip[1]), -1);
        if (n < 0) break;
        used[n] = 1;
        const q = segs[n];
        const a: [number, number] = [q[0], q[1]], b: [number, number] = [q[2], q[3]];
        const next = key(a[0], a[1]) === key(tip[0], tip[1]) ? b : a;
        if (dir) path.push(next); else path.unshift(next);
        if (path.length > 4000) break;
      }
    }
    paths.push(path);
  }
  return paths;
}

/* ────────────────────────────── saved sites ───────────────────────────────── */

export type SavedSite = {
  id: string; name: string; areaM2: number; created: string;
  rings: [number, number][][];              // Leaflet order, [lat,lng]
  centre: [number, number];
};

const STORE = 'ausfeas.sites.v1';

/** localStorage, deliberately: a saved site is a working note on one machine,
 *  not a record of tenure, and it must survive a reload without a backend. */
export function listSavedSites(): SavedSite[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORE);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? (arr as SavedSite[]).filter((s) => s?.rings?.length) : [];
  } catch { return []; }
}

function write(list: SavedSite[]) {
  try { window.localStorage.setItem(STORE, JSON.stringify(list.slice(0, 60))); }
  catch { /* private mode or quota — the map keeps working, the list does not persist */ }
}

export function saveSite(site: Omit<SavedSite, 'id' | 'created'>): SavedSite[] {
  const rec: SavedSite = {
    ...site,
    id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    created: new Date().toISOString(),
  };
  const next = [rec, ...listSavedSites()];
  write(next);
  return next;
}

export function deleteSavedSite(id: string): SavedSite[] {
  const next = listSavedSites().filter((s) => s.id !== id);
  write(next);
  return next;
}

export const formatSiteDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short' });
};
