import { NextResponse } from 'next/server';
import { cached, keyOf, TTL } from '@/lib/cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// USGS 3DEP ImageServer. getSamples takes hundreds of points in ONE request —
// vastly better than EPQS, which is one point per call. 900 points come back
// in ~11 s, which is enough for a real terrain surface.
const DEP =
  'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation' +
  '/ImageServer/getSamples';

const M_TO_FT = 3.28084;
const N = 36; // 36 x 36 = 1296 samples

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const bbox = q.get('bbox');
  if (!bbox) return NextResponse.json({ error: 'bbox required' }, { status: 400 });
  const [xmin, ymin, xmax, ymax] = bbox.split(',').map(Number);
  if ([xmin, ymin, xmax, ymax].some((v) => !isFinite(v))) {
    return NextResponse.json({ error: 'bad bbox' }, { status: 400 });
  }
  // Guard: a huge bbox would sample at uselessly coarse resolution.
  if (Math.max(xmax - xmin, ymax - ymin) > 0.12) {
    return NextResponse.json({ error: 'area too large for terrain' }, { status: 400 });
  }

  const key = keyOf('terrain', xmin.toFixed(5), ymin.toFixed(5),
    xmax.toFixed(5), ymax.toFixed(5), N);

  const out = await cached(key, TTL.elevation, ['elevation'], async () => {
    const points: [number, number][] = [];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        points.push([
          xmin + ((xmax - xmin) * i) / (N - 1),
          ymin + ((ymax - ymin) * j) / (N - 1),
        ]);
      }
    }

    const body = new URLSearchParams({
      geometry: JSON.stringify({ points, spatialReference: { wkid: 4326 } }),
      geometryType: 'esriGeometryMultipoint',
      returnFirstValueOnly: 'true',
      f: 'json',
    });

    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 90_000);
    try {
      const res = await fetch(DEP, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: ctl.signal,
        cache: 'no-store',
      });
      const d = await res.json();
      if (d?.error) return { error: JSON.stringify(d.error).slice(0, 200) };

      // Samples come back keyed by locationId, but not necessarily in order.
      const z = new Array<number | null>(N * N).fill(null);
      for (const s of d.samples ?? []) {
        const id = Number(s.locationId);
        const v = Number(s.value);
        if (Number.isInteger(id) && id >= 0 && id < z.length && isFinite(v)) {
          z[id] = v * M_TO_FT;
        }
      }
      const known = z.filter((v): v is number => v != null);
      if (known.length < N * N * 0.5) {
        return { error: 'insufficient elevation coverage' };
      }
      // Fill the occasional gap with the mean so the mesh has no holes.
      const mean = known.reduce((a, b) => a + b, 0) / known.length;
      const grid = z.map((v) => (v == null ? mean : v));

      return {
        n: N,
        bbox: [xmin, ymin, xmax, ymax],
        minFt: Math.min(...known),
        maxFt: Math.max(...known),
        grid,
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    } finally {
      clearTimeout(t);
    }
  });

  if ((out as any)?.error) {
    return NextResponse.json(out, { status: 502 });
  }
  return NextResponse.json(out);
}
