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
                    | 'biodiversity' | 'cadastre' | 'contamination' | 'fsr' | 'height'
                    | 'valuation' | 'sales' | 'propertyBoundary' | 'address';

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
  /** VIC packs every planning overlay into one layer and Tasmania packs every
   *  hazard code into one. Without a filter ANY overlay reads as flood — a
   *  false positive that would tell a buyer a CBD site is flood-affected.
   *  match is applied to `field` as a case-insensitive prefix/substring. */
  match?: string[];
  /** Which council or region this layer covers, where a state publishes no
   *  single service. Shown to the user so a nil result reads as "no council
   *  wired at this point" rather than "this land is unzoned". */
  area?: string;
  note?: string;
};

const NSW_EP = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning';
const NSW_FIRE = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Fire';
const NSW_EPA = 'https://mapprod2.environment.nsw.gov.au/arcgis/rest/services/EPA';
const SIX = 'https://maps.six.nsw.gov.au/arcgis/rest/services/public';
const VAL = `${SIX}/Valuation/MapServer`;
const VIC = 'https://plan-gis.mapshare.vic.gov.au/arcgis/rest/services/Planning';
const TAS = 'https://services.thelist.tas.gov.au/arcgis/rest/services/Public';
const SLIP = 'https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services';
const ACT = 'https://services1.arcgis.com/E5n4f1VY84i0xSjy/arcgis/rest/services';
const QLD_STATE = 'https://spatial-gis.information.qld.gov.au/arcgis/rest/services';
const BNE = 'https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services';
const GC  = 'https://maps1.goldcoast.qld.gov.au/arcgis/rest/services';
const SCC = 'https://geoimage.scc.qld.gov.au/arcgis/rest/services/PlanningCadastre';
const TWB = 'https://maps.tr.qld.gov.au/arcgis/rest/services/External';


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
    // ---- valuation and sales: free, keyless, CORS. This is the answer to
    // "why does the US tool have land values and Australia doesn't" — it can,
    // and on sale prices NSW is BETTER than Texas, which is a non-disclosure
    // state where transaction prices are never public.
    // NOTE: layers 1-7 are POINT geometry. A point-intersects query returns
    // zero every time; you must use an envelope. Layers 0, 4 and 8 are group
    // layers and 400 on query — use the urbanity tiers (1/2/3, 5/6/7, 9/10/11).
    { purpose: 'valuation', label: 'Land value (Valuer General, 5 yr)',
      field: 'val1_lv', minZoom: 15, cors: true,
      url: `${VAL}/5`,
      note: 'Urban tier. Semi-rural is 6, rural is 7. Values are STRINGS with a '
          + 'leading space and dollar sign (" $2,790,000") and prop_area mixes '
          + 'units between square metres and hectares — parse, do not cast.' },
    { purpose: 'sales', label: 'Sale price and date', field: 'price',
      minZoom: 15, cors: true,
      url: `${VAL}/1`,
      note: 'Urban tier; 2 semi-rural, 3 rural. Individual addresses, prices and '
          + 'dates, free. Texas has no equivalent at any price — it is a '
          + 'non-disclosure state.' },
    { purpose: 'propertyBoundary', label: 'Property boundary', field: 'propid',
      minZoom: 15, cors: true,
      url: `${VAL}/9`,
      note: 'Polygon layer, so this one DOES answer point queries. Click a point '
          + 'here to get propid, then filter the point layers by propid.' },
    { purpose: 'contamination', label: 'Contaminated land (notified)', field: null,
      minZoom: 11, cors: false,
      url: `${NSW_EPA}/Contaminated_land_notified_sites/MapServer/0`,
      note: 'No CORS header — must go through /api/proxy.' },
  ],

  // ---- Victoria — verified 2026-08-19 ----
  VIC: [
    { purpose: 'zoning', label: 'Planning scheme zone', field: 'ZONE_CODE', minZoom: 11, cors: true,
      url: `${VIC}/Vicplan_PlanningSchemeZones/MapServer/0`,
      note: 'Layer 0 is "All Zones". Layer 13 is Industrial 3 Zone specifically — the '
          + 'service interleaves per-zone layers with group layers, and ids are '
          + 'non-contiguous (32 jumps to 34).' },
    { purpose: 'bushfire', label: 'Bushfire Management Overlay', field: 'ZONE_CODE',
      minZoom: 10, cors: true,
      url: `${VIC}/VicPlan_Bushfire/MapServer/0`,
      note: 'BMO. The separate Bushfire Prone Area at layer 1 is a BUILDING control, '
          + 'not a planning overlay, and is absent from the overlays service entirely.' },
    { purpose: 'flood', label: 'Flood overlays', field: 'ZONE_CODE', minZoom: 11, cors: true,
      url: `${VIC}/Vicplan_PlanningSchemeOverlays/MapServer/0`,
      match: ['LSIO', 'FO', 'SBO', 'UFZ'],
      note: 'All overlays live in this one layer, so it MUST be filtered: LSIO land '
          + 'subject to inundation, FO floodway, SBO special building, UFZ urban '
          + 'floodway. Unfiltered it reports a CBD site as flood-affected because '
          + 'some unrelated overlay happens to sit there.' },
    { purpose: 'cadastre', label: 'Parcel (SPI)', field: 'PARCEL_SPI', minZoom: 14, cors: true,
      url: `${VIC}/VicPlan_PropertyAndParcel/MapServer/4`,
      note: 'SPI is the Victorian legal identifier, e.g. 1\\TP803790.' },
  ],

  // ---- Tasmania — verified 2026-08-19 ----
  TAS: [
    { purpose: 'zoning', label: 'Planning scheme zone', field: 'ZONE', minZoom: 11, cors: true,
      url: `${TAS}/PlanningOnline/MapServer/13`,
      note: 'The same service also carries /24 Historical, /4 and /9 Kingborough Interim, '
          + 'and /16 Zone BOUNDARIES (lines, not areas) — easy to grab the wrong one.' },
    { purpose: 'bushfire', label: 'Bushfire-prone areas', field: 'CODE', minZoom: 10, cors: true,
      url: `${TAS}/PlanningOnline/MapServer/14`,
      match: ['Bushfire'],
      note: 'Tasmania puts ALL hazard in one layer, so CODE must be filtered. The '
          + 'same layer carries flood, landslip, coastal erosion and potentially '
          + 'contaminated land — unfiltered they all read as bushfire.' },
    { purpose: 'flood', label: 'Flood-prone hazard areas', field: 'CODE', minZoom: 11, cors: true,
      url: `${TAS}/PlanningOnline/MapServer/14`,
      match: ['Flood'],
      note: 'Same layer as bushfire — CODE must be filtered or the two are '
          + 'indistinguishable.' },
    { purpose: 'cadastre', label: 'Parcel (PID)', field: 'PID', minZoom: 14, cors: true,
      url: `${TAS}/PlanningOnline/MapServer/2`,
      note: 'CAD_TYPE1 distinguishes Private Parcel from road and Crown casements — a '
          + 'point on a road returns a valid record with null Volume/Folio.' },
  ],

  // ---- Queensland — verified 2026-08-19 ----
  // Zoning is council-level BY STATUTE in Queensland; there is no statewide
  // scheme-zone service. Cadastre IS statewide. Brisbane City is wired here
  // as the largest LGA; other councils each need their own entry.
  QLD: [
    { purpose: 'cadastre', label: 'Land parcel (lot/plan)', field: 'lotplan',
      minZoom: 14, cors: true,
      url: `${QLD_STATE}/PlanningCadastre/LandParcelPropertyFramework/MapServer/4`,
      note: 'STATEWIDE. lotplan is the Queensland legal identifier, e.g. 3RP119911.' },
    // Queensland zoning is council-level BY STATUTE — there is no singular
    // API and no statewide layer. The only workable approach is to aggregate
    // per-LGA services and take the first that answers, which is what the
    // original single-file build did. Each entry below is one council; a
    // point outside all of them means "no council wired here", NOT "unzoned".
    { purpose: 'zoning', label: 'Zone (Brisbane City Plan)', field: 'LVL1_ZONE',
      minZoom: 12, cors: true, area: 'Brisbane City',
      url: `${BNE}/Zoning_opendata/FeatureServer/0` },
    { purpose: 'zoning', label: 'Zone (Gold Coast City Plan v13)', field: 'LVL1_ZONE',
      minZoom: 12, cors: true, area: 'Gold Coast City',
      url: `${GC}/City_Plan_V13_Zone/MapServer/6` },
    { purpose: 'zoning', label: 'Zone (Sunshine Coast)', field: 'DESCRIPT',
      minZoom: 12, cors: true, area: 'Sunshine Coast',
      url: `${SCC}/PlanningScheme_SunshineCoast_Zoning_SCC/MapServer/5` },
    { purpose: 'zoning', label: 'Zone (Toowoomba Regional)', field: 'TRPS_Zones',
      minZoom: 12, cors: true, area: 'Toowoomba Regional',
      url: `${TWB}/External_PlanningScheme/MapServer/170` },
    { purpose: 'bushfire', label: 'Bushfire overlay (Brisbane)', field: 'OVL2_DESC',
      minZoom: 11, cors: true,
      url: `${BNE}/Bushfire_overlay/FeatureServer/0`,
      note: 'Brisbane City only. The QFES STATEWIDE bushfire layer is published as a '
          + 'cached tile service (TilesOnly) with no /query, so it cannot be asked '
          + 'about a point at all.' },
    { purpose: 'flood', label: 'Brisbane River flood planning area', field: 'OVL2_DESC',
      minZoom: 11, cors: true,
      url: `${BNE}/Flood_overlay_Brisbane_River_flood_planning_area/FeatureServer/0`,
      note: 'Brisbane City only, and RIVER flooding only — not creek or overland flow.' },
  ],

  // ---- Western Australia — verified 2026-08-19 ----
  // SLIP is the CORS-enabled mirror; espatial.dplh.wa.gov.au carries richer
  // cadastre but sends no Access-Control-Allow-Origin on GET, HEAD or even
  // preflight, so it is server-side only.
  WA: [
    { purpose: 'zoning', label: 'Local planning scheme zone', field: 'zone',
      minZoom: 11, cors: true,
      url: `${SLIP}/Property_and_Planning/MapServer/112`,
      note: 'Layer 112 on SLIP. On the espatial host the equivalent is layer 1, NOT 2 '
          + '— 2 is R-Code density, and 7 and 40 are group layers that reject queries. '
          + 'A WA site also carries a REGION scheme zone (layer 48) which prevails '
          + 'over the local scheme.' },
    { purpose: 'bushfire', label: 'Bushfire prone area', field: 'type',
      minZoom: 10, cors: true,
      url: `${SLIP}/Bush_Fire_Prone_Areas/MapServer/17` },
    { purpose: 'flood', label: 'Floodway / flood fringe', field: 'ext_type',
      minZoom: 11, cors: true,
      url: `${SLIP}/Water/MapServer/23`,
      note: 'Layer 21 carries the 1% AEP floodplain separately.' },
    { purpose: 'cadastre', label: 'Lot', field: 'lot_number', minZoom: 14, cors: true,
      url: `${SLIP}/Places_and_Addresses/MapServer/4`,
      note: 'Thin but CORS-safe. The full cadastre with title identifier lives on '
          + 'espatial PlanningAndCadastral_v06/11 and needs a server-side proxy.' },
  ],

  // ---- Australian Capital Territory — verified 2026-08-19 ----
  ACT: [
    { purpose: 'zoning', label: 'Territory Plan zone', field: 'LAND_USE_ZONE_CODE_ID',
      minZoom: 12, cors: true,
      url: `${ACT}/ACTGOV_TP_LAND_USE_ZONE/FeatureServer/1` },
    { purpose: 'bushfire', label: 'Bushfire prone area', field: 'Hazard_Category',
      minZoom: 10, cors: true,
      url: `${ACT}/Bushfire_Prone_Area_Details_2026/FeatureServer/0`,
      note: 'Hazard_Category is 1, 2, 3 or Buffer.' },
    { purpose: 'flood', label: 'Flood extent (1% AEP)', field: null, minZoom: 11, cors: true,
      url: `${ACT}/ACTGOV_FLOOD_EXTENT/FeatureServer/0` },
    { purpose: 'cadastre', label: 'Block', field: 'BLOCK_KEY', minZoom: 14, cors: true,
      url: `${ACT}/ACTGOV_BLOCKS/FeatureServer/0`,
      note: 'Returns overlapping features including RETIRED historical parcels — a '
          + 'point can resolve to a superseded block if not filtered.' },
  ],
};

