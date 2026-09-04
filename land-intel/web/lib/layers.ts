// Every data source the app uses. All free, all public, no API keys.
// Verified live 2026-07-27.

const PROSPER =
  'https://services8.arcgis.com/8ofMLzOrtxGP9wVQ/arcgis/rest/services';
const CCAD =
  'https://services2.arcgis.com/uXyoacYrZTPTKD3R/ArcGIS/rest/services' +
  '/CCAD_Parcel_Feature_Set/FeatureServer';
const COLLIN =
  'https://services1.arcgis.com/fdWXd5OobWR1E3er/arcgis/rest/services';

// www.fws.gov 301-redirects here and POST bodies do not survive the redirect,
// so address the real host directly. (fwsprimary.wim.usgs.gov accepts the
// request then 500s on query -- do not use it.)
const NWI =
  'https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services' +
  '/Wetlands/MapServer';

// Railroad Commission. Pipelines are layer 14 -- layer 13 is also called
// "Pipelines" but exposes no queryable fields, and 12 is QPipelines.
const RRC =
  'https://gis.rrc.texas.gov/server/rest/services/rrc_public' +
  '/RRC_Public_Viewer_Srvs/MapServer';

// Texas PUC Certificates of Convenience and Necessity — the legal right AND
// obligation to provide retail water/sewer to a given area. In exurban Texas
// this question kills more deals than anything else on the map.
// NOTE THE LAYER IDS: water is 0, sewer is **1**. Querying sewer at /0 returns
// an empty array rather than an error, which reads as "no CCN" when it means
// "wrong layer".
const CCN = 'https://services3.arcgis.com/65cjxRz7QPkb5HMT/arcgis/rest/services';

export const L = {
  ccnWater: `${CCN}/PUC_CCN_WATER_TSMS/FeatureServer/0`,
  ccnSewer: `${CCN}/PUC_CCN_SEWER_TSMS/FeatureServer/1`,
  // TxDOT annual average daily traffic — statewide, free, AADT_CUR field.
  txdotAadt:
    'https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services' +
    '/TxDOT_AADT/FeatureServer/0',
  prosperParcels: `${PROSPER}/Land_Records/FeatureServer/6`,
  prosperPreconst: `${PROSPER}/Land_Records/FeatureServer/5`,
  zoning: `${PROSPER}/Planning/FeatureServer/0`,
  plannedDev: `${PROSPER}/Planning/FeatureServer/9`,
  futureLandUse: `${PROSPER}/Planning/FeatureServer/11`,
  currentDev: `${PROSPER}/Planning/FeatureServer/3`,
  thoroughfare: `${PROSPER}/Planning/FeatureServer/5`,
  townEtj: `${PROSPER}/Administrative_Boundaries/FeatureServer/12`,
  etjReleases: `${PROSPER}/Administrative_Boundaries/FeatureServer/10`,
  floodplain: `${PROSPER}/Environmental/FeatureServer/7`,
  pondsLakes: `${PROSPER}/Environmental/FeatureServer/0`,
  streams: `${PROSPER}/Environmental/FeatureServer/1`,

  ccadParcels: `${CCAD}/4`,
  ccadCityLimits: `${CCAD}/6`,
  ccadSchoolDist: `${CCAD}/2`,
  ccadSpecialDist: `${CCAD}/7`,

  coFloodplain: `${COLLIN}/Floodplain/FeatureServer/0`,
  coStreams: `${COLLIN}/Streams/FeatureServer/0`,
  coLakes: `${COLLIN}/Lakes/FeatureServer/0`,
  coThoroughfare: `${COLLIN}/Tplan/FeatureServer/0`,
  coOuterLoop: `${COLLIN}/OuterLoop/FeatureServer/0`,

  wetlands: `${NWI}/0`,
  rrcWells: `${RRC}/1`,
  rrcOrphanWells: `${RRC}/2`,
  rrcInjection: `${RRC}/4`,
  rrcPipelines: `${RRC}/14`,
} as const;

// ---------------------------------------------------------------------------
// Per-city zoning. There is no county-wide zoning layer — Texas counties have
// no zoning authority, so each city publishes its own or none at all.
//
// NOTE THE LAYER IDS. None of these are 0: Anna PD is 18, Murphy is 16,
// Princeton is 79. Querying the wrong id returns "Invalid URL" if it does not
// exist — or worse, an empty array that reads as "no zoning here".
// ---------------------------------------------------------------------------

export interface CityZoning {
  city: string;
  url: string;
  /** Attribute holding the zone code, in priority order. */
  zoneFields: string[];
  /** Attribute holding a longer description, if any. */
  descFields?: string[];
  /** Ordinance number / link fields. */
  ordFields?: string[];
}

export const CITY_ZONING: CityZoning[] = [
  {
    city: 'PROSPER',
    url: 'https://services8.arcgis.com/8ofMLzOrtxGP9wVQ/arcgis/rest/services/Planning/FeatureServer/0',
    zoneFields: ['ZONE_'],
    descFields: ['Zoning_Class'],
    ordFields: ['ORD1', 'ORD2', 'PD'],
  },
  {
    city: 'ANNA',
    url: 'https://services5.arcgis.com/DvFgDXTY4DS4ZXFx/arcgis/rest/services/PD_Zoning_Layer/FeatureServer/18',
    zoneFields: ['Zoning'],
    ordFields: ['ORDINANCE', 'Ord_1_appr'],
  },
  {
    city: 'MURPHY',
    url: 'https://services5.arcgis.com/lt8CbgYaNuFrQ7kB/arcgis/rest/services/Zoning_Districts/FeatureServer/16',
    zoneFields: ['Zone'],
    descFields: ['MurphyZone'],
    ordFields: ['Ordinance', 'AdoptionDate', 'Hyperlink'],
  },
  {
    city: 'PRINCETON',
    url: 'https://services6.arcgis.com/KL1aiRJt0tw3BM7h/arcgis/rest/services/princeton_zoning_districts/FeatureServer/79',
    zoneFields: ['Zone'],
    descFields: ['PD_Label'],
    ordFields: ['ORD', 'SUP_ORD', 'Muni_Code_Link'],
  },
];

/** Cities inside Collin CAD with NO public zoning GIS found. Listed so the
 *  app can say "not published" rather than "none". */
export const NO_ZONING_GIS = [
  'MELISSA', 'MCKINNEY', 'CELINA', 'FRISCO', 'ALLEN', 'WYLIE', 'PLANO',
  'FAIRVIEW', 'LUCAS', 'PARKER', 'SACHSE', 'ST PAUL', 'NEW HOPE', 'LAVON',
  'JOSEPHINE', 'NEVADA', 'BLUE RIDGE', 'FARMERSVILLE', 'LEONARD', 'WESTON',
  'VAN ALSTYNE', 'WHITEWRIGHT', 'LOWRY CROSSING',
];

export const EPQS = 'https://epqs.nationalmap.gov/v1/json';
export const SDA = 'https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest';
export const CENSUS_GEOCODER =
  'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';

// FEMA zones that are a Special Flood Hazard Area.
export const SFHA_ZONES = new Set([
  'A', 'AE', 'AH', 'AO', 'A99', 'AR', 'V', 'VE',
]);
