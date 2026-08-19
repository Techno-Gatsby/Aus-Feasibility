/**
 * Data sources by jurisdiction. Verified live — see the date on each block.
 *
 * READ THIS BEFORE ADDING A LAYER:
 *  - Layer ids are NOT sequential and NOT zero-based. NSW zoning is 19,
 *    flood is 230. Querying /0 returns an error or an empty array, both of
 *    which read as "no data here" when they mean "wrong layer".
 *  - GROUP layers reject queries with "Invalid or missing input parameters".
 *    NSW ids 9, 12 and 17 are groups; the queryable layers are 11, 14, 19.
 *  - Some layers accept outFields=* ONLY and fail on a named field list.
 *  - An empty feature array is NOT proof of absence.
 *  - Australia has no national planning dataset. Every state publishes its
 *    own, with its own field names, and several publish nothing usable at
 *    all. Where a state is missing here that is a fact about the country,
 *    not an omission to be filled with a plausible guess.
 */
import type { StateCode } from './geo';

export type Purpose = 'zoning' | 'bushfire' | 'flood' | 'landslide'
                    | 'biodiversity' | 'cadastre' | 'contamination' | 'fsr' | 'height';

export type LayerDef = {
  purpose: Purpose;
  label: string;
  url: string;
  /** field carrying the value we display; null = show presence only */
  field: string | null;
  /** below this zoom the layer is neither drawn nor queried. Without a floor
   *  the map smears hundreds of km of council polygons across the country. */
  minZoom: number;
  /** false when the host sends no Access-Control-Allow-Origin: must go
   *  through /api/proxy, never straight from the browser */
  cors: boolean;
  /** some layers reject named field lists; these must use outFields=* */
  starFieldsOnly?: boolean;
  note?: string;
};

const NSW_EP = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning';
const NSW_FIRE = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Fire';
const NSW_EPA = 'https://mapprod2.environment.nsw.gov.au/arcgis/rest/services/EPA';
const SIX = 'https://maps.six.nsw.gov.au/arcgis/rest/services/public';

export const BY_STATE: Partial<Record<StateCode, LayerDef[]>> = {
  // ---- New South Wales — verified 2026-08-19, the most complete set ----
  NSW: [
    { purpose: 'zoning', label: 'Land zoning', field: 'SYM_CODE', minZoom: 11, cors: true,
      url: `${NSW_EP}/Planning_Portal_Principal_Planning/MapServer/19`,
      note: 'Layer 19, not 2 or 17. 17 is a group layer and rejects queries.' },
    { purpose: 'fsr', label: 'Floor space ratio', field: null, minZoom: 12, cors: true,
      url: `${NSW_EP}/Planning_Portal_Principal_Planning/MapServer/11`,
      note: 'Layer 11. Layer 9 shares the name but is a group.' },
    { purpose: 'height', label: 'Height of buildings', field: null, minZoom: 12, cors: true,
      url: `${NSW_EP}/Planning_Portal_Principal_Planning/MapServer/14` },
    { purpose: 'flood', label: 'Flood planning', field: null, minZoom: 11, cors: true,
      url: `${NSW_EP}/Planning_Portal_Hazard/MapServer/230` },
    { purpose: 'bushfire', label: 'Bush fire prone land', field: 'Category', minZoom: 10, cors: true,
      url: `${NSW_EP}/Planning_Portal_Hazard/MapServer/229`,
      note: 'Category 1 is the severe class. Also standalone at Fire/BFPL/0.' },
    { purpose: 'landslide', label: 'Landslide risk', field: null, minZoom: 11, cors: true,
      url: `${NSW_EP}/Planning_Portal_Hazard/MapServer/232` },
    { purpose: 'biodiversity', label: 'Biodiversity values', field: null, minZoom: 11, cors: true,
      url: `${NSW_EP}/BiodiversityValuesMap/MapServer/1`,
      note: 'Triggers the Biodiversity Offset Scheme. Credits are routinely the '
          + 'largest unbudgeted line on a greenfield deal.' },
    { purpose: 'cadastre', label: 'Cadastre (lot / DP)', field: 'lotidstring', minZoom: 14,
      cors: true, starFieldsOnly: true,
      url: `${SIX}/NSW_Cadastre/MapServer/9`,
      note: 'Answers POINT queries with outFields=* ONLY. Named field lists and '
          + 'envelope queries return "Failed to execute query".' },
    { purpose: 'contamination', label: 'Contaminated land (notified)', field: null,
      minZoom: 11, cors: false,
      url: `${NSW_EPA}/Contaminated_land_notified_sites/MapServer/0`,
      note: 'No CORS header — must go through /api/proxy.' },
  ],
};

export const layersFor = (s: StateCode | null): LayerDef[] =>
  (s && BY_STATE[s]) || [];
export const layerFor = (s: StateCode | null, p: Purpose): LayerDef | null =>
  layersFor(s).find((l) => l.purpose === p) ?? null;
export const SUPPORTED = () => Object.keys(BY_STATE) as StateCode[];

/** Ownership is deliberately absent everywhere. There is no free owner data
 *  in Australia: a title search is paid, per search, through the state land
 *  registry. The app surfaces the lot identifier so that paid step is one
 *  copy-paste. */
export const OWNERSHIP_IS_PAID = true;
