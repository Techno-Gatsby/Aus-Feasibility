import {
  Proj, ringsToFt, polygonAreaSqft, pointInRings, minDistToPaths,
  bboxDeg, centroid, wktFromRings, type LonLat, type Ring,
} from './geo';
import {
  L, EPQS, SDA, CENSUS_GEOCODER, SFHA_ZONES, CITY_ZONING, NO_ZONING_GIS,
} from './layers';
import {
  arcQuery, arcPoint, arcIntersect, arcEnvelope, dualLayer,
  type ArcFeature,
} from './arcgis';
import type { GridCell } from './yield';
import { cached, keyOf, TTL } from './cache';
import { demographics } from './demographics';

const GRID_TARGET = 400;
/** Hard cap on points per bulk elevation POST. 900 returns in ~11 s. */
const ELEV_BULK_CAP = 900;
/** Fallback only: EPQS is one HTTP request per point, so keep this small. */
const ELEV_FALLBACK_SAMPLES = 40;

const DEP_SAMPLES =
  'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation' +
  '/ImageServer/getSamples';
const M_TO_FT = 3.28084;

/* ------------------------------------------------------------------ */
/* locate                                                              */
/* ------------------------------------------------------------------ */

export async function geocode(address: string) {
  const u = `${CENSUS_GEOCODER}?${new URLSearchParams({
    address, benchmark: 'Public_AR_Current', format: 'json',
  })}`;
  const d = await (await fetch(u, { cache: 'no-store' })).json();
  const m = d?.result?.addressMatches?.[0];
  return m ? { lat: m.coordinates.y, lon: m.coordinates.x, matched: m.matchedAddress } : null;
}

