import { NextResponse } from 'next/server';
import { arcQuery } from '@/lib/arcgis';
import { L } from '@/lib/layers';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export interface Suggestion {
  kind: 'owner' | 'address' | 'propId' | 'place';
  label: string;
  sub?: string;
  propId?: number;
  latlon?: string;
}

// ArcGIS `where` takes raw SQL, so anything interpolated must be escaped.
// A single quote in an owner name ("O'BRIEN") would otherwise break the
// query — or worse, be injectable.
const sql = (s: string) => s.replace(/'/g, "''").toUpperCase();

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
  if (q.length < 3) return NextResponse.json({ suggestions: [] });

  const esc = sql(q);
  const out: Suggestion[] = [];

  if (/^\d{3,}$/.test(q)) {
    out.push({ kind: 'propId', label: `Property id ${q}`, propId: Number(q) });
  }

  const [owners, addresses] = await Promise.all([
    arcQuery(L.ccadParcels, {
      where: `UPPER(ownerName) LIKE '%${esc}%'`,
      outFields: 'PROP_ID,ownerName,situsStreetName,situsBldgNum,situsCity,landSizeAcres',
      orderByFields: 'landSizeAcres DESC',
      resultRecordCount: '8',
      returnGeometry: 'false',
    }),
    arcQuery(L.ccadParcels, {
      where: `UPPER(situsStreetName) LIKE '%${esc}%' OR ` +
             `UPPER(situsBldgNum || ' ' || situsStreetName) LIKE '${esc}%'`,
      outFields: 'PROP_ID,ownerName,situsStreetName,situsBldgNum,situsCity,landSizeAcres',
      orderByFields: 'landSizeAcres DESC',
      resultRecordCount: '8',
      returnGeometry: 'false',
    }),
  ]);

  const seen = new Set<number>();
  const push = (kind: 'owner' | 'address', f: any) => {
    const a = f.attributes;
    if (seen.has(a.PROP_ID)) return;
    seen.add(a.PROP_ID);
    const situs = [a.situsBldgNum, a.situsStreetName, a.situsCity]
      .filter(Boolean).join(' ');
    const acres = a.landSizeAcres
      ? `${Number(a.landSizeAcres).toFixed(2)} ac` : null;
    out.push({
      kind,
      label: kind === 'owner' ? (a.ownerName ?? '—') : (situs || '—'),
      sub: [kind === 'owner' ? situs : a.ownerName, acres]
        .filter(Boolean).join(' · '),
      propId: a.PROP_ID,
    });
  };

  owners.features.forEach((f) => push('owner', f));
  addresses.features.forEach((f) => push('address', f));

  return NextResponse.json({ suggestions: out.slice(0, 12) });
}
