import { NextResponse } from 'next/server';
import { arcQuery } from '@/lib/arcgis';
import { L } from '@/lib/layers';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Neighbouring parcels for the current viewport, so you can see the ownership
// fabric around a tract rather than one polygon floating in space.
const MAX_FEATURES = 1200;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const bbox = q.get('bbox');
  if (!bbox) {
    return NextResponse.json({ error: 'bbox required' }, { status: 400 });
  }
  const [xmin, ymin, xmax, ymax] = bbox.split(',').map(Number);
  if ([xmin, ymin, xmax, ymax].some((v) => !isFinite(v))) {
    return NextResponse.json({ error: 'bad bbox' }, { status: 400 });
  }

  // Guard against someone zooming out and asking for the whole county.
  const spanDeg = Math.max(xmax - xmin, ymax - ymin);
  if (spanDeg > 0.09) {
    return NextResponse.json({ features: [], tooBroad: true });
  }

  const r = await arcQuery(L.ccadParcels, {
    geometry: JSON.stringify({
      xmin, ymin, xmax, ymax, spatialReference: { wkid: 4326 },
    }),
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'PROP_ID,ownerName,legalDescription,landSizeAcres,currValMarket,situsStreetName,situsBldgNum',
    returnGeometry: 'true',
    resultRecordCount: String(MAX_FEATURES),
  });
  if (r.error) {
    return NextResponse.json({ error: r.error, features: [] }, { status: 502 });
  }

  return NextResponse.json({
    truncated: r.features.length >= MAX_FEATURES,
    features: r.features.map((f) => ({
      propId: f.attributes.PROP_ID,
      owner: f.attributes.ownerName ?? null,
      legal: f.attributes.legalDescription ?? null,
      acres: f.attributes.landSizeAcres ?? null,
      value: f.attributes.currValMarket ?? null,
      situs: [f.attributes.situsBldgNum, f.attributes.situsStreetName]
        .filter(Boolean).join(' ') || null,
      rings: f.geometry?.rings ?? [],
    })),
  });
}