async function findParcel(lat?: number, lon?: number, propId?: number) {
  if (propId != null) {
    for (const [url, source] of [
      [L.prosperParcels, 'Town of Prosper'],
      [L.ccadParcels, 'Collin CAD'],
    ] as const) {
      const field = url === L.prosperParcels ? 'prop_id' : 'PROP_ID';
      const r = await arcQuery(url, {
        where: `${field}=${propId}`, returnGeometry: 'true',
      });
      if (r.features.length) return { f: r.features[0], source };
    }
    return null;
  }
  for (const [url, source] of [
    [L.prosperParcels, 'Town of Prosper'],
    [L.ccadParcels, 'Collin CAD'],
  ] as const) {
    const r = await arcPoint(url, lon!, lat!, { returnGeometry: 'true' });
    if (r.features.length) return { f: r.features[0], source };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* terrain                                                             */
/* ------------------------------------------------------------------ */

async function elevation(lat: number, lon: number, tries = 3) {
  // Snap to ~1 m so nearby tracts and repeat runs share cache entries.
  const la = lat.toFixed(5);
  const lo = lon.toFixed(5);
  const v = await cached<number | null>(
    keyOf('elev', la, lo), TTL.elevation, ['elevation'],
    async () => {
      // EPQS drops requests under concurrency; without retry the relief figure
      // swings between runs purely on how many samples survived.
      for (let i = 0; i < tries; i++) {
        try {
          const u = `${EPQS}?${new URLSearchParams({
            x: lo, y: la, units: 'Feet', wkid: '4326',
          })}`;
          const d = await (await fetch(u, { cache: 'no-store' })).json();
          if (d?.value != null) return Number(d.value);
        } catch { /* retry */ }
      }
      // null is deliberately NOT cached (see the failure guard in cached()),
      // so a dropped request is retried next time rather than pinned.
      return null;
    },
  );
  return v;
}

/**
 * Bulk elevation. 3DEP's getSamples takes hundreds of points in ONE POST,
 * where EPQS is one request per point — so the whole grid is sampled in a
 * single round trip instead of dozens.
 *
 * Two traps: values come back in METRES, and samples are keyed by
 * `locationId` and are NOT guaranteed to arrive in request order, so they
 * must be indexed by id rather than zipped positionally.
 *
 * Returns feet, with null where 3DEP has no value.
 */
async function elevationBulk(
  pts: [number, number][],   // [lon, lat]
): Promise<{ values: (number | null)[]; error?: string }> {
  if (!pts.length) return { values: [] };
  // NOTE THE VERSION SUFFIX. Cached values outlive deploys, so changing this
  // function's return shape without changing the key hands the old shape to
  // the new code — which is exactly how `values.map is not a function`
  // happened. Bump the version whenever the cached shape changes.
  const key = keyOf('elevbulk-v2', pts.length,
    pts[0].map((v) => v.toFixed(5)).join(),
    pts[pts.length - 1].map((v) => v.toFixed(5)).join());

  const res = await cached(key, TTL.elevation, ['elevation'], async () => {
    const body = new URLSearchParams({
      geometry: JSON.stringify({
        points: pts, spatialReference: { wkid: 4326 },
      }),
      geometryType: 'esriGeometryMultipoint',
      returnFirstValueOnly: 'true',
      f: 'json',
    });
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 90_000);
    try {
      const res = await fetch(DEP_SAMPLES, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: ctl.signal,
        cache: 'no-store',
      });
      const d = await res.json();
      if (d?.error) throw new Error(JSON.stringify(d.error).slice(0, 120));
      const out: (number | null)[] = new Array(pts.length).fill(null);
      for (const s of d.samples ?? []) {
        const id = Number(s.locationId);
        const v = Number(s.value);
        if (Number.isInteger(id) && id >= 0 && id < out.length && isFinite(v)) {
          out[id] = v * M_TO_FT;
        }
      }
      // A mostly-empty response means the service is degraded, not that the
      // land has no elevation — treat it as failure so the caller falls back.
      const got = out.filter((v) => v != null).length;
      if (got < pts.length * 0.5) {
        return { values: [], error: `only ${got}/${pts.length} samples` };
      }
      return { values: out };
    } catch (e) {
      // Return the reason rather than throwing — a swallowed exception here
      // silently degrades terrain to the slow path with no way to tell why.
      return {
        values: [],
        error: e instanceof Error ? e.message : String(e),
      };
    } finally {
      clearTimeout(t);
    }
  });

  // Belt and braces: never trust a cached payload's shape.
  if (!res || !Array.isArray((res as any).values)) {
    return { values: [], error: 'unexpected cached shape' };
  }
  return res as { values: (number | null)[]; error?: string };
}

async function mapLimited<T, R>(
  items: T[], limit: number, fn: (t: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

/* ------------------------------------------------------------------ */
/* soils                                                               */
/* ------------------------------------------------------------------ */

async function soils(rings: LonLat[][]) {
  return cached(keyOf('soils', rings), TTL.soils, ['soils'],
    () => soilsUncached(rings));
}

async function soilsUncached(rings: LonLat[][]) {
  const wkt = wktFromRings(rings);
  const query = `SELECT mu.mukey, mu.muname, c.compname, c.comppct_r,
    c.drainagecl, c.hydgrp, c.slope_r,
    (SELECT TOP 1 ch.lep_r FROM chorizon ch WHERE ch.cokey = c.cokey
     ORDER BY ch.hzdept_r) AS lep_r,
    (SELECT TOP 1 ch.pi_r FROM chorizon ch WHERE ch.cokey = c.cokey
     ORDER BY ch.hzdept_r) AS pi_r
    FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('${wkt}') AS m
    INNER JOIN mapunit mu ON mu.mukey = m.mukey
    INNER JOIN component c ON c.mukey = mu.mukey
    WHERE c.majcompflag = 'Yes' ORDER BY c.comppct_r DESC`;
  try {
    const res = await fetch(SDA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'JSON', query }),
      cache: 'no-store',
    });
    const d = await res.json();
    const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
    const units = (d?.Table ?? []).map((r: string[]) => ({
      mukey: r[0], mapUnit: r[1], component: r[2],
      componentPct: num(r[3]), drainage: r[4], hydroGroup: r[5],
      slopePct: num(r[6]), lep: num(r[7]), plasticityIndex: num(r[8]),
    }));
    const leps = units.map((u: any) => u.lep).filter((v: number | null) => v != null);
    const worst = leps.length ? Math.max(...leps) : null;
    const rating =
      worst == null ? 'unknown'
        : worst >= 9 ? 'very high'
        : worst >= 6 ? 'high'
        : worst >= 3 ? 'moderate' : 'low';
    return { units, shrinkSwell: rating, maxLep: worst };
  } catch (e) {
    return { units: [], shrinkSwell: 'unknown', maxLep: null,
             error: e instanceof Error ? e.message : String(e) };
  }
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

