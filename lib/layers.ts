/**
 * Every data source the app uses, with the traps that cost time to find.
 * Verified live 2026-08-19. Free and keyless unless marked.
 *
 * READ THIS BEFORE ADDING A LAYER:
 *  - NSW layer ids are NOT sequential and NOT zero-based. Zoning is 19,
 *    flood is 230. Querying /0 returns an error or an empty array, both of
 *    which read as "no data here" when they mean "wrong layer".
 *  - Group layers reject queries outright with "Invalid or missing input
 *    parameters". Ids 9, 12 and 17 on the Principal service are groups; the
 *    queryable feature layers are 11, 14 and 19.
 *  - An empty feature array is NOT proof of absence. Point queries can miss
 *    a polygon that an envelope query finds.
 */

const NSW_EP =
  'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning';
const NSW_FIRE =
  'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Fire';
const NSW_EPA =
  'https://mapprod2.environment.nsw.gov.au/arcgis/rest/services/EPA';
const SIX = 'https://maps.six.nsw.gov.au/arcgis/rest/services/public';

export type LayerDef = {
  id: string;
  label: string;
  url: string;
  /** Below this zoom the layer is not drawn or queried. Without a floor the
   *  map smears hundreds of km of council polygons across the country. */
  minZoom: number;
  /** false when the host sends no Access-Control-Allow-Origin: must be
   *  fetched through /api/proxy, never straight from the browser. */
  cors: boolean;
  state: 'NSW' | 'ALL';
  note?: string;
};

export const LAYERS: LayerDef[] = [
  {
    id: 'zoning',
    label: 'Land zoning',
    url: `${NSW_EP}/Planning_Portal_Principal_Planning/MapServer/19`,
    minZoom: 11, cors: true, state: 'NSW',
    note: 'Layer 19, not 2 or 17. 17 is a group layer and rejects queries.',
  },
  {
    id: 'fsr',
    label: 'Floor space ratio',
    url: `${NSW_EP}/Planning_Portal_Principal_Planning/MapServer/11`,
    minZoom: 12, cors: true, state: 'NSW',
    note: 'Layer 11. Layer 9 has the same name but is a group layer.',
  },
  {
    id: 'height',
    label: 'Height of buildings',
    url: `${NSW_EP}/Planning_Portal_Principal_Planning/MapServer/14`,
    minZoom: 12, cors: true, state: 'NSW',
    note: 'Layer 14. Layer 12 is the group.',
  },
  {
    id: 'flood',
    label: 'Flood planning',
    url: `${NSW_EP}/Planning_Portal_Hazard/MapServer/230`,
    minZoom: 11, cors: true, state: 'NSW',
  },
  {
    id: 'bushfire',
    label: 'Bush fire prone land',
    url: `${NSW_EP}/Planning_Portal_Hazard/MapServer/229`,
    minZoom: 10, cors: true, state: 'NSW',
    note: 'Category 1 is the severe class. Also published standalone at Fire/BFPL/0.',
  },
  {
    id: 'bushfireAlt',
    label: 'Bush fire prone land (standalone)',
    url: `${NSW_FIRE}/BFPL/MapServer/0`,
    minZoom: 10, cors: true, state: 'NSW',
  },
  {
    id: 'landslide',
    label: 'Landslide risk',
    url: `${NSW_EP}/Planning_Portal_Hazard/MapServer/232`,
    minZoom: 11, cors: true, state: 'NSW',
  },
  {
    id: 'biodiversity',
    label: 'Biodiversity values',
    url: `${NSW_EP}/BiodiversityValuesMap/MapServer/1`,
    minZoom: 11, cors: true, state: 'NSW',
    note: 'Triggers the Biodiversity Offset Scheme. Offset credits are '
        + 'routinely the largest unbudgeted line on a NSW greenfield deal.',
  },
  {
    id: 'cadastre',
    label: 'Cadastre (lot / DP)',
    url: `${SIX}/NSW_Cadastre/MapServer/9`,
    minZoom: 14, cors: true, state: 'NSW',
    note: 'Answers POINT queries with outFields=* ONLY. Named field lists and '
        + 'envelope queries return "Failed to execute query".',
  },
  {
    id: 'contamination',
    label: 'Contaminated land (notified)',
    url: `${NSW_EPA}/Contaminated_land_notified_sites/MapServer/0`,
    minZoom: 11, cors: false, state: 'NSW',
    note: 'No CORS header. Must go through /api/proxy.',
  },
];

export const byId = (id: string) => LAYERS.find((l) => l.id === id);

/** Ownership is deliberately absent. There is no free owner data in
 *  Australia: a NSW title search is paid, per search, through LRS. The app
 *  surfaces the Lot/DP so that paid step is one copy-paste. */
export const OWNERSHIP_IS_PAID = true;
