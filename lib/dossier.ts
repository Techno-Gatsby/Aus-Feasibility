/**
 * The site dossier: every field the E1 lead-one-pager and D1 active-to-potential
 * skills ask for, fetched from live NSW government services, so an analyst
 * handed a JLL information memorandum is checking figures rather than retyping
 * them.
 *
 * THREE RULES RUN THROUGH EVERY FUNCTION HERE
 *
 * 1. Never invent a value. Both skills say "do NOT invent data" and D1 asks for
 *    a threshold verdict; the temptation is to reach a verdict by assuming a
 *    GRV. `unavailable` is a legitimate answer and is returned with the reason.
 *    A verdict of UNKNOWN that names its missing input is worth more to a BD
 *    team than a PASS built on a number nobody chose.
 *
 * 2. An empty query result is not proof of absence. "Heritage: Nil" is a
 *    POSITIVE finding an IM states deliberately, so absence is reported only
 *    after confirming the layer answered AND that it maps items nearby. If the
 *    layer errors, the answer is "could not determine", not "none".
 *
 * 3. Controls are arrays. This site has two zonings, two FSRs and two height
 *    limits because the Sinclair Street frontage and the Pacific Highway
 *    frontage carry different controls. Collapsing them to one number
 *    misstates the developable envelope by thousands of square metres — the
 *    single most damaging error this endpoint could make — so every control is
 *    a list, with the square metres of the site sitting under each.
 */

import { atPoint } from '@/lib/arcgis';
import { stateOf, metres, type Pt } from '@/lib/geo';
import {
  SA2_LAYER, readSa2, fetchPopulation, fetchMedians,
  type Sa2, type Figure,
} from '@/lib/abs';
import {
  amalgamate, arcQuery, lotAtPoint, lotsByIdentifier, lotsInPolygon,
  overlapFraction, polygonAreaM2, polygonQuery, ringsOf, splitAreaByControl,
  touches, withGeometry,
  type Amalgamation, type Lot, type Ring,
} from '@/lib/amalgamate';

/* ------------------------------------------------------------- provenance */

/** Both skills demand it in as many words: "Flag clearly which fields came
 *  from the E1 / supporting docs vs which were estimated or researched." */
export type Confidence =
  /** read directly off an authoritative published dataset */
  | 'measured'
  /** computed from measured inputs by a stated method */
  | 'derived'
  /** supplied by the caller (the IM, the agent, the analyst) */
  | 'supplied'
  /** we asked and could not get it — the reason is in `note` */
  | 'unavailable';

export type Provenance = {
  source: string;
  url: string | null;
  layer: string | null;
  confidence: Confidence;
  note?: string;
  retrieved: string;
};

export type Field<T> = { value: T | null; provenance: Provenance };

const NOW = () => new Date().toISOString();

const field = <T,>(
  value: T | null,
  p: Omit<Provenance, 'retrieved'>,
): Field<T> => ({ value, provenance: { ...p, retrieved: NOW() } });

const unavailable = <T,>(source: string, url: string | null, layer: string | null, why: string): Field<T> =>
  field<T>(null, { source, url, layer, confidence: 'unavailable', note: why });

/* ----------------------------------------------------------------- sources */

const SIX = 'https://maps.six.nsw.gov.au/arcgis/rest/services/public';
const EPI = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning';
const EPA = 'https://mapprod2.environment.nsw.gov.au/arcgis/rest/services/EPA';
const PPP = `${EPI}/Planning_Portal_Principal_Planning/MapServer`;
const HAZ = `${EPI}/Planning_Portal_Hazard/MapServer`;
const VAL = `${SIX}/Valuation/MapServer`;

/**
 * Layer numbers, and the ones that look right and are not.
 *
 * Heritage was the gap this module was written to close. NSW publishes it in
 * the principal planning service at ids 15, 16 and 221, and only two of the
 * three can be asked a question:
 *   15  Heritage                       GROUP LAYER — replies 400 "Invalid or
 *                                      missing input parameters" to any query.
 *                                      Verified live 2026-08-19.
 *   16  EPI Heritage                   Feature Layer, polygon. Heritage items
 *                                      and conservation areas listed in the
 *                                      LEP. H_NAME, SIG (Local / State).
 *   221 State Heritage Register        Feature Layer, polygon. The curtilage
 *       Curtilage                      of SHR-listed items. ITEMNAME, LISTING.
 * Wiring 15 and trusting its silence would report every heritage-listed site
 * in New South Wales as clear.
 */
const L = {
  lep:      { url: `${PPP}/8`,   name: 'Local Environmental Plan (layer 8)' },
  fsr:      { url: `${PPP}/11`,  name: 'Floor Space Ratio Map (layer 11)' },
  height:   { url: `${PPP}/14`,  name: 'Height of Buildings Map (layer 14)' },
  heritEpi: { url: `${PPP}/16`,  name: 'EPI Heritage (layer 16)' },
  zoning:   { url: `${PPP}/19`,  name: 'Land Zoning Map (layer 19)' },
  lotSize:  { url: `${PPP}/22`,  name: 'Minimum Lot Size (layer 22)' },
  heritShr: { url: `${PPP}/221`, name: 'State Heritage Register Curtilage (layer 221)' },
  bushfire: { url: `${HAZ}/229`, name: 'Bush Fire Prone Land (layer 229)' },
  flood:    { url: `${HAZ}/230`, name: 'Flood Planning (layer 230)' },
  landslide:{ url: `${HAZ}/232`, name: 'Landslide Risk (layer 232)' },
  biodiv:   { url: `${EPI}/BiodiversityValuesMap/MapServer/1`, name: 'Biodiversity Values (layer 1)' },
  contam:   { url: `${EPA}/Contaminated_land_notified_sites/MapServer/0`, name: 'Contaminated land, notified sites (layer 0)' },
  cadastre: { url: `${SIX}/NSW_Cadastre/MapServer/9`, name: 'NSW Cadastre lot (layer 9)' },
  suburb:   { url: `${SIX}/NSW_Administrative_Boundaries/MapServer/0`, name: 'Suburb (layer 0)' },
  lga:      { url: `${SIX}/NSW_Administrative_Boundaries/MapServer/1`, name: 'Local Government Area (layer 1)' },
  poi:      { url: `${SIX}/NSW_POI/MapServer/0`, name: 'Points of Interest (layer 0)' },
} as const;

const SRC = {
  eplanning: 'NSW Planning Portal (ePlanning spatial services)',
  six: 'NSW Spatial Services (SIX Maps)',
  vg: 'NSW Valuer General (via SIX Valuation service)',
  epa: 'NSW EPA',
  abs: 'Australian Bureau of Statistics',
};

/**
 * Valuation service tiers. Layers 0, 4 and 8 are GROUP layers and reply 400.
 * The real layers are split by urbanity and the tiers must line up across the
 * three families or a propid from one tier is looked up in another and simply
 * is not there.
 *   sales    1 urban   2 semi-rural   3 rural   (POINT geometry)
 *   values   5 urban   6 semi-rural   7 rural   (POINT geometry)
 *   boundary 9 urban  10 semi-rural  11 rural   (POLYGON — the only one that
 *                                                answers a spatial query)
 */
const VAL_TIERS = [
  { key: 'U', boundary: 9,  values: 5, sales: 1 },
  { key: 'S', boundary: 10, values: 6, sales: 2 },
  { key: 'R', boundary: 11, values: 7, sales: 3 },
] as const;

/* --------------------------------------------------------------- utilities */

/** ' $2,790,000' -> 2790000. The Valuer General publishes money as a string
 *  with a leading space, a dollar sign and commas; Number() gives NaN. */
const money = (v: any): number | null => {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return isFinite(n) && n !== 0 ? n : null;
};

/** '139.1 square metres' | '1.331 hectares' -> square metres. The same field
 *  carries both units, so casting is wrong by a factor of 10,000. */
const parseArea = (v: any): number | null => {
  if (!v) return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  if (!isFinite(n) || n <= 0) return null;
  return /hect/i.test(String(v)) ? n * 10000 : n;
};

const tidy = (v: any): string | null => {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  return s.length ? s : null;
};

const round = (n: number | null | undefined, dp = 1): number | null =>
  n == null || !isFinite(n) ? null : Number(n.toFixed(dp));

const centroidOf = (rings: Ring[]): Pt | null => {
  const pts = rings.flat();
  if (!pts.length) return null;
  return {
    lng: pts.reduce((s, p) => s + p[0], 0) / pts.length,
    lat: pts.reduce((s, p) => s + p[1], 0) / pts.length,
  };
};

/* ------------------------------------------------------------------ inputs */

export type DossierInput = {
  lat?: number;
  lng?: number;
  /** Title references from the IM, any spelling: '2/DP202169' or '2//DP202169'. */
  lots?: string[];
  /** A drawn boundary, ArcGIS ring order [lng, lat]. */
  rings?: Ring[];
  /** When a point is all we have, also pull in every lot that adjoins it.
   *  Off by default: guessing at a site boundary is worse than reporting one
   *  lot and saying so. */
  expandAdjacent?: boolean;

  /** The IM's own figures, for comparison. Never overwrite a measured value —
   *  a disagreement is reported as a disagreement. */
  imSiteAreaM2?: number;
  imGfaM2?: number;
  imUnits?: number;

  /** D1 threshold inputs. Absent means UNKNOWN, not zero. */
  leadType?: 'vertical' | 'horizontal';
  grvAud?: number;
  ppsmAud?: number;
  unitCount?: number;
  lotCount?: number;
  marginPct?: number;
  turnaroundMonths?: number;
  /** Optional: derive a GRV from an achievable rate the analyst nominates. */
  salePricePerSqmNsa?: number;
  nsaEfficiency?: number;
  /** Only used to indicate a unit count, and only together with nsaEfficiency.
   *  Both are assumptions and are echoed back as such. */
  avgUnitSizeSqm?: number;
};

