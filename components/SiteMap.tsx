'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import type * as L from 'leaflet';
import { BASEMAPS, LAYER_STYLE, DEFAULT_VIS, type LayerVis, type BasemapKey } from '@/lib/mapStyle';
import { inAustralia } from '@/lib/geo';

/** Rebuilt on the architecture the US build proved out.
 *
 *  The first attempt drew NOTHING — a satellite tile with a search box — so
 *  the hazard answers lived only in a side panel and the map was decoration.
 *  This draws every layer as real geometry on the parcel, which is the whole
 *  point of a site map.
 *
 *  Two carried-over lessons from the US build:
 *   - The subject lot is CASED: a dark halo underneath, a bright amber line
 *     on top, so it reads on pale tiles and dark aerial alike.
 *   - The container is sized by flex AFTER Leaflet initialises, so its cached
 *     dimensions are stale: tiles come up blank and fitBounds lands on the
 *     wrong zoom. invalidateSize() before every fit.
 */

export type SiteShapes = Record<string, [number, number][][][]>;

export default function SiteMap({
  onPick, shapes, center,
}: {
  onPick?: (p: { lat: number; lng: number }) => void;
  shapes?: SiteShapes | null;
  center?: { lat: number; lng: number } | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const Lref = useRef<typeof L | null>(null);
  const groups = useRef<Record<string, L.LayerGroup>>({});
  const tile = useRef<L.TileLayer | null>(null);
  const [ready, setReady] = useState(false);
  const [base, setBase] = useState<BasemapKey>('satellite');
  const [vis, setVis] = useState<LayerVis>(DEFAULT_VIS);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // init
  useEffect(() => {
    let dead = false;
    (async () => {
      const leaflet = (await import('leaflet')).default ?? (await import('leaflet'));
      if (dead || !host.current || map.current) return;
      Lref.current = leaflet as unknown as typeof L;
      const m = leaflet.map(host.current, {
        center: [-33.8688, 151.2093], zoom: 12, zoomControl: true,
      });
      tile.current = leaflet.tileLayer(BASEMAPS.satellite.url, {
        attribution: BASEMAPS.satellite.attribution, maxZoom: BASEMAPS.satellite.max,
      }).addTo(m);
      (Object.keys(LAYER_STYLE) as (keyof LayerVis)[]).forEach((k) => {
        groups.current[k] = leaflet.layerGroup().addTo(m);
      });
      m.on('click', (e: any) => onPick?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
      map.current = m;
      setReady(true);
      setTimeout(() => m.invalidateSize(), 60);
    })();
    return () => { dead = true; map.current?.remove(); map.current = null; };
  }, [onPick]);

  // basemap switch
  useEffect(() => {
    const m = map.current, leaflet = Lref.current;
    if (!m || !leaflet || !tile.current) return;
    tile.current.remove();
    const b = BASEMAPS[base];
    tile.current = leaflet.tileLayer(b.url, { attribution: b.attribution, maxZoom: b.max }).addTo(m);
    tile.current.bringToBack();
  }, [base]);

  // draw
  useEffect(() => {
    const m = map.current, leaflet = Lref.current;
    if (!m || !leaflet || !ready) return;
    Object.values(groups.current).forEach((g) => g.clearLayers());
    if (!shapes) return;

    (Object.keys(LAYER_STYLE) as (keyof LayerVis)[]).forEach((key) => {
      if (!vis[key]) return;
      const st = LAYER_STYLE[key];
      const polys = shapes[key] ?? [];
      polys.forEach((rings) => {
        if (!rings?.length) return;
        if (key === 'parcel') {
          // cased: halo first, then the bright line on top
          leaflet.polygon(rings as any, {
            color: '#1c1917', weight: 5, opacity: 0.55, fill: false,
          }).addTo(groups.current[key]);
        }
        leaflet.polygon(rings as any, {
          color: st.color, weight: key === 'parcel' ? 2.5 : 1.5,
          opacity: 1, fillColor: st.color, fillOpacity: st.fill,
        }).addTo(groups.current[key]);
      });
    });

    const parcel = shapes.parcel?.[0];
    if (parcel?.length) {
      m.invalidateSize();                      // flex sizing lands after init
      m.fitBounds(leaflet.polygon(parcel as any).getBounds(), { padding: [40, 40], maxZoom: 18 });
    } else if (center) {
      m.setView([center.lat, center.lng], 17);
    }
  }, [shapes, vis, ready, center]);

  const search = useCallback(async () => {
    const m = map.current;
    if (!m || !ready) { setMsg('Map is still loading.'); return; }
    const term = q.trim(); if (term.length < 3) return;
    setBusy(true); setMsg(null);
    try {
      const j = await (await fetch(`/api/geocode?q=${encodeURIComponent(term)}`)).json();
      const hit = j.hits?.[0];
      if (!hit) { setMsg(j.error ?? 'No match in Australia.'); return; }
      if (!inAustralia(hit)) { setMsg('Result is outside Australia — ignored.'); return; }
      m.setView([hit.lat, hit.lng], 17);
      setMsg(hit.label);
      onPick?.({ lat: hit.lat, lng: hit.lng });
    } catch (e: any) { setMsg(`Search failed: ${e?.message ?? e}`); }
    finally { setBusy(false); }
  }, [q, ready, onPick]);

  const count = (k: keyof LayerVis) => (shapes?.[k]?.length ?? 0);

  return (
    <div className="map-wrap">
      <div className="map-bar">
        <input value={q} onChange={(e) => setQ(e.target.value)}
               onKeyDown={(e) => e.key === 'Enter' && search()}
               placeholder="Address, suburb, or lat,lng" aria-label="Search for a site" />
        <button onClick={search} disabled={busy || !ready} className="primary">
          {busy ? 'Searching…' : 'Find'}
        </button>
        <div className="seg">
          {(Object.keys(BASEMAPS) as BasemapKey[]).map((k) => (
            <button key={k} onClick={() => setBase(k)} aria-pressed={base === k}>
              {BASEMAPS[k].label}
            </button>
          ))}
        </div>
      </div>

      <div className="legend">
        {(Object.keys(LAYER_STYLE) as (keyof LayerVis)[]).map((k) => {
          const n = count(k);
          return (
            <button key={k} className={`chip${vis[k] ? ' on' : ''}${n ? '' : ' empty'}`}
                    onClick={() => setVis((v) => ({ ...v, [k]: !v[k] }))}
                    aria-pressed={vis[k]} disabled={!n}>
              <i style={{ background: LAYER_STYLE[k].color }} />
              {LAYER_STYLE[k].label}{n ? ` (${n})` : ''}
            </button>
          );
        })}
      </div>

      {msg && <div className="map-msg">{msg}</div>}
      <div ref={host} className="map-canvas" />
      <div className="map-foot">
        Click the map to analyse any point. A layer with no shapes is greyed out —
        that means nothing is mapped there, which is not the same as a clearance.
      </div>
    </div>
  );
}
