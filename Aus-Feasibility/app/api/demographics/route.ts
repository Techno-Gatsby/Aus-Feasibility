import { NextRequest, NextResponse } from 'next/server';
import { atPoint } from '@/lib/arcgis';
import {
  SA2_LAYER, readSa2, fetchPopulation, fetchMedians, parseLatLng,
  type Demographics, type Missing,
} from '@/lib/abs';
import { inAustralia } from '@/lib/geo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** ABS demographics for the SA2 containing a point.
 *
 *  Server-side because data.api.abs.gov.au sends no CORS header. The three
 *  upstream calls are deliberately independent: the SA2 lookup is the only one
 *  that can fail the whole request, and either statistic can be absent on its
 *  own without taking the other down with it. */
export async function GET(req: NextRequest) {
  const pt = parseLatLng(req.nextUrl.searchParams);
  if (!pt)
    return NextResponse.json(
      { error: 'lat and lng are required and must be valid coordinates' },
      { status: 400 },
    );
  const { lat, lng } = pt;
  if (!inAustralia({ lat, lng }))
    return NextResponse.json(
      { error: 'Point is outside Australia — ABS statistical areas do not cover it.' },
      { status: 400 },
    );

  // 1. Which SA2 is this?
  const geo = await atPoint(SA2_LAYER, { lat, lng });
  if (geo.error)
    return NextResponse.json(
      { error: `ABS boundary service did not answer: ${geo.error}` },
      { status: 502 },
    );

  const sa2 = readSa2(geo.features[0]?.attributes);
  if (!sa2) {
    const body: Demographics = {
      sa2: null, population: null, medianAge: null,
      medianPersonalIncomeWeekly: null, medianHouseholdIncomeWeekly: null,
      missing: [{
        field: 'SA2',
        reason: 'No ABS statistical area covers this point. Offshore or outside the boundary set.',
      }],
    };
    return NextResponse.json(body);
  }

  // 2. Statistics. Run together — one slow dataflow should not serialise the other.
  const [pop, med] = await Promise.all([
    fetchPopulation(sa2.code),
    fetchMedians(sa2.code),
  ]);

  const missing: Missing[] = [];
  if (!pop.figure)
    missing.push({
      field: 'Population',
      reason: pop.error ?? 'ABS returned no ERP observation for this SA2.',
    });
  if (med.error) {
    missing.push({ field: 'Median age and income', reason: med.error });
  } else {
    // A dataflow that answers but withholds a cell is a different failure from
    // a dataflow that did not answer, and is reported as such.
    if (!med.age)
      missing.push({ field: 'Median age', reason: 'Not published for this SA2 in Census 2021.' });
    if (!med.personal)
      missing.push({ field: 'Median personal income', reason: 'Not published for this SA2 in Census 2021.' });
    if (!med.household)
      missing.push({ field: 'Median household income', reason: 'Not published for this SA2 in Census 2021.' });
  }

  const body: Demographics = {
    sa2,
    population: pop.figure,
    medianAge: med.age,
    medianPersonalIncomeWeekly: med.personal,
    medianHouseholdIncomeWeekly: med.household,
    missing,
  };
  return NextResponse.json(body);
}