/* --------------------------------------------------------- site resolution */

export type SiteResolution = {
  method: 'lots' | 'polygon' | 'point' | 'point+adjacent';
  amalgamation: Amalgamation | null;
  unresolvedLots: string[];
  rejected: { lotId: string; overlap: number }[];
  error: string | null;
  /** 400 when the caller asked a question we cannot answer (wrong state, no
   *  input); 502 when an upstream service failed. Conflating the two sends an
   *  operator hunting a fault that is in the request. */
  errorStatus?: 400 | 502;
  warnings: string[];
};

export async function resolveSite(input: DossierInput): Promise<SiteResolution> {
  const warnings: string[] = [];

  if (input.lots?.length) {
    const { lots, unresolved, error } = await lotsByIdentifier(input.lots);
    if (error) return { method: 'lots', amalgamation: null, unresolvedLots: input.lots, rejected: [], error, warnings };
    if (unresolved.length)
      warnings.push(
        `${unresolved.length} of ${input.lots.length} title references did not match a current `
        + `NSW cadastre lot: ${unresolved.join(', ')}. A title can fail to match because the plan `
        + `has been superseded, because it is a strata plan (SP) held in a different layer, or `
        + `because of a transcription error. It is NOT counted in the site area.`,
      );
    return {
      method: 'lots',
      amalgamation: lots.length ? amalgamate(lots) : null,
      unresolvedLots: unresolved, rejected: [], error: null, warnings,
    };
  }

  if (input.rings?.length) {
    const { lots, rejected, error } = await lotsInPolygon(input.rings);
    if (error) return { method: 'polygon', amalgamation: null, unresolvedLots: [], rejected: [], error, warnings };
    if (rejected.length)
      warnings.push(
        `${rejected.length} lot(s) touched the drawn boundary but less than 15% of each fell `
        + `inside it, so they were excluded as adjoining rather than part of the site: `
        + `${rejected.map((r) => `${r.lotId} (${Math.round(r.overlap * 100)}%)`).join(', ')}.`,
      );
    return { method: 'polygon', amalgamation: lots.length ? amalgamate(lots) : null, unresolvedLots: [], rejected, error: null, warnings };
  }

  if (input.lat != null && input.lng != null) {
    // Check the jurisdiction BEFORE asking the NSW cadastre. It answers a
    // point in Melbourne or London with an empty feature array, exactly as it
    // answers a point in a Sydney road reserve — and "no lot here" would then
    // be reported for a site that is simply in another state.
    const st = stateOf({ lat: input.lat, lng: input.lng });
    if (st !== 'NSW')
      return {
        method: 'point', amalgamation: null, unresolvedLots: [], rejected: [],
        errorStatus: 400,
        error: st
          ? `That point is in ${st}, and this dossier queries the NSW cadastre and the NSW planning `
            + 'portal only. Australia publishes no national planning dataset; each state runs its own '
            + 'service with its own layer numbers and field names, and only NSW publishes heritage, '
            + 'FSR and height as queryable feature layers.'
          : 'That point is outside Australia.',
        warnings,
      };

    const { lot, error } = await lotAtPoint(input.lng, input.lat);
    if (error) return { method: 'point', amalgamation: null, unresolvedLots: [], rejected: [], error, warnings };
    if (!lot)
      return {
        method: 'point', amalgamation: null, unresolvedLots: [], rejected: [], error: null,
        warnings: [...warnings, 'No cadastre lot covers that point. It may fall in a road reserve, '
          + 'a waterway or a gap between parcels — the cadastre does not tile the state completely.'],
      };

    if (!input.expandAdjacent) {
      warnings.push(
        `Resolved from a single point, so this is ONE lot (${lot.lotId}, `
        + `${Math.round(lot.areaM2)} sqm). Development sites are routinely several lots — the `
        + `Bruce Street Collective in Wollstonecraft is six — so treat this as a starting `
        + `position, not the site. Pass the title schedule as "lots", draw the boundary as `
        + `"rings", or set expandAdjacent=true.`,
      );
      return { method: 'point', amalgamation: amalgamate([lot]), unresolvedLots: [], rejected: [], error: null, warnings };
    }

    // Everything sharing a boundary with the pinned lot. A neighbourhood, not
    // a site — offered as a candidate assembly to be confirmed, never as fact.
    const b = lot.rings.flat();
    const pad = 0.0006; // ~60 m
    const hull: Ring[] = [[
      [Math.min(...b.map((p) => p[0])) - pad, Math.min(...b.map((p) => p[1])) - pad],
      [Math.max(...b.map((p) => p[0])) + pad, Math.min(...b.map((p) => p[1])) - pad],
      [Math.max(...b.map((p) => p[0])) + pad, Math.max(...b.map((p) => p[1])) + pad],
      [Math.min(...b.map((p) => p[0])) - pad, Math.max(...b.map((p) => p[1])) + pad],
    ]];
    const near = await lotsInPolygon(hull, 0.01);
    // First-order adjacency only: lots that SHARE A BOUNDARY with the pinned
    // lot. Taking everything inside the padded box instead returns the whole
    // city block — 39 lots and 18,000 sqm at Bruce Street — which is not a
    // site by any reading.
    const keep = near.lots.filter((l) => l.lotId === lot.lotId || touches(l.rings, lot.rings));
    warnings.push(
      `expandAdjacent returned ${keep.length - 1} lot(s) sharing a boundary with ${lot.lotId}. `
      + `These are NEIGHBOURS, not a confirmed assembly — nothing in the cadastre says which of `
      + `them are for sale together, and it reaches only one lot deep, so a longer assembly is `
      + `cut short. Confirm against the IM title schedule before quoting the total.`,
    );
    return { method: 'point+adjacent', amalgamation: amalgamate(keep.length ? keep : [lot]), unresolvedLots: [], rejected: near.rejected, error: null, warnings };
  }

  return {
    method: 'point', amalgamation: null, unresolvedLots: [], rejected: [],
    errorStatus: 400,
    error: 'Provide lat and lng, a list of lots, or a polygon (rings).', warnings,
  };
}

/* ------------------------------------------------------- planning controls */

export type ControlBand<T> = {
  value: T;
  label: string;
  /** Square metres of the site under this band. This is what makes two FSRs
   *  usable rather than merely alarming. */
  areaM2: number;
  areaSharePct: number;
  epi: string | null;
  amendment: string | null;
  clause: string | null;
};

export type Controls = {
  zoning: Field<ControlBand<string>[]>;
  fsr: Field<ControlBand<number>[]>;
  height: Field<ControlBand<number>[]>;
  minLotSize: Field<ControlBand<number>[]>;
  lep: Field<string[]>;
  lga: Field<string>;
  suburb: Field<{ name: string; postcode: number | null }>;
  /** Site area with NO polygon of that control over it. A real state — a gap
   *  in the control layer — and reportable, not something to fold silently
   *  into whichever band happens to be first. */
  unmapped: { fsrM2: number; heightM2: number; zoningM2: number; minLotSizeM2: number };
};

type BandSpec = {
  valueOf: (a: any) => any;
  labelOf: (a: any) => string;
};

async function bandsFor(
  layer: { url: string; name: string },
  rings: Ring[],
  spec: BandSpec,
): Promise<{ bands: ControlBand<any>[]; unmappedM2: number; error: string | null }> {
  const r = await polygonQuery(layer.url, rings, { ...withGeometry, resultRecordCount: '60' });
  if (r.error) return { bands: [], unmappedM2: 0, error: r.error };
  if (!r.features.length) return { bands: [], unmappedM2: polygonAreaM2(rings), error: null };

  const controls = r.features
    .map((f: any, i: number) => ({ key: String(i), value: f.attributes, rings: ringsOf(f) }))
    .filter((c) => c.rings.length);

  const split = splitAreaByControl(rings, controls);
  const total = split.totalM2 || 1;

  // Two polygons can carry the SAME control value — an LEP amendment often
  // splits one band into several shapes. They are merged so the caller sees
  // "2.5 over 1,117 sqm", not the same number twice with half the area each.
  const merged = new Map<string, ControlBand<any>>();
  for (const z of split.zones) {
    const a = z.value;
    const v = spec.valueOf(a);
    if (v == null || v === '') continue;
    const key = String(v);
    const cur = merged.get(key);
    if (cur) { cur.areaM2 += z.areaM2; continue; }
    merged.set(key, {
      value: v,
      label: spec.labelOf(a),
      areaM2: z.areaM2,
      areaSharePct: 0,
      epi: tidy(a.EPI_NAME),
      amendment: tidy(a.AMENDMENT),
      clause: tidy(a.LEGIS_REF_CLAUSE),
    });
  }
  const bands = [...merged.values()]
    .map((b) => ({ ...b, areaM2: round(b.areaM2, 0)!, areaSharePct: round((b.areaM2 / total) * 100, 1)! }))
    .sort((x, y) => y.areaM2 - x.areaM2);

  return { bands, unmappedM2: round(split.unmappedM2, 0)!, error: null };
}

