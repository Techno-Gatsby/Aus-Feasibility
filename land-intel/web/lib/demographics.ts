import { cached, keyOf, TTL } from './cache';

// US Census ACS 5-year. Nationwide, free — but the API now requires a key
// (it 302s to a "Missing Key" page without one). Sign up takes ~30 seconds:
//   https://api.census.gov/data/key_signup.html
// then set CENSUS_API_KEY. Absent a key this degrades to an explicit
// "not configured" rather than silently reporting nothing.

const GEO = 'https://geocoding.geo.census.gov/geocoder/geographies/coordinates';
const ACS = 'https://api.census.gov/data/2023/acs/acs5';

const VARS: Record<string, string> = {
  B01003_001E: 'population',
  B19013_001E: 'medianHouseholdIncome',
  B25077_001E: 'medianHomeValue',
  B25064_001E: 'medianGrossRent',
  B01002_001E: 'medianAge',
  B25003_001E: 'occupiedUnits',
  B25003_002E: 'ownerOccupiedUnits',
  B25002_003E: 'vacantUnits',
  B15003_022E: 'bachelorsDegrees',
  B15003_001E: 'pop25plus',
};

export interface Demographics {
  status: 'ok' | 'no-key' | 'error';
  message?: string;
  tract?: string;
  county?: string;
  tractStats?: Record<string, number | null>;
  countyStats?: Record<string, number | null>;
  ownerOccupiedPct?: number | null;
  vacancyPct?: number | null;
  bachelorsPct?: number | null;
  countyPopulation2018?: number | null;
  countyPopulationChangePct?: number | null;
}

async function geographies(lat: number, lon: number) {
  return cached(keyOf('censusgeo', lat.toFixed(4), lon.toFixed(4)),
    TTL.slow, ['census'], async () => {
      const u = `${GEO}?${new URLSearchParams({
        x: String(lon), y: String(lat),
        benchmark: 'Public_AR_Current', vintage: 'Current_Current',
        format: 'json',
      })}`;
      const d = await (await fetch(u, { cache: 'no-store' })).json();
      const g = d?.result?.geographies ?? {};
      const t = g['Census Tracts']?.[0];
      const c = g['Counties']?.[0];
      if (!t || !c) return { error: 'no geography' } as any;
      return {
        state: t.STATE, county: t.COUNTY, tract: t.TRACT,
        tractName: t.NAME, countyName: c.NAME,
      };
    });
}

async function acs(get: string[], where: string, key: string) {
  const url = `${ACS}?${new URLSearchParams({
    get: ['NAME', ...get].join(','), key,
  })}&${where}`;
  const res = await fetch(url, { cache: 'no-store', redirect: 'follow' });
  const text = await res.text();
  if (!text.trim().startsWith('[')) {
    // The API answers a bad/missing key with an HTML page, not JSON.
    throw new Error('Census API rejected the request (check CENSUS_API_KEY)');
  }
  const rows = JSON.parse(text) as string[][];
  const [head, row] = rows;
  const out: Record<string, number | null> = {};
  head.forEach((h, i) => {
    if (h === 'NAME' || !VARS[h]) return;
    const v = Number(row[i]);
    // Census uses large negative sentinels for suppressed values.
    out[VARS[h]] = isFinite(v) && v > -1e6 ? v : null;
  });
  return out;
}

export async function demographics(lat: number, lon: number): Promise<Demographics> {
  const key = process.env.CENSUS_API_KEY ?? '';
  if (!key) {
    return {
      status: 'no-key',
      message:
        'Census demographics not configured. Get a free key in ~30 seconds at ' +
        'api.census.gov/data/key_signup.html and set CENSUS_API_KEY.',
    };
  }

  const g: any = await geographies(lat, lon);
  if (!g || g.error) {
    return { status: 'error', message: 'Could not resolve census geography.' };
  }

  return cached(keyOf('acs', g.state, g.county, g.tract), TTL.slow, ['census'],
    async (): Promise<Demographics> => {
      try {
        const vars = Object.keys(VARS);
        const [tractStats, countyStats, prior] = await Promise.all([
          acs(vars, `for=tract:${g.tract}&in=state:${g.state}%20county:${g.county}`, key),
          acs(vars, `for=county:${g.county}&in=state:${g.state}`, key),
          fetch(`https://api.census.gov/data/2018/acs/acs5?get=NAME,B01003_001E&for=county:${g.county}&in=state:${g.state}&key=${key}`,
                { cache: 'no-store' })
            .then((r) => r.text())
            .then((t) => (t.trim().startsWith('[') ? Number(JSON.parse(t)[1][1]) : null))
            .catch(() => null),
        ]);

        const pct = (a?: number | null, b?: number | null) =>
          a != null && b != null && b > 0 ? Math.round((1000 * a) / b) / 10 : null;

        const nowPop = countyStats.population;
        return {
          status: 'ok',
          tract: g.tractName,
          county: g.countyName,
          tractStats,
          countyStats,
          ownerOccupiedPct: pct(tractStats.ownerOccupiedUnits, tractStats.occupiedUnits),
          vacancyPct: pct(tractStats.vacantUnits,
            (tractStats.occupiedUnits ?? 0) + (tractStats.vacantUnits ?? 0)),
          bachelorsPct: pct(tractStats.bachelorsDegrees, tractStats.pop25plus),
          countyPopulation2018: prior,
          countyPopulationChangePct:
            prior && nowPop ? Math.round((1000 * (nowPop - prior)) / prior) / 10 : null,
        };
      } catch (e) {
        return {
          status: 'error',
          message: e instanceof Error ? e.message : String(e),
        };
      }
    });
}
