import { NextRequest, NextResponse } from 'next/server';
import { inBox, atPoint } from '@/lib/arcgis';
import { stateOf } from '@/lib/geo';

export const runtime = 'nodejs';

const VAL = 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/Valuation/MapServer';

/** Land values and comparable sales from the NSW Valuer General.
 *
 *  Free, keyless, CORS-enabled — and worth stating plainly: on sale evidence
 *  this beats the US tool. Texas is a non-disclosure state where transaction
 *  prices are never public at any price. NSW publishes the address, the
 *  price and the date.
 *
 *  Two traps live here:
 *   - Layers 1-7 are POINT geometry. A point-intersects query returns zero
 *     every time. Use an envelope.
 *   - Layers 0, 4 and 8 are GROUP layers and 400 on query. The urbanity
 *     tiers (1/2/3 sales, 5/6/7 values, 9/10/11 boundary) are the real ones.
 */

/** '  $2,790,000' -> 2790000. Values arrive as strings with a leading space,
 *  a dollar sign and commas; casting silently yields NaN. */
const money = (v: any): number | null => {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return isFinite(n) && n !== 0 ? n : null;
};
/** '139.1 square metres' | '1.331 hectares' -> m2 */
const areaM2 = (v: any): number | null => {
  if (!v) return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  if (!isFinite(n)) return null;
  return /hect/i.test(String(v)) ? n * 10000 : n;
};

export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get('lat'));
  const lng = Number(req.nextUrl.searchParams.get('lng'));
  if (!isFinite(lat) || !isFinite(lng))
    return NextResponse.json({ error: 'lat/lng required' }, { status: 400 });

  const p = { lat, lng };
  if (stateOf(p) !== 'NSW')
    return NextResponse.json({
      available: false,
      reason: 'Land values and sale evidence are only published this way in NSW. '
            + 'Victoria releases suburb medians only; Queensland publishes cadastre '
            + 'without values. Neither has a parcel-level equivalent.',
    });

  // property boundary IS a polygon, so it answers a point query and gives us propid
  const bnd = await atPoint(`${VAL}/9`, p, '*');
  const propid = bnd.features[0]?.attributes?.propid ?? null;

  const pad = 0.0022;                        // ~250 m
  const box: [number, number, number, number] =
    [p.lng - pad, p.lat - pad, p.lng + pad, p.lat + pad];

  const [vals, sales] = await Promise.all([
    inBox(`${VAL}/5`, box, '*', 60, false),
    inBox(`${VAL}/1`, box, '*', 60, false),
  ]);

  const subject = propid
    ? (vals.features ?? []).find((f: any) => f.attributes?.propid === propid) ?? null
    : null;

  const valueOf = (a: any) => ({
    address: a?.address ?? null,
    zone: a?.zone_desc ?? null,
    areaM2: areaM2(a?.prop_area),
    basis: a?.basis_desc ?? null,
    // five annual land values, most recent first
    series: [1, 2, 3, 4, 5]
      .map((i) => ({ at: a?.[`val${i}_bd`] ?? null, value: money(a?.[`val${i}_lv`]) }))
      .filter((x) => x.value != null),
  });

  const comps = (sales.features ?? [])
    .map((f: any) => ({
      address: f.attributes?.bp_address ?? null,
      price: money(f.attributes?.price),
      date: f.attributes?.sale_date ?? null,
      areaM2: areaM2(f.attributes?.prop_area),
    }))
    .filter((s: any) => s.price)
    .sort((a: any, b: any) => (b.price ?? 0) - (a.price ?? 0));

  const withRate = comps.filter((c: any) => c.areaM2 && c.areaM2 > 0);
  const rates = withRate.map((c: any) => c.price / c.areaM2).sort((a: number, b: number) => a - b);
  const median = rates.length ? rates[Math.floor(rates.length / 2)] : null;

  return NextResponse.json({
    available: true,
    propid,
    subject: subject ? valueOf(subject.attributes) : null,
    comparables: comps.slice(0, 25),
    comparableCount: comps.length,
    medianRatePerM2: median,
    radiusM: Math.round(pad * 111320),
    note:
      'Land values are the Valuer General assessment, which excludes structural '
      + 'improvements — it is not a market appraisal of the developed property. '
      + 'Sales are actual recorded transactions. A median rate over a small sample '
      + 'is indicative only; it does not adjust for zoning, aspect, slope or '
      + 'development potential.',
  });
}