const clean = (a: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(a).filter(
      ([k, v]) => v != null && v !== '' &&
        !/^(OBJECTID|Shape|GlobalID|created_|last_edited)/.test(k),
    ),
  );

const ringsOf = (f: ArcFeature): LonLat[][] => f.geometry?.rings ?? [];
const pathsOf = (f: ArcFeature): LonLat[][] => f.geometry?.paths ?? [];

export async function analyse(opts: {
  lat?: number; lon?: number; propId?: number;
}) {
  const found = await findParcel(opts.lat, opts.lon, opts.propId);
  if (!found) {
    // Be precise about WHY. "Not found" reads as "vacant" when it usually
    // means "outside the one county whose parcel layer is wired up".
    const inCollin =
      opts.lat != null && opts.lon != null &&
      opts.lat > 32.98 && opts.lat < 33.41 &&
      opts.lon > -96.86 && opts.lon < -96.29;
    return {
      error: inCollin
        ? 'No parcel at that exact point — it likely falls in road ' +
          'right-of-way or a gap between parcels. Try nudging the location.'
        : 'Outside coverage. Parcel and zoning data is wired to COLLIN ' +
          'COUNTY only (Melissa, Prosper, McKinney, Frisco, Celina, Anna…). ' +
          'Everything else — wetlands, soils, elevation — is already ' +
          'nationwide; it is parcels and zoning that are county-by-county.',
      outsideCoverage: !inCollin,
    };
  }
  const { f: parcel, source } = found;
  const rings = ringsOf(parcel);
  const c = centroid(rings);
  const lat = opts.lat ?? c.lat;
  const lon = opts.lon ?? c.lon;

  const proj = new Proj(lat, lon);
  const ringsFt = ringsToFt(rings, proj);
  const grossAcres = polygonAreaSqft(ringsFt) / 43560;

  const a = parcel.attributes as Record<string, any>;
  const num = (v: unknown) => (v == null || v === '' ? null : Number(v));

  /* ---- grid --------------------------------------------------------- */
  const xs = ringsFt.flat().map((p) => p[0]);
  const ys = ringsFt.flat().map((p) => p[1]);
  const [xmin, ymin, xmax, ymax] = [
    Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys),
  ];
  const w = Math.max(xmax - xmin, 1);
  const h = Math.max(ymax - ymin, 1);
  const spacing = Math.sqrt((w * h) / GRID_TARGET);
  const nx = Math.max(Math.floor(w / spacing), 1);
  const ny = Math.max(Math.floor(h / spacing), 1);
  const gridFt: [number, number][] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = xmin + ((i + 0.5) * w) / nx;
      const y = ymin + ((j + 0.5) * h) / ny;
      if (pointInRings(x, y, ringsFt)) gridFt.push([x, y]);
    }
  }
  if (!gridFt.length) {
    gridFt.push([(xmin + xmax) / 2, (ymin + ymax) / 2]);
  }

  /* ---- regulatory --------------------------------------------------- */
  const [etj, city, isd, spd, flu, etjRel] = await Promise.all([
    arcPoint(L.townEtj, lon, lat),
    arcPoint(L.ccadCityLimits, lon, lat),
    arcPoint(L.ccadSchoolDist, lon, lat),
    arcPoint(L.ccadSpecialDist, lon, lat),
    arcPoint(L.futureLandUse, lon, lat),
    arcPoint(L.etjReleases, lon, lat),
  ]);
  const inProsper = !!etj.features.length;

  // Zoning is per-city. Try the city the parcel sits in; if that city has no
  // published GIS, say so explicitly rather than returning a bare null that
  // reads as "unzoned".
  const cityName = String(city.features[0]?.attributes?.CITYNAME ?? '')
    .trim().toUpperCase();
  const zc = CITY_ZONING.find((z) => z.city === cityName);
  let za: Record<string, any> | undefined;
  let zoningSource: string | null = null;
  let zoningStatus: 'ok' | 'not-published' | 'outside-city' | 'none-here' =
    'none-here';

  if (zc) {
    const r = await arcPoint(zc.url, lon, lat);
    za = r.features[0]?.attributes as Record<string, any> | undefined;
    zoningSource = `City of ${zc.city[0]}${zc.city.slice(1).toLowerCase()}`;
    zoningStatus = za ? 'ok' : 'none-here';
  } else if (!cityName) {
    zoningStatus = 'outside-city';
  } else if (NO_ZONING_GIS.includes(cityName)) {
    zoningStatus = 'not-published';
  } else {
    zoningStatus = 'not-published';
  }

  const pick = (fields?: string[]) => {
    for (const f of fields ?? []) {
      const v = za?.[f];
      if (v != null && String(v).trim() && String(v).trim() !== 'N/A') {
        return String(v).trim();
      }
    }
    return null;
  };

  const regulatory = {
    prosperJurisdiction: (etj.features[0]?.attributes?.NAME as string) ?? null,
    cityLimits: (city.features[0]?.attributes?.CITYNAME as string) ?? null,
    schoolDistrict: (isd.features[0]?.attributes?.ISDNAME as string) ?? null,
    specialDistricts: spd.features.map(
      (f) => `${f.attributes.Name} (${f.attributes.Type})`,
    ),
    zoning: za
      ? {
          zone: pick(zc?.zoneFields),
          class: pick(zc?.descFields),
          pd: za.PD ?? za.PD_Label ?? null,
          sup: za.SUP ?? null,
          ordinances: (zc?.ordFields ?? [])
            .map((f) => za?.[f])
            .filter((v) => v != null && String(v).trim() &&
              String(v).trim() !== 'N/A')
            .map(String),
        }
      : null,
    zoningSource,
    zoningStatus,
    futureLandUse:
      (flu.features[0]?.attributes?.Description as string) ?? null,
    inEtjReleaseArea: !!etjRel.features.length,
  };

  /* ---- constraint layers -------------------------------------------- */
  const [flood, lakes, streams, wet] = await Promise.all([
    dualLayer(L.floodplain, L.coFloodplain, inProsper, (u) =>
      arcIntersect(u, rings, { returnGeometry: 'true' })),
    dualLayer(L.pondsLakes, L.coLakes, inProsper, (u) =>
      arcIntersect(u, rings, { returnGeometry: 'true' })),
    dualLayer(L.streams, L.coStreams, inProsper, (u) =>
      arcEnvelope(u, bboxDeg(rings, 0.004), { returnGeometry: 'true' })),
    arcIntersect(L.wetlands, rings, { returnGeometry: 'true' }),
  ]);

  const sfhaFeats = flood.features.filter((f) => {
    const z = String(f.attributes.FLD_ZONE ?? '').trim().toUpperCase();
    const s = String(f.attributes.ZONE_SUBTY ?? '').toUpperCase();
    return SFHA_ZONES.has(z) || s.includes('FLOODWAY');
  });
  const sfhaFt = sfhaFeats.map((f) => ringsToFt(ringsOf(f), proj));
  const lakeFt = lakes.features.map((f) => ringsToFt(ringsOf(f), proj));
  const wetFt = wet.features.map((f) => ringsToFt(ringsOf(f), proj));
  const streamPaths: Ring[] = streams.features.flatMap((f) =>
    pathsOf(f).map((p) => p.map(([lo, la]) => proj.toFt(lo, la)) as Ring),
  );

  /* ---- terrain --------------------------------------------------------
   * One bulk POST samples EVERY grid cell, so slope is computed at the cell
   * rather than borrowed from the nearest of a few dozen scattered points.
   * Falls back to the per-point EPQS path only if 3DEP is unavailable.
   */
  let elevSource: 'bulk-3dep' | 'epqs-fallback' | 'none' = 'bulk-3dep';
  const bulkIdx = gridFt.length <= ELEV_BULK_CAP
    ? gridFt.map((_, i) => i)
    : Array.from({ length: ELEV_BULK_CAP },
        (_, i) => Math.floor((i * gridFt.length) / ELEV_BULK_CAP));

  const bulkPts = bulkIdx.map((i) => {
    const [x, y] = gridFt[i];
    return proj.toDeg(x, y) as [number, number];
  });
  const bulk = await elevationBulk(bulkPts);
  let elevSourceError = bulk.error;
  let elevs = bulk.values.map((e, k) => ({ xy: gridFt[bulkIdx[k]], e }));

  if (!elevs.some((s) => s.e != null)) {
    elevSource = 'epqs-fallback';
    const step = Math.max(1, gridFt.length / ELEV_FALLBACK_SAMPLES);
    const idx = Array.from(
      { length: Math.min(ELEV_FALLBACK_SAMPLES, gridFt.length) },
      (_, i) => Math.floor(i * step),
    );
    elevs = await mapLimited(idx, 10, async (i) => {
      const [x, y] = gridFt[i];
      const [lo, la] = proj.toDeg(x, y);
      return { xy: gridFt[i], e: await elevation(la, lo) };
    });
  }

  const good = elevs.filter((s) => s.e != null) as { xy: [number, number]; e: number }[];
  if (!good.length) elevSource = 'none';

  let terrain: Record<string, unknown> = {
    samples: good.length, source: elevSource, sourceError: elevSourceError,
  };
  const slopeAt = new Map<number, number>();
  if (good.length >= 3) {
    const nn = good.map(({ xy: [x1, y1] }) => {
      let best = Infinity;
      for (const { xy: [x2, y2] } of good) {
        const d = Math.hypot(x2 - x1, y2 - y1);
        if (d > 0 && d < best) best = d;
      }
      return best === Infinity ? spacing : best;
    }).sort((p, q) => p - q);
    const radius = Math.max(nn[Math.floor(nn.length / 2)] * 1.6, spacing);

    const sampleSlopes = good.map(({ xy: [x1, y1], e: e1 }) => {
      let best = 0;
      for (const { xy: [x2, y2], e: e2 } of good) {
        const d = Math.hypot(x2 - x1, y2 - y1);
        if (d > 0 && d <= radius) best = Math.max(best, (Math.abs(e2 - e1) / d) * 100);
      }
      return best;
    });
    good.forEach((_, i) => slopeAt.set(i, sampleSlopes[i]));

    const vals = good.map((s) => s.e);
    const sorted = [...sampleSlopes].sort((p, q) => p - q);
    terrain = {
      samples: good.length,
      source: elevSource,
      sourceError: elevSourceError,
      coversEveryCell: good.length >= gridFt.length,
      sampleSpacingFt: Math.round(radius / 1.6),
      minFt: Math.min(...vals), maxFt: Math.max(...vals),
      reliefFt: Math.max(...vals) - Math.min(...vals),
      meanSlopePct: sampleSlopes.reduce((s, v) => s + v, 0) / sampleSlopes.length,
      p90SlopePct: sorted[Math.floor(sorted.length * 0.9)],
      maxSlopePct: sorted[sorted.length - 1],
    };
  }

  /* ---- per-cell classification -------------------------------------- */
  const grid: GridCell[] = gridFt.map(([x, y]) => {
    const [lo, la] = proj.toDeg(x, y);
    let slope = 0;
    if (good.length) {
      let bestD = Infinity, bestI = 0;
      good.forEach(({ xy: [sx, sy] }, i) => {
        const d = (sx - x) ** 2 + (sy - y) ** 2;
        if (d < bestD) { bestD = d; bestI = i; }
      });
      slope = slopeAt.get(bestI) ?? 0;
    }
    return {
      lat: la, lon: lo,
      sfha: sfhaFt.some((r) => pointInRings(x, y, r)),
      water: lakeFt.some((r) => pointInRings(x, y, r)),
      wetland: wetFt.some((r) => pointInRings(x, y, r)),
      dStream: streamPaths.length ? minDistToPaths(x, y, streamPaths) : Infinity,
      slope,
    };
  });

  /* ---- utilities: who is legally obliged to serve this tract? -------- */
  const [ccnW, ccnS] = await Promise.all([
    arcIntersect(L.ccnWater, rings),
    arcIntersect(L.ccnSewer, rings),
  ]);
  const ccnOf = (f: ArcFeature) => ({
    utility: f.attributes.UTILITY, ccnNo: f.attributes.CCN_NO,
    status: f.attributes.STATUS, type: f.attributes.CCN_TYPE,
  });
  const utilities = {
    water: {
      status: ccnW.error ? 'QUERY FAILED' : 'ok',
      holders: ccnW.features.map(ccnOf),
    },
    sewer: {
      status: ccnS.error ? 'QUERY FAILED' : 'ok',
      holders: ccnS.features.map(ccnOf),
    },
  };

  /* ---- traffic on the frontage and approach roads -------------------- */
  const aadt = await arcEnvelope(L.txdotAadt, bboxDeg(rings, 0.0072),
    { outFields: 'RTE_NM,RTE_PRFX,RTE_NBR,AADT_CUR,EXT_DATE' });
  // One route is segmented many times; keep the busiest reading per route.
  const byRoute = new Map<string, { route: string; aadt: number }>();
  for (const f of aadt.features) {
    const a = f.attributes as Record<string, any>;
    const v = Number(a.AADT_CUR);
    if (!isFinite(v) || v <= 0) continue;
    const route = [a.RTE_PRFX, a.RTE_NBR].filter(Boolean).join(' ')
      || String(a.RTE_NM ?? 'unknown');
    const cur = byRoute.get(route);
    if (!cur || v > cur.aadt) byRoute.set(route, { route, aadt: v });
  }
  const traffic = {
    status: aadt.error ? 'QUERY FAILED' : 'ok',
    routes: [...byRoute.values()].sort((x, z) => z.aadt - x.aadt).slice(0, 8),
    peakAadt: [...byRoute.values()].reduce((m, r) => Math.max(m, r.aadt), 0),
  };

  /* ---- context ------------------------------------------------------ */
  const [devs, thoro, coThoro, outerLoop, pipesOn, pipesNear,
         wells, orphan, inject] = await Promise.all([
    arcEnvelope(L.currentDev, bboxDeg(rings, 0.0145)),
    arcIntersect(L.thoroughfare, rings),
    arcIntersect(L.coThoroughfare, rings),
    arcEnvelope(L.coOuterLoop, bboxDeg(rings, 0.029)),
    arcIntersect(L.rrcPipelines, rings, { returnGeometry: 'true' }),
    arcEnvelope(L.rrcPipelines, bboxDeg(rings, 0.0072), { returnGeometry: 'true' }),
    arcEnvelope(L.rrcWells, bboxDeg(rings, 0.0072), { returnGeometry: 'true' }),
    arcEnvelope(L.rrcOrphanWells, bboxDeg(rings, 0.0072), { returnGeometry: 'true' }),
    arcEnvelope(L.rrcInjection, bboxDeg(rings, 0.0072), { returnGeometry: 'true' }),
  ]);

  const pl = (f: ArcFeature) => ({
    operator: f.attributes.OPERATOR, commodity: f.attributes.COMMODITY_DESCRIPTION,
    diameterIn: f.attributes.DIAMETER, system: f.attributes.SYSTEM_NAME,
    status: f.attributes.STATUS, phone: f.attributes.CONTACT_PHONE_NUMBER,
  });
  const wellPts = [
    ...wells.features.map((f) => ({ ...f, kind: 'well' })),
    ...orphan.features.map((f) => ({ ...f, kind: 'orphan well' })),
    ...inject.features.map((f) => ({ ...f, kind: 'injection/disposal' })),
  ].map((f) => ({
    kind: f.kind,
    type: String(f.attributes.GIS_SYMBOL_DESCRIPTION ?? '').trim(),
    lat: f.attributes.GIS_LAT83 ?? f.geometry?.y,
    lon: f.attributes.GIS_LONG83 ?? f.geometry?.x,
  }));
  const wellFail = [
    wells.error && 'wells', orphan.error && 'orphan wells',
    inject.error && 'injection/disposal',
  ].filter(Boolean) as string[];

  /* ---- assemble ----------------------------------------------------- */
  return {
    input: { lat, lon, propId: opts.propId ?? null },
    parcel: {
      source,
      propId: a.prop_id ?? a.PROP_ID ?? null,
      geoId: a.geo_id ?? a.geoID ?? null,
      owner: a.file_as_name ?? a.ownerName ?? null,
      legal: a.legal_desc ?? a.legalDescription ?? null,
      grossAcres,
      cadLandAcres: num(a.landSizeAcres),
      cadAgExemptAcres: num(a.landAgAcres),
      cadLandValue: num(a.currValLand),
      cadMarketValue: num(a.currValMarket),
      rings,
    },
    regulatory,
    coverage: {
      floodplain: flood.source, water: lakes.source, streams: streams.source,
      wetlands: wet.error ? 'NO COVERAGE' : 'USFWS NWI',
    },
    floodZones: [...new Set(flood.features.map((f) => {
      const z = String(f.attributes.FLD_ZONE ?? '').trim();
      const s = String(f.attributes.ZONE_SUBTY ?? '').trim();
      return z + (s ? ` (${s})` : '');
    }))].filter(Boolean),
    wetlandTypes: wet.features.reduce((m: Record<string, number>, f) => {
      const at = Object.fromEntries(
        Object.entries(f.attributes).map(([k, v]) => [k.split('.').pop()!, v]),
      );
      const t = String(at.WETLAND_TYPE ?? 'Unclassified');
      m[t] = (m[t] ?? 0) + 1;
      return m;
    }, {}),
    geometry: {
      sfha: sfhaFeats.map(ringsOf),
      water: lakes.features.map(ringsOf),
      wetlands: wet.features.map(ringsOf),
      streams: streams.features.flatMap(pathsOf),
      pipelines: pipesNear.features.flatMap(pathsOf),
    },
    grid,
    terrain,
    utilities,
    traffic,
    demographics: await demographics(lat, lon),
    soils: await soils(rings),
    context: {
      nearbyDevelopments: devs.features.map((f) => clean(f.attributes)).slice(0, 25),
      thoroughfareCrossing:
        thoro.features.length + coThoro.features.length,
      outerLoopWithin2mi: outerLoop.features.length,
      pipelinesCrossing: pipesOn.features.map(pl),
      pipelinesWithinHalfMile: pipesNear.features.length,
      wells: wellPts,
      wellQueryFailed: wellFail,
      pipelineQueryFailed: !!(pipesOn.error && pipesNear.error),
    },
  };
}