export const layersFor = (s: StateCode | null): LayerDef[] =>
  (s && BY_STATE[s]) || [];
export const layerFor = (s: StateCode | null, p: Purpose): LayerDef | null =>
  layersFor(s).find((l) => l.purpose === p) ?? null;
export const SUPPORTED = () => Object.keys(BY_STATE) as StateCode[];

/** Jurisdictions checked and deliberately NOT wired, with the reason. Stated
 *  so nobody re-runs the search assuming it was an oversight.
 *
 *  SA  — the authoritative SAPPA service on lsa2.geohub.sa.gov.au is
 *        CloudFront geo-blocked outside Australia; location.sa.gov.au replies
 *        "configured to block access from your country". Every reachable SA
 *        endpoint is a single council's clipped copy of the P&D Code, not the
 *        statewide set. Worth retrying from an Australian IP.
 *  NT  — a genuine absence, not a search failure. All 48 services on the NT
 *        government AGOL org were enumerated: no zoning, cadastre, bushfire
 *        or flood layer exists. nrmaps.nt.gov.au runs MapInfo SpatialSuite,
 *        not ArcGIS, and exposes no OGC capabilities. data.nt.gov.au
 *        publishes shapefiles only. NT needs ingesting, not querying.
 *
 *  Two URLs inherited from the single-file build pointed at the WRONG
 *  JURISDICTION and had to be discarded: the one labelled "SA" is Logan City
 *  QLD, and the one labelled "NT" is Rockhampton Regional Council QLD. Both
 *  return data, which is why the error survived — it just isn't the data the
 *  label claims. Check the layer `extent` before trusting a service name.
 */
export const NOT_WIRED: Record<string, string> = {
  SA: 'The statewide SAPPA service is geo-blocked outside Australia; only single-council '
    + 'clipped copies are reachable from here.',
  NT: 'No live endpoint exists. The NT publishes spatial data as shapefile downloads '
    + 'only — it would need ingesting rather than querying.',
};

/** Ownership is deliberately absent everywhere. There is no free owner data
 *  in Australia: a title search is paid, per search, through the state land
 *  registry. The app surfaces the lot identifier so that paid step is one
 *  copy-paste. */
export const OWNERSHIP_IS_PAID = true;
