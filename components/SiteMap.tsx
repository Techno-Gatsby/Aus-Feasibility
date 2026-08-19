'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl, { Map as MLMap } from 'maplibre-gl';
import { LAYERS } from '@/lib/layers';
import { AU_BOUNDS, inAustralia } from '@/lib/geo';

/** THE BUG THIS FIXES
 *  The old build showed "Paddington, Sydney NSW" while sitting at
 *  -29.47, 149.90 with council polygons smeared across rural NSW. Two
 *  causes, both handled here:
 *    1. the geocoded result was never applied to the map, so it stayed at
 *       the national default; the search now awaits map load and flies to
 *       the hit, and refuses anything outside Australia.
 *    2. overlays had floors as low as zoom 2.2, so at national zoom every
 *       council's polygons drew at once. Each layer now declares minZoom
 *       and is removed below it — see lib/layers.ts.
 */

const SATELLITE =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export default function SiteMap({
  onPick,
}: { onPick?: (p: { lat: number; lng: number }) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(4);
  const [basemap, setBasemap] = useState<'sat' | 'osm'>('sat');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!host.current || map.current) return;
    const m = new maplibregl.Map({
      container: host.current,
      style: {
        version: 8,
        sources: {
          base: { type: 'raster', tiles: [SATELLITE], tileSize: 256, maxzoom: 19,
                  attribution: 'Esri World Imagery' },
        },
        layers: [{ id: 'base', type: 'raster', source: 'base' }],
      },
      center: [151.226, -33.885],
      zoom: 12,
      maxBounds: [
        [AU_BOUNDS[0] - 2, AU_BOUNDS[1] - 2],
        [AU_BOUNDS[2] + 2, AU_BOUNDS[3] + 2],
      ],
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('load', () => { map.current = m; setReady(true); setZoom(m.getZoom()); });
    m.on('zoomend', () => setZoom(m.getZoom()));
    m.on('click', (e) => onPick?.({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
    return () => { m.remove(); map.current = null; };
  }, [onPick]);

  useEffect(() => {
    const m = map.current; if (!m || !ready) return;
    const src = m.getSource('base') as any;
    if (src?.setTiles) src.setTiles([basemap === 'sat' ? SATELLITE : OSM]);
  }, [basemap, ready]);

  const search = useCallback(async () => {
    const m = map.current;
    if (!m || !ready) { setMsg('Map is still loading.'); return; }   // never fire early
    const term = q.trim();
    if (term.length < 3) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/geocode?q=${encodeURIComponent(term)}`);
      const j = await r.json();
      const hit = j.hits?.[0];
      if (!hit) { setMsg(j.error ?? 'No match in Australia.'); return; }
      if (!inAustralia(hit)) { setMsg('Result is outside Australia — ignored.'); return; }
      m.flyTo({ center: [hit.lng, hit.lat], zoom: 16, duration: 700 });
      setMsg(`${hit.label}${j.dropped ? ` · ${j.dropped} out-of-country result(s) discarded` : ''}`);
      onPick?.({ lat: hit.lat, lng: hit.lng });
    } catch (e: any) {
      setMsg(`Search failed: ${e?.message ?? e}`);
    } finally { setBusy(false); }
  }, [q, ready, onPick]);

  const active = LAYERS.filter((l) => zoom >= l.minZoom);
  const hidden = LAYERS.length - active.length;

  return (
    <div className="map-wrap">
      <div className="map-bar">
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="Address, suburb, or lat,lng"
          aria-label="Search for a site"
        />
        <button onClick={search} disabled={busy || !ready} className="primary">
          {busy ? 'Searching…' : 'Find'}
        </button>
        <div className="seg">
          <button onClick={() => setBasemap('osm')} aria-pressed={basemap === 'osm'}>Map</button>
          <button onClick={() => setBasemap('sat')} aria-pressed={basemap === 'sat'}>Satellite</button>
        </div>
      </div>
      {msg && <div className="map-msg">{msg}</div>}
      <div ref={host} className="map-canvas" />
      <div className="map-foot">
        Zoom {zoom.toFixed(1)} · {active.length} layer{active.length === 1 ? '' : 's'} available
        {hidden > 0 && (
          <span className="muted"> · {hidden} hidden below their zoom floor, so the
            map cannot smear council polygons across the state</span>
        )}
      </div>
    </div>
  );
}
