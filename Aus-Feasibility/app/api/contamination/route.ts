import { NextRequest, NextResponse } from 'next/server';
import { inBox, type Box } from '@/lib/arcgis';
import { parseLatLng } from '@/lib/abs';
import { metres, stateOf, STATE_NAME } from '@/lib/geo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** NSW EPA contaminated land — notified sites.
 *
 *  Layer id CONFIRMED against the service: the MapServer publishes exactly one
 *  layer, id 0, type "Feature Layer", geometry point, capabilities
 *  "Map,Query,Data". There is no group layer here and id 1 returns a 500, so
 *  0 is the only queryable target. Field names likewise confirmed from the
 *  layer metadata — they are CamelCase, not the upper-snake the rest of the
 *  NSW estate uses. */
const LAYER =
  'https://mapprod2.environment.nsw.gov.au/arcgis/rest/services/EPA/Contaminated_land_notified_sites/MapServer/0';

const DEFAULT_RADIUS_M = 1000;
const MAX_RADIUS_M = 5000;
/** Well under the layer's advertised maxRecordCount of 1000, but high enough
 *  that a 5 km search in an industrial suburb is not routinely truncated. */
const QUERY_LIMIT = 250;

export type NotifiedSite = {
  name: string | null;
  street: string | null;
  suburb: string | null;
  lga: string | null;
  /** EPA's own regulatory determination, e.g. "Regulation under CLM Act not
   *  required". Passed through verbatim — paraphrasing it would change its
   *  legal meaning. */
  managementClass: string | null;
  activityType: string | null;
  distanceM: number | null;
};

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const pt = parseLatLng(q);
  if (!pt)
    return NextResponse.json(
      { error: 'lat and lng are required and must be valid coordinates' },
      { status: 400 },
    );
  const { lat, lng } = pt;

  // `Number(null)` is 0, not NaN — reading the param straight into Number()
  // makes a MISSING radius look like a valid 0, which then clamps to the
  // 100 m floor and silently searches a hundredth of the intended area.
  const rawRadius = q.get('radius');
  const asked = rawRadius === null || rawRadius.trim() === '' ? NaN : Number(rawRadius);
  const radiusM = Number.isFinite(asked)
    ? Math.min(Math.max(asked, 100), MAX_RADIUS_M)
    : DEFAULT_RADIUS_M;

  // The register is a NSW instrument under the CLM Act 1997. Running it
  // elsewhere would return a truthful empty result that reads as a clearance,
  // which is the one thing this endpoint must never do.
  // ACT is a separate jurisdiction, not part of NSW for this purpose, and is
  // tested first in stateOf() — so it is excluded here rather than folded in.
  const state = stateOf({ lat, lng });
  if (state !== 'NSW') {
    return NextResponse.json({
      applicable: false,
      state,
      stateName: state ? STATE_NAME[state] : null,
      radiusM,
      sites: [],
      message: state
        ? `The EPA notified contaminated sites register is made under the NSW Contaminated ` +
          `Land Management Act 1997 and covers New South Wales only. This point is in ` +
          `${STATE_NAME[state]}, so the register says nothing about it either way — ` +
          `check that jurisdiction's own register instead.`
        : 'Point could not be matched to an Australian state, so the NSW register was not queried.',
    });
  }

  // Degrees per metre: latitude is near-constant, longitude narrows with
  // cos(lat). Using the latitude figure for both would make the box ~17%
  // too narrow in Sydney and quietly drop sites near the edge.
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const box: Box = [lng - dLng, lat - dLat, lng + dLng, lat + dLat];

  const r = await inBox(LAYER, box, '*', QUERY_LIMIT, true);
  if (r.error)
    return NextResponse.json(
      {
        applicable: true,
        state: 'NSW',
        radiusM,
        sites: [],
        error: `EPA layer did not answer: ${r.error}`,
      },
      { status: 502 },
    );

  const sites: NotifiedSite[] = r.features
    .map((f: any) => {
      const a = f.attributes ?? {};
      const gx = f.geometry?.x, gy = f.geometry?.y;
      return {
        name: a.SiteName ?? null,
        street: a.SiteStreet ?? null,
        suburb: a.Suburb ?? null,
        lga: a.SiteLGA ?? null,
        managementClass: a.ManagementClass ?? null,
        activityType: a.ContaminationActivityType ?? null,
        distanceM:
          typeof gx === 'number' && typeof gy === 'number'
            ? Math.round(metres({ lat, lng }, { lat: gy, lng: gx }))
            : null,
      };
    })
    // The query is a rectangle; the stated radius is a circle. Trim the corners
    // so a site reported as "within 1 km" actually is.
    .filter((s: NotifiedSite) => s.distanceM == null || s.distanceM <= radiusM)
    .sort((a: NotifiedSite, b: NotifiedSite) =>
      (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));

  // Register version date, straight from the layer rather than assumed.
  const verDate = r.features[0]?.attributes?.VerDate;
  const registerDate =
    typeof verDate === 'number' ? new Date(verDate).toISOString().slice(0, 10) : null;

  return NextResponse.json({
    applicable: true,
    state: 'NSW',
    radiusM,
    count: sites.length,
    sites,
    registerDate,
    truncated: r.features.length >= QUERY_LIMIT,
  });
}