const bandField = <T,>(
  res: { bands: ControlBand<any>[]; error: string | null },
  layer: { url: string; name: string },
  what: string,
): Field<ControlBand<T>[]> => {
  if (res.error)
    return unavailable(SRC.eplanning, layer.url, layer.name,
      `The ${what} layer did not answer (${res.error}). This is NOT a finding of "no control" — `
      + 'the question was never successfully asked.');
  if (!res.bands.length)
    return field<ControlBand<T>[]>([], {
      source: SRC.eplanning, url: layer.url, layer: layer.name, confidence: 'measured',
      note: `The layer answered and no ${what} polygon is mapped over this site. In NSW that is `
          + 'normal for some controls (an LEP need not map an FSR everywhere) and means the '
          + 'control is set by other clauses, not that it is unlimited.',
    });
  return field(res.bands as ControlBand<T>[], {
    source: SRC.eplanning, url: layer.url, layer: layer.name, confidence: 'measured',
    note: res.bands.length > 1
      ? `${res.bands.length} distinct ${what} bands apply across this site. The square metres under `
        + 'each are given; do not collapse them to one figure.'
      : undefined,
  });
};

export async function fetchControls(rings: Ring[], at: Pt): Promise<Controls> {
  const pointGeom = {
    geometry: JSON.stringify({ x: at.lng, y: at.lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', outFields: '*',
  };

  const [zoning, fsr, height, lotSize, lep, lgaR, subR] = await Promise.all([
    bandsFor(L.zoning, rings, {
      valueOf: (a) => tidy(a.SYM_CODE) ?? tidy(a.LABEL),
      labelOf: (a) => tidy(a.LAY_CLASS) ?? tidy(a.LABEL) ?? 'zone',
    }),
    bandsFor(L.fsr, rings, {
      valueOf: (a) => (isFinite(Number(a.FSR)) && Number(a.FSR) > 0 ? Number(a.FSR) : null),
      labelOf: (a) => `${a.FSR}:1`,
    }),
    bandsFor(L.height, rings, {
      valueOf: (a) => {
        const m = Number(a.MAX_B_H_M ?? a.MAX_B_H);
        return isFinite(m) && m > 0 ? m : null;
      },
      labelOf: (a) => `${a.MAX_B_H_M ?? a.MAX_B_H} ${tidy(a.UNITS) ?? 'm'}`,
    }),
    bandsFor(L.lotSize, rings, {
      valueOf: (a) => (isFinite(Number(a.LOT_SIZE)) && Number(a.LOT_SIZE) > 0 ? Number(a.LOT_SIZE) : null),
      labelOf: (a) => `${a.LOT_SIZE} ${tidy(a.UNITS) ?? 'sqm'}`,
    }),
    polygonQuery(L.lep.url, rings),
    arcQuery(L.lga.url, pointGeom),
    arcQuery(L.suburb.url, pointGeom),
  ]);

  const epiNames = Array.from(new Set(
    [...(zoning.bands ?? []), ...(fsr.bands ?? []), ...(height.bands ?? [])]
      .map((b) => b.epi).filter((x): x is string => !!x)
      .concat(lep.features.map((f: any) => tidy(f.attributes?.EPI_NAME)).filter((x): x is string => !!x)),
  ));

  const lgaName = tidy(lgaR.features[0]?.attributes?.lganame);
  const subName = tidy(subR.features[0]?.attributes?.suburbname);

  return {
    zoning: bandField<string>(zoning, L.zoning, 'zoning'),
    fsr: bandField<number>(fsr, L.fsr, 'floor space ratio'),
    height: bandField<number>(height, L.height, 'height of buildings'),
    minLotSize: bandField<number>(lotSize, L.lotSize, 'minimum lot size'),
    lep: epiNames.length
      ? field(epiNames, { source: SRC.eplanning, url: L.lep.url, layer: L.lep.name, confidence: 'measured' })
      : unavailable(SRC.eplanning, L.lep.url, L.lep.name,
          lep.error ?? 'No environmental planning instrument was named on any control polygon here.'),
    lga: lgaName
      ? field(lgaName, { source: SRC.six, url: L.lga.url, layer: L.lga.name, confidence: 'measured' })
      : unavailable(SRC.six, L.lga.url, L.lga.name, lgaR.error ?? 'No LGA polygon covers this point.'),
    suburb: subName
      ? field({ name: subName, postcode: Number(subR.features[0]?.attributes?.postcode) || null },
          { source: SRC.six, url: L.suburb.url, layer: L.suburb.name, confidence: 'measured' })
      : unavailable(SRC.six, L.suburb.url, L.suburb.name, subR.error ?? 'No suburb polygon covers this point.'),
    unmapped: {
      fsrM2: fsr.unmappedM2, heightM2: height.unmappedM2, zoningM2: zoning.unmappedM2,
      minLotSizeM2: lotSize.unmappedM2,
    },
  };
}

/* ---------------------------------------------------------------- heritage */

export type HeritageItem = {
  name: string | null;
  significance: string | null;
  listing: string | null;
  register: 'LEP (EPI Heritage)' | 'State Heritage Register curtilage';
  address: string | null;
  id: string | null;
};

export type Heritage = {
  /** true = an item or conservation area covers the site.
   *  false = the layers answered and nothing covers it (a real "Nil").
   *  null  = we could not establish either way. */
  affected: boolean | null;
  statement: string;
  onSite: HeritageItem[];
  nearby: { count: number; radiusM: number; examples: HeritageItem[] } | null;
  layers: { name: string; url: string; answered: boolean; onSite: number; error: string | null }[];
  provenance: Provenance;
};

const heritageItem = (a: any, register: HeritageItem['register']): HeritageItem => ({
  name: tidy(a.H_NAME) ?? tidy(a.ITEMNAME),
  significance: tidy(a.SIG),
  listing: tidy(a.LISTING) ?? tidy(a.LAY_CLASS),
  register,
  address: tidy(a.ADDRESS),
  id: tidy(a.H_ID) ?? tidy(a.HOITEMID),
});

/**
 * Heritage, wired for the first time here.
 *
 * "Heritage: Nil" is a positive finding — an IM states it because a heritage
 * item or a conservation area is the difference between a 12,000 sqm scheme
 * and a facade retention argument. So a nil is only asserted when both feature
 * layers ANSWERED, and it is qualified by whether they map anything in the
 * surrounding kilometre. A layer that returns nothing everywhere is broken,
 * not reassuring; a layer that returns eight items next door and none here is
 * a genuine, quotable clear result.
 */
export async function fetchHeritage(rings: Ring[], at: Pt, radiusM = 1000): Promise<Heritage> {
  const dLat = radiusM / 111320;
  const dLng = dLat / Math.max(0.2, Math.cos(at.lat * Math.PI / 180));
  const box = {
    geometry: JSON.stringify({
      xmin: at.lng - dLng, ymin: at.lat - dLat, xmax: at.lng + dLng, ymax: at.lat + dLat,
      spatialReference: { wkid: 4326 },
    }),
    geometryType: 'esriGeometryEnvelope', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', outFields: '*', resultRecordCount: '50',
  };

  const specs = [
    { layer: L.heritEpi, register: 'LEP (EPI Heritage)' as const },
    { layer: L.heritShr, register: 'State Heritage Register curtilage' as const },
  ];

  const results = await Promise.all(specs.map(async (s) => {
    const [on, around] = await Promise.all([
      polygonQuery(s.layer.url, rings, { resultRecordCount: '50' }),
      arcQuery(s.layer.url, box),
    ]);
    return { ...s, on, around };
  }));

  const layers = results.map((r) => ({
    name: r.layer.name, url: r.layer.url,
    answered: r.on.error === null,
    onSite: r.on.features.length,
    error: r.on.error,
  }));

  const onSite = results.flatMap((r) => r.on.features.map((f: any) => heritageItem(f.attributes, r.register)));
  const anyFailed = layers.some((l) => !l.answered);
  const allAnswered = layers.every((l) => l.answered);

  const nearbyFeatures = results.flatMap((r) =>
    r.around.error ? [] : r.around.features.map((f: any) => heritageItem(f.attributes, r.register)));
  const nearby = results.every((r) => r.around.error === null)
    ? { count: nearbyFeatures.length, radiusM, examples: nearbyFeatures.slice(0, 6) }
    : null;

  let affected: boolean | null;
  let statement: string;
  if (onSite.length) {
    affected = true;
    statement =
      `${onSite.length} heritage record(s) cover this site: `
      + onSite.map((i) => `${i.name ?? 'unnamed item'} (${i.register}${i.significance ? `, ${i.significance}` : ''})`).join('; ')
      + '. Confirm the mapped extent against the LEP heritage map before assuming the whole site is affected.';
  } else if (anyFailed) {
    affected = null;
    statement =
      'Heritage could not be determined. '
      + layers.filter((l) => !l.answered).map((l) => `${l.name} did not answer (${l.error})`).join('; ')
      + '. Absence of a result from a layer that did not respond is not a clear finding.';
  } else if (allAnswered && nearby && nearby.count === 0) {
    affected = false;
    statement =
      'No heritage item or conservation area is mapped over this site. Both NSW heritage layers '
      + `answered, but neither maps anything within ${radiusM} m either, so the clear result cannot `
      + 'be corroborated by nearby coverage. Treat as likely nil and confirm against the LEP '
      + 'heritage map sheet.';
  } else {
    affected = false;
    statement =
      'Heritage: Nil. Neither the LEP heritage layer nor the State Heritage Register curtilage '
      + `maps anything over this site, and both layers do map ${nearby?.count ?? 0} item(s) within `
      + `${radiusM} m, which confirms they are live and cover this area rather than silently empty.`;
  }

  return {
    affected, statement, onSite, nearby, layers,
    provenance: {
      source: SRC.eplanning,
      url: `${PPP}/16`,
      layer: 'EPI Heritage (16) and State Heritage Register Curtilage (221). Layer 15 "Heritage" is '
           + 'a GROUP layer and rejects every query with HTTP 400, so it is deliberately not used.',
      confidence: affected === null ? 'unavailable' : 'measured',
      retrieved: NOW(),
    },
  };
}

/* ----------------------------------------------------------------- hazards */

export type HazardFinding = {
  name: string;
  present: boolean | null;
  detail: string | null;
  statement: string;
  provenance: Provenance;
};

const HAZARDS = [
  { key: 'flood', name: 'Flood planning area', layer: L.flood, detail: (a: any) => tidy(a.LAY_CLASS) },
  { key: 'bushfire', name: 'Bush fire prone land', layer: L.bushfire, detail: (a: any) => tidy(a.Category) },
  { key: 'landslide', name: 'Landslide risk', layer: L.landslide, detail: (a: any) => tidy(a.LAY_CLASS) },
  { key: 'biodiversity', name: 'Biodiversity values (offset scheme trigger)', layer: L.biodiv, detail: () => null },
  { key: 'contamination', name: 'Contaminated land, notified site', layer: L.contam, detail: (a: any) => tidy(a.SiteName ?? a.SITE_NAME) },
] as const;

export async function fetchHazards(rings: Ring[]): Promise<Record<string, HazardFinding>> {
  const out: Record<string, HazardFinding> = {};
  await Promise.all(HAZARDS.map(async (h) => {
    const r = await polygonQuery(h.layer.url, rings, { resultRecordCount: '20' });
    const src = h.key === 'contamination' ? SRC.epa : SRC.eplanning;
    if (r.error) {
      out[h.key] = {
        name: h.name, present: null, detail: null,
        statement: `${h.name}: could not be determined — the layer did not answer (${r.error}). `
                 + 'This is not a clear result.',
        provenance: { source: src, url: h.layer.url, layer: h.layer.name, confidence: 'unavailable', note: r.error, retrieved: NOW() },
      };
      return;
    }
    const present = r.features.length > 0;
    out[h.key] = {
      name: h.name,
      present,
      detail: present ? (h.detail as any)(r.features[0].attributes) : null,
      statement: present
        ? `${h.name}: mapped over the site.`
        : `${h.name}: no polygon mapped over this site. The layer answered; that is an absence of `
          + 'mapping, which for most NSW hazard layers is the intended way to read "not affected", '
          + 'but it is not a certificate.',
      provenance: { source: src, url: h.layer.url, layer: h.layer.name, confidence: 'measured', retrieved: NOW() },
    };
  }));
  return out;
}

/* -------------------------------------------- addresses, values and sales */

export type PropertyRecord = {
  propId: number;
  address: string | null;
  zoneDescription: string | null;
  statedAreaM2: number | null;
  /** Valuer General land value series, most recent first. */
  landValues: { at: string | null; value: number }[];
  lastSale: { price: number | null; date: string | null; dealing: string | null } | null;
  overlapWithSite: number;
};

export type Valuation = {
  properties: Field<PropertyRecord[]>;
  totalLandValue: Field<{ amount: number; asAt: string | null; propertyCount: number }>;
  landValueRatePerM2: Field<number>;
  comparableSales: Field<{ address: string | null; price: number; date: string | null; areaM2: number | null; ratePerM2: number | null }[]>;
  comparablesRadiusM: number;
  excludedNeighbours: { propId: number; address: string | null; overlap: number }[];
};

export async function fetchValuation(
  rings: Ring[], at: Pt, siteAreaM2: number, urbanity: string | null,
): Promise<Valuation> {
  const order = [
    ...VAL_TIERS.filter((t) => t.key === (urbanity ?? 'U')),
    ...VAL_TIERS.filter((t) => t.key !== (urbanity ?? 'U')),
  ];

  let tier = order[0];
  let bounds = await polygonQuery(`${VAL}/${tier.boundary}`, rings, { ...withGeometry, resultRecordCount: '80' });
  for (const t of order.slice(1)) {
    if (!bounds.error && bounds.features.length) break;
    tier = t;
    bounds = await polygonQuery(`${VAL}/${t.boundary}`, rings, { ...withGeometry, resultRecordCount: '80' });
  }

  const boundaryUrl = `${VAL}/${tier.boundary}`;
  if (bounds.error || !bounds.features.length) {
    return {
      properties: unavailable(SRC.vg, boundaryUrl, `Property boundary (layer ${tier.boundary})`,
        bounds.error ?? 'No Valuer General property boundary intersects this site.'),
      totalLandValue: unavailable(SRC.vg, boundaryUrl, null, 'No property boundary resolved, so no land value could be summed.'),
      landValueRatePerM2: unavailable(SRC.vg, boundaryUrl, null, 'No land value available for this site.'),
      comparableSales: unavailable(SRC.vg, `${VAL}/${tier.sales}`, null, 'Not attempted: the site did not resolve to a valuation property.'),
      comparablesRadiusM: 0, excludedNeighbours: [],
    };
  }

  // esriSpatialRelIntersects returns lots that merely TOUCH a shared edge. At
  // Bruce Street that pulls in 236 Pacific Highway and 45 Sinclair Street —
  // two adjoining properties that are not in the deal — and adds $26.8M of
  // somebody else's land value to the total. Keep only boundaries that are
  // mostly inside the site.
  const scored = bounds.features.map((f: any) => ({
    propId: Number(f.attributes?.propid),
    overlap: overlapFraction(ringsOf(f), rings),
  })).filter((x: any) => isFinite(x.propId));

  const kept = scored.filter((x: any) => x.overlap >= 0.5);
  const dropped = scored.filter((x: any) => x.overlap < 0.5);
  const ids = kept.map((x: any) => x.propId);

  if (!ids.length) {
    return {
      properties: unavailable(SRC.vg, boundaryUrl, `Property boundary (layer ${tier.boundary})`,
        'Valuation property boundaries touch this site but none lies mostly within it. The site '
        + 'boundary and the valuation boundary disagree; check the lots.'),
      totalLandValue: unavailable(SRC.vg, boundaryUrl, null, 'No property matched the site.'),
      landValueRatePerM2: unavailable(SRC.vg, boundaryUrl, null, 'No property matched the site.'),
      comparableSales: unavailable(SRC.vg, `${VAL}/${tier.sales}`, null, 'No property matched the site.'),
      comparablesRadiusM: 0,
      excludedNeighbours: dropped.map((d: any) => ({ propId: d.propId, address: null, overlap: round(d.overlap, 2)! })),
    };
  }

  const inList = `propid IN (${ids.join(',')})`;
  const pad = 0.0022; // ~250 m
  const compBox = {
    geometry: JSON.stringify({
      xmin: at.lng - pad, ymin: at.lat - pad, xmax: at.lng + pad, ymax: at.lat + pad,
      spatialReference: { wkid: 4326 },
    }),
    geometryType: 'esriGeometryEnvelope', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', outFields: '*', resultRecordCount: '80',
  };

  const [values, sales, comps, droppedAddr] = await Promise.all([
    arcQuery(`${VAL}/${tier.values}`, { where: inList, outFields: '*' }),
    arcQuery(`${VAL}/${tier.sales}`, { where: inList, outFields: '*' }),
    arcQuery(`${VAL}/${tier.sales}`, compBox),
    dropped.length
      ? arcQuery(`${VAL}/${tier.values}`, { where: `propid IN (${dropped.map((d: any) => d.propId).join(',')})`, outFields: '*' })
      : Promise.resolve({ features: [] as any[], exceeded: false, error: null }),
  ]);

  const saleFor = new Map<number, any>();
  for (const f of sales.features) saleFor.set(Number(f.attributes.propid), f.attributes);

  const properties: PropertyRecord[] = values.features.map((f: any) => {
    const a = f.attributes;
    const id = Number(a.propid);
    const s = saleFor.get(id);
    return {
      propId: id,
      address: tidy(a.address),
      zoneDescription: tidy(a.zone_desc),
      statedAreaM2: parseArea(a.prop_area),
      landValues: [1, 2, 3, 4, 5]
        .map((i) => ({ at: tidy(a[`val${i}_bd`]), value: money(a[`val${i}_lv`]) }))
        .filter((x): x is { at: string | null; value: number } => x.value != null),
      lastSale: s ? { price: money(s.price), date: tidy(s.sale_date), dealing: tidy(s.dealing) } : null,
      overlapWithSite: round(kept.find((k: any) => k.propId === id)?.overlap ?? 0, 2)!,
    };
  }).sort((a, b) => (a.address ?? '').localeCompare(b.address ?? ''));

  const latest = properties
    .map((p) => p.landValues[0])
    .filter((x): x is { at: string | null; value: number } => !!x);
  const totalLv = latest.reduce((s, x) => s + x.value, 0);
  const asAt = latest[0]?.at ?? null;
  const sameDate = latest.every((x) => x.at === asAt);

  const comparables = comps.features
    .map((f: any) => {
      const a = f.attributes;
      const price = money(a.price);
      const area = Number(a.area) > 0 ? Number(a.area) : null;
      return {
        address: tidy(a.bp_address) ?? [tidy(a.house_no), tidy(a.street), tidy(a.suburb)].filter(Boolean).join(' '),
        price: price as number,
        date: tidy(a.sale_date),
        areaM2: area,
        ratePerM2: price && area ? round(price / area, 0) : null,
      };
    })
    .filter((c: any) => c.price)
    .sort((a: any, b: any) => (b.price ?? 0) - (a.price ?? 0))
    .slice(0, 25);

  const droppedNames = new Map<number, string | null>();
  for (const f of droppedAddr.features) droppedNames.set(Number(f.attributes.propid), tidy(f.attributes.address));

  return {
    properties: field(properties, {
      source: SRC.vg, url: `${VAL}/${tier.values}`, layer: `Land value (layer ${tier.values})`,
      confidence: 'measured',
      note: 'Street addresses recovered from the Valuer General record for each constituent '
          + 'property. This is how the address line on the E1 one pager is assembled without '
          + 'retyping the IM.',
    }),
    totalLandValue: latest.length
      ? field({ amount: totalLv, asAt: sameDate ? asAt : null, propertyCount: latest.length }, {
          source: SRC.vg, url: `${VAL}/${tier.values}`, layer: `Land value (layer ${tier.values})`,
          confidence: 'derived',
          note: 'Sum of the latest Valuer General land value for each constituent property. The VG '
              + 'land value EXCLUDES structural improvements and is a statutory assessment for '
              + 'rating and land tax, not a market appraisal and not an asking price. It is a '
              + 'floor reference, not a GRV input.'
              + (sameDate ? '' : ' The constituent values are as at different base dates, so the sum mixes vintages.'),
        })
      : unavailable(SRC.vg, `${VAL}/${tier.values}`, null, 'No land value published for the matched properties.'),
    landValueRatePerM2: latest.length && siteAreaM2 > 0
      ? field(round(totalLv / siteAreaM2, 0), {
          source: SRC.vg, url: `${VAL}/${tier.values}`, layer: null, confidence: 'derived',
          note: 'Total VG land value divided by surveyed site area. This is a LAND rate. It is not '
              + 'the D1 PPSM, which is a sale price per square metre of net saleable area — the two '
              + 'differ by an order of magnitude and must never be compared to the $15,000 psm '
              + 'threshold.',
        })
      : unavailable(SRC.vg, `${VAL}/${tier.values}`, null, 'No land value or no site area.'),
    comparableSales: comps.error
      ? unavailable(SRC.vg, `${VAL}/${tier.sales}`, `Sales (layer ${tier.sales})`, comps.error)
      : field(comparables, {
          source: SRC.vg, url: `${VAL}/${tier.sales}`, layer: `Sales (layer ${tier.sales})`,
          confidence: 'measured',
          note: 'Recorded transactions within about 250 m. These are whole-property sales of mostly '
              + 'improved land; they are evidence for a land rate, not for an apartment PPSM. NSW '
              + 'publishes address, price and date free — Texas, by contrast, is a non-disclosure '
              + 'state with no public equivalent.',
        }),
    comparablesRadiusM: Math.round(pad * 111320),
    excludedNeighbours: dropped.map((d: any) => ({
      propId: d.propId, address: droppedNames.get(d.propId) ?? null, overlap: round(d.overlap, 2)!,
    })),
  };
}

/* ------------------------------------------------------------ 3S proximity */

export type Poi = { name: string; type: string; distanceM: number };
export type Proximity = {
  stations: Field<Poi[]>;
  schools: Field<Poi[]>;
  shopping: Field<Poi[]>;
  searchRadiusM: number;
};

const POI_GROUPS: Record<'stations' | 'schools' | 'shopping', string[]> = {
  stations: ['Railway Station', 'Metro Station', 'Light Rail Station', 'Bus Interchange', 'Ferry Wharf'],
  schools: ['Primary School', 'High School', 'Combined Primary-Secondary School', 'Infants School', 'Special School'],
  shopping: ['Shopping Centre', 'Shopping Complex', 'Retail Centre'],
};

/**
 * Slide 2 of the E1 deck. The skill reaches for a `places_search` tool; NSW
 * publishes the same thing itself, keyless, which is better provenance for a
 * document that goes to an investment committee.
 *
 * Two traps: the layer rejects a named outFields list (POI is one of the
 * layers that demands `*`), and an unfiltered envelope hits the 1,000-record
 * transfer limit long before it reaches the stations, so each group is asked
 * for by type.
 */
export async function fetchProximity(at: Pt, radiusM = 5000): Promise<Proximity> {
  const dLat = radiusM / 111320;
  const dLng = dLat / Math.max(0.2, Math.cos(at.lat * Math.PI / 180));
  const box = JSON.stringify({
    xmin: at.lng - dLng, ymin: at.lat - dLat, xmax: at.lng + dLng, ymax: at.lat + dLat,
    spatialReference: { wkid: 4326 },
  });

  const entries = await Promise.all(
    (Object.keys(POI_GROUPS) as (keyof typeof POI_GROUPS)[]).map(async (k) => {
      const r = await arcQuery(L.poi.url, {
        where: `poitype IN (${POI_GROUPS[k].map((t) => `'${t}'`).join(',')})`,
        geometry: box, geometryType: 'esriGeometryEnvelope', inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: '*', returnGeometry: 'true', outSR: '4326', resultRecordCount: '400',
      });
      if (r.error)
        return [k, unavailable<Poi[]>(SRC.six, L.poi.url, L.poi.name, r.error)] as const;
      const rows: Poi[] = r.features
        .filter((f: any) => isFinite(f?.geometry?.x) && isFinite(f?.geometry?.y))
        .map((f: any) => ({
          name: tidy(f.attributes.poiname) ?? 'unnamed',
          type: tidy(f.attributes.poitype) ?? '',
          distanceM: Math.round(metres(at, { lng: f.geometry.x, lat: f.geometry.y })),
        }))
        .filter((p: Poi) => p.distanceM <= radiusM)
        .sort((a: Poi, b: Poi) => a.distanceM - b.distanceM)
        .slice(0, 6);
      return [k, field(rows, {
        source: SRC.six, url: L.poi.url, layer: L.poi.name, confidence: 'measured',
        note: 'Straight-line distance from the site centroid, not walking or driving distance.',
      })] as const;
    }),
  );

  const map = Object.fromEntries(entries) as Record<keyof typeof POI_GROUPS, Field<Poi[]>>;
  return { ...map, searchRadiusM: radiusM };
}

/* ------------------------------------------------------------ demographics */

export type Micromarket = {
  sa2: Field<Sa2>;
  population: Field<Figure>;
  medianAge: Field<Figure>;
  medianPersonalIncomeWeekly: Field<Figure>;
  medianHouseholdIncomeWeekly: Field<Figure>;
  /** Whether the site sits in a Greater Capital City Statistical Area — the
   *  only part of D1's "metro / growth corridor" test a dataset can settle. */
  metro: Field<{ isGreaterCapitalCity: boolean; gccsa: string | null }>;
};

const ABS_DOC = 'https://data.api.abs.gov.au/rest/data';

export async function fetchMicromarket(at: Pt): Promise<Micromarket> {
  const geo = await atPoint(SA2_LAYER, { lat: at.lat, lng: at.lng });
  if (geo.error || !geo.features.length) {
    const why = geo.error ?? 'No ABS statistical area covers this point.';
    return {
      sa2: unavailable(SRC.abs, SA2_LAYER, 'ASGS2021 SA2', why),
      population: unavailable(SRC.abs, ABS_DOC, 'ABS_ANNUAL_ERP_ASGS2021', why),
      medianAge: unavailable(SRC.abs, ABS_DOC, 'C21_G02_SA2', why),
      medianPersonalIncomeWeekly: unavailable(SRC.abs, ABS_DOC, 'C21_G02_SA2', why),
      medianHouseholdIncomeWeekly: unavailable(SRC.abs, ABS_DOC, 'C21_G02_SA2', why),
      metro: unavailable(SRC.abs, SA2_LAYER, 'ASGS2021 SA2', why),
    };
  }

  const sa2 = readSa2(geo.features[0].attributes);
  if (!sa2) {
    const why = 'The ABS boundary service answered but carried no SA2 code for this point.';
    return {
      sa2: unavailable(SRC.abs, SA2_LAYER, 'ASGS2021 SA2', why),
      population: unavailable(SRC.abs, ABS_DOC, 'ABS_ANNUAL_ERP_ASGS2021', why),
      medianAge: unavailable(SRC.abs, ABS_DOC, 'C21_G02_SA2', why),
      medianPersonalIncomeWeekly: unavailable(SRC.abs, ABS_DOC, 'C21_G02_SA2', why),
      medianHouseholdIncomeWeekly: unavailable(SRC.abs, ABS_DOC, 'C21_G02_SA2', why),
      metro: unavailable(SRC.abs, SA2_LAYER, 'ASGS2021 SA2', why),
    };
  }

  const [pop, med] = await Promise.all([fetchPopulation(sa2.code), fetchMedians(sa2.code)]);
  const censusNote = 'ABS Census 2021 — four years old at the time of this request. Use it for '
                   + 'structure, not for current pricing.';

  const gccsa = sa2.gccsa;
  const isCapital = !!gccsa && /^Greater\s/i.test(gccsa);

  return {
    sa2: field(sa2, { source: SRC.abs, url: SA2_LAYER, layer: 'ASGS2021 SA2 (Edition 3)', confidence: 'measured' }),
    population: pop.figure
      ? field(pop.figure, { source: SRC.abs, url: ABS_DOC, layer: 'ABS_ANNUAL_ERP_ASGS2021', confidence: 'measured',
          note: 'Estimated Resident Population — the ABS current estimate, fresher than the Census count.' })
      : unavailable(SRC.abs, ABS_DOC, 'ABS_ANNUAL_ERP_ASGS2021', pop.error ?? 'No ERP observation for this SA2.'),
    medianAge: med.age
      ? field(med.age, { source: SRC.abs, url: ABS_DOC, layer: 'C21_G02_SA2', confidence: 'measured', note: censusNote })
      : unavailable(SRC.abs, ABS_DOC, 'C21_G02_SA2', med.error ?? 'Not published for this SA2.'),
    medianPersonalIncomeWeekly: med.personal
      ? field(med.personal, { source: SRC.abs, url: ABS_DOC, layer: 'C21_G02_SA2', confidence: 'measured', note: censusNote })
      : unavailable(SRC.abs, ABS_DOC, 'C21_G02_SA2', med.error ?? 'Not published for this SA2.'),
    medianHouseholdIncomeWeekly: med.household
      ? field(med.household, { source: SRC.abs, url: ABS_DOC, layer: 'C21_G02_SA2', confidence: 'measured', note: censusNote })
      : unavailable(SRC.abs, ABS_DOC, 'C21_G02_SA2', med.error ?? 'Not published for this SA2.'),
    metro: field({ isGreaterCapitalCity: isCapital, gccsa }, {
      source: SRC.abs, url: SA2_LAYER, layer: 'ASGS2021 SA2 (GCCSA attribute)', confidence: 'measured',
      note: 'Settles only the metropolitan half of the D1 location test. "Growth corridor" and '
          + '"PDA" are policy designations with no single dataset behind them in NSW and remain '
          + 'a human judgement.',
    }),
  };
}

/* -------------------------------------------------------- development envelope */

export type Envelope = {
  siteAreaM2: Field<number>;
  /** Reported ALONGSIDE the surveyed figure whenever the caller supplies the
   *  IM's number and the two disagree. Neither is silently preferred. */
  areaDiscrepancy: {
    surveyedM2: number; imM2: number; differenceM2: number; differencePct: number; note: string;
  } | null;
  potentialGfaM2: Field<number>;
  gfaByBand: { fsr: number; areaM2: number; gfaM2: number }[];
  gfaComparison: { imM2: number; derivedM2: number; differencePct: number; note: string } | null;
  indicativeUnits: Field<number>;
  assumptions: string[];
};

export function buildEnvelope(
  amal: Amalgamation,
  controls: Controls,
  input: DossierInput,
): Envelope {
  const assumptions: string[] = [];
  const area = amal.totalAreaM2;

  const siteAreaM2 = field(round(area, 0), {
    source: SRC.six, url: L.cadastre.url, layer: L.cadastre.name, confidence: 'measured',
    note: `Geodesic area of ${amal.lots.length} cadastre lot(s) on GDA94/WGS84. This is the `
        + 'SURVEYED figure. The layer\'s shape_Area field is projected (Web Mercator) and reads '
        + `about 45% high at this latitude; it is not used. `
        + (amal.statedAreaLotCount
            ? `The layer publishes its own stated area for ${amal.statedAreaLotCount} of `
              + `${amal.lots.length} lot(s), totalling ${Math.round(amal.statedAreaM2 ?? 0)} sqm over those lots.`
            : 'The layer publishes no stated area for any of these lots, which is normal for urban NSW.'),
  });

  let areaDiscrepancy: Envelope['areaDiscrepancy'] = null;
  if (input.imSiteAreaM2 && input.imSiteAreaM2 > 0) {
    const diff = area - input.imSiteAreaM2;
    const pct = (diff / input.imSiteAreaM2) * 100;
    areaDiscrepancy = {
      surveyedM2: round(area, 0)!, imM2: input.imSiteAreaM2,
      differenceM2: round(diff, 0)!, differencePct: round(pct, 2)!,
      note: Math.abs(pct) <= 1
        ? 'The cadastre and the information memorandum agree to within 1%. Both figures are '
          + 'reported; neither is discarded.'
        : 'The cadastre and the information memorandum DISAGREE. Both figures are reported as '
          + 'stated. The cadastre is the surveyed boundary; an IM area may be a title area, may '
          + 'exclude a splay or road widening, or may include land not in the title schedule. '
          + 'Resolve against a title search before it reaches a feasibility.',
    };
  }

  const fsrBands = controls.fsr.value ?? [];
  const gfaByBand = fsrBands.map((b) => ({
    fsr: b.value, areaM2: b.areaM2, gfaM2: round(b.areaM2 * b.value, 0)!,
  }));
  const gfaTotal = gfaByBand.reduce((s, b) => s + b.gfaM2, 0);

  const potentialGfaM2: Field<number> = fsrBands.length
    ? field(round(gfaTotal, 0), {
        source: SRC.eplanning, url: L.fsr.url, layer: L.fsr.name, confidence: 'derived',
        note: 'Sum over each mapped FSR band of (site area under that band x that FSR). Where two '
            + 'FSRs apply, applying either one to the whole site is wrong in both directions — '
            + 'this splits the area between them. It is the maximum MAPPED floor space only: it '
            + 'takes no account of setbacks, overshadowing, apartment design guide separation, '
            + 'site isolation, or of bonuses available under the Housing SEPP and the affordable '
            + 'housing provisions, which can lift it. It is an envelope, not a yield.'
            + (controls.unmapped.fsrM2 > 5
                ? ` ${Math.round(controls.unmapped.fsrM2)} sqm of the site has no FSR polygon over `
                  + 'it and contributes nothing to this figure.'
                : ''),
      })
    : unavailable(SRC.eplanning, L.fsr.url, L.fsr.name,
        controls.fsr.provenance.confidence === 'unavailable'
          ? 'The FSR layer did not answer, so no envelope can be derived.'
          : 'No FSR is mapped over this site, so a floor space envelope cannot be derived from the '
            + 'FSR map. Density here is controlled by other clauses.');

  let gfaComparison: Envelope['gfaComparison'] = null;
  if (input.imGfaM2 && input.imGfaM2 > 0 && gfaTotal > 0) {
    const pct = ((gfaTotal - input.imGfaM2) / input.imGfaM2) * 100;
    gfaComparison = {
      imM2: input.imGfaM2, derivedM2: round(gfaTotal, 0)!, differencePct: round(pct, 2)!,
      note: Math.abs(pct) <= 5
        ? 'The mapped-FSR envelope corroborates the IM figure.'
        : 'The mapped-FSR envelope and the IM figure differ by more than 5%. An IM figure often '
          + 'includes a design bonus, an incentive clause or a negotiated uplift that the FSR map '
          + 'does not carry. Ask the agent which clause the number relies on.',
    };
  }

  let indicativeUnits: Field<number>;
  const avg = input.avgUnitSizeSqm;
  if (input.unitCount) {
    indicativeUnits = field(input.unitCount, {
      source: 'Caller (information memorandum or analyst)', url: null, layer: null, confidence: 'supplied',
    });
  } else if (gfaTotal > 0 && avg && avg > 0 && input.nsaEfficiency) {
    assumptions.push(
      `Unit count assumes ${Math.round(input.nsaEfficiency * 100)}% GFA-to-NSA efficiency and an `
      + `average unit of ${avg} sqm, both supplied by the caller.`,
    );
    indicativeUnits = field(Math.floor((gfaTotal * input.nsaEfficiency) / avg), {
      source: 'Derived from mapped FSR and caller-supplied efficiency and unit size',
      url: L.fsr.url, layer: L.fsr.name, confidence: 'derived',
    });
  } else {
    indicativeUnits = unavailable<number>('n/a', null, null,
      'Unit count is a design outcome, not a published datum. No public dataset states it. It can '
      + 'be derived only from an efficiency ratio and an average unit size, both of which are '
      + 'assumptions — supply nsaEfficiency and avgUnitSizeSqm to have it computed, or take the '
      + 'figure from the IM scheme.');
  }

  return { siteAreaM2, areaDiscrepancy, potentialGfaM2, gfaByBand, gfaComparison, indicativeUnits, assumptions };
}

/* ---------------------------------------------------------- threshold check */

export type Check = {
  metric: string;
  threshold: string;
  actual: string;
  status: 'pass' | 'fail' | 'borderline' | 'unknown';
  basis: string;
};

export type CompensatingFactor = { factor: string; evidence: string; source: string | null };

export type ThresholdResult = {
  leadType: 'vertical' | 'horizontal';
  leadTypeBasis: string;
  checks: Check[];
  verdict: 'PASS' | 'CONDITIONAL PASS' | 'FAIL' | 'UNKNOWN';
  recommendation: string;
  reason: string;
  missingInputs: { input: string; why: string }[];
  candidateCompensatingFactors: CompensatingFactor[];
  derivedGrv: Field<number> | null;
};

const fmtMoney = (n: number) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(2)}Bn` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n).toLocaleString()}`;

/**
 * The D1 threshold gate.
 *
 * The single rule that matters: a GRV is never invented to reach a verdict.
 * No public dataset states a gross realisation — it is a function of a scheme
 * and an achievable rate, both of which are commercial judgements. When the
 * deciding inputs are absent the verdict is UNKNOWN and names exactly what is
 * missing, which is a shorter piece of work for the BD team than unwinding a
 * PASS that rested on a fabricated number.
 *
 * CONDITIONAL PASS is returned only when exactly one threshold fails. The
 * compensating factors listed alongside it are candidates with evidence
 * attached, never assertions — D1 requires the reason to be articulated and
 * that remains a human sign-off.
 */
export function runThreshold(
  input: DossierInput,
  controls: Controls,
  envelope: Envelope,
  heritage: Heritage,
  micro: Micromarket,
  proximity: Proximity,
): ThresholdResult {
  const missing: { input: string; why: string }[] = [];

  const fsrMax = Math.max(0, ...(controls.fsr.value ?? []).map((b) => b.value));
  const zones = (controls.zoning.value ?? []).map((b) => b.value);
  const highDensity = zones.some((z) => /^(R4|R3|MU1|B4|B3|B8|E1|E2|SP)/.test(z)) || fsrMax >= 1.5;

  const leadType = input.leadType ?? (highDensity ? 'vertical' : 'horizontal');
  const leadTypeBasis = input.leadType
    ? 'Supplied by the caller.'
    : `Inferred from the mapped controls: zoning ${zones.join(' + ') || 'unknown'}`
      + `${fsrMax ? `, maximum FSR ${fsrMax}:1` : ''}. `
      + 'This is an inference, not a classification published by anyone. Override with leadType.';

  // A GRV the caller can have computed for them, but only from a rate THEY
  // nominate. Nothing here guesses a sale rate.
  let derivedGrv: Field<number> | null = null;
  let grv = input.grvAud ?? null;
  const gfa = envelope.potentialGfaM2.value;
  if (grv == null && input.salePricePerSqmNsa && gfa) {
    const eff = input.nsaEfficiency ?? 0.8;
    const nsa = gfa * eff;
    grv = nsa * input.salePricePerSqmNsa;
    derivedGrv = field(round(grv, 0), {
      source: 'Derived: mapped-FSR envelope x efficiency x caller-supplied rate',
      url: L.fsr.url, layer: L.fsr.name, confidence: 'derived',
      note: `${Math.round(gfa)} sqm GFA x ${eff} efficiency = ${Math.round(nsa)} sqm NSA, at `
          + `$${input.salePricePerSqmNsa.toLocaleString()}/sqm. `
          + (input.nsaEfficiency == null
              ? 'Efficiency of 0.80 is a stated default, NOT a measured value — supply nsaEfficiency to replace it. '
              : '')
          + 'This is an arithmetic consequence of the rate you supplied. It is not market evidence '
          + 'and must not be quoted as a GRV without the rate being defended.',
    });
  }

  const checks: Check[] = [];

  if (leadType === 'vertical') {
    if (grv != null) {
      checks.push({
        metric: 'GRV', threshold: '>= $500M', actual: fmtMoney(grv),
        status: grv >= 500e6 ? 'pass' : grv >= 400e6 ? 'borderline' : 'fail',
        basis: input.grvAud != null ? 'Supplied by the caller.' : (derivedGrv?.provenance.note ?? 'Derived.'),
      });
    } else {
      checks.push({
        metric: 'GRV', threshold: '>= $500M', actual: 'UNKNOWN', status: 'unknown',
        basis: 'No public dataset publishes a gross realisation value. It requires a scheme and an '
             + 'achievable sale rate. Not estimated here.',
      });
      missing.push({
        input: 'grvAud',
        why: 'Gross realisation. Supply it from the IM or feasibility, or supply salePricePerSqmNsa '
           + 'and the endpoint will compute it from the mapped-FSR envelope.',
      });
    }

    const ppsm = input.ppsmAud ?? null;
    if (ppsm != null) {
      checks.push({
        metric: 'PPSM', threshold: '>= $15,000 psm', actual: `$${Math.round(ppsm).toLocaleString()} psm`,
        status: ppsm >= 15000 ? 'pass' : ppsm >= 13000 ? 'borderline' : 'fail',
        basis: 'Supplied by the caller.',
      });
    } else {
      checks.push({
        metric: 'PPSM', threshold: '>= $15,000 psm', actual: 'UNKNOWN', status: 'unknown',
        basis: 'The D1 PPSM is an apartment sale price per square metre of net saleable area. The '
             + 'NSW Valuer General publishes LAND values and whole-property sales, which are a '
             + 'different quantity by roughly an order of magnitude. Substituting one for the '
             + 'other would clear the $15,000 threshold on arithmetic alone.'
             + (input.salePricePerSqmNsa ? '' : ' Supply ppsmAud, or salePricePerSqmNsa.'),
      });
      missing.push({
        input: 'ppsmAud',
        why: 'Achievable apartment rate per sqm of NSA, from comparable off-the-plan evidence.',
      });
    }
  } else {
    const isMetro = micro.metro.value?.isGreaterCapitalCity ?? null;
    checks.push({
      metric: 'Location', threshold: 'Metro / growth corridor / PDA',
      actual: isMetro == null ? 'UNKNOWN'
        : isMetro ? `Within ${micro.metro.value?.gccsa}` : `Outside a greater capital city (${micro.metro.value?.gccsa ?? 'no GCCSA'})`,
      status: isMetro == null ? 'unknown' : isMetro ? 'pass' : 'borderline',
      basis: isMetro == null ? 'ABS GCCSA could not be resolved.'
        : 'ABS Greater Capital City Statistical Area. Settles "metro" only — "growth corridor" and '
          + '"PDA" are policy designations that no single dataset defines in NSW.',
    });

    const t = input.turnaroundMonths ?? null;
    checks.push(t != null
      ? { metric: 'Turnaround', threshold: '12 to 18 months', actual: `${t} months`,
          status: t >= 12 && t <= 18 ? 'pass' : t < 12 || t <= 24 ? 'borderline' : 'fail',
          basis: 'Supplied by the caller.' }
      : { metric: 'Turnaround', threshold: '12 to 18 months', actual: 'UNKNOWN', status: 'unknown',
          basis: 'A programme estimate. No dataset publishes it.' });
    if (t == null) missing.push({ input: 'turnaroundMonths', why: 'Delivery programme, from the BD team.' });

    const m = input.marginPct ?? null;
    checks.push(m != null
      ? { metric: 'Development margin', threshold: '> 20%', actual: `${m}%`,
          status: m > 20 ? 'pass' : m >= 17 ? 'borderline' : 'fail', basis: 'Supplied by the caller.' }
      : { metric: 'Development margin', threshold: '> 20%', actual: 'UNKNOWN', status: 'unknown',
          basis: 'A feasibility output. Requires cost and revenue assumptions not present in any '
               + 'public dataset.' });
    if (m == null) missing.push({ input: 'marginPct', why: 'Development margin from the feasibility.' });

    const lots = input.lotCount ?? null;
    if (lots != null) {
      const flexible = grv != null && grv >= 20e6;
      checks.push({
        metric: 'Lot count', threshold: '>= 30 lots (flexible if GRV >= $20M)',
        actual: `${lots} lots${flexible ? `, GRV ${fmtMoney(grv!)}` : ''}`,
        status: lots >= 30 ? 'pass' : flexible ? 'borderline' : 'fail',
        basis: 'Supplied by the caller.'
             + (lots < 30 && flexible ? ' Below 30 but the flexible GRV limb is met.' : ''),
      });
    } else {
      checks.push({
        metric: 'Lot count', threshold: '>= 30 lots (flexible if GRV >= $20M)', actual: 'UNKNOWN',
        status: 'unknown',
        basis: 'A subdivision yield. Not published; it comes from the DA or the scheme plan.',
      });
      missing.push({ input: 'lotCount', why: 'Number of lots from the DA or scheme plan.' });
    }
  }

  // Candidate compensating factors. Each is a fact with a source attached, so
  // a human can accept or reject it. None of them changes the verdict on its own.
  const comp: CompensatingFactor[] = [];
  const nearestStation = proximity.stations.value?.[0];
  if (nearestStation && nearestStation.distanceM <= 800)
    comp.push({
      factor: 'Transport-oriented location',
      evidence: `${nearestStation.name} is ${nearestStation.distanceM} m from the site centroid.`,
      source: L.poi.url,
    });
  const tod = (controls.fsr.value ?? []).concat(controls.height.value ?? [] as any)
    .map((b: any) => b.amendment).find((a: any) => a && /transport oriented development/i.test(a));
  if (tod)
    comp.push({
      factor: 'Legislated planning uplift already in force',
      evidence: `The current FSR and height controls carry the amendment "${tod}", so the uplift is `
              + 'mapped rather than sought.',
      source: L.fsr.url,
    });
  if (heritage.affected === false)
    comp.push({
      factor: 'No heritage constraint',
      evidence: heritage.statement,
      source: L.heritEpi.url,
    });
  if (fsrMax >= 4)
    comp.push({
      factor: 'High mapped density',
      evidence: `Maximum mapped FSR on the site is ${fsrMax}:1.`,
      source: L.fsr.url,
    });
  if (micro.metro.value?.isGreaterCapitalCity)
    comp.push({
      factor: 'Metropolitan location',
      evidence: `The site falls within ${micro.metro.value.gccsa}.`,
      source: SA2_LAYER,
    });

  const fails = checks.filter((c) => c.status === 'fail').length;
  const unknowns = checks.filter((c) => c.status === 'unknown');
  const borderline = checks.filter((c) => c.status === 'borderline').length;

  let verdict: ThresholdResult['verdict'];
  let recommendation: string;
  let reason: string;

  if (unknowns.length) {
    verdict = 'UNKNOWN';
    recommendation = 'To be monitored — a threshold verdict cannot be issued until the missing '
                   + 'commercial inputs are supplied.';
    reason =
      `${unknowns.length} of ${checks.length} threshold metrics could not be evaluated: `
      + unknowns.map((c) => c.metric).join(', ') + '. '
      + 'These are commercial figures that no public dataset publishes, and none of them has been '
      + 'estimated to force a verdict. '
      + (checks.some((c) => c.status !== 'unknown')
          ? 'The metrics that could be evaluated are reported above and stand on their own. '
          : '')
      + 'Supply the inputs listed in missingInputs and the check will resolve.';
  } else if (fails === 0) {
    verdict = 'PASS';
    recommendation = 'To be pursued and moved to Potential lead';
    reason = 'Every applicable threshold is met: '
      + checks.map((c) => `${c.metric} ${c.actual} against ${c.threshold}`).join('; ') + '.'
      + (borderline ? ' One or more metrics sit close to their threshold and should be re-tested once the feasibility firms.' : '');
  } else if (fails === 1) {
    verdict = 'CONDITIONAL PASS';
    const f = checks.find((c) => c.status === 'fail')!;
    recommendation = 'To be pursued and moved to Potential lead, with caveats';
    reason =
      `One threshold is missed: ${f.metric} is ${f.actual} against ${f.threshold}. All others are met. `
      + (comp.length
          ? `${comp.length} candidate compensating factor(s) are listed with their evidence; D1 requires `
            + 'a named reason for progressing despite the shortfall, and choosing which of these carries '
            + 'that argument is a human decision, not one this endpoint makes.'
          : 'No compensating factor could be evidenced from the available data, so the caveat must be '
            + 'argued on commercial grounds not present here.');
  } else {
    verdict = 'FAIL';
    recommendation = 'Not recommended for progression at this stage';
    reason =
      `${fails} thresholds are missed: `
      + checks.filter((c) => c.status === 'fail').map((c) => `${c.metric} ${c.actual} against ${c.threshold}`).join('; ')
      + '. D1 treats more than one shortfall without sufficient compensating factors as a fail.';
  }

  return {
    leadType, leadTypeBasis, checks, verdict, recommendation, reason,
    missingInputs: missing, candidateCompensatingFactors: comp, derivedGrv,
  };
}

/* ------------------------------------------------------------- orchestrator */

export type Dossier = {
  generatedAt: string;
  jurisdiction: { state: string | null; supported: boolean; note?: string };
  resolution: {
    method: SiteResolution['method'];
    lotCount: number;
    lots: { lotId: string; areaM2: number; statedAreaM2: number | null; planLabel: string | null }[];
    contiguous: boolean;
    contiguityNote: string;
    unresolvedLots: string[];
    warnings: string[];
    centroid: Pt;
  };
  addresses: Field<string[]>;
  titles: Field<string[]>;
  envelope: Envelope;
  controls: Controls;
  heritage: Heritage;
  hazards: Record<string, HazardFinding>;
  valuation: Valuation;
  proximity: Proximity;
  micromarket: Micromarket;
  threshold: ThresholdResult;
  /** Everything we asked for and did not get, in one place, so the D1 slide 2
   *  verification checklist writes itself. */
  unavailableFields: { field: string; source: string; reason: string }[];
  sources: { label: string; url: string }[];
};

const walkUnavailable = (obj: any, path: string, out: { field: string; source: string; reason: string }[]) => {
  if (!obj || typeof obj !== 'object') return;
  const p = (obj as any).provenance;
  if (p && typeof p === 'object' && 'confidence' in p) {
    if (p.confidence === 'unavailable')
      out.push({ field: path, source: p.source, reason: p.note ?? 'no reason recorded' });
    return;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') walkUnavailable(v, path ? `${path}.${k}` : k, out);
  }
};

export async function buildDossier(input: DossierInput): Promise<
  { ok: false; status: number; error: string; detail?: unknown } | { ok: true; dossier: Dossier }
> {
  const site = await resolveSite(input);
  if (site.error) return { ok: false, status: site.errorStatus ?? 502, error: site.error };
  if (!site.amalgamation || !site.amalgamation.lots.length)
    return {
      ok: false, status: 404,
      error: 'No cadastre lot resolved for that input.',
      detail: { warnings: site.warnings, unresolvedLots: site.unresolvedLots },
    };

  const amal = site.amalgamation;
  const centroid = centroidOf(amal.rings)!;

  const state = stateOf(centroid);
  if (state !== 'NSW')
    return {
      ok: false, status: 400,
      error: `The dossier is wired for New South Wales only; that site resolves to ${state ?? 'outside Australia'}. `
           + 'Australia has no national planning dataset — heritage, FSR and height are published per '
           + 'state, and only NSW publishes all of them as queryable feature layers.',
    };

  const [controls, heritage, hazards, valuation, proximity, micro] = await Promise.all([
    fetchControls(amal.rings, centroid),
    fetchHeritage(amal.rings, centroid),
    fetchHazards(amal.rings),
    fetchValuation(amal.rings, centroid, amal.totalAreaM2, amal.lots[0]?.urbanity ?? null),
    fetchProximity(centroid),
    fetchMicromarket(centroid),
  ]);

  const envelope = buildEnvelope(amal, controls, input);
  const threshold = runThreshold(input, controls, envelope, heritage, micro, proximity);

  const addressList = (valuation.properties.value ?? [])
    .map((p) => p.address).filter((x): x is string => !!x);

  const dossier: Dossier = {
    generatedAt: NOW(),
    jurisdiction: { state, supported: true },
    resolution: {
      method: site.method,
      lotCount: amal.lots.length,
      lots: amal.lots.map((l: Lot) => ({
        lotId: l.lotId, areaM2: round(l.areaM2, 1)!, statedAreaM2: round(l.statedAreaM2, 1), planLabel: l.planLabel,
      })),
      contiguous: amal.contiguous,
      contiguityNote: amal.contiguous
        ? `All ${amal.lots.length} lot(s) share boundaries and form one continuous parcel.`
        : `These lots form ${amal.groups.length} SEPARATE groups that do not adjoin: `
          + amal.groups.map((g) => g.join(' + ')).join(' | ')
          + '. The combined area is still reported, but a non-contiguous holding is not a single '
          + 'development site and the envelope figures assume it is.',
      unresolvedLots: site.unresolvedLots,
      warnings: site.warnings,
      centroid,
    },
    addresses: addressList.length
      ? field(addressList, {
          source: SRC.vg, url: `${VAL}/5`, layer: 'Land value (address field)', confidence: 'measured',
        })
      : unavailable(SRC.vg, `${VAL}/5`, null, 'No Valuer General address record matched the site properties.'),
    titles: field(amal.lots.map((l) => l.lotId), {
      source: SRC.six, url: L.cadastre.url, layer: L.cadastre.name, confidence: 'measured',
      note: 'Lot/section/plan as the cadastre spells it. An IM writes an empty section as a single '
          + 'slash ("2/DP202169"); the cadastre doubles it ("2//DP202169"). Both forms are accepted '
          + 'on input.',
    }),
    envelope, controls, heritage, hazards, valuation, proximity, micromarket: micro, threshold,
    unavailableFields: [],
    sources: [
      { label: 'NSW Planning Portal — principal planning (zoning, FSR, height, heritage)', url: PPP },
      { label: 'NSW Planning Portal — hazard (flood, bush fire, landslide)', url: HAZ },
      { label: 'NSW EPA — contaminated land notified sites', url: L.contam.url },
      { label: 'NSW Spatial Services — cadastre, administrative boundaries, points of interest', url: SIX },
      { label: 'NSW Valuer General — land values and recorded sales', url: VAL },
      { label: 'ABS — ASGS 2021 statistical areas, ERP and Census 2021 medians', url: 'https://data.api.abs.gov.au' },
    ],
  };

  const missingOut: { field: string; source: string; reason: string }[] = [];
  walkUnavailable(dossier.addresses, 'addresses', missingOut);
  walkUnavailable(dossier.envelope, 'envelope', missingOut);
  walkUnavailable(dossier.controls, 'controls', missingOut);
  walkUnavailable(dossier.hazards, 'hazards', missingOut);
  walkUnavailable(dossier.valuation, 'valuation', missingOut);
  walkUnavailable(dossier.proximity, 'proximity', missingOut);
  walkUnavailable(dossier.micromarket, 'micromarket', missingOut);
  if (heritage.affected === null)
    missingOut.push({ field: 'heritage', source: SRC.eplanning, reason: heritage.statement });
  dossier.unavailableFields = missingOut;

  return { ok: true, dossier };
}
